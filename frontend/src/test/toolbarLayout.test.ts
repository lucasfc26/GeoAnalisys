import {
  addToolbarBar,
  barsOf,
  defaultToolbarLayout,
  groupToolbarItems,
  moveSide,
  removeToolbarBar,
  setGroupCurrent,
  ungroupToolbarItem,
  insertDivider,
  moveAllToSide,
  normalizeToolbarLayout,
  placeToolbarItem,
  removeDivider,
  slotsFor,
  toggleToolbarButton,
} from '@/lib/toolbarLayout';

const ids = (layout: { items: { id: string; side: string }[] }, side?: string) =>
  layout.items.filter((i) => !side || i.side === side).map((i) => i.id);

describe('arranjo da barra de ferramentas', () => {
  it('leva um botão para outro lado, antes de um item', () => {
    const layout = defaultToolbarLayout('left');
    const next = placeToolbarItem(layout, 'pan', 'right', 'select');
    expect(ids(next, 'right')).toEqual(['pan']);
    expect(ids(next, 'left')[0]).toBe('select');
    expect(next.items.find((i) => i.id === 'pan')?.side).toBe('right');
  });

  it('insere uma subdivisão entre botões e recusa no começo', () => {
    const layout = defaultToolbarLayout('left');
    const between = insertDivider(layout, 'left', 'select');
    expect(between).not.toBeNull();
    const row = ids(between!);
    const at = row.indexOf('select');
    expect(row[at - 1]).toMatch(/^d/);
    expect(insertDivider(layout, 'left', 'pan')).toBeNull();
  });

  it('remove uma subdivisão', () => {
    const layout = defaultToolbarLayout('left');
    expect(ids(layout)).toContain('d1');
    expect(ids(removeDivider(layout, 'd1'))).not.toContain('d1');
  });

  it('oculta e mostra um botão sem tirá-lo do arranjo', () => {
    const layout = defaultToolbarLayout('left');
    const hidden = toggleToolbarButton(layout, 'measure');
    expect(hidden.hidden).toEqual(['measure']);
    expect(hidden.items.some((i) => i.id === 'measure')).toBe(true);
    expect(slotsFor(hidden, 'left').some((i) => i.id === 'measure')).toBe(false);
    expect(toggleToolbarButton(hidden, 'measure').hidden).toEqual([]);
  });

  it('junta subdivisões coladas e tira as do fim', () => {
    const next = normalizeToolbarLayout(
      {
        items: [
          { id: 'pan', kind: 'button', side: 'left' },
          { id: 'dx', kind: 'divider', side: 'left' },
          { id: 'dy', kind: 'divider', side: 'left' },
          { id: 'select', kind: 'button', side: 'left' },
          { id: 'dz', kind: 'divider', side: 'left' },
        ],
        hidden: [],
      },
      'left',
    );
    const row = ids(next, 'left');
    expect(row[0]).toBe('pan');
    expect(row[1]).toBe('dx');
    expect(row[2]).toBe('select');
    expect(row).not.toContain('dy');
    const trailing = removeDivider(
      {
        ...defaultToolbarLayout('left'),
        items: [...defaultToolbarLayout('left').items, { id: 'dz', kind: 'divider', side: 'left' }],
      },
      'ausente',
    );
    expect(ids(trailing)).not.toContain('dz');
  });

  it('completa um botão que faltava e descarta o que não existe', () => {
    const raw = {
      items: [
        { id: 'pan', kind: 'button', side: 'top' },
        { id: 'fantasma', kind: 'button', side: 'top' },
        { id: 'select', kind: 'button', side: 'right' },
      ],
      hidden: ['pan', 'nao-existe'],
    };
    const next = normalizeToolbarLayout(raw, 'left');
    expect(next.items.filter((i) => i.id === 'pan')).toHaveLength(1);
    expect(next.items.some((i) => i.id === 'fantasma')).toBe(false);
    expect(next.items.find((i) => i.id === 'zoomIn')?.side).toBe('left');
    expect(next.hidden).toEqual(['pan']);
    expect(normalizeToolbarLayout(null, 'bottom').items.every((i) => i.side === 'bottom')).toBe(true);
  });

  it('leva a barra inteira para um lado', () => {
    const next = moveAllToSide(defaultToolbarLayout('left'), 'top');
    expect(next.items.every((i) => i.side === 'top')).toBe(true);
  });

  it('agrupa um botão sobre outro, no lugar do alvo, e acrescenta ao grupo', () => {
    const layout = defaultToolbarLayout('left');
    const g = groupToolbarItems(layout, 'measure', 'select');
    const group = g.items.find((i) => i.kind === 'group')!;
    expect(group.buttons).toEqual(['select', 'measure']);
    expect(group.current).toBe('select');
    expect(ids(g)).not.toContain('measure');
    expect(ids(g).indexOf(group.id)).toBe(1);
    const more = groupToolbarItems(g, 'zoomIn', group.id);
    expect(more.items.find((i) => i.id === group.id)!.buttons).toEqual(['select', 'measure', 'zoomIn']);
    expect(slotsFor(more, 'left').some((i) => i.id === 'zoomIn')).toBe(false);
  });

  it('subdivisão não agrupa; grupo sobre botão junta tudo', () => {
    const layout = defaultToolbarLayout('left');
    expect(groupToolbarItems(layout, 'd1', 'pan')).toBe(layout);
    const g = groupToolbarItems(layout, 'measure', 'select');
    const gid = g.items.find((i) => i.kind === 'group')!.id;
    const merged = groupToolbarItems(g, gid, 'pan');
    const groups = merged.items.filter((i) => i.kind === 'group');
    expect(groups).toHaveLength(1);
    expect(groups[0].buttons).toEqual(['pan', 'select', 'measure']);
  });

  it('tirar um botão do grupo; grupo de 1 vira botão; desagrupar devolve os botões', () => {
    const layout = defaultToolbarLayout('left');
    const g = groupToolbarItems(layout, 'measure', 'select');
    const gid = g.items.find((i) => i.kind === 'group')!.id;
    const out = placeToolbarItem(g, 'measure', 'right', null);
    expect(ids(out, 'right')).toEqual(['measure']);
    expect(out.items.some((i) => i.kind === 'group')).toBe(false);
    expect(ids(out, 'left')).toContain('select');
    const back = ungroupToolbarItem(g, gid);
    expect(ids(back, 'left').slice(0, 3)).toEqual(['pan', 'select', 'measure']);
    expect(setGroupCurrent(g, gid, 'measure').items.find((i) => i.id === gid)!.current).toBe('measure');
  });

  it('grupo com todos os botões ocultos some da barra', () => {
    const g = groupToolbarItems(defaultToolbarLayout('left'), 'measure', 'select');
    const hidden = toggleToolbarButton(toggleToolbarButton(g, 'select'), 'measure');
    expect(slotsFor(hidden, 'left').some((i) => i.kind === 'group')).toBe(false);
  });

  it('barras extras: adiciona, recebe botões e remove levando-os para a anterior', () => {
    const layout = addToolbarBar(defaultToolbarLayout('left'), 'left');
    expect(barsOf(layout, 'left')).toBe(2);
    expect(slotsFor(layout, 'left', 1)).toEqual([]);
    const moved = placeToolbarItem(layout, 'export', 'left', null, 'side', 1);
    expect(slotsFor(moved, 'left', 1).map((i) => i.id)).toEqual(['export']);
    expect(slotsFor(moved, 'left', 0).some((i) => i.id === 'export')).toBe(false);
    const removed = removeToolbarBar(moved, 'left', 1);
    expect(barsOf(removed, 'left')).toBe(1);
    expect(slotsFor(removed, 'left', 0).at(-1)?.id).toBe('export');
    expect(barsOf(addToolbarBar(addToolbarBar(layout, 'left'), 'left'), 'left')).toBe(3);
  });

  it('move só uma barra para outro lado', () => {
    const layout = placeToolbarItem(addToolbarBar(defaultToolbarLayout('left'), 'left'), 'export', 'left', null, 'side', 1);
    const next = moveSide(layout, 'left', 'top', 1);
    expect(ids(next, 'top')).toEqual(['export']);
    expect(ids(next, 'left')).toContain('pan');
  });

  it('salva e lê grupos e barras', () => {
    let layout = groupToolbarItems(defaultToolbarLayout('left'), 'measure', 'select');
    layout = placeToolbarItem(addToolbarBar(layout, 'right'), 'export', 'right', null, 'side', 1);
    const back = normalizeToolbarLayout(JSON.parse(JSON.stringify(layout)), 'left');
    expect(back).toEqual(layout);
  });
});
