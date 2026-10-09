import clsx from 'clsx';
import { X } from 'lucide-react';
import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/** Ordem de empilhamento das janelas flutuantes (a mais recente/clicada por cima). */
let topZ = 0;

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max));

/** Direção do arraste: '' move a janela; n/s/e/w (e combinações) redimensionam pela borda/canto. */
type Dir = '' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLES: { dir: Exclude<Dir, ''>; className: string }[] = [
  { dir: 'n', className: '-top-1 left-3 right-3 h-2 cursor-ns-resize' },
  { dir: 's', className: '-bottom-1 left-3 right-3 h-2 cursor-ns-resize' },
  { dir: 'w', className: '-left-1 top-3 bottom-3 w-2 cursor-ew-resize' },
  { dir: 'e', className: '-right-1 top-3 bottom-3 w-2 cursor-ew-resize' },
  { dir: 'nw', className: '-top-1 -left-1 size-3.5 cursor-nwse-resize' },
  { dir: 'ne', className: '-top-1 -right-1 size-3.5 cursor-nesw-resize' },
  { dir: 'sw', className: '-bottom-1 -left-1 size-3.5 cursor-nesw-resize' },
  { dir: 'se', className: '-bottom-1 -right-1 size-3.5 cursor-nwse-resize' },
];

/**
 * Janela flutuante sobre o mapa: arraste pelo cabeçalho para qualquer canto (fica dentro da área do
 * mapa); com `resizable`, bordas e cantos redimensionam. Duplo clique no cabeçalho volta ao
 * tamanho e posição iniciais.
 */
export function FloatingPanel({
  title,
  icon,
  actions,
  onClose,
  defaultClassName,
  defaultStyle,
  className,
  footer,
  resizable,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** Botões extras no cabeçalho */
  actions?: ReactNode;
  onClose: () => void;
  /** Posição inicial (classes absolute), usada até o primeiro arraste */
  defaultClassName: string;
  /** Ajuste da posição inicial (ex.: deslocar janelas repetidas) */
  defaultStyle?: CSSProperties;
  /** Largura etc. */
  className?: string;
  /** Rodapé fixo (não rola com o conteúdo) */
  footer?: ReactNode;
  /** Permite redimensionar pelas bordas, com tamanho mínimo (px) */
  resizable?: { minWidth: number; minHeight: number };
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Várias janelas abertas: a última clicada fica por cima.
  const [z, setZ] = useState(() => ++topZ);
  const raise = () => {
    if (z !== topZ) setZ(++topZ);
  };

  const track = (dir: Dir) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (!dir && (e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    const s = { x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height };
    const minW = Math.min(resizable?.minWidth ?? 0, pr.width);
    const minH = Math.min(resizable?.minHeight ?? 0, pr.height);
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!dir) {
        // Mantém o cabeçalho sempre visível.
        setPos({ x: clamp(s.x + dx, 0, pr.width - s.w), y: clamp(s.y + dy, 0, pr.height - 40) });
        return;
      }
      let { x, y, w, h } = s;
      if (dir.includes('e')) w = clamp(s.w + dx, minW, pr.width - s.x);
      if (dir.includes('w')) {
        w = clamp(s.w - dx, minW, s.x + s.w);
        x = s.x + s.w - w;
      }
      if (dir.includes('s')) h = clamp(s.h + dy, minH, pr.height - s.y);
      if (dir.includes('n')) {
        h = clamp(s.h - dy, minH, s.y + s.h);
        y = s.y + s.h - h;
      }
      setPos({ x, y });
      setSize({ w, h });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={ref}
      onPointerDownCapture={raise}
      style={{
        zIndex: 20 + (z % 1000),
        ...(!pos && defaultStyle),
        ...(pos && { left: pos.x, top: pos.y, marginRight: 0 }),
        ...(size && { width: size.w, height: size.h, maxWidth: 'none' }),
      }}
      className={clsx(
        'absolute flex flex-col rounded-lg border border-slate-200 bg-white shadow-xl',
        !size && 'max-h-[calc(100%-1.5rem)]',
        className,
        !pos && defaultClassName,
      )}
    >
      <div
        onPointerDown={track('')}
        onDoubleClick={() => {
          setPos(null);
          setSize(null);
        }}
        className="flex shrink-0 cursor-move touch-none items-center gap-2 border-b border-slate-200 px-3 py-1.5 select-none"
        title="Arraste para mover · duplo clique volta à posição inicial"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
          {title}
        </span>
        {actions}
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-slate-200 px-3 py-2">{footer}</div>}
      {resizable && (
        <>
          {HANDLES.map((hd) => (
            <div
              key={hd.dir}
              onPointerDown={track(hd.dir)}
              className={clsx(
                'absolute z-10 touch-none rounded-full hover:bg-accent-400/50',
                hd.className,
              )}
              aria-hidden
            />
          ))}
          {/* Alça visível no canto inferior direito. */}
          <svg
            className="pointer-events-none absolute right-0.5 bottom-0.5 size-2.5 text-slate-400"
            viewBox="0 0 10 10"
            aria-hidden
          >
            <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </>
      )}
    </div>
  );
}
