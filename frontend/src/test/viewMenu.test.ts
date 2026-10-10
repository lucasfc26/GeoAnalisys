import { initDesktopTools } from '@/lib/desktopTools';
import { useAppStore } from '@/stores/appStore';

describe('menu Exibir (programa desktop)', () => {
  afterEach(() => {
    delete window.geoanalisys;
  });

  it('alterna painel de camadas, mapas e informações e informa o estado ao menu', () => {
    useAppStore.setState({ viewHidden: { layers: false, maps: false, info: false } });
    let toggle: (part: string) => void = () => {};
    const state = vi.fn();
    window.geoanalisys = {
      view: { onToggle: (fn) => (toggle = fn), state },
    };
    initDesktopTools();
    // Ao iniciar, avisa o que está visível
    expect(state).toHaveBeenLastCalledWith({ layers: true, maps: true, info: true });

    toggle('info');
    expect(useAppStore.getState().viewHidden.info).toBe(true);
    expect(state).toHaveBeenLastCalledWith({ layers: true, maps: true, info: false });

    toggle('layers');
    toggle('maps');
    expect(useAppStore.getState().viewHidden).toEqual({ layers: true, maps: true, info: true });

    toggle('info');
    expect(state).toHaveBeenLastCalledWith({ layers: false, maps: false, info: true });

    // Parte desconhecida é ignorada
    toggle('qualquer');
    expect(useAppStore.getState().viewHidden).toEqual({ layers: true, maps: true, info: false });
  });
});
