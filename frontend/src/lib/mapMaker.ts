import type { GeoJsonPoint } from '@/services/export';
import type { GeoCollection, GeoFeature } from './boundaries';

/**
 * Mapas HTML do comitê (antes gerados pelos notebooks "Comite …" e "Mapas_Status18 …"):
 * limite escolhido + pontos do censo atual (azul) e do censo anterior (vermelho), em Mapbox GL,
 * no mesmo HTML que o mapboxgl_notebook produzia.
 */

export type MapKind = 'comite' | 'status18';

/** Propriedades levadas para os pontos (useful_cols dos notebooks). */
export const MAP_PROPERTIES = ['nome_cidade', 'medicao', 'tipo_lampada', 'potencia'] as const;

/** Valor do seletor de limite que usa o arquivo inteiro. */
export const ALL = 'Todos';

const COLOR_ATUAL = '#0a0adb';
const COLOR_ANTERIOR = '#ff0000';

export interface PointCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: { type: 'Point'; coordinates: [number, number] };
  }[];
}

/** Campos dos limites que podem nomear cada polígono, os mais prováveis (NOME, Municipio…) primeiro. */
export function boundaryNameFields(fc: GeoCollection): string[] {
  const preferred = ['NOME', 'Municipio', 'MUNICIPIO', 'nome', 'municipio', 'NM_MUN', 'name', 'NAME'];
  const seen = new Set<string>();
  for (const f of fc.features.slice(0, 500)) {
    for (const [k, v] of Object.entries(f.properties ?? {})) {
      if (typeof v === 'string' || typeof v === 'number') seen.add(k);
    }
  }
  return [...preferred.filter((k) => seen.has(k)), ...[...seen].filter((k) => !preferred.includes(k))];
}

export function boundaryValues(fc: GeoCollection, field: string): string[] {
  const values = new Set<string>();
  for (const f of fc.features) {
    const v = f.properties?.[field];
    if (v !== null && v !== undefined && v !== '') values.add(String(v));
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

/** "Todos": o arquivo inteiro; senão o polígono com esse nome (como no notebook). */
export function boundaryData(
  fc: GeoCollection,
  field: string,
  value: string,
): GeoCollection | GeoFeature {
  if (value === ALL) return fc;
  const matches = fc.features.filter((f) => String(f.properties?.[field] ?? '') === value);
  return matches.length === 1 ? matches[0] : { type: 'FeatureCollection', features: matches };
}

type Ring = number[][];

/** Par/ímpar sobre todos os anéis do polígono (furos incluídos). */
function inRings(x: number, y: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function inGeometry(x: number, y: number, g: GeoFeature['geometry']): boolean {
  if (!g) return false;
  if (g.type === 'Polygon') return inRings(x, y, g.coordinates as Ring[]);
  if (g.type === 'MultiPolygon') return (g.coordinates as Ring[][]).some((p) => inRings(x, y, p));
  if (g.type === 'GeometryCollection') return (g.geometries ?? []).some((h) => inGeometry(x, y, h));
  return false;
}

function extent(g: GeoFeature['geometry']) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      const [x, y] = c as number[];
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    } else c.forEach(walk);
  };
  const visit = (h: GeoFeature['geometry']): void => {
    if (!h) return;
    if (h.type === 'GeometryCollection') (h.geometries ?? []).forEach(visit);
    else walk(h.coordinates);
  };
  visit(g);
  return b;
}

/** Só os pontos dentro dos polígonos do limite (o polígono da região escolhida). */
export function pointsInside(
  points: PointCollection,
  limite: GeoCollection | GeoFeature,
): PointCollection {
  const shapes = (limite.type === 'FeatureCollection' ? limite.features : [limite]).map((f) => ({
    g: f.geometry,
    b: extent(f.geometry),
  }));
  return {
    type: 'FeatureCollection',
    features: points.features.filter(({ geometry: { coordinates: [x, y] } }) =>
      shapes.some(
        ({ g, b }) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && inGeometry(x, y, g),
      ),
    ),
  };
}

/** Limite importado sem atributos (ex.: .shp sem o .dbf): não há campo para nomear as regiões. */
export const hasNoAttributes = (fc: GeoCollection) =>
  fc.features.every((f) => !f.properties || !Object.keys(f.properties).length);

/** Nome sugerido para os arquivos: o polígono escolhido ou, com "Todos", o nome do limite. */
export function defaultMapLabel(boundaryName: string | undefined, value: string): string {
  return value === ALL ? (boundaryName ?? '') : value;
}

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

/** "Não"/"Sim" (com ou sem acento, qualquer caixa) → "NAO"/"SIM"; outros valores ficam como estão. */
export function normalizeMedicao(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const p = plain(v);
  return p === 'NAO' || p === 'SIM' ? p : v;
}

/**
 * Pontos com coordenadas e só as propriedades do mapa. `columns` liga cada propriedade
 * (nome_cidade, medicao…) ao nome real da coluna na tabela.
 */
export function toMapPoints(
  features: GeoJsonPoint[],
  columns: Partial<Record<(typeof MAP_PROPERTIES)[number], string>>,
): PointCollection {
  const out: PointCollection['features'] = [];
  for (const f of features) {
    if (f.geometry?.type !== 'Point' || !f.geometry.coordinates) continue;
    const properties: Record<string, unknown> = {};
    for (const p of MAP_PROPERTIES) {
      const col = columns[p];
      if (!col) continue;
      const v = f.properties?.[col] ?? null;
      properties[p] = p === 'medicao' ? normalizeMedicao(v) : v;
    }
    out.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: f.geometry.coordinates } });
  }
  return { type: 'FeatureCollection', features: out };
}

const onlyEstimados = (fc: PointCollection): PointCollection => ({
  type: 'FeatureCollection',
  features: fc.features.filter((f) => f.properties.medicao === 'NAO'),
});

/** Último dia do mês anterior, dd-mm-aaaa (data usada no nome do mapa Status 18). */
export function statusDate(today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function safeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapFileNames(kind: MapKind, label: string, today = new Date()): string[] {
  const l = label.trim();
  return kind === 'comite'
    ? [`${l} Comitê.html`, `${l} estimados - Comitê.html`].map(safeFileName)
    : [safeFileName(`Mapa cartográfico Censo de IP ${l} - ${statusDate(today)}.html`)];
}

interface MapSource {
  id: string;
  data: unknown;
}

const source = (id: string, data: unknown): MapSource => ({ id, data });

function polygonLayer(src: string) {
  return {
    id: `Polygon_${src}`,
    source: src,
    type: 'fill',
    paint: { 'fill-color': 'rgba(240, 255, 0, 0)', 'fill-outline-color': 'rgba(0, 0, 0, 1)' },
    filter: ['==', ['geometry-type'], 'Polygon'],
    below_layer_id: null,
  };
}

function pointLayer(src: string, color: string) {
  return {
    id: `Point_${src}`,
    source: src,
    type: 'circle',
    paint: { 'circle-radius': 4, 'circle-color': color },
    filter: ['==', ['geometry-type'], 'Point'],
    below_layer_id: null,
  };
}

/** JSON seguro dentro de <script> (um "</script>" nos dados não fecha a tag). */
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** Mesmo HTML gerado pelo mapboxgl_notebook (Mapbox GL JS 0.52, estilo streets-v9, zoom 10). */
export function mapboxHtml(o: {
  token: string;
  center: [number, number];
  sources: MapSource[];
  layers: unknown[];
}): string {
  const sources = o.sources.map((s) => ({ id: s.id, data: s.data, type: 'geojson' }));
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset='utf-8' />
    <title>map</title>
    <meta name='viewport' content='initial-scale=1,maximum-scale=1,user-scalable=no' />
    <script src='https://api.tiles.mapbox.com/mapbox-gl-js/v0.52.0/mapbox-gl.js'></script>
    <link href='https://api.tiles.mapbox.com/mapbox-gl-js/v0.52.0/mapbox-gl.css' rel='stylesheet' />
    <style>
        body { margin:0; padding:0; }
        #map { position:absolute; top:0; bottom:0; width:100%; }
    </style>
</head>
<body>
<div id='map'></div>


<script>
mapboxgl.accessToken = ${js(o.token)};
var map = new mapboxgl.Map({
    container: "map", // container id
    style: "mapbox://styles/mapbox/streets-v9", // stylesheet location
    center: ${js(o.center)}, // starting position [lng, lat]
    zoom: 10 // starting zoom
});


let sources = ${js(sources)};
let layers = ${js(o.layers)};


map.on('load', function(){

  for (let i=0; i < sources.length; i++) {
    let source = sources[i];
    map.addSource(
        source.id, {
        'type': source.type,
        'data': source.data
    });
  }

  for (let i=0; i < layers.length; i++) {
      if (map.getLayer(layers[i]['id']) === undefined) {
          if (layers[i]['below_layer_id'] === null) {
            map.addLayer(layers[i]);
          } else {
            map.addLayer(layers[i], layers[i]['below_layer_id']);
          }
      }
  }

});
</script>


</body>
</html>
`;
}

export interface MapFile {
  name: string;
  html: string;
  /** Pontos desenhados (atual + anterior) */
  points: number;
}

export interface MapInput {
  kind: MapKind;
  /** Nome usado nos arquivos (ex.: "Fortaleza SR 12") */
  label: string;
  limite: GeoCollection | GeoFeature;
  atual: PointCollection;
  /** Só no mapa do comitê */
  anterior?: PointCollection;
  token: string;
  /** Centro quando o censo atual não tem pontos [lng, lat] */
  fallbackCenter: [number, number];
  today?: Date;
}

/** Comitê: todos os pontos + só os estimados (medição = NAO). Status 18: só o censo atual. */
export function buildMapFiles(m: MapInput): MapFile[] {
  // Como no notebook: o mapa abre no primeiro ponto do censo atual.
  const center = m.atual.features[0]?.geometry.coordinates ?? m.fallbackCenter;
  const names = mapFileNames(m.kind, m.label, m.today);
  const limite = source('Limite', m.limite);
  const file = (name: string, sources: MapSource[], colors: string[]): MapFile => ({
    name,
    html: mapboxHtml({
      token: m.token,
      center,
      sources,
      layers: [polygonLayer('Limite'), ...sources.slice(1).map((s, i) => pointLayer(s.id, colors[i]))],
    }),
    points: sources
      .slice(1)
      .reduce((n, s) => n + (s.data as PointCollection).features.length, 0),
  });

  if (m.kind === 'status18') {
    return [file(names[0], [limite, source('Pontos', m.atual)], [COLOR_ATUAL])];
  }
  const anterior = m.anterior ?? { type: 'FeatureCollection', features: [] };
  return [
    file(
      names[0],
      [limite, source('Pontos', m.atual), source('Pontos anterior', anterior)],
      [COLOR_ATUAL, COLOR_ANTERIOR],
    ),
    file(
      names[1],
      [
        limite,
        source('Pontos estimados', onlyEstimados(m.atual)),
        source('Pontos estimados anterior', onlyEstimados(anterior)),
      ],
      [COLOR_ATUAL, COLOR_ANTERIOR],
    ),
  ];
}
