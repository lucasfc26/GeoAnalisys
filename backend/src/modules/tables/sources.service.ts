import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CrsHandle, CrsService } from '../maps/crs.service';
import { CatalogService } from './catalog.service';
import { SourceConfigDto, UpdateSourceDto } from './dto/source.dto';
import {
  ColumnMeta,
  Params,
  coordExpr,
  normalizeRow,
  qi,
  qualified,
  selectExpr,
} from '../../common/sql';

/** Tudo que é necessário para consultar uma fonte de dados com segurança. */
export interface SourceContext {
  source: DataSource;
  columns: ColumnMeta[];
  colMap: Map<string, ColumnMeta>;
  idCol: ColumnMeta;
  xCol: ColumnMeta;
  yCol: ColumnMeta;
  labelCol?: ColumnMeta;
  categoryCol?: ColumnMeta;
  geomCol?: ColumnMeta;
  geomSrid: number;
  searchCols: ColumnMeta[];
  crs: CrsHandle;
  /** "schema"."tabela" já com quote */
  table: string;
  /** Expressões float8 das coordenadas */
  xExpr: string;
  yExpr: string;
  /** Condição que exclui coordenadas nulas/fora da faixa válida do CRS */
  validCoordSql: (params: Params) => string;
  /** Lista de SELECT com todas as colunas legíveis pelo Prisma */
  selectAll: string;
}

type SourceInput = Omit<SourceConfigDto, 'name'> & { name?: string };

@Injectable()
export class SourcesService {
  private readonly ctxCache = new Map<string, { at: number; ctx: SourceContext }>();
  private static readonly TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly crs: CrsService,
  ) {}

  list() {
    return this.prisma.dataSource.findMany({ orderBy: { name: 'asc' } });
  }

  async get(id: string) {
    const s = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Fonte de dados não encontrada');
    return s;
  }

  async create(dto: SourceConfigDto, userId: string) {
    await this.buildContext(this.toSourceShape(dto));
    const info = await this.catalog.info();
    const created = await this.prisma.dataSource.create({
      data: {
        ...this.clean(dto),
        name: dto.name,
        schema: dto.schema,
        tableName: dto.tableName,
        idColumn: dto.idColumn,
        xColumn: dto.xColumn,
        yColumn: dto.yColumn,
        coordinateSystem: dto.coordinateSystem,
        database: info.database,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'CREATE',
        entity: 'DataSource',
        entityId: created.id,
        sourceId: created.id,
        newValue: created as object,
      },
    });
    return created;
  }

  async update(id: string, dto: UpdateSourceDto, userId: string) {
    const current = await this.get(id);
    const merged = { ...current, ...this.clean(dto) };
    await this.buildContext(merged as DataSource);
    const updated = await this.prisma.dataSource.update({ where: { id }, data: this.clean(dto) });
    this.ctxCache.delete(id);
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE',
        entity: 'DataSource',
        entityId: id,
        sourceId: id,
        oldValue: current as object,
        newValue: updated as object,
      },
    });
    return updated;
  }

  async remove(id: string, userId: string) {
    const current = await this.get(id);
    await this.prisma.dataSource.delete({ where: { id } });
    this.ctxCache.delete(id);
    await this.prisma.auditLog.create({
      data: { userId, action: 'DELETE', entity: 'DataSource', entityId: id, oldValue: current as object },
    });
    return { deleted: true };
  }

  /** Contexto (com cache) de uma fonte salva. */
  async context(id: string, fresh = false): Promise<SourceContext> {
    const cached = this.ctxCache.get(id);
    if (!fresh && cached && Date.now() - cached.at < SourcesService.TTL_MS) return cached.ctx;
    const source = await this.get(id);
    const ctx = await this.buildContext(source, fresh);
    this.ctxCache.set(id, { at: Date.now(), ctx });
    return ctx;
  }

  /** Valida a configuração contra o catálogo e monta o contexto de consulta. */
  async buildContext(source: DataSource, fresh = false): Promise<SourceContext> {
    if (!(await this.catalog.tableExists(source.schema, source.tableName))) {
      throw new BadRequestException(`Tabela ${source.schema}.${source.tableName} não existe`);
    }
    const columns = await this.catalog.getColumns(source.schema, source.tableName, fresh);
    const colMap = new Map(columns.map((c) => [c.name, c]));
    const need = (name: string | null | undefined, label: string): ColumnMeta => {
      const c = name ? colMap.get(name) : undefined;
      if (!c) throw new BadRequestException(`Coluna ${label} "${name ?? ''}" não existe na tabela`);
      return c;
    };
    const optional = (name: string | null | undefined, label: string) =>
      name ? need(name, label) : undefined;

    const idCol = need(source.idColumn, 'ID');
    const xCol = need(source.xColumn, 'X');
    const yCol = need(source.yColumn, 'Y');
    for (const c of [xCol, yCol]) {
      if (!c.isNumeric && c.kind !== 'text') {
        throw new BadRequestException(`Coluna de coordenada "${c.name}" deve ser numérica (ou texto numérico)`);
      }
    }
    if (idCol.kind === 'geometry' || idCol.kind === 'json') {
      throw new BadRequestException('Coluna ID não pode ser geométrica/JSON');
    }
    const geomCol = optional(source.geometryColumn, 'geometria');
    if (geomCol && geomCol.kind !== 'geometry') {
      throw new BadRequestException(`Coluna "${geomCol.name}" não é geométrica`);
    }
    const crs = this.crs.resolve(source.coordinateSystem, source.proj4);
    const xExpr = coordExpr(xCol);
    const yExpr = coordExpr(yCol);
    const r = crs.validRange;

    return {
      source,
      columns,
      colMap,
      idCol,
      xCol,
      yCol,
      labelCol: optional(source.labelColumn, 'rótulo'),
      categoryCol: optional(source.categoryColumn, 'categoria'),
      geomCol,
      geomSrid: geomCol ? await this.catalog.geometrySrid(source.schema, source.tableName, geomCol.name) : 0,
      searchCols: (source.searchColumns ?? []).map((n) => need(n, 'de busca')),
      crs,
      table: qualified(source.schema, source.tableName),
      xExpr,
      yExpr,
      validCoordSql: (params) =>
        `${xExpr} BETWEEN CAST(${params.add(String(r.minX))} AS float8) AND CAST(${params.add(String(r.maxX))} AS float8)
         AND ${yExpr} BETWEEN CAST(${params.add(String(r.minY))} AS float8) AND CAST(${params.add(String(r.maxY))} AS float8)`,
      selectAll: columns.map((c) => selectExpr(c)).join(', '),
    };
  }

  /** Esquema da tabela da fonte (colunas e papéis). */
  async schema(id: string) {
    const ctx = await this.context(id, true);
    return {
      source: ctx.source,
      crs: ctx.crs.def,
      columns: ctx.columns,
    };
  }

  /** Testa uma configuração (salva ou não) e devolve diagnóstico. */
  async test(input: SourceInput) {
    const ctx = await this.buildContext(this.toSourceShape(input));
    const params = new Params();
    const valid = ctx.validCoordSql(params);
    const [stats] = await this.prisma.$queryRawUnsafe<
      {
        total: number;
        valid: number;
        minX: number | null;
        maxX: number | null;
        minY: number | null;
        maxY: number | null;
      }[]
    >(
      `SELECT count(*)::float8 AS total,
              count(*) FILTER (WHERE ${valid})::float8 AS valid,
              min(${ctx.xExpr}) FILTER (WHERE ${valid}) AS "minX",
              max(${ctx.xExpr}) FILTER (WHERE ${valid}) AS "maxX",
              min(${ctx.yExpr}) FILTER (WHERE ${valid}) AS "minY",
              max(${ctx.yExpr}) FILTER (WHERE ${valid}) AS "maxY"
         FROM ${ctx.table}`,
      ...params.values,
    );
    const [ids] = await this.prisma.$queryRawUnsafe<{ distinctIds: number; nullIds: number }[]>(
      `SELECT count(DISTINCT ${qi(ctx.idCol.name)})::float8 AS "distinctIds",
              count(*) FILTER (WHERE ${qi(ctx.idCol.name)} IS NULL)::float8 AS "nullIds"
         FROM ${ctx.table}`,
    );
    const preview = await this.previewRows(ctx, 10);
    const indexes = await this.coordinateIndexStatus(ctx);

    const warnings: string[] = [];
    if (stats.total === 0) warnings.push('A tabela está vazia.');
    if (stats.total > 0 && stats.valid === 0) {
      warnings.push('Nenhuma coordenada válida para o sistema escolhido. Verifique colunas X/Y e o EPSG.');
    } else if (stats.valid < stats.total) {
      warnings.push(`${stats.total - stats.valid} registro(s) com coordenada vazia ou fora da faixa do CRS serão ignorados no mapa.`);
    }
    if (ids.nullIds > 0 || ids.distinctIds < stats.total) {
      warnings.push(
        `A coluna ID "${ctx.idCol.name}" não é única (${ids.distinctIds} valores distintos para ${stats.total} registros). Edição/exclusão podem afetar mais de um registro.`,
      );
    }
    if (!indexes.hasIndex && stats.total > 50_000) {
      warnings.push('Tabela grande sem índice nas coordenadas: crie índices para melhorar o desempenho.');
    }

    const extent =
      stats.minX !== null && stats.maxX !== null && stats.minY !== null && stats.maxY !== null
        ? this.extentToLatLng(ctx, stats.minX, stats.maxX, stats.minY, stats.maxY)
        : null;

    return {
      ok: stats.valid > 0,
      crs: ctx.crs.def,
      total: stats.total,
      validCoordinates: stats.valid,
      distinctIds: ids.distinctIds,
      extent,
      indexes,
      warnings,
      preview,
    };
  }

  async preview(id: string, limit = 20) {
    const ctx = await this.context(id);
    return this.previewRows(ctx, limit);
  }

  private async previewRows(ctx: SourceContext, limit: number) {
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${ctx.selectAll}, ${ctx.xExpr} AS "__x", ${ctx.yExpr} AS "__y"
         FROM ${ctx.table} LIMIT ${Math.min(Math.max(1, Math.floor(limit)), 200)}`,
    );
    return rows.map((row) => {
      const { __x, __y, ...data } = row as { __x: number | null; __y: number | null };
      const ll = __x !== null && __y !== null ? ctx.crs.toLatLng(__x, __y) : null;
      return { x: __x, y: __y, lat: ll?.lat ?? null, lng: ll?.lng ?? null, data: normalizeRow(data, ctx.colMap) };
    });
  }

  extentToLatLng(ctx: SourceContext, minX: number, maxX: number, minY: number, maxY: number) {
    const corners = [
      ctx.crs.toLatLng(minX, minY),
      ctx.crs.toLatLng(minX, maxY),
      ctx.crs.toLatLng(maxX, minY),
      ctx.crs.toLatLng(maxX, maxY),
    ].filter((c): c is { lat: number; lng: number } => c !== null);
    if (!corners.length) return null;
    return {
      minLat: Math.min(...corners.map((c) => c.lat)),
      maxLat: Math.max(...corners.map((c) => c.lat)),
      minLng: Math.min(...corners.map((c) => c.lng)),
      maxLng: Math.max(...corners.map((c) => c.lng)),
    };
  }

  /** Verifica se existe índice começando pela coluna X (ou pela expressão de X). */
  async coordinateIndexStatus(ctx: SourceContext) {
    const rows = await this.prisma.$queryRawUnsafe<{ name: string; def: string }[]>(
      `SELECT i.relname::text AS name, pg_get_indexdef(i.oid)::text AS def
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = $2`,
      ctx.source.schema,
      ctx.source.tableName,
    );
    const xq = qi(ctx.xCol.name);
    const xPlain = ctx.xCol.name;
    const hasIndex = rows.some((r) => {
      const cols = /\((.*)\)/.exec(r.def)?.[1] ?? '';
      return cols.startsWith(xq) || cols.startsWith(xPlain) || cols.includes(`btrim((${xq}`);
    });
    const idq = qi(ctx.idCol.name);
    const hasIdIndex = rows.some((r) => {
      const cols = /\((.*)\)/.exec(r.def)?.[1] ?? '';
      return cols === idq || cols === ctx.idCol.name;
    });
    return { hasIndex, hasIdIndex, indexes: rows };
  }

  /** Cria índices em (X, Y) e no ID para acelerar as consultas por região. */
  async createIndexes(id: string, userId: string) {
    const ctx = await this.context(id);
    const status = await this.coordinateIndexStatus(ctx);
    const hash = createHash('md5').update(`${ctx.source.schema}.${ctx.source.tableName}`).digest('hex').slice(0, 10);
    const created: string[] = [];
    if (!status.hasIndex) {
      const name = `gis_${hash}_xy_idx`;
      const xPart = ctx.xCol.isNumeric ? qi(ctx.xCol.name) : `(${ctx.xExpr})`;
      const yPart = ctx.yCol.isNumeric ? qi(ctx.yCol.name) : `(${ctx.yExpr})`;
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ${qi(name)} ON ${ctx.table} (${xPart}, ${yPart})`,
      );
      created.push(name);
    }
    if (!status.hasIdIndex) {
      const name = `gis_${hash}_id_idx`;
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS ${qi(name)} ON ${ctx.table} (${qi(ctx.idCol.name)})`,
      );
      created.push(name);
    }
    if (created.length) {
      await this.prisma.$executeRawUnsafe(`ANALYZE ${ctx.table}`);
      await this.prisma.auditLog.create({
        data: { userId, action: 'CREATE_INDEX', entity: 'DataSource', entityId: id, sourceId: id, newValue: created },
      });
    }
    return { created };
  }

  /** Valores distintos de uma coluna (para montar filtros). */
  async distinct(id: string, column: string, search?: string, limit = 100) {
    const ctx = await this.context(id);
    const col = ctx.colMap.get(column);
    if (!col) throw new BadRequestException(`Coluna desconhecida: ${column}`);
    if (col.kind === 'geometry') throw new BadRequestException('Coluna geométrica não suportada');
    const params = new Params();
    const where = search ? `WHERE ${qi(col.name)}::text ILIKE ${params.add(`%${search}%`)}` : '';
    const rows = await this.prisma.$queryRawUnsafe<{ value: string | null; count: number }[]>(
      `SELECT ${qi(col.name)}::text AS value, count(*)::float8 AS count
         FROM ${ctx.table} ${where}
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${Math.min(Math.max(limit, 1), 500)}`,
      ...params.values,
    );
    return rows;
  }

  private clean(dto: Partial<SourceConfigDto>) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v === undefined) continue;
      out[k] = v === '' ? null : v;
    }
    return out as Partial<DataSource>;
  }

  private toSourceShape(input: SourceInput): DataSource {
    return {
      id: 'test',
      name: input.name ?? 'teste',
      database: '',
      schema: input.schema,
      tableName: input.tableName,
      idColumn: input.idColumn,
      xColumn: input.xColumn,
      yColumn: input.yColumn,
      coordinateSystem: input.coordinateSystem,
      proj4: input.proj4 || null,
      labelColumn: input.labelColumn || null,
      categoryColumn: input.categoryColumn || null,
      geometryColumn: input.geometryColumn || null,
      searchColumns: input.searchColumns ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
