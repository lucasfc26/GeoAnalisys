import type { ReactNode } from 'react';
import { useShortcutKeys } from '@/lib/shortcuts';
import type { Tool } from '@/types';
import { HoldMenuButton, type HoldMenuItem } from '../ui/HoldMenuButton';

/** Ferramenta; a tecla de atalho vem de Sobre › Atalhos (mesmo nome da ferramenta). */
export interface ToolDef {
  tool: Tool;
  label: string;
  icon: ReactNode;
}

/**
 * Grupo de ferramentas no estilo Photoshop: o botão mostra a última ferramenta usada do grupo; clicar
 * ativa essa ferramenta e segurar abre a lista.
 */
export function ToolGroup({
  tools,
  current,
  last,
  disabled,
  orientation,
  onPick,
  extra = [],
}: {
  tools: ToolDef[];
  current: Tool;
  last: Tool;
  disabled?: boolean;
  orientation: 'vertical' | 'horizontal';
  onPick: (tool: Tool) => void;
  /** Ações extras no fim da lista (ex.: limpar seleção) */
  extra?: HoldMenuItem[];
}) {
  const keyOf = useShortcutKeys();
  const shown = tools.find((t) => t.tool === current) ?? tools.find((t) => t.tool === last) ?? tools[0];
  return (
    <HoldMenuButton
      label={shown.label}
      shortcut={keyOf(shown.tool)}
      icon={shown.icon}
      active={tools.some((t) => t.tool === current)}
      disabled={disabled}
      orientation={orientation}
      onClick={() => onPick(shown.tool)}
      items={[
        ...tools.map((t) => ({
          key: t.tool,
          label: t.label,
          icon: t.icon,
          shortcut: keyOf(t.tool),
          checked: t.tool === shown.tool,
          onSelect: () => onPick(t.tool),
        })),
        ...extra,
      ]}
    />
  );
}
