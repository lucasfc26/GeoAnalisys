import clsx from 'clsx';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { moveItem, type ColumnItem } from '@/utils/exportColumns';

/**
 * Lista de colunas para escolher quais vão para o arquivo e em que ordem (marcar, arrastar ou usar
 * as setas). `columns` dá o rótulo e a dica de cada chave.
 */
export function ColumnList({
  items,
  columns,
  onChange,
  onReset,
  status,
  noun = 'Exportar',
  renamable = false,
}: {
  items: ColumnItem[];
  columns: Map<string, { label: string; hint: string }>;
  onChange: (items: ColumnItem[]) => void;
  /** "Ordem original" */
  onReset: () => void;
  /** Mostrado depois do contador (ex.: "(alterado)") */
  status?: ReactNode;
  /** Verbo do rótulo acessível de cada caixa ("Exportar endereco") */
  noun?: string;
  /** Campo de nome alternativo (cabeçalho no arquivo) em cada coluna */
  renamable?: boolean;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [inField, setInField] = useState(false);
  const visible = items.filter((i) => columns.has(i.key));
  const enabled = visible.filter((i) => i.enabled).length;
  const setAll = (on: boolean) => onChange(items.map((i) => ({ ...i, enabled: on })));
  const toggle = (key: string) =>
    onChange(items.map((i) => (i.key === key ? { ...i, enabled: !i.enabled } : i)));
  const move = (from: number, to: number) => onChange(moveItem(items, from, to));
  const rename = (key: string, alias: string) =>
    onChange(items.map((i) => (i.key === key ? { ...i, alias } : i)));

  return (
    <>
      <div className="flex items-center justify-between gap-2 pt-1 text-xs text-slate-500">
        <span>
          {enabled} de {visible.length} colunas
          {status}
        </span>
        <span className="flex gap-2">
          <button type="button" className="hover:text-accent-700" onClick={() => setAll(true)}>
            Marcar todas
          </button>
          <button type="button" className="hover:text-accent-700" onClick={() => setAll(false)}>
            Desmarcar todas
          </button>
          <button type="button" className="hover:text-accent-700" onClick={onReset}>
            Ordem original
          </button>
        </span>
      </div>
      <ul className="scroll-thin max-h-72 overflow-y-auto rounded-md border border-slate-200">
        {items.map((it, i) => {
          const c = columns.get(it.key);
          if (!c) return null;
          return (
            <li
              key={it.key}
              draggable={!inField}
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== i) {
                  move(dragIndex, i);
                  setDragIndex(i);
                }
              }}
              onDragEnd={() => setDragIndex(null)}
              className={clsx(
                'group flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-sm last:border-b-0',
                dragIndex === i ? 'bg-accent-50' : 'hover:bg-slate-50',
              )}
            >
              <GripVertical className="size-3.5 shrink-0 cursor-grab text-slate-300" />
              <input
                type="checkbox"
                checked={it.enabled}
                onChange={() => toggle(it.key)}
                className="size-3.5 shrink-0 accent-accent-600"
                aria-label={`${noun} ${c.label}`}
              />
              <span
                className={clsx(
                  'min-w-0 flex-1 truncate',
                  it.enabled ? 'text-slate-800' : 'text-slate-400',
                )}
                title={c.label}
              >
                {c.label}
              </span>
              <span className="hidden shrink-0 truncate text-xs text-slate-400 sm:inline">
                {c.hint}
              </span>
              {renamable && (
                <input
                  type="text"
                  value={it.alias ?? ''}
                  onChange={(e) => rename(it.key, e.target.value)}
                  // Selecionar texto no campo não arrasta a linha
                  onPointerEnter={() => setInField(true)}
                  onPointerLeave={() => setInField(false)}
                  disabled={!it.enabled}
                  maxLength={100}
                  placeholder="nome no arquivo"
                  title={`Nome da coluna no arquivo (vazio = ${c.label})`}
                  aria-label={`Nome no arquivo para ${c.label}`}
                  className={clsx(
                    'h-6 w-32 shrink-0 rounded border px-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none disabled:opacity-40',
                    it.alias?.trim()
                      ? 'border-accent-400 bg-accent-50'
                      : 'border-slate-200 bg-white',
                  )}
                />
              )}
              <button
                type="button"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
                aria-label="Subir"
              >
                <ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                disabled={i === items.length - 1}
                onClick={() => move(i, i + 1)}
                aria-label="Descer"
              >
                <ArrowDown className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
