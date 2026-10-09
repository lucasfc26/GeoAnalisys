import { useQueries } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { prepareFull, prepareViewport, type PreparedLayer } from '@/components/map/pointsOverlay';
import { layerCache } from '@/lib/layerCache';
import { effectiveFilters, resolveLayer } from '@/lib/layers';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import type {
  Bounds,
  DataSource,
  FilterDef,
  LayerPayloadFull,
  LayerPayloadTooLarge,
  LayerStyle,
  MapPointsResponse,
} from '@/types';
import { useSources } from './useSourceData';

interface LayerParams {
  sourceId: string;
  styleColumn: string | null;
  label: string;
  filters: FilterDef[];
}

/** Combinações já validadas nesta sessão: recargas seguintes (após edições) vão direto ao servidor. */
const loadedThisSession = new Set<string>();

async function fetchLayer(p: LayerParams, signal: AbortSignal): Promise<LayerPayloadFull | LayerPayloadTooLarge> {
  const key = JSON.stringify([p.sourceId, p.styleColumn, p.label, p.filters]);
  const cached = loadedThisSession.has(key) ? undefined : await layerCache.get(key);
  const opts = { filters: p.filters, styleColumn: p.styleColumn, label: p.label };
  let res = await pointsService.layer(p.sourceId, { ...opts, version: cached?.version }, signal);
  if (res.mode === 'unchanged' && cached) {
    loadedThisSession.add(key);
    return cached.payload;
  }
  if (res.mode === 'unchanged') res = await pointsService.layer(p.sourceId, opts, signal);
  if (res.mode === 'unchanged') throw new Error('Resposta inesperada do servidor ao carregar a camada');
  loadedThisSession.add(key);
  if (res.mode === 'full' && res.version) void layerCache.set(key, p.sourceId, res.version, res);
  return res;
}

const preparedCache = new WeakMap<object, PreparedLayer>();

function prepared(payload: LayerPayloadFull | MapPointsResponse, categorized: boolean): PreparedLayer {
  let p = preparedCache.get(payload);
  if (!p) {
    p = 'ids' in payload ? prepareFull(payload) : prepareViewport(payload, categorized);
    preparedCache.set(payload, p);
  }
  return p;
}

export interface LayerRuntime {
  layer: LayerStyle;
  source: DataSource | undefined;
  styleColumn: string | null;
  label: string;
  filters: FilterDef[];
  /** Filtros + categorias ocultas (usados na seleção por clique/região) */
  selectionFilters: FilterDef[];
  prepared: PreparedLayer | null;
  /** full = camada inteira em cache; viewport = tabela grande, carregada por região */
  mode: 'full' | 'viewport' | null;
  viewport: MapPointsResponse | undefined;
  /** Total de registros da camada (no modo viewport, total da tabela/filtro) */
  total: number | null;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

/** Dados de todas as camadas do mapa. */
export function useLayersData(bounds: Bounds | null): LayerRuntime[] {
  const layers = useAppStore((s) => s.layers);
  const sourceId = useAppStore((s) => s.sourceId);
  const filters = useAppStore((s) => s.filters);
  const layerFilters = useAppStore((s) => s.layerFilters);
  const sources = useSources();

  const params = useMemo(
    () =>
      layers.map((layer) => {
        const source = sources.data?.find((s) => s.id === layer.sourceId);
        const { styleColumn, label } = resolveLayer(layer, source);
        const f = layer.sourceId === sourceId ? filters : (layerFilters[layer.sourceId] ?? []);
        return { layer, source, styleColumn, label, filters: f };
      }),
    [layers, sources.data, sourceId, filters, layerFilters],
  );

  const full = useQueries({
    queries: params.map((p) => ({
      queryKey: ['points', p.layer.sourceId, 'layer', p.styleColumn, p.label, p.filters] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchLayer({ sourceId: p.layer.sourceId, styleColumn: p.styleColumn, label: p.label, filters: p.filters }, signal),
      enabled: p.layer.visible && !!p.source,
      staleTime: Infinity,
      gcTime: 30 * 60_000,
    })),
  });

  const viewport = useQueries({
    queries: params.map((p, i) => ({
      queryKey: ['points', p.layer.sourceId, 'bbox', bounds, p.filters, p.styleColumn, p.label] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        pointsService.bbox(p.layer.sourceId, bounds!, p.filters, signal, {
          styleColumn: p.styleColumn ?? undefined,
          label: p.label || undefined,
        }),
      enabled: p.layer.visible && !!bounds && full[i].data?.mode === 'tooLarge',
      staleTime: 30_000,
    })),
  });

  // Mantém o último desenho válido enquanto uma nova combinação (estilo/rótulo/filtro) carrega.
  const lastGood = useRef(new Map<string, PreparedLayer>());

  return params.map((p, i) => {
    const fq = full[i];
    const vq = viewport[i];
    const id = p.layer.sourceId;
    let prep: PreparedLayer | null = null;
    let mode: LayerRuntime['mode'] = null;
    let total: number | null = null;
    if (fq.data?.mode === 'full') {
      prep = prepared(fq.data, !!p.styleColumn);
      mode = 'full';
      total = fq.data.total;
    } else if (fq.data?.mode === 'tooLarge') {
      mode = 'viewport';
      total = fq.data.total;
      if (vq.data) prep = prepared(vq.data, !!p.styleColumn);
    }
    if (prep) lastGood.current.set(id, prep);
    else if (fq.isFetching || vq.isFetching) prep = lastGood.current.get(id) ?? null;

    return {
      ...p,
      selectionFilters: effectiveFilters(p.filters, p.layer, p.styleColumn, mode === 'full' ? prep?.cats : null),
      prepared: prep,
      mode,
      viewport: vq.data,
      total,
      isFetching: fq.isFetching || vq.isFetching,
      error: fq.error ?? vq.error,
      refetch: () => {
        void fq.refetch();
        if (mode === 'viewport') void vq.refetch();
      },
    };
  });
}
