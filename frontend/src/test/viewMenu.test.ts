import { initDesktopTools } from '@/lib/desktopTools';
import { defaultToolbarLayout, layoutButtonState } from '@/lib/toolbarLayout';
import { useAppStore } from '@/stores/appStore';

const buttons = layoutButtonState(defaultToolbarLayout());

describe('menu Exibir (programa desktop)', () => {
  afterEach(() => {
    delete window.geoanalisys;
  });

  it('alterna painel de camadas, mapas e informações e informa o estado ao menu', () => {
    useAppStore.setState({
      viewHidden: { layers: false, maps: false, info: false },
      toolbarSide: 'left',
      toolbarLayout: defaultToolbarLayout('left'),
    });
    let toggle: (part: string) => void = () => {};
    const state = vi.fn();
    window.geoanalisys = {
      view: { onToggle: (fn) => (toggle = fn), state },
    };
    initDesktopTools();
    // Ao iniciar, avisa o que está visível
    expect(state).toHaveBeenLastCalledWith({
      layers: true,
      maps: true,
      info: true,
      toolbar: 'left',
      buttons,
    });

    toggle('info');
    expect(useAppStore.getState().viewHidden.info).toBe(true);
    expect(state).toHaveBeenLastCalledWith({
      layers: true,
      maps: true,
      info: false,
      toolbar: 'left',
      buttons,
    });

    toggle('layers');
    toggle('maps');
    expect(useAppStore.getState().viewHidden).toEqual({ layers: true, maps: true, info: true });

    toggle('info');
    expect(state).toHaveBeenLastCalledWith({
      layers: false,
      maps: false,
      info: true,
      toolbar: 'left',
      buttons,
    });

    // Parte desconhecida é ignorada
    toggle('qualquer');
    expect(useAppStore.getState().viewHidden).toEqual({ layers: true, maps: true, info: false });
  });

  it('muda o lado da barra de ferramentas e informa ao menu', () => {
    useAppStore.setState({
      viewHidden: { layers: false, maps: false, info: false },
      toolbarSide: 'left',
      toolbarLayout: defaultToolbarLayout('left'),
    });
    let toggle: (part: string) => void = () => {};
    const state = vi.fn();
    window.geoanalisys = {
      view: { onToggle: (fn) => (toggle = fn), state },
    };
    initDesktopTools();

    toggle('toolbar:top');
    expect(useAppStore.getState().toolbarSide).toBe('top');
    expect(state).toHaveBeenLastCalledWith({
      layers: true,
      maps: true,
      info: true,
      toolbar: 'top',
      buttons,
    });

    toggle('toolbar:right');
    expect(useAppStore.getState().toolbarSide).toBe('right');

    // Lado desconhecido é ignorado
    toggle('toolbar:diagonal');
    expect(useAppStore.getState().toolbarSide).toBe('right');
  });

  it('mostra ou esconde um botão da barra pelo menu Exibir › Painel', () => {
    useAppStore.setState({
      viewHidden: { layers: false, maps: false, info: false },
      toolbarSide: 'left',
      toolbarLayout: defaultToolbarLayout('left'),
    });
    let toggle: (part: string) => void = () => {};
    const state = vi.fn();
    window.geoanalisys = {
      view: { onToggle: (fn) => (toggle = fn), state },
    };
    initDesktopTools();

    toggle('button:pan');
    expect(useAppStore.getState().toolbarLayout.hidden).toContain('pan');
    const hidden = layoutButtonState(useAppStore.getState().toolbarLayout);
    expect(hidden.find((b) => b.id === 'pan')?.visible).toBe(false);
    expect(state).toHaveBeenLastCalledWith({
      layers: true,
      maps: true,
      info: true,
      toolbar: 'left',
      buttons: hidden,
    });

    toggle('button:pan');
    expect(useAppStore.getState().toolbarLayout.hidden).not.toContain('pan');
  });
});
