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
