import { create } from 'zustand';

/** Projeto aberto no programa desktop (arquivo .proj). */
export interface OpenProject {
  id: string;
  /** Nome do arquivo, sem a extensão */
  name: string;
  /** Caminho do arquivo .proj */
  path: string;
  createdAt: string;
}

/** null = nenhum projeto aberto (modo web, ou programa antes do primeiro projeto). */
export const useProjectStore = create<{ project: OpenProject | null }>()(() => ({
  project: null,
}));
