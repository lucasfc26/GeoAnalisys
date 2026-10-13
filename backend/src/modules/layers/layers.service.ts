import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { extname } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { ColumnMeta, Params, castType, pgis, qi, qualified } from '../../common/sql';
import {
  ConvertedField,
  convertedFields,
  convertedValue,
  latLngToUtm,
  parseCoordValue,
  parseNumber,
} from '../../common/coords';
import { CrsService } from '../maps/crs.service';
import { CatalogService } from '../tables/catalog.service';
import { SourcesService } from '../tables/sources.service';
import {
  ImportType,
  Sheet,
  columnNamesFrom,
  convert,
  decodeText,
  freeName,
  geoJsonToSheet,
  inferTypes,
  parseCsv,
  readCoordinates,
  readWorkbook,
  sheetRows,
  suggestColumns,
  tableNameFrom,
  tableValue,
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
  /** Colunas de X e Y separadas (ignoradas quando `coordColumn` é informada) */
  xColumn?: string | null;
  yColumn?: string | null;
  /** Coluna com o par de coordenadas na mesma célula ("-3.84, -38.40", "POINT(…)", GMS…) */
  coordColumn?: string | null;
  coordinateSystem: string;
  /** Gravar também as coordenadas convertidas (lat/lng → UTM X/Y e zona; UTM → lat/lng) */
  convertCoordinates?: boolean;
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

/** Resultado tabular de uma ferramenta (ex.: Associar Camadas) para gravar como camada. */
export interface LayerTable {
  headers: string[];
  types: ImportType[];
  rows: unknown[][];
  /** Posição de cada linha em WGS84 (null = sem coordenadas) */
  coords: ({ lat: number; lng: number } | null)[];
}

/** Coluna gravada a partir do resultado: valor convertido para `type` e lido do JSON como `recType`. */
interface WriteColumn {
  name: string;
  type: ImportType;
  /** Tipo da coluna no jsonb_to_recordset */
  recType: string;
  /** Expressão do SELECT a partir de r."kN" (padrão: o próprio valor) */
  expr?: (ref: string) => string;
  value: (row: unknown[], i: number) => unknown;
}

const importTypeOf = (c: ColumnMeta): ImportType =>
  c.kind === 'integer' ? 'integer' : c.kind === 'number' ? 'number' : 'text';

/**
 * Camadas criadas pelo sistema: importadas de CSV/XLSX/GeoJSON/KML, copiadas de pontos selecionados ou
 * gravadas a partir do resultado de uma ferramenta (Associar Camadas). Viram
 * tabelas reais no banco (por padrão no schema GeoAnalisysTemp) e são registradas como fontes de dados — funcionam
 * igual às tabelas que já existiam (seleção, edição, filtros, exportação, Tabela de Alterações).
 */
@Injectable()
export class LayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly catalog: CatalogService,
    private readonly crs: CrsService,
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
    cfg: Omit<
      ImportConfig,
      'schema' | 'types' | 'sheet' | 'idColumn' | 'xColumn' | 'yColumn' | 'coordColumn'
    > & {
      idColumn: string;
      xColumn: string;
      yColumn: string;
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
    if (cfg.coordColumn) {
      if (!has(cfg.coordColumn))
        throw new BadRequestException(`Coluna "${cfg.coordColumn}" não existe no arquivo`);
    } else {
      if (!has(cfg.xColumn) || !has(cfg.yColumn))
        throw new BadRequestException('Escolha as colunas de X e Y');
      if (cfg.xColumn === cfg.yColumn)
        throw new BadRequestException('X e Y devem ser colunas diferentes');
    }
    const crs = this.crs.resolve(cfg.coordinateSystem, cfg.proj4);
    if (cfg.idColumn && !has(cfg.idColumn))
      throw new BadRequestException(`Coluna de ID "${cfg.idColumn}" não existe no arquivo`);
    for (const opt of [cfg.labelColumn, cfg.categoryColumn]) {
      if (opt && !has(opt)) throw new BadRequestException(`Coluna "${opt}" não existe no arquivo`);
    }
    if (!data.rows.length)
      throw new BadRequestException('A planilha não tem linhas de dados (só o cabeçalho)');

    // Tipos: inferidos, ajustados pelo usuário.
    const inferred = inferTypes(data);
    const types: ImportType[] = data.headers.map((h, i) => {
      const t = cfg.types?.[h];
      return t === 'integer' || t === 'number' || t === 'text' ? t : inferred[i];
    });

    // Coordenadas lidas em qualquer formato (vírgula decimal, GMS, par numa célula). Colunas X/Y só
    // com números recebem o valor numérico; com texto (ex.: 3º 50' 37" S) ou com o par numa célula,
    // o original fica como texto e o valor vai para colunas novas (longitude/latitude ou utm_x/utm_y).
    const geographic = crs.def.kind === 'geographic';
    const xy = readCoordinates(data, cfg, geographic);
    const taken = new Set(data.headers.map((h) => h.toLowerCase()));
    const xIdx = cfg.coordColumn ? -1 : data.headers.indexOf(cfg.xColumn!);
    const yIdx = cfg.coordColumn ? -1 : data.headers.indexOf(cfg.yColumn!);
    const plainNumbers = (c: number) =>
      data.rows.every(
        (r) => r[c] === null || typeof r[c] === 'number' || parseNumber(String(r[c])) !== null,
      );
    let xColumn: string;
    let yColumn: string;
    const extra: {
      name: string;
      type: ImportType;
      value: (i: number) => string | number | null;
    }[] = [];
    if (xIdx >= 0 && yIdx >= 0 && plainNumbers(xIdx) && plainNumbers(yIdx)) {
      xColumn = cfg.xColumn!;
      yColumn = cfg.yColumn!;
      types[xIdx] = 'number';
      types[yIdx] = 'number';
      data.rows.forEach((r, i) => {
        r[xIdx] = xy[i]?.x ?? parseCoordValue(r[xIdx]);
        r[yIdx] = xy[i]?.y ?? parseCoordValue(r[yIdx]);
      });
    } else {
      for (const c of [xIdx, yIdx]) if (c >= 0 && types[c] !== 'text') types[c] = 'text';
      const [xn, yn] = geographic
        ? ['longitude', 'latitude']
        : crs.def.kind === 'utm'
          ? ['utm_x', 'utm_y']
          : ['coord_x', 'coord_y'];
      xColumn = freeName(xn, taken);
      yColumn = freeName(yn, taken);
      extra.push(
        { name: xColumn, type: 'number', value: (i) => xy[i]?.x ?? null },
        { name: yColumn, type: 'number', value: (i) => xy[i]?.y ?? null },
      );
    }
    const unread = xy.filter((p) => !p).length;

    // Coordenadas convertidas para o outro sistema (lat/lng ↔ UTM).
    if (cfg.convertCoordinates) {
      const ll = xy.map((p) => (p ? crs.toLatLng(p.x, p.y) : null));
      const utm = ll.map((p) => (p ? latLngToUtm(p.lat, p.lng) : null));
      for (const f of convertedFields(crs.def.kind)) {
        extra.push({
          name: freeName(f, taken),
          type: f === 'utm_zona' ? 'text' : 'number',
          value: (i) => convertedValue(f, ll[i], utm[i]),
        });
      }
    }
    for (const e of extra) {
      data.headers.push(e.name);
      types.push(e.type);
    }
    data.rows.forEach((r, i) => {
      for (const e of extra) r.push(e.value(i));
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
      { ...cfg, name, idColumn: cfg.idColumn || autoId!, xColumn, yColumn },
      userId,
    );
    if (unread) invalid['coordenadas não reconhecidas'] = unread;
    return { source, rows: data.rows.length, schema, tableName, invalid };
  }

  // ---------------------------------------------------------------- converter coordenadas

  /**
   * Plano da conversão de uma camada existente: colunas que recebem as coordenadas convertidas
   * (geográfico → utm_x/utm_y/utm_zona; UTM → latitude/longitude; outro projetado → todas) e se já
   * existem (são sobrescritas). Colunas de ID/X/Y/geometria nunca são usadas como destino. Se X/Y
   * são texto (ex.: graus/minutos/segundos), em camada geográfica também grava longitude/latitude
   * decimais e passa a usá-las como X/Y.
   */
  private async conversionPlan(sourceId: string) {
    const ctx = await this.sources.context(sourceId, true);
    const reserved = new Set(
      [ctx.idCol, ctx.xCol, ctx.yCol, ctx.geomCol].flatMap((c) =>
        c ? [c.name.toLowerCase()] : [],
      ),
    );
    const taken = new Set(ctx.columns.map((c) => c.name.toLowerCase()));
    const textXY = !ctx.xCol.isNumeric || !ctx.yCol.isNumeric;
    const fields: ConvertedField[] = convertedFields(ctx.crs.def.kind);
    if (textXY && ctx.crs.def.kind === 'geographic') fields.unshift('longitude', 'latitude');
    const columns = fields.map((field) => {
      const type: ImportType = field === 'utm_zona' ? 'text' : 'number';
      const existing = ctx.columns.find((c) => c.name.toLowerCase() === field);
      // Reaproveita a coluna de mesmo nome (nova conversão) se for do tipo certo e não for ID/X/Y.
      const reusable =
        existing &&
        !reserved.has(existing.name.toLowerCase()) &&
        !existing.readOnly &&
        (type === 'number' ? existing.isNumeric : existing.kind === 'text');
      const name = reusable ? existing.name : freeName(field, taken);
      return { field, name, type, exists: !!reusable };
    });
    return { ctx, columns, repointXY: textXY && ctx.crs.def.kind === 'geographic' };
  }

  async conversionPreview(sourceId: string) {
    const { ctx, columns, repointXY } = await this.conversionPlan(sourceId);
    return {
      source: { id: ctx.source.id, name: ctx.source.name, schema: ctx.source.schema },
      crs: ctx.crs.def,
      columns: columns.map(({ field, name, exists }) => ({ field, name, exists })),
      repointXY,
    };
  }

  /**
   * Grava na tabela da camada as coordenadas convertidas (cria as colunas que faltam e preenche
   * todos os registros). X/Y em texto são lidos em qualquer formato aceito na importação.
   */
  async convertCoordinates(sourceId: string, userId: string) {
    const { ctx, columns, repointXY } = await this.conversionPlan(sourceId);
    const idType = castType(ctx.idCol);
    const rows = await this.prisma.$queryRawUnsafe<
      { id: string; x: string | null; y: string | null }[]
    >(
      `SELECT ${qi(ctx.idCol.name)}::text AS id, ${qi(ctx.xCol.name)}::text AS x, ${qi(ctx.yCol.name)}::text AS y
         FROM ${ctx.table}`,
    );
    let converted = 0;
    const values = rows.map((r) => {
      const x = parseCoordValue(r.x);
      const y = parseCoordValue(r.y);
      const ll = x !== null && y !== null ? ctx.crs.toLatLng(x, y) : null;
      if (ll) converted++;
      const utm = ll ? latLngToUtm(ll.lat, ll.lng) : null;
      const o: Record<string, string | number | null> = { id: r.id };
      columns.forEach((c, k) => (o[`k${k}`] = convertedValue(c.field, ll, utm)));
      return o;
    });
    const recordset = ['"id" text', ...columns.map((c, k) => `"k${k}" ${SQL_TYPE[c.type]}`)].join(
      ', ',
    );
    const sets = columns.map((c, k) => `${qi(c.name)} = r."k${k}"`).join(', ');
    const update = `UPDATE ${ctx.table} AS t SET ${sets}
      FROM jsonb_to_recordset($1::jsonb) AS r(${recordset})
     WHERE t.${qi(ctx.idCol.name)} = CAST(r."id" AS ${idType})`;

    await this.prisma.$transaction(
      async (tx) => {
        for (const c of columns.filter((c) => !c.exists)) {
          await tx.$executeRawUnsafe(
            `ALTER TABLE ${ctx.table} ADD COLUMN ${qi(c.name)} ${SQL_TYPE[c.type]}`,
          );
        }
        for (let i = 0; i < values.length; i += BATCH) {
          await tx.$executeRawUnsafe(update, JSON.stringify(values.slice(i, i + BATCH)));
        }
      },
      { timeout: 600_000, maxWait: 10_000 },
    );

    if (repointXY) {
      const lng = columns.find((c) => c.field === 'longitude')!.name;
      const lat = columns.find((c) => c.field === 'latitude')!.name;
      await this.sources.update(sourceId, { xColumn: lng, yColumn: lat }, userId);
    }
    await this.prisma.$executeRawUnsafe(`ANALYZE ${ctx.table}`).catch(() => undefined);
    const fresh = await this.sources.context(sourceId, true);
    return {
      source: fresh.source,
      rows: rows.length,
      converted,
      columns: columns.map((c) => c.name),
      added: columns.filter((c) => !c.exists).map((c) => c.name),
      repointed: repointXY,
    };
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

  // ---------------------------------------------------------------- resultado de ferramenta

  /** Insere as linhas em lotes, contando por coluna os valores que não converteram. */
  private async insertRows(
    tx: Prisma.TransactionClient,
    table: string,
    cols: WriteColumn[],
    rows: unknown[][],
    invalid: Record<string, number>,
  ) {
    const recordset = cols.map((c, k) => `"k${k}" ${c.recType}`).join(', ');
    const sql = `INSERT INTO ${table} (${cols.map((c) => qi(c.name)).join(', ')})
      SELECT ${cols.map((c, k) => (c.expr ? c.expr(`r."k${k}"`) : `r."k${k}"`)).join(', ')}
        FROM jsonb_to_recordset($1::jsonb) AS r(${recordset})`;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map((row, j) => {
        const o: Record<string, string | number | null> = {};
        cols.forEach((c, k) => {
          const r = tableValue(c.value(row, i + j), c.type);
          if (r.invalid) invalid[c.name] = (invalid[c.name] ?? 0) + 1;
          o[`k${k}`] = r.value;
        });
        return o;
      });
      await tx.$executeRawUnsafe(sql, JSON.stringify(batch));
    }
  }

  /** Gravação numa coluna que já existe, convertendo para o tipo dela. */
  private writeInto(col: ColumnMeta, value: WriteColumn['value']): WriteColumn {
    const type = importTypeOf(col);
    const assignable = col.isNumeric || ['text', 'varchar', 'bpchar'].includes(col.udtName);
    return {
      name: col.name,
      type,
      recType: SQL_TYPE[type],
      expr: assignable
        ? undefined
        : (ref) => `CAST(${ref} AS ${col.kind === 'text' ? qi(col.udtName) : castType(col)})`,
      value,
    };
  }

  /**
   * Cria uma camada em GeoAnalisysTemp com o resultado: ID automático, uma coluna por cabeçalho e
   * longitude/latitude (WGS84) para posicionar cada linha no mapa.
   */
  async createFromTable(
    table: LayerTable,
    name: string,
    userId: string,
    opts: { categoryHeader?: string; convertCoordinates?: boolean } = {},
  ) {
    const layerName = name?.trim();
    if (!layerName || layerName.length > 120)
      throw new BadRequestException('Informe o nome da camada (até 120 caracteres)');
    if (!table.headers.length) throw new BadRequestException('O resultado não tem colunas');
    const schema = await this.targetSchema(TEMP_SCHEMA);
    const names = columnNamesFrom(table.headers);
    const taken = new Set(names.map((n) => n.toLowerCase()));
    const idColumn = freeName('id', taken);
    const xColumn = freeName('longitude', taken);
    const yColumn = freeName('latitude', taken);
    const tableName = await this.freeTableName(schema, layerName);
    const qt = qualified(schema, tableName);

    const cols: WriteColumn[] = [
      ...names.map((n, c): WriteColumn => ({
        name: n,
        type: table.types[c],
        recType: SQL_TYPE[table.types[c]],
        value: (row) => row[c],
      })),
      {
        name: xColumn,
        type: 'number',
        recType: SQL_TYPE.number,
        value: (_, i) => table.coords[i]?.lng ?? null,
      },
      {
        name: yColumn,
        type: 'number',
        recType: SQL_TYPE.number,
        value: (_, i) => table.coords[i]?.lat ?? null,
      },
    ];
    // Também em UTM (zona de cada ponto), se pedido.
    if (opts.convertCoordinates) {
      const utm = table.coords.map((p) => (p ? latLngToUtm(p.lat, p.lng) : null));
      for (const f of convertedFields('geographic')) {
        const type: ImportType = f === 'utm_zona' ? 'text' : 'number';
        cols.push({
          name: freeName(f, taken),
          type,
          recType: SQL_TYPE[type],
          value: (_, i) => convertedValue(f, table.coords[i], utm[i]),
        });
      }
    }
    const defs = [
      `${qi(idColumn)} bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`,
      ...cols.map((c) => `${qi(c.name)} ${c.recType}`),
    ];
    const invalid: Record<string, number> = {};
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TABLE ${qt} (${defs.join(', ')})`);
        await this.insertRows(tx, qt, cols, table.rows, invalid);
      },
      { timeout: 600_000, maxWait: 10_000 },
    );

    const category = opts.categoryHeader ? table.headers.indexOf(opts.categoryHeader) : -1;
    const source = await this.register(
      schema,
      tableName,
      {
        name: layerName,
        idColumn,
        xColumn,
        yColumn,
        coordinateSystem: 'EPSG:4326',
        categoryColumn: category >= 0 ? names[category] : null,
      },
      userId,
    );
    return {
      source,
      rows: table.rows.length,
      schema,
      tableName,
      invalid,
      added: [] as string[],
      removed: [] as string[],
      ignored: [] as string[],
      empty: [] as string[],
    };
  }

  /**
   * Substitui os registros de uma camada de GeoAnalisysTemp pelo resultado: esvazia a tabela
   * (TRUNCATE) e grava as linhas. Com `adjustColumns`, antes acrescenta as colunas novas do resultado
   * e apaga as que ele não tem; sem, grava só nas colunas que já existem. ID, X/Y e geometria da
   * camada são mantidos (X/Y no sistema de coordenadas dela).
   */
  async replaceFromTable(
    table: LayerTable,
    sourceId: string,
    adjustColumns: boolean,
    userId: string,
  ) {
    const ctx = await this.sources.context(sourceId, true);
    const s = ctx.source;
    if (s.schema !== TEMP_SCHEMA) {
      throw new BadRequestException(
        `Só camadas do schema ${TEMP_SCHEMA} podem ser substituídas ("${s.name}" está em ${s.schema})`,
      );
    }
    const managed = new Set(
      [ctx.idCol, ctx.xCol, ctx.yCol, ctx.geomCol].flatMap((c) => (c ? [c.name] : [])),
    );
    const names = columnNamesFrom(table.headers);
    const model = names.map((name, c) => ({ name, c })).filter((m) => !managed.has(m.name));
    const modelNames = new Set(model.map((m) => m.name));
    const outside = ctx.columns.filter((c) => !managed.has(c.name) && !modelNames.has(c.name));
    const added = adjustColumns ? model.filter((m) => !ctx.colMap.has(m.name)) : [];
    // Colunas geradas primeiro: podem depender das outras que saem.
    const removed = adjustColumns
      ? [...outside].sort((x, y) => Number(y.isGenerated) - Number(x.isGenerated))
      : [];
    const addedNames = new Set(added.map((m) => m.name));

    const cols: WriteColumn[] = [];
    const ignored = names.filter((n) => managed.has(n));
    for (const m of model) {
      const value = (row: unknown[]) => row[m.c];
      const type = table.types[m.c];
      if (addedNames.has(m.name)) {
        cols.push({ name: m.name, type, recType: SQL_TYPE[type], value });
        continue;
      }
      const col = ctx.colMap.get(m.name);
      if (!col || col.readOnly) ignored.push(m.name);
      else cols.push(this.writeInto(col, value));
    }

    const xy = table.coords.map((p) => (p ? ctx.crs.toXY(p.lat, p.lng) : null));
    const coord = (col: ColumnMeta, v: number | undefined) =>
      v === undefined ? null : col.kind === 'integer' ? Math.round(v) : v;
    if (!ctx.xCol.readOnly)
      cols.push(this.writeInto(ctx.xCol, (_, i) => coord(ctx.xCol, xy[i]?.x)));
    if (!ctx.yCol.readOnly)
      cols.push(this.writeInto(ctx.yCol, (_, i) => coord(ctx.yCol, xy[i]?.y)));
    const geom = ctx.geomCol;
    if (geom && !geom.isGenerated && geom.udtName === 'geometry') {
      cols.push({
        name: geom.name,
        type: 'text',
        recType: 'text',
        expr: (ref) =>
          `${pgis('ST_SetSRID')}(${pgis('ST_GeomFromText')}(${ref}), ${Math.trunc(ctx.geomSrid)})`,
        value: (_, i) => (xy[i] ? `POINT(${xy[i]!.x} ${xy[i]!.y})` : null),
      });
    }
    if (!ctx.idCol.hasDefault && !ctx.idCol.isGenerated) {
      cols.push(this.writeInto(ctx.idCol, (_, i) => i + 1));
    }

    const invalid: Record<string, number> = {};
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`TRUNCATE TABLE ${ctx.table} RESTART IDENTITY`);
        for (const c of removed) {
          await tx.$executeRawUnsafe(`ALTER TABLE ${ctx.table} DROP COLUMN ${qi(c.name)}`);
        }
        for (const m of added) {
          await tx.$executeRawUnsafe(
            `ALTER TABLE ${ctx.table} ADD COLUMN ${qi(m.name)} ${SQL_TYPE[table.types[m.c]]}`,
          );
        }
        await this.insertRows(tx, ctx.table, cols, table.rows, invalid);
      },
      { timeout: 600_000, maxWait: 10_000 },
    );

    // Rótulo, categoria e busca não podem apontar para colunas apagadas.
    const gone = new Set(removed.map((c) => c.name));
    const patch: { labelColumn?: string; categoryColumn?: string; searchColumns?: string[] } = {};
    if (s.labelColumn && gone.has(s.labelColumn)) patch.labelColumn = '';
    if (s.categoryColumn && gone.has(s.categoryColumn)) patch.categoryColumn = '';
    if (s.searchColumns.some((c) => gone.has(c)))
      patch.searchColumns = s.searchColumns.filter((c) => !gone.has(c));
    if (Object.keys(patch).length) await this.sources.update(sourceId, patch, userId);
    const fresh = await this.sources.context(sourceId, true);
    await this.prisma.$executeRawUnsafe(`ANALYZE ${ctx.table}`).catch(() => undefined);

    return {
      source: fresh.source,
      rows: table.rows.length,
      schema: s.schema,
      tableName: s.tableName,
      invalid,
      added: added.map((m) => m.name),
      removed: removed.map((c) => c.name),
      ignored,
      empty: adjustColumns ? [] : outside.filter((c) => !c.isGenerated).map((c) => c.name),
    };
  }
}
