import { request } from '@/lib/api';
import type { DataSource } from '@/types';

export type ImportType = 'integer' | 'number' | 'text';
export type ImportCell = string | number | boolean | null;

export interface ImportPreview {
  /** Abas do XLSX (vazio para CSV) */
  sheets: string[];
  sheet: string | null;
  headers: string[];
  types: ImportType[];
  rows: ImportCell[][];
  total: number;
  suggested: {
    idColumn: string | null;
    xColumn: string | null;
    yColumn: string | null;
    coordinates: 'geographic' | 'projected' | null;
    /** Sistema de coordenadas do arquivo, quando conhecido (GeoJSON/KML: EPSG:4326) */
    coordinateSystem?: string | null;
  };
}

export interface ImportConfig {
  sheet: string | null;
  name: string;
  /** Padrão: GeoAnalisysTemp */
  schema: string;
  /** null = ID automático */
  idColumn: string | null;
  xColumn: string;
  yColumn: string;
  coordinateSystem: string;
  proj4?: string | null;
  labelColumn?: string | null;
  categoryColumn?: string | null;
  types: Record<string, ImportType>;
}

const form = (file: File, fields: Record<string, string>) => {
  const fd = new FormData();
  fd.append('file', file);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};

/** Camadas criadas pelo sistema: importar CSV/XLSX/GeoJSON e copiar pontos selecionados. */
export const layersService = {
  preview: (file: File, sheet?: string | null) =>
    request<ImportPreview>('/layers/import/preview', {
      method: 'POST',
      body: form(file, sheet ? { sheet } : {}),
    }),

  import: (file: File, config: ImportConfig) =>
    request<{
      source: DataSource;
      rows: number;
      tableName: string;
      invalid: Record<string, number>;
    }>('/layers/import', {
      method: 'POST',
      body: form(file, { config: JSON.stringify(config) }),
    }),

  copy: (sourceId: string, ids: string[], name: string, schema?: string) =>
    request<{ source: DataSource; rows: number; tableName: string }>('/layers/copy', {
      method: 'POST',
      body: JSON.stringify({ sourceId, ids, name, schema }),
    }),

  /** Camada removida do mapa: apaga a tabela se estiver em GeoAnalisysTemp (outros schemas: nada). */
  removeTemp: (sourceId: string) =>
    request<{ dropped: boolean; tableName?: string }>(
      `/layers/temp/${encodeURIComponent(sourceId)}`,
      { method: 'DELETE' },
    ),
};

/** Schema das tabelas criadas pelo sistema (importação e cópia de pontos). */
export const TEMP_SCHEMA = 'GeoAnalisysTemp';

/** Lista de schemas com o GeoAnalisysTemp no topo (ele é criado na primeira camada). */
export const withTempSchema = (schemas: string[] | undefined) => [
  TEMP_SCHEMA,
  ...(schemas ?? []).filter((s) => s !== TEMP_SCHEMA),
];
