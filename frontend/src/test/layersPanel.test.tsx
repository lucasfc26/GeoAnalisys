import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LayersPanel } from '@/components/layers/LayersPanel';
import type { LayerRuntime } from '@/hooks/useLayers';
import { newLayer } from '@/lib/layers';
import { useAppStore } from '@/stores/appStore';
import type { DataSource } from '@/types';

const source = (id: string, name: string) =>
  ({ id, name, schema: 'public', tableName: name.toLowerCase() }) as DataSource;

const sources = [source('s1', 'Censo_Atual'), source('s2', 'Postes'), source('s3', 'Livre')];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['sources'], sources);
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    sourceId: 's1',
    layers: [newLayer('s1', 0), newLayer('s2', 1)],
    layerTree: [],
  });
  const runtimes = () =>
    useAppStore.getState().layers.map(
      (layer) =>
        ({
          layer,
          source: sources.find((s) => s.id === layer.sourceId),
          styleColumn: null,
          prepared: null,
          mode: 'full',
          total: 10,
          isFetching: false,
          filters: [],
        }) as unknown as LayerRuntime,
    );
  const ui = render(
    <QueryClientProvider client={qc}>
      <LayersPanel runtimes={runtimes()} />
    </QueryClientProvider>,
  );
  const rerender = () =>
    ui.rerender(
      <QueryClientProvider client={qc}>
        <LayersPanel runtimes={runtimes()} />
      </QueryClientProvider>,
    );
  return { rerender };
}

describe('Painel de camadas', () => {
  it('botão direito abre as opções da camada e renomeia só o nome exibido', () => {
    const { rerender } = setup();
    fireEvent.contextMenu(screen.getByText('Postes'));
    for (const label of [
      'Renomear',
      'Estilo (cor e tamanho)…',
      'Rótulos…',
      'Aproximar da camada',
      'Sobre',
    ])
      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Renomear' }));
    const input = screen.getByLabelText('Nome da camada');
    fireEvent.change(input, { target: { value: 'Postes 2024' } });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    rerender();
    expect(useAppStore.getState().layers.find((l) => l.sourceId === 's2')?.name).toBe(
      'Postes 2024',
    );
    expect(screen.getByText('Postes 2024')).toBeTruthy();
  });

  it('linhas sem botões extras; Editar fonte de dados abre a fonte da camada', () => {
    setup();
    expect(screen.queryByTitle('Aproximar da camada')).toBeNull();
    expect(screen.queryByTitle('Mover para cima')).toBeNull();
    fireEvent.contextMenu(screen.getByText('Postes'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar fonte de dados…' }));
    expect(useAppStore.getState().dialogs.source).toEqual({ edit: 's2' });
  });

  it('arrastar e soltar reordena camadas e limites', () => {
    const { rerender } = setup();
    useAppStore.setState({
      boundaries: ['Bairros', 'Quadras'].map((name) => ({
        id: name,
        name,
        color: '#f00',
        width: 3,
        visible: true,
        features: 1,
        bounds: null,
      })),
    });
    rerender();
    const dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };
    const drag = (from: HTMLElement, to: HTMLElement) => {
      fireEvent.dragStart(from, { dataTransfer });
      fireEvent.dragOver(to, { dataTransfer, clientY: 100 });
      fireEvent.drop(to, { dataTransfer });
    };
    // Linha da camada = elemento arrastável que contém o nome
    const row = (text: string) =>
      screen.getByText(text).closest('[draggable="true"]') as HTMLElement;

    drag(row('Censo_Atual'), row('Postes'));
    expect(useAppStore.getState().layers.map((l) => l.sourceId)).toEqual(['s2', 's1']);

    drag(row('Bairros'), row('Quadras'));
    expect(useAppStore.getState().boundaries.map((b) => b.id)).toEqual(['Quadras', 'Bairros']);

    // Limite: botão direito com editar, aproximar e sobre (sem botões na linha)
    expect(screen.queryByTitle('Remover limite')).toBeNull();
    fireEvent.contextMenu(row('Bairros'));
    for (const label of ['Editar nome', 'Aproximar do limite', 'Sobre'])
      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
  });

  it('Sobre abre a janela com a origem da camada', () => {
    setup();
    fireEvent.contextMenu(screen.getByText('Censo_Atual'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sobre' }));
    expect(useAppStore.getState().dialogs.layerAbout).toEqual({ kind: 'layer', id: 's1' });
  });

  it('+ Adicionar: Grupo cria uma pasta; Camada › Banco de dados abre a nova fonte', () => {
    const { rerender } = setup();
    fireEvent.click(screen.getByTitle('Adicionar grupo ou camada'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grupo' }));
    rerender();
    expect(useAppStore.getState().layerTree.some((n) => n.kind === 'group')).toBe(true);
    expect(screen.getByLabelText('Nome do grupo')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Adicionar grupo ou camada'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Camada' }));
    // Submenu ao lado: fontes ainda fora do mapa + opções de antes
    expect(screen.getByRole('menuitem', { name: 'Livre' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Banco de dados…' }));
    expect(useAppStore.getState().dialogs.source).toBe('new');
  });

  it('Mover para o grupo põe a camada dentro da pasta', () => {
    const { rerender } = setup();
    let gid = '';
    act(() => {
      gid = useAppStore.getState().addGroup('Iluminação');
    });
    rerender();
    fireEvent.contextMenu(screen.getByText('Censo_Atual'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mover para o grupo' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Iluminação' }));
    const g = useAppStore.getState().layerTree.find((n) => n.id === gid);
    expect(g?.kind === 'group' && g.children).toEqual(['s1']);
  });
});
