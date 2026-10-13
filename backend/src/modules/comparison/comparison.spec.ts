import { compareRows, findLookup, indexLookup, mergeCounts, normKey } from './comparison.logic';

describe('normKey', () => {
  it('trata números iguais escritos de formas diferentes como o mesmo valor', () => {
    expect(normKey('150', false)).toBe(normKey('150.0', false));
    expect(normKey(' 150,00 ', false)).toBe('150');
    expect(normKey('70', false)).not.toBe(normKey('700', false));
  });

  it('ignora maiúsculas, acentos e espaços extras só quando pedido', () => {
    expect(normKey('Não', true)).toBe(normKey(' NAO ', true));
    expect(normKey('Vapor  de Sódio', true)).toBe(normKey('vapor de sodio', true));
    expect(normKey('Não', false)).not.toBe(normKey('nao', false));
  });

  it('vazio (null) é um valor próprio, diferente de texto vazio', () => {
    expect(normKey(null, true)).not.toBe(normKey('', true));
  });
});

describe('mergeCounts', () => {
  it('junta os grupos das camadas como um FULL OUTER JOIN, com 0 onde não existe', () => {
    const anterior = [
      { keys: ['VS', '150'], n: 10 },
      { keys: ['VM', '80'], n: 3 },
    ];
    const atual = [
      { keys: ['vs', '150.0'], n: 12 },
      { keys: ['LED', '60'], n: 5 },
    ];
    const merged = mergeCounts([anterior, atual], true);
    expect(merged).toHaveLength(3);
    expect(merged.find((m) => m.keys[0] === 'VS')).toEqual({
      keys: ['VS', '150'],
      counts: [10, 12],
    });
    expect(merged.find((m) => m.keys[0] === 'VM')!.counts).toEqual([3, 0]);
    expect(merged.find((m) => m.keys[0] === 'LED')!.counts).toEqual([0, 5]);
  });

  it('com diferença de maiúsculas, grupos com caixa diferente ficam separados', () => {
    const merged = mergeCounts([[{ keys: ['VS'], n: 1 }], [{ keys: ['vs'], n: 1 }]], false);
    expect(merged).toHaveLength(2);
  });

  it('junta grupos com valor vazio entre as camadas e aceita 3 ou mais camadas', () => {
    const merged = mergeCounts(
      [[{ keys: [null], n: 2 }], [{ keys: [null], n: 4 }], [{ keys: ['X'], n: 1 }]],
      true,
    );
    expect(merged).toEqual([
      { keys: [null], counts: [2, 4, 0] },
      { keys: ['X'], counts: [0, 0, 1] },
    ]);
  });
});

describe('tabela de apoio', () => {
  it('acha o nome e o fator pela chave normalizada (texto × inteiro)', () => {
    const index = indexLookup(
      [
        { keys: ['VS', '150'], name: 'Vapor de Sódio 150W', factor: 61.2 },
        { keys: ['VS', '150'], name: 'duplicada', factor: 0 },
        { keys: ['LED', '60'], name: 'LED 60W', factor: 21.6 },
      ],
      true,
    );
    expect(findLookup(index, ['vs', '150.0'], true)).toMatchObject({ name: 'Vapor de Sódio 150W' });
    expect(findLookup(index, ['LED', '70'], true)).toBeNull();
  });
});

describe('compareRows', () => {
  it('ordena pela descrição e depois pelos valores, números em ordem numérica e vazios no fim', () => {
    const rows = [
      { label: 'VS', keys: ['VS', '250'] },
      { label: 'VS', keys: ['VS', null] },
      { label: 'LED', keys: ['LED', '60'] },
      { label: 'VS', keys: ['VS', '70'] },
    ];
    rows.sort(compareRows);
    expect(rows.map((r) => r.keys[1])).toEqual(['60', '70', '250', null]);
  });
});
