import { describe, expect, it } from 'vitest';
import { compileColumns } from '@/lib/comparisonColumns';
import frontendSrc from '@/lib/comparisonColumns.ts?raw';
import backendSrc from '../../../backend/src/modules/comparison/comparison.columns.ts?raw';

const body = (src: string) => src.replace(/\r\n/g, '\n').split('\n').slice(1);

describe('colunas do Quadro Comparativo', () => {
  it('a cópia do frontend é igual à do backend (só muda o comentário da 1ª linha)', () => {
    expect(body(frontendSrc)).toEqual(body(backendSrc));
  });

  it('valida antes de enviar: referência a coluna que não existe', () => {
    expect(() =>
      compileColumns(
        [{ kind: 'formula', title: 'Consumo', expression: '[Qtd] * potencia' }],
        ['Anterior', 'Atual'],
        { layerColumns: ['potencia'], lookupColumns: null },
      ),
    ).toThrow('referência desconhecida: Qtd');
  });
});
