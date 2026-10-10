import { LAT_KEY, LNG_KEY } from '@/services/export';
import type { SourceSchema } from '@/types';

/** Coluna que pode ir para o arquivo exportado (mesma ordem e cabeçalhos do backend). */
export interface ExportColumn {
  key: string;
  /** Cabeçalho no arquivo */
  label: string;
  /** Origem/tipo, mostrado ao lado */
  hint: string;
}

export interface ColumnItem {
  key: string;
  enabled: boolean;
  /** Nome alternativo no cabeçalho do arquivo (vazio = nome original) */
  alias?: string;
}

/** Ordem padrão: ID, X, Y, latitude, longitude e as demais colunas da tabela. */
export function exportColumns({ source, crs, columns }: SourceSchema): ExportColumn[] {
  const isUtm = crs.kind === 'utm';
  const roles = new Set([source.idColumn, source.xColumn, source.yColumn]);
  return [
    { key: source.idColumn, label: source.idColumn, hint: 'ID' },
    { key: source.xColumn, label: isUtm ? 'UTMX' : 'X', hint: `coluna ${source.xColumn}` },
    { key: source.yColumn, label: isUtm ? 'UTMY' : 'Y', hint: `coluna ${source.yColumn}` },
    { key: LAT_KEY, label: 'Latitude', hint: 'calculada (WGS84)' },
    { key: LNG_KEY, label: 'Longitude', hint: 'calculada (WGS84)' },
    ...columns
      .filter((c) => !roles.has(c.name))
      .map((c) => ({ key: c.name, label: c.name, hint: c.formatType })),
  ];
}

export const defaultItems = (cols: ExportColumn[]): ColumnItem[] =>
  cols.map((c) => ({ key: c.key, enabled: true }));

/**
 * Colunas do modelo primeiro (na ordem dele, com os nomes alternativos); as demais desmarcadas, na
 * ordem padrão.
 */
export function itemsFromTemplate(
  cols: ExportColumn[],
  template: string[],
  headers: Record<string, string> = {},
): ColumnItem[] {
  const known = new Set(cols.map((c) => c.key));
  const picked = [...new Set(template)].filter((k) => known.has(k));
  const chosen = new Set(picked);
  return [
    ...picked.map((key) =>
      headers[key] ? { key, enabled: true, alias: headers[key] } : { key, enabled: true },
    ),
    ...cols.filter((c) => !chosen.has(c.key)).map((c) => ({ key: c.key, enabled: false })),
  ];
}

export const enabledKeys = (items: ColumnItem[]) =>
  items.filter((i) => i.enabled).map((i) => i.key);

/** Nomes alternativos das colunas marcadas ({ coluna: nome }); undefined se nenhuma foi renomeada. */
export function aliasesOf(items: ColumnItem[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const i of items) {
    const alias = i.alias?.trim();
    if (i.enabled && alias) out[i.key] = alias;
  }
  return Object.keys(out).length ? out : undefined;
}

export const sameAliases = (a?: Record<string, string>, b?: Record<string, string>) => {
  const ka = Object.keys(a ?? {});
  return ka.length === Object.keys(b ?? {}).length && ka.every((k) => a![k] === b?.[k]);
};

/** Cabeçalho que se repete no arquivo por causa de um nome alternativo (null = nenhum). */
export function duplicateHeader(
  items: ColumnItem[],
  cols: Map<string, ExportColumn>,
): string | null {
  const count = new Map<string, number>();
  const headerOf = (i: ColumnItem) => i.alias?.trim() || cols.get(i.key)?.label || i.key;
  const enabled = items.filter((i) => i.enabled);
  for (const i of enabled) {
    const h = headerOf(i).toLowerCase();
    count.set(h, (count.get(h) ?? 0) + 1);
  }
  const dup = enabled.find((i) => i.alias?.trim() && count.get(headerOf(i).toLowerCase())! > 1);
  return dup ? headerOf(dup) : null;
}

export const sameKeys = (a: string[], b: string[]) =>
  a.length === b.length && a.every((k, i) => k === b[i]);

/** Todas marcadas e na ordem padrão (exportação sem modelo). */
export const isDefaultOrder = (items: ColumnItem[], cols: ExportColumn[]) =>
  items.every((i) => i.enabled) &&
  sameKeys(
    enabledKeys(items),
    cols.map((c) => c.key),
  );

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
