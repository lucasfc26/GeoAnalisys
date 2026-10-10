import { act, fireEvent, render, screen } from '@testing-library/react';
import { EditableCell } from '@/components/map/ListModePanel';
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
