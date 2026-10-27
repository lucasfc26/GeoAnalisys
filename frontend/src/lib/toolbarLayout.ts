import { isToolbarSide, TOOLBAR_SIDES, type ToolbarSide } from '@/lib/toolbar';

/** Botões da barra, na ordem em que aparecem em Exibir › Painel. */
export const TOOLBAR_BUTTONS = [
  { id: 'pan', label: 'Navegar' },
  { id: 'select', label: 'Selecionar ponto' },
  { id: 'multi', label: 'Seleção múltipla' },
  { id: 'rectangle', label: 'Seleção por retângulo' },
  { id: 'polygon', label: 'Seleção por polígono' },
  { id: 'measure', label: 'Medir distância (régua)' },
  { id: 'streetview', label: 'Abrir no Street View' },
  { id: 'add', label: 'Adicionar ponto pelo mapa' },
  { id: 'move', label: 'Mover selecionados' },
  { id: 'duplicate', label: 'Duplicar selecionados' },
  { id: 'copyLayer', label: 'Copiar selecionados para nova camada' },
  { id: 'remove', label: 'Excluir selecionados' },
  { id: 'undo', label: 'Desfazer a última ação' },
  { id: 'list', label: 'Modo lista (percorrer valores)' },
  { id: 'preview', label: 'Preview do ponto selecionado' },
  { id: 'search', label: 'Selecionar por valor (atributos)' },
  { id: 'center', label: 'Centralizar' },
  { id: 'zoomIn', label: 'Aproximar' },
  { id: 'zoomOut', label: 'Afastar' },
  { id: 'export', label: 'Exportar' },
  { id: 'mapMaker', label: 'Criar mapa (Comitê / Status 18)' },
  { id: 'changes', label: 'Tabela de Alterações' },
  { id: 'refresh', label: 'Atualizar dados' },
] as const;

export type ToolbarButtonId = (typeof TOOLBAR_BUTTONS)[number]['id'];

const BUTTON_IDS = new Set<string>(TOOLBAR_BUTTONS.map((b) => b.id));

export const isToolbarButton = (id: string): id is ToolbarButtonId => BUTTON_IDS.has(id);

/** Barras por lado da tela (a 1ª fica junto da borda; as outras, mais para dentro). */
export const MAX_BARS = 3;

export interface ToolbarItem {
  id: string;
  /** group = pastinha de botões: mostra um e abre os outros segurando */
  kind: 'button' | 'divider' | 'group';
  side: ToolbarSide;
  /** Barra dentro do lado (0 = junto da borda); ausente = 0 */
  bar?: number;
  /** Botões do grupo, na ordem do menu */
  buttons?: ToolbarButtonId[];
  /** Botão do grupo usado por último (o que aparece na barra) */
  current?: ToolbarButtonId;
}

export interface ToolbarLayout {
  items: ToolbarItem[];
  /** Botões que não aparecem na barra (continuam em Exibir › Painel). */
  hidden: ToolbarButtonId[];
  /** Quantas barras cada lado tem (padrão 1) */
  bars?: Partial<Record<ToolbarSide, number>>;
}

/** Identificador do arraste (também vai em text/plain, que alguns navegadores exigem). */
export const TOOLBAR_DRAG = 'application/x-geoanalisys-toolbar';

const GROUPS: ToolbarButtonId[][] = [
  ['pan', 'select', 'multi', 'rectangle', 'polygon', 'measure', 'streetview', 'add'],
  ['move', 'duplicate', 'copyLayer', 'remove', 'undo'],
  ['list', 'preview', 'search', 'center', 'zoomIn', 'zoomOut'],
  ['export', 'mapMaker', 'changes', 'refresh'],
];

const barOf = (i: ToolbarItem) => i.bar ?? 0;
const barKey = (i: ToolbarItem) => `${i.side}:${barOf(i)}`;

export function defaultToolbarLayout(side: ToolbarSide = 'left'): ToolbarLayout {
  const items: ToolbarItem[] = [];
  GROUPS.forEach((group, i) => {
    if (i) items.push({ id: `d${i}`, kind: 'divider', side });
    for (const id of group) items.push({ id, kind: 'button', side });
  });
  return { items, hidden: [] };
}

/** Quantas barras o lado tem (ao menos as que têm itens). */
export function barsOf(layout: ToolbarLayout, side: ToolbarSide): number {
  let n = layout.bars?.[side] ?? 1;
  for (const i of layout.items) if (i.side === side) n = Math.max(n, barOf(i) + 1);
  return Math.min(Math.max(n, 1), MAX_BARS);
}

/** Botões visíveis de um grupo. */
export function groupButtons(layout: ToolbarLayout, item: ToolbarItem): ToolbarButtonId[] {
  const hidden = new Set(layout.hidden);
  return (item.buttons ?? []).filter((b) => !hidden.has(b));
}

/**
 * O que uma barra desenha: sem botões ocultos, sem grupos vazios e sem subdivisão solta. `bar`
 * ausente = todas as barras do lado; `'all'` = tudo (barra única do celular).
 */
export function slotsFor(
  layout: ToolbarLayout,
  side: ToolbarSide | 'all',
  bar?: number,
): ToolbarItem[] {
  const source =
    side === 'all'
      ? layout.items
      : layout.items.filter((i) => i.side === side && (bar === undefined || barOf(i) === bar));
  const hidden = new Set(layout.hidden);
  const seq = source.filter((i) =>
    i.kind === 'divider'
      ? true
      : i.kind === 'group'
        ? groupButtons(layout, i).length > 0
        : !hidden.has(i.id as ToolbarButtonId),
  );
  const out: ToolbarItem[] = [];
  let open = false;
  for (const it of seq) {
    if (it.kind === 'divider') {
      if (!open) continue;
      open = false;
      out.push(it);
    } else {
      open = true;
      out.push(it);
    }
  }
  if (out.at(-1)?.kind === 'divider') out.pop();
  return out;
}

export function sideHasSlots(layout: ToolbarLayout, side: ToolbarSide) {
  return slotsFor(layout, side).length > 0;
}

/** Tira subdivisões soltas (no começo, no fim ou coladas) de cada barra e grupos vazios ou de 1. */
function tidy(layout: ToolbarLayout): ToolbarLayout {
  const last = new Map<string, 'button' | 'divider'>();
  const items: ToolbarItem[] = [];
  for (const raw of layout.items) {
    let it = raw;
    if (it.kind === 'group') {
      const buttons = it.buttons ?? [];
      if (!buttons.length) continue;
      if (buttons.length === 1) it = { id: buttons[0], kind: 'button', side: it.side, bar: it.bar };
    }
    const key = barKey(it);
    if (it.kind === 'divider') {
      if (last.get(key) !== 'button') continue;
      last.set(key, 'divider');
    } else last.set(key, 'button');
    items.push(it);
  }
  const seenButton = new Set<string>();
  const drop = new Set<number>();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== 'divider') seenButton.add(barKey(it));
    else if (!seenButton.has(barKey(it))) drop.add(i);
  }
  return { ...layout, items: items.filter((_, i) => !drop.has(i)) };
}

/** Tira um botão de dentro do grupo em que estiver (o grupo de 1 vira botão em `tidy`). */
function takeFromGroups(items: ToolbarItem[], id: string): ToolbarItem[] {
  return items.map((i) =>
    i.kind === 'group' && i.buttons?.includes(id as ToolbarButtonId)
      ? {
          ...i,
          buttons: i.buttons.filter((b) => b !== id),
          current: i.current === id ? undefined : i.current,
        }
      : i,
  );
}

/** Grupo que contém o botão (null = solto na barra). */
export function groupOf(layout: ToolbarLayout, id: string): ToolbarItem | null {
  return (
    layout.items.find((i) => i.kind === 'group' && i.buttons?.includes(id as ToolbarButtonId)) ??
    null
  );
}

/**
 * Move um botão, grupo ou subdivisão. `beforeId` é o item diante do qual ele fica; sem ele, vai
 * para o fim da barra (`end: 'side'`) ou da lista inteira (`end: 'list'`). Um botão de dentro de um
 * grupo sai do grupo.
 */
export function placeToolbarItem(
  layout: ToolbarLayout,
  dragId: string,
  side: ToolbarSide,
  beforeId: string | null,
  end: 'side' | 'list' = 'side',
  bar = 0,
): ToolbarLayout {
  if (beforeId === dragId) return layout;
  const inGroup = groupOf(layout, dragId);
  const moving: ToolbarItem | undefined = inGroup
    ? { id: dragId, kind: 'button', side }
    : layout.items.find((i) => i.id === dragId);
  if (!moving) return layout;
  const items = inGroup
    ? takeFromGroups(layout.items, dragId)
    : layout.items.filter((i) => i.id !== dragId);
  const next: ToolbarItem = { ...moving, side, bar: bar || undefined };
  if (beforeId) {
    const at = items.findIndex((i) => i.id === beforeId);
    if (at < 0) items.push(next);
    else items.splice(at, 0, next);
  } else if (end === 'list') items.push(next);
  else {
    let at = items.length;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].side === side && barOf(items[i]) === bar) {
        at = i + 1;
        break;
      }
    }
    items.splice(at, 0, next);
  }
  return tidy({ ...layout, items });
}

let seq = 0;
function newId(layout: ToolbarLayout, prefix: string) {
  const used = new Set(layout.items.map((i) => i.id));
  let id = '';
  do {
    seq += 1;
    id = `${prefix}${seq.toString(36)}`;
  } while (used.has(id));
  return id;
}

/**
 * Solta um botão (ou grupo) sobre outro: vira um grupo no lugar do alvo, ou entra no grupo alvo.
 * Subdivisões não agrupam (devolve o arranjo como está).
 */
export function groupToolbarItems(
  layout: ToolbarLayout,
  dragId: string,
  targetId: string,
): ToolbarLayout {
  if (dragId === targetId) return layout;
  const target = layout.items.find((i) => i.id === targetId);
  if (!target || target.kind === 'divider') return layout;
  const dragged = layout.items.find((i) => i.id === dragId);
  const fromGroup = groupOf(layout, dragId);
  if (fromGroup?.id === targetId) return layout;
  let adding: ToolbarButtonId[];
  let items: ToolbarItem[];
  if (fromGroup) {
    adding = [dragId as ToolbarButtonId];
    items = takeFromGroups(layout.items, dragId);
  } else if (dragged?.kind === 'button') {
    adding = [dragId as ToolbarButtonId];
    items = layout.items.filter((i) => i.id !== dragId);
  } else if (dragged?.kind === 'group') {
    adding = dragged.buttons ?? [];
    items = layout.items.filter((i) => i.id !== dragId);
  } else return layout;
  const at = items.findIndex((i) => i.id === targetId);
  if (at < 0) return layout;
  const t = items[at];
  items[at] =
    t.kind === 'group'
      ? { ...t, buttons: [...(t.buttons ?? []), ...adding.filter((b) => !t.buttons?.includes(b))] }
      : {
          id: newId(layout, 'g'),
          kind: 'group',
          side: t.side,
          bar: t.bar,
          buttons: [t.id as ToolbarButtonId, ...adding],
          current: t.id as ToolbarButtonId,
        };
  return tidy({ ...layout, items });
}

/** Desfaz o grupo: os botões voltam para a barra, no lugar dele. */
export function ungroupToolbarItem(layout: ToolbarLayout, groupId: string): ToolbarLayout {
  const items = layout.items.flatMap((i): ToolbarItem[] =>
    i.id === groupId && i.kind === 'group'
      ? (i.buttons ?? []).map((id) => ({ id, kind: 'button', side: i.side, bar: i.bar }))
      : [i],
  );
  return tidy({ ...layout, items });
}

/** Lembra o botão do grupo usado por último (é o que aparece na barra). */
export function setGroupCurrent(
  layout: ToolbarLayout,
  groupId: string,
  id: ToolbarButtonId,
): ToolbarLayout {
  const g = layout.items.find((i) => i.id === groupId);
  if (!g || g.kind !== 'group' || g.current === id || !g.buttons?.includes(id)) return layout;
  return { ...layout, items: layout.items.map((i) => (i === g ? { ...i, current: id } : i)) };
}

/** Insere uma subdivisão; null se ela ficaria no começo, no fim ou colada em outra. */
export function insertDivider(
  layout: ToolbarLayout,
  side: ToolbarSide,
  beforeId: string | null,
  bar = 0,
): ToolbarLayout | null {
  const anchor = beforeId ? layout.items.find((i) => i.id === beforeId) : null;
  const atSide = anchor?.side ?? side;
  const atBar = anchor ? barOf(anchor) : bar;
  const id = newId(layout, 'd');
  const placed = placeToolbarItem(
    {
      ...layout,
      items: [...layout.items, { id, kind: 'divider', side: atSide, bar: atBar || undefined }],
    },
    id,
    atSide,
    beforeId,
    'side',
    atBar,
  );
  return placed.items.some((i) => i.id === id) ? placed : null;
}

export function removeDivider(layout: ToolbarLayout, id: string): ToolbarLayout {
  return tidy({ ...layout, items: layout.items.filter((i) => i.id !== id) });
}

/** Acrescenta uma barra ao lado (até MAX_BARS); ela aparece vazia, pronta para receber botões. */
export function addToolbarBar(layout: ToolbarLayout, side: ToolbarSide): ToolbarLayout {
  const n = barsOf(layout, side);
  if (n >= MAX_BARS) return layout;
  return { ...layout, bars: { ...layout.bars, [side]: n + 1 } };
}

/** Remove uma barra extra: os itens dela vão para o fim da barra anterior; as seguintes recuam. */
export function removeToolbarBar(
  layout: ToolbarLayout,
  side: ToolbarSide,
  bar: number,
): ToolbarLayout {
  if (bar <= 0) return layout;
  const n = barsOf(layout, side);
  const moved = layout.items.filter((i) => i.side === side && barOf(i) === bar);
  const rest = layout.items
    .filter((i) => !(i.side === side && barOf(i) === bar))
    .map((i) => (i.side === side && barOf(i) > bar ? { ...i, bar: barOf(i) - 1 || undefined } : i));
  let at = rest.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].side === side && barOf(rest[i]) === bar - 1) {
      at = i + 1;
      break;
    }
  }
  rest.splice(at, 0, ...moved.map((i) => ({ ...i, bar: bar - 1 || undefined })));
  return tidy({ ...layout, items: rest, bars: { ...layout.bars, [side]: n - 1 } });
}

export function toggleToolbarButton(layout: ToolbarLayout, id: string): ToolbarLayout {
  if (!isToolbarButton(id)) return layout;
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((x) => x !== id)
    : [...layout.hidden, id];
  return tidy({ ...layout, hidden });
}

/** Tudo num lado só, mantendo as barras (as barras extras dos outros lados somem). */
export function moveAllToSide(layout: ToolbarLayout, side: ToolbarSide): ToolbarLayout {
  const n = Math.max(...TOOLBAR_SIDES.map((s) => barsOf(layout, s.side)));
  return {
    ...layout,
    items: layout.items.map((i) => ({ ...i, side })),
    bars: n > 1 ? { [side]: n } : undefined,
  };
}

/**
 * Leva os itens de um lado (ou só de uma barra dele) para outro, na mesma ordem. Sem `bar`, as
 * barras vão juntas; com `bar`, os itens vão para a 1ª barra do destino.
 */
export function moveSide(
  layout: ToolbarLayout,
  from: ToolbarSide,
  to: ToolbarSide,
  bar?: number,
): ToolbarLayout {
  if (from === to) return layout;
  if (bar === undefined) {
    const n = Math.max(barsOf(layout, from), barsOf(layout, to));
    return {
      ...layout,
      items: layout.items.map((i) => (i.side === from ? { ...i, side: to } : i)),
      bars: { ...layout.bars, [from]: 1, [to]: n },
    };
  }
  const moved = layout.items.filter((i) => i.side === from && barOf(i) === bar);
  const rest = layout.items.filter((i) => !(i.side === from && barOf(i) === bar));
  return tidy({
    ...layout,
    items: [...rest, ...moved.map((i) => ({ ...i, side: to, bar: undefined }))],
  });
}

/** Checkboxes de Exibir › Painel, na ordem fixa do catálogo. */
export function layoutButtonState(layout: ToolbarLayout) {
  const hidden = new Set(layout.hidden);
  return TOOLBAR_BUTTONS.map((b) => ({ id: b.id, label: b.label, visible: !hidden.has(b.id) }));
}

export function normalizeToolbarLayout(
  raw: unknown,
  fallbackSide: ToolbarSide = 'left',
): ToolbarLayout {
  const side = isToolbarSide(fallbackSide) ? fallbackSide : 'left';
  const base = defaultToolbarLayout(side);
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as { items?: unknown; hidden?: unknown; bars?: unknown };
  if (!Array.isArray(o.items)) return base;
  const items: ToolbarItem[] = [];
  const seen = new Set<string>();
  const barNum = (v: unknown) =>
    Number.isInteger(v) && (v as number) > 0 && (v as number) < MAX_BARS
      ? (v as number)
      : undefined;
  for (const it of o.items) {
    if (!it || typeof it !== 'object') continue;
    const rec = it as {
      id?: unknown;
      kind?: unknown;
      side?: unknown;
      bar?: unknown;
      buttons?: unknown;
      current?: unknown;
    };
    if (typeof rec.id !== 'string' || !isToolbarSide(rec.side) || seen.has(rec.id)) continue;
    const bar = barNum(rec.bar);
    if (rec.kind === 'divider') {
      seen.add(rec.id);
      items.push({ id: rec.id, kind: 'divider', side: rec.side, bar });
    } else if (rec.kind === 'button' && isToolbarButton(rec.id)) {
      seen.add(rec.id);
      items.push({ id: rec.id, kind: 'button', side: rec.side, bar });
    } else if (rec.kind === 'group' && Array.isArray(rec.buttons)) {
      const buttons = rec.buttons.filter(
        (b): b is ToolbarButtonId => typeof b === 'string' && isToolbarButton(b) && !seen.has(b),
      );
      const unique = [...new Set(buttons)];
      if (!unique.length) continue;
      seen.add(rec.id);
      unique.forEach((b) => seen.add(b));
      const current =
        typeof rec.current === 'string' && unique.includes(rec.current as ToolbarButtonId)
          ? (rec.current as ToolbarButtonId)
          : undefined;
      items.push({ id: rec.id, kind: 'group', side: rec.side, bar, buttons: unique, current });
    }
  }
  if (!items.some((i) => i.kind !== 'divider')) return base;
  for (const b of TOOLBAR_BUTTONS) {
    if (!seen.has(b.id)) items.push({ id: b.id, kind: 'button', side });
  }
  const hidden = Array.isArray(o.hidden)
    ? o.hidden.filter((id): id is ToolbarButtonId => typeof id === 'string' && isToolbarButton(id))
    : [];
  let bars: ToolbarLayout['bars'];
  if (o.bars && typeof o.bars === 'object') {
    for (const s of TOOLBAR_SIDES) {
      const n = (o.bars as Record<string, unknown>)[s.side];
      if (Number.isInteger(n) && (n as number) > 1 && (n as number) <= MAX_BARS) {
        bars = { ...bars, [s.side]: n as number };
      }
    }
  }
  return tidy({ items, hidden, ...(bars ? { bars } : {}) });
}
