import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ChangesService } from '../changes/changes.service';
import { SourceContext, SourcesService } from '../tables/sources.service';
import { FilterDef, buildFilterConditions } from '../../common/filters';
import { LatLng, LatLngBounds, coordKey, inBounds } from '../../common/geo';
import { labelSql } from '../../common/label-expr';
import { MAX_IDS } from './dto/points.dto';
import { coerceFor } from './copy.logic';
import {
  ColumnMeta,
  Params,
  castType,
  coordEquals,
  coordRange,
  getPostgisSchema,
  normalizeRow,
  normalizeValue,
  pgis,
  qi,
  selectExpr,
  toParam,
} from '../../common/sql';

export interface PointRecord {
  id: string;
  x: number | null;
  y: number | null;
  lat: number | null;
  lng: number | null;
  data: Record<string, unknown>;
}

export interface MapGroup {
  key: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
  count: number;
  ids: string[] | null;
  label: string | null;
  /** Rótulos de cada registro (mesma ordem de `ids`) quando há 2 a INLINE_IDS registros */
  labels?: (string | null)[] | null;
  category: string | null;
}

export interface MapCluster {
  lat: number;
  lng: number;
  count: number;
  bounds: LatLngBounds | null;
}

/** Estilo/rótulo pedidos pelo mapa: coluna de categoria e expressão de rótulo (sintaxe QGIS). */
export interface MapStyleOptions {
  styleColumn?: string;
  label?: string;
}

/** Camada completa em formato colunar (compacto) para cache no navegador. */
export type LayerResponse =
  | {
      mode: 'full';
      version: string | null;
      total: number;
      ids: string[];
      x: number[];
      y: number[];
      lat: number[];
      lng: number[];
      /** Valores distintos da coluna de estilo; `cat[i]` é o índice do registro i nesta lista */
      cats: (string | null)[] | null;
      cat: number[] | null;
      labels: (string | null)[] | null;
    }
  | { mode: 'tooLarge'; version: string | null; total: number; limit: number }
  | { mode: 'unchanged'; version: string };

/** Ações de pontos que o Ctrl+Z desfaz (cada transação do banco = uma operação). */
const UNDOABLE = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'BULK_UPDATE',
  'MOVE',
  'DUPLICATE',
  'BULK_DELETE',
];
const ACTION_LABELS: Record<string, string> = {
  CREATE: 'adição',
  UPDATE: 'edição',
  DELETE: 'exclusão',
  RESTORE: 'restauração',
  BULK_UPDATE: 'edição em massa',
  MOVE: 'movimento',
  DUPLICATE: 'duplicação',
  BULK_DELETE: 'exclusão em massa',
};

/** Última operação que o Ctrl+Z desfaz. */
export interface UndoInfo {
  /** Transação do banco que gravou a operação */
  txId: string;
  at: Date;
  /** Registros afetados */
  total: number;
  parts: { sourceId: string; sourceName: string; action: string; label: string; count: number }[];
}

/** Grupos com até este número de registros já trazem os IDs no mapa. */
const INLINE_IDS = 50;
const DEFAULT_MAP_LIMIT = 3000;
const CLUSTER_GRID = 28;
/** Acima disso a camada é carregada por viewport (clusters) em vez de inteira. */
const LAYER_MAX_POINTS = Number(process.env.LAYER_MAX_POINTS) || 300_000;
const round7 = (n: number) => Math.round(n * 1e7) / 1e7;

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class PointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly audit: AuditService,
    private readonly changes: ChangesService,
  ) {}

  // ---------------------------------------------------------------- helpers

  /** WHERE com coordenadas válidas + filtros dinâmicos + condições extras. */
  where(
    ctx: SourceContext,
    params: Params,
    filters: FilterDef[] = [],
    extra: string[] = [],
  ): string {
    const conds = [
      ...extra,
      ctx.validCoordSql(params),
      ...buildFilterConditions(filters, ctx.colMap, params),
    ];
    return conds.length ? `WHERE ${conds.map((c) => `(${c})`).join(' AND ')}` : '';
  }

  idEquals(ctx: SourceContext, params: Params, id: string): string {
    return `${qi(ctx.idCol.name)} = CAST(${params.add(id)} AS ${castType(ctx.idCol)})`;
  }

  idIn(ctx: SourceContext, params: Params, ids: string[]): string {
    return `${qi(ctx.idCol.name)} = ANY(CAST(${params.add(ids)} AS ${castType(ctx.idCol)}[]))`;
  }

  private entity(ctx: SourceContext) {
    return `${ctx.source.schema}.${ctx.source.tableName}`;
  }

  private toRecord(ctx: SourceContext, row: Record<string, unknown>): PointRecord {
    const { __id, __x, __y, ...data } = row as {
      __id: unknown;
      __x: number | null;
      __y: number | null;
    };
    const ll = __x !== null && __y !== null ? ctx.crs.toLatLng(__x, __y) : null;
    return {
      id: String(normalizeValue(__id) ?? ''),
      x: __x,
      y: __y,
      lat: ll?.lat ?? null,
      lng: ll?.lng ?? null,
      data: normalizeRow(data, ctx.colMap),
    };
  }

  /**
   * Triggers das tabelas do usuário costumam chamar funções PostGIS sem schema (ex.: ST_MakePoint), mas a
   * conexão usa search_path=gis_app. Na transação de escrita, inclui o schema da tabela e o do PostGIS.
   */
  private async writePath(ctx: SourceContext, tx: Prisma.TransactionClient) {
    const extra = [
      ...new Set([ctx.source.schema, getPostgisSchema()].filter((s): s is string => !!s)),
    ];
    await tx.$queryRawUnsafe(
      `SELECT set_config('search_path', current_setting('search_path') || ', ' || $1, true)`,
      extra.map(qi).join(', '),
    );
  }

  private fullSelect(ctx: SourceContext) {
    return `${ctx.selectAll}, ${qi(ctx.idCol.name)}::text AS "__id", ${ctx.xExpr} AS "__x", ${ctx.yExpr} AS "__y"`;
  }

  /** Coluna (validada no catálogo) como texto, para estilo por categoria. */
  private columnText(ctx: SourceContext, name?: string): string | null {
    if (!name) return null;
    const col = ctx.colMap.get(name);
    if (!col) throw new BadRequestException(`Coluna desconhecida: ${name}`);
    if (col.kind === 'geometry')
      throw new BadRequestException('Coluna geométrica não pode ser usada no estilo');
    return `${qi(col.name)}::text`;
  }

  /**
   * Versão barata dos dados (contadores de insert/update/delete do PostgreSQL + configuração da fonte).
   * O navegador guarda a camada em cache e só baixa de novo quando a versão muda.
   */
  private async dataVersion(ctx: SourceContext): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ v: string }[]>(
        `SELECT concat_ws(':', relid, n_tup_ins, n_tup_upd, n_tup_del) AS v
           FROM pg_catalog.pg_stat_all_tables WHERE schemaname = $1 AND relname = $2`,
        ctx.source.schema,
        ctx.source.tableName,
      );
      return rows[0] ? `${rows[0].v}:${new Date(ctx.source.updatedAt).getTime()}` : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- leitura

  /**
   * Camada inteira: só ID, posição, categoria e rótulo de cada ponto (os demais campos são
   * buscados ao abrir o registro). Responde "unchanged" se a versão do cache do cliente ainda vale.
   */
  async layer(
    sourceId: string,
    filters: FilterDef[],
    opts: MapStyleOptions & { version?: string },
  ): Promise<LayerResponse> {
    const ctx = await this.sources.context(sourceId);
    const version = await this.dataVersion(ctx);
    if (opts.version && version && opts.version === version) return { mode: 'unchanged', version };

    const params = new Params();
    const cat = this.columnText(ctx, opts.styleColumn);
    const label = labelSql(opts.label, ctx.colMap, params);
    const where = this.where(ctx, params, filters);

    const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM (SELECT 1 FROM ${ctx.table} ${where} LIMIT ${LAYER_MAX_POINTS + 1}) s`,
      ...params.values,
    );
    if (n > LAYER_MAX_POINTS)
      return { mode: 'tooLarge', version, total: n, limit: LAYER_MAX_POINTS };

    const rows = await this.prisma.$queryRawUnsafe<
      { id: string; x: number; y: number; c?: string | null; l?: string | null }[]
    >(
      `SELECT ${qi(ctx.idCol.name)}::text AS id, ${ctx.xExpr} AS x, ${ctx.yExpr} AS y
              ${cat ? `, ${cat} AS c` : ''}${label ? `, ${label} AS l` : ''}
         FROM ${ctx.table} ${where}
        ORDER BY ${qi(ctx.idCol.name)}`,
      ...params.values,
    );

    const out = {
      ids: [] as string[],
      x: [] as number[],
      y: [] as number[],
      lat: [] as number[],
      lng: [] as number[],
      cat: cat ? ([] as number[]) : null,
      labels: label ? ([] as (string | null)[]) : null,
    };
    const catIndex = new Map<string | null, number>();
    const cats: (string | null)[] = [];
    for (const r of rows) {
      const ll = ctx.crs.toLatLng(r.x, r.y);
      if (!ll) continue;
      out.ids.push(r.id);
      out.x.push(r.x);
      out.y.push(r.y);
      out.lat.push(round7(ll.lat));
      out.lng.push(round7(ll.lng));
      if (out.cat) {
        const v = r.c ?? null;
        let i = catIndex.get(v);
        if (i === undefined) {
          i = cats.length;
          catIndex.set(v, i);
          cats.push(v);
        }
        out.cat.push(i);
      }
      if (out.labels) out.labels.push(r.l ?? null);
    }
    return { mode: 'full', version, total: out.ids.length, ...out, cats: cat ? cats : null };
  }

  /** Primeiros rótulos gerados por uma expressão (prévia "O texto ficará assim"). */
  async labelPreview(sourceId: string, expression: string, limit = 5) {
    const ctx = await this.sources.context(sourceId);
    const params = new Params();
    const label = labelSql(expression, ctx.colMap, params);
    if (!label) return [];
    return this.prisma.$queryRawUnsafe<{ id: string; label: string | null }[]>(
      `SELECT ${qi(ctx.idCol.name)}::text AS id, ${label} AS label
         FROM ${ctx.table} ORDER BY ${qi(ctx.idCol.name)} LIMIT ${Math.min(Math.max(limit, 1), 20)}`,
      ...params.values,
    );
  }

  /** Pontos do viewport agrupados por coordenada; vira clusters quando há pontos demais. */
  async mapPoints(
    sourceId: string,
    bounds: LatLngBounds,
    filters: FilterDef[],
    limit = DEFAULT_MAP_LIMIT,
    style: MapStyleOptions = {},
  ) {
    const ctx = await this.sources.context(sourceId);
    const xy = ctx.crs.boundsToXY(bounds);
    if (!xy || xy.minX > xy.maxX || xy.minY > xy.maxY) {
      return { mode: 'points' as const, total: 0, groups: [], clusters: [], truncated: false };
    }

    const base = () => {
      const params = new Params();
      const where = this.where(ctx, params, filters, [
        coordRange(ctx.xCol, params, xy.minX, xy.maxX),
        coordRange(ctx.yCol, params, xy.minY, xy.maxY),
      ]);
      return { params, where };
    };

    // Estimativa barata: se houver muitas linhas no retângulo, vai direto para clusters.
    const cap = limit * 4;
    {
      const { params, where } = base();
      const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM (SELECT 1 FROM ${ctx.table} ${where} LIMIT ${cap + 1}) s`,
        ...params.values,
      );
      if (n <= cap) {
        const groups = await this.groupQuery(ctx, base(), limit, style);
        if (groups.length <= limit) {
          const visible = groups.filter((g) => inBounds(g, bounds));
          return {
            mode: 'points' as const,
            total: visible.reduce((s, g) => s + g.count, 0),
            groups: visible,
            clusters: [],
            truncated: false,
          };
        }
      }
    }

    const clusters = await this.clusterQuery(ctx, base(), xy);
    return {
      mode: 'clusters' as const,
      total: clusters.reduce((s, c) => s + c.count, 0),
      groups: [],
      clusters,
      truncated: true,
    };
  }

  private async groupQuery(
    ctx: SourceContext,
    q: { params: Params; where: string },
    limit: number,
    style: MapStyleOptions = {},
  ) {
    const id = qi(ctx.idCol.name);
    // Sem expressão: coluna de rótulo (ou ID); expressão que não gera nada (ex.: só "||"): sem rótulo.
    const label =
      labelSql(style.label, ctx.colMap, q.params) ??
      (style.label?.trim()
        ? 'NULL::text'
        : ctx.labelCol
          ? `${qi(ctx.labelCol.name)}::text`
          : `${id}::text`);
    const cat =
      style.styleColumn !== undefined
        ? (this.columnText(ctx, style.styleColumn) ?? 'NULL::text')
        : ctx.categoryCol
          ? `${qi(ctx.categoryCol.name)}::text`
          : 'NULL::text';
    const rows = await this.prisma.$queryRawUnsafe<
      {
        x: number;
        y: number;
        count: number;
        ids: string[] | null;
        label: string | null;
        labels: (string | null)[] | null;
        category: string | null;
      }[]
    >(
      `SELECT x, y, count(*)::int AS count,
              CASE WHEN count(*) <= ${INLINE_IDS} THEN array_agg(id ORDER BY id) END AS ids,
              CASE WHEN count(*) = 1 THEN min(label) END AS label,
              CASE WHEN count(*) > 1 AND count(*) <= ${INLINE_IDS} THEN array_agg(label ORDER BY id) END AS labels,
              CASE WHEN min(cat) = max(cat) THEN min(cat) END AS category
         FROM (SELECT ${ctx.xExpr} AS x, ${ctx.yExpr} AS y, ${id}::text AS id, ${label} AS label, ${cat} AS cat
                 FROM ${ctx.table} ${q.where}) s
        GROUP BY x, y
        LIMIT ${limit + 1}`,
      ...q.params.values,
    );
    const groups: MapGroup[] = [];
    for (const r of rows) {
      const ll = ctx.crs.toLatLng(r.x, r.y);
      if (!ll) continue;
      groups.push({
        key: coordKey(r.x, r.y),
        x: r.x,
        y: r.y,
        ...ll,
        count: r.count,
        ids: r.ids,
        label: r.label,
        labels: r.labels,
        category: r.category,
      });
    }
    return groups;
  }

  private async clusterQuery(
    ctx: SourceContext,
    q: { params: Params; where: string },
    xy: { minX: number; maxX: number; minY: number; maxY: number },
  ): Promise<MapCluster[]> {
    const cell = Math.max(xy.maxX - xy.minX, xy.maxY - xy.minY) / CLUSTER_GRID || 1;
    const p = q.params;
    const minX = p.add(String(xy.minX));
    const minY = p.add(String(xy.minY));
    const c = p.add(String(cell));
    const rows = await this.prisma.$queryRawUnsafe<
      {
        count: number;
        x: number;
        y: number;
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
      }[]
    >(
      `SELECT count(*)::float8 AS count, avg(x) AS x, avg(y) AS y,
              min(x) AS "minX", max(x) AS "maxX", min(y) AS "minY", max(y) AS "maxY"
         FROM (SELECT ${ctx.xExpr} AS x, ${ctx.yExpr} AS y FROM ${ctx.table} ${q.where}) s
        GROUP BY floor((x - CAST(${minX} AS float8)) / CAST(${c} AS float8)),
                 floor((y - CAST(${minY} AS float8)) / CAST(${c} AS float8))`,
      ...p.values,
    );
    const out: MapCluster[] = [];
    for (const r of rows) {
      const ll = ctx.crs.toLatLng(r.x, r.y);
      if (!ll) continue;
      out.push({
        ...ll,
        count: r.count,
        bounds: this.sources.extentToLatLng(ctx, r.minX, r.maxX, r.minY, r.maxY),
      });
    }
    return out;
  }

  /** Extensão (bounds lat/lng) dos pontos válidos, para o zoom inicial. */
  async extent(sourceId: string, filters: FilterDef[]) {
    const ctx = await this.sources.context(sourceId);
    const params = new Params();
    const where = this.where(ctx, params, filters);
    const [r] = await this.prisma.$queryRawUnsafe<
      {
        count: number;
        minX: number | null;
        maxX: number | null;
        minY: number | null;
        maxY: number | null;
      }[]
    >(
      `SELECT count(*)::float8 AS count, min(${ctx.xExpr}) AS "minX", max(${ctx.xExpr}) AS "maxX",
              min(${ctx.yExpr}) AS "minY", max(${ctx.yExpr}) AS "maxY"
         FROM ${ctx.table} ${where}`,
      ...params.values,
    );
    const bounds =
      r.minX !== null && r.maxX !== null && r.minY !== null && r.maxY !== null
        ? this.sources.extentToLatLng(ctx, r.minX, r.maxX, r.minY, r.maxY)
        : null;
    return { count: r.count, bounds };
  }

  /** Lista paginada de registros (com filtros). */
  async list(sourceId: string, filters: FilterDef[], page = 1, pageSize = 50) {
    const ctx = await this.sources.context(sourceId);
    const params = new Params();
    const conds = buildFilterConditions(filters, ctx.colMap, params);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [{ total }] = await this.prisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT count(*)::float8 AS total FROM ${ctx.table} ${where}`,
      ...params.values,
    );
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${this.fullSelect(ctx)} FROM ${ctx.table} ${where}
        ORDER BY ${qi(ctx.idCol.name)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      ...params.values,
    );
    return { total, page, pageSize, items: rows.map((r) => this.toRecord(ctx, r)) };
  }

  /** Todos os registros em uma coordenada exata (pontos sobrepostos). */
  async at(sourceId: string, x: number, y: number, filters: FilterDef[], idsOnly = false) {
    const ctx = await this.sources.context(sourceId);
    const params = new Params();
    const where = this.where(ctx, params, filters, [
      coordEquals(ctx.xCol, params, x),
      coordEquals(ctx.yCol, params, y),
    ]);
    const ll = ctx.crs.toLatLng(x, y);
    if (idsOnly) {
      const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT ${qi(ctx.idCol.name)}::text AS id FROM ${ctx.table} ${where}
          ORDER BY ${qi(ctx.idCol.name)} LIMIT 20000`,
        ...params.values,
      );
      return {
        key: coordKey(x, y),
        x,
        y,
        lat: ll?.lat ?? null,
        lng: ll?.lng ?? null,
        count: rows.length,
        ids: rows.map((r) => r.id),
        records: [],
      };
    }
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${this.fullSelect(ctx)} FROM ${ctx.table} ${where} ORDER BY ${qi(ctx.idCol.name)} LIMIT 1000`,
      ...params.values,
    );
    const records = rows.map((r) => this.toRecord(ctx, r));
    return {
      key: coordKey(x, y),
      x,
      y,
      lat: ll?.lat ?? null,
      lng: ll?.lng ?? null,
      count: records.length,
      ids: records.map((r) => r.id),
      records,
    };
  }

  async findOne(sourceId: string, id: string, db: Db = this.prisma): Promise<PointRecord> {
    const ctx = await this.sources.context(sourceId);
    const params = new Params();
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${this.fullSelect(ctx)} FROM ${ctx.table} WHERE ${this.idEquals(ctx, params, id)} LIMIT 1`,
      ...params.values,
    );
    if (!rows.length) throw new NotFoundException(`Registro ${id} não encontrado`);
    return this.toRecord(ctx, rows[0]);
  }

  /** Registros por lista de IDs (lista virtualizada do painel). */
  async records(sourceId: string, ids: string[], full = false) {
    if (!ids.length) return [];
    const ctx = await this.sources.context(sourceId);
    const params = new Params();
    const id = qi(ctx.idCol.name);
    const select = full
      ? this.fullSelect(ctx)
      : [
          `${id}::text AS "__id"`,
          `${ctx.xExpr} AS "__x"`,
          `${ctx.yExpr} AS "__y"`,
          ctx.labelCol ? `${qi(ctx.labelCol.name)}::text AS "label"` : null,
          ctx.categoryCol ? `${qi(ctx.categoryCol.name)}::text AS "category"` : null,
        ]
          .filter(Boolean)
          .join(', ');
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${select} FROM ${ctx.table} WHERE ${this.idIn(ctx, params, ids)} ORDER BY ${id}`,
      ...params.values,
    );
    return rows.map((r) => this.toRecord(ctx, r));
  }

  /** Busca textual por ID, rótulo e colunas configuradas. */
  async search(sourceId: string, q: string) {
    const term = q.trim();
    if (!term) return [];
    const ctx = await this.sources.context(sourceId);
    const params = new Params();
    const id = qi(ctx.idCol.name);
    const exact = params.add(term);
    const like = params.add(`%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    const cols = [ctx.labelCol, ...ctx.searchCols].filter(
      (c): c is ColumnMeta => !!c && c.kind !== 'geometry',
    );
    const unique = [...new Map(cols.map((c) => [c.name, c])).values()];
    const conds = [
      `${id}::text = ${exact}`,
      ...unique.map((c) => `${qi(c.name)}::text ILIKE ${like}`),
    ];
    const label = ctx.labelCol ? `${qi(ctx.labelCol.name)}::text` : `${id}::text`;
    const valid = ctx.validCoordSql(params);
    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: string;
        label: string | null;
        x: number;
        y: number;
        exact: boolean;
        matches: Record<string, string | null>;
      }[]
    >(
      `SELECT ${id}::text AS id, ${label} AS label, ${ctx.xExpr} AS x, ${ctx.yExpr} AS y,
              (${id}::text = ${exact}) AS exact,
              jsonb_build_object(${unique.map((c, i) => `'c${i}', ${qi(c.name)}::text`).join(', ') || "'_', NULL"}) AS matches
         FROM ${ctx.table}
        WHERE (${conds.join(' OR ')}) AND (${valid})
        ORDER BY exact DESC, ${id}
        LIMIT 20`,
      ...params.values,
    );
    return rows.map((r) => {
      const ll = ctx.crs.toLatLng(r.x, r.y);
      const matched = unique
        .map((c, i) => ({ column: c.name, value: r.matches?.[`c${i}`] ?? null }))
        .find((m) => m.value?.toLowerCase().includes(term.toLowerCase()));
      return {
        id: r.id,
        label: r.label,
        x: r.x,
        y: r.y,
        key: coordKey(r.x, r.y),
        lat: ll?.lat ?? null,
        lng: ll?.lng ?? null,
        match: r.exact ? { column: ctx.idCol.name, value: r.id } : (matched ?? null),
      };
    });
  }

  /**
   * Modo lista: localiza os registros de cada valor informado (na ordem recebida) em uma coluna.
   * Texto compara sem diferenciar maiúsculas/espaços nas pontas; colunas numéricas comparam o número.
   * Registros na mesma coordenada formam um único grupo (como na seleção).
   */
  async lookup(sourceId: string, column: string, values: string[]) {
    const ctx = await this.sources.context(sourceId);
    const col = ctx.colMap.get(column);
    if (!col) throw new BadRequestException(`Coluna desconhecida: ${column}`);
    if (col.kind === 'geometry')
      throw new BadRequestException('Coluna geométrica não pode ser usada no modo lista');

    const numeric = col.isNumeric;
    const norm = (v: string): string | null => {
      const t = v.trim();
      if (!t) return null;
      if (!numeric) return t.toLowerCase();
      const n = Number(t.replace(',', '.'));
      return Number.isFinite(n) ? String(n) : null;
    };
    const keys = [...new Set(values.map(norm).filter((k): k is string => k !== null))];

    const rows: { k: string; id: string; x: number; y: number }[] = [];
    if (keys.length) {
      const params = new Params();
      const c = qi(col.name);
      const match = numeric
        ? `${c}::float8 = ANY(CAST(${params.add(keys)} AS float8[]))`
        : `lower(btrim(${c}::text)) = ANY(CAST(${params.add(keys)} AS text[]))`;
      const where = this.where(ctx, params, [], [match]);
      const id = qi(ctx.idCol.name);
      rows.push(
        ...(await this.prisma.$queryRawUnsafe<{ k: string; id: string; x: number; y: number }[]>(
          `SELECT ${numeric ? `${c}::float8` : `lower(btrim(${c}::text))`} AS k, ${id}::text AS id,
                  ${ctx.xExpr} AS x, ${ctx.yExpr} AS y
             FROM ${ctx.table} ${where}
            ORDER BY ${id}
            LIMIT 50000`,
          ...params.values,
        )),
      );
    }

    type Group = { key: string; x: number; y: number; lat: number; lng: number; ids: string[] };
    const byValue = new Map<string, Map<string, Group>>();
    for (const r of rows) {
      const k = numeric ? String(Number(r.k)) : r.k;
      const key = coordKey(r.x, r.y);
      let groups = byValue.get(k);
      if (!groups) byValue.set(k, (groups = new Map()));
      let g = groups.get(key);
      if (!g) {
        const ll = ctx.crs.toLatLng(r.x, r.y);
        if (!ll) continue;
        groups.set(key, (g = { key, x: r.x, y: r.y, ...ll, ids: [] }));
      }
      g.ids.push(r.id);
    }

    // Uma entrada por valor informado, na mesma ordem (repetidos inclusive: listas comparativas são
    // pareadas por posição).
    const items: {
      value: string;
      groups: Group[];
      /** Não encontrado na tabela, mas removido (Tabela de Alterações): justificativa */
      removed?: { observation: string | null };
    }[] = values.map((v) => {
      const k = norm(v);
      return { value: v.trim(), groups: k === null ? [] : [...(byValue.get(k)?.values() ?? [])] };
    });

    // Lista de IDs: os não encontrados podem ter sido removidos (a Tabela de Alterações guarda o id).
    if (col.name === ctx.idCol.name) {
      const missing = items.filter((i) => !i.groups.length && i.value);
      const candidates = (v: string) => [...new Set([v, norm(v)].filter((x): x is string => !!x))];
      const removed = await this.changes.removed(ctx.source.id, [
        ...new Set(missing.flatMap((i) => candidates(i.value))),
      ]);
      for (const i of missing) {
        const hit = candidates(i.value).find((c) => removed.has(c));
        if (hit !== undefined) i.removed = { observation: removed.get(hit) ?? null };
      }
    }
    return { column: col.name, items };
  }

  /** Selecionar por valor: registros que atendem aos filtros, agrupados por coordenada, com a extensão. */
  async byFilters(sourceId: string, filters: FilterDef[]) {
    const MAX = 200_000;
    const ctx = await this.sources.context(sourceId);
    const params = new Params();
    const where = this.where(ctx, params, filters);
    const id = qi(ctx.idCol.name);
    const rows = await this.prisma.$queryRawUnsafe<{ x: number; y: number; ids: string[] }[]>(
      `SELECT x, y, array_agg(id ORDER BY id) AS ids
         FROM (SELECT ${ctx.xExpr} AS x, ${ctx.yExpr} AS y, ${id}::text AS id FROM ${ctx.table} ${where}
                LIMIT ${MAX + 1}) s
        GROUP BY x, y`,
      ...params.values,
    );
    const groups: { key: string; x: number; y: number; lat: number; lng: number; ids: string[] }[] =
      [];
    let count = 0;
    let truncated = false;
    let bounds: LatLngBounds | null = null;
    for (const r of rows) {
      const ll = ctx.crs.toLatLng(r.x, r.y);
      if (!ll) continue;
      if (count + r.ids.length > MAX) {
        truncated = true;
        break;
      }
      count += r.ids.length;
      groups.push({ key: coordKey(r.x, r.y), x: r.x, y: r.y, ...ll, ids: r.ids });
      bounds = bounds
        ? {
            minLat: Math.min(bounds.minLat, ll.lat),
            maxLat: Math.max(bounds.maxLat, ll.lat),
            minLng: Math.min(bounds.minLng, ll.lng),
            maxLng: Math.max(bounds.maxLng, ll.lng),
          }
        : { minLat: ll.lat, maxLat: ll.lat, minLng: ll.lng, maxLng: ll.lng };
    }
    return { count, truncated, bounds, groups };
  }

  /**
   * Resumo de um conjunto de IDs por uma coluna (padrão: a de categoria) ou pela combinação de várias,
   * com os valores concatenados por espaço (ex.: tipo_lampada + potencia → "ME 70").
   */
  async summary(sourceId: string, ids: string[], column?: string | string[]) {
    const ctx = await this.sources.context(sourceId);
    const names = Array.isArray(column)
      ? column
      : column
        ? [column]
        : ctx.categoryCol
          ? [ctx.categoryCol.name]
          : [];
    if (!names.length) return { total: ids.length, column: null, values: [] };
    const cols = names.map((n) => {
      const col = ctx.colMap.get(n);
      if (!col) throw new BadRequestException(`Coluna desconhecida: ${n}`);
      if (col.kind === 'geometry')
        throw new BadRequestException('Coluna geométrica não suportada no resumo');
      return col;
    });
    // concat_ws ignora nulos; tudo nulo vira NULL ("vazio").
    const expr =
      cols.length === 1
        ? `${qi(cols[0].name)}::text`
        : `NULLIF(concat_ws(' ', ${cols.map((c) => `${qi(c.name)}::text`).join(', ')}), '')`;
    const params = new Params();
    const rows = await this.prisma.$queryRawUnsafe<{ value: string | null; count: number }[]>(
      `SELECT ${expr} AS value, count(*)::float8 AS count
         FROM ${ctx.table} WHERE ${this.idIn(ctx, params, ids)}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
      ...params.values,
    );
    return { total: ids.length, column: cols.map((c) => c.name).join(' + '), values: rows };
  }

  // ---------------------------------------------------------------- escrita

  /** Converte o payload em pares coluna/expressão SQL, validando tipos e coordenadas. */
  private buildAssignments(
    ctx: SourceContext,
    params: Params,
    data: Record<string, unknown>,
    opts: { forInsert: boolean },
  ) {
    const assignments: { col: string; expr: string }[] = [];
    let newX: number | undefined;
    let newY: number | undefined;

    for (const [name, raw] of Object.entries(data)) {
      const col = ctx.colMap.get(name);
      if (!col) throw new BadRequestException(`Coluna desconhecida: ${name}`);
      if (col.readOnly) {
        if (col.kind === 'geometry' && col.name === ctx.geomCol?.name) continue;
        throw new BadRequestException(`Coluna "${name}" é somente leitura`);
      }
      if (col === ctx.idCol && opts.forInsert && (raw === '' || raw === null || raw === undefined))
        continue;

      if (col === ctx.xCol || col === ctx.yCol) {
        const n =
          typeof raw === 'number'
            ? raw
            : Number(
                String(raw ?? '')
                  .replace(',', '.')
                  .trim(),
              );
        if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) {
          throw new BadRequestException(`Coordenada "${name}" inválida`);
        }
        if (col === ctx.xCol) newX = n;
        else newY = n;
        assignments.push({ col: name, expr: `CAST(${params.add(String(n))} AS ${castType(col)})` });
        continue;
      }

      let value: unknown = raw;
      if (value === '' && col.kind !== 'text') value = null;
      if (typeof value === 'string' && col.kind === 'number') value = value.replace(',', '.');
      const p = toParam(value);
      assignments.push({
        col: name,
        expr: p === null ? 'NULL' : `CAST(${params.add(p)} AS ${castType(col)})`,
      });
    }
    return { assignments, newX, newY };
  }

  /**
   * Insere um registro (dentro da transação de escrita): ID automático quando não informado,
   * geometria sincronizada com X/Y e auditoria. A Tabela de Alterações fica com quem chama.
   */
  private async insertRecord(
    tx: Prisma.TransactionClient,
    ctx: SourceContext,
    data: Record<string, unknown>,
    userId: string,
  ): Promise<PointRecord> {
    const params = new Params();
    const { assignments, newX, newY } = this.buildAssignments(ctx, params, data, {
      forInsert: true,
    });
    this.validateCoords(ctx, newX!, newY!);

    // ID não informado: numérico continua a partir do maior da camada (max+1), mesmo com valor
    // automático; senão, o valor automático da coluna.
    const hasId = assignments.some((a) => a.col === ctx.idCol.name);
    const numericId =
      (ctx.idCol.kind === 'integer' || ctx.idCol.kind === 'number') && !ctx.idCol.isGenerated;
    const generateId = !hasId && numericId;
    if (!hasId && !numericId && !ctx.idCol.hasDefault) {
      throw new BadRequestException(`Informe o valor de "${ctx.idCol.name}"`);
    }
    if (generateId) {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, this.entity(ctx));
      const [{ next }] = await tx.$queryRawUnsafe<{ next: string }[]>(
        `SELECT (COALESCE(max(${qi(ctx.idCol.name)}), 0) + 1)::text AS next FROM ${ctx.table}`,
      );
      assignments.push({
        col: ctx.idCol.name,
        expr: `CAST(${params.add(next)} AS ${castType(ctx.idCol)})`,
      });
    }
    if (ctx.geomCol)
      assignments.push({
        col: ctx.geomCol.name,
        expr: this.geomExpr(ctx, params, newX!, newY!),
      });

    const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO ${ctx.table} (${assignments.map((a) => qi(a.col)).join(', ')}) ${generateId && ctx.idCol.isIdentity ? 'OVERRIDING SYSTEM VALUE' : ''}
       VALUES (${assignments.map((a) => a.expr).join(', ')})
       RETURNING ${qi(ctx.idCol.name)}::text AS id`,
      ...params.values,
    );
    if ((generateId || hasId) && numericId && ctx.idCol.hasDefault) {
      await this.syncIdSequence(tx, ctx);
    }
    const created = await this.findOne(ctx.source.id, row.id, tx);
    await this.audit.log(
      {
        userId,
        action: 'CREATE',
        entity: this.entity(ctx),
        entityId: created.id,
        sourceId: ctx.source.id,
        newValue: created.data,
      },
      tx,
    );
    return created;
  }

  private validateCoords(ctx: SourceContext, x: number, y: number) {
    if (!ctx.crs.isValid(x, y) || !ctx.crs.toLatLng(x, y)) {
      throw new BadRequestException(
        `Coordenada (${x}, ${y}) inválida para ${ctx.crs.def.name}. Verifique zona/hemisfério.`,
      );
    }
  }

  /**
   * Após gravar IDs explícitos numa coluna com sequência (serial/identity), avança a sequência até o
   * maior ID, para o próximo valor automático não repetir um existente. Sem sequência própria ou sem
   * permissão nela, não faz nada.
   */
  private async syncIdSequence(tx: Prisma.TransactionClient, ctx: SourceContext) {
    const id = qi(ctx.idCol.name);
    await tx.$queryRawUnsafe(
      `SELECT setval(s.seq::regclass, m.mx)
         FROM (SELECT pg_get_serial_sequence($1, $2) AS seq) s,
              (SELECT ceil(max(${id}))::bigint AS mx FROM ${ctx.table}) m
        WHERE s.seq IS NOT NULL AND m.mx IS NOT NULL
          AND has_sequence_privilege(s.seq, 'UPDATE')
          AND m.mx > COALESCE((SELECT p.last_value FROM pg_sequences p
                                WHERE format('%I.%I', p.schemaname, p.sequencename) = s.seq), 0)`,
      ctx.table,
      ctx.idCol.name,
    );
  }

  private geomExpr(ctx: SourceContext, params: Params, x: number, y: number) {
    return `${pgis('ST_SetSRID')}(${pgis('ST_MakePoint')}(CAST(${params.add(String(x))} AS float8), CAST(${params.add(String(y))} AS float8)), ${Math.trunc(ctx.geomSrid)})`;
  }

  /** Valores tipados (como no registro) das colunas `names`, por ID — para a Tabela de Alterações. */
  private async valuesById(db: Db, ctx: SourceContext, ids: string[], names: string[]) {
    const cols = names.map((n) => ctx.colMap.get(n)).filter((c): c is ColumnMeta => !!c);
    const params = new Params();
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${qi(ctx.idCol.name)}::text AS "__id", ${cols.map((c) => selectExpr(c)).join(', ')}
         FROM ${ctx.table} WHERE ${this.idIn(ctx, params, ids)}`,
      ...params.values,
    );
    return new Map(
      rows.map((r) => {
        const { __id, ...data } = r;
        return [String(__id), normalizeRow(data, ctx.colMap)];
      }),
    );
  }

  async create(
    dto: {
      sourceId: string;
      data: Record<string, unknown>;
      lat?: number;
      lng?: number;
      observation?: string;
    },
    userId: string,
  ) {
    const ctx = await this.sources.context(dto.sourceId);
    const data = { ...dto.data };

    if (dto.lat !== undefined && dto.lng !== undefined) {
      const xy = ctx.crs.toXY(dto.lat, dto.lng);
      if (!xy)
        throw new BadRequestException('Não foi possível converter a posição para o CRS da fonte');
      data[ctx.xCol.name] = Math.round(xy.x * 1000) / 1000;
      data[ctx.yCol.name] = Math.round(xy.y * 1000) / 1000;
    }
    if (data[ctx.xCol.name] === undefined || data[ctx.yCol.name] === undefined) {
      throw new BadRequestException('Informe as coordenadas X e Y');
    }

    return this.prisma.$transaction(
      async (tx) => {
        await this.writePath(ctx, tx);
        const created = await this.insertRecord(tx, ctx, data, userId);
        await this.changes.logCreate(tx, ctx, [created.id], dto.observation);
        return created;
      },
      { timeout: 30_000 },
    );
  }

  async update(sourceId: string, id: string, data: Record<string, unknown>, userId: string) {
    const ctx = await this.sources.context(sourceId);
    if (!Object.keys(data).length) throw new BadRequestException('Nada para alterar');
    return this.prisma.$transaction(
      async (tx) => {
        await this.writePath(ctx, tx);
        const before = await this.findOne(sourceId, id, tx);
        const params = new Params();
        const { assignments, newX, newY } = this.buildAssignments(ctx, params, data, {
          forInsert: false,
        });
        if (newX !== undefined || newY !== undefined) {
          const x = newX ?? before.x;
          const y = newY ?? before.y;
          if (x === null || y === null) throw new BadRequestException('Informe X e Y');
          this.validateCoords(ctx, x, y);
          if (ctx.geomCol)
            assignments.push({ col: ctx.geomCol.name, expr: this.geomExpr(ctx, params, x, y) });
        }
        if (!assignments.length) return before;
        const where = this.idEquals(ctx, params, id);
        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `UPDATE ${ctx.table} SET ${assignments.map((a) => `${qi(a.col)} = ${a.expr}`).join(', ')}
            WHERE ${where} RETURNING ${qi(ctx.idCol.name)}::text AS id`,
          ...params.values,
        );
        const after = await this.findOne(sourceId, row?.id ?? id, tx);
        const diff = AuditService.diff(before.data, after.data);
        if (diff.changed) {
          await this.audit.log(
            {
              userId,
              action: 'UPDATE',
              entity: this.entity(ctx),
              entityId: id,
              sourceId,
              oldValue: diff.oldValue,
              newValue: diff.newValue,
            },
            tx,
          );
          await this.changes.logUpdate(tx, ctx, [{ id, before: before.data, after: after.data }]);
        }
        return after;
      },
      { timeout: 30_000 },
    );
  }

  /** `forgetChange`: desfaz a inclusão do ponto (some da Tabela de Alterações em vez de virar DELETE). */
  async remove(
    sourceId: string,
    id: string,
    userId: string,
    observation?: string,
    opts: { forgetChange?: boolean } = {},
  ) {
    const ctx = await this.sources.context(sourceId);
    return this.prisma.$transaction(
      async (tx) => {
        await this.writePath(ctx, tx);
        const before = await this.findOne(sourceId, id, tx);
        const params = new Params();
        const deleted = await tx.$executeRawUnsafe(
          `DELETE FROM ${ctx.table} WHERE ${this.idEquals(ctx, params, id)}`,
          ...params.values,
        );
        await this.audit.log(
          {
            userId,
            action: 'DELETE',
            entity: this.entity(ctx),
            entityId: id,
            sourceId,
            oldValue: before.data,
          },
          tx,
        );
        if (opts.forgetChange) await this.changes.forget(tx, ctx, [id]);
        else await this.changes.logDelete(tx, ctx, [{ id, data: before.data }], observation);
        return { deleted };
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Recria um registro removido com os atributos guardados na Tabela de Alterações (ou, em remoções
   * antigas sem eles, no histórico) e tira a remoção da tabela.
   */
  async restoreDeleted(sourceId: string, id: string, userId: string) {
    const ctx = await this.sources.context(sourceId);
    if (ctx.idCol.isGenerated) {
      throw new BadRequestException(
        `A coluna "${ctx.idCol.name}" é calculada; não dá para restaurar`,
      );
    }
    let data = await this.changes.removedSnapshot(ctx, id);
    if (!Object.keys(data).length) {
      const entry = await this.prisma.auditLog.findFirst({
        where: {
          sourceId,
          entity: this.entity(ctx),
          entityId: id,
          action: { in: ['DELETE', 'BULK_DELETE'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      const old = entry?.oldValue;
      if (!old || typeof old !== 'object' || Array.isArray(old)) {
        throw new BadRequestException(`Os dados do registro ${id} removido não foram guardados`);
      }
      data = old as Record<string, unknown>;
    }

    return this.prisma.$transaction(
      async (tx) => {
        await this.writePath(ctx, tx);
        if (!(await this.reinsert(tx, ctx, id, data))) {
          throw new BadRequestException(`O registro ${id} já existe na camada`);
        }
        const restored = await this.findOne(sourceId, id, tx);
        await this.audit.log(
          {
            userId,
            action: 'RESTORE',
            entity: this.entity(ctx),
            entityId: id,
            sourceId,
            newValue: restored.data,
          },
          tx,
        );
        await this.changes.forget(tx, ctx, [id]);
        return restored;
      },
      { timeout: 30_000 },
    );
  }

  /** Insere de novo um registro removido com os atributos `data` (false = o ID já existe). */
  private async reinsert(
    tx: Prisma.TransactionClient,
    ctx: SourceContext,
    id: string,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    const check = new Params();
    const exists = await tx.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM ${ctx.table} WHERE ${this.idEquals(ctx, check, id)} LIMIT 1`,
      ...check.values,
    );
    if (exists.length) return false;

    const params = new Params();
    const assignments = ctx.columns
      .filter(
        (c) =>
          c !== ctx.idCol &&
          c.kind !== 'geometry' &&
          !c.isGenerated &&
          !c.readOnly &&
          Object.prototype.hasOwnProperty.call(data, c.name),
      )
      .map((c) => {
        const p = toParam(data[c.name]);
        return {
          col: c.name,
          expr: p === null ? 'NULL' : `CAST(${params.add(p)} AS ${castType(c)})`,
        };
      });
    assignments.push({
      col: ctx.idCol.name,
      expr: `CAST(${params.add(id)} AS ${castType(ctx.idCol)})`,
    });
    const x = Number(data[ctx.xCol.name]);
    const y = Number(data[ctx.yCol.name]);
    if (ctx.geomCol && data[ctx.xCol.name] != null && data[ctx.yCol.name] != null) {
      if (Number.isFinite(x) && Number.isFinite(y)) {
        assignments.push({ col: ctx.geomCol.name, expr: this.geomExpr(ctx, params, x, y) });
      }
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO ${ctx.table} (${assignments.map((a) => qi(a.col)).join(', ')}) ${ctx.idCol.isIdentity ? 'OVERRIDING SYSTEM VALUE' : ''}
       VALUES (${assignments.map((a) => a.expr).join(', ')})`,
      ...params.values,
    );
    if ((ctx.idCol.kind === 'integer' || ctx.idCol.kind === 'number') && ctx.idCol.hasDefault) {
      await this.syncIdSequence(tx, ctx);
    }
    return true;
  }

  // ---------------------------------------------------------------- desfazer (Ctrl+Z)

  /**
   * Última operação do usuário que ainda pode ser desfeita: as linhas do histórico gravadas na
   * mesma transação (ex.: uma edição em massa inteira). A transação do desfazer e a desfeita ficam
   * marcadas por uma linha UNDO (o desfazer não é desfeito pelo Ctrl+Z: é refeito pelo Ctrl+Y).
   * Um refazer (REDO) é uma operação como as outras: o Ctrl+Z desfaz de novo.
   */
  async lastUndo(userId: string): Promise<UndoInfo | null> {
    const [last] = await this.prisma.$queryRawUnsafe<{ tx: string }[]>(
      `SELECT a."txId"::text AS tx FROM audit_log a
        WHERE a."userId" = $1 AND a."txId" IS NOT NULL AND a.action = ANY($2::text[])
          AND a."sourceId" IS NOT NULL AND a.entity <> 'DataSource'
          AND NOT EXISTS (
            SELECT 1 FROM audit_log u
             WHERE u."userId" = $1 AND u.action = 'UNDO'
               AND (u."txId" = a."txId" OR u."newValue"->>'undoneTx' = a."txId"::text))
        ORDER BY a.id DESC LIMIT 1`,
      userId,
      UNDOABLE,
    );
    if (!last) return null;
    return this.txInfo(last.tx, userId);
  }

  /** Registros afetados por uma operação (transação) do usuário, por camada e ação. */
  private async txInfo(txId: string, userId: string): Promise<UndoInfo> {
    const parts = await this.prisma.$queryRawUnsafe<
      { sourceId: string; action: string; n: number; at: Date }[]
    >(
      `SELECT "sourceId", action, count(*)::int AS n, max("createdAt") AS at FROM audit_log
        WHERE "txId" = CAST($1 AS bigint) AND "userId" = $2 AND action = ANY($3::text[])
          AND "sourceId" IS NOT NULL AND entity <> 'DataSource'
        GROUP BY 1, 2 ORDER BY 3 DESC`,
      txId,
      userId,
      UNDOABLE,
    );
    const names = new Map<string, string>();
    for (const p of parts) {
      if (names.has(p.sourceId)) continue;
      const src = await this.prisma.dataSource.findUnique({ where: { id: p.sourceId } });
      names.set(p.sourceId, src?.name ?? 'camada excluída');
    }
    return {
      txId,
      at: parts.reduce((m, p) => (p.at > m ? p.at : m), parts[0]?.at ?? new Date(0)),
      total: parts.reduce((s, p) => s + p.n, 0),
      parts: parts.map((p) => ({
        sourceId: p.sourceId,
        sourceName: names.get(p.sourceId)!,
        action: p.action,
        label: ACTION_LABELS[p.action] ?? p.action,
        count: p.n,
      })),
    };
  }

  /**
   * Desfaz a operação `txId`, que precisa ser a última do usuário (senão pede para tentar de novo):
   * valores alterados voltam aos antigos, registros criados são removidos e removidos voltam.
   * Tudo numa transação, com histórico e Tabela de Alterações.
   */
  async undo(userId: string, txId: string) {
    const last = await this.lastUndo(userId);
    if (!last || last.txId !== txId) {
      throw new BadRequestException('A última ação mudou desde a consulta: tente desfazer de novo');
    }
    const r = await this.revertTx(userId, txId, 'undo', {
      action: 'UNDO',
      newValue: { undoneTx: txId },
    });
    return { undone: last, ...r };
  }

  /**
   * Último desfazer do usuário que ainda pode ser refeito (Ctrl+Y): o mais recente ainda não
   * refeito, desde que não haja uma ação nova depois dele (como em qualquer programa, uma ação nova
   * descarta o que dava para refazer). `txId` = transação do desfazer; as partes descrevem a
   * operação desfeita.
   */
  async lastRedo(userId: string): Promise<UndoInfo | null> {
    const [u] = await this.prisma.$queryRawUnsafe<
      { tx: string; undone: string | null; id: bigint }[]
    >(
      `SELECT u."txId"::text AS tx, u."newValue"->>'undoneTx' AS undone, u.id FROM audit_log u
        WHERE u."userId" = $1 AND u.action = 'UNDO' AND u."txId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM audit_log r
             WHERE r."userId" = $1 AND r.action = 'REDO' AND r."newValue"->>'redoneTx' = u."txId"::text)
        ORDER BY u.id DESC LIMIT 1`,
      userId,
    );
    if (!u?.undone) return null;
    const [fresh] = await this.prisma.$queryRawUnsafe<{ one: number }[]>(
      `SELECT 1 AS one FROM audit_log a
        WHERE a."userId" = $1 AND a.id > $2 AND a."txId" IS NOT NULL AND a.action = ANY($3::text[])
          AND a."sourceId" IS NOT NULL AND a.entity <> 'DataSource'
          AND NOT EXISTS (
            SELECT 1 FROM audit_log m
             WHERE m."userId" = $1 AND m."txId" = a."txId" AND m.action IN ('UNDO', 'REDO'))
        LIMIT 1`,
      userId,
      u.id,
      UNDOABLE,
    );
    if (fresh) return null;
    return { ...(await this.txInfo(u.undone, userId)), txId: u.tx };
  }

  /**
   * Refaz o desfazer `txId` (precisa ser o que `lastRedo` devolve): o desfazer é revertido, e a
   * operação volta a valer. Fica marcado por uma linha REDO.
   */
  async redo(userId: string, txId: string) {
    const next = await this.lastRedo(userId);
    if (!next || next.txId !== txId) {
      throw new BadRequestException('O que dava para refazer mudou: tente refazer de novo');
    }
    const r = await this.revertTx(userId, txId, 'redo', {
      action: 'REDO',
      newValue: { redoneTx: txId },
    });
    return { redone: next, ...r };
  }

  /**
   * Reverte as linhas do histórico da transação `txId` (desfazer uma operação ou, no refazer, um
   * desfazer) numa transação nova, com histórico, Tabela de Alterações e a linha de marcação.
   */
  private async revertTx(
    userId: string,
    txId: string,
    mode: 'undo' | 'redo',
    marker: { action: 'UNDO' | 'REDO'; newValue: Record<string, string> },
  ) {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        txId: BigInt(txId),
        userId,
        action: { in: UNDOABLE },
        sourceId: { not: null },
        entity: { not: 'DataSource' },
      },
      orderBy: { id: 'asc' },
    });
    const bySource = new Map<string, typeof entries>();
    for (const e of entries) {
      const list = bySource.get(e.sourceId!) ?? [];
      list.push(e);
      bySource.set(e.sourceId!, list);
    }
    const contexts = new Map<string, SourceContext>();
    for (const sourceId of bySource.keys()) {
      try {
        contexts.set(sourceId, await this.sources.context(sourceId));
      } catch {
        throw new BadRequestException(
          `Uma das camadas dessa ação não existe mais: não dá para ${mode === 'undo' ? 'desfazer' : 'refazer'}`,
        );
      }
    }

    return this.prisma.$transaction(
      async (tx) => {
        const counts = { reverted: 0, removed: 0, restored: 0, skipped: 0 };
        for (const [sourceId, list] of bySource) {
          const ctx = contexts.get(sourceId)!;
          await this.writePath(ctx, tx);
          const r = await this.undoEntries(tx, ctx, list, userId, mode);
          counts.reverted += r.reverted;
          counts.removed += r.removed;
          counts.restored += r.restored;
          counts.skipped += r.skipped;
        }
        await this.audit.log({ userId, entity: mode, ...marker }, tx);
        return { ...counts, sourceIds: [...bySource.keys()] };
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
  }

  /**
   * Desfaz as linhas do histórico de uma camada (na ordem: valores, criados, removidos). No refazer
   * (`redo`), os pontos que voltam são os que o desfazer tinha tirado: entram na Tabela de
   * Alterações como adicionados de novo.
   */
  private async undoEntries(
    tx: Prisma.TransactionClient,
    ctx: SourceContext,
    entries: { action: string; entityId: string | null; oldValue: unknown }[],
    userId: string,
    mode: 'undo' | 'redo' = 'undo',
  ) {
    const entity = this.entity(ctx);
    const asObject = (v: unknown) =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    /** Colunas que voltam ao valor antigo (a geometria é recalculada de X/Y; o ID não muda). */
    const revertible = (name: string) => {
      const c = ctx.colMap.get(name);
      return !!c && c.kind !== 'geometry' && !c.readOnly && !c.isGenerated && c !== ctx.idCol;
    };

    // Valor mais antigo de cada coluna, se o registro mudou mais de uma vez na operação.
    const values = new Map<string, Record<string, unknown>>();
    const created: string[] = [];
    const restoredBefore: string[] = [];
    const deleted = new Map<string, Record<string, unknown>>();
    for (const e of entries) {
      const id = e.entityId;
      if (!id) continue;
      if (e.action === 'UPDATE' || e.action === 'BULK_UPDATE' || e.action === 'MOVE') {
        const cur = values.get(id) ?? {};
        for (const [k, v] of Object.entries(asObject(e.oldValue))) {
          if (revertible(k) && !(k in cur)) cur[k] = v;
        }
        if (Object.keys(cur).length) values.set(id, cur);
      } else if (e.action === 'CREATE' || e.action === 'DUPLICATE') created.push(id);
      else if (e.action === 'RESTORE') restoredBefore.push(id);
      else if (!deleted.has(id)) deleted.set(id, asObject(e.oldValue));
    }
    let reverted = 0;
    let skipped = 0;

    if (values.size) {
      const ids = [...values.keys()];
      const names = [...new Set(ids.flatMap((id) => Object.keys(values.get(id)!)))];
      const before = await this.valuesById(tx, ctx, ids, names);
      skipped += ids.length - before.size;
      // Uma atualização por conjunto de colunas, com os valores por registro (unnest).
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        if (!before.has(id)) continue;
        const key = Object.keys(values.get(id)!).sort().join('\u0000');
        groups.set(key, [...(groups.get(key) ?? []), id]);
      }
      for (const [key, gids] of groups) {
        const cols = key.split('\u0000').map((n) => ctx.colMap.get(n)!);
        const params = new Params();
        const arrays = [
          `CAST(${params.add(gids)} AS text[])`,
          ...cols.map(
            (c) =>
              `CAST(${params.add(gids.map((id) => toParam(values.get(id)![c.name])))} AS text[])`,
          ),
        ];
        const alias = ['__sid', ...cols.map((_, k) => `__c${k}`)];
        const sets = cols.map((c, k) => `${qi(c.name)} = CAST(v.__c${k} AS ${castType(c)})`);
        const ix = cols.indexOf(ctx.xCol);
        const iy = cols.indexOf(ctx.yCol);
        if (ctx.geomCol && (ix >= 0 || iy >= 0)) {
          const coord = (k: number, expr: string) =>
            k >= 0 ? `CAST(replace(v.__c${k}, ',', '.') AS float8)` : expr;
          sets.push(
            `${qi(ctx.geomCol.name)} = ${pgis('ST_SetSRID')}(${pgis('ST_MakePoint')}(${coord(ix, ctx.xExpr)}, ${coord(iy, ctx.yExpr)}), ${Math.trunc(ctx.geomSrid)})`,
          );
        }
        reverted += await tx.$executeRawUnsafe(
          `UPDATE ${ctx.table} AS t SET ${sets.join(', ')}
             FROM unnest(${arrays.join(', ')}) AS v(${alias.join(', ')})
            WHERE t.${qi(ctx.idCol.name)} = CAST(v.__sid AS ${castType(ctx.idCol)})`,
          ...params.values,
        );
      }
      const after = await this.valuesById(tx, ctx, [...before.keys()], names);
      const changed = [...before].map(([id, old]) => ({
        id,
        before: old,
        after: after.get(id) ?? old,
      }));
      await this.audit.logMany(
        changed.map((c) => {
          const d = AuditService.diff(c.before, c.after);
          return {
            userId,
            action: 'UPDATE',
            entity,
            entityId: c.id,
            sourceId: ctx.source.id,
            oldValue: d.oldValue,
            newValue: d.newValue,
          };
        }),
        tx,
      );
      await this.changes.logUpdate(tx, ctx, changed);
    }

    // Criados (e restaurados) na operação: saem da camada.
    const toRemove = [...new Set([...created, ...restoredBefore])];
    let removed = 0;
    if (toRemove.length) {
      const p1 = new Params();
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT ${this.fullSelect(ctx)} FROM ${ctx.table} WHERE ${this.idIn(ctx, p1, toRemove)}`,
        ...p1.values,
      );
      const recs = rows.map((r) => this.toRecord(ctx, r));
      skipped += toRemove.length - recs.length;
      const p2 = new Params();
      removed = await tx.$executeRawUnsafe(
        `DELETE FROM ${ctx.table} WHERE ${this.idIn(ctx, p2, toRemove)}`,
        ...p2.values,
      );
      await this.audit.logMany(
        recs.map((rec) => ({
          userId,
          action: 'DELETE',
          entity,
          entityId: rec.id,
          sourceId: ctx.source.id,
          oldValue: rec.data,
        })),
        tx,
      );
      // Inclusão desfeita some da Tabela de Alterações; restauração desfeita volta a ser remoção.
      const restoredSet = new Set(restoredBefore);
      await this.changes.forget(
        tx,
        ctx,
        recs.filter((r) => !restoredSet.has(r.id)).map((r) => r.id),
      );
      await this.changes.logDelete(
        tx,
        ctx,
        recs.filter((r) => restoredSet.has(r.id)),
      );
    }

    // Removidos na operação: voltam com os atributos guardados no histórico.
    const back: string[] = [];
    for (const [id, data] of deleted) {
      if (Object.keys(data).length && (await this.reinsert(tx, ctx, id, data))) back.push(id);
      else skipped++;
    }
    if (back.length) {
      const p3 = new Params();
      const restored = (
        await tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT ${this.fullSelect(ctx)} FROM ${ctx.table} WHERE ${this.idIn(ctx, p3, back)}`,
          ...p3.values,
        )
      ).map((r) => this.toRecord(ctx, r));
      await this.audit.logMany(
        back.map((id) => ({
          userId,
          action: 'RESTORE',
          entity,
          entityId: id,
          sourceId: ctx.source.id,
          newValue: restored.find((r) => r.id === id)?.data ?? deleted.get(id),
        })),
        tx,
      );
      if (mode === 'redo') await this.changes.logCreate(tx, ctx, back);
      else await this.changes.forget(tx, ctx, back);
    }
    return { reverted, removed, restored: back.length, skipped };
  }

  /** Valida as alterações de uma edição em massa e devolve as colunas alteradas. */
  private checkBulkChanges(ctx: SourceContext, changes: Record<string, unknown>) {
    const blocked = [ctx.idCol.name, ctx.xCol.name, ctx.yCol.name];
    const keys = Object.keys(changes);
    if (!keys.length) throw new BadRequestException('Nada para alterar');
    const bad = keys.find((k) => blocked.includes(k));
    if (bad) throw new BadRequestException(`A coluna "${bad}" não pode ser alterada em massa`);
    this.buildAssignments(ctx, new Params(), changes, { forInsert: false });
    return keys;
  }

  /** Edição em massa (mesmo valor para vários registros) em uma transação. */
  async bulkUpdate(
    sourceId: string,
    ids: string[],
    changes: Record<string, unknown>,
    userId: string,
  ) {
    const ctx = await this.sources.context(sourceId);
    const keys = this.checkBulkChanges(ctx, changes);

    return this.prisma.$transaction(
      async (tx) => {
        await this.writePath(ctx, tx);
        const params = new Params();
        const { assignments } = this.buildAssignments(ctx, params, changes, { forInsert: false });
        const idCond = this.idIn(ctx, params, ids);
        const before = await this.valuesById(tx, ctx, ids, keys);
        const updated = await tx.$executeRawUnsafe(
          `UPDATE ${ctx.table} SET ${assignments.map((a) => `${qi(a.col)} = ${a.expr}`).join(', ')} WHERE ${idCond}`,
          ...params.values,
        );
        const after = await this.valuesById(tx, ctx, ids, keys);
        await this.audit.logMany(
          [...before].map(([entityId, old]) => ({
            userId,
            action: 'BULK_UPDATE',
            entity: this.entity(ctx),
            entityId,
            sourceId,
            oldValue: old,
            newValue: changes,
          })),
          tx,
        );
        await this.changes.logUpdate(
          tx,
          ctx,
          [...before].map(([id, old]) => ({ id, before: old, after: after.get(id) ?? old })),
        );
        return { updated };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  /** Substituição: mesmo valor em todos os registros que atendem aos filtros (com ou sem coordenada). */
  async replaceFiltered(
    sourceId: string,
    filters: FilterDef[],
    changes: Record<string, unknown>,
    userId: string,
  ) {
    const ctx = await this.sources.context(sourceId);
    this.checkBulkChanges(ctx, changes);
    const params = new Params();
    const conds = buildFilterConditions(filters, ctx.colMap, params);
    const where = conds.length ? `WHERE ${conds.map((c) => `(${c})`).join(' AND ')}` : '';
    const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT ${qi(ctx.idCol.name)}::text AS id FROM ${ctx.table} ${where} LIMIT ${MAX_IDS + 1}`,
      ...params.values,
    );
    if (rows.length > MAX_IDS) {
      throw new BadRequestException(
        `Mais de ${MAX_IDS.toLocaleString('pt-BR')} registros: refine os filtros`,
      );
    }
    if (!rows.length) return { updated: 0 };
    return this.bulkUpdate(
      sourceId,
      rows.map((r) => r.id),
      changes,
      userId,
    );
  }

  /**
   * Move (ou duplica) registros aplicando o mesmo deslocamento X/Y, no CRS da fonte, calculado a partir
   * do arraste no mapa (from -> to). Retorna os registros afetados (ou as cópias) já na nova posição.
   */
  /**
   * Duplica registros em outra camada, na mesma posição (convertida para o sistema de coordenadas
   * dela). `mapping` liga coluna de origem → coluna de destino; colunas de origem sem destino (ou
   * ausentes) não são copiadas. Valores que não cabem no tipo do destino ficam vazios e são contados.
   * Tudo numa transação; as cópias entram na Tabela de Alterações da camada de destino.
   */
  async copyToSource(
    sourceId: string,
    ids: string[],
    targetId: string,
    mapping: Record<string, string | null>,
    userId: string,
    observation?: string,
  ) {
    if (sourceId === targetId)
      throw new BadRequestException('Para duplicar na mesma camada, use Duplicar na camada atual');
    const src = await this.sources.context(sourceId);
    const dst = await this.sources.context(targetId);
    const coordCols = new Set(
      [dst.xCol, dst.yCol, dst.geomCol].flatMap((c) => (c ? [c.name] : [])),
    );
    const pairs: { from: string; to: ColumnMeta }[] = [];
    const used = new Set<string>();
    for (const [from, to] of Object.entries(mapping ?? {})) {
      if (!to) continue;
      if (!src.colMap.has(from))
        throw new BadRequestException(`Coluna "${from}" não existe na origem`);
      const col = dst.colMap.get(to);
      if (!col) throw new BadRequestException(`Coluna "${to}" não existe em ${dst.source.name}`);
      if (col.readOnly || coordCols.has(to))
        throw new BadRequestException(`A coluna "${to}" de ${dst.source.name} não recebe valores`);
      if (used.has(to))
        throw new BadRequestException(`A coluna "${to}" recebe mais de um atributo`);
      used.add(to);
      pairs.push({ from, to: col });
    }

    const records = await this.records(sourceId, ids, true);
    if (!records.length) throw new BadRequestException('Nenhum dos registros foi encontrado');
    const decimals = dst.crs.def.kind === 'geographic' ? 8 : 3;
    const f = 10 ** decimals;
    const invalid: Record<string, number> = {};
    let skipped = 0;
    const rows: Record<string, unknown>[] = [];
    for (const r of records) {
      const xy = r.lat !== null && r.lng !== null ? dst.crs.toXY(r.lat, r.lng) : null;
      if (!xy || !dst.crs.isValid(xy.x, xy.y)) {
        skipped++;
        continue;
      }
      const data: Record<string, unknown> = {
        [dst.xCol.name]: Math.round(xy.x * f) / f,
        [dst.yCol.name]: Math.round(xy.y * f) / f,
      };
      for (const p of pairs) {
        const c = coerceFor(p.to, r.data[p.from]);
        if (c.invalid) invalid[p.to.name] = (invalid[p.to.name] ?? 0) + 1;
        // ID vazio: o destino gera um (como em Adicionar ponto).
        if (p.to === dst.idCol && c.value === null) continue;
        data[p.to.name] = c.value;
      }
      rows.push(data);
    }
    if (!rows.length)
      throw new BadRequestException(
        `Nenhum registro tem posição válida no sistema de coordenadas de ${dst.source.name}`,
      );

    const created = await this.prisma.$transaction(
      async (tx) => {
        await this.writePath(dst, tx);
        const out: PointRecord[] = [];
        for (const data of rows) out.push(await this.insertRecord(tx, dst, data, userId));
        await this.changes.logCreate(
          tx,
          dst,
          out.map((c) => c.id),
          observation,
        );
        return out;
      },
      { timeout: 300_000, maxWait: 10_000 },
    );

    const groups = new Map<
      string,
      { key: string; x: number; y: number; lat: number; lng: number; ids: string[] }
    >();
    for (const c of created) {
      if (c.x === null || c.y === null || c.lat === null || c.lng === null) continue;
      const key = coordKey(c.x, c.y);
      const g = groups.get(key);
      if (g) g.ids.push(c.id);
      else groups.set(key, { key, x: c.x, y: c.y, lat: c.lat, lng: c.lng, ids: [c.id] });
    }
    return {
      count: created.length,
      skipped,
      invalid,
      targetId,
      targetName: dst.source.name,
      groups: [...groups.values()],
    };
  }

  async translate(
    sourceId: string,
    ids: string[],
    mode: 'move' | 'copy',
    from: LatLng,
    to: LatLng,
    userId: string,
    observation?: string,
  ) {
    const ctx = await this.sources.context(sourceId);
    const a = ctx.crs.toXY(from.lat, from.lng);
    const b = ctx.crs.toXY(to.lat, to.lng);
    if (!a || !b)
      throw new BadRequestException('Não foi possível converter a posição para o CRS da fonte');
    const decimals = ctx.crs.def.kind === 'geographic' ? 8 : 3;
    const f = 10 ** decimals;
    const dx = Math.round((b.x - a.x) * f) / f;
    const dy = Math.round((b.y - a.y) * f) / f;
    if (mode === 'move' && !dx && !dy)
      throw new BadRequestException('Deslocamento nulo: arraste os pontos para outra posição');

    const id = qi(ctx.idCol.name);
    /** Novas coordenadas + registros alvo (só os de coordenada válida), com parâmetros próprios por query. */
    const parts = (params: Params) => {
      const pdx = params.add(String(dx));
      const pdy = params.add(String(dy));
      return {
        nx: `round((${ctx.xExpr} + CAST(${pdx} AS float8))::numeric, ${decimals})`,
        ny: `round((${ctx.yExpr} + CAST(${pdy} AS float8))::numeric, ${decimals})`,
        where: `(${this.idIn(ctx, params, ids)}) AND (${ctx.validCoordSql(params)})`,
      };
    };

    return this.prisma.$transaction(
      async (tx) => {
        await this.writePath(ctx, tx);
        // Valida a extensão de destino antes de escrever.
        const p0 = new Params();
        const q0 = parts(p0);
        const [ext] = await tx.$queryRawUnsafe<
          {
            n: number;
            minX: number | null;
            maxX: number | null;
            minY: number | null;
            maxY: number | null;
          }[]
        >(
          `SELECT count(*)::int AS n, min(${q0.nx})::float8 AS "minX", max(${q0.nx})::float8 AS "maxX",
                  min(${q0.ny})::float8 AS "minY", max(${q0.ny})::float8 AS "maxY"
             FROM ${ctx.table} WHERE ${q0.where}`,
          ...p0.values,
        );
        if (
          !ext.n ||
          ext.minX === null ||
          ext.maxX === null ||
          ext.minY === null ||
          ext.maxY === null
        ) {
          throw new BadRequestException(
            'Nenhum registro com coordenada válida entre os selecionados',
          );
        }
        for (const x of [ext.minX, ext.maxX])
          for (const y of [ext.minY, ext.maxY]) this.validateCoords(ctx, x, y);

        const params = new Params();
        const q = parts(params);
        const xCast = `CAST(${q.nx} AS ${castType(ctx.xCol)})`;
        const yCast = `CAST(${q.ny} AS ${castType(ctx.yCol)})`;
        const geom = ctx.geomCol
          ? `${pgis('ST_SetSRID')}(${pgis('ST_MakePoint')}(${q.nx}::float8, ${q.ny}::float8), ${Math.trunc(ctx.geomSrid)})`
          : null;
        const returning = `RETURNING ${id}::text AS id, ${ctx.xExpr} AS x, ${ctx.yExpr} AS y`;
        let rows: { id: string; x: number; y: number }[];

        if (mode === 'move') {
          const pOld = new Params();
          const old = await tx.$queryRawUnsafe<{ id: string; x: number; y: number }[]>(
            `SELECT ${id}::text AS id, ${ctx.xExpr} AS x, ${ctx.yExpr} AS y FROM ${ctx.table}
              WHERE (${this.idIn(ctx, pOld, ids)}) AND (${ctx.validCoordSql(pOld)})`,
            ...pOld.values,
          );
          const xy = [ctx.xCol.name, ctx.yCol.name];
          const typedBefore = await this.valuesById(
            tx,
            ctx,
            old.map((r) => r.id),
            xy,
          );
          const sets = [`${qi(ctx.xCol.name)} = ${xCast}`, `${qi(ctx.yCol.name)} = ${yCast}`];
          if (geom) sets.push(`${qi(ctx.geomCol!.name)} = ${geom}`);
          rows = await tx.$queryRawUnsafe(
            `UPDATE ${ctx.table} SET ${sets.join(', ')} WHERE ${q.where} ${returning}`,
            ...params.values,
          );
          const before = new Map(old.map((r) => [r.id, r]));
          await this.audit.logMany(
            rows.map((r) => ({
              userId,
              action: 'MOVE',
              entity: this.entity(ctx),
              entityId: r.id,
              sourceId,
              oldValue: {
                [ctx.xCol.name]: before.get(r.id)?.x ?? null,
                [ctx.yCol.name]: before.get(r.id)?.y ?? null,
              },
              newValue: { [ctx.xCol.name]: r.x, [ctx.yCol.name]: r.y },
            })),
            tx,
          );
          const typedAfter = await this.valuesById(
            tx,
            ctx,
            rows.map((r) => r.id),
            xy,
          );
          await this.changes.logUpdate(
            tx,
            ctx,
            rows.map((r) => ({
              id: r.id,
              before: typedBefore.get(r.id) ?? {},
              after: typedAfter.get(r.id) ?? {},
            })),
          );
        } else {
          // Copia todas as colunas graváveis; X/Y (e a geometria) vêm deslocados. ID numérico: continua
          // a partir do maior da camada (max+1, max+2…, na ordem dos originais), mesmo com valor
          // automático; senão, o valor automático da coluna.
          const skip = new Set([ctx.idCol.name, ctx.xCol.name, ctx.yCol.name, ctx.geomCol?.name]);
          const cols = ctx.columns.filter(
            (c) => !skip.has(c.name) && !c.isGenerated && !(c.readOnly && c.kind !== 'geometry'),
          );
          const target = [...cols.map((c) => qi(c.name)), qi(ctx.xCol.name), qi(ctx.yCol.name)];
          const values = [...cols.map((c) => qi(c.name)), xCast, yCast];
          if (geom) {
            target.push(qi(ctx.geomCol!.name));
            values.push(geom);
          }
          const numericId =
            (ctx.idCol.kind === 'integer' || ctx.idCol.kind === 'number') && !ctx.idCol.isGenerated;
          if (!numericId && !ctx.idCol.hasDefault) {
            throw new BadRequestException(
              `Não é possível duplicar: a coluna de ID "${ctx.idCol.name}" não é numérica nem tem valor automático`,
            );
          }
          if (numericId) {
            await tx.$executeRawUnsafe(
              `SELECT pg_advisory_xact_lock(hashtext($1))`,
              this.entity(ctx),
            );
            target.push(id);
            values.push(
              `CAST((SELECT COALESCE(max(${id}), 0) FROM ${ctx.table}) + row_number() OVER (ORDER BY ${id}) AS ${castType(ctx.idCol)})`,
            );
          }
          rows = await tx.$queryRawUnsafe(
            `INSERT INTO ${ctx.table} (${target.join(', ')}) ${numericId && ctx.idCol.isIdentity ? 'OVERRIDING SYSTEM VALUE' : ''}
             SELECT ${values.join(', ')} FROM ${ctx.table} WHERE ${q.where} ${returning}`,
            ...params.values,
          );
          if (numericId && ctx.idCol.hasDefault) await this.syncIdSequence(tx, ctx);
          await this.audit.logMany(
            rows.map((r) => ({
              userId,
              action: 'DUPLICATE',
              entity: this.entity(ctx),
              entityId: r.id,
              sourceId,
              newValue: { [ctx.xCol.name]: r.x, [ctx.yCol.name]: r.y },
            })),
            tx,
          );
          await this.changes.logCreate(
            tx,
            ctx,
            rows.map((r) => r.id),
            observation,
          );
        }

        const groups = new Map<
          string,
          {
            key: string;
            x: number;
            y: number;
            lat: number;
            lng: number;
            count: number;
            ids: string[];
          }
        >();
        for (const r of rows) {
          const key = coordKey(r.x, r.y);
          let g = groups.get(key);
          if (!g) {
            const ll = ctx.crs.toLatLng(r.x, r.y);
            if (!ll) continue;
            groups.set(key, (g = { key, x: r.x, y: r.y, ...ll, count: 0, ids: [] }));
          }
          g.count++;
          g.ids.push(r.id);
        }
        return { count: rows.length, dx, dy, groups: [...groups.values()] };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  /**
   * Move cada registro de `sourceId` para a posição do registro pareado de `targetId` (ex.: ponto
   * associado de outra camada). Pares cujo destino não existe ou não tem coordenada são ignorados.
   */
  async snapTo(
    sourceId: string,
    targetId: string,
    pairs: { id: string; targetId: string }[],
    userId: string,
  ) {
    const [ctx, tctx] = await Promise.all([
      this.sources.context(sourceId),
      this.sources.context(targetId),
    ]);
    const pt = new Params();
    const targets = await this.prisma.$queryRawUnsafe<{ id: string; x: number; y: number }[]>(
      `SELECT ${qi(tctx.idCol.name)}::text AS id, ${tctx.xExpr} AS x, ${tctx.yExpr} AS y
         FROM ${tctx.table}
        WHERE (${this.idIn(tctx, pt, [...new Set(pairs.map((p) => p.targetId))])})
          AND (${tctx.validCoordSql(pt)})`,
      ...pt.values,
    );
    const decimals = ctx.crs.def.kind === 'geographic' ? 8 : 3;
    const f = 10 ** decimals;
    const posOf = new Map<string, { x: number; y: number }>();
    for (const t of targets) {
      const ll = tctx.crs.toLatLng(t.x, t.y);
      const xy = ll && ctx.crs.toXY(ll.lat, ll.lng);
      if (!xy) continue;
      const x = Math.round(xy.x * f) / f;
      const y = Math.round(xy.y * f) / f;
      this.validateCoords(ctx, x, y);
      posOf.set(t.id, { x, y });
    }
    const moves = new Map<string, { x: number; y: number }>();
    for (const p of pairs) {
      const pos = posOf.get(p.targetId);
      if (pos && !moves.has(p.id)) moves.set(p.id, pos);
    }
    const ids = [...moves.keys()];
    if (!ids.length) return { count: 0, skipped: pairs.length, groups: [] };

    const id = qi(ctx.idCol.name);
    return this.prisma.$transaction(
      async (tx) => {
        await this.writePath(ctx, tx);
        const xy = [ctx.xCol.name, ctx.yCol.name];
        const pOld = new Params();
        const old = await tx.$queryRawUnsafe<{ id: string; x: number | null; y: number | null }[]>(
          `SELECT ${id}::text AS id, ${ctx.xExpr} AS x, ${ctx.yExpr} AS y FROM ${ctx.table}
            WHERE ${this.idIn(ctx, pOld, ids)}`,
          ...pOld.values,
        );
        const typedBefore = await this.valuesById(tx, ctx, ids, xy);

        const params = new Params();
        const pIds = params.add(ids);
        const pXs = params.add(ids.map((k) => moves.get(k)!.x));
        const pYs = params.add(ids.map((k) => moves.get(k)!.y));
        const sets = [
          `${qi(ctx.xCol.name)} = CAST(v.__nx AS ${castType(ctx.xCol)})`,
          `${qi(ctx.yCol.name)} = CAST(v.__ny AS ${castType(ctx.yCol)})`,
        ];
        if (ctx.geomCol) {
          sets.push(
            `${qi(ctx.geomCol.name)} = ${pgis('ST_SetSRID')}(${pgis('ST_MakePoint')}(v.__nx, v.__ny), ${Math.trunc(ctx.geomSrid)})`,
          );
        }
        const rows = await tx.$queryRawUnsafe<{ id: string; x: number; y: number }[]>(
          `UPDATE ${ctx.table} AS t SET ${sets.join(', ')}
             FROM unnest(CAST(${pIds} AS text[]), CAST(${pXs} AS float8[]), CAST(${pYs} AS float8[]))
                  AS v(__sid, __nx, __ny)
            WHERE t.${id} = CAST(v.__sid AS ${castType(ctx.idCol)})
           RETURNING t.${id}::text AS id, ${ctx.xExpr} AS x, ${ctx.yExpr} AS y`,
          ...params.values,
        );
        const before = new Map(old.map((r) => [r.id, r]));
        await this.audit.logMany(
          rows.map((r) => ({
            userId,
            action: 'MOVE',
            entity: this.entity(ctx),
            entityId: r.id,
            sourceId,
            oldValue: {
              [ctx.xCol.name]: before.get(r.id)?.x ?? null,
              [ctx.yCol.name]: before.get(r.id)?.y ?? null,
            },
            newValue: { [ctx.xCol.name]: r.x, [ctx.yCol.name]: r.y },
          })),
          tx,
        );
        const typedAfter = await this.valuesById(
          tx,
          ctx,
          rows.map((r) => r.id),
          xy,
        );
        await this.changes.logUpdate(
          tx,
          ctx,
          rows.map((r) => ({
            id: r.id,
            before: typedBefore.get(r.id) ?? {},
            after: typedAfter.get(r.id) ?? {},
          })),
        );

        const groups = new Map<
          string,
          { key: string; x: number; y: number; lat: number; lng: number; ids: string[] }
        >();
        for (const r of rows) {
          const key = coordKey(r.x, r.y);
          let g = groups.get(key);
          if (!g) {
            const ll = ctx.crs.toLatLng(r.x, r.y);
            if (!ll) continue;
            groups.set(key, (g = { key, x: r.x, y: r.y, ...ll, ids: [] }));
          }
          g.ids.push(r.id);
        }
        return {
          count: rows.length,
          skipped: pairs.length - rows.length,
          groups: [...groups.values()],
        };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  async bulkDelete(sourceId: string, ids: string[], userId: string, observation?: string) {
    const ctx = await this.sources.context(sourceId);
    return this.prisma.$transaction(
      async (tx) => {
        await this.writePath(ctx, tx);
        const p1 = new Params();
        const oldRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT ${this.fullSelect(ctx)} FROM ${ctx.table} WHERE ${this.idIn(ctx, p1, ids)}`,
          ...p1.values,
        );
        const p2 = new Params();
        const deleted = await tx.$executeRawUnsafe(
          `DELETE FROM ${ctx.table} WHERE ${this.idIn(ctx, p2, ids)}`,
          ...p2.values,
        );
        const removed = oldRows.map((r) => this.toRecord(ctx, r));
        await this.audit.logMany(
          removed.map((rec) => ({
            userId,
            action: 'BULK_DELETE',
            entity: this.entity(ctx),
            entityId: rec.id,
            sourceId,
            oldValue: rec.data,
          })),
          tx,
        );
        const unique = new Map(removed.map((r) => [r.id, r]));
        await this.changes.logDelete(tx, ctx, [...unique.values()], observation);
        return { deleted };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}
