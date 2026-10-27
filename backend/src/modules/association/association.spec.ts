import {
  AssocPoint,
  addressTokens,
  addressesMatch,
  aggregateCounts,
  countCredit,
  associate,
  haversine,
  normalizeValue,
} from './association.logic';
import type { ColumnMeta } from '../../common/sql';
import {
  KEY_DISTANCE,
  KEY_ID_A,
  KEY_ID_B,
  KEY_SCORE,
  KEY_STATUS,
  KEY_WEIGHT,
  StatusPlan,
  attrKey,
  outputFields,
  statusResolver,
  valueNames,
} from './association.service';

const LAT = -3.73;
const LNG = -38.52;
/** Ponto a `north` metros ao norte e `east` metros a leste da origem. */
function at(north: number, east = 0, values: (string | null)[] = []): AssocPoint {
  const mLat = 111_195;
  return {
    lat: LAT + north / mLat,
    lng: LNG + east / (mLat * Math.cos((LAT * Math.PI) / 180)),
    values,
  };
}

describe('colunas do resultado', () => {
  const col = (name: string) => ({ name, kind: 'text' }) as ColumnMeta;
  const layer = (name: string, cols: string[]) => ({
    name,
    colMap: new Map(cols.map((c) => [c, col(c)])),
  });
  const A = layer('Censo Atual', ['endereco', 'medicao', 'potencia']);
  const B = layer('Censo Anterior', ['medicao', 'potencia']);

  it('padrão: IDs, distância, prioridades atendidas, penalidade, status e uma coluna por prioridade', () => {
    expect(outputFields(A, B, ['medicao']).map((f) => f.header)).toEqual([
      'ID Censo Atual',
      'ID Censo Anterior',
      'Distância (m)',
      'Prioridades atendidas',
      'Penalidade (m)',
      'Status',
      'Prioridade: medicao',
    ]);
  });

  it('tipos das colunas para gravar como camada', () => {
    const num = { name: 'potencia', kind: 'number' } as ColumnMeta;
    const A2 = { ...A, colMap: new Map([['potencia', num]]), idKind: 'integer' as const };
    const fields = outputFields(
      A2,
      B,
      ['medicao'],
      [
        KEY_ID_A,
        KEY_ID_B,
        KEY_DISTANCE,
        KEY_SCORE,
        KEY_STATUS,
        attrKey('A', 'potencia'),
        attrKey('B', 'medicao'),
        attrKey('A', '@lat'),
      ],
    );
    expect(fields.map((f) => f.type)).toEqual([
      'integer',
      'text',
      'number',
      'integer',
      'text',
      'number',
      'text',
      'number',
    ]);
  });

  describe('status', () => {
    const labels = ['medicao', 'tipo_lampada', 'potencia', 'agregados'];
    const pair = (met: boolean[]) => ({ distance: 1, met, score: 0 });
    const pt = (...statusValues: unknown[]) => ({ statusValues });
    type Rule = StatusPlan['rules'][number];
    const rule = (r: Partial<Rule> = {}): Rule => ({
      consider: true,
      unique: false,
      attr: null,
      ...r,
    });
    const resolve = (rules: Rule[]) => statusResolver('Censo Atual', { labels, rules });
    const plain = resolve([]);

    it('normal, divergência, ponto novo e não identificado', () => {
      const p = pt();
      expect(plain(p, p, pair([true, true, true, true]))).toBe('Ponto Normal');
      expect(plain(p, p, pair([true, false, false, true]))).toBe(
        'Divergência de tipo_lampada e potencia',
      );
      expect(plain(p, p, pair([false, false, false, false]))).toBe(
        'Divergência de medicao, tipo_lampada, potencia e agregados',
      );
      expect(statusResolver('Censo Atual', { labels: [], rules: [] })(p, p, pair([]))).toBe(
        'Ponto Normal',
      );
      expect(plain(p, null, null)).toBe('Ponto Novo coletado em Censo Atual');
      expect(plain(null, p, null)).toBe('Não Identificado em Censo Atual');
    });

    it('prioridade não considerada não gera divergência', () => {
      const f = resolve([rule(), rule(), rule(), rule({ consider: false })]);
      const p = pt();
      expect(f(p, p, pair([true, true, true, false]))).toBe('Ponto Normal');
      expect(f(p, p, pair([true, false, true, false]))).toBe('Divergência de tipo_lampada');
    });

    it('divergência única mostra só ela (a primeira, se houver mais de uma)', () => {
      const f = resolve([rule({ unique: true }), rule(), rule({ unique: true }), rule()]);
      const p = pt();
      expect(f(p, p, pair([false, false, false, true]))).toBe('Divergência de medicao');
      expect(f(p, p, pair([true, false, false, true]))).toBe('Divergência de potencia');
      expect(f(p, p, pair([true, false, true, false]))).toBe(
        'Divergência de tipo_lampada e agregados',
      );
    });

    it('ponto novo e não identificado: gerar divergência e atributo da própria camada', () => {
      const names = valueNames({ Sim: 'Medido', Não: 'Estimado' });
      const f = statusResolver('Censo Atual', {
        labels,
        rules: [],
        newPoints: { consider: true, attr: { side: 'A', index: 0, names } },
        unidentified: { consider: true, attr: { side: 'B', index: 1, names: valueNames({}) } },
      });
      expect(f(pt('Não'), null, null)).toBe('Ponto Novo coletado em Censo Atual Estimado');
      expect(f(pt(null), null, null)).toBe('Ponto Novo coletado em Censo Atual');
      expect(f(null, pt('x', 'LED'), null)).toBe('Não Identificado em Censo Atual LED');
      const off = statusResolver('Censo Atual', {
        labels,
        rules: [],
        newPoints: { consider: false, attr: null },
        unidentified: { consider: false, attr: null },
      });
      expect(off(pt(), null, null)).toBe('Ponto Normal');
      expect(off(null, pt(), null)).toBe('Ponto Normal');
    });

    it('acrescenta o valor do atributo, com os nomes escolhidos', () => {
      const names = valueNames({ Sim: 'Medido', NÃO: 'Estimado', '': 'Sem informação' });
      const medicaoA = { side: 'A' as const, index: 0, names };
      const f = resolve([rule(), rule({ attr: medicaoA }), rule({ attr: medicaoA }), rule()]);
      const q = pt();
      const diverge = pair([true, false, false, true]);
      expect(f(pt('sim'), q, diverge)).toBe('Divergência de tipo_lampada e potencia Medido');
      expect(f(pt('Nao'), q, diverge)).toBe('Divergência de tipo_lampada e potencia Estimado');
      expect(f(pt(null), q, diverge)).toBe('Divergência de tipo_lampada e potencia Sem informação');
      expect(f(pt('Talvez'), q, diverge)).toBe('Divergência de tipo_lampada e potencia Talvez');
      // Prioridade sem atributo: sem valor.
      expect(f(pt('Sim'), q, pair([false, true, true, true]))).toBe('Divergência de medicao');
      // Atributo da camada B.
      const g = resolve([rule({ attr: { side: 'B', index: 1, names: valueNames({}) } })]);
      expect(g(pt(), pt('x', 'LED'), pair([false, true, true, true]))).toBe(
        'Divergência de medicao LED',
      );
      expect(g(pt(), pt('x', null), pair([false, true, true, true]))).toBe(
        'Divergência de medicao',
      );
    });
  });

  it('atributos das duas camadas na ordem escolhida', () => {
    const fields = outputFields(
      A,
      B,
      ['medicao'],
      [
        KEY_ID_A,
        KEY_ID_B,
        attrKey('A', 'endereco'),
        attrKey('A', 'medicao'),
        attrKey('A', '@lat'),
        attrKey('B', 'medicao'),
        attrKey('B', '@lng'),
        KEY_DISTANCE,
        KEY_SCORE,
        KEY_WEIGHT,
        KEY_STATUS,
      ],
    );
    expect(fields.map((f) => f.header)).toEqual([
      'ID Censo Atual',
      'ID Censo Anterior',
      'endereco Censo Atual',
      'medicao Censo Atual',
      'Latitude Censo Atual',
      'medicao Censo Anterior',
      'Longitude Censo Anterior',
      'Distância (m)',
      'Prioridades atendidas',
      'Penalidade (m)',
      'Status',
    ]);
    const p = { id: 1, attrs: ['Rua A', 'Não', -3.7] } as never;
    const q = { id: 2, attrs: ['Sim', -38.5] } as never;
    const pair = { distance: 4.567, met: [false], score: 0 };
    expect(fields.map((f) => f.value(p, q, pair))).toEqual([
      1,
      2,
      'Rua A',
      'Não',
      -3.7,
      'Sim',
      -38.5,
      4.57,
      0,
      0,
      'Divergência de medicao',
    ]);
    // Sem par: 0 no ID da outra camada e atributos dela vazios.
    expect(fields.map((f) => f.value(p, null, null) ?? null)).toEqual([
      1,
      0,
      'Rua A',
      'Não',
      -3.7,
      null,
      null,
      null,
      null,
      null,
      'Ponto Novo coletado em Censo Atual',
    ]);
  });

  it('recusa colunas desconhecidas', () => {
    expect(() => outputFields(A, B, [], [attrKey('B', 'endereco')])).toThrow(/não existe/);
    expect(() => outputFields(A, B, [], ['@crit:medicao'])).toThrow(/desconhecida/);
    expect(() => outputFields(A, B, [], [])).toThrow(/ao menos uma/);
  });
});

describe('association', () => {
  it('mede distâncias em metros', () => {
    const a = at(0);
    const b = at(25);
    expect(haversine(a.lat!, a.lng!, b.lat!, b.lng!)).toBeCloseTo(25, 0);
  });

  it('normaliza valores (acentos, maiúsculas, vazios)', () => {
    expect(normalizeValue(' Não ')).toBe('nao');
    expect(normalizeValue('NAO')).toBe('nao');
    expect(normalizeValue('')).toBeNull();
    expect(normalizeValue(null)).toBeNull();
    expect(normalizeValue(70)).toBe('70');
  });

  it('associa o mais próximo, 1 para 1, e deixa sem par quem passa da distância máxima', () => {
    const a = [at(0), at(100), at(300)];
    const b = [at(3), at(5), at(110)];
    const r = associate(a, b, { maxDistance: 25, criteria: [] });
    expect(Array.from(r.matchA)).toEqual([0, 2, -1]);
    expect(Array.from(r.matchB)).toEqual([0, -1, 1]);
    expect(r.distance[0]).toBeCloseTo(3, 0);
    expect(Number.isNaN(r.distance[2])).toBe(true);
  });

  it('um ponto já associado não é usado de novo: o par mais próximo vence', () => {
    // a0 a 2 m de b0; a1 a 4 m de b0 — b0 fica com a0 e a1 fica sem par.
    const r = associate([at(0), at(6)], [at(2)], { maxDistance: 25, criteria: [] });
    expect(Array.from(r.matchA)).toEqual([0, -1]);
  });

  it('prioridade: prefere o ponto com o mesmo valor, mesmo um pouco mais longe', () => {
    const a = [at(0, 0, ['Não'].map(normalizeValue))];
    const b = [at(4, 0, ['Sim'].map(normalizeValue)), at(-6, 0, ['NAO'].map(normalizeValue))];
    // Custos: b0 = 4 + 10 (diverge), b1 = 6.
    const r = associate(a, b, { maxDistance: 25, criteria: [{ maxDistance: 25, weight: 10 }] });
    expect(r.matchA[0]).toBe(1);
    expect(r.metMask[0]).toBe(1);
    expect(r.cost[0]).toBeCloseTo(6, 1);
  });

  it('penalidade pequena: um par bem mais perto ainda vence', () => {
    const a = [at(0, 0, ['nao'])];
    const b = [at(4, 0, ['sim']), at(-6, 0, ['nao'])];
    // Custos: b0 = 4 + 1, b1 = 6.
    const r = associate(a, b, { maxDistance: 25, criteria: [{ maxDistance: 25, weight: 1 }] });
    expect(r.matchA[0]).toBe(0);
    expect(r.metMask[0]).toBe(0);
  });

  it('prioridade só vale dentro da distância dela', () => {
    const a = [at(0, 0, ['nao'])];
    const b = [at(4, 0, ['sim']), at(-6, 0, ['nao'])];
    const r = associate(a, b, { maxDistance: 25, criteria: [{ maxDistance: 5, weight: 10 }] });
    expect(r.matchA[0]).toBe(0);
    expect(r.metMask[0]).toBe(0);
  });

  it('com várias prioridades, vence o menor custo (distância + penalidades)', () => {
    const a = [at(0, 0, ['nao', 'vs', '70'])];
    const b = [
      at(2, 0, ['nao', 'ld', '100']), // 2 + 20
      at(8, 0, ['nao', 'vs', '100']), // 8 + 10
      at(-12, 0, ['sim', 'vs', '70']), // 12 + 10
    ];
    const crit = { maxDistance: 25, weight: 10 };
    const r = associate(a, b, { maxDistance: 25, criteria: [crit, crit, crit] });
    expect(r.matchA[0]).toBe(1);
    expect(r.metMask[0]).toBe(0b011);
  });

  it('penalidade: uma prioridade com penalidade alta vale mais que duas baixas', () => {
    const a = [at(0, 0, ['nao', 'ld', '100'])];
    const b = [
      at(2, 0, ['sim', 'ld', '100']), // diverge na medição: 2 + w
      at(-8, 0, ['nao', 'vs', '70']), // diverge em tipo e potência: 8 + 10 + 10
    ];
    const opts = (w: number) => ({
      maxDistance: 25,
      criteria: [
        { maxDistance: 25, weight: w },
        { maxDistance: 25, weight: 10 },
        { maxDistance: 25, weight: 10 },
      ],
    });
    expect(associate(a, b, opts(5)).matchA[0]).toBe(0);
    expect(associate(a, b, opts(50)).matchA[0]).toBe(1);
  });

  it('global: não "rouba" o ponto de outro se isso deixar alguém sem par', () => {
    // Pontos ao longo da rua, B a cada 15 m e A 10 m depois de cada B: o par mais curto de cada A
    // (5 m) é o B seguinte, mas isso deixaria o primeiro B e o último A sem par.
    const a: AssocPoint[] = [];
    const b: AssocPoint[] = [];
    for (let k = 0; k < 5; k++) {
      b.push(at(0, k * 15));
      a.push(at(0, k * 15 + 10));
    }
    const r = associate(a, b, { maxDistance: 12, criteria: [] });
    expect(Array.from(r.matchA)).toEqual([0, 1, 2, 3, 4]);
    // Cada par abriu mão de um par 5 m mais barato: margem negativa (dúbio).
    expect(r.margin[0]).toBeCloseTo(-5, 0);
    // Com custo de sem par baixo, 4 pares curtos e 2 pontos sem par ficam mais baratos.
    const cheap = associate(a, b, { maxDistance: 12, criteria: [], unmatchedCost: 10 });
    expect(Array.from(cheap.matchA)).toEqual([1, 2, 3, 4, -1]);
  });

  it('penalidade alta só é quebrada quando não há outra opção', () => {
    const medicao = { maxDistance: 25, weight: 1000 };
    // a0 (medido) tem b0 (não medido) a 2 m e b1 (medido) a 8 m: fica com b1.
    const a = [at(0, 0, ['sim'])];
    const b = [at(2, 0, ['nao']), at(-8, 0, ['sim'])];
    const opts = { maxDistance: 25, criteria: [medicao], unmatchedCost: 2000 };
    expect(associate(a, b, opts).matchA[0]).toBe(1);
    // Sem o b1, associa com o não medido mesmo assim (1002 < 2 × 2000).
    expect(associate(a, [b[0]], opts).matchA[0]).toBe(0);
    // Com custo de sem par menor que metade da penalidade, prefere deixar sem par.
    expect(associate(a, [b[0]], { ...opts, unmatchedCost: 400 }).matchA[0]).toBe(-1);
  });

  it('margem: segundo melhor candidato menos o custo do par', () => {
    // a0 fica com b0 (2 m); o outro candidato mais barato é a1 → b0 (5 m) ou a0 → b1 (9 m).
    const r = associate([at(0), at(7)], [at(2), at(9)], { maxDistance: 25, criteria: [] });
    expect(Array.from(r.matchA)).toEqual([0, 1]);
    expect(r.margin[0]).toBeCloseTo(3, 0);
    // Sem outro candidato: margem infinita; sem par: NaN.
    const alone = associate([at(0), at(100)], [at(2)], { maxDistance: 25, criteria: [] });
    expect(alone.margin[0]).toBe(Infinity);
    expect(Number.isNaN(alone.margin[1])).toBe(true);
  });

  it('custo do par deixa sem par quem não compensa', () => {
    const r = associate([at(0)], [at(20)], { maxDistance: 25, criteria: [], unmatchedCost: 9 });
    expect(r.matchA[0]).toBe(-1);
    expect(
      associate([at(0)], [at(20)], { maxDistance: 25, criteria: [], unmatchedCost: 11 }).matchA[0],
    ).toBe(0);
  });

  it('prioridade com distância maior que a máxima permite associar mais longe', () => {
    const a = [at(0, 0, ['nao'])];
    const b = [at(0, 40, ['nao'])];
    expect(associate(a, b, { maxDistance: 25, criteria: [] }).matchA[0]).toBe(-1);
    expect(associate(a, b, { maxDistance: 25, criteria: [{ maxDistance: 50 }] }).matchA[0]).toBe(0);
  });

  it('conta os pontos de cada coordenada exata', () => {
    expect(aggregateCounts(['1|2', '1|2', '3|4', '1|2', null])).toEqual(['3', '3', '1', '3', null]);
  });

  it('agregados: mesma quantidade atende; 1 de diferença paga metade; o resto, tudo', () => {
    expect(countCredit('1', '1')).toBe(1);
    expect(countCredit('3', '3')).toBe(1);
    expect(countCredit('3', '2')).toBe(0.5);
    expect(countCredit('3', '4')).toBe(0.5);
    expect(countCredit('1', '2')).toBe(0);
    expect(countCredit('3', '5')).toBe(0);
    expect(countCredit(null, '1')).toBe(0);
  });

  it('agregados: grupo fica com o grupo da mesma quantidade, mesmo mais longe', () => {
    // A (vermelho): grupo de 3 na origem, grupo de 2 a 60 m a leste, único a 75 m a leste.
    // B (azul): grupo de 2 a 10 m da origem, grupo de 3 a 40 m a oeste, único a 50 m a leste.
    const red = [at(0), at(0), at(0), at(-10, 60), at(-10, 60), at(-20, 55)];
    const blue = [at(5, 10), at(5, 10), at(10, -40), at(10, -40), at(10, -40), at(0, 50)];
    const withCounts = (pts: AssocPoint[]) => {
      const counts = aggregateCounts(pts.map((p) => `${p.lat}|${p.lng}`));
      return pts.map((p, i) => ({ ...p, values: [counts[i]] }));
    };
    const r = associate(withCounts(red), withCounts(blue), {
      maxDistance: 25,
      criteria: [{ maxDistance: 80, weight: 100, kind: 'count' }],
    });
    expect(Array.from(r.matchA.slice(0, 3)).sort()).toEqual([2, 3, 4]); // 3 com 3
    expect(Array.from(r.matchA.slice(3, 5)).sort()).toEqual([0, 1]); // 2 com 2
    expect(r.matchA[5]).toBe(5); // único com único
    expect(Array.from(r.metMask)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('agregados: 1 de diferença vence uma diferença maior', () => {
    // A: grupo de 3. B: grupo de 2 mais longe e grupo de 5 mais perto.
    const a = [at(0, 0, ['3'])];
    const b = [at(20, 0, ['2']), at(5, 0, ['5'])];
    const crit = [{ maxDistance: 25, weight: 100, kind: 'count' as const }];
    const r = associate(a, b, { maxDistance: 25, criteria: crit });
    // Custos: b0 = 20 + 50 (metade), b1 = 5 + 100.
    expect(r.matchA[0]).toBe(0);
    expect(r.cost[0]).toBeCloseTo(70, 1);
    expect(r.metMask[0]).toBe(0);
  });

  it('agregados: vários na mesma coordenada ficam com vários, único com único', () => {
    // Censo Atual: 788907 e 788908 juntos; 788909 sozinho e mais perto do grupo do Censo Anterior.
    const atual = [at(0), at(0), at(-10)];
    // Censo Anterior: 551525 e 551526 juntos; 445642 sozinho.
    const anterior = [at(-14), at(-14), at(-20, -10)];
    const withKinds = (pts: AssocPoint[]) => {
      const counts = aggregateCounts(pts.map((p) => `${p.lat}|${p.lng}`));
      return pts.map((p, i) => ({ ...p, values: [counts[i]] }));
    };

    const plain = associate(atual, anterior, { maxDistance: 25, criteria: [] });
    expect(plain.matchA[2]).toBe(0); // sem agregados, 788909 fica com 551525 (mais perto)

    const r = associate(withKinds(atual), withKinds(anterior), {
      maxDistance: 25,
      criteria: [{ maxDistance: 25, weight: 10, kind: 'count' }],
    });
    // a0 e a1 estão na mesma coordenada: tanto faz qual fica com b0 e qual com b1.
    expect(Array.from(r.matchA.slice(0, 2)).sort()).toEqual([0, 1]);
    expect(r.matchA[2]).toBe(2);
    expect(Array.from(r.metMask)).toEqual([1, 1, 1]);
  });

  it('ignora pontos sem coordenadas', () => {
    const a = [{ lat: null, lng: null, values: [] }, at(0)];
    const b = [at(1), { lat: null, lng: null, values: [] }];
    const r = associate(a, b, { maxDistance: 25, criteria: [] });
    expect(Array.from(r.matchA)).toEqual([-1, 0]);
  });
});

describe('endereço parecido', () => {
  const tokens = (v: string) => addressTokens(normalizeValue(v));
  const similar = (x: string, y: string) => addressesMatch(tokens(x)!, tokens(y)!);

  it('vazio, SDO, S/N ou só o tipo de logradouro não se aplicam', () => {
    for (const v of ['', '   ', 'SDO', 's.d.o', 'S/N', 'Não informado', 'Rua', 'R. s/n']) {
      expect(tokens(v)).toBeNull();
    }
  });

  it('parecido: número igual, palavra igual ou abreviada', () => {
    const base = 'Rua Exemplo, 123';
    for (const v of ['Ex 123', '123', 'exemplo', 'Rua 123', 'Rua Exem', 'R. EXÉMPLO nº 0123']) {
      expect(similar(base, v)).toBe(true);
    }
  });

  it('palavra de 1 ou 2 letras só casa inteira; de 3 ou mais, também abreviada', () => {
    expect(similar('Rua A', 'A')).toBe(true);
    expect(similar('Rua A 10', 'Travessa A')).toBe(true);
    expect(similar('Rua A', 'Rua B')).toBe(false);
    expect(similar('Rua Ex', 'Rua Ex')).toBe(true);
    expect(similar('Rua Exemplo', 'Ex')).toBe(false);
    expect(similar('Rua Exemplo', 'Exe')).toBe(true);
    expect(similar('Rua Exemplo', 'Rua Exem')).toBe(true);
  });

  it('tipo de logradouro (Rua, Av., Avenida, Travessa…) não conta, com ou sem ele', () => {
    expect(similar('Rua A', 'A')).toBe(true);
    expect(similar('Av. Brasil', 'Avenida Brasil')).toBe(true);
    expect(similar('Travessa Brasil', 'Brasil')).toBe(true);
    expect(similar('AV BRASIL 10', 'Tv. Brasil')).toBe(true);
    expect(similar('Av. Exemplo', 'Av. Brasil')).toBe(false);
    expect(similar('Rua Exemplo', 'Rua Brasil')).toBe(false);
  });

  it('divergente: nada em comum', () => {
    expect(similar('Rua Exemplo 123', 'Av. Brasil 500')).toBe(false);
    expect(similar('Rua 123', 'Rua Exemplo 999')).toBe(false);
    expect(similar('Rua Exemplo', 'Travessa Bento')).toBe(false);
  });

  it('prefere o ponto com endereço parecido; vazio ou SDO não penaliza', () => {
    const crit = [{ maxDistance: 25, weight: 10, kind: 'address' as const }];
    const a = [at(0, 0, [normalizeValue('Rua Exemplo 123')])];
    const b = [at(4, 0, [normalizeValue('Av Brasil 500')]), at(-6, 0, [normalizeValue('Ex 123')])];
    // Custos: b0 = 4 + 10 (diverge), b1 = 6.
    let r = associate(a, b, { maxDistance: 25, criteria: crit });
    expect(r.matchA[0]).toBe(1);
    expect(r.metMask[0]).toBe(1);

    // b0 com SDO: a regra não se aplica, sem penalidade (4 < 6).
    b[0].values = [normalizeValue('SDO')];
    r = associate(a, b, { maxDistance: 25, criteria: crit });
    expect(r.matchA[0]).toBe(0);
    expect(r.metMask[0]).toBe(1);
  });

  it('só endereço parecido de fato estende a distância de busca', () => {
    const crit = [{ maxDistance: 100, weight: 10, kind: 'address' as const }];
    const a = [at(0, 0, [normalizeValue('Rua Exemplo 123')])];
    expect(associate(a, [at(50, 0, [null])], { maxDistance: 25, criteria: crit }).matchA[0]).toBe(-1);
    expect(
      associate(a, [at(50, 0, [normalizeValue('Exemplo')])], { maxDistance: 25, criteria: crit })
        .matchA[0],
    ).toBe(0);
  });
});
