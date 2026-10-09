import type { GeoJSONSourceSpecification, Map as MlMap } from 'maplibre-gl';
import { Map as MapIcon, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILTIN_BASEMAPS, parseXyzUrl, resolveBasemap, type BasemapDef } from '@/lib/basemaps';
import { boundaryStore } from '@/lib/boundaries';
import { useMap } from '@/lib/mapContext';
import { useAppStore } from '@/stores/appStore';
import { Button } from '../ui/Button';

const BASE = 'basemap';
const OVERLAY = 'basemap-overlay';
const ADD = '__add';

/** Primeira camada acima do fundo (limites/ferramentas): o fundo raster entra logo abaixo dela. */
const firstAboveBackground = (map: MlMap) =>
  map.getStyle().layers.find((l) => l.id !== 'background' && l.id !== BASE && l.id !== OVERLAY)?.id;

/** Troca o fundo raster (tiles XYZ) mantendo limites e ferramentas por cima. */
function applyBasemap(map: MlMap, def: BasemapDef) {
  for (const id of [OVERLAY, BASE]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  map.setPaintProperty('background', 'background-color', def.background ?? '#eef1f4');
  const before = firstAboveBackground(map);
  if (def.tiles.length) {
    map.addSource(BASE, {
      type: 'raster',
      tiles: def.tiles,
      tileSize: 256,
      maxzoom: def.maxzoom,
      scheme: def.scheme ?? 'xyz',
      attribution: def.attribution,
    });
    map.addLayer({ id: BASE, type: 'raster', source: BASE }, before);
  }
  if (def.overlay) {
    map.addSource(OVERLAY, {
      type: 'raster',
      tiles: def.overlay.tiles,
      tileSize: 256,
      maxzoom: def.overlay.maxzoom,
    });
    map.addLayer({ id: OVERLAY, type: 'raster', source: OVERLAY }, before);
  }
}

/** Formulário para adicionar um fundo por URL de tiles XYZ (como "Conexão XYZ" no QGIS). */
function AddBasemapForm({ onClose }: { onClose: () => void }) {
  const addCustomBasemap = useAppStore((s) => s.addCustomBasemap);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [maxZoom, setMaxZoom] = useState(19);
  const valid = !!name.trim() && !!parseXyzUrl(url);

  return (
    <div className="absolute top-12 right-3 z-30 w-80 max-w-[calc(100%-1.5rem)] space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl">
      <div className="flex items-center justify-between">
        <b className="text-sm text-slate-800">Adicionar mapa por URL (XYZ)</b>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </button>
      </div>
      <label className="block">
        Nome
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoFocus
          className="mt-0.5 block h-7 w-full rounded-md border border-slate-300 px-2 text-sm focus:border-accent-500 focus:outline-none"
        />
      </label>
      <label className="block">
        URL dos tiles
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://servidor/{z}/{x}/{y}.png"
          spellCheck={false}
          className="mt-0.5 block h-7 w-full rounded-md border border-slate-300 px-2 font-mono text-[11px] focus:border-accent-500 focus:outline-none"
        />
      </label>
      <label className="flex items-center gap-2">
        Zoom máximo do servidor
        <input
          type="number"
          min={1}
          max={24}
          value={maxZoom}
          onChange={(e) => setMaxZoom(Math.min(24, Math.max(1, Number(e.target.value) || 19)))}
          className="h-7 w-16 rounded-md border border-slate-300 px-2 text-sm"
        />
      </label>
      <p className="text-[11px] leading-snug text-slate-500">
        Aceita {'{z}'} {'{x}'} {'{y}'}, {'{q}'} (quadkey), {'{s}'} e {'{-y}'}, como no QGIS. Use
        apenas serviços cujos termos permitam esse acesso — Google e Bing, por exemplo, não liberam
        o uso direto dos tiles.
      </p>
      {url && !parseXyzUrl(url) && (
        <p className="text-[11px] text-red-600">
          A URL precisa começar com http(s) e ter {'{z}'}, {'{x}'} e {'{y}'} (ou {'{q}'}).
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!valid}
          onClick={() => {
            addCustomBasemap({
              id: Date.now().toString(36),
              name: name.trim(),
              url: url.trim(),
              maxZoom,
            });
            onClose();
          }}
        >
          Adicionar
        </Button>
      </div>
    </div>
  );
}

/** Seletor do mapa de fundo (gratuitos, sem chave) + fundos adicionados por URL. */
export function BasemapControl() {
  const map = useMap();
  const basemap = useAppStore((s) => s.basemap);
  const custom = useAppStore((s) => s.customBasemaps);
  const setBasemap = useAppStore((s) => s.setBasemap);
  const removeCustomBasemap = useAppStore((s) => s.removeCustomBasemap);
  const [adding, setAdding] = useState(false);
  const def = useMemo(() => resolveBasemap(basemap, custom), [basemap, custom]);
  const customId = def.id.startsWith('xyz:') ? def.id.slice(4) : null;
  const applied = useRef<{ map: MlMap; key: string } | null>(null);

  useEffect(() => {
    if (!map) return;
    // Só reaplica (e recarrega os tiles) se o fundo mudou de fato.
    const key = JSON.stringify(def);
    if (applied.current?.map === map && applied.current.key === key) return;
    applyBasemap(map, def);
    applied.current = { map, key };
  }, [map, def]);

  return (
    <>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs text-slate-700 shadow-md">
        <MapIcon className="size-4 text-accent-600" />
        <select
          value={def.id}
          onChange={(e) => (e.target.value === ADD ? setAdding(true) : setBasemap(e.target.value))}
          className="max-w-44 bg-transparent text-xs font-medium outline-none"
          title="Mapa de fundo"
          aria-label="Mapa de fundo"
        >
          {BUILTIN_BASEMAPS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
          {custom.length > 0 && (
            <optgroup label="Adicionados por URL">
              {custom.map((c) => (
                <option key={c.id} value={`xyz:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value={ADD}>+ Adicionar por URL (XYZ)…</option>
        </select>
        {customId && (
          <button
            type="button"
            onClick={() => removeCustomBasemap(customId)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
            title="Remover este mapa de fundo"
            aria-label="Remover este mapa de fundo"
          >
            <X className="size-3.5" />
          </button>
        )}
        {!customId && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Adicionar mapa por URL (XYZ)"
            aria-label="Adicionar mapa por URL (XYZ)"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      {adding && <AddBasemapForm onClose={() => setAdding(false)} />}
    </>
  );
}

/** Camadas de limites: polígonos sem preenchimento, só a borda colorida (abaixo das ferramentas). */
export function BoundariesLayer() {
  const map = useMap();
  const boundaries = useAppStore((s) => s.boundaries);
  const latest = useRef(boundaries);
  latest.current = boundaries;
  const loading = useRef(new Set<string>());

  useEffect(() => {
    if (!map) return;
    const lid = (id: string) => `bnd-${id}`;
    const toolLayer = () => map.getStyle().layers.find((l) => l.id.startsWith('tool-'))?.id;
    /** Ordem do painel: o primeiro limite fica por cima. */
    const reorder = () => {
      const list = latest.current;
      for (let i = list.length - 1; i >= 0; i--)
        if (map.getLayer(lid(list[i].id))) map.moveLayer(lid(list[i].id), toolLayer());
    };
    const ids = new Set(boundaries.map((b) => b.id));
    for (const l of map.getStyle().layers) {
      if (!l.id.startsWith('bnd-') || ids.has(l.id.slice(4))) continue;
      map.removeLayer(l.id);
      if (map.getSource(l.id)) map.removeSource(l.id);
    }
    for (const b of boundaries) {
      const id = lid(b.id);
      const paint = { 'line-color': b.color, 'line-width': b.width };
      const visibility = b.visible ? 'visible' : 'none';
      if (map.getLayer(id)) {
        map.setPaintProperty(id, 'line-color', paint['line-color']);
        map.setPaintProperty(id, 'line-width', paint['line-width']);
        map.setLayoutProperty(id, 'visibility', visibility);
        continue;
      }
      if (loading.current.has(b.id)) continue;
      loading.current.add(b.id);
      void boundaryStore.get(b.id).then((data) => {
        loading.current.delete(b.id);
        const cur = latest.current.find((x) => x.id === b.id);
        if (!data || !cur || map.getLayer(id)) return;
        map.addSource(id, { type: 'geojson', data } as GeoJSONSourceSpecification);
        map.addLayer(
          {
            id,
            type: 'line',
            source: id,
            paint: { 'line-color': cur.color, 'line-width': cur.width },
            layout: { visibility: cur.visible ? 'visible' : 'none', 'line-join': 'round' },
          },
          toolLayer(),
        );
        reorder();
      });
    }
    reorder();
  }, [map, boundaries]);

  return null;
}
