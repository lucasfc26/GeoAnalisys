import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AttributeDistancePanel } from '@/components/map/AttributeDistancePanel';
import { OutsideBoundaryPanel } from '@/components/map/OutsideBoundaryPanel';
import { pointsService } from '@/services/points';
import { sourcesService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import { useToolListsStore } from '@/stores/toolListsStore';
import type { ColumnMeta } from '@/types';

const col = (name: string, kind: ColumnMeta['kind']): ColumnMeta => ({
  name,
  formatType: kind,
  udtName: kind,
  kind,
  nullable: true,
  hasDefault: false,
  isPrimaryKey: false,
  isIdentity: false,
  isGenerated: false,
  isNumeric: kind === 'integer' || kind === 'number',
  readOnly: false,
  position: 1,
});

const pt = (id: string, i: number) => ({
  id,
  x: 500000 + i,
  y: 9600000 + i,
  lat: -3.6 - i / 1e4,
  lng: -38.9,
});

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const selectedIds = () =>
  Object.values(useAppStore.getState().selection)
    .flatMap((g) => g.ids)
    .sort();

beforeEach(() => {
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(sourcesService, 'schema').mockResolvedValue({
    source: { id: 's1' },
    crs: { code: 'EPSG:31984', name: 'UTM', datum: 'SIRGAS', kind: 'utm', proj4: '' },
    columns: [col('medidor', 'text'), col('situacao', 'text')],
  } as never);
  useAppStore.getState().setSource('s1');
});

describe('Fora do limite · lista', () => {
  it('seleciona o ponto clicado e oferece excluir', () => {
    useToolListsStore.setState({
      outsideOpen: true,
      outside: {
        request: {
          layer: { sourceId: 's1', filters: [] },
          boundaryName: 'L',
          polygons: [],
          tolerance: 0,
        },
        data: {
          summary: {
            name: 'Censo',
            boundaryName: 'Município',
            total: 10,
            withoutCoords: 0,
            inside: 8,
            withinTolerance: 0,
            outside: 2,
            truncated: false,
            durationMs: 1,
          },
          points: [
            { ...pt('7', 1), distance: 120 },
            { ...pt('9', 2), distance: 30 },
          ],
        },
      },
    });
    wrap(<OutsideBoundaryPanel />);
    fireEvent.click(screen.getByText('9'));
    expect(selectedIds()).toEqual(['9']);
    fireEvent.click(screen.getByText('Excluir 9'));
    expect(useAppStore.getState().dialogs.confirmDelete).toMatchObject({
      ids: ['9'],
      sourceId: 's1',
      observation: 'Removido: Fora do limite',
    });
  });
});

describe('Distância por atributo · lista por seções', () => {
  beforeEach(() => {
    useToolListsStore.setState({
      attrDistOpen: true,
      attrDist: {
        request: {
          layer: { sourceId: 's1', filters: [], column: 'medidor' },
          reference: null,
          maxDistance: 50,
          center: 'median',
          minPoints: 2,
          stripZeros: true,
          ignore: [],
        },
        data: {
          summary: {
            name: 'Censo',
            column: 'medidor',
            referenceName: null,
            referenceColumn: null,
            total: 10,
            evaluated: 5,
            far: 3,
            noMatch: 0,
            fewPoints: 0,
            withoutValue: 0,
            ignored: 0,
            withoutCoords: 0,
            durationMs: 1,
          },
          points: [
            { ...pt('1', 1), value: 'A1', distance: 300, target: null, sameValue: 3 },
            { ...pt('2', 2), value: '00A1', distance: 80, target: null, sameValue: 3 },
            { ...pt('3', 3), value: 'B7', distance: 60, target: null, sameValue: 2 },
          ],
          noMatch: [],
        },
      } as never,
    });
  });

  it('topo da seção seleciona todos; registro seleciona só ele', () => {
    wrap(<AttributeDistancePanel />);
    // "A1" e "00A1" ficam na mesma seção (ignorando zeros à esquerda)
    fireEvent.click(screen.getByText('medidor = A1'));
    expect(selectedIds()).toEqual(['1', '2']);
    fireEvent.click(screen.getByText('3'));
    expect(selectedIds()).toEqual(['3']);
  });

  it('seção aberta mostra os atributos e altera o valor nos marcados', async () => {
    vi.spyOn(pointsService, 'lookup').mockResolvedValue({ column: 'medidor', items: [] });
    vi.spyOn(pointsService, 'records').mockResolvedValue([
      { id: '3', data: { medidor: 'B7', situacao: 'ATIVO' } },
    ] as never);
    const bulk = vi.spyOn(pointsService, 'bulkUpdate').mockResolvedValue({ updated: 1 });
    wrap(<AttributeDistancePanel />);
    fireEvent.click(screen.getAllByTitle('Abrir a seção (atributos e alteração de valores)')[1]);
    expect(await screen.findByText('B7')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Marcar 3 para alterar'));
    fireEvent.change(screen.getByLabelText('Atributo a alterar'), {
      target: { value: 'situacao' },
    });
    fireEvent.change(screen.getByDisplayValue('ATIVO'), { target: { value: 'INATIVO' } });
    await act(async () => fireEvent.click(screen.getByText('Aplicar em 1')));
    expect(bulk).toHaveBeenCalledWith('s1', ['3'], { situacao: 'INATIVO' });
  });
});
