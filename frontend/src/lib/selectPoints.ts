import { useAppStore } from '@/stores/appStore';
import type { Bounds, SelectedGroup } from '@/types';
import { coordKey } from '@/utils/format';
import { boundsOfPoints } from '@/utils/geo';

/** Ponto de um resultado de ferramenta (Duplicidades, Fora do limite…). */
export interface ToolPoint {
  id: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
}

/**
 * Seleciona os pontos na camada (que vira a ativa) e enquadra o mapa neles (ou em `bounds`, ex.:
 * o ponto e o ponto de referência dele).
 */
export function selectPoints(sourceId: string, points: ToolPoint[], bounds?: Bounds | null) {
  const s = useAppStore.getState();
  if (s.sourceId !== sourceId) s.setSource(sourceId);
  const groups = new Map<string, SelectedGroup>();
  for (const p of points) {
    const key = coordKey(p.x, p.y);
    const g = groups.get(key);
    if (g) {
      if (!g.ids.includes(p.id)) g.ids.push(p.id);
    } else groups.set(key, { key, x: p.x, y: p.y, lat: p.lat, lng: p.lng, ids: [p.id] });
  }
  useAppStore.getState().setSelection([...groups.values()]);
  const b = bounds ?? boundsOfPoints(points);
  if (b) s.focusMap({ bounds: b });
}

/** CSV (;) com BOM, para abrir direto no Excel. */
export function csvBlob(headers: string[], rows: unknown[][]): Blob {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((r) => r.map(cell).join(';'));
  return new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}
