import { useAppStore, type ViewHidden, type ViewPart } from '@/stores/appStore';

const PARTS: ViewPart[] = ['layers', 'maps', 'info'];

/** Liga os menus Ferramentas, Sobre e Exibir do programa desktop. No navegador não faz nada. */
export function initDesktopTools() {
  window.geoanalisys?.tools?.onOpen((name) => {
    if (name === 'associate') useAppStore.getState().openDialog('associate', true);
    else if (name === 'shortcuts') useAppStore.getState().openDialog('shortcuts', true);
  });

  // Exibir › Painel de camadas / Mapas de fundo / Aba de informações: o menu pede para alternar e
  // o sistema devolve o que está visível (para a marca do menu acompanhar).
  const view = window.geoanalisys?.view;
  if (!view) return;
  view.onToggle((part) => {
    if ((PARTS as string[]).includes(part)) useAppStore.getState().setViewHidden(part as ViewPart);
  });
  const report = (h: ViewHidden) => view.state({ layers: !h.layers, maps: !h.maps, info: !h.info });
  report(useAppStore.getState().viewHidden);
  useAppStore.subscribe((s, prev) => {
    if (s.viewHidden !== prev.viewHidden) report(s.viewHidden);
  });
}
