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
 * Texto da coluna Observação (igual ao do backend, sem a lista de atributos): adicionado e alterado
 * depois ganha " e Alterado".
 */
export function changeObservation(
  action: ChangeAction,
  observation: string | null,
  attributes: string[] = [],
): string {
  if (action === 'CREATE')
    return `${prefixed('Adicionado', observation)}${attributes.length ? ' e Alterado' : ''}`;
  if (action === 'DELETE') return prefixed('Removido', observation);
  return observation?.trim() ? `Ponto Alterado: ${observation.trim()}` : 'Ponto Alterado';
}
