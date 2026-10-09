import { describe, expect, it } from 'vitest';
import { applyOrder, moveItem } from '@/utils/list';

describe('ordem dos campos no painel', () => {
  it('aplica a ordem salva; colunas novas no fim e removidas ignoradas', () => {
    expect(applyOrder(['a', 'b', 'c', 'd'], undefined)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyOrder(['a', 'b', 'c', 'd'], ['c', 'x', 'a'])).toEqual(['c', 'a', 'b', 'd']);
  });

  it('move um item para outra posição', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
