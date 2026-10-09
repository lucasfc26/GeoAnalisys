import type { MapMouseEvent } from 'maplibre-gl';
import { Ruler, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { eventLatLng, useMap } from '@/lib/mapContext';
import { lineFeature, pointFeatures, toolSource } from '@/lib/toolLayers';
import type { LatLng } from '@/types';
import { distanceM, fmtDistance } from '@/utils/geo';
import { Button } from '../ui/Button';

const COLOR = '#0369a1';

interface Measure {
  points: LatLng[];
  /** Medição encerrada (duplo clique/Enter): o próximo clique começa outra. */
  done: boolean;
}

const EMPTY: Measure = { points: [], done: false };

/**
 * Régua: clique para marcar pontos; mostra cada trecho e o total (geodésico). Duplo clique ou Enter
 * encerra, Backspace desfaz o último ponto, Esc limpa. Montado só enquanto a ferramenta está ativa.
 */
export function MeasureController() {
  const map = useMap();
  const [m, setM] = useState<Measure>(EMPTY);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const layers = useRef<{
    lines: ReturnType<typeof toolSource>;
    preview: ReturnType<typeof toolSource>;
  } | null>(null);

  // Camadas: trechos medidos (linha + vértices) e trecho em andamento até o cursor (tracejado).
  useEffect(() => {
    if (!map) return;
    const lines = toolSource(map, 'tool-measure', [
      {
        id: 'tool-measure-line',
        type: 'line',
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': COLOR, 'line-width': 3 },
      },
      {
        id: 'tool-measure-vertex',
        type: 'circle',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-stroke-color': COLOR,
          'circle-stroke-width': 2,
        },
      },
    ]);
    const preview = toolSource(map, 'tool-measure-preview', [
      {
        id: 'tool-measure-preview-line',
        type: 'line',
        paint: {
          'line-color': COLOR,
          'line-width': 2.5,
          'line-opacity': 0.9,
          'line-dasharray': [2, 2],
        },
      },
    ]);
    layers.current = { lines, preview };
    return () => {
      lines.remove();
      preview.remove();
      layers.current = null;
    };
  }, [map]);

  // Cliques, movimento e teclado.
  useEffect(() => {
    if (!map) return;
    const finish = () => setM((s) => (s.points.length > 1 ? { ...s, done: true } : s));
    const click = (e: MapMouseEvent) => {
      const ll = eventLatLng(e);
      setM((s) => {
        if (s.done) return { points: [ll], done: false };
        const last = s.points[s.points.length - 1];
        // O duplo clique gera dois cliques no mesmo lugar.
        if (last && last.lat === ll.lat && last.lng === ll.lng) return s;
        return { points: [...s.points, ll], done: false };
      });
    };
    let frame = 0;
    let last: LatLng | null = null;
    const move = (e: MapMouseEvent) => {
      last = eventLatLng(e);
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setCursor(last);
        });
    };
    const out = () => setCursor(null);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]'))
        return;
      if (e.key === 'Escape') setM(EMPTY);
      else if (e.key === 'Enter') finish();
      else if (e.key === 'Backspace') {
        e.preventDefault();
        setM((s) => ({ points: s.points.slice(0, -1), done: false }));
      }
    };
    map.on('click', click);
    map.on('dblclick', finish);
    map.on('mousemove', move);
    map.on('mouseout', out);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      map.off('click', click);
      map.off('dblclick', finish);
      map.off('mousemove', move);
      map.off('mouseout', out);
      window.removeEventListener('keydown', onKey);
    };
  }, [map]);

  useEffect(() => {
    layers.current?.lines.set(
      m.points.length > 1
        ? [lineFeature(m.points), ...pointFeatures(m.points)]
        : pointFeatures(m.points),
    );
  }, [m.points]);

  const lastPoint = m.points[m.points.length - 1];
  const preview = !m.done && lastPoint && cursor ? cursor : null;
  useEffect(() => {
    if (lastPoint && preview) layers.current?.preview.set([lineFeature([lastPoint, preview])]);
    else layers.current?.preview.clear();
  }, [lastPoint, preview]);

  if (!m.points.length) return null;
  let total = 0;
  for (let i = 1; i < m.points.length; i++) total += distanceM(m.points[i - 1], m.points[i]);
  const live = preview ? distanceM(lastPoint, preview) : 0;
  const segments = m.points.length - 1;

  return (
    <div className="absolute top-14 left-1/2 z-20 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border border-sky-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-lg max-sm:top-24">
      <Ruler className="size-4 text-sky-700" />
      <span>
        Total: <b className="text-slate-900">{fmtDistance(total + live)}</b>
      </span>
      {preview ? (
        <span className="text-slate-500">trecho atual {fmtDistance(live)}</span>
      ) : (
        segments > 0 && (
          <span className="text-slate-500">
            último trecho {fmtDistance(distanceM(m.points[segments - 1], lastPoint))}
          </span>
        )
      )}
      <span className="text-slate-500">
        {m.points.length} ponto(s){m.done && ' · concluída'}
      </span>
      <Button size="sm" icon={<X className="size-3.5" />} onClick={() => setM(EMPTY)}>
        Limpar
      </Button>
    </div>
  );
}
