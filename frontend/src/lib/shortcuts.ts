import { useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Tool } from '@/types';

/** Atalhos dos botões. Os das ferramentas usam o mesmo nome da ferramenta. */
export type ShortcutId =
  | Tool
  | 'move'
  | 'duplicate'
  | 'remove'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'clear'
  | 'edit'
  | 'list'
  | 'search'
  | 'center'
  | 'zoomIn'
  | 'zoomOut'
  | 'preview'
  | 'changes'
  | 'export'
  | 'mapMaker'
  | 'copyLayer'
  | 'refresh'
  | 'bulkEdit'
  | 'filters'
  | 'importLayer'
  | 'associate'
  | 'duplicates'
  | 'outsideBoundary'
  | 'attributeDistance'
  | 'comparison'
  | 'rename';

export interface ShortcutDef {
  id: ShortcutId;
  group: string;
  label: string;
  /** Tecla padrão ('' = sem tecla: o usuário escolhe em Sobre › Atalhos) */
  key: string;
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'pan', group: 'Ferramentas', label: 'Navegar', key: 'N' },
  { id: 'select', group: 'Ferramentas', label: 'Selecionar ponto', key: 'S' },
  { id: 'multi', group: 'Ferramentas', label: 'Seleção múltipla', key: 'M' },
  { id: 'rectangle', group: 'Ferramentas', label: 'Seleção por retângulo', key: 'R' },
  { id: 'polygon', group: 'Ferramentas', label: 'Seleção por polígono', key: 'P' },
  { id: 'measure', group: 'Ferramentas', label: 'Medir distância (régua)', key: 'I' },
  { id: 'streetview', group: 'Ferramentas', label: 'Abrir no Street View', key: 'V' },
  { id: 'add', group: 'Ferramentas', label: 'Adicionar ponto pelo mapa', key: 'A' },
  { id: 'move', group: 'Seleção', label: 'Mover selecionados', key: 'G' },
  { id: 'duplicate', group: 'Seleção', label: 'Duplicar selecionados', key: 'D' },
  { id: 'remove', group: 'Seleção', label: 'Excluir selecionados', key: 'Del' },
  { id: 'undo', group: 'Seleção', label: 'Desfazer a última ação', key: 'Ctrl+Z' },
  { id: 'redo', group: 'Seleção', label: 'Refazer a ação desfeita', key: 'Ctrl+Y' },
  { id: 'copy', group: 'Seleção', label: 'Copiar selecionados (colar no Excel)', key: 'Ctrl+C' },
  { id: 'clear', group: 'Seleção', label: 'Limpar seleção / cancelar mover', key: 'Esc' },
  { id: 'edit', group: 'Seleção', label: 'Editar registro aberto', key: 'E' },
  { id: 'list', group: 'Janelas', label: 'Modo lista (percorrer valores)', key: 'L' },
  { id: 'search', group: 'Janelas', label: 'Selecionar por valor (atributos)', key: 'F3' },
  { id: 'copyLayer', group: 'Seleção', label: 'Copiar selecionados para nova camada', key: '' },
  { id: 'bulkEdit', group: 'Seleção', label: 'Editar selecionados em massa', key: '' },
  { id: 'preview', group: 'Janelas', label: 'Preview do ponto selecionado (frame)', key: 'T' },
  { id: 'changes', group: 'Janelas', label: 'Tabela de Alterações', key: 'H' },
  { id: 'export', group: 'Janelas', label: 'Exportar', key: 'X' },
  { id: 'mapMaker', group: 'Janelas', label: 'Criar mapa (Comitê / Status 18)', key: '' },
  { id: 'filters', group: 'Janelas', label: 'Filtros da camada', key: 'F' },
  { id: 'importLayer', group: 'Janelas', label: 'Importar CSV/XLSX/GeoJSON/KML', key: '' },
  { id: 'associate', group: 'Ferramentas (menu)', label: 'Associar Camadas', key: '' },
  { id: 'duplicates', group: 'Ferramentas (menu)', label: 'Duplicidades', key: '' },
  { id: 'outsideBoundary', group: 'Ferramentas (menu)', label: 'Fora do limite', key: '' },
  { id: 'attributeDistance', group: 'Ferramentas (menu)', label: 'Distância por atributo', key: '' },
  { id: 'comparison', group: 'Ferramentas (menu)', label: 'Quadro Comparativo', key: '' },
  { id: 'rename', group: 'Camadas', label: 'Renomear a camada ativa (nome de exibição)', key: 'F2' },
  { id: 'refresh', group: 'Mapa', label: 'Atualizar dados', key: '' },
  { id: 'center', group: 'Mapa', label: 'Centralizar', key: 'C' },
  { id: 'zoomIn', group: 'Mapa', label: 'Aproximar', key: '+' },
  { id: 'zoomOut', group: 'Mapa', label: 'Afastar', key: '-' },
];

/** Teclas do programa que não podem ser trocadas (menus e teclas internas das ferramentas). */
export const FIXED_SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl+N'], label: 'Novo projeto (menu Arquivo)' },
  { keys: ['Ctrl+O'], label: 'Abrir projeto (menu Arquivo)' },
  { keys: ['Ctrl+S'], label: 'Salvar projeto (menu Arquivo)' },
  { keys: ['Ctrl+R'], label: 'Recarregar (menu Exibir)' },
  { keys: ['F11'], label: 'Tela cheia (menu Exibir)' },
  { keys: ['Ctrl++', 'Ctrl+-', 'Ctrl+0'], label: 'Tamanho da tela (menu Exibir)' },
  { keys: ['Ctrl+Shift+I'], label: 'Ferramentas do desenvolvedor' },
  { keys: ['Enter'], label: 'Concluir polígono e régua · confirmar mover/duplicar' },
  { keys: ['Backspace'], label: 'Desfazer o último ponto da régua' },
  { keys: ['←', '→', '↑', '↓'], label: 'Mover o mapa · percorrer o modo lista' },
  { keys: ['Tab'], label: 'Passar para o próximo campo' },
];

const RESERVED = new Map(FIXED_SHORTCUTS.flatMap((f) => f.keys.map((k) => [k, f.label] as const)));

/** Para que serve a tecla, se for reservada pelo programa. */
export const reservedUse = (combo: string) => RESERVED.get(combo);

const KEY_NAMES: Record<string, string> = {
  Delete: 'Del',
  Escape: 'Esc',
  ' ': 'Espaço',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  // Tecla =/+ sem Shift conta como + (Aproximar funciona com ou sem Shift).
  '=': '+',
};

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Dead', 'Process', 'Unidentified']);

/** Tecla pressionada no formato dos atalhos ("N", "Shift+N", "Ctrl+C", "F3"); null = só modificador. */
export function comboOf(e: KeyboardEvent): string | null {
  if (MODIFIERS.has(e.key)) return null;
  let key = KEY_NAMES[e.key] ?? e.key;
  const single = [...key].length === 1;
  if (single) key = key.toUpperCase();
  // Num símbolo o Shift já está no próprio caractere (Shift+1 = "!").
  const shift = e.shiftKey && (!single || /^\p{L}$/u.test(key));
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', shift ? 'Shift' : '', key]
    .filter(Boolean)
    .join('+');
}

interface ShortcutPrefs {
  /** Teclas trocadas pelo usuário ('' = sem tecla) */
  keys: Partial<Record<ShortcutId, string>>;
  disabled: ShortcutId[];
}

interface ShortcutState extends ShortcutPrefs {
  /** Troca a tecla; se outro atalho usava a mesma, ele fica sem tecla (devolve qual era). */
  setKey: (id: ShortcutId, combo: string) => ShortcutId | null;
  setEnabled: (id: ShortcutId, enabled: boolean) => void;
  reset: (id: ShortcutId) => void;
  resetAll: () => void;
}

const defaultKey = (id: ShortcutId) => SHORTCUTS.find((s) => s.id === id)?.key ?? '';

/** Tecla configurada (mesmo desativado). */
export const keyOf = (p: ShortcutPrefs, id: ShortcutId) => p.keys[id] ?? defaultKey(id);

/** Tecla em uso; undefined = desativado ou sem tecla. */
export const activeKeyOf = (p: ShortcutPrefs, id: ShortcutId) =>
  (!p.disabled.includes(id) && keyOf(p, id)) || undefined;

// Preferência da máquina: o nome fica fora do prefixo "geoanalisys-", que vai para o projeto (.proj).
export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set, get) => ({
      keys: {},
      disabled: [],
      setKey: (id, combo) => {
        const s = get();
        const other =
          SHORTCUTS.find((d) => d.id !== id && keyOf(s, d.id) === combo && combo !== '')?.id ?? null;
        const keys = { ...s.keys, [id]: combo };
        if (other) keys[other] = '';
        set({ keys });
        return other;
      },
      setEnabled: (id, enabled) =>
        set((s) => ({
          disabled: enabled ? s.disabled.filter((d) => d !== id) : [...new Set([...s.disabled, id])],
        })),
      reset: (id) =>
        set((s) => {
          const keys = { ...s.keys };
          delete keys[id];
          // A tecla padrão sai de quem a pegou nesse meio-tempo.
          const dk = defaultKey(id);
          const other = dk
            ? SHORTCUTS.find((d) => d.id !== id && keyOf(s, d.id) === dk)
            : undefined;
          if (other) keys[other.id] = '';
          return { keys, disabled: s.disabled.filter((d) => d !== id) };
        }),
      resetAll: () => set({ keys: {}, disabled: [] }),
    }),
    {
      name: 'geoanalisys.atalhos',
      partialize: (s) => ({ keys: s.keys, disabled: s.disabled }),
    },
  ),
);

/** Atalho ligado à tecla pressionada (só os ativos). */
export function shortcutFor(combo: string): ShortcutId | undefined {
  const s = useShortcutStore.getState();
  return SHORTCUTS.find((d) => activeKeyOf(s, d.id) === combo)?.id;
}

/** Tecla em uso de cada atalho, para as dicas dos botões. */
export function useShortcutKeys(): (id: ShortcutId) => string | undefined {
  const keys = useShortcutStore((s) => s.keys);
  const disabled = useShortcutStore((s) => s.disabled);
  return useCallback((id: ShortcutId) => activeKeyOf({ keys, disabled }, id), [keys, disabled]);
}
