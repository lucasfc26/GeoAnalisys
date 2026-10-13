import { api, rawRequest } from '@/lib/api';
import type { FilterDef } from '@/types';
import { filenameFrom, triggerDownload } from './export';

export interface DuplicateRule {
  column: string;
  /** equal: valores iguais; different: valores diferentes (os dois preenchidos) */
  mode: 'equal' | 'different';
  /** sameCoord: só vale para pontos na mesma coordenada */
  scope: 'radius' | 'sameCoord';
  /** Negativo diminui a chance de duplicidade */
  weight: number;
}

export interface DuplicatesRequest {
  layer: { sourceId: string; filters: FilterDef[] };
  radius: number;
  sameCoordWeight: number;
  rules: DuplicateRule[];
  /** Camada de referência (ex.: Censo Anterior), associada 1 para 1; null = não usa */
  reference: {
    sourceId: string;
    filters: FilterDef[];
    maxDistance: number;
    bothMatched: number;
    oneMatched: number;
    noneMatched: number;
  } | null;
  /** Pontos sem associação perto do par (precisa da referência); null = desligado */
  density: { radius: number; minCount: number; weight: number } | null;
  minScore: number;
  /** Também lista os outros pares a até o raio dos pontos suspeitos (abaixo da mínima) */
  includeNearby: boolean;
}

export interface DupPointRef {
  id: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
}

export interface DupPair {
  group: number;
  distance: number;
  sameCoord: boolean;
  score: number;
  /** Abaixo da pontuação mínima (outro candidato de um ponto suspeito) */
  belowMin: boolean;
  reasons: string;
  nearbyUnmatched: number | null;
  a: DupPointRef & { ref: unknown };
  b: DupPointRef & { ref: unknown };
}

export interface DuplicatesPreview {
  summary: {
    name: string;
    referenceName: string | null;
    total: number;
    withoutCoords: number;
    matchedReference: number | null;
    /** Pares suspeitos (≥ pontuação mínima) */
    pairs: number;
    /** Outros pares dos pontos suspeitos, abaixo da mínima */
    nearbyPairs: number;
    /** Pares na prévia (grupos inteiros) */
    previewPairs: number;
    sameCoordPairs: number;
    points: number;
    groups: number;
    durationMs: number;
  };
  /** Primeiros grupos inteiros, do mais suspeito para o menos */
  pairs: DupPair[];
  /** Todos os pontos dos pares suspeitos */
  points: DupPointRef[];
}

export const duplicatesService = {
  preview: (req: DuplicatesRequest) => api.post<DuplicatesPreview>('/duplicates/preview', req),
  async download(req: DuplicatesRequest, format: 'xlsx' | 'csv') {
    const res = await rawRequest(`/duplicates/${format}`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
    const href = URL.createObjectURL(await res.blob());
    triggerDownload(href, filenameFrom(res, `duplicidades.${format}`));
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  },
};
