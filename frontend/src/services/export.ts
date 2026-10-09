import { API_BASE, api, authHeaders, qs, rawRequest } from '@/lib/api';
import type { FilterDef } from '@/types';

/** json = GeoJSON (pontos em lat/lng + atributos); kml = Google Earth. */
export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'kml';

export interface ExportOptions {
  sourceId: string;
  format: ExportFormat;
  scope: 'all' | 'filtered' | 'selected';
  filters: FilterDef[];
  ids: string[];
  delimiter: ';' | ',' | 'tab' | '|';
  decimal: '.' | ',';
  /** Colunas na ordem do arquivo; ausente = todas, na ordem padrão */
  columns?: string[];
}

/** Chaves das colunas calculadas pelo backend (latitude/longitude em WGS84). */
export const LAT_KEY = '@lat';
export const LNG_KEY = '@lng';

export interface ExportTemplate {
  id: string;
  sourceId: string;
  name: string;
  columns: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExportPreview {
  headers: string[];
  rows: unknown[][];
  /** Total de registros (null no escopo "selecionados") */
  total: number | null;
}

export function filenameFrom(res: Response, fallback: string) {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  if (star) return decodeURIComponent(star);
  return /filename="([^"]+)"/i.exec(cd)?.[1] ?? fallback;
}

export function triggerDownload(href: string, filename?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Corpo comum de exportação/prévia (filtros e IDs só quando o escopo usa). */
function scopeBody(o: Pick<ExportOptions, 'sourceId' | 'scope' | 'filters' | 'ids' | 'columns'>) {
  return {
    sourceId: o.sourceId,
    scope: o.scope,
    filters: o.scope === 'all' ? undefined : o.filters,
    ids: o.scope === 'selected' ? o.ids : undefined,
    columns: o.columns,
  };
}

/**
 * Todos/filtrados: download direto pelo navegador (streaming do backend, sem passar pela memória da página).
 * Selecionados: POST com os IDs e download do blob.
 */
export async function exportData(o: ExportOptions): Promise<void> {
  const csv = {
    delimiter: o.format === 'csv' ? o.delimiter : undefined,
    decimal: o.format === 'csv' ? o.decimal : undefined,
  };
  if (o.scope !== 'selected' && !import.meta.env.VITE_API_TOKEN) {
    const url = `${API_BASE}/export/${o.format}${qs({
      sourceId: o.sourceId,
      ...csv,
      scope: o.scope,
      filters: o.scope === 'filtered' && o.filters.length ? o.filters : undefined,
      columns: o.columns,
    })}`;
    triggerDownload(url);
    return;
  }
  const res = await rawRequest(`/export/${o.format}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...scopeBody(o), ...csv }),
  });
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  triggerDownload(href, filenameFrom(res, `pontos.${o.format}`));
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** GeoJSON da fonte em memória (para montar outros arquivos no navegador). */
export async function fetchGeoJson(
  o: Pick<ExportOptions, 'sourceId' | 'scope' | 'filters' | 'columns'>,
): Promise<{ type: 'FeatureCollection'; features: GeoJsonPoint[] }> {
  const res = await rawRequest('/export/json', {
    method: 'POST',
    body: JSON.stringify(scopeBody({ ...o, ids: [] })),
  });
  return res.json();
}

/** Registros selecionados como tabela (todas as colunas, valores tipados) — para copiar ao Excel. */
export async function fetchSelectedTable(
  sourceId: string,
  ids: string[],
): Promise<{ headers: string[]; rows: unknown[][] }> {
  const res = await rawRequest('/export/json', {
    method: 'POST',
    body: JSON.stringify(scopeBody({ sourceId, scope: 'selected', filters: [], ids })),
  });
  const { features } = (await res.json()) as { features: GeoJsonPoint[] };
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    for (const k of Object.keys(f.properties)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  return { headers, rows: features.map((f) => headers.map((h) => f.properties[h] ?? null)) };
}

export interface GeoJsonPoint {
  type: 'Feature';
  id?: unknown;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  properties: Record<string, unknown>;
}

export const exportService = {
  preview: (o: Pick<ExportOptions, 'sourceId' | 'scope' | 'filters' | 'ids' | 'columns'>) =>
    api.post<ExportPreview>('/export/preview', scopeBody(o)),
  templates: (sourceId: string) =>
    api.get<ExportTemplate[]>(`/export/templates${qs({ sourceId })}`),
  createTemplate: (t: { sourceId: string; name: string; columns: string[] }) =>
    api.post<ExportTemplate>('/export/templates', t),
  updateTemplate: (id: string, patch: { name?: string; columns?: string[] }) =>
    api.patch<ExportTemplate>(`/export/templates/${id}`, patch),
  removeTemplate: (id: string) => api.delete<{ deleted: boolean }>(`/export/templates/${id}`),
};
