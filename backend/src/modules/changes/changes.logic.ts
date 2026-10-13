/**
 * Regras da Tabela de Alterações (sem banco, para testar isoladamente).
 *
 * Um ponto tem no máximo uma linha:
 *  - DELETE: só a observação digitada (sem atributos);
 *  - CREATE: a observação digitada; se o ponto for editado depois, continua CREATE e ganha os
 *    atributos alterados (valor da criação × valor atual), mesmo que a lista volte a ficar vazia;
 *  - UPDATE: atributos alterados com o valor da PRIMEIRA versão e o valor ATUAL. Edições seguintes
 *    são mescladas; um atributo que volta ao valor original sai da lista; sem diferenças, a linha some.
 */

export type ChangeAction = 'CREATE' | 'UPDATE' | 'DELETE';

export interface ChangeEntry {
  action: ChangeAction;
  attributes: string[];
  oldValues: unknown[];
  newValues: unknown[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Aplica uma edição (`before` → `after`) sobre a entrada existente do ponto.
 * Retorna a nova entrada (UPDATE, ou CREATE se o ponto foi adicionado nesta tabela), `null` se nada
 * mais difere da primeira versão (remover a linha) ou `'keep'` se a linha existente não deve mudar
 * (ponto removido).
 */
export function mergeUpdate(
  existing: ChangeEntry | undefined,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  order: string[],
): ChangeEntry | null | 'keep' {
  if (existing?.action === 'DELETE') return 'keep';
  const old = new Map<string, unknown>();
  const now = new Map<string, unknown>();
  existing?.attributes.forEach((a, i) => {
    old.set(a, existing.oldValues[i] ?? null);
    now.set(a, existing.newValues[i] ?? null);
  });
  for (const k of order) {
    if (!(k in before) && !(k in after)) continue;
    if (same(before[k], after[k])) continue;
    if (!old.has(k)) old.set(k, before[k] ?? null);
    now.set(k, after[k] ?? null);
  }
  // Ordem das colunas da tabela; atributos antigos que não existem mais na tabela vão ao fim.
  const keys = [...order, ...[...old.keys()].filter((k) => !order.includes(k))];
  const attributes = keys.filter((k) => old.has(k) && !same(old.get(k), now.get(k)));
  const created = existing?.action === 'CREATE';
  if (!attributes.length && !created) return null;
  return {
    action: created ? 'CREATE' : 'UPDATE',
    attributes,
    oldValues: attributes.map((k) => old.get(k) ?? null),
    newValues: attributes.map((k) => now.get(k) ?? null),
  };
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** "Prefixo: observação", sem repetir o prefixo se a observação já começa com ele. */
function prefixed(prefix: string, observation: string | null): string {
  const obs = observation?.trim() ?? '';
  if (!obs) return prefix;
  if (fold(obs).startsWith(fold(prefix))) return obs;
  return `${prefix}: ${obs}`;
}

/**
 * Texto da coluna Observação: "Adicionado: …" (+ " e Alterado" se editado depois), "Removido: …" ou
 * "Ponto Alterado" (com `withAttributes`, "Ponto Alterado - atributo1, atributo2"), seguido da
 * observação, se houver.
 */
export function observationLabel(
  action: ChangeAction,
  observation: string | null,
  attributes: string[] = [],
  withAttributes = true,
): string {
  if (action === 'CREATE')
    return `${prefixed('Adicionado', observation)}${attributes.length ? ' e Alterado' : ''}`;
  if (action === 'DELETE') return prefixed('Removido', observation);
  const base =
    withAttributes && attributes.length
      ? `Ponto Alterado - ${attributes.join(', ')}`
      : 'Ponto Alterado';
  return observation?.trim() ? `${base}: ${observation.trim()}` : base;
}

/** Observação acrescentada à existente ("a; b"), sem repetir um trecho que já está lá. */
export function concatObservation(current: string | null, added: string | null): string | null {
  const cur = current?.trim() ?? '';
  const add = added?.trim() ?? '';
  if (!add) return cur || null;
  if (!cur) return add;
  if (cur.split(';').some((part) => part.trim() === add)) return cur;
  return `${cur}; ${add}`;
}

// ------------------------------------------------------------------ importação

/** Colunas reconhecidas na planilha de importação (cabeçalhos sem acento e sem diferenciar maiúsculas). */
export interface ImportColumns {
  table: number;
  id: number;
  observation: number;
  attributes: number;
  values: number;
}

/** Índices das colunas Tabela, ID, Observação, Atributos Alterados e Valores Novos (-1 = ausente). */
export function importColumns(headers: string[]): ImportColumns {
  const norm = headers.map((h) =>
    fold(String(h ?? ''))
      .replace(/\s+/g, ' ')
      .trim(),
  );
  const find = (...names: string[]) => norm.findIndex((h) => names.includes(h));
  return {
    table: find('tabela', 'camada', 'fonte'),
    id: find('id', 'registro'),
    observation: find('observacao', 'observacoes', 'obs'),
    attributes: find('atributos alterados', 'atributos', 'atributo'),
    values: find('valores novos', 'valores new', 'valor novo', 'valores', 'novos valores'),
  };
}

/**
 * Observação de remoção na importação ("Removido", "removido: motivo", sem diferenciar maiúsculas):
 * devolve o motivo (null se não houver); `undefined` se não for remoção.
 */
export function removalObservation(text: string | null | undefined): string | null | undefined {
  const m = /^\s*removido\s*(?:$|[:\-–]\s*([\s\S]*)$)/i.exec(text ?? '');
  if (!m) return undefined;
  return m[1]?.trim() || null;
}

/**
 * Lista de uma célula: "[ME, 70]" (formato da Tabela de Alterações), JSON ou valor único. Itens
 * separados por ";" se houver, senão por ","; item vazio = valor vazio (null).
 */
export function parseChangeList(cell: unknown): unknown[] {
  if (cell === null || cell === undefined) return [];
  if (typeof cell === 'number' || typeof cell === 'boolean') return [cell];
  let s = String(cell).trim();
  if (!s) return [];
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* não é JSON: lista no formato da tabela */
    }
    s = s.slice(1, -1);
    if (!s.trim()) return [];
  }
  const sep = s.includes(';') ? ';' : ',';
  return s.split(sep).map((item) => {
    const t = item.trim();
    return t === '' ? null : t;
  });
}

/** Atributos de todas as linhas, na ordem em que aparecem (colunas "old"/"new" do XLSX). */
export function attributeColumns(rows: { attributes: string[] }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const a of r.attributes) {
      if (!seen.has(a)) {
        seen.add(a);
        out.push(a);
      }
    }
  }
  return out;
}

/**
 * Valor de célula do XLSX: números viram número (o Excel em PT-BR mostra a vírgula decimal);
 * texto com cara de número também, exceto zeros à esquerda e números longos (códigos).
 */
export function xlsxValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^-?\d+([.,]\d+)?$/.test(s) && !/^-?0\d/.test(s) && s.replace(/\D/g, '').length <= 15) {
      return Number(s.replace(',', '.'));
    }
    return v;
  }
  return JSON.stringify(v);
}
