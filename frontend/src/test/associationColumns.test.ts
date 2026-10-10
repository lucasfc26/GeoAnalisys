import { describe, expect, it } from 'vitest';
import type { SourceSchema } from '@/types';
import {
  addColumn,
  associationColumns,
  defaultAssociationItems,
  moveColumn,
  reconcileItems,
  removeColumn,
} from '@/utils/associationColumns';

const schema = (name: string, cols: string[]) =>
  ({
    source: { name, idColumn: 'ID' },
    columns: ['ID', ...cols, 'geom'].map((c) => ({ name: c, kind: c === 'geom' ? 'geometry' : 'text' })),
  }) as unknown as SourceSchema;

const A = schema('Censo Atual', ['endereco', 'medicao']);
const B = schema('Censo Anterior', ['medicao']);

describe('colunas da associação', () => {
  it('lista os campos da associação e os atributos das duas camadas (sem ID e geometria)', () => {
    const cols = associationColumns(A, B, ['medicao']);
    expect(cols.map((c) => c.label)).toEqual([
      'ID Censo Atual',
      'ID Censo Anterior',
      'Distância (m)',
      'Prioridades atendidas',
      'Pontuação',
      'Status',
      'Prioridade: medicao',
      'Latitude Censo Atual',
      'Longitude Censo Atual',
      'endereco Censo Atual',
      'medicao Censo Atual',
      'Latitude Censo Anterior',
      'Longitude Censo Anterior',
      'medicao Censo Anterior',
    ]);
    expect(defaultAssociationItems(cols).filter((i) => i.enabled).map((i) => i.key)).toEqual([
      '@idA',
      '@idB',
      '@distance',
      '@score',
      '@weight',
      '@status',
      '@crit:medicao',
    ]);
  });

  it('mantém a ordem escolhida, remove o que sumiu e acrescenta o que é novo', () => {
    const saved = [
      { key: 'A:medicao', enabled: true },
      { key: '@idA', enabled: true },
      { key: '@crit:removida', enabled: true },
    ];
    const items = reconcileItems(saved, associationColumns(A, B, ['medicao']));
    expect(items.slice(0, 3)).toEqual([
      { key: 'A:medicao', enabled: true },
      { key: '@idA', enabled: true },
      { key: '@idB', enabled: true },
    ]);
    expect(items.some((i) => i.key === '@crit:removida')).toBe(false);
    expect(items.find((i) => i.key === 'B:medicao')).toEqual({ key: 'B:medicao', enabled: false });
  });

  it('agrupa por fonte com o nome curto do atributo', () => {
    const cols = associationColumns(A, B, ['medicao']);
    const of = (g: string) => cols.filter((c) => c.group === g).map((c) => c.name);
    expect(of('A')).toEqual(['Latitude (calculada)', 'Longitude (calculada)', 'endereco', 'medicao']);
    expect(of('B')).toEqual(['Latitude (calculada)', 'Longitude (calculada)', 'medicao']);
    expect(of('R')).toContain('Status');
  });

  it('adiciona no fim das escolhidas, remove e reordena só entre elas', () => {
    const items = [
      { key: 'x', enabled: true },
      { key: 'y', enabled: true },
      { key: 'z', enabled: false },
      { key: 'w', enabled: false },
    ];
    const on = (list: typeof items) => list.filter((i) => i.enabled).map((i) => i.key);
    expect(on(addColumn(items, 'w'))).toEqual(['x', 'y', 'w']);
    expect(on(removeColumn(items, 'x'))).toEqual(['y']);
    expect(removeColumn(items, 'x').find((i) => i.key === 'x')).toEqual({ key: 'x', enabled: false });
    expect(on(moveColumn(items, 1, 0))).toEqual(['y', 'x']);
    expect(on(moveColumn(addColumn(items, 'z'), 2, 0))).toEqual(['z', 'x', 'y']);
  });
});
