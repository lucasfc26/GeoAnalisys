import type { ColumnMeta } from '../../common/sql';
import { coerceFor } from './copy.logic';

const col = (kind: ColumnMeta['kind']) => ({ name: 'c', kind }) as ColumnMeta;

describe('cópia para outra camada · conversão de valores', () => {
  it('números (vírgula decimal) e inteiros', () => {
    expect(coerceFor(col('number'), '12,5')).toEqual({ value: 12.5, invalid: false });
    expect(coerceFor(col('integer'), '150')).toEqual({ value: '150', invalid: false });
    expect(coerceFor(col('integer'), 150)).toEqual({ value: '150', invalid: false });
    expect(coerceFor(col('integer'), '12345678901234567890').value).toBe('12345678901234567890');
    expect(coerceFor(col('integer'), '1,5')).toEqual({ value: null, invalid: true });
    expect(coerceFor(col('number'), 'abc')).toEqual({ value: null, invalid: true });
  });

  it('texto recebe qualquer valor; vazio é null', () => {
    expect(coerceFor(col('text'), 123)).toEqual({ value: '123', invalid: false });
    expect(coerceFor(col('text'), '')).toEqual({ value: null, invalid: false });
    expect(coerceFor(col('text'), { a: 1 })).toEqual({ value: '{"a":1}', invalid: false });
  });

  it('booleano e datas (inclusive dd/mm/aaaa)', () => {
    expect(coerceFor(col('boolean'), 'Sim')).toEqual({ value: true, invalid: false });
    expect(coerceFor(col('boolean'), 'não')).toEqual({ value: false, invalid: false });
    expect(coerceFor(col('boolean'), 'talvez').invalid).toBe(true);
    expect(coerceFor(col('date'), '05/03/2024')).toEqual({ value: '2024-03-05', invalid: false });
    expect(coerceFor(col('date'), '2024-03-05')).toEqual({ value: '2024-03-05', invalid: false });
    expect(coerceFor(col('date'), 'ontem').invalid).toBe(true);
  });
});
