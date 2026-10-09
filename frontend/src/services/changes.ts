import { api, rawRequest } from '@/lib/api';
import { filenameFrom, triggerDownload } from './export';

export type ChangeAction = 'CREATE' | 'UPDATE' | 'DELETE';

/** Linha da Tabela de Alterações (um ponto adicionado, removido ou alterado). */
export interface ChangeRow {
  id: string;
  sourceId: string;
  sourceName: string;
  idColumn: string | null;
  recordId: string;
  action: ChangeAction;
  observation: string | null;
  attributes: string[];
  oldValues: unknown[];
  newValues: unknown[];
  updatedAt: string;
}

export const changesService = {
  list: () => api.get<ChangeRow[]>('/changes'),
  clear: () => api.delete<{ deleted: number }>('/changes'),
  async downloadXlsx() {
    const res = await rawRequest('/changes/xlsx');
    const href = URL.createObjectURL(await res.blob());
    triggerDownload(href, filenameFrom(res, 'alteracoes.xlsx'));
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  },
};
