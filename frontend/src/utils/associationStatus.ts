import type { StatusRule } from '@/services/association';
import { AGGREGATES_LABEL } from './associationColumns';

/** Regra de Status de uma prioridade, como fica salva no diálogo. */
export interface StatusRuleState {
  /** Não atender a prioridade gera divergência no Status */
  consider: boolean;
  /** Se divergir, o Status mostra só esta prioridade */
  unique: boolean;
  /** "A:coluna" ou "B:coluna" cujo valor vai junto da divergência; "" = nenhum */
  attribute: string;
}

/** Chaves das regras dos pontos sem par (as das prioridades são os rótulos delas) */
export const STATUS_NEW = '@ponto-novo';
export const STATUS_UNIDENTIFIED = '@nao-identificado';

/** Nomes dos valores por atributo ("A:medicao" → { Sim: "Medido" }); valor vazio = "". */
export type StatusValueNames = Record<string, Record<string, string>>;

/** Agregados vêm sem gerar divergência; as demais prioridades geram. */
export const defaultStatusRule = (label: string): StatusRuleState => ({
  consider: label !== AGGREGATES_LABEL,
  unique: false,
  attribute: '',
});

export function parseAttribute(attribute: string) {
  const m = /^([AB]):(.+)$/.exec(attribute);
  return m ? { side: m[1] as 'A' | 'B', column: m[2] } : null;
}

export interface StatusLayer {
  id: string;
  name: string;
  columns: string[];
}

export interface StatusRow {
  key: string;
  title: string;
  /** Mostra "Divergência única" (só prioridades) */
  unique: boolean;
  /** Camadas de onde o atributo pode vir */
  sides: ('A' | 'B')[];
  note?: string;
}

/** Linhas da região Status: prioridades, depois os pontos sem par de A e de B. */
export function statusRows(labels: string[], nameA: string, includeUnmatchedB: boolean): StatusRow[] {
  return [
    ...labels.map((l): StatusRow => ({ key: l, title: l, unique: true, sides: ['A', 'B'] })),
    { key: STATUS_NEW, title: `Ponto Novo coletado em ${nameA}`, unique: false, sides: ['A'] },
    {
      key: STATUS_UNIDENTIFIED,
      title: `Não Identificado em ${nameA}`,
      unique: false,
      sides: ['B'],
      note: includeUnmatchedB ? undefined : 'só vai para o arquivo com "Listar também os pontos de B" marcado',
    },
  ];
}

/** Atributo escolhido que não pode ser usado na linha (coluna sumiu ou camada errada); null = ok. */
export function statusAttributeError(
  attribute: string,
  sides: ('A' | 'B')[],
  a: StatusLayer | null,
  b: StatusLayer | null,
): string | null {
  const at = parseAttribute(attribute);
  if (!at) return null;
  if (!sides.includes(at.side)) {
    return `Escolha um atributo de ${(sides[0] === 'A' ? a : b)?.name ?? sides[0]}.`;
  }
  const layer = at.side === 'A' ? a : b;
  return layer?.columns.includes(at.column)
    ? null
    : `A coluna "${at.column}" não existe em ${layer?.name ?? at.side}.`;
}

/** Regra enviada ao backend (só os nomes preenchidos). */
export function statusRuleRequest(rule: StatusRuleState, names: StatusValueNames): StatusRule {
  const at = rule.consider ? parseAttribute(rule.attribute) : null;
  const labels = Object.fromEntries(
    Object.entries(at ? (names[rule.attribute] ?? {}) : {})
      .map(([v, n]) => [v, n.trim()] as const)
      .filter(([, n]) => n),
  );
  return {
    consider: rule.consider,
    unique: rule.consider && rule.unique,
    attribute: at ? { ...at, labels } : null,
  };
}
