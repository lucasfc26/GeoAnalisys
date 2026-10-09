import { describe, expect, it } from 'vitest';
import { lodFraction, metersPerCm } from '@/components/map/pointsOverlay';
import { parseList } from '@/utils/list';
import { changeObservation, fmtChangeList } from '@/utils/changes';

describe('Tabela de Alterações (formatação)', () => {
  it('listas com vírgula e decimal com ponto', () => {
    expect(fmtChangeList(['ME', 70])).toBe('[ME, 70]');
    expect(fmtChangeList([70, 412343.32])).toBe('[70, 412343.32]');
    expect(fmtChangeList([null, 'SN'])).toBe('[, SN]');
    expect(fmtChangeList([])).toBe('');
  });

  it('observação conforme a ação', () => {
    expect(changeObservation('CREATE', 'Ponto Novo')).toBe('Adicionado: Ponto Novo');
    expect(changeObservation('DELETE', 'Duplicidade')).toBe('Removido: Duplicidade');
    expect(changeObservation('UPDATE', null)).toBe('Ponto Alterado');
  });
});

describe('nível de detalhe', () => {
  it('converte zoom em metros por centímetro de tela', () => {
    // Zoom 16 perto de Fortaleza: 1 cm ≈ 90 m.
    expect(metersPerCm(2 ** 16, -3.7)).toBeGreaterThan(85);
    expect(metersPerCm(2 ** 16, -3.7)).toBeLessThan(95);
  });

  it('segue as faixas pedidas', () => {
    expect(lodFraction(2_000_000)).toBe(0.1);
    expect(lodFraction(1_000_000)).toBe(0.1);
    expect(lodFraction(500_000)).toBe(0.3);
    expect(lodFraction(100_000)).toBe(0.3);
    expect(lodFraction(50_000)).toBe(0.7);
    expect(lodFraction(10_000)).toBe(0.7);
    expect(lodFraction(7_500)).toBeCloseTo(0.85);
    expect(lodFraction(5_000)).toBe(1);
    expect(lodFraction(100)).toBe(1);
  });
});

describe('parseList', () => {
  it('aceita linhas, vírgulas, ponto e vírgula e espaços; remove vazios e repetidos', () => {
    expect(parseList('10\n20, 30;40  50\t60\r\n\n10')).toEqual([
      '10',
      '20',
      '30',
      '40',
      '50',
      '60',
    ]);
    expect(parseList('  ')).toEqual([]);
  });
});
