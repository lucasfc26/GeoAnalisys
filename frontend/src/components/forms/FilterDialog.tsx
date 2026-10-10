import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useActiveSource, useSourceSchema } from '@/hooks/useSourceData';
import { useDebounce } from '@/hooks/useDebounce';
import { sourcesService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import type { ColumnMeta, FilterDef, FilterOp } from '@/types';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Select } from '../ui/Field';
import { FilterReplaceSection } from './FilterReplaceSection';

const OP_LABEL: Record<FilterOp, string> = {
  eq: 'igual a',
  neq: 'diferente de',
  contains: 'contém',
  notContains: 'não contém',
  startsWith: 'começa com',
  in: 'é um de',
  gt: 'maior que',
  gte: 'maior ou igual',
  lt: 'menor que',
  lte: 'menor ou igual',
  between: 'entre',
  isNull: 'está vazio',
  notNull: 'está preenchido',
};

export function opsFor(col: ColumnMeta | undefined): FilterOp[] {
  if (!col) return ['eq'];
  switch (col.kind) {
    case 'geometry':
      return ['isNull', 'notNull'];
    case 'boolean':
      return ['eq', 'isNull', 'notNull'];
    case 'integer':
    case 'number':
    case 'date':
    case 'datetime':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'isNull', 'notNull'];
    default:
      return ['contains', 'eq', 'neq', 'notContains', 'startsWith', 'in', 'isNull', 'notNull'];
  }
}

function isComplete(f: FilterDef) {
  if (f.op === 'isNull' || f.op === 'notNull') return true;
  if (f.op === 'in') return (f.values ?? []).length > 0;
  if (f.op === 'between') return (f.values ?? []).some((v) => v !== '' && v !== undefined);
  return f.value !== undefined && f.value !== '';
}

function ValuesPicker({
  sourceId,
  column,
  selected,
  onChange,
}: {
  sourceId: string;
  column: string;
  selected: unknown[];
  onChange: (v: unknown[]) => void;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const q = useQuery({
    queryKey: ['distinct', sourceId, column, debounced],
    queryFn: () => sourcesService.distinct(sourceId, column, debounced || undefined),
    staleTime: 60_000,
  });
  const set = new Set(selected.map((v) => (v === null ? '__null' : String(v))));
  const toggle = (v: string | null) => {
    const k = v === null ? '__null' : v;
    if (set.has(k)) onChange(selected.filter((s) => (s === null ? '__null' : String(s)) !== k));
    else onChange([...selected, v]);
  };
  return (
    <div className="rounded-md border border-slate-200">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar valores…"
        className="h-8 w-full border-b border-slate-200 px-2 text-xs focus:outline-none"
      />
      <div className="scroll-thin max-h-40 overflow-y-auto p-1">
        {q.isLoading && <p className="p-2 text-xs text-slate-400">Carregando…</p>}
        {q.data?.map((d) => (
          <label key={d.value ?? '__null'} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
            <input type="checkbox" checked={set.has(d.value ?? '__null')} onChange={() => toggle(d.value)} />
            <span className="flex-1 truncate">{d.value ?? <i className="text-slate-400">(vazio)</i>}</span>
            <span className="text-slate-400">{fmtInt(d.count)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function FilterDialog() {
  const open = useAppStore((s) => s.dialogs.filters);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const { sourceId, source } = useActiveSource();
  const schema = useSourceSchema(sourceId);
  const [rows, setRows] = useState<FilterDef[]>([]);

  useEffect(() => {
    if (open) setRows(filters.length ? filters : []);
  }, [open, filters]);
  const complete = useMemo(() => rows.filter(isComplete), [rows]);

  if (!open || !sourceId) return null;
  const cols = schema.data?.columns ?? [];
  const colOf = (name: string) => cols.find((c) => c.name === name);

  const update = (i: number, patch: Partial<FilterDef>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const addRow = () => {
    const first = source?.categoryColumn ?? source?.labelColumn ?? cols[0]?.name ?? '';
    const c = colOf(first);
    setRows((r) => [...r, { column: first, op: c?.kind === 'text' ? 'in' : opsFor(c)[0], values: [] }]);
  };

  const apply = () => {
    setFilters(complete);
    closeDialog('filters');
  };

  return (
    <Dialog
      open
      size="lg"
      title="Filtros"
      description="Aplicados ao mapa, à seleção por região, à busca de registros sobrepostos e à exportação de filtrados."
      onClose={() => closeDialog('filters')}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setFilters([]);
              closeDialog('filters');
            }}
          >
            Limpar filtros
          </Button>
          <Button onClick={() => closeDialog('filters')}>Cancelar</Button>
          <Button variant="primary" onClick={apply}>
            Aplicar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-slate-500">Nenhum filtro. Adicione uma condição.</p>}
        {rows.map((f, i) => {
          const col = colOf(f.column);
          const ops = opsFor(col);
          const inputType = col?.kind === 'date' ? 'date' : col?.kind === 'datetime' ? 'datetime-local' : 'text';
          return (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <Select
                  className="min-w-40 flex-1"
                  value={f.column}
                  onChange={(e) => {
                    const c = colOf(e.target.value);
                    update(i, { column: e.target.value, op: opsFor(c)[0], value: undefined, values: [] });
                  }}
                >
                  {cols.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Select
                  className="w-44"
                  value={f.op}
                  onChange={(e) => update(i, { op: e.target.value as FilterOp, value: undefined, values: [] })}
                >
                  {ops.map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                </Select>
                <Button variant="ghost" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Remover filtro">
                  <Trash2 className="size-4 text-slate-500" />
                </Button>
              </div>
              <div className="mt-2">
                {f.op === 'in' ? (
                  <ValuesPicker
                    sourceId={sourceId}
                    column={f.column}
                    selected={f.values ?? []}
                    onChange={(values) => update(i, { values })}
                  />
                ) : f.op === 'between' ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type={inputType}
                      value={String(f.values?.[0] ?? '')}
                      onChange={(e) => update(i, { values: [e.target.value, f.values?.[1] ?? ''] })}
                    />
                    <span className="text-xs text-slate-500">até</span>
                    <Input
                      type={inputType}
                      value={String(f.values?.[1] ?? '')}
                      onChange={(e) => update(i, { values: [f.values?.[0] ?? '', e.target.value] })}
                    />
                  </div>
                ) : f.op === 'isNull' || f.op === 'notNull' ? null : col?.kind === 'boolean' ? (
                  <Select value={String(f.value ?? '')} onChange={(e) => update(i, { value: e.target.value })}>
                    <option value="">—</option>
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </Select>
                ) : (
                  <Input
                    type={inputType}
                    value={String(f.value ?? '')}
                    onChange={(e) => update(i, { value: e.target.value })}
                    placeholder="Valor"
                  />
                )}
              </div>
            </div>
          );
        })}
        <Button icon={<Plus className="size-4" />} onClick={addRow} disabled={!cols.length}>
          Adicionar condição
        </Button>
        <FilterReplaceSection
          sourceId={sourceId}
          filters={complete}
          columns={cols}
          blocked={[source?.idColumn, source?.xColumn, source?.yColumn]}
        />
      </div>
    </Dialog>
  );
}
