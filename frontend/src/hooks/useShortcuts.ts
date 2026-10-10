import { useEffect } from 'react';
import { comboOf, shortcutFor } from '@/lib/shortcuts';
import { selectedIdsOf, useAppStore } from '@/stores/appStore';
import type { TransformMode } from '@/types';

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
  transform: (mode: TransformMode) => void;
  copy: (sourceId: string, ids: string[]) => void;
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
      if (!s.sourceId || Object.values(s.dialogs).some(Boolean)) return;

      switch (id) {
        case 'search':
          // Sempre abre mais uma janela, para a camada ativa (as já abertas continuam).
          s.openSearchWindow(s.sourceId);
          break;
        case 'copy': {
          // Copia os pontos selecionados (cabeçalho + valores) para colar no Excel — exceto quando há
          // texto selecionado na página (aí vale a cópia normal do navegador).
          if (window.getSelection()?.toString()) return;
          const ids = selectedIdsOf(s.selection);
          if (!ids.length) return;
          actions.copy(s.sourceId, ids);
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
          s.openListWindow(s.sourceId);
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
        default:
          s.setTool(id);
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}
