import { Map as MaplibreMap, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// O MapLibre procura o worker ao lado do próprio código (que o build junta em outro arquivo):
// o Vite empacota o worker (com as dependências) e informa o endereço final.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { roundBounds, useActiveSource } from '@/hooks/useSourceData';
import { useDebounce } from '@/hooks/useDebounce';
import { useLayersData, type LayerRuntime } from '@/hooks/useLayers';
import { errorMessage } from '@/lib/api';
import { isAdditive, useMap, useSetMap } from '@/lib/mapContext';
import { setProjectViewGetter } from '@/lib/project';
import { pointsService } from '@/services/points';
import { crsService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import type { Bounds, LatLng, MapCluster } from '@/types';
import { fmtInt, fmtValue } from '@/utils/format';
import { LayersPanel } from '../layers/LayersPanel';
import { ErrorState } from '../ui/States';
import { toast } from '../ui/Toaster';
import { BasemapControl, BoundariesLayer } from './BaseLayers';
import { DrawingController } from './DrawingController';
import { ListModePanel } from './ListModePanel';
import { MeasureController } from './MeasureController';
import { SelectByValuePanel } from './SelectByValuePanel';
import { TransformController } from './TransformController';
import {
  createPointsOverlay,
  groupInfo,
  lodFraction,
  metersPerCm,
  worldScaleOf,
  type Hit,
  type PointsOverlayApi,
} from './pointsOverlay';
import { enableMiddlePan } from './middlePan';

setWorkerUrl(maplibreWorkerUrl);

/** Brasil inteiro na abertura (o enquadramento nos dados vem logo depois). */
const DEFAULT_CENTER: [number, number] = [-51, -14.5];
const DEFAULT_ZOOM = 3;
/** Zoom máximo: 1 cm de tela ≈ 1 m (o fundo é ampliado além do último nível do servidor). */
const MAX_ZOOM = 22;
/** Zoom ao focar um único ponto. */
const POINT_ZOOM = 17;

const HINTS: Partial<Record<string, string>> = {
  multi: 'Clique nos pontos para adicionar/remover da seleção',
  rectangle: 'Arraste para desenhar um retângulo (Ctrl/Shift soma à seleção)',
  polygon: 'Clique para adicionar vértices · duplo clique ou Enter conclui · Esc cancela',
  add: 'Clique no mapa para adicionar um ponto',
  measure:
    'Clique para marcar pontos · duplo clique ou Enter conclui · Backspace desfaz · Esc limpa',
  streetview: 'Clique no local para abrir o Street View em uma nova aba',
  transform: 'Arraste um ponto selecionado ou clique no destino · Enter confirma · Esc cancela',
};

/**
 * Cria o mapa (MapLibre, código aberto — sem chave de API). O fundo raster é aplicado pelo
 * BasemapControl; rotação e inclinação ficam desligadas (mapa 2D, como no QGIS).
 */
function MapCanvas() {
  const setMap = useSetMap();
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const map = new MaplibreMap({
      container: ref.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#eef1f4' } },
        ],
      },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: MAX_ZOOM,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      boxZoom: false,
      fadeDuration: 0,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.once('load', () => {
      setMap(map);
      setReady(true);
      setProjectViewGetter(() => {
        const c = map.getCenter();
        return { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() };
      });
    });
    return () => {
      setProjectViewGetter(null);
      setMap(null);
      map.remove();
    };
  }, [setMap]);

  return (
    <>
      {/* Posição inline: o CSS do MapLibre (.maplibregl-map { position: relative }) anularia a classe
          "absolute" e o mapa ficaria com altura 0. */}
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      {!ready && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-100">
          <Loader2 className="size-6 animate-spin text-slate-400" />
        </div>
      )}
    </>
  );
}

/** Aplica pedidos de foco (enquadrar/centralizar) vindos do store. */
function FocusController() {
  const map = useMap();
  const focus = useAppStore((s) => s.focus);
  useEffect(() => {
    if (!map || !focus) return;
    if (focus.bounds) {
      const b = focus.bounds;
      if (b.minLat === b.maxLat && b.minLng === b.maxLng) {
        map.easeTo({ center: [b.minLng, b.minLat], zoom: POINT_ZOOM, duration: 300 });
      } else {
        map.fitBounds(
          [
            [b.minLng, b.minLat],
            [b.maxLng, b.maxLat],
          ],
          { padding: 48, maxZoom: POINT_ZOOM + 1, duration: 300 },
        );
      }
    } else if (focus.center) {
      map.easeTo({
        center: [focus.center.lng, focus.center.lat],
        zoom: focus.zoom ?? map.getZoom(),
        duration: 300,
      });
    }
  }, [map, focus]);
  return null;
}

function StatusBar({
  active,
  runtimes,
  busy,
}: {
  active: LayerRuntime | undefined;
  runtimes: LayerRuntime[];
  busy: boolean;
}) {
  const filters = useAppStore((s) => s.filters);
  const map = useMap();
  // Re-renderiza a cada parada do mapa (MapView atualiza o viewport), então acompanha o zoom.
  const lod = map ? lodFraction(metersPerCm(worldScaleOf(map.getZoom()), map.getCenter().lat)) : 1;
  const fetching = busy || runtimes.some((r) => r.isFetching);
  const visible = runtimes.filter((r) => r.layer.visible).length;
  const vp = active?.viewport;
  return (
    <div className="absolute bottom-6 left-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-md bg-white/95 px-2.5 py-1.5 text-xs text-slate-600 shadow max-lg:bottom-20">
      {fetching && <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-600" />}
      {!active ? (
        <span>Nenhuma camada ativa</span>
      ) : active.mode === 'full' ? (
        <span className="truncate">
          <b className="text-slate-800">{fmtInt(active.total ?? 0)}</b> pontos em{' '}
          <b className="text-slate-800">{active.source?.name}</b>
          {visible > 1 && ` · ${visible} camadas visíveis`}
        </span>
      ) : active.mode === 'viewport' && vp ? (
        <span className="truncate">
          Tabela grande ({fmtInt(active.total ?? 0)}) ·{' '}
          {vp.mode === 'clusters' ? (
            <>
              <b className="text-slate-800">{fmtInt(vp.total)}</b> registros em clusters · aproxime
              para ver os pontos
            </>
          ) : (
            <>
              <b className="text-slate-800">{fmtInt(vp.total)}</b> registros visíveis
            </>
          )}
        </span>
      ) : (
        <span>
          {active.isFetching
            ? 'Carregando pontos…'
            : active.layer.visible
              ? 'Mova o mapa para carregar'
              : 'Camada oculta'}
        </span>
      )}
      {filters.length > 0 && (
        <span className="shrink-0 rounded bg-amber-100 px-1 text-amber-800">filtrado</span>
      )}
      {active?.mode === 'full' && lod < 1 && (
        <span
          className="shrink-0 rounded bg-sky-100 px-1 text-sky-800"
          title="Afastado: só parte dos pontos é desenhada; aproxime para ver todos"
        >
          exibindo {Math.round(lod * 100)}%
        </span>
      )}
    </div>
  );
}

export default function MapView() {
  const { sourceId } = useActiveSource();
  const transform = useAppStore((s) => s.transform);
  // Enquanto move/duplica, as ferramentas de seleção/desenho ficam suspensas.
  const tool = useAppStore((s) => (s.transform ? 'pan' : s.tool));
  const searchWindows = useAppStore((s) => s.searchWindows);
  const listWindows = useAppStore((s) => s.listWindows);
  const selection = useAppStore((s) => s.selection);
  const setSelection = useAppStore((s) => s.setSelection);
  const toggleGroup = useAppStore((s) => s.toggleGroup);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const setSource = useAppStore((s) => s.setSource);
  const openDialog = useAppStore((s) => s.openDialog);
  const focusMap = useAppStore((s) => s.focusMap);
  const map = useMap();

  const [rawBounds, setRawBounds] = useState<Bounds | null>(null);
  // Só busca os pontos da região depois que o mapa fica parado: 0,5 s após arrastar e 1 s após
  // zoom (a rodinha para entre um "clique" e outro; não busca no meio do zoom).
  const [fetchDelay, setFetchDelay] = useState(500);
  const bounds = useDebounce(rawBounds, fetchDelay);
  const runtimes = useLayersData(bounds);
  const active = runtimes.find((r) => r.layer.sourceId === sourceId);
  const selectedKeys = useMemo(() => new Set(Object.keys(selection)), [selection]);
  const [busy, setBusy] = useState(false);
  const overlayRef = useRef<PointsOverlayApi | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef(false);

  // Cursor, arraste e duplo clique conforme a ferramenta (mover/duplicar e o hover ajustam depois).
  const drawing = tool === 'rectangle' || tool === 'polygon';
  const crosshair =
    drawing || tool === 'add' || tool === 'measure' || tool === 'streetview' || !!transform;
  useEffect(() => {
    pointerRef.current = false;
    if (tipRef.current) tipRef.current.hidden = true;
    if (!map) return;
    map.getCanvas().style.cursor = crosshair ? 'crosshair' : '';
    if (tool === 'rectangle') map.dragPan.disable();
    else map.dragPan.enable();
    if (tool === 'polygon' || tool === 'measure' || transform) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [map, tool, transform, crosshair]);

  // Botão do meio (rodinha) arrasta o mapa em qualquer ferramenta.
  useEffect(() => (map ? enableMiddlePan(map) : undefined), [map]);

  // Overlay de canvas (um por mapa).
  useEffect(() => {
    if (!map) return;
    const o = createPointsOverlay(map);
    overlayRef.current = o;
    return () => {
      o.destroy();
      overlayRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    overlayRef.current?.setLayers(
      runtimes
        .filter((r) => r.layer.visible && r.prepared)
        .map((r) => ({ id: r.layer.sourceId, prepared: r.prepared!, style: r.layer })),
    );
  });

  useEffect(() => {
    overlayRef.current?.setSelected(sourceId, selectedKeys);
  }, [sourceId, selectedKeys, map]);

  // Coordenada buscada: pisca o local ao chegar.
  const focus = useAppStore((s) => s.focus);
  useEffect(() => {
    if (focus?.flash && focus.center) overlayRef.current?.flash([focus.center]);
  }, [focus]);

  // Região visível (para camadas grandes, carregadas por viewport) a cada parada do mapa.
  useEffect(() => {
    if (!map) return;
    let zoom = map.getZoom();
    const update = () => {
      const b = map.getBounds();
      const z = map.getZoom();
      setFetchDelay(z !== zoom ? 1000 : 500);
      zoom = z;
      setRawBounds(
        roundBounds({
          minLat: b.getSouth(),
          maxLat: b.getNorth(),
          minLng: b.getWest(),
          maxLng: b.getEast(),
        }),
      );
    };
    update();
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [map]);

  const onGroupHit = useCallback(
    async (hit: Extract<Hit, { kind: 'group' }>, additive: boolean) => {
      const rt = runtimes.find((r) => r.layer.sourceId === hit.layerId);
      const info = groupInfo(hit.prepared, hit.styled, hit.g);
      let ids = info.ids;
      if (!ids) {
        try {
          setBusy(true);
          ids = (
            await pointsService.at(hit.layerId, info.x, info.y, rt?.selectionFilters ?? [], true)
          ).ids;
        } catch (err) {
          toast.error(errorMessage(err));
          return;
        } finally {
          setBusy(false);
        }
      }
      const group = { key: info.key, x: info.x, y: info.y, lat: info.lat, lng: info.lng, ids };
      if (hit.layerId !== useAppStore.getState().sourceId) {
        // Clique em outra camada: ela vira a camada ativa (como no QGIS).
        setSource(hit.layerId);
        setSelection([group]);
        return;
      }
      if (additive || tool === 'multi') toggleGroup(group);
      else setSelection([group]);
    },
    [runtimes, tool, toggleGroup, setSelection, setSource],
  );

  const onClusterClick = useCallback(
    (c: MapCluster) => {
      if (c.bounds) focusMap({ bounds: c.bounds });
      else if (map) focusMap({ center: c, zoom: map.getZoom() + 2 });
    },
    [map, focusMap],
  );

  // Clique e hover resolvidos pelo canvas (sem objetos por ponto).
  const clickable = !transform && (tool === 'select' || tool === 'multi' || tool === 'pan');
  const noop = (e: MapMouseEvent) => void e;
  const handlers = useRef({ click: noop, move: noop });
  const nameOf = (id: string) => runtimes.find((r) => r.layer.sourceId === id)?.source?.name ?? '';
  handlers.current = {
    click: (e) => {
      if (!clickable) return;
      const hit = overlayRef.current?.hitTest(e.lngLat.lat, e.lngLat.lng);
      if (hit?.kind === 'cluster') onClusterClick(hit.cluster);
      else if (hit?.kind === 'group') void onGroupHit(hit, isAdditive(e));
      else if (tool === 'select' && Object.keys(selection).length) clearSelection();
    },
    move: (e) => {
      const tip = tipRef.current;
      if (!map || !tip) return;
      const hit = clickable ? overlayRef.current?.hitTest(e.lngLat.lat, e.lngLat.lng) : null;
      if (clickable && pointerRef.current !== !!hit) {
        pointerRef.current = !!hit;
        map.getCanvas().style.cursor = hit ? 'pointer' : '';
      }
      const dom = e.originalEvent as MouseEvent | undefined;
      if (!hit || !dom || typeof dom.clientX !== 'number') {
        tip.hidden = true;
        return;
      }
      let text: string;
      if (hit.kind === 'cluster')
        text = `${fmtInt(hit.cluster.count)} registros — clique para aproximar`;
      else {
        const info = groupInfo(hit.prepared, hit.styled, hit.g);
        text =
          info.count > 1
            ? `${fmtInt(info.count)} registros nesta coordenada`
            : (info.label ?? `#${info.firstId ?? ''}`);
        if (info.category !== null || hit.prepared.categorized)
          text += ` · ${fmtValue(info.category)}`;
      }
      const rect = map.getContainer().getBoundingClientRect();
      tip.textContent = `${text}  —  ${nameOf(hit.layerId)}`;
      tip.style.left = `${dom.clientX - rect.left + 14}px`;
      tip.style.top = `${dom.clientY - rect.top + 14}px`;
      tip.hidden = false;
    },
  };

  useEffect(() => {
    if (!map) return;
    let frame = 0;
    let last: MapMouseEvent | null = null;
    const click = (e: MapMouseEvent) => handlers.current.click(e);
    const move = (e: MapMouseEvent) => {
      last = e;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (last) handlers.current.move(last);
        });
    };
    const hideTip = () => {
      if (tipRef.current) tipRef.current.hidden = true;
    };
    map.on('click', click);
    map.on('mousemove', move);
    map.on('mouseout', hideTip);
    map.on('dragstart', hideTip);
    return () => {
      cancelAnimationFrame(frame);
      map.off('click', click);
      map.off('mousemove', move);
      map.off('mouseout', hideTip);
      map.off('dragstart', hideTip);
    };
  }, [map]);

  const onPolygon = useCallback(
    async (polygon: LatLng[], additive: boolean) => {
      if (!sourceId) return;
      setBusy(true);
      try {
        const res = await pointsService.selection(
          sourceId,
          polygon,
          active?.selectionFilters ?? [],
        );
        setSelection(
          res.groups.map(({ key, x, y, lat, lng, ids }) => ({ key, x, y, lat, lng, ids })),
          additive ? 'add' : 'replace',
        );
        if (res.truncated) toast.info('Seleção limitada a 200.000 registros.');
        else if (!res.count) toast.info('Nenhum ponto da camada ativa na região selecionada.');
        else toast.success(`${fmtInt(res.count)} registro(s) selecionado(s).`);
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [sourceId, active?.selectionFilters, setSelection],
  );

  const onMapClick = useCallback(
    async (pos: LatLng) => {
      const source = active?.source;
      if (!source) return;
      try {
        const { x, y } = await crsService.toXY(
          source.coordinateSystem,
          pos.lat,
          pos.lng,
          source.proj4,
        );
        openDialog('form', {
          mode: 'create',
          initial: {
            [source.xColumn]: Math.round(x * 1000) / 1000,
            [source.yColumn]: Math.round(y * 1000) / 1000,
          },
        });
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    [active?.source, openDialog],
  );

  const hint = HINTS[transform ? 'transform' : tool];
  const failed = runtimes.find((r) => r.layer.visible && r.error && !r.isFetching);

  return (
    <div className="relative h-full w-full">
      <MapCanvas />
      <DrawingController
        tool={tool}
        hasSelection={selectedKeys.size > 0}
        onPolygon={onPolygon}
        onMapClick={onMapClick}
      />
      {tool === 'measure' && <MeasureController />}
      {/* Uma janela do modo lista por L/clique, cada uma presa à camada (mantém o estado). */}
      {listWindows.map((w, i) => (
        <ListModePanel key={w.id} windowId={w.id} sourceId={w.sourceId} index={i} />
      ))}
      {/* Uma janela por F3/clique, cada uma presa à camada em que foi aberta. */}
      {searchWindows.map((w, i) => (
        <SelectByValuePanel
          key={w.id}
          windowId={w.id}
          sourceId={w.sourceId}
          index={i}
          overlay={overlayRef}
        />
      ))}
      <BasemapControl />
      <BoundariesLayer />
      <TransformController overlay={overlayRef} sourceId={sourceId} />
      <FocusController />
      <LayersPanel runtimes={runtimes} />

      <div
        ref={tipRef}
        hidden
        className="pointer-events-none absolute z-20 max-w-xs truncate tone-fixed rounded bg-slate-900/90 px-2 py-1 text-xs text-white shadow-lg"
      />

      {hint && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 tone-fixed rounded-full bg-slate-900/85 px-3.5 py-1.5 text-xs text-white shadow-lg max-sm:top-14 max-sm:max-w-[90%] max-sm:text-center">
          {hint}
        </div>
      )}

      {runtimes.length > 0 && <StatusBar active={active} runtimes={runtimes} busy={busy} />}

      {failed && (
        <div className="absolute top-16 left-1/2 z-20 w-80 max-w-[90%] -translate-x-1/2 rounded-lg border border-red-200 bg-white shadow-lg">
          <ErrorState
            compact
            error={failed.error}
            title={`Não foi possível carregar "${failed.source?.name ?? 'camada'}".`}
            onRetry={failed.refetch}
          />
        </div>
      )}
    </div>
  );
}
