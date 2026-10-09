import type { LayerPayloadFull } from '@/types';

/**
 * Cache persistente (IndexedDB) das camadas: só ID, posição, categoria e rótulo de cada ponto.
 * Ao reabrir o sistema a camada aparece sem baixar tudo de novo — o servidor só confirma a versão.
 * Falhas do IndexedDB (modo privado, cota) nunca quebram o mapa: apenas não há cache.
 */

const DB_NAME = 'geoanalisys-cache';
// Cache com o nome antigo ("Censo GIS"): só cache (rebaixado quando preciso), pode ser apagado.
try {
  if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('censo-gis-cache');
} catch {
  /* sem IndexedDB */
}
const STORE = 'layers';
/** Entradas guardadas por fonte (combinações de estilo/rótulo/filtros). */
const MAX_PER_SOURCE = 4;

interface Entry {
  key: string;
  sourceId: string;
  version: string;
  savedAt: number;
  payload: LayerPayloadFull;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('sourceId', 'sourceId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const layerCache = {
  async get(key: string): Promise<Entry | undefined> {
    try {
      const db = await openDb();
      if (!db) return undefined;
      return (await done(db.transaction(STORE).objectStore(STORE).get(key))) as Entry | undefined;
    } catch {
      return undefined;
    }
  },

  async set(key: string, sourceId: string, version: string, payload: LayerPayloadFull) {
    try {
      const db = await openDb();
      if (!db) return;
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      await done(
        store.put({ key, sourceId, version, savedAt: Date.now(), payload } satisfies Entry),
      );
      // Mantém só as combinações mais recentes de cada fonte (exclusão dentro do callback,
      // enquanto a transação ainda está ativa).
      const tx = db.transaction(STORE, 'readwrite').objectStore(STORE);
      const req = tx.index('sourceId').getAll(sourceId);
      req.onsuccess = () => {
        (req.result as Entry[])
          .sort((a, b) => b.savedAt - a.savedAt)
          .slice(MAX_PER_SOURCE)
          .forEach((e) => tx.delete(e.key));
      };
    } catch {
      /* sem cache */
    }
  },

  async clear() {
    try {
      const db = await openDb();
      if (db) await done(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
    } catch {
      /* sem cache */
    }
  },
};
