import {
  AssocPoint,
  aggregateKinds,
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

  it('padrão: IDs, distância, prioridades atendidas, pontuação, status e uma coluna por prioridade', () => {
    expect(outputFields(A, B, ['medicao']).map((f) => f.header)).toEqual([
      'ID Censo Atual',
      'ID Censo Anterior',
      'Distância (m)',
      'Prioridades atendidas',
      'Pontuação',
      'Status',
      'Prioridade: medicao',
    ]);
  });

  describe('status', () => {
    const labels = ['medicao', 'tipo_lampada', 'potencia', 'agregados'];
    const pair = (met: boolean[]) => ({ distance: 1, met, score: 0 });
    const pt = (...statusValues: unknown[]) => ({ statusValues });
    type Rule = StatusPlan['rules'][number];
    const rule = (r: Partial<Rule> = {}): Rule => ({ consider: true, unique: false, attr: null, ...r });
    const resolve = (rules: Rule[]) => statusResolver('Censo Atual', { labels, rules });
    const plain = resolve([]);

    it('normal, divergência, ponto novo e não identificado', () => {
      const p = pt();
      expect(plain(p, p, pair([true, true, true, true]))).toBe('Ponto Normal');
      expect(plain(p, p, pair([true, false, false, true]))).toBe('Divergência de tipo_lampada e potencia');
      expect(plain(p, p, pair([false, false, false, false]))).toBe(
        'Divergência de medicao, tipo_lampada, potencia e agregados',
      );
      expect(statusResolver('Censo Atual', { labels: [], rules: [] })(p, p, pair([]))).toBe('Ponto Normal');
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
      expect(f(p, p, pair([true, false, true, false]))).toBe('Divergência de tipo_lampada e agregados');
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
      const names = valueNames({ Sim: 'Medido', 'NÃO': 'Estimado', '': 'Sem informação' });
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
      expect(g(pt(), pt('x', 'LED'), pair([false, true, true, true]))).toBe('Divergência de medicao LED');
      expect(g(pt(), pt('x', null), pair([false, true, true, true]))).toBe('Divergência de medicao');
    });
  });

  it('atributos das duas camadas na ordem escolhida', () => {
    const fields = outputFields(A, B, ['medicao'], [
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
    ]);
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
      'Pontuação',
      'Status',
    ]);
    const p = { id: 1, attrs: ['Rua A', 'Não', -3.7] } as never;
    const q = { id: 2, attrs: ['Sim', -38.5] } as never;
    const pair = { distance: 4.567, met: [false], score: 0 };
    expect(fields.map((f) => f.value(p, q, pair))).toEqual([
      1, 2, 'Rua A', 'Não', -3.7, 'Sim', -38.5, 4.57, 0, 0, 'Divergência de medicao',
    ]);
    // Sem par: 0 no ID da outra camada e atributos dela vazios.
    expect(fields.map((f) => f.value(p, null, null) ?? null)).toEqual([
      1, 0, 'Rua A', 'Não', -3.7, null, null, null, null, null,
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
    const r = associate(a, b, { maxDistance: 25, criteria: [{ maxDistance: 25 }] });
    expect(r.matchA[0]).toBe(1);
    expect(r.metMask[0]).toBe(1);
  });

  it('prioridade só vale dentro da distância dela', () => {
    const a = [at(0, 0, ['nao'])];
    const b = [at(4, 0, ['sim']), at(-6, 0, ['nao'])];
    const r = associate(a, b, { maxDistance: 25, criteria: [{ maxDistance: 5 }] });
    expect(r.matchA[0]).toBe(0);
    expect(r.metMask[0]).toBe(0);
  });

  it('com várias prioridades, vence quem atende mais', () => {
    const a = [at(0, 0, ['nao', 'vs', '70'])];
    const b = [
      at(2, 0, ['nao', 'ld', '100']), // 1 critério, mais perto
      at(8, 0, ['nao', 'vs', '100']), // 2 critérios
      at(-12, 0, ['sim', 'vs', '70']), // 2 critérios, mais longe
    ];
    const crit = { maxDistance: 25 };
    const r = associate(a, b, { maxDistance: 25, criteria: [crit, crit, crit] });
    expect(r.matchA[0]).toBe(1);
    expect(r.metMask[0]).toBe(0b011);
  });

  it('peso: uma prioridade mais pesada vale mais que duas leves', () => {
    const a = [at(0, 0, ['nao', 'ld', '100'])];
    const b = [
      at(2, 0, ['sim', 'ld', '100']), // tipo e potência (peso 1 + 1 = 2)
      at(-8, 0, ['nao', 'vs', '70']), // só medição (peso 3)
    ];
    const opts = (w: number) => ({
      maxDistance: 25,
      criteria: [{ maxDistance: 25, weight: w }, { maxDistance: 25 }, { maxDistance: 25 }],
    });
    expect(associate(a, b, opts(1)).matchA[0]).toBe(0);
    expect(associate(a, b, opts(3)).matchA[0]).toBe(1);
    // Mesma pontuação: vence o mais próximo.
    expect(associate(a, b, opts(2)).matchA[0]).toBe(0);
  });

  it('prioridade com distância maior que a máxima permite associar mais longe', () => {
    const a = [at(0, 0, ['nao'])];
    const b = [at(0, 40, ['nao'])];
    expect(associate(a, b, { maxDistance: 25, criteria: [] }).matchA[0]).toBe(-1);
    expect(associate(a, b, { maxDistance: 25, criteria: [{ maxDistance: 50 }] }).matchA[0]).toBe(0);
  });

  it('classifica pontos únicos e agregados pela coordenada exata', () => {
    expect(aggregateKinds(['1|2', '1|2', '3|4', null])).toEqual([
      'agregado',
      'agregado',
      'unico',
      null,
    ]);
  });

  it('agregados: vários na mesma coordenada ficam com vários, único com único', () => {
    // Censo Atual: 788907 e 788908 juntos; 788909 sozinho e mais perto do grupo do Censo Anterior.
    const atual = [at(0), at(0), at(-10)];
    // Censo Anterior: 551525 e 551526 juntos; 445642 sozinho.
    const anterior = [at(-14), at(-14), at(-20, -10)];
    const withKinds = (pts: AssocPoint[]) => {
      const kinds = aggregateKinds(pts.map((p) => `${p.lat}|${p.lng}`));
      return pts.map((p, i) => ({ ...p, values: [kinds[i]] }));
    };

    const plain = associate(atual, anterior, { maxDistance: 25, criteria: [] });
    expect(plain.matchA[2]).toBe(0); // sem agregados, 788909 fica com 551525 (mais perto)

    const r = associate(withKinds(atual), withKinds(anterior), {
      maxDistance: 25,
      criteria: [{ maxDistance: 25 }],
    });
    expect(Array.from(r.matchA)).toEqual([0, 1, 2]);
    expect(Array.from(r.metMask)).toEqual([1, 1, 1]);
  });

  it('ignora pontos sem coordenadas', () => {
    const a = [{ lat: null, lng: null, values: [] }, at(0)];
    const b = [at(1), { lat: null, lng: null, values: [] }];
    const r = associate(a, b, { maxDistance: 25, criteria: [] });
    expect(Array.from(r.matchA)).toEqual([-1, 0]);
  });
});
