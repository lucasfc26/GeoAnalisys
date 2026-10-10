import clsx from 'clsx';
import { Check, ChevronRight } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type MenuEntry =
  | {
      label: string;
      icon?: ReactNode;
      onSelect?: () => void;
      /** Abre um menu ao lado */
      submenu?: MenuEntry[];
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      title?: string;
    }
  | 'separator';

const MARGIN = 6;

/**
 * Menu flutuante (botão direito, "+ Adicionar"): posição fixa na tela, submenus ao lado (abrem ao
 * passar o mouse ou clicar), fecha ao clicar fora, com Esc ou ao escolher um item.
 */
export function Menu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onBlur = () => onClose();
    // Na fase de captura: fecha antes de outro elemento tratar o clique.
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [onClose]);

  return createPortal(
    <div ref={rootRef} onContextMenu={(e) => e.preventDefault()}>
      <MenuList x={x} y={y} items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

function MenuList({
  x,
  y,
  items,
  onClose,
  /** Submenu: largura do item pai, para abrir do outro lado se não couber à direita */
  parentWidth = 0,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
  parentWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [open, setOpen] = useState<{ index: number; x: number; y: number; w: number } | null>(null);

  // Mantém o menu dentro da tela (vira para a esquerda / sobe quando não cabe).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + width > window.innerWidth - MARGIN) {
      left = parentWidth ? x - parentWidth - width : window.innerWidth - width - MARGIN;
    }
    if (top + height > window.innerHeight - MARGIN) top = window.innerHeight - height - MARGIN;
    setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top), ready: true });
  }, [x, y, parentWidth]);

  const openSub = (index: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOpen({ index, x: r.right, y: r.top - 4, w: r.width });
  };

  return (
    <>
      <div
        ref={ref}
        role="menu"
        className="scroll-thin fixed z-[60] max-h-[70vh] min-w-44 max-w-72 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-xs text-slate-700 shadow-xl"
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      >
        {items.map((it, i) =>
          it === 'separator' ? (
            <div key={i} className="my-1 border-t border-slate-100" />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              title={it.title}
              onMouseEnter={(e) => (it.submenu ? openSub(i, e.currentTarget) : setOpen(null))}
              onClick={(e) => {
                if (it.submenu) return openSub(i, e.currentTarget);
                it.onSelect?.();
                onClose();
              }}
              className={clsx(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-left disabled:opacity-40',
                open?.index === i ? 'bg-slate-100' : 'hover:bg-slate-100',
                it.danger ? 'text-red-600' : 'text-slate-700',
              )}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center text-slate-500">
                {it.checked ? <Check className="size-3.5 text-accent-600" /> : it.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.submenu && <ChevronRight className="size-3.5 shrink-0 text-slate-400" />}
            </button>
          ),
        )}
      </div>
      {open && items[open.index] !== 'separator' && (
        <MenuList
          key={open.index}
          x={open.x}
          y={open.y}
          parentWidth={open.w}
          items={(items[open.index] as { submenu?: MenuEntry[] }).submenu ?? []}
          onClose={onClose}
        />
      )}
    </>
  );
}
