import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  MousePointerClick,
  Pencil,
  Ruler,
  Settings2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { queryKeys, useSourceSchema } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { selectPoints, type ToolPoint } from '@/lib/selectPoints';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { useToolListsStore } from '@/stores/toolListsStore';
import type { ColumnMeta } from '@/types';
import { fmtInt, fmtValue } from '@/utils/format';
import { PX_PER_CM, boundsOfPoints, fmtDistance } from '@/utils/geo';
import { ValueInput, fromInputValue, toInputValue } from '../forms/ValueInput';
import { Button } from '../ui/Button';
import { FloatingPanel } from '../ui/FloatingPanel';
import { Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

const COLS_KEY = 'geoanalisys-attr-list-columns';
/** Registros carregados de uma vez para mostrar os atributos das seções abertas */
const MAX_RECORDS = 500;

interface Row extends ToolPoint {
  /** far = distante; noMatch = sem correspondente na referência; near = mesmo valor, dentro da distância */
  kind: 'far' | 'noMatch' | 'near';
  /** Valor do atributo no registro (os de uma seção podem diferir em zeros à esquerda/maiúsculas) */
  value: unknown;
  distance?: number;
  target?: { id: string | null; lat: number; lng: number } | null;
}

interface Section {
  key: string;
  value: unknown;
  rows: Row[];
  /** Maior distância (ordena as seções) */
  max: number;
}

/** Chave da seção: valor sem diferenciar maiúsculas (e sem zeros à esquerda, se pedido). */
function sectionKey(v: unknown, stripZeros: boolean) {
  const k = fmtValue(v).trim().toLowerCase();
  return stripZeros ? k.replace(/^0+(?=.)/, '') : k;
}

function loadCols(sourceId: string): string[] | null {
  try {
    const all = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}') as Record<string, string[]>;
    return all[sourceId] ?? null;
  } catch {
    return null;
  }
}
function saveCols(sourceId: string, cols: string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}') as Record<string, string[]>;
    localStorage.setItem(COLS_KEY, JSON.stringify({ ...all, [sourceId]: cols }));
  } catch {
    /* só nesta sessão */
  }
}

/**
 * Lista de Ferramentas › Distância por atributo, em seções por valor do atributo. Clicar no topo da
 * seção seleciona todos os pontos dela; clicar num registro, só ele. Na seção aberta dá para ver
 * os atributos escolhidos e alterar o valor de um atributo nos pontos marcados.
 */
export function AttributeDistancePanel() {
  const result = useToolListsStore((s) => s.attrDist);
  if (!result) return null;
  return <Panel key={result.request.layer.sourceId + result.data.summary.durationMs} />;
}

function Panel() {
  const result = useToolListsStore((s) => s.attrDist)!;
  const setOpen = useToolListsStore((s) => s.setAttrDistOpen);
  const openDialog = useAppStore((s) => s.openDialog);
  const { request, data } = result;
  const { summary } = data;
  const sourceId = request.layer.sourceId;
  const column = request.layer.column;
  const schema = useSourceSchema(sourceId);
  const columns = useMemo(
    () => (schema.data?.columns ?? []).filter((c) => c.kind !== 'geometry'),
    [schema.data],
  );

  const [viewCols, setViewCols] = useState<string[]>(() => loadCols(sourceId) ?? [column]);
  useEffect(() => saveCols(sourceId, viewCols), [sourceId, viewCols]);
  const [pickCols, setPickCols] = useState(false);
  const [open, setOpenSections] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const strip = request.stripZeros;
  const sections = useMemo(() => {
    const map = new Map<string, Section>();
    const add = (value: unknown, row: Row) => {
      const key = sectionKey(value, strip);
      let s = map.get(key);
      if (!s) map.set(key, (s = { key, value, rows: [], max: -1 }));
      s.rows.push(row);
      s.max = Math.max(s.max, row.distance ?? -1);
    };
    for (const p of data.points)
      add(p.value, { ...p, kind: 'far', distance: p.distance, target: p.target });
    for (const p of data.noMatch) add(p.value, { ...p, kind: 'noMatch' });
    return [...map.values()].sort((a, b) => b.max - a.max);
  }, [data, strip]);

  // Demais pontos da camada com o mesmo valor (dentro da distância), nas seções abertas.
  const openSections = useMemo(() => sections.filter((s) => open.has(s.key)), [sections, open]);
  const lookupValues = useMemo(
    () => [...new Set(openSections.flatMap((s) => s.rows.map((r) => fmtValue(r.value))))],
    [openSections],
  );
  const lookup = useQuery({
    queryKey: ['points', sourceId, 'attr-lookup', column, lookupValues],
    queryFn: () => pointsService.lookup(sourceId, column, lookupValues),
    enabled: lookupValues.length > 0,
    staleTime: 30_000,
  });
  const nearBySection = useMemo(() => {
    const out = new Map<string, Row[]>();
    for (const item of lookup.data?.items ?? []) {
      const key = sectionKey(item.value, strip);
      const list = out.get(key) ?? [];
      for (const g of item.groups)
        for (const id of g.ids)
          if (!list.some((r) => r.id === id))
            list.push({
              id,
              x: g.x,
              y: g.y,
              lat: g.lat,
              lng: g.lng,
              kind: 'near',
              value: item.value,
            });
      out.set(key, list);
    }
    return out;
  }, [lookup.data, strip]);
  const rowsOf = useCallback(
    (s: Section): Row[] => {
      const ids = new Set(s.rows.map((r) => r.id));
      return [...s.rows, ...(nearBySection.get(s.key) ?? []).filter((r) => !ids.has(r.id))];
    },
    [nearBySection],
  );

  const recordIds = useMemo(
    () =>
      viewCols.length
        ? [...new Set(openSections.flatMap((s) => rowsOf(s).map((r) => r.id)))].slice(
            0,
            MAX_RECORDS,
          )
        : [],
    [openSections, rowsOf, viewCols.length],
  );
  const records = useQuery({
    queryKey: ['points', sourceId, 'attr-records', recordIds],
    queryFn: () => pointsService.records(sourceId, recordIds, true),
    enabled: recordIds.length > 0,
    staleTime: 30_000,
  });
  const byId = useMemo(() => new Map((records.data ?? []).map((r) => [r.id, r])), [records.data]);

  const focus = (rows: Row[]) => {
    const targets = rows.flatMap((r) => (r.target ? [r.target] : []));
    selectPoints(sourceId, rows, boundsOfPoints([...rows, ...targets]));
  };
  const toggleSection = (key: string) =>
    setOpenSections((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <FloatingPanel
      title={`${summary.name} — Distância por atributo (${summary.column})`}
      icon={<Ruler className="size-4 text-accent-600" />}
      onClose={() => setOpen(false)}
      defaultClassName="right-3 top-14"
      className="h-[75%] w-[34rem] max-w-[calc(100%-1.5rem)]"
      resizable={{ minWidth: 10 * PX_PER_CM, minHeight: 5 * PX_PER_CM }}
      actions={
        <>
          <button
            type="button"
            onClick={() => setPickCols((v) => !v)}
            className={clsx(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
              pickCols
                ? 'bg-accent-100 text-accent-800 hover:bg-accent-200'
                : 'text-slate-600 hover:bg-slate-100',
            )}
            title="Atributos mostrados nos registros"
            aria-pressed={pickCols}
          >
            <Columns3 className="size-3.5" /> Atributos
          </button>
          <button
            type="button"
            onClick={() => openDialog('attributeDistance', true)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Parâmetros"
            aria-label="Parâmetros"
          >
            <Settings2 className="size-4" />
          </button>
        </>
      }
      footer={
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpenSections(new Set(sections.map((s) => s.key)))}
          >
            Abrir todas
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpenSections(new Set())}>
            Fechar todas
          </Button>
          <span className="flex-1" />
          <Button
            size="sm"
            icon={<MousePointerClick className="size-3.5" />}
            disabled={!sections.length}
            onClick={() => focus(sections.flatMap((s) => s.rows))}
          >
            Selecionar todos ({fmtInt(data.points.length + data.noMatch.length)})
          </Button>
        </div>
      }
    >
      <p className="border-b border-slate-100 px-3 py-1.5 text-xs text-slate-500">
        {fmtInt(sections.length)} valor(es) de {summary.column} com {fmtInt(data.points.length)}{' '}
        ponto(s) a mais de {fmtDistance(request.maxDistance)}
        {data.noMatch.length > 0 &&
          ` e ${fmtInt(data.noMatch.length)} sem correspondente em ${summary.referenceName}`}
        . Clique no valor para selecionar a seção toda, ou num registro para selecionar só ele; abra
        a seção (▸) para ver os atributos e alterar valores.
      </p>
      {pickCols && (
        <div className="border-b border-slate-100 px-3 py-2">
          <p className="mb-1 text-xs text-slate-600">Atributos mostrados em cada registro:</p>
          <div className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-auto text-xs">
            {columns.map((c) => (
              <label key={c.name} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="accent-accent-600"
                  checked={viewCols.includes(c.name)}
                  onChange={(e) =>
                    setViewCols((cur) =>
                      e.target.checked
                        ? columns.map((x) => x.name).filter((n) => n === c.name || cur.includes(n))
                        : cur.filter((n) => n !== c.name),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>
      )}
      {!sections.length && (
        <p className="px-3 py-6 text-center text-sm text-slate-500">Nenhum ponto distante.</p>
      )}
      {sections.map((s) => {
        const isOpen = open.has(s.key);
        const rows = isOpen ? rowsOf(s) : s.rows;
        return (
          <section key={s.key} className="border-b border-slate-200">
            <div className="sticky top-0 z-[1] flex items-center bg-slate-50 text-xs hover:bg-slate-100">
              <button
                type="button"
                onClick={() => toggleSection(s.key)}
                className="px-2 py-1 text-slate-500 hover:text-slate-800"
                title={
                  isOpen ? 'Fechar a seção' : 'Abrir a seção (atributos e alteração de valores)'
                }
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveId(null);
                  focus(rows);
                }}
                title="Selecionar todos os pontos da seção"
                className="flex min-w-0 flex-1 items-baseline gap-2 py-1 pr-3 text-left"
              >
                <span className="truncate font-semibold text-slate-800">
                  {summary.column} = {fmtValue(s.value)}
                </span>
                <span className="text-slate-600">{fmtInt(rows.length)} ponto(s)</span>
                {s.max >= 0 && (
                  <span className="ml-auto shrink-0 text-slate-500">até {fmtDistance(s.max)}</span>
                )}
              </button>
            </div>
            {isOpen ? (
              <SectionBody
                sourceId={sourceId}
                rows={rows}
                columns={columns}
                viewCols={viewCols}
                byId={byId}
                loading={records.isFetching || lookup.isFetching}
                activeId={activeId}
                referenceName={summary.referenceName}
                onShow={(r) => {
                  setActiveId(r.id);
                  focus([r]);
                }}
                onShowMany={focus}
              />
            ) : (
              <ul>
                {rows.map((r) => (
                  <RowLine
                    key={r.id}
                    row={r}
                    active={r.id === activeId}
                    referenceName={summary.referenceName}
                    onShow={() => {
                      setActiveId(r.id);
                      focus([r]);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </FloatingPanel>
  );
}

function rowInfo(r: Row, referenceName: string | null) {
  if (r.kind === 'noMatch') return `sem correspondente em ${referenceName}`;
  if (r.kind === 'near') return 'mesmo valor, dentro da distância';
  return `${fmtDistance(r.distance ?? 0)} de ${r.target?.id ?? 'centro'}`;
}

function RowLine({
  row: r,
  active,
  referenceName,
  onShow,
  children,
  check,
}: {
  row: Row;
  active: boolean;
  referenceName: string | null;
  onShow: () => void;
  children?: ReactNode;
  check?: ReactNode;
}) {
  return (
    <li
      className={clsx(
        'flex items-start gap-2 border-t border-slate-100 px-3 py-1 text-xs',
        active ? 'bg-accent-50' : 'hover:bg-slate-50',
        r.kind === 'near' && !active && 'text-slate-500',
      )}
    >
      {check}
      <button
        type="button"
        onClick={onShow}
        className="min-w-0 flex-1 text-left"
        title="Selecionar este ponto"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={clsx('font-mono font-medium', r.kind !== 'near' && 'text-slate-800')}>
            {r.id}
          </span>
          <span
            className={clsx(
              'ml-auto',
              r.kind === 'far' ? 'text-red-700' : r.kind === 'noMatch' ? 'text-amber-700' : '',
            )}
          >
            {rowInfo(r, referenceName)}
          </span>
        </span>
        {children}
      </button>
    </li>
  );
}

/** Seção aberta: registros com os atributos escolhidos, marcação e alteração de valores. */
function SectionBody({
  sourceId,
  rows,
  columns,
  viewCols,
  byId,
  loading,
  activeId,
  referenceName,
  onShow,
  onShowMany,
}: {
  sourceId: string;
  rows: Row[];
  columns: ColumnMeta[];
  viewCols: string[];
  byId: Map<string, { data: Record<string, unknown> }>;
  loading: boolean;
  activeId: string | null;
  referenceName: string | null;
  onShow: (r: Row) => void;
  onShowMany: (rows: Row[]) => void;
}) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const editable = useMemo(() => columns.filter((c) => !c.readOnly), [columns]);
  const [editCol, setEditCol] = useState('');
  const col = editable.find((c) => c.name === editCol) ?? null;
  const [value, setValue] = useState('');
  const marked = rows.filter((r) => checked.has(r.id));
  const all = rows.length > 0 && marked.length === rows.length;

  const save = useMutation({
    mutationFn: () => {
      const v = fromInputValue(col!, value);
      if (v.error) throw new Error(v.error);
      return pointsService.bulkUpdate(
        sourceId,
        marked.map((r) => r.id),
        { [col!.name]: v.value },
      );
    },
    onSuccess: (r) => {
      toast.success(`${col!.name} alterado em ${fmtInt(r.updated)} registro(s).`);
      qc.invalidateQueries({ queryKey: queryKeys.points(sourceId) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toggle = (id: string) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <ul>
        {rows.map((r) => {
          const rec = byId.get(r.id);
          return (
            <RowLine
              key={r.id}
              row={r}
              active={r.id === activeId}
              referenceName={referenceName}
              onShow={() => onShow(r)}
              check={
                <input
                  type="checkbox"
                  className="mt-0.5 accent-accent-600"
                  checked={checked.has(r.id)}
                  onChange={() => toggle(r.id)}
                  aria-label={`Marcar ${r.id} para alterar`}
                />
              }
            >
              {viewCols.length > 0 && (
                <span className="mt-0.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-[11px]">
                  {viewCols.map((c) => (
                    <span key={c} className="contents">
                      <span className="text-slate-400">{c}</span>
                      <span className="truncate text-slate-700">
                        {rec ? fmtValue(rec.data[c]) : loading ? '…' : '—'}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </RowLine>
          );
        })}
      </ul>
      <div className="space-y-1.5 border-t border-slate-200 bg-slate-50/60 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-slate-700">
            <input
              type="checkbox"
              className="accent-accent-600"
              checked={all}
              onChange={() => setChecked(all ? new Set() : new Set(rows.map((r) => r.id)))}
            />
            Marcar todos
          </label>
          <span className="text-slate-500">{fmtInt(marked.length)} marcado(s)</span>
          {marked.length > 0 && (
            <button
              type="button"
              className="text-accent-700 hover:underline"
              onClick={() => onShowMany(marked)}
            >
              selecionar marcados no mapa
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pencil className="size-3.5 text-slate-500" />
          <span className="text-slate-700">Alterar</span>
          <Select
            value={editCol}
            onChange={(e) => {
              setEditCol(e.target.value);
              const first = marked.length === 1 ? byId.get(marked[0].id) : null;
              const c = editable.find((x) => x.name === e.target.value);
              setValue(first && c ? toInputValue(c, first.data[c.name]) : '');
            }}
            className="h-7 w-40 text-xs"
            aria-label="Atributo a alterar"
          >
            <option value="">— atributo —</option>
            {editable.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <span className="text-slate-700">para</span>
          <div className="w-40">
            {col ? (
              <ValueInput col={col} value={value} onChange={setValue} placeholder="(vazio)" />
            ) : (
              <span className="text-slate-400">escolha o atributo</span>
            )}
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={!col || !marked.length}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Aplicar em {fmtInt(marked.length)}
          </Button>
        </div>
      </div>
    </div>
  );
}
