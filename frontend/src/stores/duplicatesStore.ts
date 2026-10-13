import { create } from 'zustand';
import { selectPoints } from '@/lib/selectPoints';
import type { DuplicatesPreview, DuplicatesRequest } from '@/services/duplicates';

/** Último resultado de Ferramentas › Duplicidades (vale até fechar o programa). */
interface DuplicatesState {
  result: { request: DuplicatesRequest; data: DuplicatesPreview } | null;
  /** IDs do resultado excluídos depois da análise (continuam na lista, marcados) */
  deletedIds: string[];
  /** Janela com a lista de pares sobre o mapa */
  panelOpen: boolean;
  setResult: (result: DuplicatesState['result']) => void;
  setPanelOpen: (open: boolean) => void;
  /** Registros excluídos da camada: se forem do resultado atual, ficam marcados na lista */
  markDeleted: (sourceId: string, ids: string[]) => void;
}

export const useDuplicatesStore = create<DuplicatesState>()((set) => ({
  result: null,
  deletedIds: [],
  panelOpen: false,
  setResult: (result) => set({ result, deletedIds: [] }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  markDeleted: (sourceId, ids) =>
    set((s) =>
      s.result?.request.layer.sourceId === sourceId
        ? { deletedIds: [...new Set([...s.deletedIds, ...ids])] }
        : {},
    ),
}));

/** Seleciona os pontos na camada (que vira a ativa) e enquadra o mapa neles. */
export const selectDuplicatePoints = selectPoints;
