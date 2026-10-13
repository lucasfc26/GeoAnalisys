import {
  attributeColumns,
  concatObservation,
  importColumns,
  mergeUpdate,
  observationLabel,
  parseChangeList,
  removalObservation,
  xlsxValue,
} from './changes.logic';

const order = ['ID', 'tipo_lampada', 'potencia', 'medicao', 'latitude'];

describe('Tabela de Alterações', () => {
  it('primeira edição: só os atributos que mudaram, na ordem das colunas', () => {
    const r = mergeUpdate(
      undefined,
      { ID: 1, potencia: 70, tipo_lampada: 'ME', medicao: 'NÃO' },
      { ID: 1, potencia: 200, tipo_lampada: 'LD', medicao: 'NÃO' },
      order,
    );
    expect(r).toEqual({
      action: 'UPDATE',
      attributes: ['tipo_lampada', 'potencia'],
      oldValues: ['ME', 70],
      newValues: ['LD', 200],
    });
  });

  it('edições seguintes mantêm a primeira versão e o valor atual', () => {
    const first = mergeUpdate(undefined, { potencia: 70 }, { potencia: 100 }, order) as never;
    const second = mergeUpdate(
      first,
      { potencia: 100, latitude: 1.5 },
      { potencia: 200, latitude: 2.25 },
      order,
    );
    expect(second).toEqual({
      action: 'UPDATE',
      attributes: ['potencia', 'latitude'],
      oldValues: [70, 1.5],
      newValues: [200, 2.25],
    });
  });

  it('atributo que volta ao original sai; sem diferenças a linha some', () => {
    const first = mergeUpdate(
      undefined,
      { potencia: 70, medicao: 'NÃO' },
      { potencia: 100, medicao: 'SIM' },
      order,
    ) as never;
    const back = mergeUpdate(first, { potencia: 100 }, { potencia: 70 }, order);
    expect(back).toEqual({
      action: 'UPDATE',
      attributes: ['medicao'],
      oldValues: ['NÃO'],
      newValues: ['SIM'],
    });
    expect(mergeUpdate(back as never, { medicao: 'SIM' }, { medicao: 'NÃO' }, order)).toBeNull();
  });

  it('não mexe em pontos removidos', () => {
    const removed = { action: 'DELETE' as const, attributes: [], oldValues: [], newValues: [] };
    expect(mergeUpdate(removed, { potencia: 70 }, { potencia: 100 }, order)).toBe('keep');
  });

  it('ponto adicionado e alterado depois continua CREATE, com os atributos', () => {
    const created = { action: 'CREATE' as const, attributes: [], oldValues: [], newValues: [] };
    const edited = mergeUpdate(created, { potencia: 70 }, { potencia: 100 }, order);
    expect(edited).toEqual({
      action: 'CREATE',
      attributes: ['potencia'],
      oldValues: [70],
      newValues: [100],
    });
    expect(mergeUpdate(edited as never, { potencia: 100 }, { potencia: 70 }, order)).toEqual({
      action: 'CREATE',
      attributes: [],
      oldValues: [],
      newValues: [],
    });
  });

  it('observação e colunas do XLSX', () => {
    expect(observationLabel('CREATE', 'Ponto Novo')).toBe('Adicionado: Ponto Novo');
    expect(observationLabel('CREATE', 'Ponto Novo', ['potencia'])).toBe(
      'Adicionado: Ponto Novo e Alterado',
    );
    expect(observationLabel('DELETE', 'Duplicidade')).toBe('Removido: Duplicidade');
    expect(observationLabel('DELETE', 'Removido: Duplicidade')).toBe('Removido: Duplicidade');
    expect(observationLabel('UPDATE', null)).toBe('Ponto Alterado');
    expect(observationLabel('UPDATE', null, ['medicao', 'medidor_nc'])).toBe(
      'Ponto Alterado - medicao, medidor_nc',
    );
    expect(observationLabel('UPDATE', 'conferido', ['medicao'])).toBe(
      'Ponto Alterado - medicao: conferido',
    );
    expect(
      attributeColumns([
        { attributes: ['tipo_lampada', 'potencia'] },
        { attributes: ['potencia', 'latitude'] },
      ]),
    ).toEqual(['tipo_lampada', 'potencia', 'latitude']);
  });

  it('células numéricas no XLSX (códigos com zero à esquerda continuam texto)', () => {
    expect(xlsxValue('412343.32')).toBe(412343.32);
    expect(xlsxValue('9741270,2')).toBe(9741270.2);
    expect(xlsxValue(70)).toBe(70);
    expect(xlsxValue('0123')).toBe('0123');
    expect(xlsxValue('ME')).toBe('ME');
    expect(xlsxValue(null)).toBeNull();
  });

  it('observação acrescentada sem repetir', () => {
    expect(concatObservation(null, 'conferido')).toBe('conferido');
    expect(concatObservation('Duplicidade', 'conferido')).toBe('Duplicidade; conferido');
    expect(concatObservation('Duplicidade; conferido', 'conferido')).toBe('Duplicidade; conferido');
    expect(concatObservation('Duplicidade', '  ')).toBe('Duplicidade');
  });
});

describe('importação de alterações', () => {
  it('reconhece as colunas sem acento e sem diferenciar maiúsculas', () => {
    expect(
      importColumns(['TABELA', 'Id', 'Observação', 'Atributos  Alterados', 'Valores Novos']),
    ).toEqual({ table: 0, id: 1, observation: 2, attributes: 3, values: 4 });
    expect(importColumns(['Tabela', 'ID']).values).toBe(-1);
  });

  it('observação "Removido…" remove o ponto', () => {
    expect(removalObservation('Removido')).toBeNull();
    expect(removalObservation('removido')).toBeNull();
    expect(removalObservation('REMOVIDO:')).toBeNull();
    expect(removalObservation('Removido: Duplicidade')).toBe('Duplicidade');
    expect(removalObservation('removido:poste caído')).toBe('poste caído');
    expect(removalObservation('  Removido - fora da área ')).toBe('fora da área');
    expect(removalObservation('Removidos')).toBeUndefined();
    expect(removalObservation('Conferido; Removido')).toBeUndefined();
    expect(removalObservation('')).toBeUndefined();
    expect(removalObservation(null)).toBeUndefined();
  });

  it('listas no formato da tabela, com ";" ou JSON', () => {
    expect(parseChangeList('[situacao, numero]')).toEqual(['situacao', 'numero']);
    expect(parseChangeList('[, SN]')).toEqual([null, 'SN']);
    expect(parseChangeList('[Rua A, 10; Ativo]')).toEqual(['Rua A, 10', 'Ativo']);
    expect(parseChangeList('["a, b", 3]')).toEqual(['a, b', 3]);
    expect(parseChangeList('potencia')).toEqual(['potencia']);
    expect(parseChangeList(70)).toEqual([70]);
    expect(parseChangeList('[]')).toEqual([]);
    expect(parseChangeList(null)).toEqual([]);
  });
});
