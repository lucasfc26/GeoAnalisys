import { createContext } from 'react';

/** Lado da tela em que fica a barra de ferramentas. */
export type ToolbarSide = 'left' | 'right' | 'top' | 'bottom';

export const TOOLBAR_SIDES: { side: ToolbarSide; label: string }[] = [
  { side: 'left', label: 'Esquerda' },
  { side: 'right', label: 'Direita' },
  { side: 'top', label: 'Em cima' },
  { side: 'bottom', label: 'Embaixo' },
];

export const isToolbarSide = (v: unknown): v is ToolbarSide =>
  TOOLBAR_SIDES.some((s) => s.side === v);

/** Botões dentro da barra abrem dicas e menus para o lado do mapa (null = fora da barra). */
export const ToolbarSideContext = createContext<ToolbarSide | null>(null);
