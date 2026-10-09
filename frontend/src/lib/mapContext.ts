import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { createContext, useContext } from 'react';
import type { LatLng } from '@/types';

/** Instância do mapa (MapLibre) compartilhada pela tela: mapa, ferramentas e barra lateral. */
export const MapContext = createContext<{ map: MlMap | null; setMap: (m: MlMap | null) => void }>({
  map: null,
  setMap: () => undefined,
});

/** O mapa, ou null enquanto não terminou de carregar. */
export function useMap(): MlMap | null {
  return useContext(MapContext).map;
}

export function useSetMap() {
  return useContext(MapContext).setMap;
}

/** Posição (lat/lng) de um evento de mouse do mapa. */
export const eventLatLng = (e: MapMouseEvent): LatLng => ({ lat: e.lngLat.lat, lng: e.lngLat.lng });

/** Ctrl/Shift/⌘ pressionado no evento (seleção aditiva). */
export const isAdditive = (e: MapMouseEvent) => {
  const o = e.originalEvent as MouseEvent | undefined;
  return !!(o && (o.ctrlKey || o.metaKey || o.shiftKey));
};
