/** Contagem de um grupo numa camada (valores das colunas de agrupamento como texto). */
export interface CountRow {
  keys: (string | null)[];
  n: number;
}

export interface MergedRow {
  /** Valores como aparecem na primeira camada em que o grupo existe */
  keys: (string | null)[];
  /** Uma contagem por camada, na ordem das camadas */
  counts: number[];
}

export interface LookupRow {
  keys: (string | null)[];
  name: string | null;
  /** Colunas da tabela de apoio usadas pelas colunas do quadro (texto) */
  values: Record<string, string | null>;
}

const NUMERIC = /^[+-]?\d+(?:[.,]\d+)?$/;

/**
 * Chave de comparação de um valor: "150", "150.0" e "150,00" são o mesmo número;
 * sem diferenciar maiúsculas, "Não", "nao" e " NÃO " também são o mesmo valor.
 */
export function normKey(v: string | null | undefined, ignoreCase: boolean): string {
  if (v === null || v === undefined) return '\u0000';
  let s = v.trim().replace(/\s+/g, ' ');
  if (NUMERIC.test(s)) {
    const n = Number(s.replace(',', '.'));
    if (Number.isFinite(n)) return String(n);
  }
  if (ignoreCase) s = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return s;
}

const groupKey = (keys: (string | null)[], ignoreCase: boolean) =>
  keys.map((k) => normKey(k, ignoreCase)).join('\u0001');

/** Junta as contagens das camadas por grupo (como um FULL OUTER JOIN), com 0 onde o grupo não existe. */
export function mergeCounts(perLayer: CountRow[][], ignoreCase: boolean): MergedRow[] {
  const byKey = new Map<string, MergedRow>();
  perLayer.forEach((rows, layer) => {
    for (const r of rows) {
      const k = groupKey(r.keys, ignoreCase);
      let m = byKey.get(k);
      if (!m) {
        m = { keys: r.keys, counts: perLayer.map(() => 0) };
        byKey.set(k, m);
      }
      m.counts[layer] += r.n;
    }
  });
  return [...byKey.values()];
}

/** Índice da tabela de apoio pelas colunas-chave (a primeira linha de cada chave vale). */
export function indexLookup(rows: LookupRow[], ignoreCase: boolean): Map<string, LookupRow> {
  const index = new Map<string, LookupRow>();
  for (const r of rows) {
    const k = groupKey(r.keys, ignoreCase);
    if (!index.has(k)) index.set(k, r);
  }
  return index;
}

export function findLookup(
  index: Map<string, LookupRow>,
  keys: (string | null)[],
  ignoreCase: boolean,
): LookupRow | null {
  return index.get(groupKey(keys, ignoreCase)) ?? null;
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

const INVALID_SHEET = /[\\/*?:[\]]/g;

/** Nome de aba do Excel (31 caracteres, sem os símbolos proibidos, único sem diferenciar maiúsculas). */
export function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(INVALID_SHEET, ' ').replace(/\s+/g, ' ').trim() || 'Bloco';
  let name = base.slice(0, 31);
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = `${base.slice(0, Math.max(0, 31 - suffix.length))}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Ordena pela descrição e depois pelos valores do grupo (números em ordem numérica, vazios no fim). */
export function compareRows(
  a: { label: string; keys: (string | null)[] },
  b: { label: string; keys: (string | null)[] },
): number {
  const c = collator.compare(a.label, b.label);
  if (c) return c;
  for (let i = 0; i < Math.max(a.keys.length, b.keys.length); i++) {
    const x = a.keys[i] ?? null;
    const y = b.keys[i] ?? null;
    if (x === y) continue;
    if (x === null) return 1;
    if (y === null) return -1;
    const d = collator.compare(x, y);
    if (d) return d;
  }
  return 0;
}
