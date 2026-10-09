import clsx from 'clsx';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 flex items-baseline justify-between gap-2 text-xs font-medium text-slate-600">
      <span>{children}</span>
      {hint && <span className="font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

const control =
  'block w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(control, 'h-9', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(control, 'h-9 pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

/** Opção de rádio em formato de cartão (destaca a escolhida). */
export function RadioCard({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm',
        checked ? 'border-accent-500 bg-accent-50' : 'border-slate-200 hover:bg-slate-50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input type="radio" checked={checked} disabled={disabled} onChange={onChange} />
      {children}
    </label>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-red-600">{children}</p>;
}
