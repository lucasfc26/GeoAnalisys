import { create } from 'zustand';

/** Janela de preview do ponto selecionado (botão da TV na barra de ferramentas). */
interface SelectionPreviewState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useSelectionPreviewStore = create<SelectionPreviewState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
