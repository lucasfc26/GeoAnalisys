import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useWindowFrame, useWideScreen } from '@/hooks/useWindowFrame';

interface DialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

/** Janela mais à frente (maior z) entre as abertas. */
function topDialog(): Element | null {
  let top: Element | null = null;
  let best = -Infinity;
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    const z = Number((d.parentElement as HTMLElement | null)?.style.zIndex) || 0;
    if (z >= best) {
      best = z;
      top = d;
    }
  }
  return top;
}

/**
 * Janela do sistema: sem fundo que bloqueie a tela — arraste pelo cabeçalho, redimensione pelas
 * bordas, sobreponha o que quiser; a clicada fica por cima das demais (telas pequenas: folha na base).
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  const wide = useWideScreen();
  const frame = useWindowFrame({ minWidth: 320, minHeight: 200, enabled: wide });
  const ref = frame.ref;
  // onClose costuma ser uma função nova a cada render: guardada em ref para não refazer o efeito
  // (e roubar o foco do campo) a cada tecla digitada.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Com várias janelas abertas, o Esc fecha só a que está por cima.
      if (topDialog() === ref.current) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    // Foco na janela só ao abrir, e sem tirar de um campo que já esteja focado dentro dela.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, ref]);

  if (!open) return null;
  return (
    <div
      style={{ zIndex: frame.z }}
      {...frame.frameProps}
      className="pointer-events-none fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        style={frame.frameStyle}
        className={clsx(
          'pointer-events-auto relative flex max-h-[92vh] w-full flex-col rounded-t-xl border border-slate-200 bg-white shadow-2xl outline-none sm:rounded-xl',
          sizes[size],
        )}
      >
        <div
          onPointerDown={frame.dragProps.onPointerDown}
          onDoubleClick={frame.dragProps.onDoubleClick}
          title={frame.dragProps.title}
          className={clsx(
            'flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4',
            frame.dragProps.className,
          )}
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 sm:rounded-b-xl">
            {footer}
          </div>
        )}
        {frame.handles}
      </div>
    </div>
  );
}
