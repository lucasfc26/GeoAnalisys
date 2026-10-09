import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { opsFor } from '@/components/forms/FilterDialog';
import { fromInputValue } from '@/components/forms/ValueInput';
import { groupInfo, prepareFull, styleLayer } from '@/components/map/pointsOverlay';
import { ErrorState } from '@/components/ui/States';
import { ApiError } from '@/lib/api';
import { effectiveFilters, newLayer } from '@/lib/layers';
import { selectedIdsOf, useAppStore } from '@/stores/appStore';
import type { ColumnMeta, LayerPayloadFull, SelectedGroup } from '@/types';
import { coordKey } from '@/utils/format';

const g = (x: number, y: number, ids: string[]): SelectedGroup => ({ key: coordKey(x, y), x, y, lat: 0, lng: 0, ids });

describe('seleção', () => {
  beforeEach(() => useAppStore.getState().clearSelection());

  it('seleciona um ponto e abre o único registro', () => {
    useAppStore.getState().setSelection([g(1, 2, ['10'])]);
    const s = useAppStore.getState();
    expect(Object.keys(s.selection)).toHaveLength(1);
    expect(s.activeRecordId).toBe('10');
  });

  it('não abre registro automaticamente quando há sobreposição', () => {
    useAppStore.getState().setSelection([g(1, 2, ['10', '11', '12'])]);
    expect(useAppStore.getState().activeRecordId).toBeNull();
    expect(useAppStore.getState().activeKey).toBe('1|2');
  });

  it('Ctrl+clique adiciona e remove da seleção', () => {
    const s = useAppStore.getState();
    s.toggleGroup(g(1, 2, ['10']));
    s.toggleGroup(g(3, 4, ['20', '21']));
    expect(selectedIdsOf(useAppStore.getState().selection)).toEqual(['10', '20', '21']);
    useAppStore.getState().toggleGroup(g(1, 2, ['10']));
    expect(selectedIdsOf(useAppStore.getState().selection)).toEqual(['20', '21']);
  });

  it('seleção por região soma quando mode=add', () => {
    useAppStore.getState().setSelection([g(1, 2, ['10'])]);
    useAppStore.getState().setSelection([g(5, 6, ['50'])], 'add');
    expect(Object.keys(useAppStore.getState().selection)).toEqual(['1|2', '5|6']);
  });

  it('remove IDs excluídos e descarta grupos vazios', () => {
    useAppStore.getState().setSelection([g(1, 2, ['10', '11']), g(3, 4, ['20'])]);
    useAppStore.getState().removeIds(['11', '20']);
    expect(useAppStore.getState().selection).toEqual({ '1|2': g(1, 2, ['10']) });
  });
});

describe('filtros e validação', () => {
  const col = (kind: ColumnMeta['kind'], nullable = true): ColumnMeta => ({
    name: 'c',
    formatType: kind,
    udtName: kind,
    kind,
    nullable,
    hasDefault: false,
    isPrimaryKey: false,
    isIdentity: false,
    isGenerated: false,
    isNumeric: kind === 'integer' || kind === 'number',
    readOnly: false,
    position: 1,
  });

  it('oferece operadores conforme o tipo da coluna', () => {
    expect(opsFor(col('text'))).toContain('contains');
    expect(opsFor(col('number'))).toContain('between');
    expect(opsFor(col('geometry'))).toEqual(['isNull', 'notNull']);
  });

  it('valida números e campos obrigatórios', () => {
    expect(fromInputValue(col('number'), '12,5')).toEqual({ value: '12.5' });
    expect(fromInputValue(col('integer'), '1.5').error).toBeTruthy();
    expect(fromInputValue(col('text', false), '').error).toBe('Obrigatório');
  });
});

describe('camadas', () => {
  const payload: LayerPayloadFull = {
    mode: 'full',
    version: 'v1',
    total: 4,
    ids: ['1', '2', '3', '4'],
    x: [10, 10, 20, 30],
    y: [5, 5, 6, 7],
    lat: [-5, -5, -5.1, -5.2],
    lng: [-38, -38, -38.1, -38.2],
    cats: ['Não', 'Sim'],
    cat: [0, 1, 0, 0],
    labels: ['A', 'B', 'C', 'D'],
  };

  it('agrupa registros sobrepostos e conta categorias', () => {
    const p = prepareFull(payload);
    expect(p.n).toBe(3);
    expect(p.catCounts).toEqual([3, 1]);
    expect(p.keyIndex.get(coordKey(10, 5))).toBe(0);
  });

  it('oculta categorias e devolve só os IDs visíveis', () => {
    const layer = { ...newLayer('s1', 0), styleColumn: 'medicao' };
    const p = prepareFull(payload);
    expect(groupInfo(p, styleLayer(p, layer), 0).ids).toEqual(['1', '2']);
    const hidden = { ...layer, categories: { Sim: { color: '#f00', size: 6, visible: false } } };
    const st = styleLayer(p, hidden);
    expect(st.vis[0]).toBe(1);
    expect(groupInfo(p, st, 0).ids).toEqual(['1']);
    expect(effectiveFilters([], hidden, 'medicao', p.cats)).toEqual([{ column: 'medicao', op: 'in', values: ['Não'] }]);
  });

  it('mantém filtros por camada ao trocar a camada ativa', () => {
    const s = useAppStore.getState();
    s.setSource('a');
    s.setFilters([{ column: 'c', op: 'eq', value: 1 }]);
    useAppStore.getState().setSource('b');
    expect(useAppStore.getState().filters).toEqual([]);
    expect(useAppStore.getState().layers.map((l) => l.sourceId)).toEqual(['b', 'a']);
    useAppStore.getState().setSource('a');
    expect(useAppStore.getState().filters).toHaveLength(1);
    useAppStore.getState().removeLayer('a');
    expect(useAppStore.getState().sourceId).toBe('b');
  });
});

describe('ErrorState', () => {
  it('mostra mensagem e botão de tentar novamente', () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiError('Banco fora', 503, 'DATABASE_UNAVAILABLE')} onRetry={retry} />);
    expect(screen.getByText('Banco de dados indisponível')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(retry).toHaveBeenCalled();
  });
});
