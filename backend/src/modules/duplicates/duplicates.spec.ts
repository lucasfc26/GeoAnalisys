import { DupOptions, DupPoint, findDuplicates, idRelation } from './duplicates.logic';
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
  ids: null,
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
    const pts = [
      at(0, ['led', 'p1'], null, 'k'),
      at(0, ['led', 'p2'], null, 'k'),
      at(3, ['led', 'p3']),
    ];
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
    const r = findDuplicates(pts, {
      ...base,
      rules: [{ mode: 'different', scope: 'radius', weight: 5 }],
    });
    expect(r[0].score).toBe(0);
  });

  it('associação à referência e pontos sem associação por perto', () => {
    const reference = {
      maxDistance: 25,
      shared: 0,
      bothMatched: -3,
      oneMatched: 2,
      noneMatched: 1,
    };
    const pts = [
      at(0, [], true),
      at(2, [], false),
      at(4, [], false),
      at(6, [], false),
      at(100, [], true),
    ];
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

  it('disputam o mesmo ponto da referência: um ficou com ele e o outro, sem par, o alcança', () => {
    const reference = {
      maxDistance: 10,
      shared: 3,
      bothMatched: -3,
      oneMatched: 1,
      noneMatched: 1,
    };
    const refPos = { lat: LAT + 2 / 111_195, lng: LNG };
    // 0 associado ao ponto da referência a 2 m; 1 (sem par) a 4 m dele; 2 (sem par) a 18 m dele.
    const pts = [
      { ...at(0, [], true), refPos },
      at(6, [], false),
      at(-16, [], false),
      { ...at(40, [], true), refPos: { lat: LAT + 41 / 111_195, lng: LNG } },
      { ...at(43, [], true), refPos: { lat: LAT + 44 / 111_195, lng: LNG } },
    ];
    const r = findDuplicates(pts, { ...base, radius: 20, reference, minScore: -100 });
    const pair = (i: number, j: number) => r.find((p) => p.i === i && p.j === j)!;
    expect(pair(0, 1).parts.map((p) => p.key)).toEqual(['ref:shared']);
    expect(pair(0, 2).parts.map((p) => p.key)).toEqual(['ref:one']);
    // Cada um com o seu ponto (ex.: dois postes que já existiam): diminui a chance.
    expect(pair(3, 4)).toMatchObject({ score: -3 });
  });

  it('IDs: em sequência (intencional) ou sem relação (cadastro repetido por engano)', () => {
    expect(idRelation('123456', '123457', 10)).toBe('sequential');
    expect(idRelation('123456', '1234562', 10)).toBe('sequential');
    expect(idRelation('123456', '123470', 10)).toBeNull();
    expect(idRelation('123456', '234123', 10)).toBe('unrelated');
    expect(idRelation('PT-0012', 'PT-0013', 10)).toBeNull();
    expect(idRelation('PT-0012', 'XY-9', 10)).toBe('unrelated');
    expect(idRelation('123456', '123456', 10)).toBeNull();
    expect(idRelation(null, '1', 10)).toBeNull();
  });

  it('cenários: disputa + IDs sem relação + lâmpada igual e cadastrador diferente', () => {
    const reference = {
      maxDistance: 10,
      shared: 3,
      bothMatched: -3,
      oneMatched: 1,
      noneMatched: 1,
    };
    const ids = { maxGap: 10, sequential: -2, unrelated: 2 };
    // Regras: tipo de lâmpada igual (+1), cadastrador diferente (+1).
    const rules: DupOptions['rules'] = [
      { mode: 'equal', scope: 'radius', weight: 1 },
      { mode: 'different', scope: 'radius', weight: 1 },
    ];
    const refPos = { lat: LAT, lng: LNG };
    const pt = (north: number, id: string, cad: string, matched: boolean) => ({
      ...at(north, ['led', cad], matched),
      refPos: matched ? refPos : null,
      idKey: id,
    });
    const opts = { ...base, radius: 10, reference, ids, rules, minScore: 3 };
    // Engano: 123456 e 234123 disputam o mesmo ponto, mesma lâmpada, cadastradores diferentes.
    const engano = findDuplicates(
      [pt(0, '123456', 'ana', true), pt(4, '234123', 'bia', false)],
      opts,
    );
    expect(engano[0]).toMatchObject({ score: 3 + 2 + 1 + 1 });
    // Sequência: 123456 e 123457 — cadastrados de propósito; mesma pessoa.
    const seq = findDuplicates([pt(0, '123456', 'ana', true), pt(4, '123457', 'ana', false)], opts);
    expect(seq).toHaveLength(0);
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
        { key: 'ref:shared', weight: 3 },
        { key: 'id:unrelated', weight: 2 },
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
      'mesma coordenada (+2); potencia igual (+1); disputam o mesmo ponto de Censo Anterior (+3); IDs sem relação (+2); 4 sem associação a até 30 m (−1,5)',
    );
  });
});
