import clsx from 'clsx';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  addColumn,
  moveColumn,
  removeColumn,
  type AssociationColumn,
  type AssociationGroup,
} from '@/utils/associationColumns';
import type { ColumnItem } from '@/utils/exportColumns';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';

const iconButton =
  'rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30';

/**
 * Colunas do arquivo da associação: mostra só as escolhidas (ordenar com as setas ou arrastando,
 * remover com a lixeira) e inclui novas escolhendo a fonte e o atributo.
 */
export function AssociationColumnPicker({
  items,
  columns,
  nameA,
  nameB,
  onChange,
  onReset,
}: {
  items: ColumnItem[];
  columns: AssociationColumn[];
  nameA: string;
  nameB: string;
  onChange: (items: ColumnItem[]) => void;
  /** Volta às colunas padrão */
  onReset: () => void;
}) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const chosen = items.filter((i) => i.enabled && byKey.has(i.key));
  const chosenKeys = new Set(chosen.map((i) => i.key));

  const [group, setGroup] = useState<AssociationGroup>('A');
  const [picked, setPicked] = useState('');
  const available = columns.filter((c) => c.group === group && !chosenKeys.has(c.key));
  const pick = available.some((c) => c.key === picked) ? picked : (available[0]?.key ?? '');

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const move = (from: number, to: number) => onChange(moveColumn(items, from, to));
  const add = () => {
    if (!pick) return;
    onChange(addColumn(items, pick));
    const i = available.findIndex((c) => c.key === pick);
    setPicked(available[i + 1]?.key ?? available[i - 1]?.key ?? '');
  };

  return (
    <>
      <div className="grid items-center gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
        <Select
          aria-label="Fonte da coluna"
          value={group}
          onChange={(e) => setGroup(e.target.value as AssociationGroup)}
        >
          <option value="A">{nameA}</option>
          <option value="B">{nameB}</option>
          <option value="R">Resultados</option>
        </Select>
        <Select
          aria-label="Atributo"
          value={pick}
          onChange={(e) => setPicked(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          disabled={!available.length}
        >
          {!available.length && <option value="">Todas as colunas desta fonte já foram incluídas</option>}
          {available.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button icon={<Plus className="size-4" />} disabled={!pick} onClick={add}>
          Adicionar
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 text-xs text-slate-500">
        <span>
          {chosen.length} coluna{chosen.length === 1 ? '' : 's'} no arquivo
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            className="hover:text-accent-700"
            onClick={() => onChange(chosen.reduce((acc, i) => removeColumn(acc, i.key), items))}
          >
            Remover todas
          </button>
          <button type="button" className="hover:text-accent-700" onClick={onReset}>
            Colunas padrão
          </button>
        </span>
      </div>
      {chosen.length ? (
        <ul className="scroll-thin max-h-72 overflow-y-auto rounded-md border border-slate-200">
          {chosen.map((it, i) => {
            const c = byKey.get(it.key)!;
            return (
              <li
                key={it.key}
                draggable
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
                  'flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-sm last:border-b-0',
                  dragIndex === i ? 'bg-accent-50' : 'hover:bg-slate-50',
                )}
              >
                <GripVertical className="size-3.5 shrink-0 cursor-grab text-slate-300" />
                <span className="w-6 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800" title={c.label}>
                  {c.label}
                </span>
                <span className="hidden shrink-0 truncate text-xs text-slate-400 sm:inline">
                  {c.group === 'R' ? 'Resultados' : c.hint}
                </span>
                <button
                  type="button"
                  className={iconButton}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                  aria-label={`Subir ${c.label}`}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  disabled={i === chosen.length - 1}
                  onClick={() => move(i, i + 1)}
                  aria-label={`Descer ${c.label}`}
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => onChange(removeColumn(items, it.key))}
                  aria-label={`Remover ${c.label}`}
                  title="Remover"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
          Nenhuma coluna. Escolha a fonte e o atributo e clique em Adicionar.
        </p>
      )}
    </>
  );
}
