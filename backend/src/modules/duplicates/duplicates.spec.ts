import { DupOptions, DupPoint, findDuplicates } from './duplicates.logic';
import { describeParts } from './duplicates.service';

const LAT = -3.73;
const LNG = -38.52;
/** Ponto a `north` metros ao norte da origem. */
function at(
  north: number,
  values: (string | null)[] = [],
  matched: boolean | null = null,
  coordKey: string | null = `k${north}`,
): DupPoint {
  return { lat: LAT + north / 111_195, lng: LNG, coordKey, values, matched };
}

const base: DupOptions = {
  radius: 10,
  sameCoordWeight: 2,
  rules: [],
  reference: null,
  density: null,
  minScore: 0,
};

describe('duplicidades', () => {
  it('lista só os pares dentro do raio, do mais suspeito para o menos', () => {
    const pts = [at(0), at(0, [], null, 'k0'), at(5), at(50)];
    const r = findDuplicates(pts, base);
    expect(r.map((p) => [p.i, p.j])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
    expect(r[0]).toMatchObject({ sameCoord: true, score: 2 });
    expect(r[1].score).toBe(0);
  });

  it('regras de atributo: igual, diferente e só na mesma coordenada', () => {
    const pts = [at(0, ['led', 'p1'], null, 'k'), at(0, ['led', 'p2'], null, 'k'), at(3, ['led', 'p3'])];
    const r = findDuplicates(pts, {
      ...base,
      rules: [
        { mode: 'equal', scope: 'radius', weight: 1 },
        { mode: 'different', scope: 'sameCoord', weight: 3 },
      ],
      minScore: 2,
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ i: 0, j: 1, score: 6 });
    expect(r[0].parts.map((p) => p.key)).toEqual(['same', 'rule:0', 'rule:1']);
  });

  it('valores vazios não atendem regras', () => {
    const pts = [at(0, [null]), at(1, [null])];
    const r = findDuplicates(pts, { ...base, rules: [{ mode: 'different', scope: 'radius', weight: 5 }] });
    expect(r[0].score).toBe(0);
  });

  it('associação à referência e pontos sem associação por perto', () => {
    const reference = { bothMatched: -3, oneMatched: 2, noneMatched: 1 };
    const pts = [at(0, [], true), at(2, [], false), at(4, [], false), at(6, [], false), at(100, [], true)];
    const r = findDuplicates(pts, {
      ...base,
      radius: 3,
      reference,
      density: { radius: 10, minCount: 2, weight: -4 },
      minScore: -100,
    });
    const pair = (i: number, j: number) => r.find((p) => p.i === i && p.j === j)!;
    // 0-1: um associado (+2); sem associação perto, sem contar os dois: 2 e 3 → −4
    expect(pair(0, 1)).toMatchObject({ score: -2, nearbyUnmatched: 2 });
    // 2-3: nenhum associado (+1); só o 1 por perto
    expect(pair(2, 3)).toMatchObject({ score: 1, nearbyUnmatched: 1 });
  });

  it('agrupa pares ligados por pontos em comum', () => {
    const pts = [at(0), at(1), at(2), at(500), at(501)];
    const r = findDuplicates(pts, { ...base, radius: 1.5 });
    const groups = new Map(r.map((p) => [`${p.i}-${p.j}`, p.group]));
    expect(groups.get('0-1')).toBe(groups.get('1-2'));
    expect(groups.get('3-4')).not.toBe(groups.get('0-1'));
  });

  it('não é 1 para 1: mostra todos os candidatos dos pontos suspeitos, mesmo abaixo da mínima', () => {
    // Caso real: 864779 a 8 m de 845668 (suspeito) e a 11 m de 845669 (abaixo da mínima).
    const pts = [at(0, ['a']), at(8, ['a']), at(-11, ['b']), at(500, ['a']), at(503, ['b'])];
    const opts: DupOptions = {
      ...base,
      radius: 20,
      rules: [{ mode: 'equal', scope: 'radius', weight: 3 }],
      minScore: 3,
    };
    expect(findDuplicates(pts, opts).map((p) => [p.i, p.j])).toEqual([[0, 1]]);

    const r = findDuplicates(pts, { ...opts, includeNearby: true });
    expect(r.map((p) => [p.i, p.j, p.group, p.belowMin])).toEqual([
      [0, 1, 1, false],
      [0, 2, 1, true],
      [1, 2, 1, true],
    ]);
  });

  it('descreve os motivos com os pesos', () => {
    const text = describeParts(
      [
        { key: 'same', weight: 2 },
        { key: 'rule:0', weight: 1 },
        { key: 'ref:one', weight: 2 },
        { key: 'density', weight: -1.5 },
      ],
      {
        rules: [{ column: 'potencia', mode: 'equal', scope: 'radius', weight: 1 }],
        density: { radius: 30, minCount: 3, weight: -1.5 },
      },
      'Censo Anterior',
      4,
    );
    expect(text).toBe(
      'mesma coordenada (+2); potencia igual (+1); só um associado a Censo Anterior (+2); 4 sem associação a até 30 m (−1,5)',
    );
  });
});
