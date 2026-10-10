import { describe, expect, it } from 'vitest';
import { newLayer } from '@/lib/layers';
import {
  canStep,
  dropNode,
  flattenTree,
  groupOf,
  moveToGroup,
  normalizeTree,
  stepNode,
  syncTree,
  ungroup,
} from '@/lib/layerTree';
import type { LayerTreeNode } from '@/types';

const L = (id: string): LayerTreeNode => ({ kind: 'layer', id });
const G = (id: string, children: string[], name = id): LayerTreeNode => ({
  kind: 'group',
  id,
  name,
  expanded: true,
  children,
});

// a (solta) · G1 [b, c] · d (solta) · G2 []
const tree: LayerTreeNode[] = [L('a'), G('g1', ['b', 'c']), L('d'), G('g2', [])];

describe('árvore de camadas', () => {
  it('achata na ordem de desenho (grupos vazios não contam)', () => {
    expect(flattenTree(tree)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('normaliza: tira camadas que saíram, põe as novas no topo, sem árvore = todas soltas', () => {
    expect(flattenTree(normalizeTree(tree, ['n', 'a', 'c', 'd']))).toEqual(['n', 'a', 'c', 'd']);
    expect(normalizeTree(undefined, ['x', 'y'])).toEqual([L('x'), L('y')]);
    // Grupos (mesmo vazios) continuam
    expect(normalizeTree(tree, []).filter((n) => n.kind === 'group')).toHaveLength(2);
  });

  it('syncTree reordena as camadas pela árvore', () => {
    const layers = ['d', 'c', 'b', 'a'].map((id, i) => newLayer(id, i));
    const r = syncTree(layers, tree);
    expect(r.layers.map((l) => l.sourceId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('arrastar camada para dentro de um grupo (no topo) e entre camadas de um grupo', () => {
    const t1 = dropNode(tree, { kind: 'layer', id: 'a' }, { kind: 'group', id: 'g2' }, 'inside');
    expect(groupOf(t1, 'a')?.id).toBe('g2');
    const t2 = dropNode(tree, { kind: 'layer', id: 'd' }, { kind: 'layer', id: 'b' }, 'after');
    expect(groupOf(t2, 'd')?.id).toBe('g1');
    expect(flattenTree(t2)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('arrastar camada para fora do grupo (antes de uma camada solta)', () => {
    const t = dropNode(tree, { kind: 'layer', id: 'c' }, { kind: 'layer', id: 'a' }, 'before');
    expect(groupOf(t, 'c')).toBeNull();
    expect(flattenTree(t)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('grupo não entra em grupo: solto sobre camada de grupo, fica ao lado do grupo', () => {
    const t = dropNode(tree, { kind: 'group', id: 'g2' }, { kind: 'layer', id: 'b' }, 'before');
    expect(t.map((n) => n.id)).toEqual(['a', 'g2', 'g1', 'd']);
    const same = dropNode(tree, { kind: 'group', id: 'g2' }, { kind: 'group', id: 'g2' }, 'inside');
    expect(same).toBe(tree);
  });

  it('setas: dentro do grupo e entre itens soltos', () => {
    const t = stepNode(tree, { kind: 'layer', id: 'c' }, -1);
    expect(flattenTree(t)).toEqual(['a', 'c', 'b', 'd']);
    expect(canStep(tree, { kind: 'layer', id: 'b' }, -1)).toBe(false);
    expect(canStep(tree, { kind: 'layer', id: 'a' }, -1)).toBe(false);
    const t2 = stepNode(tree, { kind: 'layer', id: 'a' }, 1);
    expect(t2.map((n) => n.id)).toEqual(['g1', 'a', 'd', 'g2']);
  });

  it('mover para grupo / fora de grupos e desfazer grupo', () => {
    const t = moveToGroup(tree, 'd', 'g1');
    expect(groupOf(t, 'd')?.id).toBe('g1');
    const out = moveToGroup(t, 'b', null);
    expect(groupOf(out, 'b')).toBeNull();
    expect(out.map((n) => n.id)).toEqual(['a', 'b', 'g1', 'g2']);
    expect(ungroup(tree, 'g1').map((n) => n.id)).toEqual(['a', 'b', 'c', 'd', 'g2']);
  });
});
