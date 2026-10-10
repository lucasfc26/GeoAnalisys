import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-hover shadow-sm disabled:bg-accent-600/50',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
  danger: 'bg-red-600 text-white hover:bg-danger-hover shadow-sm disabled:bg-red-600/50',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  shortcut?: string;
  tone?: 'dark' | 'light';
}

type TipPos = { left: number; top: number; transform: string };

/** Posição da dica: à direita do botão; abaixo se faltar espaço; acima nas telas pequenas (barra inferior). */
function tipPosition(r: DOMRect): TipPos {
  if (window.innerWidth < 1024)
    return { left: r.left + r.width / 2, top: r.top - 8, transform: 'translate(-50%, -100%)' };
  if (r.right + 260 > window.innerWidth)
    return { left: r.left + r.width / 2, top: r.bottom + 8, transform: 'translateX(-50%)' };
  return { left: r.right + 8, top: r.top + r.height / 2, transform: 'translateY(-50%)' };
}

/** Botão de ferramenta com tooltip (posição fixa: não é cortado por barras com rolagem). */
export function IconButton({
  label,
  active,
  shortcut,
  tone = 'light',
  className,
  children,
  onMouseEnter,
  onMouseLeave,
  onPointerDown,
  ...rest
}: IconButtonProps) {
  const [tip, setTip] = useState<TipPos | null>(null);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseEnter={(e) => {
        setTip(tipPosition(e.currentTarget.getBoundingClientRect()));
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setTip(null);
        onMouseLeave?.(e);
      }}
      onPointerDown={(e) => {
        setTip(null);
        onPointerDown?.(e);
      }}
      className={clsx(
        'relative inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-accent-500 disabled:opacity-40',
        tone === 'light'
          ? active
            ? 'bg-accent-600 text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          : active
            ? 'bg-accent-600 text-white'
            : 'text-slate-300 hover:bg-white/10 hover:text-white',
        className,
      )}
      {...rest}
    >
      {children}
      {tip && !rest.disabled && (
        <span
          style={tip}
          className="pointer-events-none tone-fixed fixed z-50 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs font-normal text-white shadow-lg"
        >
          {label}
          {shortcut && (
            <kbd className="ml-1.5 rounded bg-white/15 px-1 text-[10px]">{shortcut}</kbd>
          )}
        </span>
      )}
    </button>
  );
}
