import { useAppStore } from '@/stores/appStore';

/** Liga os menus Ferramentas e Sobre do programa desktop aos diálogos. No navegador não faz nada. */
export function initDesktopTools() {
  window.geoanalisys?.tools?.onOpen((name) => {
    if (name === 'associate') useAppStore.getState().openDialog('associate', true);
    else if (name === 'shortcuts') useAppStore.getState().openDialog('shortcuts', true);
  });
}
