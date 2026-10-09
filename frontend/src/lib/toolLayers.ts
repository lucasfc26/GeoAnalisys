import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource, LayerSpecification, Map as MlMap } from 'maplibre-gl';
import type { LatLng } from '@/types';

/** Omit que preserva cada tipo de camada da união (fill, line, circle…). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ToolLayer = DistributiveOmit<LayerSpecification, 'source'>;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Camadas temporárias das ferramentas (desenho, régua): uma fonte GeoJSON com camadas de estilo.
 * Os ids começam com "tool-" (ficam acima dos limites e do fundo).
 */
export function toolSource(map: MlMap, id: string, layers: ToolLayer[]) {
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  for (const l of layers)
    if (!map.getLayer(l.id)) map.addLayer({ ...l, source: id } as LayerSpecification);
  return {
    set(features: Feature<Geometry>[]) {
      (map.getSource(id) as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features,
      });
    },
    clear() {
      (map.getSource(id) as GeoJSONSource | undefined)?.setData(EMPTY);
    },
    remove() {
      for (const l of layers) if (map.getLayer(l.id)) map.removeLayer(l.id);
      if (map.getSource(id)) map.removeSource(id);
    },
  };
}

const pos = (p: LatLng): [number, number] => [p.lng, p.lat];

export const lineFeature = (pts: LatLng[]): Feature<Geometry> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: pts.map(pos) },
});

export const polygonFeature = (pts: LatLng[]): Feature<Geometry> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]].map(pos)] },
});

export const pointFeatures = (pts: LatLng[]): Feature<Geometry>[] =>
  pts.map((p) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: pos(p) },
  }));
