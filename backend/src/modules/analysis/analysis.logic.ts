/**
 * Análises de posição dos pontos:
 * - Fora do limite: pontos fora dos polígonos de um limite (shapefile/GeoJSON/KML) e a distância até
 *   a borda mais próxima.
 * - Distância por atributo: pontos longe do ponto da camada de referência com o mesmo valor (ex.:
 *   medidor do Censo × medidor_nc das Medições) ou, sem referência, longe do centro dos pontos da
 *   própria camada com o mesmo valor.
 */
import { haversine, normalizeValue } from '../association/association.logic';

const RAD = Math.PI / 180;
/** Metros por grau na esfera da haversine (as distâncias batem com as das outras ferramentas). */
const M_PER_DEG = 6_371_008.8 * RAD;

/** [lng, lat] */
export type Position = [number, number];
/** 1º anel: contorno; os demais: buracos */
export type Polygon = Position[][];

export const MAX_VERTICES = 2_000_000;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Polígonos recebidos ([[[lng, lat], …], …], …]); erro se o formato ou as coordenadas forem inválidos. */
export function parsePolygons(input: unknown): Polygon[] {
  if (!Array.isArray(input) || !input.length) throw new Error('Informe os polígonos do limite');
  let vertices = 0;
  const out: Polygon[] = [];
  for (const poly of input) {
    if (!Array.isArray(poly)) throw new Error('Polígono inválido');
    const rings: Position[][] = [];
    for (const ring of poly) {
      if (!Array.isArray(ring)) throw new Error('Anel de polígono inválido');
      const pts: Position[] = [];
      for (const p of ring) {
        if (
          !Array.isArray(p) ||
          typeof p[0] !== 'number' ||
          typeof p[1] !== 'number' ||
          !(Math.abs(p[0]) <= 180) ||
          !(Math.abs(p[1]) <= 90)
        )
          throw new Error('Coordenada do limite inválida (esperado [longitude, latitude])');
        pts.push([p[0], p[1]]);
      }
      vertices += pts.length;
      if (vertices > MAX_VERTICES)
        throw new Error(
          `Limite grande demais (mais de ${MAX_VERTICES.toLocaleString('pt-BR')} vértices)`,
        );
      if (pts.length >= 3) rings.push(pts);
    }
    if (rings.length) out.push(rings);
  }
  if (!out.length) throw new Error('O limite não tem polígonos');
  return out;
}

/** Distância (m) de p ao segmento a–b, em projeção local (precisa para distâncias de até dezenas de km). */
function segmentDistance(
  lng: number,
  lat: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const kx = Math.cos(lat * RAD) * M_PER_DEG;
  const x1 = (ax - lng) * kx;
  const y1 = (ay - lat) * M_PER_DEG;
  const x2 = (bx - lng) * kx;
  const y2 = (by - lat) * M_PER_DEG;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? clamp(-(x1 * dx + y1 * dy) / len, 0, 1) : 0;
  return Math.hypot(x1 + t * dx, y1 + t * dy);
}

interface TreeNode {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Nós filhos, ou arestas (folha) */
  children: number[];
  leaf: boolean;
}

/** Fila de prioridade mínima (distância, item). */
class MinHeap {
  private d: number[] = [];
  private v: number[] = [];
  get size() {
    return this.d.length;
  }
  push(dist: number, item: number) {
    const { d, v } = this;
    let i = d.length;
    d.push(dist);
    v.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p] <= dist) break;
      d[i] = d[p];
      v[i] = v[p];
      i = p;
    }
    d[i] = dist;
    v[i] = item;
  }
  /** Retira o menor: [distância, item] */
  pop(): [number, number] {
    const { d, v } = this;
    const top: [number, number] = [d[0], v[0]];
    const ld = d.pop()!;
    const lv = v.pop()!;
    const n = d.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && d[c + 1] < d[c]) c++;
        if (d[c] >= ld) break;
        d[i] = d[c];
        v[i] = v[c];
        i = c;
      }
      d[i] = ld;
      v[i] = lv;
    }
    return top;
  }
}

/**
 * Árvore R empacotada (STR) das arestas: borda mais próxima em O(log n), inclusive para pontos
 * muito longe do limite.
 */
class EdgeTree {
  private readonly nodes: TreeNode[] = [];
  private readonly root: number;

  constructor(private readonly e: Float64Array) {
    const M = 16;
    const n = e.length / 4;
    let level: { minX: number; minY: number; maxX: number; maxY: number; id: number }[] = [];
    for (let k = 0; k < n; k++) {
      level.push({
        minX: Math.min(e[k * 4], e[k * 4 + 2]),
        minY: Math.min(e[k * 4 + 1], e[k * 4 + 3]),
        maxX: Math.max(e[k * 4], e[k * 4 + 2]),
        maxY: Math.max(e[k * 4 + 1], e[k * 4 + 3]),
        id: k,
      });
    }
    let leaf = true;
    do {
      const slices = Math.ceil(Math.sqrt(Math.ceil(level.length / M)));
      const perSlice = Math.ceil(level.length / slices);
      level.sort((a, b) => a.minX + a.maxX - (b.minX + b.maxX));
      const next: typeof level = [];
      for (let s = 0; s < level.length; s += perSlice) {
        const slice = level
          .slice(s, s + perSlice)
          .sort((a, b) => a.minY + a.maxY - (b.minY + b.maxY));
        for (let g = 0; g < slice.length; g += M) {
          const items = slice.slice(g, g + M);
          const node: TreeNode = {
            minX: Math.min(...items.map((x) => x.minX)),
            minY: Math.min(...items.map((x) => x.minY)),
            maxX: Math.max(...items.map((x) => x.maxX)),
            maxY: Math.max(...items.map((x) => x.maxY)),
            children: items.map((x) => x.id),
            leaf,
          };
          next.push({ ...node, id: this.nodes.push(node) - 1 });
        }
      }
      level = next;
      leaf = false;
    } while (level.length > 1);
    this.root = level[0].id;
  }

  /** Distância (m) até a aresta mais próxima. */
  nearest(lng: number, lat: number): number {
    const kx = Math.cos(lat * RAD) * M_PER_DEG;
    const e = this.e;
    const heap = new MinHeap();
    // Itens: nós ≥ 0; arestas como −(k + 1).
    heap.push(0, this.root);
    while (heap.size) {
      const [dist, item] = heap.pop();
      if (item < 0) return dist;
      const node = this.nodes[item];
      for (const c of node.children) {
        if (node.leaf) {
          heap.push(
            segmentDistance(lng, lat, e[c * 4], e[c * 4 + 1], e[c * 4 + 2], e[c * 4 + 3]),
            -(c + 1),
          );
        } else {
          const b = this.nodes[c];
          const dx = Math.max(b.minX - lng, 0, lng - b.maxX) * kx;
          const dy = Math.max(b.minY - lat, 0, lat - b.maxY) * M_PER_DEG;
          heap.push(Math.hypot(dx, dy), c);
        }
      }
    }
    return Infinity;
  }
}

interface IndexedPolygon {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  bandH: number;
  /** Arestas (índices) que cruzam cada faixa horizontal */
  bands: number[][];
}

/**
 * Área formada por um ou mais polígonos (união; um ponto num buraco está fora). Índices por faixas
 * (dentro/fora) e árvore R (borda mais próxima) mantêm a consulta rápida com limites detalhados.
 */
export class PolygonArea {
  /** Arestas: ax, ay, bx, by (lng/lat) */
  private readonly edges: Float64Array;
  private readonly polys: IndexedPolygon[] = [];
  private readonly minLng: number;
  private readonly maxLng: number;
  private readonly minLat: number;
  private readonly maxLat: number;
  /** Grade de polígonos (pelo retângulo de cada um) */
  private readonly polyGrid: number[][];
  private readonly polyG: number;
  private readonly tree: EdgeTree;

  constructor(polygons: Polygon[]) {
    const flat: number[] = [];
    const ranges: [number, number][] = [];
    for (const poly of polygons) {
      const start = flat.length / 4;
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          if (a[0] === b[0] && a[1] === b[1]) continue;
          flat.push(a[0], a[1], b[0], b[1]);
        }
      }
      if (flat.length / 4 > start) ranges.push([start, flat.length / 4]);
    }
    if (!ranges.length) throw new Error('O limite não tem polígonos');
    this.edges = Float64Array.from(flat);
    const e = this.edges;

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [from, to] of ranges) {
      const p: IndexedPolygon = {
        minLng: Infinity,
        maxLng: -Infinity,
        minLat: Infinity,
        maxLat: -Infinity,
        bandH: 0,
        bands: [],
      };
      for (let k = from; k < to; k++) {
        for (const [x, y] of [
          [e[k * 4], e[k * 4 + 1]],
          [e[k * 4 + 2], e[k * 4 + 3]],
        ]) {
          if (x < p.minLng) p.minLng = x;
          if (x > p.maxLng) p.maxLng = x;
          if (y < p.minLat) p.minLat = y;
          if (y > p.maxLat) p.maxLat = y;
        }
      }
      const nb = clamp(Math.ceil(Math.sqrt(to - from)), 1, 1024);
      p.bandH = (p.maxLat - p.minLat) / nb || 1;
      p.bands = Array.from({ length: nb }, () => []);
      for (let k = from; k < to; k++) {
        const y0 = Math.min(e[k * 4 + 1], e[k * 4 + 3]);
        const y1 = Math.max(e[k * 4 + 1], e[k * 4 + 3]);
        const b0 = clamp(Math.floor((y0 - p.minLat) / p.bandH), 0, nb - 1);
        const b1 = clamp(Math.floor((y1 - p.minLat) / p.bandH), 0, nb - 1);
        for (let b = b0; b <= b1; b++) p.bands[b].push(k);
      }
      this.polys.push(p);
      minLng = Math.min(minLng, p.minLng);
      maxLng = Math.max(maxLng, p.maxLng);
      minLat = Math.min(minLat, p.minLat);
      maxLat = Math.max(maxLat, p.maxLat);
    }
    this.minLng = minLng;
    this.maxLng = maxLng;
    this.minLat = minLat;
    this.maxLat = maxLat;
    const spanW = maxLng - minLng || 1e-9;
    const spanH = maxLat - minLat || 1e-9;

    const cell = (G: number, x: number, min: number, span: number) =>
      clamp(Math.floor(((x - min) / span) * G), 0, G - 1);

    this.polyG = clamp(Math.ceil(Math.sqrt(this.polys.length)), 1, 64);
    this.polyGrid = Array.from({ length: this.polyG * this.polyG }, () => []);
    this.polys.forEach((p, i) => {
      const c0 = cell(this.polyG, p.minLng, minLng, spanW);
      const c1 = cell(this.polyG, p.maxLng, minLng, spanW);
      const r0 = cell(this.polyG, p.minLat, minLat, spanH);
      const r1 = cell(this.polyG, p.maxLat, minLat, spanH);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) this.polyGrid[r * this.polyG + c].push(i);
    });

    this.tree = new EdgeTree(e);
  }

  get edgeCount() {
    return this.edges.length / 4;
  }

  /** Dentro de algum polígono (fora dos buracos dele). */
  contains(lng: number, lat: number): boolean {
    if (lng < this.minLng || lng > this.maxLng || lat < this.minLat || lat > this.maxLat)
      return false;
    const G = this.polyG;
    const c = clamp(
      Math.floor(((lng - this.minLng) / (this.maxLng - this.minLng || 1e-9)) * G),
      0,
      G - 1,
    );
    const r = clamp(
      Math.floor(((lat - this.minLat) / (this.maxLat - this.minLat || 1e-9)) * G),
      0,
      G - 1,
    );
    const e = this.edges;
    for (const i of this.polyGrid[r * G + c]) {
      const p = this.polys[i];
      if (lng < p.minLng || lng > p.maxLng || lat < p.minLat || lat > p.maxLat) continue;
      const band = p.bands[clamp(Math.floor((lat - p.minLat) / p.bandH), 0, p.bands.length - 1)];
      let inside = false;
      for (const k of band) {
        const ax = e[k * 4];
        const ay = e[k * 4 + 1];
        const bx = e[k * 4 + 2];
        const by = e[k * 4 + 3];
        if (ay > lat !== by > lat && lng < ((bx - ax) * (lat - ay)) / (by - ay) + ax)
          inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  /** Distância (m) até a borda mais próxima (contorno ou buraco). */
  distance(lng: number, lat: number): number {
    return this.tree.nearest(lng, lat);
  }
}

// --------------------------------------------------------------- distância por atributo

export interface AttrPoint {
  lat: number | null;
  lng: number | null;
  /** Valor do atributo (original) */
  value: unknown;
}

/** Valor comparável: sem acentos/maiúsculas; com `stripZeros`, "000123" = "123". */
export function attrKey(v: unknown, stripZeros: boolean): string | null {
  const s = normalizeValue(v);
  if (s === null || !stripZeros || !/^\d+$/.test(s)) return s;
  return s.replace(/^0+(?=\d)/, '');
}

export interface AttrOptions {
  maxDistance: number;
  stripZeros: boolean;
  /** Valores de preenchimento que não identificam o local (ex.: "SN", "0") */
  ignore: string[];
}

/** Chave de cada valor; ignorados viram `false`. */
function keyer(o: AttrOptions) {
  const ignored = new Set(o.ignore.map((v) => attrKey(v, o.stripZeros)).filter((k) => k !== null));
  return (v: unknown): string | null | false => {
    const k = attrKey(v, o.stripZeros);
    return k !== null && ignored.has(k) ? false : k;
  };
}

export type AttrStatus =
  /** Sem valor no atributo */
  | 'noValue'
  /** Valor da lista de ignorados */
  | 'ignored'
  | 'noCoords'
  /** Valor não encontrado na referência */
  | 'noMatch'
  /** Grupo menor que o mínimo (sem referência: não dá para achar o centro) */
  | 'fewPoints'
  | 'ok'
  | 'far';

export interface AttrResult {
  status: AttrStatus;
  /** Distância (m) até o ponto da referência mais próximo com o mesmo valor, ou até o centro */
  distance: number | null;
  /** Ponto da referência mais próximo (índice em `refs`) */
  ref: number;
  /** Centro dos pontos com o mesmo valor (sem referência) */
  center: { lat: number; lng: number } | null;
  /** Pontos com o mesmo valor: na referência ou na própria camada */
  sameValue: number;
}

const hasCoords = (p: AttrPoint) => p.lat !== null && p.lng !== null;

/** Com referência: distância até o ponto da referência mais próximo com o mesmo valor. */
export function farFromReference(
  pts: AttrPoint[],
  refs: AttrPoint[],
  o: AttrOptions,
): AttrResult[] {
  const keyOf = keyer(o);
  const byKey = new Map<string, number[]>();
  refs.forEach((r, j) => {
    const k = keyOf(r.value);
    if (!k || !hasCoords(r)) return;
    const list = byKey.get(k);
    if (list) list.push(j);
    else byKey.set(k, [j]);
  });
  return pts.map((p) => {
    const k = keyOf(p.value);
    const empty = { distance: null, ref: -1, center: null, sameValue: 0 };
    if (k === null) return { status: 'noValue', ...empty };
    if (k === false) return { status: 'ignored', ...empty };
    const list = byKey.get(k);
    if (!hasCoords(p)) return { status: 'noCoords', ...empty, sameValue: list?.length ?? 0 };
    if (!list) return { status: 'noMatch', ...empty };
    let best = Infinity;
    let ref = -1;
    for (const j of list) {
      const d = haversine(p.lat!, p.lng!, refs[j].lat!, refs[j].lng!);
      if (d < best) [best, ref] = [d, j];
    }
    return {
      status: best > o.maxDistance ? 'far' : 'ok',
      distance: best,
      ref,
      center: null,
      sameValue: list.length,
    };
  });
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Sem referência: distância até o centro dos pontos da própria camada com o mesmo valor. A mediana
 * (por latitude e longitude) não é puxada pelos pontos distantes; a média é.
 */
export function farFromCenter(
  pts: AttrPoint[],
  o: AttrOptions & { center: 'median' | 'mean'; minPoints: number },
): AttrResult[] {
  const keyOf = keyer(o);
  const keys = pts.map((p) => keyOf(p.value));
  const groups = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = keys[i];
    if (!k || !hasCoords(p)) return;
    const list = groups.get(k);
    if (list) list.push(i);
    else groups.set(k, [i]);
  });
  const centers = new Map<string, { lat: number; lng: number }>();
  for (const [k, list] of groups) {
    if (list.length < o.minPoints) continue;
    const lats = list.map((i) => pts[i].lat!);
    const lngs = list.map((i) => pts[i].lng!);
    centers.set(
      k,
      o.center === 'median'
        ? { lat: median(lats), lng: median(lngs) }
        : {
            lat: lats.reduce((a, b) => a + b, 0) / lats.length,
            lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
          },
    );
  }
  return pts.map((p, i) => {
    const k = keys[i];
    const empty = { distance: null, ref: -1, center: null, sameValue: 0 };
    if (k === null) return { status: 'noValue', ...empty };
    if (k === false) return { status: 'ignored', ...empty };
    const size = groups.get(k)?.length ?? 0;
    if (!hasCoords(p)) return { status: 'noCoords', ...empty, sameValue: size };
    const c = centers.get(k);
    if (!c) return { status: 'fewPoints', ...empty, sameValue: size };
    const d = haversine(p.lat!, p.lng!, c.lat, c.lng);
    return {
      status: d > o.maxDistance ? 'far' : 'ok',
      distance: d,
      ref: -1,
      center: c,
      sameValue: size,
    };
  });
}
