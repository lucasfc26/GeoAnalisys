import { useEffect } from 'react';
import { comboOf, shortcutFor } from '@/lib/shortcuts';
import { selectedIdsOf, useAppStore } from '@/stores/appStore';
import { useSelectionPreviewStore } from '@/stores/selectionPreviewStore';
import type { TransformMode } from '@/types';

/** Pedido (F2) para renomear a camada ativa no painel de Camadas. */
export const RENAME_LAYER_EVENT = 'geoanalisys:rename-layer';

/** Atalhos que funcionam sem camada ativa. */
const NO_SOURCE = new Set([
  'pan',
  'measure',
  'streetview',
  'zoomIn',
  'zoomOut',
  'mapMaker',
  'changes',
  'preview',
  'undo',
  'redo',
  'clear',
]);

/** Atalhos que abrem uma janela (diálogo) com este nome. */
const OPENS_DIALOG: Record<string, 'filters' | 'importLayer' | 'associate' | 'duplicates' | 'outsideBoundary' | 'attributeDistance' | 'comparison' | 'bulkEdit'> = {
  filters: 'filters',
  importLayer: 'importLayer',
  associate: 'associate',
  duplicates: 'duplicates',
  outsideBoundary: 'outsideBoundary',
  attributeDistance: 'attributeDistance',
  comparison: 'comparison',
  bulkEdit: 'bulkEdit',
};

/** Teclas que não digitam texto: valem também com o foco num campo. */
const SAFE_WHILE_TYPING = /^(F\d{1,2}|(Ctrl|Alt)\+.+)$/;

/**
 * Atalhos de teclado dos botões, com as teclas escolhidas em Sobre › Atalhos (ignorados enquanto
 * digita ou com diálogo aberto).
 */
export function useShortcuts(actions: {
  center: () => void;
  zoom: (d: number) => void;
  edit: () => void;
  remove: () => void;
  undo: () => void;
  redo: () => void;
  transform: (mode: TransformMode) => void;
  copy: (sourceId: string, ids: string[]) => void;
  exportData: () => void;
  makeMap: () => void;
  openChanges: () => void;
  copyToLayer: () => void;
  refresh: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboOf(e);
      const id = combo && shortcutFor(combo);
      if (!id) return;
      const typing = !!(e.target as HTMLElement).closest(
        'input, textarea, select, [contenteditable="true"]',
      );
      // "Selecionar por valor" (F3) também abre com o foco num campo, em vez da busca do navegador.
      if (typing && !(id === 'search' && SAFE_WHILE_TYPING.test(combo))) return;
      const s = useAppStore.getState();
      if ((!s.sourceId && !NO_SOURCE.has(id)) || Object.values(s.dialogs).some(Boolean)) return;
      const sourceId = s.sourceId as string;

      switch (id) {
        case 'search':
          // Sempre abre mais uma janela, para a camada ativa (as já abertas continuam).
          s.openSearchWindow(sourceId);
          break;
        case 'copy': {
          // Copia os pontos selecionados (cabeçalho + valores) para colar no Excel — exceto quando há
          // texto selecionado na página (aí vale a cópia normal do navegador).
          if (window.getSelection()?.toString()) return;
          const ids = selectedIdsOf(s.selection);
          if (!ids.length) return;
          actions.copy(sourceId, ids);
          break;
        }
        case 'clear':
          if (s.transform) s.setTransform(null);
          // No polígono e na régua, Esc cancela o desenho (tratado pelas próprias ferramentas).
          else if (combo !== 'Esc' || (s.tool !== 'polygon' && s.tool !== 'measure'))
            s.clearSelection();
          break;
        // Sempre abre mais uma janela do modo lista, para a camada ativa (as já abertas continuam).
        case 'list':
          s.openListWindow(sourceId);
          break;
        case 'move':
          actions.transform('move');
          break;
        case 'duplicate':
          actions.transform('copy');
          break;
        case 'center':
          actions.center();
          break;
        case 'zoomIn':
          actions.zoom(1);
          break;
        case 'zoomOut':
          actions.zoom(-1);
          break;
        case 'edit':
          actions.edit();
          break;
        case 'remove':
          actions.remove();
          break;
        case 'undo':
          actions.undo();
          break;
        case 'redo':
          actions.redo();
          break;
        case 'preview': {
          const p = useSelectionPreviewStore.getState();
          p.setOpen(!p.open);
          break;
        }
        case 'export':
          actions.exportData();
          break;
        case 'mapMaker':
          actions.makeMap();
          break;
        case 'changes':
          actions.openChanges();
          break;
        case 'copyLayer':
          if (!selectedIdsOf(s.selection).length) return;
          actions.copyToLayer();
          break;
        case 'refresh':
          actions.refresh();
          break;
        case 'rename':
          // O painel de Camadas põe o nome da camada ativa em edição.
          window.dispatchEvent(new Event(RENAME_LAYER_EVENT));
          break;
        case 'bulkEdit':
          if (!selectedIdsOf(s.selection).length) return;
          s.openDialog('bulkEdit', true);
          break;
        case 'filters':
        case 'importLayer':
        case 'associate':
        case 'duplicates':
        case 'outsideBoundary':
        case 'attributeDistance':
        case 'comparison':
          s.openDialog(OPENS_DIALOG[id], true);
          break;
        default:
          s.setTool(id);
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}
