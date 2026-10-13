import {
  ComparisonColumn,
  FormulaError,
  compileColumns,
  evalFormula,
  parseFormula,
} from './comparison.columns';

const calc = (src: string, vars: Record<string, number | null> = {}) =>
  evalFormula(parseFormula(src), (n) => vars[n] ?? null);

describe('fórmulas', () => {
  it('respeita a precedência, parênteses e vírgula decimal', () => {
    expect(calc('1 + 2 * 3')).toBe(7);
    expect(calc('(1 + 2) * 3')).toBe(9);
    expect(calc('2 ^ 3 * 2')).toBe(16);
    expect(calc('-2 + 11,5')).toBe(9.5);
    expect(calc('10 / 4')).toBe(2.5);
  });

  it('referências entre colchetes ou por nome simples', () => {
    expect(calc('[Qtd Atual] - qtd', { 'Qtd Atual': 5, qtd: 2 })).toBe(3);
  });

  it('vazio em um operando e divisão por zero dão vazio', () => {
    expect(calc('a * 2')).toBeNull();
    expect(calc('1 / 0')).toBeNull();
    expect(calc('sevazio(a; 0) + 1')).toBe(1);
  });

  it('funções', () => {
    expect(calc('arred(2,3456; 2)')).toBe(2.35);
    expect(calc('max(1; 5; 3) - min(4; 2)')).toBe(3);
    expect(calc('abs(-3)')).toBe(3);
  });

  it('erros de sintaxe com mensagem útil', () => {
    expect(() => parseFormula('(1 + 2')).toThrow(FormulaError);
    expect(() => parseFormula('1 + 2)')).toThrow('")" sem "("');
    expect(() => parseFormula('max(1, 2)')).toThrow('";"');
    expect(() => parseFormula('max(a, b)')).toThrow('";"');
    expect(() => parseFormula('foo(1)')).toThrow('Função desconhecida');
    expect(() => parseFormula('')).toThrow('vazia');
  });
});

const consumo = (q: string) =>
  `([${q}] * [potencia] + [${q}] * [Perdas]) * 11,483333333 * 30 / 1000`;

/** Exemplo do censo: consumo anterior × atual com perdas da mlampadas. */
const CENSO: ComparisonColumn[] = [
  { kind: 'label', title: null },
  { kind: 'group', title: null, column: 'potencia' },
  { kind: 'formula', title: 'Perdas', expression: 'perda * potencia' },
  { kind: 'count', title: 'Quantidade Censo Anterior', layer: 0, sum: true },
  { kind: 'formula', title: 'Consumo Anterior', expression: consumo('Quantidade Censo Anterior') },
  { kind: 'count', title: 'Quantidade Censo Atual', layer: 1, sum: true },
  { kind: 'formula', title: 'Consumo Atual', expression: consumo('Quantidade Censo Atual') },
  {
    kind: 'formula',
    title: 'Diferença de Lâmpadas',
    expression: '[Quantidade Censo Atual] - [Quantidade Censo Anterior]',
  },
  { kind: 'formula', title: 'Consumo Total', expression: '[Consumo Atual] - [Consumo Anterior]' },
];

const available = {
  layerColumns: ['tipo_lampada', 'potencia', 'medicao'],
  lookupColumns: ['tipo', 'potencia', 'nome', 'perda'],
};

describe('colunas do quadro', () => {
  it('calcula o exemplo do censo e lê a coluna perda da tabela de apoio', () => {
    const c = compileColumns(CENSO, ['Anterior', 'Atual'], available);
    expect(c.lookupColumns).toEqual(['perda']);
    const cells = c.evaluate({
      label: 'Vapor de Sódio 150W',
      group: new Map([
        ['tipo_lampada', 'VS'],
        ['potencia', '150'],
      ]),
      counts: [10, 12],
      diff: 2,
      lookup: { perda: '0,1' },
    });
    const k = (11.483333333 * 30) / 1000;
    expect(cells.slice(0, 4)).toEqual(['Vapor de Sódio 150W', '150', 15, 10]);
    expect(cells[4]).toBeCloseTo((10 * 150 + 10 * 15) * k, 6);
    expect(cells[6]).toBeCloseTo((12 * 150 + 12 * 15) * k, 6);
    expect(cells[7]).toBe(2);
    expect(cells[8]).toBeCloseTo(2 * 165 * k, 6);
  });

  it('bloco sem agrupamento nem tabela de apoio: fórmulas que dependem deles ficam vazias', () => {
    const c = compileColumns(CENSO, ['Anterior', 'Atual'], available);
    const cells = c.evaluate({
      label: 'Relé (Sim)',
      group: new Map(),
      counts: [3, 4],
      diff: 1,
      lookup: null,
    });
    expect(cells).toEqual(['Relé (Sim)', null, null, 3, null, 4, null, 1, null]);
  });

  it('título padrão, títulos repetidos, referência circular e desconhecida', () => {
    const c = compileColumns(
      [
        { kind: 'count', title: null, layer: 1 },
        { kind: 'diff', title: '' },
      ],
      ['A', 'B'],
      available,
    );
    expect(c.titles).toEqual(['B', 'Diferença']);
    expect(() =>
      compileColumns(
        [
          { kind: 'diff', title: 'X' },
          { kind: 'count', title: 'x', layer: 0 },
        ],
        ['A', 'B'],
        available,
      ),
    ).toThrow('Duas colunas');
    expect(() =>
      compileColumns(
        [
          { kind: 'formula', title: 'A', expression: '[B] + 1' },
          { kind: 'formula', title: 'B', expression: '[A] + 1' },
        ],
        ['A', 'B'],
        available,
      ),
    ).toThrow('circular');
    expect(() =>
      compileColumns(
        [{ kind: 'formula', title: 'A', expression: 'consumo * 2' }],
        ['A', 'B'],
        available,
      ),
    ).toThrow('referência desconhecida: consumo');
    expect(() =>
      compileColumns([{ kind: 'lookup', title: null, column: 'perda' }], ['A', 'B'], {
        ...available,
        lookupColumns: null,
      }),
    ).toThrow('desligada');
  });

  it('referências ignoram maiúsculas e acentos e usam colunas ocultas', () => {
    const c = compileColumns(
      [
        { kind: 'count', title: 'Qtd', layer: 0, hidden: true },
        { kind: 'formula', title: 'Dobro', expression: '[QTD] * 2' },
        { kind: 'formula', title: 'Potência total', expression: 'POTENCIA * dobro' },
      ],
      ['A', 'B'],
      available,
    );
    const cells = c.evaluate({
      label: '',
      group: new Map([['potencia', '60']]),
      counts: [5, 0],
      diff: -5,
      lookup: null,
    });
    expect(cells).toEqual([5, 10, 600]);
  });
});
