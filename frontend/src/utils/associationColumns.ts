import { LAT_KEY, LNG_KEY } from '@/services/export';
import type { SourceSchema } from '@/types';
import { moveItem, type ColumnItem } from './exportColumns';

/** Chaves aceitas pelo backend (mesmos cabeçalhos do arquivo). */
export const KEY_ID_A = '@idA';
export const KEY_ID_B = '@idB';
export const KEY_DISTANCE = '@distance';
export const KEY_SCORE = '@score';
export const KEY_WEIGHT = '@weight';
export const KEY_STATUS = '@status';
export const AGGREGATES_LABEL = 'agregados';
export const critKey = (label: string) => `@crit:${label}`;
export const attrKey = (side: 'A' | 'B', column: string) => `${side}:${column}`;

export const criterionLabel = (c: { columnA: string; columnB: string }) =>
  c.columnA === c.columnB ? c.columnA : `${c.columnA} = ${c.columnB}`;

/** De onde vem a coluna: atributo da camada A, da camada B ou resultado da associação */
export type AssociationGroup = 'A' | 'B' | 'R';

export interface AssociationColumn {
  key: string;
  /** Cabeçalho no arquivo */
  label: string;
  /** Nome dentro da fonte (ex.: "medicao" em vez de "medicao Censo Atual") */
  name: string;
  group: AssociationGroup;
  hint: string;
  /** Marcada quando aparece pela primeira vez */
  defaultOn: boolean;
}

/**
 * Colunas possíveis do resultado: as da associação (marcadas) e os atributos de cada camada, com
 * latitude e longitude primeiro (desmarcados).
 */
export function associationColumns(
  a: SourceSchema | undefined,
  b: SourceSchema | undefined,
  critLabels: string[],
): AssociationColumn[] {
  const nameA = a?.source.name ?? 'A';
  const nameB = b?.source.name ?? 'B';
  const attrs = (side: 'A' | 'B', schema: SourceSchema | undefined): AssociationColumn[] => {
    if (!schema) return [];
    const layer = schema.source.name;
    const attr = (column: string, header: string, name = header): AssociationColumn => ({
      key: attrKey(side, column),
      label: `${header} ${layer}`,
      name,
      group: side,
      hint: layer,
      defaultOn: false,
    });
    return [
      attr(LAT_KEY, 'Latitude', 'Latitude (calculada)'),
      attr(LNG_KEY, 'Longitude', 'Longitude (calculada)'),
      ...schema.columns
        .filter((c) => c.kind !== 'geometry' && c.name !== schema.source.idColumn)
        .map((c) => attr(c.name, c.name)),
    ];
  };
  const result = (key: string, label: string, hint = 'resultado'): AssociationColumn => ({
    key,
    label,
    name: label,
    group: 'R',
    hint,
    defaultOn: true,
  });
  return [
    result(KEY_ID_A, `ID ${nameA}`),
    result(KEY_ID_B, `ID ${nameB}`),
    result(KEY_DISTANCE, 'Distância (m)'),
    result(KEY_SCORE, 'Prioridades atendidas'),
    result(KEY_WEIGHT, 'Pontuação', 'soma dos pesos atendidos'),
    result(KEY_STATUS, 'Status'),
    ...critLabels.map((l) => result(critKey(l), `Prioridade: ${l}`)),
    ...attrs('A', a),
    ...attrs('B', b),
  ];
}

const split = (items: ColumnItem[], without?: string) => ({
  on: items.filter((i) => i.enabled && i.key !== without),
  off: items.filter((i) => !i.enabled && i.key !== without),
});

/** Inclui a coluna no fim das escolhidas. */
export function addColumn(items: ColumnItem[], key: string): ColumnItem[] {
  const { on, off } = split(items, key);
  return [...on, { key, enabled: true }, ...off];
}

/** Tira a coluna das escolhidas (fica desmarcada, para não voltar sozinha). */
export function removeColumn(items: ColumnItem[], key: string): ColumnItem[] {
  const { on, off } = split(items, key);
  return [...on, { key, enabled: false }, ...off];
}

/** Move entre as escolhidas (`from`/`to` são posições na lista das escolhidas). */
export function moveColumn(items: ColumnItem[], from: number, to: number): ColumnItem[] {
  const { on, off } = split(items);
  return [...moveItem(on, from, to), ...off];
}

export const defaultAssociationItems = (cols: AssociationColumn[]): ColumnItem[] =>
  cols.map((c) => ({ key: c.key, enabled: c.defaultOn }));

/**
 * Mantém a escolha e a ordem salvas das colunas que ainda existem e acrescenta no fim as novas
 * (ex.: uma prioridade nova), marcadas conforme o padrão delas.
 */
export function reconcileItems(items: ColumnItem[] | undefined, cols: AssociationColumn[]): ColumnItem[] {
  if (!items?.length) return defaultAssociationItems(cols);
  const known = new Set(cols.map((c) => c.key));
  const kept = items.filter((i) => known.has(i.key));
  const seen = new Set(kept.map((i) => i.key));
  return [...kept, ...cols.filter((c) => !seen.has(c.key)).map((c) => ({ key: c.key, enabled: c.defaultOn }))];
}
