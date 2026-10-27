import { describe, expect, it } from 'vitest';
import { applyGroup, selectionModeOf } from '@/lib/selectionMode';
import type { SelectedGroup } from '@/types';

const g = (key: string, ids: string[]): SelectedGroup => ({
  key,
  x: 0,
  y: 0,
  lat: 0,
  lng: 0,
  ids,
});

describe('modificadores da seleção', () => {
  it('Shift soma e Ctrl tira; sem modificador substitui', () => {
    expect(selectionModeOf()).toBe('replace');
    expect(selectionModeOf({ shiftKey: true })).toBe('add');
    expect(selectionModeOf({ ctrlKey: true })).toBe('subtract');
    expect(selectionModeOf({ metaKey: true })).toBe('subtract');
    expect(selectionModeOf({ shiftKey: true, ctrlKey: true })).toBe('subtract');
  });

  it('somar mantém os pontos que já estavam selecionados', () => {
    const layer = { a: g('a', ['1']) };
    expect(applyGroup(layer, g('b', ['2']), 'add')).toEqual({
      a: g('a', ['1']),
      b: g('b', ['2']),
    });
    expect(layer).toEqual({ a: g('a', ['1']) });
  });

  it('subtrair tira só os registros da marcação', () => {
    const layer = { a: g('a', ['1', '2']), b: g('b', ['3']) };
    expect(applyGroup(layer, g('a', ['1']), 'subtract')).toEqual({
      a: g('a', ['2']),
      b: g('b', ['3']),
    });
    expect(applyGroup(layer, g('b', ['3']), 'subtract')).toEqual({ a: g('a', ['1', '2']) });
    expect(applyGroup(layer, g('c', ['9']), 'subtract')).toEqual(layer);
  });
});
