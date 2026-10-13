import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, Loader2, MapPinOff, MousePointerClick, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BOUNDARY_ACCEPT, useImportBoundaries } from '@/hooks/useImportBoundaries';
import { useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { boundaryPolygons, boundaryStore, featureLabels } from '@/lib/boundaries';
import { csvBlob, selectPoints } from '@/lib/selectPoints';
import { analysisService, type OutsideRequest, type OutsideResult } from '@/services/analysis';
import { triggerDownload } from '@/services/export';
import { useAppStore } from '@/stores/appStore';
import type { FilterDef } from '@/types';
import { fmtInt } from '@/utils/format';
import { fmtDistance } from '@/utils/geo';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

const SETTINGS_KEY = 'geoanalisys-outside-boundary';
const MAX_TOLERANCE = 1_000_000;
/** Pontos mostrados no diálogo (todos vão para a seleção e o CSV) */
const PREVIEW = 15;

interface Settings {
  layerId: string;
  boundaryId: string;
  /** Feição do limite (índice); null = todas */
  feature: number | null;
  tolerance: string;
  useFilters: boolean;
}

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}

/** Ferramentas › Fora do limite: pontos da camada fora dos polígonos de um limite importado. */
export default function OutsideBoundaryDialog() {
  const closeDialog = useAppStore((st) => st.closeDialog);
  const activeId = useAppStore((st) => st.sourceId);
  const boundaries = useAppStore((st) => st.boundaries);
  const updateBoundary = useAppStore((st) => st.updateBoundary);
  const sources = useSources();
  const list = useMemo(() => sources.data ?? [], [sources.data]);
  const { importFiles, loading: importing } = useImportBoundaries();
  const fileRef = useRef<HTMLInputElement>(null);

  const [s, setS] = useState<Settings>(() => ({
    layerId: '',
    boundaryId: '',
    feature: null,
    tolerance: '0',
    useFilters: false,
    ...loadSettings(),
  }));
  const patch = (p: Partial<Settings>) => setS((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* só nesta sessão */
    }
  }, [s]);

  const layer =
    list.find((x) => x.id === s.layerId) ??
    list.find((x) => x.id === activeId) ??
    list.find((x) => /atual/i.test(`${x.name} ${x.tableName}`)) ??
    list[0];
  const boundary = boundaries.find((b) => b.id === s.boundaryId) ?? boundaries[0];
  const geo = useQuery({
    queryKey: ['boundary-geometry', boundary?.id],
    queryFn: async () => (await boundaryStore.get(boundary!.id)) ?? null,
    enabled: !!boundary,
    staleTime: Infinity,
  });
  const labels = useMemo(() => (geo.data ? featureLabels(geo.data) : []), [geo.data]);
  const featureOptions = useMemo(
    () =>
      labels
        .map((label, i) => ({ label, i }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true })),
    [labels],
  );
  const feature = s.feature !== null && s.feature < labels.length ? s.feature : null;
  const polygons = useMemo(
    () => (geo.data ? boundaryPolygons(geo.data, feature) : []),
    [geo.data, feature],
  );

  const tolerance = Number(s.tolerance.replace(',', '.'));
  const toleranceOk = s.tolerance.trim() !== '' && tolerance >= 0 && tolerance <= MAX_TOLERANCE;

  const filtersOf = (sourceId: string): FilterDef[] => {
    if (!s.useFilters) return [];
    const st = useAppStore.getState();
    return sourceId === st.sourceId ? st.filters : (st.layerFilters[sourceId] ?? []);
  };
  const boundaryName =
    boundary && feature !== null ? `${boundary.name} › ${labels[feature]}` : (boundary?.name ?? '');
  const request: OutsideRequest | null =
    layer && boundary && polygons.length && toleranceOk
      ? {
          layer: { sourceId: layer.id, filters: filtersOf(layer.id) },
          boundaryName,
          polygons,
          tolerance,
        }
      : null;

  const [result, setResult] = useState<{ request: OutsideRequest; data: OutsideResult } | null>(
    null,
  );
  const run = useMutation({
    mutationFn: (req: OutsideRequest) => analysisService.outside(req),
    onSuccess: (data, req) => setResult({ request: req, data }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const close = () => closeDialog('outsideBoundary');
  const summary = result?.data.summary;

  const select = () => {
    if (!result) return;
    if (boundary && !boundary.visible) updateBoundary(boundary.id, { visible: true });
    selectPoints(result.request.layer.sourceId, result.data.points);
    toast.success(`${fmtInt(result.data.points.length)} ponto(s) fora do limite selecionado(s).`);
    close();
  };
  const downloadCsv = () => {
    if (!result) return;
    const blob = csvBlob(
      ['ID', 'Distância até o limite (m)', 'Latitude', 'Longitude'],
      result.data.points.map((p) => [p.id, p.distance, p.lat, p.lng]),
    );
    const href = URL.createObjectURL(blob);
    const name = `fora_do_limite_${result.data.summary.name}`.replace(/[^\w.-]+/g, '_');
    triggerDownload(href, `${name}.csv`);
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };

  return (
    <Dialog
      open
      size="lg"
      title="Fora do limite"
      description="Pontos da camada fora dos polígonos de um limite (shapefile, GeoJSON ou KML importado em Camadas › Limites), com a distância até a borda."
      onClose={close}
      footer={
        <>
          <Button className="mr-auto" onClick={close}>
            Fechar
          </Button>
          <Button
            variant="primary"
            icon={<MapPinOff className="size-4" />}
            loading={run.isPending}
            disabled={!request}
            onClick={() => request && run.mutate(request)}
          >
            Buscar pontos fora
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="out-layer">Camada analisada</Label>
          <Select
            id="out-layer"
            value={layer?.id ?? ''}
            onChange={(e) => patch({ layerId: e.target.value })}
            disabled={!list.length}
          >
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="out-boundary">Limite</Label>
          <div className="flex gap-2">
            <Select
              id="out-boundary"
              className="min-w-0 flex-1"
              value={boundary?.id ?? ''}
              onChange={(e) => patch({ boundaryId: e.target.value, feature: null })}
              disabled={!boundaries.length}
            >
              {!boundaries.length && <option value="">Nenhum limite importado</option>}
              {boundaries.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({fmtInt(b.features)} feição{b.features === 1 ? '' : 'ões'})
                </option>
              ))}
            </Select>
            <Button
              icon={<Upload className="size-4" />}
              loading={importing}
              onClick={() => fileRef.current?.click()}
              title="Shapefile (.zip, ou .shp + .dbf + .prj juntos), GeoJSON ou KML"
            >
              Importar limite
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept={BOUNDARY_ACCEPT}
              multiple
              hidden
              onChange={async (e) => {
                await importFiles(e.target.files);
                if (fileRef.current) fileRef.current.value = '';
              }}
            />
          </div>
          {boundary && geo.isLoading && (
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
              <Loader2 className="size-3 animate-spin" /> Lendo o limite…
            </p>
          )}
          {boundary && geo.isSuccess && !geo.data && (
            <p className="mt-1 text-xs text-red-600">
              A geometria deste limite não está mais salva neste computador: importe o arquivo de
              novo.
            </p>
          )}
          {geo.data && !polygons.length && (
            <p className="mt-1 text-xs text-red-600">
              {feature === null ? 'O limite' : 'A feição'} não tem polígonos (só linhas ou pontos).
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div>
            <Label htmlFor="out-feature" hint="ex.: só um município do arquivo">
              Feições do limite
            </Label>
            <Select
              id="out-feature"
              value={feature === null ? '' : String(feature)}
              onChange={(e) =>
                patch({ feature: e.target.value === '' ? null : Number(e.target.value) })
              }
              disabled={labels.length < 2}
            >
              <option value="">Todas ({fmtInt(labels.length)})</option>
              {labels.length > 1 &&
                featureOptions.map((o) => (
                  <option key={o.i} value={o.i}>
                    {o.label}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="out-tol" hint="m">
              Tolerância
            </Label>
            <Input
              id="out-tol"
              type="number"
              min={0}
              step="any"
              value={s.tolerance}
              onChange={(e) => patch({ tolerance: e.target.value })}
            />
            {!toleranceOk && <p className="mt-1 text-xs text-red-600">Número ≥ 0.</p>}
          </div>
        </div>
        <p className="-mt-2 text-xs text-slate-500">
          Pontos fora, mas a até a tolerância da borda, não contam (ex.: erro de GPS em pontos na
          divisa).
        </p>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={s.useFilters}
            onChange={(e) => patch({ useFilters: e.target.checked })}
            className="accent-accent-600"
          />
          Aplicar os filtros salvos da camada (senão, usa todos os registros)
        </label>

        {result && summary && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>
                <span className="font-semibold text-slate-800">{fmtInt(summary.outside)}</span> fora
                de {summary.boundaryName}
              </span>
              <span>{fmtInt(summary.inside)} dentro</span>
              {summary.withinTolerance > 0 && (
                <span>{fmtInt(summary.withinTolerance)} fora, mas dentro da tolerância</span>
              )}
              <span>
                {fmtInt(summary.total)} pontos em {summary.name}
              </span>
              {summary.withoutCoords > 0 && (
                <span className="text-amber-700">
                  {fmtInt(summary.withoutCoords)} sem coordenadas
                </span>
              )}
              {summary.truncated && (
                <span className="text-amber-700">
                  mostrando os {fmtInt(result.data.points.length)} mais distantes
                </span>
              )}
            </div>
            {result.data.points.length > 0 && (
              <>
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 font-medium">ID</th>
                      <th className="py-1 text-right font-medium">Distância até o limite</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {result.data.points.slice(0, PREVIEW).map((p) => (
                      <tr key={p.id}>
                        <td className="py-1 font-mono">{p.id}</td>
                        <td className="py-1 text-right tabular-nums">{fmtDistance(p.distance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.data.points.length > PREVIEW && (
                  <p className="text-xs text-slate-500">
                    … e mais {fmtInt(result.data.points.length - PREVIEW)} (do mais distante para o
                    mais próximo).
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<MousePointerClick className="size-3.5" />}
                    onClick={select}
                  >
                    Selecionar os {fmtInt(result.data.points.length)} pontos no mapa
                  </Button>
                  <Button size="sm" icon={<FileText className="size-3.5" />} onClick={downloadCsv}>
                    Baixar CSV
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
