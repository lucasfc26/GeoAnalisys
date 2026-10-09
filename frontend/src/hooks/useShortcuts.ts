import { useEffect } from 'react';
import { selectedIdsOf, useAppStore } from '@/stores/appStore';
import type { Tool, TransformMode } from '@/types';

const KEY_TOOL: Record<string, Tool> = {
  n: 'pan',
  s: 'select',
  m: 'multi',
  r: 'rectangle',
  p: 'polygon',
  a: 'add',
  i: 'measure',
  v: 'streetview',
};

/** Atalhos de teclado das ferramentas (ignorados enquanto digita ou com diálogo aberto). */
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
      const el = e.target as HTMLElement;
      const s = useAppStore.getState();
      // F3 (também com o foco num campo): nova janela "Selecionar por valor" em vez da busca do navegador.
      if (e.key === 'F3' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (!s.sourceId || Object.values(s.dialogs).some(Boolean)) return;
        e.preventDefault();
        // Sempre abre mais uma janela, para a camada ativa (as já abertas continuam).
        s.openSearchWindow(s.sourceId);
        return;
      }
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!s.sourceId || Object.values(s.dialogs).some(Boolean)) return;
      // Ctrl+C: copia os pontos selecionados (cabeçalho + valores) para colar no Excel — exceto
      // quando há texto selecionado na página (aí vale a cópia normal do navegador).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
        if (window.getSelection()?.toString()) return;
        const ids = selectedIdsOf(s.selection);
        if (!ids.length) return;
        e.preventDefault();
        actions.copy(s.sourceId, ids);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (KEY_TOOL[k]) s.setTool(KEY_TOOL[k]);
      else if (k === 'escape' && s.transform) s.setTransform(null);
      // No polígono e na régua, Esc cancela o desenho (tratado pelas próprias ferramentas).
      else if (k === 'escape' && s.tool !== 'polygon' && s.tool !== 'measure') s.clearSelection();
      else if (k === 'l') s.setListMode(!s.listMode);
      else if (k === 'g') actions.transform('move');
      else if (k === 'd') actions.transform('copy');
      else if (k === 'c') actions.center();
      else if (k === '+' || k === '=') actions.zoom(1);
      else if (k === '-') actions.zoom(-1);
      else if (k === 'e') actions.edit();
      else if (k === 'delete') actions.remove();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}
