import { api, rawRequest } from '@/lib/api';
import type { Cell, ComparisonColumn, ComparisonColumnKind } from '@/lib/comparisonColumns';
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
}

export interface ComparisonRequest {
  /** Em ordem: a diferença é a última − a primeira */
  layers: { sourceId: string; label: string | null; filters: FilterDef[] }[];
  blocks: ComparisonBlock[];
  lookup: ComparisonLookup | null;
  ignoreCase: boolean;
  /** Colunas da tabela, em ordem (inclusive as ocultas, usadas nas fórmulas) */
  columns: ComparisonColumn[];
}

export interface ComparisonSection {
  title: string;
  groupBy: string[];
  distinctColumn: string | null;
  lookup: boolean;
  /** cells: uma por coluna visível; matched: null = bloco sem tabela de apoio */
  rows: { cells: Cell[]; matched: boolean | null }[];
  /** Soma das colunas marcadas para somar; "Total" na descrição */
  totals: Cell[];
  unmatched: number;
}

export interface ComparisonResult {
  summary: {
    layers: string[];
    /** Colunas visíveis, na ordem das células */
    columns: { title: string; kind: ComparisonColumnKind; decimals: number | null }[];
    lookupName: string | null;
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
  /** Pontos das camadas que estão num grupo sem correspondência na tabela de apoio. */
  unmatched: (req: ComparisonRequest) =>
    api.post<{ layers: { sourceId: string; label: string; column: string; ids: string[] }[] }>(
      '/comparison/unmatched',
      req,
    ),
};
