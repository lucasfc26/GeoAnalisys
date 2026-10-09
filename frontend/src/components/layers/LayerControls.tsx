import clsx from 'clsx';
import type { ReactNode } from 'react';

/** Bolinha de cor que abre o seletor de cor nativo. */
export function ColorDot({
  color,
  onChange,
  title,
}: {
  color: string;
  onChange: (c: string) => void;
  title: string;
}) {
  return (
    <label
      className="relative size-3.5 shrink-0 cursor-pointer rounded-full border border-white shadow-[0_0_0_1px_rgba(15,23,42,0.25)]"
      style={{ background: color }}
      title={title}
    >
      <input
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
