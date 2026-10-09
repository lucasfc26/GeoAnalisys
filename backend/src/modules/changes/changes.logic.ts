/**
 * Regras da Tabela de Alterações (sem banco, para testar isoladamente).
 *
 * Um ponto tem no máximo uma linha:
 *  - CREATE / DELETE: só a observação digitada (sem atributos);
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
 * Retorna a nova entrada UPDATE, `null` se nada mais difere da primeira versão (remover a linha)
 * ou `'keep'` se a linha existente não deve mudar (ponto adicionado/removido nesta tabela).
 */
export function mergeUpdate(
  existing: ChangeEntry | undefined,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  order: string[],
): ChangeEntry | null | 'keep' {
  if (existing && existing.action !== 'UPDATE') return 'keep';
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
  if (!attributes.length) return null;
  return {
    action: 'UPDATE',
    attributes,
    oldValues: attributes.map((k) => old.get(k) ?? null),
    newValues: attributes.map((k) => now.get(k) ?? null),
  };
}

/** Texto da coluna Observação (alterações: "Ponto Alterado - atributo1, atributo2"). */
export function observationLabel(
  action: ChangeAction,
  observation: string | null,
  attributes: string[] = [],
): string {
  if (action === 'CREATE') return `Adicionado: ${observation ?? ''}`.trim();
  if (action === 'DELETE') return `Removido: ${observation ?? ''}`.trim();
  return attributes.length ? `Ponto Alterado - ${attributes.join(', ')}` : 'Ponto Alterado';
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
