import proj4 from 'proj4';
import shp from 'shpjs';
import type { Bounds } from '@/types';
import { kmlToGeoJson } from './kml';

/**
 * Limites (polígonos) importados pelo usuário: shapefile (.zip ou .shp + .dbf + .prj + .cpg), GeoJSON
 * ou KML.
 * O shpjs reprojeta para WGS84 usando o .prj. As geometrias ficam no IndexedDB (podem ser grandes demais
 * para o localStorage); o store guarda só nome/cor/visibilidade.
 */

type Position = number[];
export interface GeoFeature {
  type: 'Feature';
  geometry: { type: string; coordinates?: unknown; geometries?: GeoFeature['geometry'][] } | null;
  properties: Record<string, unknown> | null;
}
export interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface ParsedBoundary {
  name: string;
  data: GeoCollection;
  bounds: Bounds | null;
  /** Coordenadas sem .prj convertidas pelo CRS de fallback */
  reprojected: boolean;
}

const ext = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const base = (name: string) => name.slice(0, name.lastIndexOf('.')).toLowerCase();
const stem = (name: string) => name.slice(0, name.lastIndexOf('.')) || name;

function eachPosition(coords: unknown, fn: (p: Position) => Position | void): unknown {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === 'number') return fn(coords as Position) ?? coords;
  return coords.map((c) => eachPosition(c, fn));
}

function mapGeometry(
  g: GeoFeature['geometry'],
  fn: (p: Position) => Position | void,
): GeoFeature['geometry'] {
  if (!g) return g;
  if (g.type === 'GeometryCollection')
    return { ...g, geometries: (g.geometries ?? []).map((x) => mapGeometry(x, fn)) };
  return { ...g, coordinates: eachPosition(g.coordinates, fn) };
}

function boundsOf(fc: GeoCollection): Bounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const f of fc.features) {
    mapGeometry(f.geometry, ([lng, lat]) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });
  }
  return Number.isFinite(minLat) ? { minLat, maxLat, minLng, maxLng } : null;
}

/** Coordenadas fora de lon/lat: arquivo sem .prj em sistema projetado (ex.: UTM). */
function isProjected(b: Bounds | null) {
  return (
    !!b &&
    (Math.abs(b.minLng) > 180 ||
      Math.abs(b.maxLng) > 180 ||
      Math.abs(b.minLat) > 90 ||
      Math.abs(b.maxLat) > 90)
  );
}

function normalize(input: unknown): GeoCollection {
  const o = input as { type?: string };
  if (o?.type === 'FeatureCollection') return input as GeoCollection;
  if (o?.type === 'Feature') return { type: 'FeatureCollection', features: [input as GeoFeature] };
  if (o?.type)
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: input as GeoFeature['geometry'], properties: {} }],
    };
  throw new Error('Arquivo GeoJSON inválido');
}

function finish(name: string, raw: unknown, fallbackProj4: string | null): ParsedBoundary {
  const fc = normalize(raw);
  fc.features = fc.features.filter((f) => f.geometry);
  if (!fc.features.length) throw new Error(`"${name}" não tem geometrias`);
  let bounds = boundsOf(fc);
  let reprojected = false;
  if (isProjected(bounds)) {
    if (!fallbackProj4) {
      throw new Error(
        `"${name}" está em coordenadas projetadas e sem o arquivo .prj — inclua o .prj junto do .shp`,
      );
    }
    const conv = proj4(fallbackProj4, 'WGS84');
    fc.features = fc.features.map((f) => ({
      ...f,
      geometry: mapGeometry(f.geometry, (p) => conv.forward([p[0], p[1]])),
    }));
    bounds = boundsOf(fc);
    reprojected = true;
    if (isProjected(bounds))
      throw new Error(`Não foi possível converter "${name}" para latitude/longitude`);
  }
  return { name, data: fc, bounds, reprojected };
}

/**
 * Lê os arquivos escolhidos. Aceita .zip (shapefile compactado), .shp com seus .dbf/.prj/.cpg
 * (mesmo nome), .geojson/.json e .kml. Sem .prj, usa `fallbackProj4` (CRS da camada ativa).
 */
export async function readBoundaryFiles(
  files: File[],
  fallbackProj4: string | null,
): Promise<ParsedBoundary[]> {
  const out: ParsedBoundary[] = [];
  const byBase = new Map<string, Map<string, File>>();
  for (const f of files) {
    const e = ext(f.name);
    if (e === 'zip') {
      const res = (await shp(await f.arrayBuffer())) as unknown;
      const list = (Array.isArray(res) ? res : [res]) as (GeoCollection & { fileName?: string })[];
      for (const fc of list) {
        const name = list.length > 1 && fc.fileName ? fc.fileName.split('/').pop()! : stem(f.name);
        out.push(finish(name, fc, fallbackProj4));
      }
    } else if (e === 'geojson' || e === 'json') {
      out.push(finish(stem(f.name), JSON.parse(await f.text()), fallbackProj4));
    } else if (e === 'kml') {
      out.push(finish(stem(f.name), kmlToGeoJson(await f.text()), fallbackProj4));
    } else if (['shp', 'dbf', 'prj', 'cpg', 'shx'].includes(e)) {
      const k = base(f.name);
      if (!byBase.has(k)) byBase.set(k, new Map());
      byBase.get(k)!.set(e, f);
    } else {
      throw new Error(`Formato não suportado: ${f.name}`);
    }
  }
  for (const parts of byBase.values()) {
    const shpFile = parts.get('shp');
    if (!shpFile) {
      throw new Error(`Falta o arquivo .shp de "${[...parts.values()][0].name}"`);
    }
    const res = await shp({
      shp: await shpFile.arrayBuffer(),
      dbf: parts.has('dbf') ? await parts.get('dbf')!.arrayBuffer() : undefined,
      prj: parts.has('prj') ? await parts.get('prj')!.text() : undefined,
      cpg: parts.has('cpg') ? await parts.get('cpg')!.text() : undefined,
    });
    out.push(finish(stem(shpFile.name), res, fallbackProj4));
  }
  return out;
}

/** Polígonos ([anel][ponto][lng, lat]) de uma geometria; linhas e pontos são ignorados. */
function polygonsOf(g: GeoFeature['geometry']): number[][][][] {
  if (!g) return [];
  if (g.type === 'GeometryCollection') return (g.geometries ?? []).flatMap(polygonsOf);
  const ring = (r: unknown) =>
    Array.isArray(r) ? (r as number[][]).map((p) => [Number(p[0]), Number(p[1])]) : [];
  if (g.type === 'Polygon') return [(g.coordinates as unknown[]).map(ring)];
  if (g.type === 'MultiPolygon')
    return (g.coordinates as unknown[][]).map((poly) => poly.map(ring));
  return [];
}

/**
 * Polígonos do limite para as ferramentas (Fora do limite): de todas as feições ou só da feição
 * `index`.
 */
export function boundaryPolygons(fc: GeoCollection, index: number | null = null): number[][][][] {
  const features = index === null ? fc.features : fc.features.slice(index, index + 1);
  return features.flatMap((f) => polygonsOf(f.geometry));
}

const NAME_KEY = /^(nome|name|nm_|nm|municipio|munic|bairro|setor|descri|label|titulo|id)/i;

/** Nome de cada feição pelo atributo que parece nome (nome, NM_MUN, name…); senão "Feição N". */
export function featureLabels(fc: GeoCollection): string[] {
  const text = (v: unknown) =>
    v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim();
  const keys = Object.keys(fc.features.find((f) => f.properties)?.properties ?? {});
  const key =
    keys.find((k) => NAME_KEY.test(k) && fc.features.some((f) => text(f.properties?.[k]))) ??
    keys.find((k) =>
      fc.features.some((f) => typeof f.properties?.[k] === 'string' && text(f.properties[k])),
    );
  return fc.features.map((f, i) => {
    const v = key ? text(f.properties?.[key]) : '';
    return v || `Feição ${i + 1}`;
  });
}

const M_PER_DEG = 111_320;

interface Box {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

const boxesOf = new WeakMap<GeoCollection, (Box | null)[]>();

function walkCoords(coords: unknown, fn: (lng: number, lat: number) => void) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') fn(Number(coords[0]), Number(coords[1]));
  else for (const c of coords) walkCoords(c, fn);
}

function boxOf(g: GeoFeature['geometry']): Box | null {
  let box: Box | null = null;
  const add = (lng: number, lat: number) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    if (!box) box = { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat };
    else {
      if (lng < box.minLng) box.minLng = lng;
      if (lng > box.maxLng) box.maxLng = lng;
      if (lat < box.minLat) box.minLat = lat;
      if (lat > box.maxLat) box.maxLat = lat;
    }
  };
  if (!g) return null;
  if (g.type === 'GeometryCollection') {
    for (const c of g.geometries ?? []) {
      const b = boxOf(c);
      if (!b) continue;
      add(b.minLng, b.minLat);
      add(b.maxLng, b.maxLat);
    }
    return box;
  }
  walkCoords(g.coordinates, add);
  return box;
}

function featureBoxes(fc: GeoCollection): (Box | null)[] {
  let boxes = boxesOf.get(fc);
  if (!boxes) {
    boxes = fc.features.map((f) => boxOf(f.geometry));
    boxesOf.set(fc, boxes);
  }
  return boxes;
}

function ringHas(ring: number[][], lng: number, lat: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat) {
      const xi = ring[i][0];
      const xj = ring[j][0];
      if (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function polygonHas(coords: number[][][], lng: number, lat: number) {
  if (!coords[0] || !ringHas(coords[0], lng, lat)) return false;
  for (let h = 1; h < coords.length; h++) if (ringHas(coords[h], lng, lat)) return false;
  return true;
}

function contains(g: GeoFeature['geometry'], lng: number, lat: number): boolean {
  if (!g) return false;
  if (g.type === 'GeometryCollection') return (g.geometries ?? []).some((c) => contains(c, lng, lat));
  if (g.type === 'Polygon') return polygonHas(g.coordinates as number[][][], lng, lat);
  if (g.type === 'MultiPolygon')
    return (g.coordinates as number[][][][]).some((p) => polygonHas(p, lng, lat));
  return false;
}

function toMeters(lng: number, lat: number, lng0: number, lat0: number) {
  const cos = Math.cos((lat0 * Math.PI) / 180) || 1e-6;
  return [(lng - lng0) * M_PER_DEG * cos, (lat - lat0) * M_PER_DEG];
}

function segDistM(lng: number, lat: number, a: number[], b: number[]) {
  const [ax, ay] = toMeters(a[0], a[1], lng, lat);
  const [bx, by] = toMeters(b[0], b[1], lng, lat);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (-ax * dx - ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function ringDist(ring: number[][], lng: number, lat: number, closed: boolean) {
  let best = Infinity;
  const n = ring.length;
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const d = segDistM(lng, lat, a, b);
    if (d < best) best = d;
  }
  return best;
}

function edgeDist(g: GeoFeature['geometry'], lng: number, lat: number): number {
  if (!g) return Infinity;
  if (g.type === 'GeometryCollection')
    return Math.min(Infinity, ...(g.geometries ?? []).map((c) => edgeDist(c, lng, lat)));
  if (g.type === 'Point') return segDistM(lng, lat, g.coordinates as number[], g.coordinates as number[]);
  if (g.type === 'MultiPoint')
    return Math.min(
      Infinity,
      ...(g.coordinates as number[][]).map((p) => segDistM(lng, lat, p, p)),
    );
  if (g.type === 'LineString') return ringDist(g.coordinates as number[][], lng, lat, false);
  if (g.type === 'MultiLineString')
    return Math.min(
      Infinity,
      ...(g.coordinates as number[][][]).map((r) => ringDist(r, lng, lat, false)),
    );
  if (g.type === 'Polygon')
    return Math.min(
      Infinity,
      ...(g.coordinates as number[][][]).map((r) => ringDist(r, lng, lat, true)),
    );
  if (g.type === 'MultiPolygon')
    return Math.min(
      Infinity,
      ...(g.coordinates as number[][][][]).flatMap((p) => p.map((r) => ringDist(r, lng, lat, true))),
    );
  return Infinity;
}

/**
 * Feição sob o clique: o polígono mais específico que contém o ponto, ou a linha/borda mais
 * próxima dentro de `toleranceM` metros. null se nenhuma feição alcança o ponto.
 */
export function featureAt(
  fc: GeoCollection,
  lng: number,
  lat: number,
  toleranceM = 0,
): number | null {
  const boxes = featureBoxes(fc);
  const cos = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const padLat = toleranceM / M_PER_DEG;
  const padLng = toleranceM / (M_PER_DEG * cos);
  let areaHit: { index: number; area: number } | null = null;
  let edgeHit: { index: number; dist: number } | null = null;
  for (let i = 0; i < fc.features.length; i++) {
    const box = boxes[i];
    if (
      !box ||
      lng < box.minLng - padLng ||
      lng > box.maxLng + padLng ||
      lat < box.minLat - padLat ||
      lat > box.maxLat + padLat
    )
      continue;
    const geometry = fc.features[i].geometry;
    if (contains(geometry, lng, lat)) {
      const area = (box.maxLng - box.minLng) * (box.maxLat - box.minLat);
      if (!areaHit || area < areaHit.area || (area === areaHit.area && i > areaHit.index))
        areaHit = { index: i, area };
      continue;
    }
    if (toleranceM <= 0) continue;
    const dist = edgeDist(geometry, lng, lat);
    if (dist <= toleranceM && (!edgeHit || dist < edgeHit.dist)) edgeHit = { index: i, dist };
  }
  return areaHit?.index ?? edgeHit?.index ?? null;
}

// ------------------------------------------------------------------ IndexedDB

const DB_NAME = 'geoanalisys-boundaries';
/** Nome antigo (o sistema se chamava "Censo GIS"): os limites são copiados para o banco novo. */
const OLD_DB_NAME = 'censo-gis-boundaries';
const STORE = 'geo';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openNamed(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Copia os limites do banco com o nome antigo (se existir) e o apaga. */
async function migrateOld(db: IDBDatabase) {
  try {
    const names = (await indexedDB.databases?.())?.map((d) => d.name) ?? [];
    if (!names.includes(OLD_DB_NAME)) return;
    const old = await openNamed(OLD_DB_NAME);
    if (!old) return;
    const entries: [IDBValidKey, unknown][] = [];
    if (old.objectStoreNames.contains(STORE)) {
      await new Promise<void>((resolve, reject) => {
        const req = old.transaction(STORE).objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve();
          entries.push([cur.key, cur.value]);
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
    }
    old.close();
    if (entries.length) {
      const tx = db.transaction(STORE, 'readwrite');
      for (const [key, value] of entries) tx.objectStore(STORE).put(value, key);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    indexedDB.deleteDatabase(OLD_DB_NAME);
  } catch {
    /* sem migração: limites antigos continuam no banco antigo */
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = openNamed(DB_NAME).then(async (db) => {
    if (db) await migrateOld(db);
    return db;
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Geometrias já lidas nesta sessão (evita reler o IndexedDB a cada render). */
const memory = new Map<string, GeoCollection>();

export const boundaryStore = {
  async get(id: string): Promise<GeoCollection | undefined> {
    const m = memory.get(id);
    if (m) return m;
    try {
      const db = await openDb();
      const data = db
        ? ((await done(db.transaction(STORE).objectStore(STORE).get(id))) as
            GeoCollection | undefined)
        : undefined;
      if (data) memory.set(id, data);
      return data;
    } catch {
      return undefined;
    }
  },

  /** Guarda a geometria; retorna false se não foi possível persistir (fica só nesta sessão). */
  async set(id: string, data: GeoCollection): Promise<boolean> {
    memory.set(id, data);
    try {
      const db = await openDb();
      if (!db) return false;
      await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(data, id));
      return true;
    } catch {
      return false;
    }
  },

  async remove(id: string) {
    memory.delete(id);
    try {
      const db = await openDb();
      if (db) await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
    } catch {
      /* nada a remover */
    }
  },
};
