import { Prisma } from '@prisma/client';

/**
 * Utilitários para SQL dinâmico sobre as tabelas do usuário.
 *
 * Regras de segurança:
 *  - Identificadores (schema/tabela/coluna) só são usados depois de validados contra o catálogo
 *    do PostgreSQL e sempre passam por `qi()` (aspas duplas com escape).
 *  - Valores nunca são concatenados: entram como parâmetros ($1, $2, ...) com CAST explícito.
 */

export type ColumnKind =
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'text'
  | 'json'
  | 'geometry'
  | 'other';

export interface ColumnMeta {
  name: string;
  formatType: string;
  udtName: string;
  kind: ColumnKind;
  nullable: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  isGenerated: boolean;
  isNumeric: boolean;
  readOnly: boolean;
  position: number;
}

const KIND_BY_UDT: Record<string, ColumnKind> = {
  int2: 'integer',
  int4: 'integer',
  int8: 'integer',
  float4: 'number',
  float8: 'number',
  numeric: 'number',
  bool: 'boolean',
  date: 'date',
  timestamp: 'datetime',
  timestamptz: 'datetime',
  text: 'text',
  varchar: 'text',
  bpchar: 'text',
  uuid: 'text',
  citext: 'text',
  name: 'text',
  json: 'json',
  jsonb: 'json',
  geometry: 'geometry',
  geography: 'geometry',
};

/** Tipos que o Prisma consegue desserializar diretamente em queries raw. */
const PRISMA_SAFE_UDT = new Set([
  'int2',
  'int4',
  'int8',
  'float4',
  'float8',
  'numeric',
  'bool',
  'text',
  'varchar',
  'bpchar',
  'date',
  'timestamp',
  'timestamptz',
  'json',
  'jsonb',
  'uuid',
]);

/** Tipos usados em CAST($n AS ...) quando o tipo é simples o suficiente. */
const SAFE_TYPE_NAME = /^[a-z0-9_ ,().\[\]"]+$/i;

export function kindOf(udtName: string): ColumnKind {
  return KIND_BY_UDT[udtName] ?? 'other';
}

/** Quote de identificador PostgreSQL. */
export function qi(ident: string): string {
  return '"' + ident.replace(/"/g, '""') + '"';
}

export function qualified(schema: string, table: string): string {
  return `${qi(schema)}.${qi(table)}`;
}

/** Nome de tipo seguro para CAST (vem do catálogo, mas validamos mesmo assim). */
export function castType(col: ColumnMeta): string {
  if (col.kind === 'text') return 'text';
  const t = col.formatType;
  if (!SAFE_TYPE_NAME.test(t)) throw new Error(`Tipo de coluna não suportado: ${t}`);
  return t;
}

/** Tipo "base" para comparação (sem typmod, evita arredondar limites). */
export function compareType(col: ColumnMeta): string {
  if (col.isNumeric) return col.udtName;
  return castType(col);
}

/**
 * Schema onde a extensão PostGIS está instalada. A conexão do Prisma usa search_path=gis_app,
 * então as funções PostGIS precisam ser qualificadas. Definido na inicialização (CatalogService).
 */
let postgisSchema: string | null = null;

export function setPostgisSchema(schema: string | null) {
  postgisSchema = schema;
}

export function getPostgisSchema(): string | null {
  return postgisSchema;
}

/** Nome qualificado de uma função PostGIS (ex.: "public".ST_AsText). */
export function pgis(fn: string): string {
  return postgisSchema ? `${qi(postgisSchema)}.${fn}` : fn;
}

/** Expressão de SELECT que o Prisma consegue ler, mantendo o nome original da coluna. */
export function selectExpr(col: ColumnMeta, alias = col.name): string {
  const q = qi(col.name);
  if (col.kind === 'geometry') {
    return postgisSchema ? `${pgis('ST_AsText')}(${q}) AS ${qi(alias)}` : `${q}::text AS ${qi(alias)}`;
  }
  if (PRISMA_SAFE_UDT.has(col.udtName)) return `${q} AS ${qi(alias)}`;
  return `${q}::text AS ${qi(alias)}`;
}

/** Expressão numérica (float8) para uma coluna de coordenada. Colunas texto são convertidas com segurança. */
export function coordExpr(col: ColumnMeta): string {
  const q = qi(col.name);
  if (col.isNumeric) return `${q}::float8`;
  return `(CASE WHEN ${q}::text ~ '^\\s*-?[0-9]+([.,][0-9]+)?\\s*$' THEN replace(btrim(${q}::text), ',', '.')::float8 END)`;
}

/** Acumulador de parâmetros posicionais. */
export class Params {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Condição BETWEEN para coordenada, usando o tipo nativo da coluna (aproveita índices). */
export function coordRange(col: ColumnMeta, params: Params, min: number, max: number): string {
  if (col.isNumeric) {
    const t = col.udtName;
    const lo = col.kind === 'integer' ? Math.floor(min) : min;
    const hi = col.kind === 'integer' ? Math.ceil(max) : max;
    return `${qi(col.name)} BETWEEN CAST(${params.add(String(lo))} AS ${t}) AND CAST(${params.add(String(hi))} AS ${t})`;
  }
  const e = coordExpr(col);
  return `${e} BETWEEN CAST(${params.add(String(min))} AS float8) AND CAST(${params.add(String(max))} AS float8)`;
}

/** Igualdade exata de coordenada. */
export function coordEquals(col: ColumnMeta, params: Params, value: number): string {
  if (col.isNumeric) {
    return `${qi(col.name)} = CAST(${params.add(String(value))} AS ${col.udtName})`;
  }
  return `${coordExpr(col)} = CAST(${params.add(String(value))} AS float8)`;
}

/** Converte valores vindos da API em texto para parâmetros com CAST. */
export function toParam(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** Normaliza um valor retornado pelo Prisma raw para JSON. */
export function normalizeValue(value: unknown, kind?: ColumnKind): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  if (Prisma.Decimal.isDecimal(value)) {
    const s = (value as Prisma.Decimal).toString();
    const n = Number(s);
    return Number.isFinite(n) && String(n) === s ? n : Number.isFinite(n) ? n : s;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return kind === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map((v) => normalizeValue(v));
  return value;
}

export function normalizeRow(
  row: Record<string, unknown>,
  colMap?: Map<string, ColumnMeta>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = normalizeValue(v, colMap?.get(k)?.kind);
  }
  return out;
}

/** Converte o valor de ID para string (as rotas sempre trabalham com ID texto). */
export function idToString(value: unknown): string {
  const v = normalizeValue(value);
  return v === null ? '' : String(v);
}
