import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';

/** Janela com um campo controlado e onClose criado a cada render (como nas telas do sistema). */
function Harness({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('');
  return (
    <Dialog open title="Teste" onClose={() => onClose()}>
      <input aria-label="campo" value={value} onChange={(e) => setValue(e.target.value)} />
    </Dialog>
  );
}

describe('Dialog', () => {
  it('não tira o foco do campo enquanto o usuário digita', () => {
    render(<Harness onClose={() => {}} />);
    const input = screen.getByLabelText('campo') as HTMLInputElement;
    input.focus();
    for (const text of ['a', 'ab', 'abc', 'abc1']) {
      fireEvent.change(input, { target: { value: text } });
      expect(document.activeElement).toBe(input);
    }
    expect(input.value).toBe('abc1');
  });

  it('fecha com Esc usando o onClose mais recente', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
