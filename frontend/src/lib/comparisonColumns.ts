// Mantenha igual a backend/src/modules/comparison/comparison.columns.ts (a fonte da verdade é o backend).

/** Colunas da tabela do Quadro Comparativo, em ordem. */
export type ComparisonColumnKind = 'label' | 'group' | 'count' | 'diff' | 'lookup' | 'formula';

export interface ComparisonColumn {
  kind: ComparisonColumnKind;
  /** Cabeçalho; vazio = automático (ex.: nome da camada, nome da coluna) */
  title: string | null;
  /** group: coluna das camadas; lookup: coluna da tabela de apoio */
  column?: string | null;
  /** count: posição da camada (0 = primeira) */
  layer?: number | null;
  /** formula: ex.: [Quantidade Censo Atual] * potencia */
  expression?: string | null;
  /** Oculta: não aparece na tabela, mas pode ser usada nas fórmulas */
  hidden?: boolean;
  /** Soma na linha de total */
  sum?: boolean;
  /** Casas decimais; vazio = automático */
  decimals?: number | null;
}

export type Cell = string | number | null;

export class FormulaError extends Error {}

// ---------------------------------------------------------------------------------------------
// Fórmulas: + - * / ^, parênteses, números com ponto ou vírgula decimal, referências [Nome] ou
// nome_simples, funções abs, arred(x; casas), min, max, sevazio(x; y). Vazio em um operando = vazio.

export type FormulaNode =
  | { t: 'num'; v: number }
  | { t: 'ref'; name: string }
  | { t: 'neg'; a: FormulaNode }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: FormulaNode; b: FormulaNode }
  | { t: 'fn'; name: string; args: FormulaNode[] };

const FUNCTIONS: Record<string, [number, number]> = {
  abs: [1, 1],
  arred: [1, 2],
  min: [1, 20],
  max: [1, 20],
  sevazio: [2, 2],
};

type Token =
  | { k: 'num'; v: number; at: number }
  | { k: 'ref'; name: string; at: number }
  | { k: 'id'; name: string; at: number }
  | { k: 'op'; v: string; at: number }
  | { k: 'end'; at: number };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^\d+(?:[.,]\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[0].replace(',', '.')), at: i });
      i += num[0].length;
      continue;
    }
    if (ch === '[') {
      const end = src.indexOf(']', i + 1);
      if (end < 0) throw new FormulaError(`"[" sem "]" na posição ${i + 1}`);
      const name = src.slice(i + 1, end).trim();
      if (!name) throw new FormulaError(`Referência vazia "[]" na posição ${i + 1}`);
      out.push({ k: 'ref', name, at: i });
      i = end + 1;
      continue;
    }
    const id = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i));
    if (id) {
      out.push({ k: 'id', name: id[0], at: i });
      i += id[0].length;
      continue;
    }
    if ('+-*/^();'.includes(ch)) {
      out.push({ k: 'op', v: ch, at: i });
      i++;
      continue;
    }
    if (ch === '×') {
      out.push({ k: 'op', v: '*', at: i++ });
      continue;
    }
    if (ch === '÷') {
      out.push({ k: 'op', v: '/', at: i++ });
      continue;
    }
    if (ch === '−') {
      out.push({ k: 'op', v: '-', at: i++ });
      continue;
    }
    throw new FormulaError(
      ch === ','
        ? `Use ";" para separar os argumentos das funções (posição ${i + 1})`
        : `Caractere inesperado "${ch}" na posição ${i + 1}`,
    );
  }
  out.push({ k: 'end', at: src.length });
  return out;
}

export function parseFormula(src: string): FormulaNode {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v: string) => {
    const t = tokens[p];
    return t.k === 'op' && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Esperado "${v}" na posição ${peek().at + 1}`);
    p++;
  };

  const expr = (): FormulaNode => {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[p++] as { v: '+' | '-' }).v;
      a = { t: 'bin', op, a, b: term() };
    }
    return a;
  };
  const term = (): FormulaNode => {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[p++] as { v: '*' | '/' }).v;
      a = { t: 'bin', op, a, b: unary() };
    }
    return a;
  };
  const unary = (): FormulaNode => {
    if (isOp('-')) {
      p++;
      return { t: 'neg', a: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): FormulaNode => {
    const a = primary();
    if (isOp('^')) {
      p++;
      return { t: 'bin', op: '^', a, b: unary() };
    }
    return a;
  };
  const primary = (): FormulaNode => {
    const t = tokens[p];
    if (t.k === 'num') {
      p++;
      return { t: 'num', v: t.v };
    }
    if (t.k === 'ref') {
      p++;
      return { t: 'ref', name: t.name };
    }
    if (t.k === 'id') {
      p++;
      if (!isOp('(')) return { t: 'ref', name: t.name };
      const name = t.name.toLowerCase();
      const arity = FUNCTIONS[name];
      if (!arity) throw new FormulaError(`Função desconhecida: ${t.name}`);
      p++;
      const args: FormulaNode[] = [];
      if (!isOp(')')) {
        args.push(expr());
        while (isOp(';')) {
          p++;
          args.push(expr());
        }
      }
      expect(')');
      if (args.length < arity[0] || args.length > arity[1]) {
        throw new FormulaError(`Número de argumentos errado em ${t.name}()`);
      }
      return { t: 'fn', name, args };
    }
    if (isOp('(')) {
      p++;
      const e = expr();
      expect(')');
      return e;
    }
    if (t.k === 'end') throw new FormulaError('Fórmula incompleta');
    throw new FormulaError(`Inesperado na posição ${t.at + 1}`);
  };

  if (!src.trim()) throw new FormulaError('Fórmula vazia');
  const node = expr();
  if (peek().k !== 'end') {
    throw new FormulaError(
      isOp(')')
        ? `")" sem "(" na posição ${peek().at + 1}`
        : `Inesperado na posição ${peek().at + 1}`,
    );
  }
  return node;
}

export function formulaRefs(node: FormulaNode, out: string[] = []): string[] {
  if (node.t === 'ref') out.push(node.name);
  else if (node.t === 'neg') formulaRefs(node.a, out);
  else if (node.t === 'bin') {
    formulaRefs(node.a, out);
    formulaRefs(node.b, out);
  } else if (node.t === 'fn') node.args.forEach((a) => formulaRefs(a, out));
  return out;
}

export function evalFormula(
  node: FormulaNode,
  get: (name: string) => number | null,
): number | null {
  const ev = (n: FormulaNode): number | null => {
    switch (n.t) {
      case 'num':
        return n.v;
      case 'ref':
        return get(n.name);
      case 'neg': {
        const a = ev(n.a);
        return a === null ? null : -a;
      }
      case 'bin': {
        const a = ev(n.a);
        const b = ev(n.b);
        if (a === null || b === null) return null;
        const r =
          n.op === '+'
            ? a + b
            : n.op === '-'
              ? a - b
              : n.op === '*'
                ? a * b
                : n.op === '/'
                  ? a / b
                  : a ** b;
        return Number.isFinite(r) ? r : null;
      }
      case 'fn': {
        if (n.name === 'sevazio') return ev(n.args[0]) ?? ev(n.args[1]);
        const args = n.args.map(ev);
        if (args.some((a) => a === null)) return null;
        const v = args as number[];
        if (n.name === 'abs') return Math.abs(v[0]);
        if (n.name === 'min') return Math.min(...v);
        if (n.name === 'max') return Math.max(...v);
        const f = 10 ** Math.round(v[1] ?? 0);
        return Math.round(v[0] * f) / f;
      }
    }
  };
  return ev(node);
}

// ---------------------------------------------------------------------------------------------

const NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

/** "150", "150.5" e "150,5" viram número; o resto, null. */
export function toNumber(v: Cell | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = v.trim();
  return NUMBER.test(s) ? Number(s.replace(',', '.')) : null;
}

/** Nome sem diferenciar maiúsculas, acentos e espaços extras. */
export const refKey = (s: string) =>
  s.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function columnTitle(c: ComparisonColumn, index: number, layers: string[]): string {
  const t = c.title?.trim();
  if (t) return t;
  switch (c.kind) {
    case 'label':
      return 'Descrição';
    case 'group':
    case 'lookup':
      return c.column || `Coluna ${index + 1}`;
    case 'count':
      return layers[c.layer ?? 0] ?? `Camada ${(c.layer ?? 0) + 1}`;
    case 'diff':
      return 'Diferença';
    default:
      return `Coluna ${index + 1}`;
  }
}

export const NUMERIC_KINDS: ComparisonColumnKind[] = ['count', 'diff', 'lookup', 'formula'];

/** Valores de uma linha do quadro, de onde as colunas tiram seus dados. */
export interface RowContext {
  label: string;
  /** Valores das colunas de agrupamento do bloco */
  group: Map<string, string | null>;
  counts: number[];
  diff: number;
  /** Linha da tabela de apoio (null = sem correspondência ou bloco sem tabela de apoio) */
  lookup: Record<string, string | null> | null;
}

type Ref =
  { t: 'col'; index: number } | { t: 'group'; column: string } | { t: 'lookup'; column: string };

export interface CompiledColumns {
  titles: string[];
  /** Colunas da tabela de apoio que precisam ser lidas */
  lookupColumns: string[];
  /** Valores de todas as colunas (inclusive as ocultas), sem arredondar */
  evaluate(row: RowContext): Cell[];
}

/**
 * Valida as colunas e resolve as referências das fórmulas: primeiro o título de outra coluna, depois
 * uma coluna das camadas (valor do grupo; vazio se o bloco não agrupa por ela), depois uma coluna da
 * tabela de apoio. Lança FormulaError com a coluna e o problema.
 */
export function compileColumns(
  columns: ComparisonColumn[],
  layers: string[],
  available: { layerColumns: string[]; lookupColumns: string[] | null },
): CompiledColumns {
  if (!columns.length) throw new FormulaError('Escolha ao menos uma coluna');
  const titles = columns.map((c, i) => columnTitle(c, i, layers));
  const byTitle = new Map<string, number>();
  titles.forEach((t, i) => {
    const k = refKey(t);
    if (byTitle.has(k)) throw new FormulaError(`Duas colunas com o título "${t}"`);
    byTitle.set(k, i);
  });
  const layerCols = new Map(available.layerColumns.map((c) => [refKey(c), c]));
  const lookupCols = new Map((available.lookupColumns ?? []).map((c) => [refKey(c), c]));
  const needLookup = new Set<string>();

  const fail = (i: number, msg: string): never => {
    throw new FormulaError(`Coluna "${titles[i]}": ${msg}`);
  };

  const formulas: (FormulaNode | null)[] = [];
  const refs: Map<string, Ref>[] = [];
  columns.forEach((c, i) => {
    formulas.push(null);
    refs.push(new Map());
    if (c.kind === 'group') {
      if (!c.column || !layerCols.has(refKey(c.column)))
        fail(i, `coluna das camadas inexistente: ${c.column ?? '(nenhuma)'}`);
    } else if (c.kind === 'lookup') {
      if (!available.lookupColumns) fail(i, 'a tabela de apoio está desligada');
      const real = lookupCols.get(refKey(c.column ?? ''));
      if (!real) fail(i, `coluna inexistente na tabela de apoio: ${c.column ?? '(nenhuma)'}`);
      needLookup.add(real!);
    } else if (c.kind === 'count') {
      const l = c.layer ?? -1;
      if (!Number.isInteger(l) || l < 0 || l >= layers.length) fail(i, 'camada inexistente');
    } else if (c.kind === 'formula') {
      let node: FormulaNode;
      try {
        node = parseFormula(c.expression ?? '');
      } catch (err) {
        return fail(i, (err as Error).message);
      }
      formulas[i] = node;
      for (const name of formulaRefs(node)) {
        const k = refKey(name);
        if (refs[i].has(k)) continue;
        const col = byTitle.get(k);
        if (col !== undefined) {
          if (col === i) fail(i, 'a fórmula usa a própria coluna');
          refs[i].set(k, { t: 'col', index: col });
        } else if (layerCols.has(k)) {
          refs[i].set(k, { t: 'group', column: layerCols.get(k)! });
        } else if (lookupCols.has(k)) {
          const real = lookupCols.get(k)!;
          needLookup.add(real);
          refs[i].set(k, { t: 'lookup', column: real });
        } else {
          fail(i, `referência desconhecida: ${name}`);
        }
      }
    }
  });

  // Fórmulas que dependem umas das outras em círculo
  const state = columns.map(() => 0); // 0 = não visitada, 1 = visitando, 2 = ok
  const visit = (i: number) => {
    if (state[i] === 2) return;
    if (state[i] === 1) fail(i, 'referência circular entre fórmulas');
    state[i] = 1;
    for (const r of refs[i].values()) if (r.t === 'col') visit(r.index);
    state[i] = 2;
  };
  columns.forEach((_, i) => visit(i));

  const groupValue = (row: RowContext, column: string) => {
    for (const [name, v] of row.group) if (refKey(name) === refKey(column)) return v;
    return null;
  };

  return {
    titles,
    lookupColumns: [...needLookup],
    evaluate(row) {
      const memo = new Map<number, Cell>();
      const cell = (i: number): Cell => {
        if (memo.has(i)) return memo.get(i)!;
        const c = columns[i];
        let v: Cell;
        switch (c.kind) {
          case 'label':
            v = row.label;
            break;
          case 'group':
            v = groupValue(row, c.column!);
            break;
          case 'count':
            v = row.counts[c.layer!];
            break;
          case 'diff':
            v = row.diff;
            break;
          case 'lookup': {
            const raw = row.lookup?.[lookupCols.get(refKey(c.column!))!] ?? null;
            v = toNumber(raw) ?? raw;
            break;
          }
          case 'formula':
            v = evalFormula(formulas[i]!, (name) => {
              const r = refs[i].get(refKey(name))!;
              if (r.t === 'col') return toNumber(cell(r.index));
              if (r.t === 'group') return toNumber(groupValue(row, r.column));
              return toNumber(row.lookup?.[r.column] ?? null);
            });
            break;
        }
        memo.set(i, v);
        return v;
      };
      return columns.map((_, i) => cell(i));
    },
  };
}

/** Colunas padrão: descrição, colunas de agrupamento, quantidade por camada e diferença. */
export function defaultColumns(groupBy: string[], layerCount: number): ComparisonColumn[] {
  return [
    { kind: 'label', title: null },
    ...groupBy.map((column): ComparisonColumn => ({ kind: 'group', title: null, column })),
    ...Array.from({ length: layerCount }, (_, layer): ComparisonColumn => ({
      kind: 'count',
      title: null,
      layer,
      sum: true,
    })),
    { kind: 'diff', title: null, sum: true },
  ];
}

export function roundCell(v: Cell, decimals: number | null | undefined): Cell {
  if (typeof v !== 'number') return v;
  const f = 10 ** (decimals ?? 6);
  return Math.round(v * f) / f;
}
