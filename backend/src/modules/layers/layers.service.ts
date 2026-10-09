import { BadRequestException, Injectable } from '@nestjs/common';
import { extname } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { Params, castType, qi, qualified } from '../../common/sql';
import { CatalogService } from '../tables/catalog.service';
import { SourcesService } from '../tables/sources.service';
import {
  ImportType,
  Sheet,
  convert,
  decodeText,
  geoJsonToSheet,
  inferTypes,
  parseCsv,
  readWorkbook,
  sheetRows,
  suggestColumns,
  tableNameFrom,
  toSheet,
} from './import.parse';

export interface Upload {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * Schema onde o sistema cria as tabelas das camadas importadas/copiadas (criado se não existir).
 * Ao remover do mapa uma camada deste schema, a tabela é apagada; tabelas de outros schemas, nunca.
 */
export const TEMP_SCHEMA = 'GeoAnalisysTemp';

export interface ImportConfig {
  sheet?: string | null;
  name: string;
  /** Padrão: TEMP_SCHEMA */
  schema?: string | null;
  /** null = criar um ID automático */
  idColumn: string | null;
  xColumn: string;
  yColumn: string;
  coordinateSystem: string;
  proj4?: string | null;
  labelColumn?: string | null;
  categoryColumn?: string | null;
  /** Tipos escolhidos pelo usuário (padrão: inferidos) */
  types?: Record<string, ImportType>;
}

const SQL_TYPE: Record<ImportType, string> = {
  integer: 'bigint',
  number: 'double precision',
  text: 'text',
};
const BATCH = 2000;

/**
 * Camadas criadas pelo sistema: importadas de CSV/XLSX/GeoJSON/KML ou copiadas de pontos selecionados. Viram
 * tabelas reais no banco (por padrão no schema GeoAnalisysTemp) e são registradas como fontes de dados — funcionam
 * igual às tabelas que já existiam (seleção, edição, filtros, exportação, Tabela de Alterações).
 */
@Injectable()
export class LayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly catalog: CatalogService,
  ) {}

  // ---------------------------------------------------------------- leitura do arquivo

  private async load(
    file: Upload | undefined,
    sheet?: string | null,
  ): Promise<{
    sheets: string[];
    sheet: string | null;
    data: Sheet;
    /** GeoJSON: colunas de coordenada geradas */
    geo: { xColumn: string; yColumn: string } | null;
  }> {
    if (!file?.buffer?.length)
      throw new BadRequestException('Envie um arquivo .csv, .xlsx, .geojson ou .kml');
    const ext = extname(file.originalname || '').toLowerCase();
    if (ext === '.geojson' || ext === '.json') {
      try {
        const { sheet: data, xColumn, yColumn } = geoJsonToSheet(decodeText(file.buffer));
        return { sheets: [], sheet: null, data, geo: { xColumn, yColumn } };
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }
    let sheets: string[] = [];
    let chosen: string | null = null;
    let rows;
    if (ext === '.xlsx' || ext === '.xlsm') {
      const wb = await readWorkbook(file.buffer).catch((e: Error) => {
        throw new BadRequestException(e.message);
      });
      sheets = wb.worksheets.map((w) => w.name);
      const ws = (sheet && wb.getWorksheet(sheet)) || wb.worksheets[0];
      if (!ws) throw new BadRequestException('A planilha não tem abas');
      chosen = ws.name;
      rows = sheetRows(ws);
    } else if (ext === '.csv' || ext === '.txt' || ext === '.tsv') {
      rows = parseCsv(decodeText(file.buffer));
    } else if (ext === '.xls') {
      throw new BadRequestException(
        'Arquivos .xls antigos não são suportados: salve como .xlsx ou .csv',
      );
    } else {
      throw new BadRequestException('Formato não suportado: use .csv, .xlsx, .geojson ou .kml');
    }
    const data = toSheet(rows);
    if (!data.headers.length)
      throw new BadRequestException(
        chosen ? `A aba "${chosen}" está vazia` : 'O arquivo está vazio',
      );
    return { sheets, sheet: chosen, data, geo: null };
  }

  /** Abas, cabeçalhos, tipos detectados, primeiras linhas e sugestões de ID/X/Y. */
  async preview(file: Upload | undefined, sheet?: string | null) {
    const { sheets, sheet: chosen, data, geo } = await this.load(file, sheet);
    const types = inferTypes(data);
    const suggested: ReturnType<typeof suggestColumns> & { coordinateSystem: string | null } = {
      ...suggestColumns(data, types),
      coordinateSystem: null,
    };
    if (geo) {
      // GeoJSON: colunas geradas, em lon/lat WGS84 (salvo arquivos antigos em coordenadas projetadas).
      const x = data.headers.indexOf(geo.xColumn);
      const y = data.headers.indexOf(geo.yColumn);
      const inRange = (c: number, lim: number) =>
        data.rows.every((r) => r[c] === null || Math.abs(r[c] as number) <= lim);
      const geographic = inRange(x, 180) && inRange(y, 90);
      suggested.xColumn = geo.xColumn;
      suggested.yColumn = geo.yColumn;
      suggested.coordinates = geographic ? 'geographic' : 'projected';
      suggested.coordinateSystem = geographic ? 'EPSG:4326' : null;
    }
    return {
      sheets,
      sheet: chosen,
      headers: data.headers,
      types,
      rows: data.rows.slice(0, 20),
      total: data.rows.length,
      suggested,
    };
  }

  // ---------------------------------------------------------------- utilitários

  /** Schema de destino (padrão: GeoAnalisysTemp, criado se preciso), validado no catálogo. */
  private async targetSchema(schema?: string | null) {
    const target = schema?.trim() || TEMP_SCHEMA;
    if (target === TEMP_SCHEMA)
      await this.prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${qi(TEMP_SCHEMA)}`);
    if (!(await this.catalog.listSchemas()).includes(target)) {
      throw new BadRequestException(`Schema "${target}" não existe (ou não pode receber camadas)`);
    }
    return target;
  }

  /**
   * Camada removida do mapa: se a tabela está no schema GeoAnalisysTemp, apaga a tabela e a fonte
   * de dados. Em qualquer outro schema nada é apagado (`dropped: false`).
   */
  async removeTemp(sourceId: string, userId: string) {
    const source = await this.prisma.dataSource.findUnique({ where: { id: sourceId } });
    if (!source || source.schema !== TEMP_SCHEMA) return { dropped: false };
    await this.prisma.$executeRawUnsafe(
      `DROP TABLE IF EXISTS ${qualified(TEMP_SCHEMA, source.tableName)}`,
    );
    await this.sources.remove(sourceId, userId);
    return { dropped: true, tableName: source.tableName };
  }

  /** Nome de tabela livre no schema (sufixo _2, _3… se já existir). */
  private async freeTableName(schema: string, name: string) {
    const base = tableNameFrom(name);
    let t = base;
    for (let n = 2; await this.catalog.tableExists(schema, t); n++) t = `${base.slice(0, 46)}_${n}`;
    return t;
  }

  /** Registra a tabela como fonte e cria os índices; se falhar, remove a tabela criada. */
  private async register(
    schema: string,
    tableName: string,
    cfg: Omit<ImportConfig, 'schema' | 'types' | 'sheet' | 'idColumn'> & {
      idColumn: string;
      geometryColumn?: string | null;
      searchColumns?: string[];
    },
    userId: string,
  ) {
    try {
      const source = await this.sources.create(
        {
          name: cfg.name,
          schema,
          tableName,
          idColumn: cfg.idColumn,
          xColumn: cfg.xColumn,
          yColumn: cfg.yColumn,
          coordinateSystem: cfg.coordinateSystem,
          proj4: cfg.proj4 || null,
          labelColumn: cfg.labelColumn || null,
          categoryColumn: cfg.categoryColumn || null,
          geometryColumn: cfg.geometryColumn || null,
          searchColumns: cfg.searchColumns ?? [],
        },
        userId,
      );
      await this.sources.createIndexes(source.id, userId).catch(() => undefined);
      return source;
    } catch (err) {
      await this.prisma
        .$executeRawUnsafe(`DROP TABLE IF EXISTS ${qualified(schema, tableName)}`)
        .catch(() => undefined);
      throw err;
    }
  }

  // ---------------------------------------------------------------- importar

  async import(file: Upload | undefined, cfg: ImportConfig, userId: string) {
    const name = cfg?.name?.trim();
    if (!name || name.length > 120)
      throw new BadRequestException('Informe o nome da camada (até 120 caracteres)');
    const schema = await this.targetSchema(cfg.schema);
    const { data } = await this.load(file, cfg.sheet);
    const has = (h?: string | null) => !!h && data.headers.includes(h);
    if (!has(cfg.xColumn) || !has(cfg.yColumn))
      throw new BadRequestException('Escolha as colunas de X e Y');
    if (cfg.xColumn === cfg.yColumn)
      throw new BadRequestException('X e Y devem ser colunas diferentes');
    if (cfg.idColumn && !has(cfg.idColumn))
      throw new BadRequestException(`Coluna de ID "${cfg.idColumn}" não existe no arquivo`);
    for (const opt of [cfg.labelColumn, cfg.categoryColumn]) {
      if (opt && !has(opt)) throw new BadRequestException(`Coluna "${opt}" não existe no arquivo`);
    }
    if (!data.rows.length)
      throw new BadRequestException('A planilha não tem linhas de dados (só o cabeçalho)');

    // Tipos: inferidos, ajustados pelo usuário; coordenadas sempre numéricas.
    const inferred = inferTypes(data);
    const types = data.headers.map((h, i) => {
      if (h === cfg.xColumn || h === cfg.yColumn) return 'number' as const;
      const t = cfg.types?.[h];
      return t === 'integer' || t === 'number' || t === 'text' ? t : inferred[i];
    });

    // ID automático com nome livre (id, id_gis, id_gis_2…).
    let autoId: string | null = null;
    if (!cfg.idColumn) {
      const taken = new Set(data.headers.map((h) => h.toLowerCase()));
      autoId = taken.has('id') ? 'id_gis' : 'id';
      for (let n = 2; taken.has(autoId.toLowerCase()); n++) autoId = `id_gis_${n}`;
    }

    const tableName = await this.freeTableName(schema, name);
    const table = qualified(schema, tableName);
    const defs = [
      ...(autoId ? [`${qi(autoId)} bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`] : []),
      ...data.headers.map((h, i) => `${qi(h)} ${SQL_TYPE[types[i]]}`),
    ];
    // Colunas do recordset com nomes seguros (k0, k1…), mapeadas para os nomes reais.
    const recordset = data.headers.map((_, i) => `"k${i}" ${SQL_TYPE[types[i]]}`).join(', ');
    const insert = `INSERT INTO ${table} (${data.headers.map(qi).join(', ')})
      SELECT ${data.headers.map((_, i) => `r."k${i}"`).join(', ')}
        FROM jsonb_to_recordset($1::jsonb) AS r(${recordset})`;

    const invalid: Record<string, number> = {};
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TABLE ${table} (${defs.join(', ')})`);
        for (let i = 0; i < data.rows.length; i += BATCH) {
          const batch = data.rows.slice(i, i + BATCH).map((row) => {
            const o: Record<string, string | number | null> = {};
            row.forEach((v, c) => {
              const r = convert(v, types[c]);
              if (r.invalid) invalid[data.headers[c]] = (invalid[data.headers[c]] ?? 0) + 1;
              o[`k${c}`] = r.value;
            });
            return o;
          });
          await tx.$executeRawUnsafe(insert, JSON.stringify(batch));
        }
      },
      { timeout: 600_000, maxWait: 10_000 },
    );

    const source = await this.register(
      schema,
      tableName,
      { ...cfg, name, idColumn: cfg.idColumn || autoId! },
      userId,
    );
    return { source, rows: data.rows.length, schema, tableName, invalid };
  }

  // ---------------------------------------------------------------- copiar selecionados

  /** Copia os registros escolhidos para uma nova tabela com a mesma estrutura e a registra como camada. */
  async copyToLayer(
    sourceId: string,
    ids: string[],
    name: string,
    schema: string | undefined,
    userId: string,
  ) {
    const layerName = name.trim();
    if (!layerName) throw new BadRequestException('Informe o nome da nova camada');
    const ctx = await this.sources.context(sourceId, true);
    const target = await this.targetSchema(schema);
    const tableName = await this.freeTableName(target, layerName);
    const table = qualified(target, tableName);
    // Colunas geradas são recalculadas pelo banco; identidade é copiada com o valor original.
    const cols = ctx.columns.filter((c) => !c.isGenerated).map((c) => qi(c.name));
    const params = new Params();
    const idCond = `${qi(ctx.idCol.name)} = ANY(CAST(${params.add(ids)} AS ${castType(ctx.idCol)}[]))`;

    const copied = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TABLE ${table} (LIKE ${ctx.table} INCLUDING ALL)`);
        return tx.$executeRawUnsafe(
          `INSERT INTO ${table} (${cols.join(', ')}) OVERRIDING SYSTEM VALUE
           SELECT ${cols.join(', ')} FROM ${ctx.table} WHERE ${idCond}`,
          ...params.values,
        );
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
    if (!copied) {
      await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table}`);
      throw new BadRequestException('Nenhum dos registros selecionados foi encontrado');
    }

    const s = ctx.source;
    const source = await this.register(
      target,
      tableName,
      {
        name: layerName,
        idColumn: s.idColumn,
        xColumn: s.xColumn,
        yColumn: s.yColumn,
        coordinateSystem: s.coordinateSystem,
        proj4: s.proj4,
        labelColumn: s.labelColumn,
        categoryColumn: s.categoryColumn,
        geometryColumn: s.geometryColumn,
        searchColumns: s.searchColumns,
      },
      userId,
    );
    return { source, rows: copied, schema: target, tableName };
  }
}
