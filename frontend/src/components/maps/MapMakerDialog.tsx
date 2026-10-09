import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, FileCode, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BOUNDARY_ACCEPT, useImportBoundaries } from '@/hooks/useImportBoundaries';
import { useSourceSchema, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { boundaryStore } from '@/lib/boundaries';
import {
  ALL,
  MAP_PROPERTIES,
  boundaryData,
  boundaryNameFields,
  boundaryValues,
  buildMapFiles,
  defaultMapLabel,
  hasNoAttributes,
  mapFileNames,
  pointsInside,
  toMapPoints,
  type MapKind,
} from '@/lib/mapMaker';
import { LAT_KEY, fetchGeoJson, triggerDownload } from '@/services/export';
import { useAppStore } from '@/stores/appStore';
import type { SourceSchema } from '@/types';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, RadioCard, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

const SETTINGS_KEY = 'geoanalisys-mapmaker';

interface Settings {
  kind: MapKind;
  boundaryId: string;
  field: string;
  value: string;
  /** Nome nos arquivos; null = o nome do limite escolhido */
  label: string | null;
  atualId: string;
  anteriorId: string;
  useFilters: boolean;
  token: string;
}

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}

type PropColumns = Partial<Record<(typeof MAP_PROPERTIES)[number], string>>;

/** Liga nome_cidade, medicao… às colunas da tabela (sem diferenciar maiúsculas). */
function propColumns(schema: SourceSchema | undefined): { cols: PropColumns; missing: string[] } {
  const cols: PropColumns = {};
  const missing: string[] = [];
  for (const p of MAP_PROPERTIES) {
    const c = schema?.columns.find((x) => x.name.toLowerCase() === p);
    if (c) cols[p] = c.name;
    else missing.push(p);
  }
  return { cols, missing };
}

interface Result {
  name: string;
  url: string;
  html: string;
  points: number;
  bytes: number;
}

const fmtSize = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;

/**
 * Escreve o HTML num iframe about:blank em vez de usar a URL blob: o Mapbox GL 0.52 monta o
 * referrer com origin + pathname, que numa URL blob: vira um endereço inválido e o mapa não abre.
 */
function MapPreview({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);
  return (
    <iframe
      ref={ref}
      title={title}
      className="h-[28rem] w-full rounded-md border border-slate-200"
    />
  );
}

export default function MapMakerDialog() {
  const closeDialog = useAppStore((s) => s.closeDialog);
  const boundaries = useAppStore((s) => s.boundaries);
  const activeId = useAppStore((s) => s.sourceId);
  const sources = useSources();
  const { importFiles, loading: importing } = useImportBoundaries();
  const fileRef = useRef<HTMLInputElement>(null);

  const [s, setS] = useState<Settings>(() => {
    const saved = loadSettings();
    return {
      kind: saved.kind ?? 'comite',
      boundaryId: saved.boundaryId ?? '',
      field: saved.field ?? '',
      value: saved.value ?? ALL,
      // Nome digitado vale só para esta abertura: ao reabrir, volta a seguir o limite escolhido.
      label: null,
      atualId: saved.atualId ?? activeId ?? '',
      anteriorId: saved.anteriorId ?? '',
      useFilters: saved.useFilters ?? false,
      token: saved.token || import.meta.env.VITE_MAPBOX_TOKEN || '',
    };
  });
  const patch = (p: Partial<Settings>) => setS((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* sem localStorage: as escolhas valem só agora */
    }
  }, [s]);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const resultsRef = useRef<Result[]>([]);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);
  useEffect(() => () => resultsRef.current.forEach((r) => URL.revokeObjectURL(r.url)), []);

  const boundary = boundaries.find((b) => b.id === s.boundaryId) ?? boundaries[0];
  const geo = useQuery({
    queryKey: ['boundary-geo', boundary?.id],
    queryFn: async () => (await boundaryStore.get(boundary!.id)) ?? null,
    enabled: !!boundary,
    staleTime: Infinity,
  });
  const fields = useMemo(() => (geo.data ? boundaryNameFields(geo.data) : []), [geo.data]);
  const field = fields.includes(s.field) ? s.field : (fields[0] ?? '');
  const values = useMemo(
    () => (geo.data && field ? boundaryValues(geo.data, field) : []),
    [geo.data, field],
  );
  const value = s.value === ALL || values.includes(s.value) ? s.value : ALL;
  const label = s.label ?? defaultMapLabel(boundary?.name, value);

  const list = sources.data ?? [];
  const atual = list.find((x) => x.id === s.atualId) ?? list.find((x) => x.id === activeId) ?? list[0];
  const anterior =
    list.find((x) => x.id === s.anteriorId) ??
    list.find((x) => x.id !== atual?.id && /anterior/i.test(`${x.name} ${x.tableName}`));
  const isComite = s.kind === 'comite';
  const schemaAtual = useSourceSchema(atual?.id ?? null);
  const schemaAnterior = useSourceSchema(isComite ? (anterior?.id ?? null) : null);
  const colsAtual = useMemo(() => propColumns(schemaAtual.data), [schemaAtual.data]);
  const colsAnterior = useMemo(() => propColumns(schemaAnterior.data), [schemaAnterior.data]);

  const names = mapFileNames(s.kind, label);
  const ready =
    !!geo.data &&
    !!atual &&
    (!isComite || !!anterior) &&
    !!s.token.trim() &&
    !!label.trim() &&
    !schemaAtual.isLoading &&
    !schemaAnterior.isLoading;

  const loadPoints = async (sourceId: string, cols: PropColumns) => {
    const st = useAppStore.getState();
    const filters = s.useFilters
      ? sourceId === st.sourceId
        ? st.filters
        : (st.layerFilters[sourceId] ?? [])
      : [];
    const columns = Object.values(cols);
    const fc = await fetchGeoJson({
      sourceId,
      scope: filters.length ? 'filtered' : 'all',
      filters,
      columns: columns.length ? columns : [LAT_KEY],
    });
    return toMapPoints(fc.features, cols);
  };

  const generate = async () => {
    if (!geo.data || !atual || !boundary) return;
    setBusy(true);
    results.forEach((r) => URL.revokeObjectURL(r.url));
    setResults([]);
    try {
      const limite = boundaryData(geo.data, field, value);
      // Região escolhida: só os pontos dentro dela. "Todos": todos os pontos da tabela.
      const clip = (fc: Awaited<ReturnType<typeof loadPoints>>) =>
        value === ALL ? fc : pointsInside(fc, limite);
      setStep(`Lendo ${atual.name}…`);
      const pontos = clip(await loadPoints(atual.id, colsAtual.cols));
      let pontosAnterior;
      if (isComite && anterior) {
        setStep(`Lendo ${anterior.name}…`);
        pontosAnterior = clip(await loadPoints(anterior.id, colsAnterior.cols));
      }
      setStep('Montando os mapas…');
      const b = boundary.bounds;
      const files = buildMapFiles({
        kind: s.kind,
        label,
        limite,
        atual: pontos,
        anterior: pontosAnterior,
        token: s.token.trim(),
        fallbackCenter: b ? [(b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2] : [-38.5, -3.73],
      });
      const out = files.map((f) => {
        const blob = new Blob([f.html], { type: 'text/html;charset=utf-8' });
        return {
          name: f.name,
          url: URL.createObjectURL(blob),
          html: f.html,
          points: f.points,
          bytes: blob.size,
        };
      });
      out.forEach((f) => triggerDownload(f.url, f.name));
      setResults(out);
      setPreviewIndex(0);
      toast.success(`${out.length} mapa(s) gerado(s).`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  const onImport = async (files: FileList | null) => {
    const added = await importFiles(files);
    if (fileRef.current) fileRef.current.value = '';
    if (added.length) patch({ boundaryId: added[0].id, field: '', value: ALL, label: null });
  };

  const missingWarning = (name: string | undefined, missing: string[]) =>
    name && missing.length > 0 ? (
      <p className="mt-1 text-xs text-amber-700">
        {name} não tem: {missing.join(', ')}
        {missing.includes('medicao') && isComite
          ? ' — o mapa de estimados (medição = NAO) ficará sem pontos.'
          : '.'}
      </p>
    ) : null;

  const current = results[previewIndex];

  return (
    <Dialog
      open
      size="xl"
      title="Criar mapa"
      description="Mapa HTML (Mapbox) com o limite e os pontos do censo, como nos notebooks do comitê."
      onClose={() => closeDialog('mapMaker')}
      footer={
        <>
          {step && <span className="mr-auto text-xs text-slate-500">{step}</span>}
          <Button onClick={() => closeDialog('mapMaker')}>Fechar</Button>
          <Button
            variant="primary"
            icon={<FileCode className="size-4" />}
            loading={busy}
            disabled={!ready}
            onClick={() => void generate()}
          >
            Gerar e baixar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <RadioCard checked={isComite} onChange={() => patch({ kind: 'comite' })}>
            <span>
              <span className="font-medium">Comitê</span>
              <span className="block text-xs text-slate-500">
                Censo atual (azul) × anterior (vermelho), mais o mapa só dos estimados
              </span>
            </span>
          </RadioCard>
          <RadioCard checked={!isComite} onChange={() => patch({ kind: 'status18' })}>
            <span>
              <span className="font-medium">Status 18</span>
              <span className="block text-xs text-slate-500">
                Só o censo atual, com a data do fim do mês anterior no nome
              </span>
            </span>
          </RadioCard>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="mm-boundary" hint="importado em Camadas › Limites">
              Limite
            </Label>
            <div className="flex gap-2">
              <Select
                id="mm-boundary"
                className="min-w-0 flex-1"
                value={boundary?.id ?? ''}
                onChange={(e) =>
                  patch({ boundaryId: e.target.value, field: '', value: ALL, label: null })
                }
                disabled={!boundaries.length}
              >
                {!boundaries.length && <option value="">Nenhum limite importado</option>}
                {boundaries.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({fmtInt(b.features)})
                  </option>
                ))}
              </Select>
              <Button
                icon={<Upload className="size-4" />}
                loading={importing}
                onClick={() => fileRef.current?.click()}
                title="Importar shapefile (.zip ou .shp + .dbf + .prj), GeoJSON ou KML"
              >
                Importar
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept={BOUNDARY_ACCEPT}
                multiple
                hidden
                onChange={(e) => void onImport(e.target.files)}
              />
            </div>
            {boundary && geo.data === null && (
              <p className="mt-1 text-xs text-red-600">
                A geometria deste limite não está salva no navegador. Importe o arquivo de novo.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="mm-field" hint="atributo com o nome de cada região">
              Campo do nome
            </Label>
            <Select
              id="mm-field"
              value={field}
              onChange={(e) => patch({ field: e.target.value, value: ALL, label: null })}
              disabled={!fields.length}
            >
              {fields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            {geo.data && hasNoAttributes(geo.data) && (
              <p className="mt-1 text-xs text-amber-700">
                Este limite foi importado sem atributos (o .dbf não veio junto do .shp). Importe de
                novo com o .shp e o .dbf juntos, ou o .zip do shapefile.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="mm-value" hint="só os pontos dentro dela entram no mapa">
              Região
            </Label>
            <Select
              id="mm-value"
              value={value}
              onChange={(e) => patch({ value: e.target.value, label: null })}
              disabled={!geo.data || !field}
            >
              <option value={ALL}>{ALL}</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="mm-label" hint="ex.: Fortaleza SR 12">
              Nome nos arquivos
            </Label>
            <Input
              id="mm-label"
              value={label}
              onChange={(e) => patch({ label: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="mm-atual" hint="pontos em azul">
              Censo atual
            </Label>
            <Select
              id="mm-atual"
              value={atual?.id ?? ''}
              onChange={(e) => patch({ atualId: e.target.value })}
              disabled={!list.length}
            >
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            {missingWarning(atual?.name, colsAtual.missing)}
          </div>
          <div className={clsx(!isComite && 'opacity-50')}>
            <Label htmlFor="mm-anterior" hint="pontos em vermelho">
              Censo anterior
            </Label>
            <Select
              id="mm-anterior"
              value={anterior?.id ?? ''}
              onChange={(e) => patch({ anteriorId: e.target.value })}
              disabled={!isComite || !list.length}
            >
              {!anterior && <option value="">Escolha a tabela…</option>}
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            {isComite && missingWarning(anterior?.name, colsAnterior.missing)}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={s.useFilters}
            onChange={(e) => patch({ useFilters: e.target.checked })}
            className="accent-accent-600"
          />
          Aplicar os filtros salvos de cada camada (senão, usa todos os registros)
        </label>

        <div>
          <Label htmlFor="mm-token" hint="usado pelo HTML para carregar o mapa de fundo">
            Token do Mapbox
          </Label>
          <Input
            id="mm-token"
            value={s.token}
            placeholder="pk.…"
            onChange={(e) => patch({ token: e.target.value })}
          />
        </div>

        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Arquivos:</span>{' '}
          {names.map((n, i) => (
            <span key={n}>
              {i > 0 && ' · '}
              {n}
            </span>
          ))}
        </div>

        {results.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {results.map((r, i) => (
                <div
                  key={r.url}
                  className={clsx(
                    'flex items-center gap-1 rounded-md border pl-2 text-xs',
                    i === previewIndex ? 'border-accent-500 bg-accent-50' : 'border-slate-200',
                  )}
                >
                  <button type="button" className="py-1 text-left" onClick={() => setPreviewIndex(i)}>
                    <span className="font-medium text-slate-800">{r.name}</span>{' '}
                    <span className="text-slate-500">
                      · {fmtInt(r.points)} pontos · {fmtSize(r.bytes)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                    onClick={() => triggerDownload(r.url, r.name)}
                    title="Baixar de novo"
                    aria-label={`Baixar ${r.name}`}
                  >
                    <Download className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {current && <MapPreview key={current.url} html={current.html} title={current.name} />}
          </div>
        )}
      </div>
    </Dialog>
  );
}
