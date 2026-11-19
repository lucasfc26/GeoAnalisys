import { describe, expect, it } from 'vitest';
import { nameSimilarity, nameTokens, smartPair, typeFit } from '@/utils/attributeMatch';

describe('Pareamento Inteligente', () => {
  it('nomes: acentos, separadores, camelCase e sinônimos', () => {
    expect(nameTokens('Cód_Poste')).toEqual(['codigo', 'poste']);
    expect(nameTokens('numeroMedidor')).toEqual(['numero', 'medidor']);
    expect(nameSimilarity('OBS', 'observação')).toBe(1);
    expect(nameSimilarity('tipo_lampada', 'TipoLâmpada')).toBe(1);
    expect(nameSimilarity('medidor', 'medidor_nc')).toBeGreaterThan(0.6);
    expect(nameSimilarity('bairro', 'potencia')).toBeLessThan(0.3);
    expect(nameSimilarity('circuito_exclusivo', 'circuito exclusivo')).toBe(1);
    expect(nameSimilarity('rele_agrupado', 'relé agrupado')).toBe(1);
    expect(nameSimilarity('cod_cidade', 'Código Cidade')).toBe(1);
    expect(nameSimilarity('id_pm_placa', 'ID_PM_Placa')).toBe(1);
    expect(nameSimilarity('ID_PM_Placall', 'ID_PM_Placa')).toBeGreaterThan(0.9);
    expect(nameSimilarity('latitude', 'UTMX')).toBeGreaterThan(0.9);
    expect(nameSimilarity('longitude', 'UTM Y')).toBeGreaterThan(0.9);
    expect(nameSimilarity('latitude', 'UTMY')).toBeLessThan(0.3);
    expect(nameSimilarity('longitude', 'UTM_X')).toBeLessThan(0.3);
  });

  it('importação: espaço, prefixo e UTM no lugar de lat/long', () => {
    const src = [
      { name: 'circuito exclusivo', kind: 'text' as const },
      { name: 'relé agrupado', kind: 'text' as const },
      { name: 'cod_cidade', kind: 'text' as const },
      { name: 'ID_PM_Placa', kind: 'text' as const },
      { name: 'UTMX', kind: 'number' as const },
      { name: 'UTMY', kind: 'number' as const },
    ];
    const dst = [
      { name: 'circuito_exclusivo', kind: 'text' as const },
      { name: 'rele_agrupado', kind: 'text' as const },
      { name: 'Código Cidade', kind: 'integer' as const },
      { name: 'ID_PM_Placall', kind: 'text' as const },
      { name: 'latitude', kind: 'number' as const },
      { name: 'longitude', kind: 'number' as const },
    ];
    const pairs = Object.fromEntries(smartPair(src, dst).map((m) => [m.target, m.source]));
    expect(pairs.circuito_exclusivo).toBe('circuito exclusivo');
    expect(pairs.rele_agrupado).toBe('relé agrupado');
    expect(pairs['Código Cidade']).toBe('cod_cidade');
    expect(pairs.ID_PM_Placall).toBe('ID_PM_Placa');
    expect(pairs.latitude).toBe('UTMX');
    expect(pairs.longitude).toBe('UTMY');
  });

  it('tipos: texto numérico cabe em número; texto livre não', () => {
    const t = { name: 'a', kind: 'text' as const };
    const n = { name: 'b', kind: 'integer' as const };
    expect(typeFit(t, n, ['10', '20', '30'])).toBeGreaterThan(0.8);
    expect(typeFit(t, n, ['abc', 'def'])).toBeLessThan(0.5);
    expect(typeFit(n, t)).toBeGreaterThan(0.8);
  });

  it('pares um para um, melhores primeiro, e sem par quando nada parece', () => {
    const src = [
      { name: 'cod_poste', kind: 'text' as const },
      { name: 'potencia', kind: 'integer' as const },
      { name: 'obs', kind: 'text' as const },
      { name: 'qualquer_coisa', kind: 'text' as const },
    ];
    const dst = [
      { name: 'codigo_poste', kind: 'text' as const },
      { name: 'pot_w', kind: 'number' as const },
      { name: 'observacao', kind: 'text' as const },
      { name: 'bairro', kind: 'text' as const },
    ];
    const pairs = Object.fromEntries(smartPair(src, dst).map((m) => [m.source, m.target]));
    expect(pairs).toEqual({ cod_poste: 'codigo_poste', potencia: 'pot_w', obs: 'observacao' });
  });

  it('valores em comum pareiam nomes diferentes', () => {
    const src = [{ name: 'localidade', kind: 'text' as const }];
    const dst = [
      { name: 'nome_bairro', kind: 'text' as const },
      { name: 'rua', kind: 'text' as const },
    ];
    const s = ['Centro', 'Aldeota', 'Meireles', 'Benfica'].map((v) => ({ localidade: v }));
    const t = [
      { nome_bairro: 'centro', rua: 'Rua A' },
      { nome_bairro: 'Aldeota', rua: 'Rua B' },
      { nome_bairro: 'Meireles', rua: 'Rua C' },
      { nome_bairro: 'Fátima', rua: 'Rua D' },
    ];
    const [m] = smartPair(src, dst, s, t);
    expect(m.target).toBe('nome_bairro');
    expect(m.reason).toContain('valores em comum');
  });
});
