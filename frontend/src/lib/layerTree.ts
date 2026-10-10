import type { LayerStyle, LayerTreeNode } from '@/types';

/**
 * Árvore do painel de camadas (grupos como pastas). A ordem da árvore achatada é a ordem de
 * desenho das camadas: toda mudança na árvore reordena `layers` e toda camada nova entra no topo.
 */

export type TreeRef = { kind: 'layer' | 'group'; id: string };
/** Onde soltar: antes/depois do alvo, ou dentro de um grupo (no topo dele) */
export type DropWhere = 'before' | 'after' | 'inside';

type Group = Extract<LayerTreeNode, { kind: 'group' }>;

export const isGroup = (n: LayerTreeNode): n is Group => n.kind === 'group';

/**
 * Onde soltar sobre a linha arrastando: metade de cima = antes, de baixo = depois. Com `inside`
 * (grupos), a faixa do meio = dentro.
 */
export function dropZone(
  e: { clientY: number; currentTarget: Element },
  inside = false,
): DropWhere {
  const r = e.currentTarget.getBoundingClientRect();
  const f = (e.clientY - r.top) / r.height;
  if (inside) return f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'inside';
  return f < 0.5 ? 'before' : 'after';
}

export const newGroupId = () =>
  `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** IDs das camadas na ordem da árvore (topo primeiro). */
export function flattenTree(tree: LayerTreeNode[]): string[] {
  return tree.flatMap((n) => (isGroup(n) ? n.children : [n.id]));
}

/**
 * Árvore coerente com as camadas: tira as que saíram do mapa (e repetidas) e põe no topo as que
 * ainda não estão nela, na ordem de `ids`. Sem árvore (projeto antigo), todas soltas.
 */
export function normalizeTree(tree: LayerTreeNode[] | undefined, ids: string[]): LayerTreeNode[] {
  const known = new Set(ids);
  const seen = new Set<string>();
  const keep = (id: string) => known.has(id) && !seen.has(id) && !!seen.add(id);
  const out: LayerTreeNode[] = [];
  for (const n of tree ?? []) {
    if (isGroup(n)) out.push({ ...n, children: n.children.filter(keep) });
    else if (keep(n.id)) out.push(n);
  }
  const missing = ids.filter((id) => !seen.has(id)).map((id) => ({ kind: 'layer' as const, id }));
  return [...missing, ...out];
}

/** Camadas reordenadas pela árvore (normalizada junto). */
export function syncTree(
  layers: LayerStyle[],
  tree: LayerTreeNode[] | undefined,
): { layers: LayerStyle[]; layerTree: LayerTreeNode[] } {
  const layerTree = normalizeTree(
    tree,
    layers.map((l) => l.sourceId),
  );
  const byId = new Map(layers.map((l) => [l.sourceId, l]));
  const ordered = flattenTree(layerTree).map((id) => byId.get(id)!);
  return { layers: ordered, layerTree };
}

/** Grupo que contém a camada (null = solta). */
export function groupOf(tree: LayerTreeNode[], layerId: string): Group | null {
  return tree.find((n): n is Group => isGroup(n) && n.children.includes(layerId)) ?? null;
}

/** Tira o item da árvore (o grupo sai com as camadas dele). */
function detach(tree: LayerTreeNode[], ref: TreeRef): LayerTreeNode[] {
  if (ref.kind === 'group') return tree.filter((n) => !(isGroup(n) && n.id === ref.id));
  return tree
    .filter((n) => isGroup(n) || n.id !== ref.id)
    .map((n) => (isGroup(n) ? { ...n, children: n.children.filter((c) => c !== ref.id) } : n));
}

const nodeOf = (tree: LayerTreeNode[], ref: TreeRef): LayerTreeNode | null =>
  ref.kind === 'group'
    ? (tree.find((n) => isGroup(n) && n.id === ref.id) ?? null)
    : tree.some((n) => !isGroup(n) && n.id === ref.id) || groupOf(tree, ref.id)
      ? { kind: 'layer', id: ref.id }
      : null;

const topIndex = (tree: LayerTreeNode[], ref: TreeRef) =>
  tree.findIndex((n) => n.kind === ref.kind && n.id === ref.id);

/**
 * Arrastar e soltar: `drag` vai para antes/depois de `target` ou para dentro do grupo `target`.
 * Grupos não entram em grupos (soltos sobre uma camada de um grupo, ficam ao lado desse grupo).
 */
export function dropNode(
  tree: LayerTreeNode[],
  drag: TreeRef,
  target: TreeRef,
  where: DropWhere,
): LayerTreeNode[] {
  if (drag.kind === target.kind && drag.id === target.id) return tree;
  const node = nodeOf(tree, drag);
  if (!node) return tree;
  const rest = detach(tree, drag);
  const insertTop = (ref: TreeRef, after: boolean) => {
    const i = topIndex(rest, ref);
    if (i < 0) return tree;
    const out = [...rest];
    out.splice(after ? i + 1 : i, 0, node);
    return out;
  };

  if (target.kind === 'group') {
    if (where === 'inside' && drag.kind === 'layer') {
      return rest.map((n) =>
        isGroup(n) && n.id === target.id ? { ...n, children: [drag.id, ...n.children] } : n,
      );
    }
    return insertTop(target, where === 'after');
  }

  const parent = groupOf(rest, target.id);
  if (!parent) return insertTop(target, where === 'after');
  if (drag.kind === 'group') return insertTop(parent, where === 'after');
  return rest.map((n) => {
    if (!isGroup(n) || n.id !== parent.id) return n;
    const children = [...n.children];
    const i = children.indexOf(target.id);
    children.splice(where === 'after' ? i + 1 : i, 0, drag.id);
    return { ...n, children };
  });
}

/** Setas: sobe/desce uma posição dentro do mesmo nível (no grupo, ou entre os itens soltos). */
export function stepNode(tree: LayerTreeNode[], ref: TreeRef, delta: -1 | 1): LayerTreeNode[] {
  const parent = ref.kind === 'layer' ? groupOf(tree, ref.id) : null;
  if (parent) {
    const i = parent.children.indexOf(ref.id);
    const j = i + delta;
    if (j < 0 || j >= parent.children.length) return tree;
    const children = [...parent.children];
    [children[i], children[j]] = [children[j], children[i]];
    return tree.map((n) => (n === parent ? { ...n, children } : n));
  }
  const i = topIndex(tree, ref);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= tree.length) return tree;
  const out = [...tree];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Pode subir/descer com as setas (não está na ponta do seu nível). */
export function canStep(tree: LayerTreeNode[], ref: TreeRef, delta: -1 | 1): boolean {
  return stepNode(tree, ref, delta) !== tree;
}

/** Move a camada para o grupo (no topo dele) ou para fora de grupos (null, logo acima do grupo). */
export function moveToGroup(
  tree: LayerTreeNode[],
  layerId: string,
  groupId: string | null,
): LayerTreeNode[] {
  if (groupId)
    return dropNode(tree, { kind: 'layer', id: layerId }, { kind: 'group', id: groupId }, 'inside');
  const parent = groupOf(tree, layerId);
  if (!parent) return tree;
  return dropNode(tree, { kind: 'layer', id: layerId }, { kind: 'group', id: parent.id }, 'before');
}

/** Desfaz o grupo: as camadas dele ficam soltas no mesmo lugar. */
export function ungroup(tree: LayerTreeNode[], groupId: string): LayerTreeNode[] {
  return tree.flatMap((n) =>
    isGroup(n) && n.id === groupId ? n.children.map((id) => ({ kind: 'layer' as const, id })) : [n],
  );
}
