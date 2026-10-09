import {
  Crosshair,
  Eraser,
  MousePointerClick,
  Search,
  Sparkles,
  TextSearch,
  ZoomIn,
} from 'lucide-react';
import { useMemo, useRef, useState, type RefObject } from 'react';
import { useSourceSchema, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import type { ColumnMeta, FilterDef, FilterOp, QueryResponse } from '@/types';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { PX_PER_CM } from '@/utils/geo';
import { FloatingPanel } from '../ui/FloatingPanel';
import { toast } from '../ui/Toaster';
import type { PointsOverlayApi } from './pointsOverlay';

const OP_LABEL: Record<FilterOp, string> = {
  eq: 'Igual a (=)',
  neq: 'Diferente de (≠)',
  contains: 'Contém',
  notContains: 'Não contém',
  startsWith: 'Começa com',
  in: 'Em',
  gt: 'Maior que (>)',
  gte: 'Maior ou igual (≥)',
  lt: 'Menor que (<)',
  lte: 'Menor ou igual (≤)',
  between: 'Entre',
  isNull: 'Está vazio',
  notNull: 'Não está vazio',
};
const TEXT_OPS: FilterOp[] = [
  'eq',
  'neq',
  'contains',
  'notContains',
  'startsWith',
  'isNull',
  'notNull',
];
const ORDER_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isNull', 'notNull'];
const BOOL_OPS: FilterOp[] = ['eq', 'neq', 'isNull', 'notNull'];
const NO_VALUE: FilterOp[] = ['isNull', 'notNull'];

const opsFor = (c: ColumnMeta) =>
  c.kind === 'text' || c.kind === 'json' || c.kind === 'other'
    ? TEXT_OPS
    : c.kind === 'boolean'
      ? BOOL_OPS
      : ORDER_OPS;
const isText = (c: ColumnMeta) => opsFor(c) === TEXT_OPS;

interface Field {
  value: string;
  op: FilterOp;
  cs: boolean;
}

type Action = 'flash' | 'center' | 'zoom' | 'select';

const NO_FILTERS: FilterDef[] = [];

/**
 * "Selecionar por valor" (como no QGIS): preencha um ou mais campos e pisque, centralize, aproxime ou
 * selecione os pontos que atendem a todos eles. Respeita os filtros ativos da camada.
 */
export function SelectByValuePanel({
  overlay,
  windowId,
  sourceId,
  index,
}: {
  overlay: RefObject<PointsOverlayApi | null>;
  windowId: string;
  /** Camada pesquisada por esta janela (fixa, mesmo que a camada ativa mude) */
  sourceId: string;
  /** Ordem de abertura: janelas novas aparecem deslocadas */
  index: number;
}) {
  const closeWindow = useAppStore((s) => s.closeSearchWindow);
  // Filtros da camada: os atuais se ela for a ativa; senão os guardados dela.
  const layerFilters = useAppStore((s) =>
    s.sourceId === sourceId ? s.filters : (s.layerFilters[sourceId] ?? NO_FILTERS),
  );
  const setSelection = useAppStore((s) => s.setSelection);
  const setSource = useAppStore((s) => s.setSource);
  const focusMap = useAppStore((s) => s.focusMap);
  const sources = useSources();
  const source = sources.data?.find((s) => s.id === sourceId);
  const schema = useSourceSchema(sourceId);
  const columns = useMemo(
    () => (schema.data?.columns ?? []).filter((c) => c.kind !== 'geometry'),
    [schema.data],
  );

  const [fields, setFields] = useState<Record<string, Field>>({});
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [busy, setBusy] = useState<Action | null>(null);
  const [last, setLast] = useState<{ count: number; truncated: boolean } | null>(null);
  const cache = useRef<{ key: string; res: QueryResponse } | null>(null);

  const fieldOf = (c: ColumnMeta): Field => fields[c.name] ?? { value: '', op: 'eq', cs: false };
  const update = (c: ColumnMeta, patch: Partial<Field>) => {
    setFields((f) => ({ ...f, [c.name]: { ...fieldOf(c), ...patch } }));
    setLast(null);
  };

  const filters = useMemo<FilterDef[]>(() => {
    const out: FilterDef[] = [];
    for (const c of columns) {
      const f = fields[c.name];
      if (!f) continue;
      const noValue = NO_VALUE.includes(f.op);
      if (!noValue && !f.value.trim()) continue;
      out.push({
        column: c.name,
        op: f.op,
        value: noValue ? undefined : f.value.trim(),
        caseSensitive: isText(c) ? f.cs : undefined,
      });
    }
    return out;
  }, [columns, fields]);

  const run = async (action: Action) => {
    if (!sourceId) return;
    if (!filters.length) {
      toast.info('Preencha pelo menos um campo.');
      return;
    }
    setBusy(action);
    try {
      const all = [...layerFilters, ...filters];
      const key = JSON.stringify([sourceId, all]);
      const res =
        cache.current?.key === key ? cache.current.res : await pointsService.query(sourceId, all);
      cache.current = { key, res };
      setLast({ count: res.count, truncated: res.truncated });
      if (!res.count || !res.bounds) {
        toast.info('Nenhum ponto atende a esses valores.');
        return;
      }
      const b = res.bounds;
      if (action === 'flash') overlay.current?.flash(res.groups);
      else if (action === 'center')
        focusMap({ center: { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 } });
      else if (action === 'zoom') focusMap({ bounds: b });
      else {
        // A seleção vale para a camada ativa: seleciona nesta camada, tornando-a ativa.
        if (useAppStore.getState().sourceId !== sourceId) setSource(sourceId);
        setSelection(res.groups, mode);
        toast.success(
          `${fmtInt(res.count)} registro(s) selecionado(s).${res.truncated ? ' (limitado a 200.000)' : ''}`,
        );
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const q = search.trim().toLowerCase();
  const shown = q ? columns.filter((c) => c.name.toLowerCase().includes(q)) : columns;

  return (
    <FloatingPanel
      title={`${source?.name ?? 'Camada'} — Selecionar por valor`}
      icon={<TextSearch className="size-4 text-accent-600" />}
      onClose={() => closeWindow(windowId)}
      defaultClassName="right-3"
      // Cada nova janela um pouco abaixo e à esquerda da anterior.
      defaultStyle={{ top: 56 + (index % 8) * 28, marginRight: (index % 8) * 28 }}
      className="w-[34rem] max-w-[calc(100%-1.5rem)]"
      // Mínimo: 12 cm de largura × 5 cm de altura.
      resizable={{ minWidth: 12 * PX_PER_CM, minHeight: 5 * PX_PER_CM }}
      footer={
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={<Eraser className="size-3.5" />}
            onClick={() => {
              setFields({});
              setLast(null);
            }}
          >
            Limpar formulário
          </Button>
          <span className="flex-1 text-xs text-slate-500">
            {last && `${fmtInt(last.count)} registro(s)${last.truncated ? ' (limite)' : ''}`}
          </span>
          <Button
            size="sm"
            icon={<Sparkles className="size-3.5" />}
            loading={busy === 'flash'}
            onClick={() => run('flash')}
          >
            Piscar
          </Button>
          <Button
            size="sm"
            icon={<Crosshair className="size-3.5" />}
            loading={busy === 'center'}
            onClick={() => run('center')}
          >
            Centralizar
          </Button>
          <Button
            size="sm"
            icon={<ZoomIn className="size-3.5" />}
            loading={busy === 'zoom'}
            onClick={() => run('zoom')}
          >
            Zoom
          </Button>
          <span className="inline-flex">
            <Button
              size="sm"
              variant="primary"
              icon={<MousePointerClick className="size-3.5" />}
              loading={busy === 'select'}
              onClick={() => run('select')}
              className="rounded-r-none"
            >
              Selecionar
            </Button>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'replace' | 'add')}
              className="h-7 rounded-r-md border border-l-0 border-accent-700 bg-accent-600 px-1 text-xs text-white"
              title="Modo de seleção"
              aria-label="Modo de seleção"
            >
              <option value="replace">substituir</option>
              <option value="add">adicionar</option>
            </select>
          </span>
        </div>
      }
    >
      <div className="space-y-2 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar campos…"
            className="h-7 w-full rounded-md border border-slate-200 pr-2 pl-7 text-xs focus:border-accent-500 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1.5">
          {shown.map((c) => {
            const f = fieldOf(c);
            const text = isText(c);
            const noValue = NO_VALUE.includes(f.op);
            const filled = noValue || !!f.value.trim();
            return (
              <div key={c.name} className="contents">
                <span
                  className={`truncate text-xs ${filled ? 'font-semibold text-accent-800' : 'text-slate-600'}`}
                  title={c.name}
                >
                  {c.name}
                </span>
                <input
                  value={noValue ? '' : f.value}
                  disabled={noValue}
                  onChange={(e) => update(c, { value: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && void run('select')}
                  className="h-7 min-w-0 rounded-md border border-slate-300 px-2 text-sm disabled:bg-slate-50 focus:border-accent-500 focus:outline-none"
                />
                {text ? (
                  <label
                    className="flex items-center gap-1 text-[11px] whitespace-nowrap text-slate-500"
                    title="Diferenciar maiúsculas de minúsculas"
                  >
                    <input
                      type="checkbox"
                      checked={f.cs}
                      onChange={(e) => update(c, { cs: e.target.checked })}
                      className="accent-accent-600"
                    />
                    Aa
                  </label>
                ) : (
                  <span />
                )}
                <select
                  value={f.op}
                  onChange={(e) => update(c, { op: e.target.value as FilterOp })}
                  className="h-7 rounded-md border border-slate-300 bg-white px-1 text-xs text-slate-700"
                >
                  {opsFor(c).map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        {layerFilters.length > 0 && (
          <p className="text-[11px] text-amber-700">
            Os filtros ativos da camada também se aplicam.
          </p>
        )}
      </div>
    </FloatingPanel>
  );
}
