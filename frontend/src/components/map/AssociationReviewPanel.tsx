import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Loader2,
  Magnet,
  MousePointerClick,
  Settings2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { queryKeys } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import type { ReviewPair, ReviewPoint } from '@/services/association';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { pairKey, useAssociationReviewStore } from '@/stores/associationReviewStore';
import type { SelectedGroup } from '@/types';
import { coordKey, fmtInt } from '@/utils/format';
import { PX_PER_CM, boundsOfPoints } from '@/utils/geo';
import { FloatingPanel } from '../ui/FloatingPanel';
import { Button } from '../ui/Button';
import { toast } from '../ui/Toaster';
import { findElementById } from '@/lib/detachedWindows';

const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

function groupsOf(points: ReviewPoint[]): SelectedGroup[] {
  const groups = new Map<string, SelectedGroup>();
  for (const p of points) {
    const key = coordKey(p.x, p.y);
    const g = groups.get(key);
    if (g) {
      if (!g.ids.includes(p.id)) g.ids.push(p.id);
    } else groups.set(key, { key, x: p.x, y: p.y, lat: p.lat, lng: p.lng, ids: [p.id] });
  }
  return [...groups.values()];
}

/**
 * Seleciona os pontos de A (camada ativa) e de B (outra camada, que entra no mapa se preciso) e
 * enquadra o mapa neles.
 */
function selectPairs(aId: string, bId: string, aPoints: ReviewPoint[], bPoints: ReviewPoint[]) {
  const s = useAppStore.getState();
  s.addLayer(bId);
  if (s.sourceId !== aId) s.setSource(aId);
  const st = useAppStore.getState();
  st.setSelection(groupsOf(aPoints));
  st.setOtherSelection({ [bId]: Object.fromEntries(groupsOf(bPoints).map((g) => [g.key, g])) });
  const b = boundsOfPoints([...aPoints, ...bPoints]);
  if (b) st.focusMap({ bounds: b });
}

/**
 * Lista de Associar Camadas › Revisar pares: pares distantes ou dúbios. Clicar num par seleciona os
 * dois pontos e centraliza; o ímã move o ponto da camada "De" para a posição do ponto associado.
 */
export function AssociationReviewPanel() {
  const result = useAssociationReviewStore((s) => s.result);
  if (!result) return null;
  return <Panel key={JSON.stringify(result.request)} result={result} />;
}

function Panel({
  result,
}: {
  result: NonNullable<ReturnType<typeof useAssociationReviewStore.getState>['result']>;
}) {
  const qc = useQueryClient();
  const setPanelOpen = useAssociationReviewStore((s) => s.setPanelOpen);
  const from = useAssociationReviewStore((s) => s.from);
  const setFrom = useAssociationReviewStore((s) => s.setFrom);
  const fixedKeys = useAssociationReviewStore((s) => s.fixed);
  const markFixed = useAssociationReviewStore((s) => s.markFixed);
  const openDialog = useAppStore((s) => s.openDialog);
  const fixed = useMemo(() => new Set(fixedKeys), [fixedKeys]);
  const { request, data } = result;
  const aId = request.a.sourceId;
  const bId = request.b.sourceId;
  const [current, setCurrent] = useState<number | null>(null);
  const [snapping, setSnapping] = useState<number | null>(null);
  /** Posição nova dos pontos já ajustados (`A:id` / `B:id`) */
  const [moved, setMoved] = useState<Record<string, ReviewPoint>>({});
  const pairs = useMemo(
    () =>
      data.pairs.map((p) => ({
        ...p,
        a: moved[`A:${p.a.id}`] ?? p.a,
        b: moved[`B:${p.b.id}`] ?? p.b,
      })),
    [data.pairs, moved],
  );
  const nameOf = (side: 'A' | 'B') => (side === 'A' ? data.nameA : data.nameB);
  const to = from === 'A' ? 'B' : 'A';

  const show = (k: number) => {
    setCurrent(k);
    selectPairs(aId, bId, [pairs[k].a], [pairs[k].b]);
    findElementById(`assoc-pair-${k}`)?.scrollIntoView({ block: 'nearest' });
  };

  const snap = async (k: number) => {
    const p = pairs[k];
    const [src, dst] = from === 'A' ? [p.a, p.b] : [p.b, p.a];
    const [srcLayer, dstLayer] = from === 'A' ? [aId, bId] : [bId, aId];
    setSnapping(k);
    try {
      const res = await pointsService.snap(srcLayer, dstLayer, [{ id: src.id, targetId: dst.id }]);
      const g = res.groups[0];
      if (!res.count || !g) {
        toast.error(`O ponto ${dst.id} de ${nameOf(to)} não tem coordenada válida.`);
        return;
      }
      const next: ReviewPoint = { id: src.id, x: g.x, y: g.y, lat: g.lat, lng: g.lng };
      setMoved((m) => ({ ...m, [`${from}:${src.id}`]: next }));
      markFixed([pairKey(p)]);
      qc.invalidateQueries({ queryKey: queryKeys.points(srcLayer) });
      setCurrent(k);
      selectPairs(aId, bId, [from === 'A' ? next : p.a], [from === 'B' ? next : p.b]);
      toast.success(`${src.id} movido para a posição de ${dst.id}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSnapping(null);
    }
  };

  return (
    <FloatingPanel
      title={`${data.nameA} ↔ ${data.nameB} — Revisão`}
      icon={<ListChecks className="size-4 text-accent-600" />}
      onClose={() => setPanelOpen(false)}
      defaultClassName="right-3 top-14"
      className="h-[70%] w-[30rem] max-w-[calc(100%-1.5rem)]"
      resizable={{ minWidth: 10 * PX_PER_CM, minHeight: 5 * PX_PER_CM }}
      actions={
        <button
          type="button"
          onClick={() => openDialog('associate', true)}
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
            disabled={!pairs.length || current === 0}
            onClick={() => show(current === null ? 0 : current - 1)}
          >
            Anterior
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!pairs.length || current === pairs.length - 1}
            onClick={() => show(current === null ? 0 : current + 1)}
          >
            Próximo <ChevronRight className="size-3.5" />
          </Button>
          <span className="flex-1" />
          <Button
            size="sm"
            icon={<MousePointerClick className="size-3.5" />}
            disabled={!pairs.length}
            title="Seleciona os dois pontos de todos os pares da lista e enquadra o mapa"
            onClick={() => {
              setCurrent(null);
              selectPairs(
                aId,
                bId,
                pairs.map((p) => p.a),
                pairs.map((p) => p.b),
              );
            }}
          >
            Mostrar todos ({fmtInt(pairs.length)})
          </Button>
        </div>
      }
    >
      <div className="space-y-1 border-b border-slate-100 px-3 py-1.5 text-xs text-slate-500">
        <p>
          {fmtInt(data.total)} pares: {fmtInt(data.far)} distantes, {fmtInt(data.dubious)} dúbios
          {data.total > pairs.length && ` — mostrando os ${fmtInt(pairs.length)} mais suspeitos`}.
          {fixed.size > 0 && ` ${fmtInt(fixed.size)} ajustado(s).`}
        </p>
        <label className="flex flex-wrap items-center gap-1.5">
          <Magnet className="size-3.5 text-slate-400" />
          Ajustar: mover o ponto de
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value as 'A' | 'B')}
            className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-700"
          >
            <option value="A">{data.nameA}</option>
            <option value="B">{data.nameB}</option>
          </select>
          para o ponto associado de {nameOf(to)}
        </label>
      </div>
      {!pairs.length && (
        <p className="px-3 py-6 text-center text-sm text-slate-500">
          Nenhum par distante ou dúbio.
        </p>
      )}
      <ul>
        {pairs.map((p, k) => (
          <PairRow
            key={pairKey(p)}
            id={`assoc-pair-${k}`}
            pair={p}
            active={k === current}
            fixed={fixed.has(pairKey(p))}
            snapping={snapping === k}
            disabled={snapping !== null}
            snapTitle={
              from === 'A'
                ? `Mover ${p.a.id} (${data.nameA}) para a posição de ${p.b.id} (${data.nameB})`
                : `Mover ${p.b.id} (${data.nameB}) para a posição de ${p.a.id} (${data.nameA})`
            }
            onShow={() => show(k)}
            onSnap={() => void snap(k)}
          />
        ))}
      </ul>
    </FloatingPanel>
  );
}

function PairRow({
  id,
  pair: p,
  active,
  fixed,
  snapping,
  disabled,
  snapTitle,
  onShow,
  onSnap,
}: {
  id: string;
  pair: ReviewPair;
  active: boolean;
  fixed: boolean;
  snapping: boolean;
  disabled: boolean;
  snapTitle: string;
  onShow: () => void;
  onSnap: () => void;
}) {
  return (
    <li
      id={id}
      className={clsx(
        'flex items-stretch border-t border-slate-100',
        active ? 'bg-accent-50' : 'hover:bg-slate-50',
      )}
    >
      <button
        type="button"
        onClick={onShow}
        className="min-w-0 flex-1 px-3 py-1.5 text-left text-xs"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-slate-800">
            {p.a.id} ↔ {p.b.id}
          </span>
          <span className="text-slate-500">{num(p.distance)} m</span>
          {p.far && (
            <span className="rounded bg-red-50 px-1 text-[10px] text-red-700">distante</span>
          )}
          {p.dubious && (
            <span
              className="rounded bg-amber-50 px-1 text-[10px] text-amber-800"
              title="Segundo melhor candidato − custo do par"
            >
              dúbio · margem {p.margin === null ? '—' : `${num(p.margin)} m`}
            </span>
          )}
          {fixed && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700">
              <CheckCircle2 className="size-3" /> ajustado
            </span>
          )}
        </span>
        {p.divergent.length > 0 && (
          <span className="block truncate text-slate-500">
            Divergência de {p.divergent.join(', ')}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onSnap}
        disabled={disabled || fixed}
        title={fixed ? 'Já ajustado' : snapTitle}
        aria-label={fixed ? 'Já ajustado' : snapTitle}
        className="shrink-0 px-2.5 text-slate-400 hover:bg-accent-100 hover:text-accent-700 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
      >
        {snapping ? (
          <Loader2 className="size-4 animate-spin" />
        ) : fixed ? (
          <CheckCircle2 className="size-4 text-emerald-600" />
        ) : (
          <Magnet className="size-4" />
        )}
      </button>
    </li>
  );
}
