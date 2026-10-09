import { describe, expect, it } from 'vitest';
import { groupLabelLines, prepareFull, prepareViewport, styleLayer } from '@/components/map/pointsOverlay';
import { newLayer } from '@/lib/layers';
import type { LayerPayloadFull, MapPointsResponse } from '@/types';

describe('rótulos de vários registros na mesma coordenada', () => {
  // Três registros em (1,1), um em (2,2).
  const payload: LayerPayloadFull = {
    mode: 'full',
    version: null,
    total: 4,
    ids: ['a', 'b', 'c', 'd'],
    x: [1, 1, 2, 1],
    y: [1, 1, 2, 1],
    lat: [-3, -3, -4, -3],
    lng: [-38, -38, -39, -38],
    cats: ['LD', 'ME'],
    cat: [0, 1, 0, 0],
    labels: ['878537 LD 100', '472977 ME 250', 'só', null],
  };

  it('camada inteira: até N rótulos, +resto, respeita categorias ocultas', () => {
    const p = prepareFull(payload);
    const layer = { ...newLayer('s', 0), styleColumn: 'tipo' };
    const st = styleLayer(p, layer);
    const g = p.keyIndex.get('1|1')!;
    expect(groupLabelLines(p, st, g, 1)).toEqual(['878537 LD 100']); // padrão: como antes
    expect(groupLabelLines(p, st, g, 5)).toEqual(['878537 LD 100', '472977 ME 250']);
    expect(groupLabelLines(p, st, p.keyIndex.get('2|2')!, 5)).toEqual(['só']);

    const p3 = prepareFull({ ...payload, labels: ['x1', 'x2', 'z', 'x3'] });
    expect(groupLabelLines(p3, styleLayer(p3, layer), g, 2)).toEqual(['x1', 'x2', '+1']);

    // Categoria ME oculta: o rótulo dela some.
    const hidden = styleLayer(p, { ...layer, categories: { ME: { color: '#000', size: 6, visible: false } } });
    expect(groupLabelLines(p, hidden, g, 5)).toEqual(['878537 LD 100']);
  });

  it('tabela grande (por região): usa os rótulos enviados pelo servidor', () => {
    const r: MapPointsResponse = {
      mode: 'groups',
      total: 3,
      groups: [
        { key: 'k1', x: 1, y: 1, lat: -3, lng: -38, count: 2, ids: ['a', 'b'], label: null, labels: ['A', 'B'], category: null },
        { key: 'k2', x: 2, y: 2, lat: -4, lng: -39, count: 1, ids: ['c'], label: 'C', category: null },
      ],
      clusters: [],
    } as unknown as MapPointsResponse;
    const p = prepareViewport(r, false);
    const st = styleLayer(p, newLayer('s', 0));
    expect(groupLabelLines(p, st, 0, 3)).toEqual(['A', 'B']);
    expect(groupLabelLines(p, st, 0, 1)).toEqual(['A']);
    expect(groupLabelLines(p, st, 1, 3)).toEqual(['C']);
  });
});
