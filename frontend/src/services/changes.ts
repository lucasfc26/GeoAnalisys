import { api, rawRequest, request } from '@/lib/api';
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

export interface ChangeActionError {
  id: string;
  recordId: string;
  sourceName: string;
  message: string;
}

export interface ChangeImportResult {
  rows: number;
  applied: number;
  /** Pontos removidos (observação "Removido…") */
  removed: number;
  unchanged: number;
  errors: { line: number; message: string }[];
}

export const changesService = {
  list: () => api.get<ChangeRow[]>('/changes'),
  clear: () => api.delete<{ deleted: number }>('/changes'),
  /** Tira as linhas da tabela (os pontos não mudam). */
  forget: (ids: string[]) => api.post<{ deleted: number }>('/changes/forget', { ids }),
  /** Volta os pontos ao estado original e tira as linhas da tabela. */
  rollback: (ids: string[]) =>
    api.post<{ done: number; errors: ChangeActionError[] }>('/changes/rollback', { ids }),
  setObservation: (ids: string[], observation: string, append: boolean) =>
    api.post<{ updated: number }>('/changes/observation', { ids, observation, append }),
  edit: (id: string, body: { observation?: string | null; values?: Record<string, unknown> }) =>
    api.patch<ChangeRow | null>(`/changes/${encodeURIComponent(id)}`, body),
  import: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<ChangeImportResult>('/changes/import', { method: 'POST', body: fd });
  },
  /**
   * `ids` = só essas linhas (ausente = todas); `fill` = preenche os atributos das colunas do arquivo
   * que o ponto não alterou (valor atual do ponto).
   */
  async downloadXlsx(ids?: string[], fill = false) {
    const res =
      ids || fill
        ? await rawRequest('/changes/xlsx', { method: 'POST', body: JSON.stringify({ ids, fill }) })
        : await rawRequest('/changes/xlsx');
    const href = URL.createObjectURL(await res.blob());
    triggerDownload(href, filenameFrom(res, 'alteracoes.xlsx'));
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  },
};
