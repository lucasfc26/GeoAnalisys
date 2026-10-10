import clsx from 'clsx';
import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DropWhere } from '@/lib/layerTree';

/** Alça de arrastar (a linha inteira arrasta; a alça só mostra que dá). */
export function DragGrip() {
  return (
    <GripVertical
      aria-hidden
      className="-mx-0.5 size-3.5 shrink-0 text-slate-300 group-hover:text-slate-500"
    />
  );
}

/** Marca de onde o item arrastado vai cair (linha acima/abaixo, ou contorno = dentro). */
export function DropMark({ where }: { where: DropWhere | null }) {
  if (!where) return null;
  return (
    <span
      aria-hidden
      className={clsx(
        'pointer-events-none absolute inset-x-1 z-10',
        where === 'inside'
          ? 'inset-y-0 rounded ring-2 ring-accent-500'
          : 'h-0.5 rounded bg-accent-500',
        where === 'before' && '-top-px',
        where === 'after' && '-bottom-px',
      )}
    />
  );
}

/** Bolinha de cor que abre o seletor de cor nativo. */
export function ColorDot({
  color,
  onChange,
  title,
  inputId,
}: {
  color: string;
  onChange: (c: string) => void;
  title: string;
  /** id do campo de cor (o menu do botão direito abre o seletor por ele) */
  inputId?: string;
}) {
  return (
    <label
      className="relative size-3.5 shrink-0 cursor-pointer rounded-full border border-white shadow-[0_0_0_1px_rgba(15,23,42,0.25)]"
      style={{ background: color }}
      title={title}
    >
      <input
        id={inputId}
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  );
}

export function ActionButton({
  title,
  onClick,
  children,
  active,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={clsx(
        'rounded p-0.5 hover:bg-slate-200',
        active ? 'text-accent-700' : 'text-slate-500 hover:text-slate-800',
      )}
    >
      {children}
    </button>
  );
}
