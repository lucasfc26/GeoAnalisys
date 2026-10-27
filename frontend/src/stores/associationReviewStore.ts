import { create } from 'zustand';
import type { AssociationRequest, AssociationReview } from '@/services/association';

/** Chave de um par da revisão */
export const pairKey = (p: { a: { id: string }; b: { id: string } }) => `${p.a.id}|${p.b.id}`;

/** Última revisão de Ferramentas › Associar Camadas (pares distantes ou dúbios). */
interface AssociationReviewState {
  result: { request: AssociationRequest; data: AssociationReview } | null;
  /** Camada cujo ponto recebe a coordenada do ponto associado ao ajustar */
  from: 'A' | 'B';
  /** Pares já ajustados (continuam na lista, marcados) */
  fixed: string[];
  /** Janela com a lista de pares sobre o mapa */
  panelOpen: boolean;
  setResult: (result: AssociationReviewState['result']) => void;
  setFrom: (from: 'A' | 'B') => void;
  markFixed: (keys: string[]) => void;
  setPanelOpen: (open: boolean) => void;
}

export const useAssociationReviewStore = create<AssociationReviewState>()((set) => ({
  result: null,
  from: 'A',
  fixed: [],
  panelOpen: false,
  setResult: (result) => set({ result, fixed: [] }),
  setFrom: (from) => set({ from }),
  markFixed: (keys) => set((s) => ({ fixed: [...new Set([...s.fixed, ...keys])] })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
}));
