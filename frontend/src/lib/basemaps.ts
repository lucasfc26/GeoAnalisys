import type { CustomBasemap } from '@/types';

/** Mapa de fundo pronto para o MapLibre (tiles raster XYZ). */
export interface BasemapDef {
  id: string;
  label: string;
  tiles: string[];
  /** Último zoom com imagens no servidor (acima disso o MapLibre amplia a última imagem) */
  maxzoom: number;
  attribution: string;
  scheme?: 'xyz' | 'tms';
  /** Camada por cima (ex.: rótulos sobre o satélite) */
  overlay?: { tiles: string[]; maxzoom: number };
  /** Cor de fundo (onde não há imagem) */
  background?: string;
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
/**
 * Imagem de satélite do Esri. Onde não há foto no nível pedido, o Esri devolve uma imagem de aviso
 * ("Map data not yet available"); com blankTile=false ele responde 404 e o mapa amplia a foto do
 * nível anterior.
 */
const ESRI_IMAGERY = `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false`;
const ESRI_ATTRIBUTION =
  'Imagens © <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a> — Esri, Maxar, Earthstar Geographics e comunidade GIS';

/** Fundos gratuitos, sem chave. */
export const BUILTIN_BASEMAPS: BasemapDef[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  },
  {
    id: 'satellite',
    label: 'Satélite (Esri)',
    tiles: [ESRI_IMAGERY],
    maxzoom: 19,
    attribution: ESRI_ATTRIBUTION,
  },
  {
    id: 'hybrid',
    label: 'Satélite + rótulos (Esri)',
    tiles: [ESRI_IMAGERY],
    maxzoom: 19,
    attribution: ESRI_ATTRIBUTION,
    overlay: {
      tiles: [
        `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}?blankTile=false`,
      ],
      maxzoom: 19,
    },
  },
  { id: 'none', label: 'Sem fundo', tiles: [], maxzoom: 0, attribution: '', background: '#eef1f4' },
];

export const DEFAULT_BASEMAP = 'osm';

/**
 * Converte uma URL no formato do QGIS para o do MapLibre: {q} → quadkey (Bing), {s} → subdomínios
 * a/b/c e {-y} → esquema TMS. Retorna null se faltar {z}/{x}/{y} (ou {q}).
 */
export function parseXyzUrl(raw: string): { tiles: string[]; scheme: 'xyz' | 'tms' } | null {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  let scheme: 'xyz' | 'tms' = 'xyz';
  url = url.replace(/\{q\}/gi, '{quadkey}');
  if (url.includes('{-y}')) {
    scheme = 'tms';
    url = url.replace('{-y}', '{y}');
  }
  const hasXyz = url.includes('{z}') && url.includes('{x}') && url.includes('{y}');
  if (!hasXyz && !url.includes('{quadkey}')) return null;
  const tiles = url.includes('{s}') ? ['a', 'b', 'c'].map((s) => url.replace('{s}', s)) : [url];
  return { tiles, scheme };
}

/** Definição de um fundo (padrão ou adicionado pelo usuário); fundos desconhecidos viram o padrão. */
export function resolveBasemap(id: string, custom: CustomBasemap[]): BasemapDef {
  const builtin = BUILTIN_BASEMAPS.find((b) => b.id === id);
  if (builtin) return builtin;
  const c = custom.find((b) => `xyz:${b.id}` === id);
  const parsed = c && parseXyzUrl(c.url);
  if (c && parsed) {
    return {
      id,
      label: c.name,
      tiles: parsed.tiles,
      scheme: parsed.scheme,
      maxzoom: c.maxZoom,
      attribution: c.name,
    };
  }
  return BUILTIN_BASEMAPS.find((b) => b.id === DEFAULT_BASEMAP)!;
}
