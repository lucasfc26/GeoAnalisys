import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { ChevronRight, X } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { pointsService } from '@/services/points';
import { categoryColor } from '@/utils/format';
import { Skeleton } from '../ui/States';

const PAGE = 50;
const ROW = 44;
/** Espaço entre conjuntos (ex.: uma coordenada e a próxima). */
const GAP = 10;

/** Linha da lista: `primary` em destaque, `muted` em cinza, `gap` abre um espaço antes dela. */
export interface RecordItem {
  id: string;
  primary?: boolean;
  muted?: boolean;
  gap?: boolean;
}

function signature(ids: string[]) {
  return `${ids.length}:${ids[0] ?? ''}:${ids[ids.length - 1] ?? ''}`;
}

/** Busca (sob demanda) uma página de registros leves; linhas da mesma página compartilham a requisição. */
function usePage(sourceId: string, ids: string[], page: number) {
  return useQuery({
    queryKey: ['points', sourceId, 'recpage', signature(ids), page],
    queryFn: () => pointsService.records(sourceId, ids.slice(page * PAGE, page * PAGE + PAGE)),
    staleTime: 60_000,
  });
}

function Row({
  sourceId,
  ids,
  index,
  item,
  idLabel,
  active,
  onOpen,
  onRemove,
}: {
  sourceId: string;
  ids: string[];
  index: number;
  item: RecordItem;
  idLabel: string;
  active: boolean;
  onOpen: (id: string, x: number | null, y: number | null) => void;
  onRemove?: (id: string) => void;
}) {
  const id = item.id;
  const page = usePage(sourceId, ids, Math.floor(index / PAGE));
  const rec = page.data?.find((r) => r.id === id);
  const label = rec?.data.label as string | undefined;
  const category = rec?.data.category as string | undefined;
  return (
    <div
      className={clsx(
        'flex w-full items-center border-b border-slate-100 text-xs',
        item.gap ? 'border-t' : '',
        item.muted ? 'bg-slate-50/70 hover:bg-slate-100' : 'hover:bg-slate-50',
        item.primary && 'border-l-[3px] border-l-accent-600',
        active && 'bg-accent-50',
      )}
      style={{ height: ROW }}
    >
      <button
        type="button"
        onClick={() => onOpen(id, rec?.x ?? null, rec?.y ?? null)}
        className={clsx(
          'flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left',
          item.primary && 'pl-[9px]',
          onRemove && 'pr-1',
        )}
      >
        <span
          className={clsx('size-2 shrink-0 rounded-full', item.muted && 'opacity-40')}
          style={{ background: categoryColor(category) }}
        />
        <span className="min-w-0 flex-1">
          <span
            className={clsx(
              'block truncate',
              item.muted
                ? 'text-slate-400'
                : item.primary
                  ? 'font-semibold text-slate-900'
                  : 'font-medium text-slate-800',
            )}
          >
            {idLabel} {id}
          </span>
          {page.isLoading ? (
            <Skeleton className="mt-0.5 h-3 w-24" />
          ) : (
            <span
              className={clsx('block truncate', item.muted ? 'text-slate-400' : 'text-slate-500')}
            >
              {[label, category].filter(Boolean).join(' · ') || '—'}
            </span>
          )}
        </span>
        <ChevronRight
          className={clsx('size-4 shrink-0', item.muted ? 'text-slate-300' : 'text-slate-400')}
        />
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(id)}
          className="mr-1.5 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          title="Tirar da seleção"
          aria-label={`Tirar ${idLabel} ${id} da seleção`}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Lista virtualizada de registros (suporta dezenas de milhares de IDs). */
export function RecordList({
  sourceId,
  ids,
  items,
  idLabel = 'ID',
  activeId,
  onOpen,
  onRemove,
  maxHeight = 360,
}: {
  sourceId: string;
  ids: string[];
  /** Ordem e destaque das linhas (padrão: `ids`, todas iguais) */
  items?: RecordItem[];
  /** Nome da coluna de ID exibido em cada linha */
  idLabel?: string;
  activeId: string | null;
  onOpen: (id: string, x: number | null, y: number | null) => void;
  /** Mostra um X em cada linha para tirar o registro da seleção */
  onRemove?: (id: string) => void;
  maxHeight?: number;
}) {
  const rows = useMemo<RecordItem[]>(() => items ?? ids.map((id) => ({ id })), [items, ids]);
  const rowIds = useMemo(() => (items ? items.map((r) => r.id) : ids), [items, ids]);
  const size = (i: number) => ROW + (rows[i]?.gap && i > 0 ? GAP : 0);
  const total = rows.reduce((s, _, i) => s + size(i), 0);
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: size,
    overscan: 8,
  });
  return (
    <div
      ref={parentRef}
      className="scroll-thin overflow-y-auto rounded-md border border-slate-200 bg-white"
      style={{ maxHeight, height: Math.min(maxHeight, total + 2) }}
    >
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((it) => {
          const row = rows[it.index];
          const gap = row.gap && it.index > 0;
          return (
            <div
              key={it.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: it.size,
                transform: `translateY(${it.start}px)`,
              }}
              className={gap ? 'bg-slate-100' : undefined}
            >
              <div style={{ marginTop: gap ? GAP : 0 }} className="bg-white">
                <Row
                  sourceId={sourceId}
                  ids={rowIds}
                  index={it.index}
                  item={row}
                  idLabel={idLabel}
                  active={row.id === activeId}
                  onOpen={onOpen}
                  onRemove={onRemove}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
