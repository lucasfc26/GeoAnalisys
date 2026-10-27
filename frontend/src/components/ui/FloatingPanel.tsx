import clsx from 'clsx';
import { AppWindow, PanelTopClose, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { closePanelWindow, openPanelWindow } from '@/lib/detachedWindows';
import { toast } from './Toaster';

/** Ordem de empilhamento das janelas flutuantes (a mais recente/clicada por cima). */
let topZ = 0;

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max));

/** Faixa (px) junto à borda da janela principal em que soltar o painel o destaca. */
const EDGE = 6;

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
 * tamanho e posição iniciais. "Abrir em janela separada" leva o conteúdo para uma janela do
 * sistema (outro monitor, por exemplo); fechá-la devolve o painel ao mapa.
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
  /** Janela do sistema em que o painel está destacado (null = sobre o mapa) */
  const [popup, setPopup] = useState<{ win: Window; root: HTMLElement } | null>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  // Várias janelas abertas: a última clicada fica por cima.
  const [z, setZ] = useState(() => ++topZ);
  const raise = () => {
    if (z !== topZ) setZ(++topZ);
  };

  /** Arrastando o painel para fora da janela principal: soltar ali o destaca. */
  const [leaving, setLeaving] = useState(false);

  /** `at` = posição na tela (ex.: onde foi solto); ausente = onde o painel está. */
  const detach = (at?: { x: number; y: number }) => {
    const el = ref.current;
    if (!el) return;
    const opened = openPanelWindow(
      el.getBoundingClientRect(),
      titleRef.current?.textContent ?? 'GeoAnalisys',
      at,
    );
    if (opened) setPopup(opened);
    else
      toast.error(
        'Não foi possível abrir a janela separada. No programa desktop, atualize para a versão mais nova (ou reinicie-o); no navegador, permita pop-ups deste site.',
      );
  };

  // A janela destacada fecha junto com o painel; fechada pelo usuário, o painel volta ao mapa.
  useEffect(() => {
    if (!popup) return;
    const back = () => setPopup(null);
    popup.win.addEventListener('pagehide', back);
    return () => {
      popup.win.removeEventListener('pagehide', back);
      closePanelWindow(popup.win);
    };
  }, [popup]);

  // Título da janela do sistema acompanha o do painel.
  useEffect(() => {
    if (popup && titleRef.current) popup.win.document.title = titleRef.current.textContent ?? '';
  });

  const header = (detached: boolean) => (
    <>
      {icon}
      <span ref={titleRef} className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
        {title}
      </span>
      {actions}
      <button
        type="button"
        onClick={detached ? () => setPopup(null) : () => detach()}
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        title={detached ? 'Voltar para o mapa' : 'Abrir em janela separada (ex.: outro monitor)'}
        aria-label={detached ? 'Voltar para o mapa' : 'Abrir em janela separada'}
      >
        {detached ? <PanelTopClose className="size-4" /> : <AppWindow className="size-4" />}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Fechar"
      >
        <X className="size-4" />
      </button>
    </>
  );

  if (popup) {
    return createPortal(
      <div className="flex h-full flex-col bg-white">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-1.5 select-none">
          {header(true)}
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-200 px-3 py-2">{footer}</div>}
      </div>,
      popup.root,
    );
  }

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
    // Ponto do painel em que foi agarrado (para a janela separada abrir sob o mouse).
    const grab = { x: e.clientX - r.left, y: e.clientY - r.top };
    let outside = false;
    // Mantém os eventos do mouse mesmo fora da janela principal.
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* sem captura: só dentro da janela */
    }
    // A borda conta como fora: com a janela maximizada e um monitor só, o mouse não sai dela.
    const isOutside = (ev: PointerEvent) =>
      ev.clientX < EDGE ||
      ev.clientY < 0 ||
      ev.clientX >= window.innerWidth - EDGE ||
      ev.clientY >= window.innerHeight - EDGE;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!dir) {
        const out = isOutside(ev);
        if (out !== outside) {
          outside = out;
          setLeaving(out);
        }
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
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('panel-dragging');
      if (!dir && (outside || isOutside(ev))) {
        setLeaving(false);
        detach({ x: ev.screenX - grab.x, y: ev.screenY - grab.y });
      }
    };
    // Iframes (preview do modo lista) não "roubam" o mouse durante o arraste.
    document.body.classList.add('panel-dragging');
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
        className={clsx(
          'flex shrink-0 cursor-move touch-none items-center gap-2 border-b border-slate-200 px-3 py-1.5 select-none',
          leaving && 'bg-accent-50',
        )}
        title="Arraste para mover (solte fora do programa ou encostado na borda da tela para abrir em janela separada) · duplo clique volta à posição inicial"
      >
        {header(false)}
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
