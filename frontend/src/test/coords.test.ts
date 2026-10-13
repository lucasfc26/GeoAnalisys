import { describe, expect, it } from 'vitest';
import { displayCoords, latLngToUtm, parseCoordinate, splitPair } from '@/lib/coords';

describe('coordenadas na busca', () => {
  it('separadores: vírgula, ponto e vírgula e espaço; decimal com ponto ou vírgula', () => {
    expect(splitPair('-3.5073866,-38.9065257')).toEqual([-3.5073866, -38.9065257]);
    expect(splitPair('-3.5073866, -38.9065257')).toEqual([-3.5073866, -38.9065257]);
    expect(splitPair('-3,5073866;-38,9065257')).toEqual([-3.5073866, -38.9065257]);
    expect(splitPair('-3.5073866 ; -38.9065257')).toEqual([-3.5073866, -38.9065257]);
    expect(splitPair('510376,5  9612212,7')).toEqual([510376.5, 9612212.7]);
    expect(splitPair('510376.5 9612212.7')).toEqual([510376.5, 9612212.7]);
    expect(splitPair('510376,5,9612212,7')).toEqual([510376.5, 9612212.7]);
    expect(splitPair('510376 9612212')).toEqual([510376, 9612212]);
  });

  it('não confunde com textos ou IDs', () => {
    expect(splitPair('878537')).toBeNull();
    expect(splitPair('Rua A, 25')).toBeNull();
    expect(splitPair('1 2 3')).toBeNull();
    expect(parseCoordinate('878537 LD 100')).toBeNull();
  });

  it('interpreta lat/lng ou UTM', () => {
    expect(parseCoordinate('-3.5073866,-38.9065257')).toEqual({ kind: 'latlng', lat: -3.5073866, lng: -38.9065257 });
    // Longitude primeiro (fora da faixa de latitude): inverte.
    expect(parseCoordinate('-138.5, -3.5')).toEqual({ kind: 'latlng', lat: -3.5, lng: -138.5 });
    expect(parseCoordinate('510376,5  9612212,7')).toEqual({ kind: 'projected', x: 510376.5, y: 9612212.7 });
    expect(parseCoordinate('9612212,7 510376,5')).toEqual({ kind: 'projected', x: 510376.5, y: 9612212.7 });
  });
});

describe('UTM no ponto', () => {
  it('lat/lng → UTM na zona do ponto', () => {
    const u = latLngToUtm(-3.84386839999999, -38.4041111)!;
    expect(u.zone).toBe('24S');
    expect(u.x).toBeCloseTo(566160.5, 0);
    expect(u.y).toBeCloseTo(9575107.6, 0);
  });

  it('camada UTM usa X/Y da tabela; geográfica calcula', () => {
    const p = { x: 566160.5, y: 9575107.6, lat: -3.8438, lng: -38.4041 };
    expect(displayCoords(p, { kind: 'utm', zone: 24, hemisphere: 'S' })).toMatchObject({
      utmX: 566160.5,
      computed: false,
      zone: '24S',
    });
    const g = displayCoords({ ...p, x: -38.4041, y: -3.8438 }, { kind: 'geographic' });
    expect(g.computed).toBe(true);
    expect(g.utmX).toBeCloseTo(566160, -1);
  });
});
