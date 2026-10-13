import { create } from 'zustand';
import type {
  AttributeDistanceRequest,
  AttributeDistanceResult,
  OutsideRequest,
  OutsideResult,
} from '@/services/analysis';

/**
 * Últimos resultados de Ferramentas › Fora do limite e › Distância por atributo e as janelas com a
 * lista de pontos sobre o mapa (valem até fechar o programa).
 */
interface ToolListsState {
  outside: { request: OutsideRequest; data: OutsideResult } | null;
  outsideOpen: boolean;
  attrDist: { request: AttributeDistanceRequest; data: AttributeDistanceResult } | null;
  attrDistOpen: boolean;
  /** IDs dos resultados excluídos depois da análise (continuam na lista, marcados), por camada */
  deletedIds: Record<string, string[]>;
  setOutside: (r: ToolListsState['outside']) => void;
  setOutsideOpen: (open: boolean) => void;
  setAttrDist: (r: ToolListsState['attrDist']) => void;
  setAttrDistOpen: (open: boolean) => void;
  markDeleted: (sourceId: string, ids: string[]) => void;
}

export const useToolListsStore = create<ToolListsState>()((set) => ({
  outside: null,
  outsideOpen: false,
  attrDist: null,
  attrDistOpen: false,
  deletedIds: {},
  setOutside: (outside) => set({ outside }),
  setOutsideOpen: (outsideOpen) => set({ outsideOpen }),
  setAttrDist: (attrDist) => set({ attrDist }),
  setAttrDistOpen: (attrDistOpen) => set({ attrDistOpen }),
  markDeleted: (sourceId, ids) =>
    set((s) => ({
      deletedIds: {
        ...s.deletedIds,
        [sourceId]: [...new Set([...(s.deletedIds[sourceId] ?? []), ...ids])],
      },
    })),
}));
