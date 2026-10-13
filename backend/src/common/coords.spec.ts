import { latLngToUtm, pairToXY, parseCoordValue, splitCoordPair, utmCode } from './coords';

const pairXY = (v: string, geographic: boolean) => {
  const p = splitCoordPair(v);
  return p ? pairToXY(p, geographic) : null;
};

describe('parseCoordValue', () => {
  it.each([
    ['-3,84386839999999', -3.84386839999999],
    ['-38,4041111', -38.4041111],
    ['566160,537294959', 566160.537294959],
    ['9575107,59118882', 9575107.59118882],
    ['-38,404111100000001234', -38.4041111],
    ['9.575.107,59', 9575107.59],
    ['-38.4041111', -38.4041111],
    [-3.5, -3.5],
  ])('%s', (v, n) => expect(parseCoordValue(v)).toBeCloseTo(n as number, 6));

  it.each([
    [`3º 50' 37,926" S`, -(3 + 50 / 60 + 37.926 / 3600)],
    [`38º 24' 14,8" W`, -(38 + 24 / 60 + 14.8 / 3600)],
    [`38°24'14.8"O`, -(38 + 24 / 60 + 14.8 / 3600)],
    [`S 3 50 37.926`, -(3 + 50 / 60 + 37.926 / 3600)],
    [`3:50:37.926 S`, -(3 + 50 / 60 + 37.926 / 3600)],
    [`3° 50,632' S`, -(3 + 50.632 / 60)],
    [`-3° 50′ 37.9″`, -(3 + 50 / 60 + 37.9 / 3600)],
    [`38,404 Oeste`, -38.404],
    [`3 graus 50' 37" sul`, -(3 + 50 / 60 + 37 / 3600)],
  ])('GMS %s', (v, n) => expect(parseCoordValue(v)).toBeCloseTo(n, 8));

  it.each(['abc', '', '12/05/2024', '3° 75\' S', '566 160'])('rejeita %s', (v) =>
    expect(parseCoordValue(v)).toBeNull(),
  );
});

describe('splitCoordPair + pairToXY', () => {
  it('lat, lng com vírgula decimal', () => {
    expect(pairXY('-3,84386839999999, -38,4041111', true)).toEqual({
      x: -38.4041111,
      y: -3.84386839999999,
    });
    expect(pairXY('-3,8438;-38,4041', true)).toEqual({ x: -38.4041, y: -3.8438 });
    expect(pairXY('-3,8438,-38,4041', true)).toEqual({ x: -38.4041, y: -3.8438 });
    expect(pairXY('(-3.8438, -38.4041)', true)).toEqual({ x: -38.4041, y: -3.8438 });
    expect(pairXY('-3.8438/-38.4041', true)).toEqual({ x: -38.4041, y: -3.8438 });
  });

  it('GMS com hemisférios', () => {
    const r = pairXY(`3º 50' 37,926" S 38º 24' 14,8" W`, true)!;
    expect(r.y).toBeCloseTo(-3.843868, 5);
    expect(r.x).toBeCloseTo(-38.404111, 5);
    // ordem invertida: longitude primeiro, reconhecida pelo hemisfério
    const s = pairXY(`38°24'14.8"W, 3°50'37.9"S`, true)!;
    expect(s.y).toBeCloseTo(-3.84386, 4);
    expect(s.x).toBeCloseTo(-38.40411, 4);
    const t = pairXY(`S 3°50'37.9" W 38°24'14.8"`, true)!;
    expect(t.y).toBeCloseTo(-3.84386, 4);
    const u = pairXY(`-3°50'37.9" -38°24'14.8"`, true)!;
    expect(u.x).toBeCloseTo(-38.40411, 4);
  });

  it('WKT e rótulos', () => {
    expect(pairXY('POINT(-38.4041 -3.8438)', true)).toEqual({ x: -38.4041, y: -3.8438 });
    expect(pairXY('lon: -38.4041 lat: -3.8438', true)).toEqual({ x: -38.4041, y: -3.8438 });
    expect(pairXY('Lat=-3.8438 Long=-38.4041', true)).toEqual({ x: -38.4041, y: -3.8438 });
    expect(pairXY('POINT(566160.5 9575107.5)', false)).toEqual({ x: 566160.5, y: 9575107.5 });
  });

  it('UTM em qualquer ordem', () => {
    expect(pairXY('566160,537294959 9575107,59118882', false)).toEqual({
      x: 566160.537294959,
      y: 9575107.59118882,
    });
    expect(pairXY('9575107,59; 566160,53', false)).toEqual({ x: 566160.53, y: 9575107.59 });
    expect(pairXY('566160.53,9575107.59', false)).toEqual({ x: 566160.53, y: 9575107.59 });
    expect(pairXY('N 9575107 E 566160', false)).toEqual({ x: 566160, y: 9575107 });
  });

  it('não é par', () => {
    expect(splitCoordPair('Rua A, 123')).toBeNull();
    expect(splitCoordPair('-3.84')).toBeNull();
  });
});

describe('UTM', () => {
  it('lat/lng → UTM zona 24S (SIRGAS 2000)', () => {
    const u = latLngToUtm(-3.84386839999999, -38.4041111)!;
    expect(u.label).toBe('24S');
    expect(u.code).toBe('EPSG:31984');
    expect(u.x).toBeCloseTo(566160.5, 0);
    expect(u.y).toBeCloseTo(9575107.6, 0);
  });

  it('códigos das zonas', () => {
    expect(utmCode(23, 'S')).toBe('EPSG:31983');
    expect(utmCode(22, 'N')).toBe('EPSG:31976');
    expect(utmCode(33, 'N')).toBe('EPSG:32633');
  });
});
