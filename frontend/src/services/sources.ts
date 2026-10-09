import { api, qs } from '@/lib/api';
import type {
  ColumnMeta,
  CrsDef,
  DataSource,
  SourceConfig,
  SourceSchema,
  SourceTestResult,
  TableInfo,
} from '@/types';

export const databaseService = {
  info: () =>
    api.get<{ database: string; version: string; user: string; postgis: string | null }>(
      '/database/info',
    ),
  databases: () => api.get<string[]>('/database/databases'),
  schemas: () => api.get<string[]>('/database/schemas'),
  tables: (schema: string) => api.get<TableInfo[]>(`/database/tables${qs({ schema })}`),
  columns: (schema: string, table: string) =>
    api.get<ColumnMeta[]>(`/database/columns${qs({ schema, table })}`),
};

export const sourcesService = {
  list: () => api.get<DataSource[]>('/tables'),
  get: (id: string) => api.get<DataSource>(`/tables/${id}`),
  schema: (id: string) => api.get<SourceSchema>(`/tables/${id}/schema`),
  create: (cfg: SourceConfig) => api.post<DataSource>('/tables', cfg),
  update: (id: string, cfg: Partial<SourceConfig>) => api.patch<DataSource>(`/tables/${id}`, cfg),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/tables/${id}`),
  test: (cfg: SourceConfig) => api.post<SourceTestResult>('/tables/test', cfg),
  distinct: (id: string, column: string, search?: string) =>
    api.get<{ value: string | null; count: number }[]>(
      `/tables/${id}/distinct${qs({ column, search })}`,
    ),
  indexes: (id: string) =>
    api.get<{ hasIndex: boolean; hasIdIndex: boolean }>(`/tables/${id}/indexes`),
  createIndexes: (id: string) => api.post<{ created: string[] }>(`/tables/${id}/indexes`),
};

export const crsService = {
  list: () => api.get<CrsDef[]>('/maps/crs'),
  toXY: (coordinateSystem: string, lat: number, lng: number, proj4?: string | null) =>
    api.post<{ x: number; y: number }>('/maps/convert/to-xy', {
      coordinateSystem,
      lat,
      lng,
      proj4: proj4 || undefined,
    }),
};

export const healthService = {
  database: () =>
    api.get<{ status: string; database?: string; postgis?: string | null; latencyMs: number }>(
      '/health/database',
    ),
};
