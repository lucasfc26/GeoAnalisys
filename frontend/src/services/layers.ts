import { request } from '@/lib/api';
import type { CrsDef, DataSource } from '@/types';

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
    /** Coluna com o par de coordenadas na mesma célula, quando não há X e Y separados */
    coordColumn?: string | null;
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
  xColumn: string | null;
  yColumn: string | null;
  coordinateSystem: string;
  proj4?: string | null;
  labelColumn?: string | null;
  categoryColumn?: string | null;
  types: Record<string, ImportType>;
  /** Coluna com as duas coordenadas na mesma célula (no lugar de X e Y) */
  coordColumn?: string | null;
  /** Gravar também as coordenadas convertidas (lat/long → UTM X/Y e zona; UTM → lat/long) */
  convertCoordinates?: boolean;
}

export interface CoordConversionPlan {
  source: { id: string; name: string; schema: string };
  crs: CrsDef;
  /** Colunas que recebem os valores; `exists` = já existe e será sobrescrita */
  columns: { field: string; name: string; exists: boolean }[];
  /** X/Y em texto (ex.: graus/minutos/segundos): passa a usar as colunas decimais criadas */
  repointXY: boolean;
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

  /** Colunas que a conversão de coordenadas vai criar/sobrescrever na tabela da camada. */
  conversionPlan: (sourceId: string) =>
    request<CoordConversionPlan>(`/layers/${encodeURIComponent(sourceId)}/convert-coordinates`),

  /** Grava na tabela as coordenadas convertidas (lat/long ↔ UTM) de todos os registros. */
  convertCoordinates: (sourceId: string) =>
    request<{
      source: DataSource;
      rows: number;
      converted: number;
      columns: string[];
      added: string[];
      repointed: boolean;
    }>(`/layers/${encodeURIComponent(sourceId)}/convert-coordinates`, { method: 'POST' }),

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
