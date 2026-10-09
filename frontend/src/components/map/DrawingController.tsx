import type { MapMouseEvent } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { eventLatLng, isAdditive, useMap } from '@/lib/mapContext';
import { lineFeature, polygonFeature, toolSource } from '@/lib/toolLayers';
import type { LatLng, Tool } from '@/types';

interface Props {
  tool: Tool;
  hasSelection: boolean;
  onPolygon: (polygon: LatLng[], additive: boolean) => void;
  onMapClick: (pos: LatLng) => void;
}

const STROKE = '#d97706';
const FILL = '#f59e0b';

const same = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/** Retângulo (4 vértices) a partir de dois cantos. */
function rectangle(a: LatLng, b: LatLng): LatLng[] {
  const minLat = Math.min(a.lat, b.lat);
  const maxLat = Math.max(a.lat, b.lat);
  const minLng = Math.min(a.lng, b.lng);
  const maxLng = Math.max(a.lng, b.lng);
  return [
    { lat: minLat, lng: minLng },
    { lat: minLat, lng: maxLng },
    { lat: maxLat, lng: maxLng },
    { lat: maxLat, lng: minLng },
  ];
}

/** Ferramentas de desenho próprias: retângulo por arraste, polígono por cliques. */
export function DrawingController({ tool, hasSelection, onPolygon, onMapClick }: Props) {
  const map = useMap();
  const handlers = useRef({ onPolygon, onMapClick });
  handlers.current = { onPolygon, onMapClick };
  const [vertexCount, setVertexCount] = useState(0);
  const finishRef = useRef<(() => void) | null>(null);
  const shape = useRef<ReturnType<typeof toolSource> | null>(null);

  // Camadas do retângulo em arraste (some ao soltar) e da prévia do polígono.
  useEffect(() => {
    if (!map) return;
    const s = toolSource(map, 'tool-draw', [
      { id: 'tool-draw-fill', type: 'fill', paint: { 'fill-color': FILL, 'fill-opacity': 0.12 } },
      { id: 'tool-draw-line', type: 'line', paint: { 'line-color': STROKE, 'line-width': 2 } },
    ]);
    shape.current = s;
    return () => {
      s.remove();
      shape.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!hasSelection) shape.current?.clear();
  }, [hasSelection]);

  // Retângulo (o arraste do mapa fica desligado nesta ferramenta — ver MapView).
  useEffect(() => {
    if (!map || tool !== 'rectangle') return;
    let start: LatLng | null = null;
    let additive = false;
    const down = (e: MapMouseEvent) => {
      if ((e.originalEvent as MouseEvent).button !== 0) return;
      additive = isAdditive(e);
      start = eventLatLng(e);
      shape.current?.clear();
    };
    const move = (e: MapMouseEvent) => {
      if (start) shape.current?.set([polygonFeature(rectangle(start, eventLatLng(e)))]);
    };
    const up = (e: MapMouseEvent) => {
      if (!start) return;
      const end = eventLatLng(e);
      const a = start;
      start = null;
      if (same(a, end)) {
        shape.current?.clear();
        return;
      }
      // A seleção fica; a marcação do retângulo some ao soltar o botão.
      shape.current?.clear();
      handlers.current.onPolygon(rectangle(a, end), additive);
    };
    map.on('mousedown', down);
    map.on('mousemove', move);
    map.on('mouseup', up);
    return () => {
      map.off('mousedown', down);
      map.off('mousemove', move);
      map.off('mouseup', up);
    };
  }, [map, tool]);

  // Polígono
  useEffect(() => {
    if (!map || tool !== 'polygon') return;
    const preview = toolSource(map, 'tool-draw-preview', [
      {
        id: 'tool-draw-preview-line',
        type: 'line',
        paint: { 'line-color': STROKE, 'line-width': 2 },
      },
    ]);
    const path: LatLng[] = [];
    let additive = false;
    const finish = () => {
      // Remove vértices duplicados (o duplo clique gera dois cliques).
      const pts = path.filter((p, i) => i === 0 || !same(p, path[i - 1]));
      // Com menos de 3 vértices o polígono continua em edição (não descarta os cliques).
      if (pts.length < 3) return;
      path.length = 0;
      preview.clear();
      setVertexCount(0);
      // A seleção fica; a marcação do polígono some ao concluir.
      shape.current?.clear();
      handlers.current.onPolygon(pts, additive);
    };
    const click = (e: MapMouseEvent) => {
      if (path.length === 0) {
        shape.current?.clear();
        additive = isAdditive(e);
      }
      path.push(eventLatLng(e));
      preview.set([lineFeature(path)]);
      setVertexCount(path.length);
    };
    const move = (e: MapMouseEvent) => {
      if (path.length) preview.set([lineFeature([...path, eventLatLng(e), path[0]])]);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') finish();
      if (e.key === 'Escape') {
        path.length = 0;
        preview.clear();
        setVertexCount(0);
      }
    };
    map.on('click', click);
    map.on('mousemove', move);
    map.on('dblclick', finish);
    window.addEventListener('keydown', onKey);
    finishRef.current = finish;
    return () => {
      map.off('click', click);
      map.off('mousemove', move);
      map.off('dblclick', finish);
      window.removeEventListener('keydown', onKey);
      preview.remove();
      setVertexCount(0);
    };
  }, [map, tool]);

  // Adicionar ponto pelo mapa
  useEffect(() => {
    if (!map || tool !== 'add') return;
    const click = (e: MapMouseEvent) => handlers.current.onMapClick(eventLatLng(e));
    map.on('click', click);
    return () => {
      map.off('click', click);
    };
  }, [map, tool]);

  // Street View: abre o panorama mais próximo do ponto clicado em uma nova aba (link público do Google Maps).
  useEffect(() => {
    if (!map || tool !== 'streetview') return;
    const click = (e: MapMouseEvent) => {
      const viewpoint = `${e.lngLat.lat.toFixed(7)},${e.lngLat.lng.toFixed(7)}`;
      window.open(
        `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${viewpoint}`,
        '_blank',
        'noopener',
      );
    };
    map.on('click', click);
    return () => {
      map.off('click', click);
    };
  }, [map, tool]);

  if (tool !== 'polygon' || vertexCount < 3) return null;
  return (
    <button
      type="button"
      onClick={() => finishRef.current?.()}
      className="absolute top-14 left-1/2 z-10 -translate-x-1/2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg hover:bg-amber-700"
    >
      Concluir polígono ({vertexCount} vértices)
    </button>
  );
}
