import type { ChangeAction } from '@/services/changes';

/** Valor dentro de uma lista da Tabela de Alterações: decimal com ponto, vazio como nada. */
export function fmtChangeValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Lista no formato da tabela: [ME, 70] — vírgula separa itens, ponto é o decimal. */
export function fmtChangeList(values: unknown[]): string {
  return values.length ? `[${values.map(fmtChangeValue).join(', ')}]` : '';
}

/** Texto da coluna Observação (igual ao do XLSX gerado no backend). */
export function changeObservation(action: ChangeAction, observation: string | null): string {
  if (action === 'CREATE') return `Adicionado: ${observation ?? ''}`.trim();
  if (action === 'DELETE') return `Removido: ${observation ?? ''}`.trim();
  return 'Ponto Alterado';
}
