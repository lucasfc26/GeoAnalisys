import { act, fireEvent, render, screen } from '@testing-library/react';
import { EditableCell, listStepFocus, mergeGroups } from '@/components/map/ListModePanel';
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

describe('Modo lista · célula editável', () => {
  it('duplo clique edita e Enter salva o valor convertido', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditableCell col={col('potencia', 'integer')} v={100} onSave={onSave} />);
    fireEvent.doubleClick(screen.getByText('100'));
    const input = screen.getByDisplayValue('100');
    fireEvent.change(input, { target: { value: '150' } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(onSave).toHaveBeenCalledWith('150');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Esc cancela sem salvar', () => {
    const onSave = vi.fn();
    render(<EditableCell col={col('tipo_lampada', 'text')} v="LD" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Editar tipo_lampada'));
    const input = screen.getByDisplayValue('LD');
    fireEvent.change(input, { target: { value: 'LED' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('LD')).toBeTruthy();
  });

  it('valor inválido não é salvo e continua editando', async () => {
    const onSave = vi.fn();
    render(<EditableCell col={col('potencia', 'integer')} v={100} onSave={onSave} />);
    fireEvent.doubleClick(screen.getByText('100'));
    const input = screen.getByDisplayValue('100');
    fireEvent.change(input, { target: { value: 'abc' } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('abc')).toBeTruthy();
  });

  it('sem mudança, sair do campo não salva', async () => {
    const onSave = vi.fn();
    render(<EditableCell col={col('tipo_lampada', 'text')} v="LD" onSave={onSave} />);
    fireEvent.doubleClick(screen.getByText('LD'));
    await act(async () => fireEvent.blur(screen.getByDisplayValue('LD')));
    expect(onSave).not.toHaveBeenCalled();
  });
});

const pt = (key: string, lat: number, lng: number) => ({ key, lat, lng });

describe('Modo lista · zoom do passo', () => {
  it('com o enquadramento ligado e várias coordenadas, mostra a extensão de todas', () => {
    const focus = listStepFocus(
      [pt('a', -23.55, -46.63), pt('b', -23.56, -46.64)],
      10,
      true,
    );
    expect(focus).toMatchObject({
      bounds: { minLat: -23.56, maxLat: -23.55, minLng: -46.64, maxLng: -46.63 },
    });
  });

  it('com uma coordenada, mantém a escala do controle mesmo com o enquadramento ligado', () => {
    const focus = listStepFocus([pt('a', -23.55, -46.63)], 10, true);
    expect(focus).toHaveProperty('zoom');
    expect(focus).toHaveProperty('center');
    expect(focus).not.toHaveProperty('bounds');
  });

  it('sem o enquadramento, pontos próximos usam a escala fixa', () => {
    const focus = listStepFocus(
      [pt('a', -23.55, -46.63), pt('b', -23.55001, -46.63001)],
      10,
      false,
    );
    expect(focus).toHaveProperty('zoom');
  });

  it('sem o enquadramento, pontos distantes enquadram todos', () => {
    const focus = listStepFocus(
      [pt('a', -23.55, -46.63), pt('b', -23.7, -46.8)],
      10,
      false,
    );
    expect(focus).toHaveProperty('bounds');
  });
});

describe('Modo lista · selecionar todos', () => {
  it('junta os pontos de todos os valores por coordenada, sem IDs repetidos', () => {
    const g = (key: string, ids: string[]) => ({ key, x: 1, y: 2, lat: 0, lng: 0, ids });
    expect(
      mergeGroups([g('a', ['1', '2']), g('b', ['3']), g('a', ['2', '4']), g('b', ['3'])]),
    ).toEqual([g('a', ['1', '2', '4']), g('b', ['3'])]);
  });
});
