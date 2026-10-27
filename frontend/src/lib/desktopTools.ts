import { isToolbarSide } from '@/lib/toolbar';
import { layoutButtonState, normalizeToolbarLayout } from '@/lib/toolbarLayout';
import { useAppStore, type ViewPart } from '@/stores/appStore';

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
    if (part.startsWith('button:'))
      useAppStore.getState().setToolbarButtonShown(part.slice('button:'.length));
  });
  const report = () => {
    const s = useAppStore.getState();
    view.state({
      layers: !s.viewHidden.layers,
      maps: !s.viewHidden.maps,
      info: !s.viewHidden.info,
      toolbar: s.toolbarSide,
      buttons: layoutButtonState(normalizeToolbarLayout(s.toolbarLayout, s.toolbarSide)),
    });
  };
  report();
  useAppStore.subscribe((s, prev) => {
    if (
      s.viewHidden !== prev.viewHidden ||
      s.toolbarSide !== prev.toolbarSide ||
      s.toolbarLayout !== prev.toolbarLayout
    )
      report();
  });
}
