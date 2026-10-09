import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GripVertical,
  History,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { queryKeys, useSourceSchema } from '@/hooks/useSourceData';
import { api, qs } from '@/lib/api';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { fmtCoord, fmtDeg, fmtValue, isUrl } from '@/utils/format';
import { applyOrder, moveItem } from '@/utils/list';
import { Button } from '../ui/Button';
import { ErrorState, SkeletonList } from '../ui/States';

interface AuditItem {
  id: string;
  userId: string | null;
  action: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
}

function AuditHistory({ sourceId, id }: { sourceId: string; id: string }) {
  const q = useQuery({
    queryKey: ['points', sourceId, 'audit', id],
    queryFn: () => api.get<{ total: number; items: AuditItem[] }>(`/audit${qs({ sourceId, entityId: id, take: 20 })}`),
  });
  if (q.isLoading) return <SkeletonList rows={2} />;
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.items.length) return <p className="text-xs text-slate-500">Nenhuma alteração registrada.</p>;
  return (
    <ul className="space-y-2">
      {q.data.items.map((a) => (
        <li key={a.id} className="rounded border border-slate-200 p-2 text-xs">
          <div className="flex justify-between text-slate-500">
            <span className="font-medium text-slate-700">{a.action}</span>
            <span>{new Date(a.createdAt).toLocaleString('pt-BR')}</span>
          </div>
          <div className="text-slate-400">por {a.userId ?? '—'}</div>
          {a.action.includes('UPDATE') && a.newValue && (
            <ul className="mt-1 space-y-0.5">
              {Object.keys(a.newValue).map((k) => (
                <li key={k} className="break-words">
                  <span className="font-medium text-slate-600">{k}:</span>{' '}
                  <span className="text-red-600 line-through">{fmtValue(a.oldValue?.[k])}</span> →{' '}
                  <span className="text-emerald-700">{fmtValue(a.newValue?.[k])}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Todos os campos de um registro, com ações de editar/excluir. */
export function RecordDetails({ sourceId, id }: { sourceId: string; id: string }) {
  const openDialog = useAppStore((s) => s.openDialog);
  const schema = useSourceSchema(sourceId);
  const [filter, setFilter] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  /** Modo "organizar": arrastar os campos para mudar a ordem (só visual, salva no navegador). */
  const [arranging, setArranging] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const savedOrder = useAppStore((s) => s.fieldOrder[sourceId]);
  const setFieldOrder = useAppStore((s) => s.setFieldOrder);
  const q = useQuery({
    queryKey: queryKeys.record(sourceId, id),
    queryFn: () => pointsService.get(sourceId, id),
  });

  const ordered = useMemo(() => {
    const cols = schema.data?.columns ?? [];
    const src = schema.data?.source;
    const special = new Set([src?.idColumn, src?.xColumn, src?.yColumn]);
    return applyOrder(
      cols.filter((c) => !special.has(c.name)).map((c) => c.name),
      savedOrder,
    );
  }, [schema.data, savedOrder]);

  const fields = useMemo(() => {
    const f = arranging ? '' : filter.trim().toLowerCase();
    return ordered.filter(
      (name) => !f || name.toLowerCase().includes(f) || fmtValue(q.data?.data[name]).toLowerCase().includes(f),
    );
  }, [ordered, filter, arranging, q.data]);

  const move = (name: string, to: number) =>
    setFieldOrder(sourceId, moveItem(ordered, ordered.indexOf(name), to));

  if (q.isLoading || schema.isLoading) return <SkeletonList rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Não foi possível carregar o registro." />;
  if (!q.data) return null;
  const rec = q.data;
  const src = schema.data?.source;
  const isUtm = schema.data?.crs.kind === 'utm';

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={<Pencil className="size-3.5" />} onClick={() => openDialog('form', { mode: 'edit', id })}>
          Editar
        </Button>
        <Button size="sm" variant="secondary" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => openDialog('confirmDelete', { ids: [id] })}>
          Excluir
        </Button>
        <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setShowHistory((v) => !v)}>
          Histórico
        </Button>
      </div>

      {showHistory && <AuditHistory sourceId={sourceId} id={id} />}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-slate-50 p-3 text-xs">
        <div className="col-span-2">
          <dt className="text-slate-500">{src?.idColumn ?? 'ID'}</dt>
          <dd className="font-mono text-sm font-semibold text-slate-900">{rec.id}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{isUtm ? 'UTM X' : 'X'} <span className="text-slate-400">({src?.xColumn})</span></dt>
          <dd className="font-mono text-slate-800">{fmtCoord(rec.x)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{isUtm ? 'UTM Y' : 'Y'} <span className="text-slate-400">({src?.yColumn})</span></dt>
          <dd className="font-mono text-slate-800">{fmtCoord(rec.y)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Latitude</dt>
          <dd className="font-mono text-slate-800">{fmtDeg(rec.lat)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Longitude</dt>
          <dd className="font-mono text-slate-800">{fmtDeg(rec.lng)}</dd>
        </div>
      </dl>

      <div>
        <div className="mb-2 flex items-center gap-1.5">
          {arranging ? (
            <>
              <p className="flex-1 text-[11px] text-slate-500">
                Arraste os campos (ou use as setas) para mudar a ordem. Só muda a exibição.
              </p>
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} disabled={!savedOrder} onClick={() => setFieldOrder(sourceId, [])} title="Voltar à ordem da tabela">
                Restaurar
              </Button>
              <Button size="sm" variant="primary" onClick={() => setArranging(false)}>
                Concluir
              </Button>
            </>
          ) : (
            <>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filtrar campos…"
                  className="h-8 w-full rounded-md border border-slate-200 bg-white pr-2 pl-7 text-xs focus:border-accent-500 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setArranging(true)}
                title="Organizar a ordem dos campos"
                aria-label="Organizar a ordem dos campos"
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <ArrowUpDown className="size-3.5" />
              </button>
            </>
          )}
        </div>
        <dl className="divide-y divide-slate-100">
          {fields.map((name, i) => {
            const v = rec.data[name];
            if (arranging) {
              return (
                <div
                  key={name}
                  draggable
                  onDragStart={(e) => {
                    setDragging(name);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragging && dragging !== name) move(dragging, i);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={clsx(
                    'flex cursor-grab items-center gap-1.5 py-1 text-xs active:cursor-grabbing',
                    dragging === name && 'bg-accent-50 opacity-60',
                  )}
                >
                  <GripVertical className="size-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={name}>
                    {name}
                  </span>
                  <button type="button" disabled={i === 0} onClick={() => move(name, i - 1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label={`Subir ${name}`}>
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button type="button" disabled={i === fields.length - 1} onClick={() => move(name, i + 1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" aria-label={`Descer ${name}`}>
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>
              );
            }
            return (
              <div key={name} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 py-1.5 text-xs">
                <dt className="truncate text-slate-500" title={name}>
                  {name}
                </dt>
                <dd className="break-words text-slate-800">
                  {isUrl(v) ? (
                    <a href={v} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-700 hover:underline">
                      abrir link <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    fmtValue(v)
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}
