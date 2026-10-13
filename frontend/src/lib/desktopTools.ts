import { isToolbarSide, type ToolbarSide } from '@/lib/toolbar';
import { useAppStore, type ViewHidden, type ViewPart } from '@/stores/appStore';

const PARTS: ViewPart[] = ['layers', 'maps', 'info'];

/** Liga os menus Ferramentas, Sobre e Exibir do programa desktop. No navegador não faz nada. */
export function initDesktopTools() {
  window.geoanalisys?.tools?.onOpen((name) => {
    if (name === 'associate') useAppStore.getState().openDialog('associate', true);
    else if (name === 'duplicates') useAppStore.getState().openDialog('duplicates', true);
    else if (name === 'outsideBoundary') useAppStore.getState().openDialog('outsideBoundary', true);
    else if (name === 'attributeDistance')
      useAppStore.getState().openDialog('attributeDistance', true);
    else if (name === 'comparison') useAppStore.getState().openDialog('comparison', true);
    else if (name === 'shortcuts') useAppStore.getState().openDialog('shortcuts', true);
  });

  // Exibir › Painel de camadas / Mapas de fundo / Aba de informações: o menu pede para alternar e
  // o sistema devolve o que está visível (para a marca do menu acompanhar).
  const view = window.geoanalisys?.view;
  if (!view) return;
  // Exibir › Barra de ferramentas: "toolbar:left", "toolbar:top"…
  view.onToggle((part) => {
    if ((PARTS as string[]).includes(part)) useAppStore.getState().setViewHidden(part as ViewPart);
    const side = part.startsWith('toolbar:') ? part.slice('toolbar:'.length) : null;
    if (isToolbarSide(side)) useAppStore.getState().setToolbarSide(side);
  });
  const report = (h: ViewHidden, toolbar: ToolbarSide) =>
    view.state({ layers: !h.layers, maps: !h.maps, info: !h.info, toolbar });
  const st = useAppStore.getState();
  report(st.viewHidden, st.toolbarSide);
  useAppStore.subscribe((s, prev) => {
    if (s.viewHidden !== prev.viewHidden || s.toolbarSide !== prev.toolbarSide)
      report(s.viewHidden, s.toolbarSide);
  });
}
