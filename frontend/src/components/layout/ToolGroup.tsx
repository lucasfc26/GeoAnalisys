import type { ReactNode } from 'react';
import type { Tool } from '@/types';
import { HoldMenuButton, type HoldMenuItem } from '../ui/HoldMenuButton';

export interface ToolDef {
  tool: Tool;
  label: string;
  shortcut: string;
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
  const shown = tools.find((t) => t.tool === current) ?? tools.find((t) => t.tool === last) ?? tools[0];
  return (
    <HoldMenuButton
      label={shown.label}
      shortcut={shown.shortcut}
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
          shortcut: t.shortcut,
          checked: t.tool === shown.tool,
          onSelect: () => onPick(t.tool),
        })),
        ...extra,
      ]}
    />
  );
}
