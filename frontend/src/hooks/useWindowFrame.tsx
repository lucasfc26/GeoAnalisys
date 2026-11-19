import clsx from 'clsx';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/**
 * Empilhamento comum de todas as janelas do sistema (diálogos, painéis flutuantes, camadas): a
 * última aberta ou clicada fica por cima. Menus, dicas e avisos usam valores acima disso.
 */
const BASE_Z = 100;
let topZ = BASE_Z;
export const nextWindowZ = () => ++topZ;
export const isTopWindowZ = (z: number) => z === topZ;

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

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/** Parte visível mínima (px) da janela que fica na tela ao arrastá-la para a borda. */
const KEEP = 80;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Janela livre sobre a tela inteira: arraste pelo cabeçalho (`dragProps`), redimensione pelas bordas
 * e cantos (`handles`, dentro do elemento da janela), clique para trazer para a frente (`frameProps`).
 * Enquanto não for movida, a janela fica onde o CSS a põe; ao mover/redimensionar passa a `fixed`.
 * Duplo clique no cabeçalho volta à posição e ao tamanho iniciais.
 */
export function useWindowFrame({
  minWidth = 280,
  minHeight = 140,
  enabled = true,
  resizable = true,
  initialZ,
}: {
  minWidth?: number;
  minHeight?: number;
  /** false (telas pequenas): sem mover/redimensionar */
  enabled?: boolean;
  /** false: só move (o tamanho continua o do conteúdo) */
  resizable?: boolean;
  /** z inicial (painéis fixos do mapa começam abaixo das janelas); omitido = por cima de todas */
  initialZ?: number;
} = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [z, setZ] = useState(() => initialZ ?? nextWindowZ());
  const zRef = useRef(z);
  zRef.current = z;

  const raise = useCallback(() => {
    if (!isTopWindowZ(zRef.current)) setZ(nextWindowZ());
  }, []);

  // Mantém a janela dentro da tela quando o programa muda de tamanho.
  useEffect(() => {
    if (!rect) return;
    const on = () =>
      setRect((r) =>
        r
          ? {
              ...r,
              x: clamp(r.x, KEEP - r.w, window.innerWidth - KEEP),
              y: clamp(r.y, 0, window.innerHeight - 40),
            }
          : r,
      );
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [rect]);

  const start = (dir: Dir) => (e: ReactPointerEvent) => {
    if (!enabled || e.button !== 0 || (dir && !resizable)) return;
    if (!dir && (e.target as HTMLElement).closest('button, input, select, textarea, a, [role="listbox"], [role="menu"]')) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    raise();
    const r = el.getBoundingClientRect();
    const s: Rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    const sx = e.clientX;
    const sy = e.clientY;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const minW = Math.min(minWidth, W);
    const minH = Math.min(minHeight, H);
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* sem captura: só dentro da janela */
    }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!dir) {
        setRect({
          ...s,
          x: clamp(s.x + dx, KEEP - s.w, W - KEEP),
          y: clamp(s.y + dy, 0, H - 40),
        });
        return;
      }
      let { x, y, w, h } = s;
      if (dir.includes('e')) w = clamp(s.w + dx, minW, W - s.x);
      if (dir.includes('w')) {
        w = clamp(s.w - dx, minW, s.x + s.w);
        x = s.x + s.w - w;
      }
      if (dir.includes('s')) h = clamp(s.h + dy, minH, H - s.y);
      if (dir.includes('n')) {
        h = clamp(s.h - dy, minH, s.y + s.h);
        y = s.y + s.h - h;
      }
      setRect({ x, y, w, h });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('panel-dragging');
    };
    // Iframes (preview do modo lista) não "roubam" o mouse durante o arraste.
    document.body.classList.add('panel-dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const frameStyle: CSSProperties | undefined = rect
    ? {
        position: 'fixed',
        left: rect.x,
        top: rect.y,
        ...(resizable && { width: rect.w, height: rect.h, maxWidth: 'none', maxHeight: 'none' }),
        margin: 0,
        transform: 'none',
        right: 'auto',
        bottom: 'auto',
      }
    : undefined;

  const handles: ReactNode = enabled && resizable ? (
    <>
      {HANDLES.map((hd) => (
        <div
          key={hd.dir}
          onPointerDown={start(hd.dir)}
          className={clsx(
            'absolute z-10 touch-none rounded-full hover:bg-accent-400/50',
            hd.className,
          )}
          aria-hidden
        />
      ))}
      <svg
        className="pointer-events-none absolute right-0.5 bottom-0.5 size-2.5 text-slate-400"
        viewBox="0 0 10 10"
        aria-hidden
      >
        <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </>
  ) : null;

  return {
    ref,
    z,
    /** Posição/tamanho depois de movida (undefined = onde o CSS a põe) */
    frameStyle,
    moved: !!rect,
    rect,
    /** No elemento da janela (ou do contêiner dela): clique traz para a frente */
    frameProps: { onPointerDownCapture: raise },
    /** No cabeçalho: arrasta a janela; duplo clique volta ao início */
    dragProps: enabled
      ? {
          onPointerDown: start(''),
          onDoubleClick: () => setRect(null),
          className: 'cursor-move touch-none select-none',
          title: 'Arraste para mover · duplo clique volta à posição inicial',
        }
      : { className: '', title: undefined },
    handles,
  };
}

/** Telas largas (sm+): as janelas podem ser movidas; nas pequenas ficam como folha na base. */
export function useWideScreen() {
  const query = '(min-width: 640px)';
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}
