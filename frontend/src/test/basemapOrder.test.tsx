import { fireEvent, render, screen } from '@testing-library/react';
import { BasemapPicker } from '@/components/map/BaseLayers';
import { moveBasemap, orderedBasemaps } from '@/lib/basemaps';
import { useAppStore } from '@/stores/appStore';

const google = { id: 'g1', name: 'Google Satelite', url: 'https://x/{z}/{x}/{y}.png', maxZoom: 20 };

describe('ordem dos mapas de fundo', () => {
  it('sem ordem salva: padrões e depois os adicionados por URL; ordem salva vem primeiro', () => {
    const def = orderedBasemaps([], [google]);
    expect(def[0].id).toBe('osm');
    expect(def.at(-1)).toEqual({ id: 'xyz:g1', label: 'Google Satelite', custom: true });
    const ids = orderedBasemaps(['xyz:g1', 'removido', 'none'], [google]).map((b) => b.id);
    expect(ids.slice(0, 2)).toEqual(['xyz:g1', 'none']);
    expect(ids).not.toContain('removido');
    expect(ids).toHaveLength(orderedBasemaps([], [google]).length);
  });

  it('move antes/depois do alvo', () => {
    expect(moveBasemap(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(moveBasemap(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(moveBasemap(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b']);
  });

  it('arrastar na lista muda a ordem; clicar escolhe o fundo', () => {
    useAppStore.setState({ customBasemaps: [google], basemapOrder: [], basemap: 'osm' });
    render(<BasemapPicker current="osm" label="OpenStreetMap" onAdd={() => {}} />);
    fireEvent.click(screen.getByLabelText('Mapa de fundo'));
    const row = (name: string) => screen.getByRole('option', { name: new RegExp(name) });
    const dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };

    fireEvent.dragStart(row('Google Satelite'), { dataTransfer });
    // No jsdom o evento não traz a posição do mouse: cai "depois" do alvo
    fireEvent.dragOver(row('OpenStreetMap'), { dataTransfer });
    fireEvent.drop(row('OpenStreetMap'), { dataTransfer });
    expect(useAppStore.getState().basemapOrder.slice(0, 2)).toEqual(['osm', 'xyz:g1']);

    fireEvent.click(row('Google Satelite'));
    expect(useAppStore.getState().basemap).toBe('xyz:g1');
  });

  it('botão direito: renomear (padrão e por URL), editar o link e Sobre', () => {
    useAppStore.setState({
      customBasemaps: [google],
      basemapOrder: [],
      basemapNames: {},
      basemap: 'osm',
    });
    render(<BasemapPicker current="osm" label="OpenStreetMap" onAdd={() => {}} />);
    fireEvent.click(screen.getByLabelText('Mapa de fundo'));
    const row = (name: string) => screen.getByRole('option', { name: new RegExp(name) });
    const pick = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }));
    const renameTo = (value: string) => {
      const input = screen.getByLabelText('Nome do mapa');
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
    };

    // Padrão: só o nome exibido muda
    fireEvent.contextMenu(row('OpenStreetMap'));
    pick('Renomear');
    renameTo('Ruas');
    expect(useAppStore.getState().basemapNames).toEqual({ osm: 'Ruas' });
    expect(row('Ruas')).toBeTruthy();

    // Por URL: renomeia o próprio mapa
    fireEvent.contextMenu(row('Google Satelite'));
    pick('Renomear');
    renameTo('Google Híbrido');
    expect(useAppStore.getState().customBasemaps[0].name).toBe('Google Híbrido');

    // Ver/editar link
    fireEvent.contextMenu(row('Google Híbrido'));
    pick('Ver/editar link…');
    const url = screen.getByLabelText('URL dos tiles');
    fireEvent.change(url, { target: { value: 'https://novo/{z}/{x}/{y}.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(useAppStore.getState().customBasemaps[0].url).toBe('https://novo/{z}/{x}/{y}.jpg');

    // Link de mapa padrão: só leitura
    fireEvent.contextMenu(row('Ruas'));
    pick('Ver link…');
    expect((screen.getByLabelText('URL dos tiles') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByDisplayValue('https://tile.openstreetmap.org/{z}/{x}/{y}.png')).toBeTruthy();
    // O X do cabeçalho também se chama Fechar: usa o botão do rodapé
    fireEvent.click(screen.getAllByRole('button', { name: 'Fechar' }).at(-1)!);

    // Sobre
    fireEvent.contextMenu(row('Ruas'));
    pick('Sobre');
    expect(screen.getByText('Sobre: Ruas')).toBeTruthy();
    expect(screen.getByText('Nome original').parentElement?.textContent).toContain('OpenStreetMap');
  });
});
