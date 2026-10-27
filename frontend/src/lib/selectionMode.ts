import type { SelectedGroup } from '@/types';

/** Clique, retângulo ou polígono: substitui, soma ou tira os pontos da marcação. */
export type SelectionMode = 'replace' | 'add' | 'subtract';

/**
 * Shift soma à seleção. Ctrl (ou ⌘) tira da seleção os pontos da marcação.
 * Com os dois pressionados, Ctrl prevalece.
 */
export function selectionModeOf(e?: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): SelectionMode {
  if (e?.ctrlKey || e?.metaKey) return 'subtract';
  if (e?.shiftKey) return 'add';
  return 'replace';
}

/**
 * Atualiza os grupos de uma camada. `toggle` alterna o grupo inteiro (ferramenta de seleção
 * múltipla). Subtrair só remove os registros da marcação que já estavam selecionados.
 */
export function applyGroup(
  layer: Record<string, SelectedGroup>,
  group: SelectedGroup,
  mode: SelectionMode | 'toggle',
): Record<string, SelectedGroup> {
  const next = { ...layer };
  if (mode === 'toggle') {
    if (next[group.key]) delete next[group.key];
    else next[group.key] = group;
    return next;
  }
  if (mode === 'subtract') {
    const cur = next[group.key];
    if (!cur) return next;
    const remove = new Set(group.ids);
    const left = cur.ids.filter((id) => !remove.has(id));
    if (left.length) next[group.key] = { ...cur, ids: left };
    else delete next[group.key];
    return next;
  }
  if (mode === 'add') {
    const prev = next[group.key];
    next[group.key] = prev
      ? { ...group, ids: [...new Set([...prev.ids, ...group.ids])] }
      : group;
    return next;
  }
  next[group.key] = group;
  return next;
}
