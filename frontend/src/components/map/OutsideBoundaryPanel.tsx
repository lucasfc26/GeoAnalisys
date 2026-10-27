import clsx from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  MapPinOff,
  MousePointerClick,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { selectPoints } from '@/lib/selectPoints';
import { useAppStore } from '@/stores/appStore';
import { useToolListsStore } from '@/stores/toolListsStore';
import { fmtInt } from '@/utils/format';
import { PX_PER_CM, fmtDistance } from '@/utils/geo';
import { Button } from '../ui/Button';
import { FloatingPanel } from '../ui/FloatingPanel';
import { findElementById } from '@/lib/detachedWindows';

/** Motivo sugerido ao excluir um registro pela lista (pode ser reescrito) */
const DELETE_OBSERVATION = 'Removido: Fora do limite';
const EMPTY: string[] = [];

/**
 * Lista de Ferramentas › Fora do limite, do ponto mais distante da borda para o mais próximo.
 * Clicar num ponto seleciona e centraliza; o ponto em análise pode ser excluído.
 */
export function OutsideBoundaryPanel() {
  const result = useToolListsStore((s) => s.outside);
  const setOpen = useToolListsStore((s) => s.setOutsideOpen);
  const sourceId = result?.request.layer.sourceId ?? '';
  const deletedIds = useToolListsStore((s) => s.deletedIds[sourceId] ?? EMPTY);
  const deleted = useMemo(() => new Set(deletedIds), [deletedIds]);
  const openDialog = useAppStore((s) => s.openDialog);
  const [current, setCurrent] = useState<number | null>(null);
  if (!result) return null;
  const { points, summary } = result.data;
  const remaining = points.filter((p) => !deleted.has(p.id));

  const show = (k: number) => {
    setCurrent(k);
    selectPoints(sourceId, [points[k]]);
    findElementById(`out-pt-${k}`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <FloatingPanel
      title={`${summary.name} — Fora do limite`}
      icon={<MapPinOff className="size-4 text-accent-600" />}
      onClose={() => setOpen(false)}
      defaultClassName="right-3 top-14"
      className="h-[70%] w-[26rem] max-w-[calc(100%-1.5rem)]"
      resizable={{ minWidth: 8 * PX_PER_CM, minHeight: 5 * PX_PER_CM }}
      actions={
        <button
          type="button"
          onClick={() => openDialog('outsideBoundary', true)}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title="Parâmetros"
          aria-label="Parâmetros"
        >
          <Settings2 className="size-4" />
        </button>
      }
      footer={
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={<ChevronLeft className="size-3.5" />}
            disabled={!points.length || current === 0}
            onClick={() => show(current === null ? 0 : current - 1)}
          >
            Anterior
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!points.length || current === points.length - 1}
            onClick={() => show(current === null ? 0 : current + 1)}
          >
            Próximo <ChevronRight className="size-3.5" />
          </Button>
          <span className="flex-1" />
          <Button
            size="sm"
            icon={<MousePointerClick className="size-3.5" />}
            disabled={!remaining.length}
            onClick={() => {
              setCurrent(null);
              selectPoints(sourceId, remaining);
            }}
          >
            Selecionar todos ({fmtInt(remaining.length)})
          </Button>
        </div>
      }
    >
      <p className="border-b border-slate-100 px-3 py-1.5 text-xs text-slate-500">
        {fmtInt(summary.outside)} ponto(s) fora de {summary.boundaryName}
        {summary.truncated && ` — mostrando os ${fmtInt(points.length)} mais distantes`}. Clique num
        ponto para selecioná-lo no mapa.
      </p>
      {!points.length && (
        <p className="px-3 py-6 text-center text-sm text-slate-500">Nenhum ponto fora do limite.</p>
      )}
      <ul>
        {points.map((p, k) => {
          const gone = deleted.has(p.id);
          const active = k === current;
          return (
            <li key={p.id} id={`out-pt-${k}`}>
              <button
                type="button"
                onClick={() => show(k)}
                className={clsx(
                  'flex w-full items-baseline gap-2 border-t border-slate-100 px-3 py-1.5 text-left text-xs',
                  active ? 'bg-accent-50' : 'hover:bg-slate-50',
                )}
              >
                <span className="w-8 shrink-0 text-slate-400 tabular-nums">{k + 1}</span>
                <span
                  className={clsx(
                    'font-mono font-medium',
                    gone ? 'text-red-600 line-through' : 'text-slate-800',
                  )}
                  title={gone ? 'Excluído' : undefined}
                >
                  {p.id}
                </span>
                <span className="ml-auto text-slate-600 tabular-nums">
                  {fmtDistance(p.distance)} da borda
                </span>
              </button>
              {active && (
                <div className="flex items-center gap-1.5 bg-accent-50 px-3 pb-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    icon={<Trash2 className="size-3.5" />}
                    disabled={gone}
                    title={gone ? 'Registro já excluído' : `Excluir o registro ${p.id}`}
                    onClick={() =>
                      openDialog('confirmDelete', {
                        ids: [p.id],
                        sourceId,
                        observation: DELETE_OBSERVATION,
                      })
                    }
                  >
                    {gone ? `${p.id} excluído` : `Excluir ${p.id}`}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </FloatingPanel>
  );
}
