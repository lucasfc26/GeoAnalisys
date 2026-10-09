import type { Bounds, LatLng } from '@/types';

/** Pixels CSS em 1 cm de tela (96 dpi). */
export const PX_PER_CM = 96 / 2.54;

/** Extensão que contém todas as extensões dadas (ignora nulas). */
export function unionBounds(list: (Bounds | null | undefined)[]): Bounds | null {
  const bs = list.filter((b): b is Bounds => !!b);
  if (!bs.length) return null;
  return {
    minLat: Math.min(...bs.map((b) => b.minLat)),
    maxLat: Math.max(...bs.map((b) => b.maxLat)),
    minLng: Math.min(...bs.map((b) => b.minLng)),
    maxLng: Math.max(...bs.map((b) => b.maxLng)),
  };
}

/** Extensão de um conjunto de pontos (sem spread: aguenta centenas de milhares). */
export function boundsOfPoints(points: Iterable<LatLng>): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points) {
    if (!b) b = { minLat: p.lat, maxLat: p.lat, minLng: p.lng, maxLng: p.lng };
    else {
      if (p.lat < b.minLat) b.minLat = p.lat;
      if (p.lat > b.maxLat) b.maxLat = p.lat;
      if (p.lng < b.minLng) b.minLng = p.lng;
      if (p.lng > b.maxLng) b.maxLng = p.lng;
    }
  }
  return b;
}

/** Distância geodésica (haversine) em metros. */
export function distanceM(a: LatLng, b: LatLng) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function fmtDistance(m: number) {
  if (m >= 1000) return `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km`;
  return `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m`;
}
