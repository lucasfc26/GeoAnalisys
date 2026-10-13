import {
  AttrPoint,
  Polygon,
  PolygonArea,
  attrKey,
  farFromCenter,
  farFromReference,
  parsePolygons,
} from './analysis.logic';

const LAT = -3.73;
const LNG = -38.52;
/** Metros → graus de latitude; de longitude, dividido por cos(lat) */
const M = 1 / 111_195.08;
const MX = M / Math.cos((LAT * Math.PI) / 180);

/** Quadrado de lado `side` m com canto sudoeste em (east, north) m da origem. */
function square(east: number, north: number, side: number): [number, number][] {
  const x0 = LNG + east * MX;
  const y0 = LAT + north * M;
  return [
    [x0, y0],
    [x0 + side * MX, y0],
    [x0 + side * MX, y0 + side * M],
    [x0, y0 + side * M],
    [x0, y0],
  ];
}
const at = (east: number, north: number) => [LNG + east * MX, LAT + north * M] as const;

describe('PolygonArea', () => {
  // Quadrado de 1000 m com buraco de 200 m no meio, e outro quadrado separado a leste.
  const polys: Polygon[] = [[square(0, 0, 1000), square(400, 400, 200)], [square(2000, 0, 500)]];
  const area = new PolygonArea(polys);

  it('dentro, fora e no buraco', () => {
    expect(area.contains(...at(100, 100))).toBe(true);
    expect(area.contains(...at(500, 500))).toBe(false); // buraco
    expect(area.contains(...at(1500, 100))).toBe(false); // entre os dois
    expect(area.contains(...at(2100, 100))).toBe(true); // segundo polígono
    expect(area.contains(...at(-50, 500))).toBe(false);
  });

  it('polígonos sobrepostos continuam "dentro" (união)', () => {
    const overlap = new PolygonArea([[square(0, 0, 100)], [square(50, 0, 100)]]);
    expect(overlap.contains(...at(75, 50))).toBe(true);
  });

  it('distância até a borda mais próxima (contorno ou buraco)', () => {
    expect(area.distance(...at(-50, 500))).toBeCloseTo(50, 0);
    expect(area.distance(...at(500, 500))).toBeCloseTo(100, 0); // centro do buraco
    expect(area.distance(...at(1250, 100))).toBeCloseTo(250, 0);
    expect(area.distance(...at(500, -3000))).toBeCloseTo(3000, -1);
  });

  it('confere com a força bruta num limite detalhado', () => {
    // Círculo com 5000 vértices; pontos espalhados até 30 km.
    const ring: [number, number][] = [];
    for (let i = 0; i < 5000; i++) {
      const t = (i / 5000) * 2 * Math.PI;
      ring.push([LNG + 2000 * MX * Math.cos(t), LAT + 2000 * M * Math.sin(t)]);
    }
    const circle = new PolygonArea([[ring]]);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let k = 0; k < 200; k++) {
      const e = rnd() * 30_000;
      const n = rnd() * 30_000;
      const r = Math.hypot(e, n);
      expect(circle.contains(...at(e, n))).toBe(r < 2000);
      expect(Math.abs(circle.distance(...at(e, n)) - Math.abs(r - 2000))).toBeLessThan(
        Math.max(2, r * 0.002),
      );
    }
  });
});

describe('parsePolygons', () => {
  it('aceita [[[lng, lat]]] e ignora anéis com menos de 3 pontos', () => {
    const p = parsePolygons([[square(0, 0, 10), [[0, 0]]]]);
    expect(p).toHaveLength(1);
    expect(p[0]).toHaveLength(1);
  });
  it('recusa formatos e coordenadas inválidos', () => {
    expect(() => parsePolygons([])).toThrow();
    expect(() => parsePolygons([[[[500000, 9000000]]]])).toThrow(/inválida/);
    expect(() => parsePolygons([[['a']]])).toThrow();
    expect(() => parsePolygons('x')).toThrow();
  });
});

describe('distância por atributo', () => {
  const p = (east: number, north: number, value: unknown): AttrPoint => ({
    lng: LNG + east * MX,
    lat: LAT + north * M,
    value,
  });

  it('attrKey: sem acentos/maiúsculas e zeros à esquerda opcionais', () => {
    expect(attrKey(' Médidor ', false)).toBe('medidor');
    expect(attrKey('000123', true)).toBe('123');
    expect(attrKey('000123', false)).toBe('000123');
    expect(attrKey(0, true)).toBe('0');
    expect(attrKey('', true)).toBeNull();
  });

  it('com referência: distância até o ponto da referência com o mesmo valor (o mais próximo)', () => {
    const pts = [
      p(0, 0, 'A1'),
      p(0, 300, '0042'),
      p(0, 0, 'ZZ'),
      p(0, 0, null),
      { lat: null, lng: null, value: 'A1' },
    ];
    const refs = [p(0, 20, 'a1'), p(0, 0, '42'), p(0, 280, 42)];
    const opts = { maxDistance: 50, stripZeros: true, ignore: [] };
    const r = farFromReference(pts, refs, opts);
    expect(r.map((x) => x.status)).toEqual(['ok', 'ok', 'noMatch', 'noValue', 'noCoords']);
    expect(r[0].distance).toBeCloseTo(20, 0);
    expect(r[1].ref).toBe(2); // o "42" mais próximo
    expect(r[1].sameValue).toBe(2);

    const far = farFromReference(pts, refs, { ...opts, maxDistance: 10 });
    expect(far[0].status).toBe('far');
  });

  it('valores de preenchimento ("SN", "0") são ignorados, não viram um grupo', () => {
    const pts = [p(0, 0, 'SN'), p(9000, 0, 's/n'), p(0, 0, '000'), p(0, 0, 'A1')];
    const refs = [p(5000, 0, 'SN'), p(0, 0, 0), p(0, 10, 'A1')];
    const opts = { maxDistance: 50, stripZeros: true, ignore: ['SN', 'S/N', '0'] };
    expect(farFromReference(pts, refs, opts).map((x) => x.status)).toEqual([
      'ignored',
      'ignored',
      'ignored',
      'ok',
    ]);
    const self = farFromCenter(pts, { ...opts, center: 'median', minPoints: 2 });
    expect(self.map((x) => x.status)).toEqual(['ignored', 'ignored', 'ignored', 'fewPoints']);
  });

  it('sem referência: centro pela mediana não é puxado pelo ponto distante', () => {
    const pts = [p(0, 0, 'M1'), p(10, 0, 'M1'), p(0, 10, 'M1'), p(5000, 0, 'M1'), p(0, 0, 'M2')];
    const opts = { maxDistance: 100, stripZeros: true, ignore: [], minPoints: 2 };
    const med = farFromCenter(pts, { ...opts, center: 'median' });
    expect(med.map((x) => x.status)).toEqual(['ok', 'ok', 'ok', 'far', 'fewPoints']);
    expect(med[3].distance).toBeGreaterThan(4900);

    // A média é puxada para o ponto distante: os próximos também passam do limite.
    const mean = farFromCenter(pts, { ...opts, center: 'mean' });
    expect(mean.slice(0, 4).every((x) => x.status === 'far')).toBe(true);
  });
});
