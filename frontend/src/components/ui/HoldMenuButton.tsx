import clsx from 'clsx';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ToolbarSideContext } from '@/lib/toolbar';
import { IconButton } from './Button';

type MenuPos = { left?: number; right?: number; top?: number; bottom?: number };

export interface HoldMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  /** Marcado com um ponto (opção atual) */
  checked?: boolean;
  disabled?: boolean;
  /** Linha separadora antes do item */
  divider?: boolean;
  onSelect: () => void;
}

/** Tempo segurando o botão para abrir o menu. */
const HOLD_MS = 350;

/**
 * Botão no estilo Photoshop: clique faz a ação padrão; segurar (ou botão direito / seta para baixo)
 * abre um menu com as opções. Um triângulo no canto indica que há mais opções.
 */
export function HoldMenuButton({
  label,
  shortcut,
  icon,
  active,
  disabled,
  items,
  onClick,
  menuOnClick,
}: {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  items: HoldMenuItem[];
  /** Ação do clique (sem `menuOnClick`) */
  onClick?: () => void;
  /** O clique também abre o menu (botão sem ação padrão) */
  menuOnClick?: boolean;
}) {
  const side = useContext(ToolbarSideContext) ?? 'left';
  const [menu, setMenu] = useState<MenuPos | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const held = useRef(false);

  const openMenu = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    // Posição fixa: a barra tem overflow e cortaria um menu absoluto.
    const { innerWidth: w, innerHeight: h } = window;
    if (side === 'top') setMenu({ left: r.left, top: r.bottom + 6 });
    else if (side === 'bottom') setMenu({ left: r.left, bottom: h - r.top + 6 });
    else {
      // Barra lateral: ao lado do botão; na metade de baixo da tela, alinhado por baixo.
      const x = side === 'left' ? { left: r.right + 6 } : { right: w - r.left + 6 };
      setMenu(r.top > h / 2 ? { ...x, bottom: h - r.bottom } : { ...x, top: r.top });
    }
  };
  const cancelHold = () => window.clearTimeout(timer.current);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !anchorRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span ref={anchorRef} className="relative inline-flex select-none [-webkit-touch-callout:none]">
      <IconButton
        label={menuOnClick ? label : `${label} · segure para mais opções`}
        shortcut={shortcut}
        active={active}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onPointerDown={(e) => {
          if (e.button !== 0 || disabled || menuOnClick) return;
          held.current = false;
          cancelHold();
          timer.current = window.setTimeout(() => {
            held.current = true;
            openMenu();
          }, HOLD_MS);
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onClick={() => {
          // Soltar depois de abrir o menu não dispara a ação padrão.
          if (held.current) {
            held.current = false;
            return;
          }
          if (menuOnClick) {
            if (menu) setMenu(null);
            else openMenu();
            return;
          }
          onClick?.();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          cancelHold();
          if (!disabled) openMenu();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        {icon}
        <svg
          className="pointer-events-none absolute right-0.5 bottom-0.5 size-1.5"
          viewBox="0 0 6 6"
          aria-hidden
        >
          <path d="M6 0V6H0Z" fill="currentColor" />
        </svg>
      </IconButton>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={menu}
            className="fixed z-50 min-w-56 rounded-md border border-slate-200 bg-white py-1 shadow-xl"
          >
            {items.map((it, i) => (
              <div key={it.key}>
                {it.divider && <div className="my-1 h-px bg-slate-200" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  autoFocus={it.checked || (i === 0 && !items.some((x) => x.checked))}
                  onClick={() => {
                    it.onSelect();
                    setMenu(null);
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-sm hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
                    it.checked ? 'font-medium text-slate-900' : 'text-slate-600',
                  )}
                >
                  <span
                    className={clsx(
                      'size-1.5 shrink-0 rounded-full',
                      it.checked ? 'bg-slate-800' : 'bg-transparent',
                    )}
                  />
                  <span className="[&>svg]:size-4.5">{it.icon}</span>
                  <span className="flex-1">{it.label}</span>
                  {it.shortcut && (
                    <kbd className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">
                      {it.shortcut}
                    </kbd>
                  )}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
