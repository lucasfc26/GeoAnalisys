export interface LatLng {
  lat: number;
  lng: number;
}

export interface LatLngBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Ray casting em coordenadas lng/lat. */
export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.lat > p.lat !== b.lat > p.lat &&
      p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonBounds(polygon: LatLng[]): LatLngBounds {
  return {
    minLat: Math.min(...polygon.map((p) => p.lat)),
    maxLat: Math.max(...polygon.map((p) => p.lat)),
    minLng: Math.min(...polygon.map((p) => p.lng)),
    maxLng: Math.max(...polygon.map((p) => p.lng)),
  };
}

export function inBounds(p: LatLng, b: LatLngBounds): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

/** Chave estável de uma coordenada (mesma regra usada no frontend). */
export function coordKey(x: number, y: number): string {
  return `${x}|${y}`;
}
