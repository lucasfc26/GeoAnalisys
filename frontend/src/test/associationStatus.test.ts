import { describe, expect, it } from 'vitest';
import {
  STATUS_NEW,
  STATUS_UNIDENTIFIED,
  defaultStatusRule,
  statusAttributeError,
  statusRows,
  statusRuleRequest,
} from '@/utils/associationStatus';

describe('regras de Status da associação', () => {
  it('agregados vêm sem gerar divergência; as demais prioridades geram', () => {
    expect(defaultStatusRule('agregados').consider).toBe(false);
    expect(defaultStatusRule('medicao')).toEqual({ consider: true, unique: false, attribute: '' });
  });

  it('envia o atributo com os nomes preenchidos', () => {
    const names = { 'A:medicao': { Sim: 'Medido', 'Não': ' Estimado ', '': '  ' }, 'B:x': { a: 'b' } };
    expect(
      statusRuleRequest({ consider: true, unique: true, attribute: 'A:medicao' }, names),
    ).toEqual({
      consider: true,
      unique: true,
      attribute: { side: 'A', column: 'medicao', labels: { Sim: 'Medido', 'Não': 'Estimado' } },
    });
    expect(statusRuleRequest({ consider: true, unique: false, attribute: '' }, names).attribute).toBeNull();
  });

  it('prioridade que não gera divergência não manda única nem atributo', () => {
    expect(
      statusRuleRequest({ consider: false, unique: true, attribute: 'A:medicao' }, {}),
    ).toEqual({ consider: false, unique: false, attribute: null });
  });

  it('Ponto Novo e Não Identificado vêm depois das prioridades, sem única', () => {
    const rows = statusRows(['medicao', 'agregados'], 'Censo', true);
    expect(rows.map((r) => r.title)).toEqual([
      'medicao',
      'agregados',
      'Ponto Novo coletado em Censo',
      'Não Identificado em Censo',
    ]);
    expect(rows.slice(2).map((r) => [r.key, r.unique, r.sides])).toEqual([
      [STATUS_NEW, false, ['A']],
      [STATUS_UNIDENTIFIED, false, ['B']],
    ]);
    expect(defaultStatusRule(STATUS_NEW).consider).toBe(true);
    expect(statusRows([], 'Censo', false)[1].note).toMatch(/Listar também/);
  });

  it('o atributo deve existir e ser da camada permitida', () => {
    const a = { id: 'a', name: 'Atual', columns: ['medicao'] };
    const b = { id: 'b', name: 'Anterior', columns: ['tipo'] };
    expect(statusAttributeError('', ['A'], a, b)).toBeNull();
    expect(statusAttributeError('A:medicao', ['A'], a, b)).toBeNull();
    expect(statusAttributeError('B:tipo', ['A'], a, b)).toMatch(/de Atual/);
    expect(statusAttributeError('B:sumiu', ['A', 'B'], a, b)).toMatch(/"sumiu" não existe em Anterior/);
  });
});
