import { beforeEach, describe, expect, it } from 'vitest';
import { activeKeyOf, comboOf, reservedUse, shortcutFor, useShortcutStore } from '@/lib/shortcuts';

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) =>
  comboOf(new KeyboardEvent('keydown', { key: k, ...mods }));

describe('comboOf', () => {
  it('normaliza teclas e modificadores', () => {
    expect(key('n')).toBe('N');
    expect(key('N', { shiftKey: true })).toBe('Shift+N');
    expect(key('c', { ctrlKey: true })).toBe('Ctrl+C');
    expect(key('Delete')).toBe('Del');
    expect(key('Escape')).toBe('Esc');
    expect(key('F3')).toBe('F3');
    expect(key('=')).toBe('+');
    expect(key('+', { shiftKey: true })).toBe('+');
    expect(key('Shift', { shiftKey: true })).toBeNull();
  });

  it('reconhece teclas reservadas do programa', () => {
    expect(reservedUse('Ctrl+S')).toBeTruthy();
    expect(reservedUse('Enter')).toBeTruthy();
    expect(reservedUse('N')).toBeUndefined();
  });
});

describe('preferências de atalhos', () => {
  beforeEach(() => useShortcutStore.getState().resetAll());

  it('troca a tecla e tira a mesma tecla de outro atalho', () => {
    const other = useShortcutStore.getState().setKey('pan', 'S');
    expect(other).toBe('select');
    expect(shortcutFor('S')).toBe('pan');
    expect(activeKeyOf(useShortcutStore.getState(), 'select')).toBeUndefined();
  });

  it('desativado não dispara e restaurar volta ao padrão', () => {
    const s = useShortcutStore.getState();
    s.setEnabled('measure', false);
    expect(shortcutFor('I')).toBeUndefined();
    s.setKey('pan', 'S');
    s.reset('select');
    expect(shortcutFor('S')).toBe('select');
    expect(activeKeyOf(useShortcutStore.getState(), 'pan')).toBeUndefined();
  });
});
