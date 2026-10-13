import { api, rawRequest } from '@/lib/api';
import type { DataSource, FilterDef } from '@/types';
import { filenameFrom, triggerDownload } from './export';

/** Como a divergência de uma prioridade aparece na coluna Status */
export interface StatusRule {
  consider: boolean;
  unique: boolean;
  /** Valor do atributo acrescentado à divergência; `labels`: valor → nome */
  attribute: { side: 'A' | 'B'; column: string; labels: Record<string, string> } | null;
}

export interface AssociationCriterion {
  columnA: string;
  columnB: string;
  maxDistance: number;
  /** Quanto a prioridade vale na disputa (padrão 1) */
  weight: number;
  status: StatusRule;
}

export interface AssociationRequest {
  a: { sourceId: string; filters: FilterDef[] };
  b: { sourceId: string; filters: FilterDef[] };
  maxDistance: number;
  criteria: AssociationCriterion[];
  /** Prioridade de agregados (único com único, vários na mesma coordenada com vários); null = desligada */
  aggregates: { maxDistance: number; weight: number; status: StatusRule } | null;
  includeUnmatchedB: boolean;
  /** Status dos pontos sem par (Ponto Novo: atributo de A; Não Identificado: de B) */
  unmatchedStatus: { newPoints: StatusRule; unidentified: StatusRule };
  /** Colunas do resultado, na ordem (chaves de utils/associationColumns) */
  columns: string[];
}

export interface AssociationPreview {
  headers: string[];
  rows: unknown[][];
  totalRows: number;
  summary: {
    nameA: string;
    nameB: string;
    totalA: number;
    totalB: number;
    matched: number;
    unmatchedA: number;
    unmatchedB: number;
    withoutCoordsA: number;
    withoutCoordsB: number;
    byCriteria: number[];
    /** Pares que atendem a todas as prioridades */
    normal: number;
    divergent: number;
    /** Linhas por Status, da mais frequente para a menos */
    byStatus: { status: string; count: number }[];
    averageDistance: number | null;
    durationMs: number;
  };
}

/** Onde gravar o resultado: nova camada em GeoAnalisysTemp ou substituir uma de lá */
export type AssociationLayerTarget = {
  /** Grava também UTM X/Y e zona (camada nova) ou as coordenadas convertidas (substituição) */
  convertCoordinates?: boolean;
} & (
  { mode: 'create'; name: string } | { mode: 'replace'; sourceId: string; adjustColumns: boolean }
);

export interface AssociationLayerResult {
  source: DataSource;
  rows: number;
  schema: string;
  tableName: string;
  /** Valores que não couberam no tipo da coluna (ficaram vazios), por coluna */
  invalid: Record<string, number>;
  /** Substituir com ajuste: colunas acrescentadas e apagadas */
  added: string[];
  removed: string[];
  /** Colunas do resultado que não foram gravadas (não existem na tabela) */
  ignored: string[];
  /** Substituir sem ajuste: colunas da tabela que ficaram vazias */
  empty: string[];
}

export const associationService = {
  preview: (req: AssociationRequest) => api.post<AssociationPreview>('/association/preview', req),
  toLayer: (req: AssociationRequest, target: AssociationLayerTarget) =>
    api.post<AssociationLayerResult>('/association/layer', { ...req, target }),
  async download(req: AssociationRequest, format: 'xlsx' | 'csv') {
    const res = await rawRequest(`/association/${format}`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
    const href = URL.createObjectURL(await res.blob());
    triggerDownload(href, filenameFrom(res, `associacao.${format}`));
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  },
};
