import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  MonitorPlay,
  MousePointerClick,
  ScanSearch,
  Settings2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePreviewConfig } from '@/hooks/usePreviewConfig';
import { useSourceSchema } from '@/hooks/useSourceData';
import { previewUrl } from '@/lib/listPreview';
import type { DupPair, DupPointRef } from '@/services/duplicates';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { selectDuplicatePoints, useDuplicatesStore } from '@/stores/duplicatesStore';
import { fmtInt } from '@/utils/format';
import { PX_PER_CM } from '@/utils/geo';
import { Button } from '../ui/Button';
import { FloatingPanel } from '../ui/FloatingPanel';
import { PreviewFrame } from './PreviewFrame';
import { PreviewSettings } from './PreviewSettings';

const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
/** Frames de fotos abertos ao mesmo tempo (grupos grandes mostram os primeiros pontos). */
const MAX_FRAMES = 6;

/** Frames lado a lado (o par em análise), os demais em cascata abaixo. */
const framePlacement = (i: number) => ({
  defaultClassName: 'top-3 left-3',
  defaultStyle: {
    marginLeft: `${(i % 2) * 25 + Math.floor(i / 2) * 2}rem`,
    marginTop: `${Math.floor(i / 2) * 2}rem`,
  },
  className: 'h-[22rem] w-[24rem] max-w-[calc(100%-1.5rem)]',
});

interface Group {
  group: number;
  /** Índices em `pairs` */
  rows: number[];
  pointCount: number;
  best: number;
}

/**
 * Lista de Ferramentas › Duplicidades, por grupo (área): um ponto pode ter mais de um candidato.
 * Clicar num par seleciona os dois pontos e centraliza; no grupo, seleciona todos os pontos dele.
 * Com "Fotos", cada ponto em análise abre o seu link num frame, para comparar as fotos.
 */
export function DuplicatesPanel() {
  const result = useDuplicatesStore((s) => s.result);
  if (!result) return null;
  return <Panel key={result.request.layer.sourceId} result={result} />;
}

function Panel({
  result,
}: {
  result: NonNullable<ReturnType<typeof useDuplicatesStore.getState>['result']>;
}) {
  const setPanelOpen = useDuplicatesStore((s) => s.setPanelOpen);
  const openDialog = useAppStore((s) => s.openDialog);
  const [current, setCurrent] = useState<number | null>(null);
  /** Pontos em análise (o par ou o grupo clicado), mostrados nos frames de fotos */
  const [shown, setShown] = useState<DupPointRef[]>([]);
  const [photos, setPhotos] = useState(false);
  const { data, request } = result;
  const { summary } = data;
  const sourceId = request.layer.sourceId;
  const [previewCfg, setPreviewCfg] = usePreviewConfig(sourceId);
  const schema = useSourceSchema(photos ? sourceId : null);
  const columns = useMemo(
    () => (schema.data?.columns ?? []).filter((c) => c.kind !== 'geometry'),
    [schema.data],
  );
  const frameIds = useMemo(
    () => [...new Set(shown.map((p) => p.id))].slice(0, MAX_FRAMES),
    [shown],
  );
  const records = useQuery({
    queryKey: ['points', sourceId, 'dup-records', frameIds],
    queryFn: () => pointsService.records(sourceId, frameIds, true),
    enabled: photos && frameIds.length > 0,
    staleTime: 30_000,
  });
  const byId = useMemo(() => new Map((records.data ?? []).map((r) => [r.id, r])), [records.data]);
  const pairs = data.pairs;
  const groups = useMemo(() => {
    const out: Group[] = [];
    pairs.forEach((p, k) => {
      let g = out[out.length - 1];
      if (!g || g.group !== p.group) {
        g = { group: p.group, rows: [], pointCount: 0, best: p.score };
        out.push(g);
      }
      g.rows.push(k);
      if (!p.belowMin) g.best = Math.max(g.best, p.score);
    });
    for (const g of out) {
      g.pointCount = new Set(g.rows.flatMap((k) => [pairs[k].a.id, pairs[k].b.id])).size;
    }
    return out;
  }, [pairs]);

  const show = (k: number) => {
    setCurrent(k);
    setShown([pairs[k].a, pairs[k].b]);
    selectDuplicatePoints(sourceId, [pairs[k].a, pairs[k].b]);
    document.getElementById(`dup-pair-${k}`)?.scrollIntoView({ block: 'nearest' });
  };
  const showGroup = (g: Group) => {
    setCurrent(null);
    const points = g.rows.flatMap((k) => [pairs[k].a, pairs[k].b]);
    setShown(points);
    selectDuplicatePoints(sourceId, points);
  };

  const frames = !photos
    ? null
    : frameIds.length
      ? frameIds.map((id, i) => {
          const rec = byId.get(id);
          const link = rec ? previewUrl(previewCfg, rec.data) : null;
          return (
            <PreviewFrame
              key={i}
              index={i}
              placement={framePlacement(i)}
              title={`Fotos · ${id}${frameIds.length > 1 ? ` (${i + 1}/${frameIds.length})` : ''}`}
              url={link && 'url' in link ? link.url : null}
              message={
                records.isError
                  ? 'Erro ao carregar o ponto.'
                  : !link
                    ? 'Carregando…'
                    : 'error' in link
                      ? link.error
                      : ''
              }
              onClose={() => setPhotos(false)}
            />
          );
        })
      : [
          <PreviewFrame
            key={0}
            index={0}
            placement={framePlacement(0)}
            title="Fotos"
            url={null}
            message="Clique num par ou num grupo da lista para ver as fotos de cada ponto."
            onClose={() => setPhotos(false)}
          />,
        ];

  return (
    <>
      {frames}
      <FloatingPanel
        title={`${summary.name} — Duplicidades`}
        icon={<ScanSearch className="size-4 text-accent-600" />}
        onClose={() => setPanelOpen(false)}
        defaultClassName="right-3 top-14"
        className="h-[70%] w-[32rem] max-w-[calc(100%-1.5rem)]"
        resizable={{ minWidth: 10 * PX_PER_CM, minHeight: 5 * PX_PER_CM }}
        actions={
          <>
            <button
              type="button"
              onClick={() => setPhotos((v) => !v)}
              className={clsx(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
                photos
                  ? 'bg-accent-100 text-accent-800 hover:bg-accent-200'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
              title={
                photos
                  ? 'Fechar os frames de fotos'
                  : 'Abrir o link (fotos) de cada ponto em análise num frame'
              }
              aria-pressed={photos}
            >
              <MonitorPlay className="size-3.5" /> Fotos
            </button>
            <button
              type="button"
              onClick={() => openDialog('duplicates', true)}
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
              disabled={!data.points.length}
              onClick={() => {
                setCurrent(null);
                selectDuplicatePoints(sourceId, data.points);
              }}
            >
              Selecionar suspeitos ({fmtInt(data.points.length)})
            </Button>
          </div>
        }
      >
        <p className="border-b border-slate-100 px-3 py-1.5 text-xs text-slate-500">
          {fmtInt(summary.pairs)} pares suspeitos em {fmtInt(summary.groups)} grupos
          {summary.nearbyPairs > 0 &&
            ` + ${fmtInt(summary.nearbyPairs)} outros candidatos abaixo da mínima`}
          {summary.pairs + summary.nearbyPairs > pairs.length &&
            ` — mostrando os ${fmtInt(groups.length)} grupos mais suspeitos (baixe o arquivo para ver todos)`}
          . Um ponto pode ter mais de um candidato: veja o grupo todo.
        </p>
        {photos && (
          <div className="space-y-1 border-b border-slate-100 px-3 py-2">
            <p className="text-xs text-slate-600">
              Fotos: um frame por ponto do par (ou do grupo, até {MAX_FRAMES}) em análise.
            </p>
            <PreviewSettings
              name="dup-preview-mode"
              columns={columns}
              cfg={previewCfg}
              onChange={setPreviewCfg}
            />
          </div>
        )}
        {!pairs.length && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">Nenhum par suspeito.</p>
        )}
        {groups.map((g) => (
          <section key={g.group} className="border-b border-slate-200">
            <button
              type="button"
              onClick={() => showGroup(g)}
              title="Selecionar todos os pontos do grupo"
              className="sticky top-0 z-[1] flex w-full items-baseline gap-2 bg-slate-50 px-3 py-1 text-left text-xs hover:bg-slate-100"
            >
              <span className="font-mono font-semibold text-slate-700">G{g.group}</span>
              <span className="text-slate-600">
                {fmtInt(g.pointCount)} pontos · {fmtInt(g.rows.length)} pares
              </span>
              <span className="ml-auto text-slate-500">maior pontuação {num(g.best)}</span>
            </button>
            <ul>
              {g.rows.map((k) => (
                <PairRow
                  key={k}
                  id={`dup-pair-${k}`}
                  pair={pairs[k]}
                  active={k === current}
                  refName={summary.referenceName}
                  onShow={() => show(k)}
                />
              ))}
            </ul>
          </section>
        ))}
      </FloatingPanel>
    </>
  );
}

function PairRow({
  id,
  pair: p,
  active,
  refName,
  onShow,
}: {
  id: string;
  pair: DupPair;
  active: boolean;
  refName: string | null;
  onShow: () => void;
}) {
  const refText = (v: unknown) =>
    v === null || v === undefined ? 'sem associação' : `${refName} ${String(v)}`;
  return (
    <li id={id}>
      <button
        type="button"
        onClick={onShow}
        className={clsx(
          'block w-full border-t border-slate-100 px-3 py-1.5 text-left text-xs',
          active ? 'bg-accent-50' : 'hover:bg-slate-50',
          p.belowMin && !active && 'opacity-60',
        )}
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-slate-800">
            {p.a.id} ↔ {p.b.id}
          </span>
          <span className="text-slate-500">
            {p.sameCoord ? 'mesma coordenada' : `${num(p.distance)} m`}
          </span>
          {p.belowMin && (
            <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">
              abaixo da mínima
            </span>
          )}
          <span className="ml-auto font-semibold text-slate-700 tabular-nums">
            {num(p.score)} pts
          </span>
        </span>
        <span className="block text-slate-500">{p.reasons || 'sem regras atendidas'}</span>
        {refName && (
          <span className="block text-slate-400">
            {refText(p.a.ref)} · {refText(p.b.ref)}
          </span>
        )}
      </button>
    </li>
  );
}
