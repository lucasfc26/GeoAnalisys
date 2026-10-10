import clsx from 'clsx';
import { ChevronsLeft, ChevronsRight, PanelRight, PictureInPicture2, X } from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useAppStore } from '@/stores/appStore';
import { SkeletonList } from '../ui/States';

// Painel carregado sob demanda (lazy loading).
const DataPanel = lazy(() => import('../points/DataPanel').then((m) => ({ default: m.DataPanel })));
const PanelTitle = lazy(() =>
  import('../points/DataPanel').then((m) => ({ default: m.PanelTitle })),
);

const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;
const maxWidth = () => Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.7));
const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max));

/** Direção do arraste: '' move a janela; n/s/e/w (e combinações) redimensionam pela borda/canto. */
type Dir = '' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const FLOAT_HANDLES: { dir: Exclude<Dir, ''>; className: string }[] = [
  { dir: 'n', className: '-top-1 left-3 right-3 h-2 cursor-ns-resize' },
  { dir: 's', className: '-bottom-1 left-3 right-3 h-2 cursor-ns-resize' },
  { dir: 'w', className: '-left-1 top-3 bottom-3 w-2 cursor-ew-resize' },
  { dir: 'e', className: '-right-1 top-3 bottom-3 w-2 cursor-ew-resize' },
  { dir: 'nw', className: '-top-1 -left-1 size-3.5 cursor-nwse-resize' },
  { dir: 'ne', className: '-top-1 -right-1 size-3.5 cursor-nesw-resize' },
  { dir: 'sw', className: '-bottom-1 -left-1 size-3.5 cursor-nesw-resize' },
  { dir: 'se', className: '-bottom-1 -right-1 size-3.5 cursor-nwse-resize' },
];

/** Telas grandes (lg): painel fixo/móvel; menores: drawer. */
function useDesktop() {
  const query = '(min-width: 1024px)';
  const [desktop, setDesktop] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

/** Arraste com o ponteiro (move/up registrados na janela até soltar). */
function drag(e: ReactPointerEvent, cursor: string, onMove: (dx: number, dy: number) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const sx = e.clientX;
  const sy = e.clientY;
  const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.style.cursor = '';
  };
  document.body.style.cursor = cursor;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/**
 * Desktop: coluna à direita (recolhível, largura e altura ajustáveis pelas bordas) ou janela móvel
 * sobre o mapa (arrasta pelo cabeçalho, redimensiona pelas bordas e cantos). O botão ao lado do »
 * alterna entre os dois modos. Com altura menor que a tela, o painel fixo fica sobre o mapa, que
 * passa a ocupar a largura toda. Telas menores: drawer sobre o mapa.
 */
export function RightPanel() {
  const open = useAppStore((s) => s.panelOpen);
  const setPanelOpen = useAppStore((s) => s.setPanelOpen);
  const collapsed = useAppStore((s) => s.panelCollapsed);
  const setCollapsed = useAppStore((s) => s.setPanelCollapsed);
  const width = useAppStore((s) => s.panelWidth);
  const setWidth = useAppStore((s) => s.setPanelWidth);
  const height = useAppStore((s) => s.panelHeight);
  const setHeight = useAppStore((s) => s.setPanelHeight);
  const floatingPref = useAppStore((s) => s.panelFloating);
  const setFloating = useAppStore((s) => s.setPanelFloating);
  const rect = useAppStore((s) => s.panelFloat);
  const setRect = useAppStore((s) => s.setPanelFloat);
  const selected = useAppStore((s) => Object.keys(s.selection).length);
  const desktop = useDesktop();
  const floating = desktop && floatingPref;
  const [, rerender] = useState(0);

  // Mantém a janela móvel dentro da tela quando o navegador muda de tamanho.
  useEffect(() => {
    const on = () => rerender((n) => n + 1);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const defaultRect = () => {
    const w = Math.min(width, maxWidth());
    const h = Math.round(window.innerHeight * 0.7);
    return { x: window.innerWidth - w - 24, y: 64, w, h };
  };
  const fit = (r: { x: number; y: number; w: number; h: number }) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = clamp(r.w, MIN_WIDTH, W);
    const h = clamp(r.h, MIN_HEIGHT, H);
    return { w, h, x: clamp(r.x, 0, W - w), y: clamp(r.y, 0, H - 40) };
  };
  const box = floating ? fit(rect ?? defaultRect()) : null;

  /** Janela móvel: '' move pelo cabeçalho; demais direções redimensionam. */
  const trackFloat = (dir: Dir) => (e: ReactPointerEvent) => {
    if (!box) return;
    if (!dir && (e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    const s = box;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cursor = dir ? getComputedStyle(e.currentTarget).cursor : 'move';
    drag(e, cursor, (dx, dy) => {
      if (!dir) {
        setRect({ ...s, x: clamp(s.x + dx, 0, W - s.w), y: clamp(s.y + dy, 0, H - 40) });
        return;
      }
      let { x, y, w, h } = s;
      if (dir.includes('e')) w = clamp(s.w + dx, MIN_WIDTH, W - s.x);
      if (dir.includes('w')) {
        w = clamp(s.w - dx, MIN_WIDTH, s.x + s.w);
        x = s.x + s.w - w;
      }
      if (dir.includes('s')) h = clamp(s.h + dy, MIN_HEIGHT, H - s.y);
      if (dir.includes('n')) {
        h = clamp(s.h - dy, MIN_HEIGHT, s.y + s.h);
        y = s.y + s.h - h;
      }
      setRect({ x, y, w, h });
    });
  };

  /** Painel fixo: borda esquerda = largura. */
  const resizeWidth = (e: ReactPointerEvent) => {
    const sw = width;
    drag(e, 'col-resize', (dx) => setWidth(clamp(sw - dx, MIN_WIDTH, maxWidth())));
  };
  /** Painel fixo: borda de baixo = altura (até a altura toda volta a ser coluna). */
  const resizeHeight = (e: ReactPointerEvent) => {
    const aside = (e.currentTarget as HTMLElement).parentElement;
    const area = aside?.parentElement?.getBoundingClientRect();
    if (!aside || !area) return;
    const sh = aside.getBoundingClientRect().height;
    drag(e, 'row-resize', (_, dy) => {
      const h = clamp(sh + dy, MIN_HEIGHT, area.height);
      setHeight(h >= area.height - 4 ? null : Math.round(h));
    });
  };

  const toggleFloating = () => {
    if (!floating && !rect) setRect(defaultRect());
    setFloating(!floating);
  };

  const dockedOverlay = desktop && !floating && !collapsed && height !== null;
  const style: CSSProperties = floating
    ? { left: box!.x, top: box!.y, width: box!.w, height: box!.h }
    : ({
        '--panel-w': `${Math.min(width, maxWidth())}px`,
        ...(dockedOverlay && { height }),
      } as CSSProperties);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
          onClick={() => setPanelOpen(false)}
          aria-hidden
        />
      )}
      <aside
        style={style}
        className={clsx(
          'flex flex-col bg-slate-50',
          floating
            ? 'fixed z-40 overflow-hidden rounded-lg border border-slate-300 shadow-2xl'
            : [
                'border-l border-slate-200',
                'lg:z-auto lg:shrink-0 lg:translate-x-0',
                dockedOverlay
                  ? 'lg:absolute lg:top-0 lg:right-0 lg:z-20 lg:rounded-bl-lg lg:border-b lg:shadow-xl'
                  : 'lg:relative',
                collapsed ? 'lg:w-9' : 'lg:w-[var(--panel-w)]',
                'fixed top-0 right-0 bottom-0 z-40 w-[min(26rem,92vw)] shadow-2xl lg:shadow-none',
                dockedOverlay && 'lg:bottom-auto lg:shadow-xl',
                open ? 'animate-slide-in max-lg:flex' : 'max-lg:hidden',
              ],
        )}
      >
        {/* Recolhido (desktop): faixa para reabrir. */}
        {collapsed && !floating && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="hidden h-full w-full flex-col items-center gap-2 py-3 text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:flex"
            title="Mostrar painel de informações"
            aria-label="Mostrar painel de informações"
          >
            <ChevronsLeft className="size-4" />
            <span className="text-xs font-medium [writing-mode:vertical-rl]">Informações</span>
            {selected > 0 && (
              <span className="rounded-full bg-accent-600 px-1.5 text-[10px] font-semibold text-white">
                {selected}
              </span>
            )}
          </button>
        )}

        <div
          className={clsx('flex min-h-0 flex-1 flex-col', collapsed && !floating && 'lg:hidden')}
        >
          <div
            onPointerDown={floating ? trackFloat('') : undefined}
            className={clsx(
              'flex h-11 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-4',
              floating && 'cursor-move touch-none select-none',
            )}
            title={floating ? 'Arraste para mover a janela' : undefined}
          >
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
              <Suspense fallback="Informações">
                <PanelTitle />
              </Suspense>
            </h2>
            <button
              className="hidden rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:inline-flex"
              onClick={toggleFloating}
              title={floating ? 'Voltar para a direita' : 'Destacar como janela móvel'}
              aria-label={floating ? 'Voltar para a direita' : 'Destacar como janela móvel'}
            >
              {floating ? (
                <PanelRight className="size-4" />
              ) : (
                <PictureInPicture2 className="size-4" />
              )}
            </button>
            {!floating && (
              <button
                className="hidden rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:inline-flex"
                onClick={() => setCollapsed(true)}
                title="Recolher painel"
                aria-label="Recolher painel"
              >
                <ChevronsRight className="size-4" />
              </button>
            )}
            <button
              className="rounded p-1 text-slate-400 hover:bg-slate-100 lg:hidden"
              onClick={() => setPanelOpen(false)}
              aria-label="Fechar painel"
            >
              <X className="size-4" />
            </button>
          </div>
          {/* Rola nas duas direções: estreito demais, o conteúdo mantém a largura mínima e rola de lado. */}
          <div className="scroll-thin flex-1 overflow-auto pb-16 lg:pb-0">
            <div className="min-w-80">
              <Suspense
                fallback={
                  <div className="p-4">
                    <SkeletonList />
                  </div>
                }
              >
                <DataPanel />
              </Suspense>
            </div>
          </div>
        </div>

        {floating ? (
          <>
            {FLOAT_HANDLES.map((hd) => (
              <div
                key={hd.dir}
                onPointerDown={trackFloat(hd.dir)}
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
        ) : (
          !collapsed && (
            <>
              {/* Borda esquerda: largura. */}
              <div
                onPointerDown={resizeWidth}
                onDoubleClick={() => setWidth(384)}
                className="absolute top-0 bottom-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none hover:bg-accent-400/40 lg:block"
                title="Arraste para ajustar a largura · duplo clique volta ao padrão"
                aria-hidden
              />
              {/* Borda de baixo: altura (duplo clique volta à altura toda). */}
              <div
                onPointerDown={resizeHeight}
                onDoubleClick={() => setHeight(null)}
                className="absolute right-0 -bottom-1 left-0 z-10 hidden h-2 cursor-row-resize touch-none hover:bg-accent-400/40 lg:block"
                title="Arraste para ajustar a altura · duplo clique volta à altura toda"
                aria-hidden
              />
            </>
          )
        )}
      </aside>
    </>
  );
}
