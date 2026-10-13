import { api, rawRequest } from '@/lib/api';
import type { FilterDef } from '@/types';
import { filenameFrom, triggerDownload } from './export';

export interface ComparisonBlock {
  /** Ex.: "Estimados" */
  title: string;
  /** Ex.: medicao = 'Não'; aplicadas a todas as camadas */
  conditions: FilterDef[];
  /** Ex.: tipo_lampada, potencia; vazio = uma linha com o total do bloco */
  groupBy: string[];
  /** null = conta registros; coluna = conta valores distintos (ex.: "circuito exclusivo") */
  distinctColumn: string | null;
  useLookup: boolean;
}

export interface ComparisonLookup {
  schema: string;
  table: string;
  /** Coluna das camadas ↔ coluna da tabela de apoio (ex.: tipo_lampada ↔ tipo) */
  keys: { column: string; lookupColumn: string }[];
  nameColumn: string | null;
  /** Multiplicado pela diferença (ex.: consumo) */
  factorColumn: string | null;
}

export interface ComparisonRequest {
  /** Em ordem: a diferença é a última − a primeira */
  layers: { sourceId: string; label: string | null; filters: FilterDef[] }[];
  blocks: ComparisonBlock[];
  lookup: ComparisonLookup | null;
  ignoreCase: boolean;
}

export interface ComparisonRow {
  /** Nome da tabela de apoio, ou os valores do grupo, ou o título do bloco */
  label: string;
  values: (string | null)[];
  counts: number[];
  /** Última camada − primeira */
  diff: number;
  factor: number | null;
  /** factor × diff */
  result: number | null;
  /** null = bloco sem tabela de apoio */
  matched: boolean | null;
}

export interface ComparisonSection {
  title: string;
  groupBy: string[];
  distinctColumn: string | null;
  lookup: boolean;
  rows: ComparisonRow[];
  totals: { counts: number[]; diff: number; result: number | null };
  unmatched: number;
}

export interface ComparisonResult {
  summary: {
    layers: string[];
    lookupName: string | null;
    factorName: string | null;
    rows: number;
    unmatched: number;
    durationMs: number;
  };
  sections: ComparisonSection[];
}

export const comparisonService = {
  preview: (req: ComparisonRequest) => api.post<ComparisonResult>('/comparison/preview', req),
  async download(req: ComparisonRequest, format: 'xlsx' | 'csv') {
    const res = await rawRequest(`/comparison/${format}`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
    const href = URL.createObjectURL(await res.blob());
    triggerDownload(href, filenameFrom(res, `comparativo.${format}`));
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  },
};
