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
