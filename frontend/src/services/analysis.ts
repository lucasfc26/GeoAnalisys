import { api } from '@/lib/api';
import type { ToolPoint } from '@/lib/selectPoints';
import type { FilterDef } from '@/types';

interface LayerRef {
  sourceId: string;
  filters: FilterDef[];
}

export interface OutsideRequest {
  layer: LayerRef;
  boundaryName: string;
  /** [polígono][anel][ponto][lng, lat] */
  polygons: number[][][][];
  /** Fora, mas a até esta distância (m) da borda, não conta */
  tolerance: number;
}

export interface OutsideResult {
  summary: {
    name: string;
    boundaryName: string;
    total: number;
    withoutCoords: number;
    inside: number;
    withinTolerance: number;
    outside: number;
    truncated: boolean;
    durationMs: number;
  };
  /** Do mais distante da borda para o mais próximo */
  points: (ToolPoint & { distance: number })[];
}

export interface AttributeDistanceRequest {
  layer: LayerRef & { column: string };
  /** null = centro dos pontos da própria camada com o mesmo valor */
  reference: (LayerRef & { column: string }) | null;
  maxDistance: number;
  center: 'median' | 'mean';
  minPoints: number;
  stripZeros: boolean;
  /** Valores de preenchimento que não identificam o local (ex.: "SN", "0") */
  ignore: string[];
}

export interface AttributeFarPoint extends ToolPoint {
  value: unknown;
  distance: number;
  /** Ponto da referência mais próximo com o mesmo valor (id), ou o centro (id null) */
  target: { id: string | null; lat: number; lng: number } | null;
  /** Pontos com o mesmo valor (na referência, ou na própria camada) */
  sameValue: number;
}

export interface AttributeDistanceResult {
  summary: {
    name: string;
    column: string;
    referenceName: string | null;
    referenceColumn: string | null;
    total: number;
    withoutCoords: number;
    withoutValue: number;
    ignored: number;
    noMatch: number;
    fewPoints: number;
    evaluated: number;
    far: number;
    truncated: boolean;
    durationMs: number;
  };
  /** Do mais distante para o mais próximo */
  points: AttributeFarPoint[];
  /** Com referência: pontos cujo valor não existe nela */
  noMatch: (ToolPoint & { value: unknown })[];
}

export const analysisService = {
  outside: (req: OutsideRequest) => api.post<OutsideResult>('/analysis/outside', req),
  attributeDistance: (req: AttributeDistanceRequest) =>
    api.post<AttributeDistanceResult>('/analysis/attribute-distance', req),
};
