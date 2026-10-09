import { BadRequestException } from '@nestjs/common';
import { ColumnMeta, Params, castType, qi, toParam } from './sql';

export const FILTER_OPS = [
  'eq',
  'neq',
  'contains',
  'notContains',
  'startsWith',
  'in',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'isNull',
  'notNull',
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterDef {
  column: string;
  op: FilterOp;
  value?: unknown;
  values?: unknown[];
  /**
   * Comparação de texto: true = diferencia maiúsculas (contém/começa com usam LIKE);
   * false = ignora (igual/diferente comparam em minúsculas). Ausente = comportamento padrão
   * (igual/diferente exatos; contém/começa com sem diferenciar).
   */
  caseSensitive?: boolean;
}

const MAX_FILTERS = 60;

/** Aceita filtros como JSON (query string) ou array (body) e valida a estrutura. */
export function parseFilters(raw: unknown): FilterDef[] {
  if (raw === undefined || raw === null || raw === '') return [];
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new BadRequestException('Parâmetro "filters" não é um JSON válido');
    }
  }
  if (!Array.isArray(data)) throw new BadRequestException('"filters" deve ser uma lista');
  if (data.length > MAX_FILTERS) throw new BadRequestException(`Máximo de ${MAX_FILTERS} filtros`);
  return data.map((f, i) => {
    if (typeof f !== 'object' || f === null) throw new BadRequestException(`Filtro ${i} inválido`);
    const { column, op, value, values, caseSensitive } = f as Record<string, unknown>;
    if (typeof column !== 'string' || !column) {
      throw new BadRequestException(`Filtro ${i}: coluna obrigatória`);
    }
    if (typeof op !== 'string' || !(FILTER_OPS as readonly string[]).includes(op)) {
      throw new BadRequestException(`Filtro ${i}: operador inválido`);
    }
    if (values !== undefined && !Array.isArray(values)) {
      throw new BadRequestException(`Filtro ${i}: "values" deve ser uma lista`);
    }
    return {
      column,
      op: op as FilterOp,
      value,
      values: values as unknown[] | undefined,
      caseSensitive: typeof caseSensitive === 'boolean' ? caseSensitive : undefined,
    };
  });
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * Monta as condições SQL para os filtros. Colunas são validadas contra os metadados da tabela;
 * valores entram sempre como parâmetros.
 */
export function buildFilterConditions(
  filters: FilterDef[],
  colMap: Map<string, ColumnMeta>,
  params: Params,
): string[] {
  const conds: string[] = [];
  for (const f of filters) {
    const col = colMap.get(f.column);
    if (!col) throw new BadRequestException(`Coluna desconhecida no filtro: ${f.column}`);
    const q = qi(col.name);
    const isGeom = col.kind === 'geometry';
    if (isGeom && f.op !== 'isNull' && f.op !== 'notNull') {
      throw new BadRequestException(`Coluna geométrica "${col.name}" aceita apenas filtros de nulo`);
    }
    const textExpr = `${q}::text`;
    const typed = (v: unknown) => {
      const p = toParam(v);
      if (p === null) throw new BadRequestException(`Filtro em "${col.name}" sem valor`);
      return `CAST(${params.add(p)} AS ${castType(col)})`;
    };
    // Texto sem diferenciar maiúsculas em igual/diferente; LIKE (com diferença) só quando pedido.
    const ignoreCase = f.caseSensitive === false && col.kind === 'text';
    const like = f.caseSensitive === true ? 'LIKE' : 'ILIKE';
    const lowerParam = () => `lower(${params.add(String(f.value ?? ''))})`;
    switch (f.op) {
      case 'eq':
        conds.push(ignoreCase ? `lower(${textExpr}) = ${lowerParam()}` : `${q} = ${typed(f.value)}`);
        break;
      case 'neq':
        conds.push(
          ignoreCase ? `(${q} IS NULL OR lower(${textExpr}) <> ${lowerParam()})` : `(${q} IS DISTINCT FROM ${typed(f.value)})`,
        );
        break;
      case 'contains':
        conds.push(`${textExpr} ${like} ${params.add(`%${escapeLike(String(f.value ?? ''))}%`)}`);
        break;
      case 'notContains':
        conds.push(
          `(${q} IS NULL OR ${textExpr} NOT ${like} ${params.add(`%${escapeLike(String(f.value ?? ''))}%`)})`,
        );
        break;
      case 'startsWith':
        conds.push(`${textExpr} ${like} ${params.add(`${escapeLike(String(f.value ?? ''))}%`)}`);
        break;
      case 'in': {
        const vals = (f.values ?? []).map((v) => toParam(v));
        const hasNull = vals.includes(null);
        const nonNull = vals.filter((v): v is string => v !== null);
        const parts: string[] = [];
        if (nonNull.length) parts.push(`${textExpr} = ANY(CAST(${params.add(nonNull)} AS text[]))`);
        if (hasNull) parts.push(`${q} IS NULL`);
        conds.push(parts.length ? `(${parts.join(' OR ')})` : 'FALSE');
        break;
      }
      case 'gt':
        conds.push(`${q} > ${typed(f.value)}`);
        break;
      case 'gte':
        conds.push(`${q} >= ${typed(f.value)}`);
        break;
      case 'lt':
        conds.push(`${q} < ${typed(f.value)}`);
        break;
      case 'lte':
        conds.push(`${q} <= ${typed(f.value)}`);
        break;
      case 'between': {
        const [a, b] = f.values ?? [];
        if (a !== undefined && a !== null && a !== '') conds.push(`${q} >= ${typed(a)}`);
        if (b !== undefined && b !== null && b !== '') conds.push(`${q} <= ${typed(b)}`);
        break;
      }
      case 'isNull':
        conds.push(`${q} IS NULL`);
        break;
      case 'notNull':
        conds.push(`${q} IS NOT NULL`);
        break;
    }
  }
  return conds;
}
