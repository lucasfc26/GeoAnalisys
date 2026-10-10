import { api, qs } from '@/lib/api';
import type {
  AtResponse,
  Bounds,
  FilterDef,
  LatLng,
  LayerPayload,
  MapPointsResponse,
  PointRecord,
  QueryResponse,
  SearchResult,
  SelectedGroup,
  SelectionResponse,
  TransformMode,
  TranslateResponse,
} from '@/types';

const f = (filters: FilterDef[]) => (filters.length ? filters : undefined);

export const pointsService = {
  bbox: (
    sourceId: string,
    b: Bounds,
    filters: FilterDef[],
    signal?: AbortSignal,
    style?: { styleColumn?: string | null; label?: string },
  ) =>
    api.get<MapPointsResponse>(
      `/points/bbox${qs({ sourceId, ...b, filters: f(filters), styleColumn: style?.styleColumn, label: style?.label })}`,
      signal,
    ),

  layer: (
    sourceId: string,
    opts: { filters: FilterDef[]; styleColumn: string | null; label: string; version?: string },
    signal?: AbortSignal,
  ) =>
    api.get<LayerPayload>(
      `/points/layer${qs({
        sourceId,
        filters: f(opts.filters),
        styleColumn: opts.styleColumn,
        label: opts.label,
        version: opts.version,
      })}`,
      signal,
    ),

  labelPreview: (sourceId: string, label: string, signal?: AbortSignal) =>
    api.get<{ id: string; label: string | null }[]>(
      `/points/label-preview${qs({ sourceId, label })}`,
      signal,
    ),

  extent: (sourceId: string, filters: FilterDef[]) =>
    api.get<{ count: number; bounds: Bounds | null }>(
      `/points/extent${qs({ sourceId, filters: f(filters) })}`,
    ),

  at: (sourceId: string, x: number, y: number, filters: FilterDef[], idsOnly = false) =>
    api.get<AtResponse>(
      `/points/at${qs({ sourceId, x, y, filters: f(filters), idsOnly: idsOnly || undefined })}`,
    ),

  get: (sourceId: string, id: string) =>
    api.get<PointRecord>(`/points/${encodeURIComponent(id)}${qs({ sourceId })}`),

  records: (sourceId: string, ids: string[], full = false) =>
    api.post<(PointRecord & { data: { label?: string; category?: string } })[]>('/points/records', {
      sourceId,
      ids,
      full,
    }),

  search: (sourceId: string, q: string, signal?: AbortSignal) =>
    api.get<SearchResult[]>(`/points/search${qs({ sourceId, q })}`, signal),

  selection: (sourceId: string, polygon: LatLng[], filters: FilterDef[]) =>
    api.post<SelectionResponse>('/points/selection', { sourceId, polygon, filters: f(filters) }),

  query: (sourceId: string, filters: FilterDef[]) =>
    api.post<QueryResponse>('/points/query', { sourceId, filters }),

  lookup: (sourceId: string, column: string, values: string[]) =>
    api.post<{
      column: string;
      /** `removed`: não está na tabela, mas foi removido (Tabela de Alterações), com a justificativa */
      items: { value: string; groups: SelectedGroup[]; removed?: { observation: string | null } }[];
    }>('/points/lookup', {
      sourceId,
      column,
      values,
    }),

  /** Resumo por uma coluna (padrão: categoria) ou pela combinação de várias (valores concatenados). */
  summary: (sourceId: string, ids: string[], columns?: string[]) =>
    api.post<{
      total: number;
      column: string | null;
      values: { value: string | null; count: number }[];
    }>('/points/summary', { sourceId, ids, columns: columns?.length ? columns : undefined }),

  create: (sourceId: string, data: Record<string, unknown>, observation?: string) =>
    api.post<PointRecord>('/points', { sourceId, data, observation }),

  update: (sourceId: string, id: string, data: Record<string, unknown>) =>
    api.patch<PointRecord>(`/points/${encodeURIComponent(id)}`, { sourceId, data }),

  remove: (sourceId: string, id: string, observation?: string) =>
    api.delete<{ deleted: number }>(
      `/points/${encodeURIComponent(id)}${qs({ sourceId, observation })}`,
    ),

  bulkUpdate: (sourceId: string, ids: string[], changes: Record<string, unknown>) =>
    api.patch<{ updated: number }>('/points/bulk', { sourceId, ids, changes }),

  /** Registros que atendem aos filtros (com ou sem coordenada). */
  count: (sourceId: string, filters: FilterDef[], signal?: AbortSignal) =>
    api
      .get<{ total: number }>(`/points${qs({ sourceId, filters: f(filters), pageSize: 1 })}`, signal)
      .then((r) => r.total),

  /** Substituição: mesmo valor em todos os registros filtrados. */
  replace: (sourceId: string, filters: FilterDef[], changes: Record<string, unknown>) =>
    api.patch<{ updated: number }>('/points/replace', { sourceId, filters, changes }),

  translate: (
    sourceId: string,
    ids: string[],
    mode: TransformMode,
    from: LatLng,
    to: LatLng,
    observation?: string,
  ) =>
    api.post<TranslateResponse>('/points/translate', {
      sourceId,
      ids,
      mode,
      from,
      to,
      observation,
    }),

  bulkDelete: (sourceId: string, ids: string[], observation?: string) =>
    api.delete<{ deleted: number }>('/points/bulk', { sourceId, ids, observation }),
};
