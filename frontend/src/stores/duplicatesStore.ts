import { create } from 'zustand';
import { selectPoints } from '@/lib/selectPoints';
import type { DuplicatesPreview, DuplicatesRequest } from '@/services/duplicates';

/** Último resultado de Ferramentas › Duplicidades (vale até fechar o programa). */
interface DuplicatesState {
  result: { request: DuplicatesRequest; data: DuplicatesPreview } | null;
  /** Janela com a lista de pares sobre o mapa */
  panelOpen: boolean;
  setResult: (result: DuplicatesState['result']) => void;
  setPanelOpen: (open: boolean) => void;
}

export const useDuplicatesStore = create<DuplicatesState>()((set) => ({
  result: null,
  panelOpen: false,
  setResult: (result) => set({ result }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}));

/** Seleciona os pontos na camada (que vira a ativa) e enquadra o mapa neles. */
export const selectDuplicatePoints = selectPoints;
