/**
 * KML → GeoJSON (no navegador, via DOMParser). Cada Placemark vira uma feição com `name`,
 * `description`, os campos de ExtendedData (Data/SimpleData) e a pasta (Folder) de origem.
 * Geometrias: Point, LineString, LinearRing, Polygon, MultiGeometry e gx:Track. KML é sempre WGS84.
 */

type Position = number[];
interface Geometry {
  type: string;
  coordinates?: unknown;
  geometries?: Geometry[];
}
export interface KmlFeature {
  type: 'Feature';
  geometry: Geometry | null;
  properties: Record<string, unknown>;
}
export interface KmlCollection {
  type: 'FeatureCollection';
  features: KmlFeature[];
}

const children = (el: Element, name: string) =>
  [...el.children].filter((c) => c.localName === name);
const child = (el: Element, name: string) => children(el, name)[0];
const descendants = (el: Element | Document, name: string) =>
  [...el.getElementsByTagName('*')].filter((c) => c.localName === name);
const text = (el: Element | undefined) => el?.textContent?.trim() ?? '';

/** "lon,lat[,alt] lon,lat…" → posições 2D válidas. */
function coords(el: Element | undefined): Position[] {
  return text(el)
    .split(/\s+/)
    .map((t) => t.split(',').slice(0, 2).map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite));
}

/** Anel fechado de um LinearRing (ou null se tiver menos de 3 pontos). */
function ring(lr: Element | undefined): Position[] | null {
  const pts = coords(lr && child(lr, 'coordinates'));
  if (pts.length < 3) return null;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? pts : [...pts, a];
}

function geometry(el: Element): Geometry | null {
  switch (el.localName) {
    case 'Point': {
      const [p] = coords(child(el, 'coordinates'));
      return p ? { type: 'Point', coordinates: p } : null;
    }
    case 'LineString': {
      const pts = coords(child(el, 'coordinates'));
      return pts.length >= 2 ? { type: 'LineString', coordinates: pts } : null;
    }
    case 'LinearRing': {
      const r = ring(el);
      return r ? { type: 'Polygon', coordinates: [r] } : null;
    }
    case 'Polygon': {
      const boundaryRing = (b: Element | undefined) => ring(b && child(b, 'LinearRing'));
      const outer = boundaryRing(child(el, 'outerBoundaryIs'));
      if (!outer) return null;
      const inner = children(el, 'innerBoundaryIs')
        .map(boundaryRing)
        .filter((r): r is Position[] => !!r);
      return { type: 'Polygon', coordinates: [outer, ...inner] };
    }
    case 'Track': {
      const pts = children(el, 'coord')
        .map((c) => text(c).split(/\s+/).slice(0, 2).map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (pts.length === 1) return { type: 'Point', coordinates: pts[0] };
      return pts.length ? { type: 'LineString', coordinates: pts } : null;
    }
    case 'MultiGeometry':
    case 'MultiTrack': {
      const parts = [...el.children].map(geometry).filter((g): g is Geometry => !!g);
      if (!parts.length) return null;
      if (parts.length === 1) return parts[0];
      const t = parts[0].type;
      if (['Point', 'LineString', 'Polygon'].includes(t) && parts.every((p) => p.type === t))
        return { type: `Multi${t}`, coordinates: parts.map((p) => p.coordinates) };
      return { type: 'GeometryCollection', geometries: parts };
    }
    default:
      return null;
  }
}

const GEOMETRY_TAGS = new Set([
  'Point',
  'LineString',
  'LinearRing',
  'Polygon',
  'MultiGeometry',
  'Track',
  'MultiTrack',
]);

/** Pastas (Folder/Document com nome) acima do Placemark: "Pasta A / Subpasta". */
function folderPath(pm: Element): string {
  const names: string[] = [];
  for (let p = pm.parentElement; p; p = p.parentElement) {
    if (p.localName === 'Folder') {
      const n = text(child(p, 'name'));
      if (n) names.unshift(n);
    }
  }
  return names.join(' / ');
}

export function kmlToGeoJson(xml: string): KmlCollection {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement?.localName !== 'kml')
    throw new Error('Arquivo KML inválido');
  const features: KmlFeature[] = [];
  for (const pm of descendants(doc, 'Placemark')) {
    const props: Record<string, unknown> = {};
    const name = text(child(pm, 'name'));
    if (name) props.name = name;
    const description = text(child(pm, 'description'));
    if (description) props.description = description;
    const folder = folderPath(pm);
    if (folder) props.pasta = folder;
    const ext = child(pm, 'ExtendedData');
    if (ext) {
      for (const d of children(ext, 'Data')) {
        const k = d.getAttribute('name');
        if (k) props[k] = text(child(d, 'value'));
      }
      for (const sd of descendants(ext, 'SimpleData')) {
        const k = sd.getAttribute('name');
        if (k) props[k] = text(sd);
      }
    }
    const gEl = [...pm.children].find((c) => GEOMETRY_TAGS.has(c.localName));
    features.push({ type: 'Feature', geometry: gEl ? geometry(gEl) : null, properties: props });
  }
  if (!features.length) throw new Error('O KML não tem marcadores (Placemark)');
  return { type: 'FeatureCollection', features };
}

/** Converte um arquivo .kml em um arquivo .geojson (mesmo nome-base). */
export async function kmlFileToGeoJson(file: File): Promise<File> {
  const fc = kmlToGeoJson(await file.text());
  const name = file.name.replace(/\.kml$/i, '') + '.geojson';
  return new File([JSON.stringify(fc)], name, { type: 'application/geo+json' });
}
