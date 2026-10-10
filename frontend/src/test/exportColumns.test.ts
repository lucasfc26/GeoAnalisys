import { describe, expect, it } from 'vitest';
import { LAT_KEY, LNG_KEY } from '@/services/export';
import type { SourceSchema } from '@/types';
import {
  aliasesOf,
  defaultItems,
  duplicateHeader,
  enabledKeys,
  exportColumns,
  isDefaultOrder,
  itemsFromTemplate,
  moveItem,
  sameAliases,
} from '@/utils/exportColumns';

const schema = {
  source: { idColumn: 'ID', xColumn: 'latitude', yColumn: 'longitude' },
  crs: { kind: 'utm' },
  columns: ['ID', 'medicao', 'latitude', 'longitude', 'potencia'].map((name) => ({
    name,
    formatType: 'text',
  })),
} as unknown as SourceSchema;

const cols = exportColumns(schema);

describe('colunas da exportação', () => {
  it('segue a ordem e os cabeçalhos do backend', () => {
    expect(cols.map((c) => c.key)).toEqual([
      'ID',
      'latitude',
      'longitude',
      LAT_KEY,
      LNG_KEY,
      'medicao',
      'potencia',
    ]);
    expect(cols.map((c) => c.label).slice(1, 5)).toEqual(['UTMX', 'UTMY', 'Latitude', 'Longitude']);
  });

  it('modelo: colunas dele primeiro, demais desmarcadas; ignora colunas que sumiram da tabela', () => {
    const items = itemsFromTemplate(cols, ['potencia', 'removida', 'ID']);
    expect(enabledKeys(items)).toEqual(['potencia', 'ID']);
    expect(items).toHaveLength(cols.length);
    expect(items.slice(2).every((i) => !i.enabled)).toBe(true);
  });

  it('reconhece a ordem padrão e detecta alterações', () => {
    const items = defaultItems(cols);
    expect(isDefaultOrder(items, cols)).toBe(true);
    expect(isDefaultOrder(moveItem(items, 0, 1), cols)).toBe(false);
    expect(
      isDefaultOrder(
        items.map((i, n) => ({ ...i, enabled: n > 0 })),
        cols,
      ),
    ).toBe(false);
  });

  it('nomes alternativos: só das colunas marcadas, vindos do modelo e sem repetir cabeçalho', () => {
    const items = itemsFromTemplate(cols, ['ID', 'potencia'], { ID: 'idd' });
    expect(aliasesOf(items)).toEqual({ ID: 'idd' });
    const edited = items.map((i) =>
      i.key === 'medicao'
        ? { ...i, alias: 'med' }
        : i.key === 'potencia'
          ? { ...i, alias: '  ' }
          : i,
    );
    expect(aliasesOf(edited)).toEqual({ ID: 'idd' });
    expect(aliasesOf(defaultItems(cols))).toBeUndefined();
    expect(sameAliases({ ID: 'idd' }, { ID: 'idd' })).toBe(true);
    expect(sameAliases({ ID: 'idd' }, undefined)).toBe(false);

    const byKey = new Map(cols.map((c) => [c.key, c]));
    expect(duplicateHeader(items, byKey)).toBeNull();
    const dup = items.map((i) => (i.key === 'ID' ? { ...i, alias: 'POTENCIA' } : i));
    expect(duplicateHeader(dup, byKey)).toBe('POTENCIA');
  });

  it('move itens sem sair dos limites', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
