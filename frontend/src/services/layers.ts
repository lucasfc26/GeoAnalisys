import { API_BASE, ApiError, api, authHeaders, request } from '@/lib/api';
import type { CrsDef, DataSource } from '@/types';

export type ImportType = 'integer' | 'number' | 'text';
export type ImportCell = string | number | boolean | null;

export interface ImportPreview {
  /** Arquivo guardado no servidor (a importação e a troca de aba usam ele, sem reenviar) */
  uploadId: string;
  /** Abas do XLSX (vazio para CSV) */
  sheets: string[];
  sheet: string | null;
  headers: string[];
  /** Tipos detectados nas primeiras linhas */
  types: ImportType[];
  /** Primeiras linhas */
  rows: ImportCell[][];
  /** Total de linhas quando o arquivo é pequeno; null = só lido o começo (conta na importação) */
  total: number | null;
  /** Tamanho do arquivo (bytes) */
  size: number;
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
  /** Tipos escolhidos pelo usuário (os demais: detectados, alargando se preciso) */
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

export interface ImportResult {
  source: DataSource;
  rows: number;
  schema: string;
  tableName: string;
  invalid: Record<string, number>;
}

/** Andamento de uma importação em segundo plano. */
export interface ImportJob {
  id: string;
  /** reading = lendo e gravando; indexing = criando índices e registrando a camada */
  phase: 'reading' | 'indexing' | 'done' | 'error' | 'cancelled';
  /** Linhas gravadas */
  rows: number;
  /** Parte do arquivo lida (0–1) */
  percent: number;
  result?: ImportResult;
  error?: string;
}

/**
 * Envia o arquivo (com o progresso do envio, que o fetch não dá) e recebe a prévia. Sem limite de
 * tempo: arquivos de centenas de MB levam um tempo para subir.
 */
function uploadForPreview(file: File, onProgress: (fraction: number) => void) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<ImportPreview>((resolve, reject) => {
    xhr.open('POST', `${API_BASE}/layers/import/preview`);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response as ImportPreview);
      const body = xhr.response as { message?: string | string[]; error?: string } | null;
      const message = Array.isArray(body?.message)
        ? body.message.join('; ')
        : (body?.message ?? `Erro ${xhr.status}`);
      reject(
        new ApiError(
          xhr.status === 413 ? 'Arquivo grande demais para importar.' : message,
          xhr.status,
          body?.error ?? String(xhr.status),
        ),
      );
    };
    xhr.onerror = () =>
      reject(
        new ApiError('Não foi possível enviar o arquivo. O backend está rodando?', 0, 'NETWORK'),
      );
    xhr.onabort = () => reject(new ApiError('Envio cancelado.', 0, 'ABORTED'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Camadas criadas pelo sistema: importar CSV/XLSX/GeoJSON e copiar pontos selecionados. */
export const layersService = {
  /** Envia o arquivo e lê só o começo (abas, colunas, tipos, primeiras linhas). */
  upload: uploadForPreview,

  /** Prévia de um arquivo já enviado (ex.: outra aba), sem reenviar. */
  preview: (uploadId: string, sheet?: string | null) =>
    api.post<ImportPreview>('/layers/import/preview', { uploadId, sheet: sheet ?? undefined }),

  /** Começa a importação em segundo plano; acompanhe com `importStatus`. */
  startImport: (uploadId: string, config: ImportConfig) =>
    api.post<{ jobId: string }>('/layers/import', { uploadId, config }),

  importStatus: (jobId: string) => api.get<ImportJob>(`/layers/import/jobs/${jobId}`),

  cancelImport: (jobId: string) =>
    api.delete<{ cancelled: boolean }>(`/layers/import/jobs/${jobId}`),

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
