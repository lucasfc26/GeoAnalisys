import { describe, expect, it } from 'vitest';
import { useAppStore } from '@/stores/appStore';

describe('janelas "Selecionar por valor"', () => {
  it('cada janela tem id próprio: fechar uma não fecha as outras', () => {
    const s = useAppStore.getState();
    s.openSearchWindow('a');
    s.openSearchWindow('b');
    s.openSearchWindow('a');
    const wins = useAppStore.getState().searchWindows;
    expect(wins).toHaveLength(3);
    expect(new Set(wins.map((w) => w.id)).size).toBe(3);

    useAppStore.getState().closeSearchWindow(wins[1].id);
    expect(useAppStore.getState().searchWindows.map((w) => w.sourceId)).toEqual(['a', 'a']);
  });
});

describe('janelas do modo lista', () => {
  it('várias janelas, cada uma presa à sua camada; trocar a camada ativa não fecha nenhuma', () => {
    useAppStore.setState({ listWindows: [] });
    const s = useAppStore.getState();
    s.openListWindow('a');
    s.openListWindow('b');
    useAppStore.getState().setSource('b');
    const wins = useAppStore.getState().listWindows;
    expect(wins.map((w) => w.sourceId)).toEqual(['a', 'b']);
    expect(new Set(wins.map((w) => w.id)).size).toBe(2);

    useAppStore.getState().closeListWindow(wins[0].id);
    expect(useAppStore.getState().listWindows.map((w) => w.sourceId)).toEqual(['b']);
  });

  it('remover a camada fecha as janelas dela', () => {
    useAppStore.setState({ listWindows: [] });
    const s = useAppStore.getState();
    s.addLayer('a');
    s.addLayer('b');
    s.openListWindow('a');
    s.openListWindow('b');
    useAppStore.getState().removeLayer('a');
    expect(useAppStore.getState().listWindows.map((w) => w.sourceId)).toEqual(['b']);
  });
});
