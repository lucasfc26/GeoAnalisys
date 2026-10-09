import type { LngLat, Map as MlMap } from 'maplibre-gl';
import {
  categoryStyle,
  hasLabels,
  labelBufferColor,
  labelBufferWidth,
  labelCanvasFont,
  pointOutline,
  pointOutlineWidth,
} from '@/lib/layers';
import type { LatLng, LayerPayloadFull, LayerStyle, MapCluster, MapPointsResponse } from '@/types';
import { PX_PER_CM } from '@/utils/geo';

/**
 * Renderização dos pontos em um único <canvas> sobre o mapa (MapLibre).
 *
 * Muito mais leve que um marcador (ou feature) por ponto: dezenas de milhares de pontos são
 * desenhados em poucos milissegundos, agrupados por cor/tamanho. O clique é resolvido aqui mesmo
 * (teste de distância sobre o que foi desenhado), sem objetos por ponto.
 */

/**
 * Escala em "pixels por unidade do mundo de 256 px" (convenção usada nos cálculos daqui) para um
 * zoom do MapLibre, cujo mundo tem 512 px no zoom 0.
 */
export const worldScaleOf = (zoom: number) => 2 ** (zoom + 1);
/** Zoom do MapLibre para uma escala (inverso de worldScaleOf). */
export const zoomOfScale = (scale: number) => Math.log2(scale) - 1;

const TAU = Math.PI * 2;
/** Área extra desenhada fora da tela (fração do viewport) para o arraste não mostrar bordas vazias. */
const MARGIN = 0.25;
/** Espera após o último movimento de zoom para redesenhar os pontos na nova escala. */
const SETTLE_MS = 250;
const MAX_LABELS = 4000;
const LABEL_CELL = 4;
/** Direções tentadas ao redor do ponto, em ordem de preferência (como "ao redor do ponto" no QGIS). */
const LABEL_DIRS: readonly [number, number][] = [
  [0, -1], // acima
  [1, 0], // direita
  [0, 1], // abaixo
  [-1, 0], // esquerda
  [0.75, -0.75],
  [-0.75, -0.75],
  [0.75, 0.75],
  [-0.75, 0.75],
];
/** Afastamentos extras (em alturas de texto) quando não cabe junto ao ponto; ligados por uma linha. */
const LABEL_RINGS = [0, 1.4, 2.8];
/** Ocupação da grade de rótulos: ponto (evitado se possível) e rótulo (nunca sobreposto). */
const CELL_POINT = 1;
const CELL_LABEL = 2;

export const worldX = (lng: number) => 256 * (lng / 360 + 0.5);
export function worldY(lat: number) {
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return 256 * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI));
}

// ------------------------------------------------------------------ nível de detalhe

/** Metros representados por 1 cm de tela na escala atual (Web Mercator). */
export function metersPerCm(worldScale: number, lat: number) {
  return ((156543.03392 * Math.cos((lat * Math.PI) / 180)) / worldScale) * PX_PER_CM;
}

/**
 * Fração dos pontos desenhada conforme a escala (menos pontos quando afastado):
 * 1 cm ≥ 1000 km → 10% · ≥ 100 km → 30% · ≥ 10 km → 70% · 10–5 km → 70%→100% · ≤ 5 km → 100%.
 */
export function lodFraction(mPerCm: number) {
  if (mPerCm >= 1_000_000) return 0.1;
  if (mPerCm >= 100_000) return 0.3;
  if (mPerCm >= 10_000) return 0.7;
  if (mPerCm > 5_000) return 0.7 + (0.3 * (10_000 - mPerCm)) / 5_000;
  return 1;
}

/** Nota estável (0..1) de uma coordenada: decide quais pontos ficam quando só uma parte é desenhada. */
function rankOf(key: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ dados preparados

/** Pontos agrupados por coordenada (registros sobrepostos), em arrays tipados. */
export interface PreparedLayer {
  kind: 'full' | 'viewport';
  categorized: boolean;
  /** Total de registros */
  total: number;
  cats: (string | null)[];
  catCounts: number[];
  /** Número de coordenadas (grupos) */
  n: number;
  key: string[];
  x: Float64Array;
  y: Float64Array;
  lat: Float64Array;
  lng: Float64Array;
  wx: Float64Array;
  wy: Float64Array;
  /** Registros do grupo g: índices start[g] .. start[g+1]-1 em rec* */
  start: Int32Array;
  recId: (string | null)[];
  recCat: Int32Array;
  recLabel: (string | null)[] | null;
  /** Modo viewport: total real e IDs (quando o servidor enviou) por grupo */
  groupCount: Int32Array | null;
  groupIds: (string[] | null)[] | null;
  /** Modo viewport: rótulos de cada registro do grupo (grupos com vários registros) */
  groupLabels: ((string | null)[] | null)[] | null;
  clusters: { cluster: MapCluster; wx: number; wy: number }[];
  keyIndex: Map<string, number>;
  /** Nota estável de cada grupo para o nível de detalhe (ver lodFraction) */
  rank: Float32Array;
}

export function prepareFull(p: LayerPayloadFull): PreparedLayer {
  const n = p.ids.length;
  const keyIndex = new Map<string, number>();
  const groupOf = new Int32Array(n);
  const keys: string[] = [];
  const first: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = `${p.x[i]}|${p.y[i]}`;
    let g = keyIndex.get(k);
    if (g === undefined) {
      g = keys.length;
      keyIndex.set(k, g);
      keys.push(k);
      first.push(i);
    }
    groupOf[i] = g;
  }
  const G = keys.length;
  const start = new Int32Array(G + 1);
  for (let i = 0; i < n; i++) start[groupOf[i] + 1]++;
  for (let g = 0; g < G; g++) start[g + 1] += start[g];
  const pos = start.slice(0, G);
  const recId = new Array<string | null>(n);
  const recCat = new Int32Array(n);
  const recLabel = p.labels ? new Array<string | null>(n) : null;
  for (let i = 0; i < n; i++) {
    const j = pos[groupOf[i]]++;
    recId[j] = p.ids[i];
    recCat[j] = p.cat ? p.cat[i] : 0;
    if (recLabel) recLabel[j] = p.labels![i];
  }
  const cats = p.cats ?? [null];
  const catCounts = new Array<number>(cats.length).fill(0);
  for (let j = 0; j < n; j++) catCounts[recCat[j]]++;

  const x = new Float64Array(G);
  const y = new Float64Array(G);
  const lat = new Float64Array(G);
  const lng = new Float64Array(G);
  const wx = new Float64Array(G);
  const wy = new Float64Array(G);
  for (let g = 0; g < G; g++) {
    const i = first[g];
    x[g] = p.x[i];
    y[g] = p.y[i];
    lat[g] = p.lat[i];
    lng[g] = p.lng[i];
    wx[g] = worldX(p.lng[i]);
    wy[g] = worldY(p.lat[i]);
  }
  return {
    kind: 'full',
    categorized: !!p.cats,
    total: n,
    cats,
    catCounts,
    n: G,
    key: keys,
    x,
    y,
    lat,
    lng,
    wx,
    wy,
    start,
    recId,
    recCat,
    recLabel,
    groupCount: null,
    groupIds: null,
    groupLabels: null,
    clusters: [],
    keyIndex,
    rank: Float32Array.from(keys, rankOf),
  };
}

/** Tabelas grandes demais para carregar inteiras: grupos/clusters do viewport atual. */
export function prepareViewport(r: MapPointsResponse, categorized: boolean): PreparedLayer {
  const G = r.groups.length;
  const catIndex = new Map<string | null, number>();
  const cats: (string | null)[] = [];
  const catCounts: number[] = [];
  const keyIndex = new Map<string, number>();
  const out = {
    x: new Float64Array(G),
    y: new Float64Array(G),
    lat: new Float64Array(G),
    lng: new Float64Array(G),
    wx: new Float64Array(G),
    wy: new Float64Array(G),
    start: new Int32Array(G + 1),
    recId: new Array<string | null>(G),
    recCat: new Int32Array(G),
    recLabel: new Array<string | null>(G),
    groupCount: new Int32Array(G),
    groupIds: new Array<string[] | null>(G),
    groupLabels: new Array<(string | null)[] | null>(G),
  };
  r.groups.forEach((g, i) => {
    const v = categorized ? g.category : null;
    let c = catIndex.get(v);
    if (c === undefined) {
      c = cats.length;
      catIndex.set(v, c);
      cats.push(v);
      catCounts.push(0);
    }
    catCounts[c] += g.count;
    keyIndex.set(g.key, i);
    out.x[i] = g.x;
    out.y[i] = g.y;
    out.lat[i] = g.lat;
    out.lng[i] = g.lng;
    out.wx[i] = worldX(g.lng);
    out.wy[i] = worldY(g.lat);
    out.start[i + 1] = i + 1;
    out.recId[i] = g.ids?.length === 1 ? g.ids[0] : null;
    out.recCat[i] = c;
    out.recLabel[i] = g.count === 1 ? g.label : null;
    out.groupCount[i] = g.count;
    out.groupIds[i] = g.ids;
    out.groupLabels[i] = g.labels ?? null;
  });
  return {
    kind: 'viewport',
    categorized,
    total: r.total,
    cats,
    catCounts,
    n: G,
    key: r.groups.map((g) => g.key),
    ...out,
    clusters: r.clusters.map((c) => ({ cluster: c, wx: worldX(c.lng), wy: worldY(c.lat) })),
    keyIndex,
    rank: Float32Array.from(r.groups, (g) => rankOf(g.key)),
  };
}

// ------------------------------------------------------------------ estilo

export interface StyledLayer {
  catVisible: Uint8Array;
  /** Registros visíveis por grupo (0 = grupo oculto) */
  vis: Int32Array;
  /** Primeiro registro visível do grupo (índice em rec*), -1 se nenhum */
  first: Int32Array;
  color: string[];
  radius: Float32Array;
  /** Grupos de um registro, por cor/tamanho (um fill por balde) */
  buckets: { color: string; r: number; groups: Int32Array }[];
  /** Grupos com mais de um registro visível (desenhados com número) */
  multi: Int32Array;
}

export function styleLayer(p: PreparedLayer, s: LayerStyle): StyledLayer {
  const catStyles = p.cats.map((v) =>
    p.categorized ? categoryStyle(s, v) : { color: s.color, size: s.size, visible: true },
  );
  const catVisible = Uint8Array.from(catStyles, (c) => (c.visible ? 1 : 0));
  const vis = new Int32Array(p.n);
  const first = new Int32Array(p.n).fill(-1);
  const color = new Array<string>(p.n);
  const radius = new Float32Array(p.n);
  const buckets = new Map<string, { color: string; r: number; groups: number[] }>();
  const multi: number[] = [];
  for (let g = 0; g < p.n; g++) {
    let count = 0;
    let f = -1;
    for (let j = p.start[g]; j < p.start[g + 1]; j++) {
      if (!catVisible[p.recCat[j]]) continue;
      count++;
      if (f < 0) f = j;
    }
    if (p.groupCount && count > 0) count = p.groupCount[g];
    vis[g] = count;
    first[g] = f;
    if (!count) continue;
    const cs = catStyles[p.recCat[f]];
    color[g] = cs.color;
    radius[g] = cs.size;
    if (count > 1) {
      multi.push(g);
      continue;
    }
    const k = `${cs.color}|${cs.size}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { color: cs.color, r: cs.size, groups: [] }));
    b.groups.push(g);
  }
  return {
    catVisible,
    vis,
    first,
    color,
    radius,
    buckets: [...buckets.values()].map((b) => ({
      color: b.color,
      r: b.r,
      groups: Int32Array.from(b.groups),
    })),
    multi: Int32Array.from(multi),
  };
}

/** Dados de um grupo para seleção/tooltip (IDs só dos registros visíveis). */
export function groupInfo(p: PreparedLayer, st: StyledLayer, g: number) {
  let ids: string[] | null;
  if (p.groupIds) ids = p.groupIds[g];
  else {
    ids = [];
    for (let j = p.start[g]; j < p.start[g + 1]; j++)
      if (st.catVisible[p.recCat[j]]) ids.push(p.recId[j]!);
  }
  const f = st.first[g];
  return {
    key: p.key[g],
    x: p.x[g],
    y: p.y[g],
    lat: p.lat[g],
    lng: p.lng[g],
    count: st.vis[g],
    ids,
    firstId: f >= 0 ? p.recId[f] : null,
    label: f >= 0 && p.recLabel ? p.recLabel[f] : null,
    category: f >= 0 && p.categorized ? p.cats[p.recCat[f]] : null,
  };
}

/**
 * Linhas do rótulo de um grupo: os rótulos dos registros visíveis, até `max` (vários registros na
 * mesma coordenada). Com `max` > 1 e mais rótulos do que cabem, a última linha diz quantos faltam.
 */
export function groupLabelLines(
  p: PreparedLayer,
  st: StyledLayer,
  g: number,
  max: number,
): string[] {
  const all: string[] = [];
  const list = p.groupLabels?.[g];
  if (list) {
    for (const t of list) if (t) all.push(t);
  } else if (p.recLabel) {
    for (let j = p.start[g]; j < p.start[g + 1]; j++) {
      const t = p.recLabel[j];
      if (t && st.catVisible[p.recCat[j]]) all.push(t);
      if (max <= 1 && all.length) break;
    }
  }
  if (all.length <= max) return all;
  const lines = all.slice(0, Math.max(1, max));
  if (max > 1) lines.push(`+${all.length - max}`);
  return lines;
}

// ------------------------------------------------------------------ overlay

export interface OverlayLayer {
  id: string;
  prepared: PreparedLayer;
  style: LayerStyle;
}

export type Hit =
  | { kind: 'group'; layerId: string; g: number; prepared: PreparedLayer; styled: StyledLayer }
  | { kind: 'cluster'; layerId: string; cluster: MapCluster };

/** Prévia de mover/duplicar: pontos deslocados por (dLat, dLng); a âncora ganha uma linha de origem. */
export interface Ghost {
  points: LatLng[];
  anchor: LatLng;
  dLat: number;
  dLng: number;
}

export interface PointsOverlayApi {
  setLayers(layers: OverlayLayer[]): void;
  setSelected(layerId: string | null, keys: Set<string>): void;
  setGhost(ghost: Ghost | null): void;
  /** Pisca os pontos (destaque vermelho intermitente por ~2 s), sem selecioná-los. */
  flash(points: LatLng[]): void;
  hitTest(lat: number, lng: number): Hit | null;
  destroy(): void;
}

interface DrawBuffer {
  prepared: PreparedLayer;
  n: number;
  g: Int32Array;
  px: Float32Array;
  py: Float32Array;
  r: Float32Array;
  clusters: { cluster: MapCluster; px: number; py: number; r: number }[];
}

/** Fonte do número de registros que cabe num círculo de raio `r` (null = pequeno demais para ler). */
function countFont(r: number, text: string) {
  const size = Math.floor(Math.min(10, 1.5 * r, (1.7 * r) / (0.6 * text.length)));
  return size >= 5 ? `bold ${size}px Arial, Helvetica, sans-serif` : null;
}

function shortCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`;
  return String(n);
}

export function createPointsOverlay(map: MlMap): PointsOverlayApi {
  class PointsOverlay {
    private canvas = document.createElement('canvas');
    private layers: OverlayLayer[] = [];
    private styledCache = new WeakMap<PreparedLayer, { style: LayerStyle; styled: StyledLayer }>();
    private drawn = new Map<string, DrawBuffer>();
    private selectedLayer: string | null = null;
    private selectedKeys = new Set<string>();
    private ghost: Ghost | null = null;
    private flashing: { points: LatLng[]; on: boolean } | null = null;
    private flashTimer = 0;
    private view = { cwx: 0, cwy: 0, scale: 1, offX: 0, offY: 0 };
    private widths = new Map<string, number>();
    /** Conteúdo (camadas/seleção/prévia) mudou: precisa redesenhar. */
    private dirty = true;
    /** Houve zoom desde o último "moveend": ao parar, redesenha tudo (nunca só reposiciona). */
    private zoomed = false;
    /** Onde/como o último desenho foi feito (para só reposicionar o canvas durante o arraste). */
    private placed: {
      zoom: number;
      w: number;
      h: number;
      mx: number;
      my: number;
      anchor: LngLat;
      ax: number;
      ay: number;
      left: number;
      top: number;
    } | null = null;

    /** Redesenho adiado até o zoom parar (a rodinha dá vários "cliques" seguidos). */
    private settleTimer = 0;

    private readonly onRender = () => {
      if (this.dirty) return this.render();
      // Durante o zoom só escala o desenho anterior; o redesenho vem quando o zoom parar.
      if (!this.reposition() && !this.zoomed) this.render();
    };
    private readonly onZoom = () => {
      this.zoomed = true;
      this.settle();
    };
    /** Mapa parado: depois de zoom, redesenha (após o zoom assentar); depois de arrastar, só se gastou a margem. */
    private readonly onMoveEnd = () => {
      if (this.zoomed) this.settle();
      else if (!this.reposition(0.3)) this.schedule(true);
    };

    private settle() {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => {
        if (map.isMoving()) return this.settle();
        this.zoomed = false;
        this.schedule(true);
      }, SETTLE_MS);
    }
    private readonly onResize = () => this.schedule(true);

    constructor() {
      this.canvas.style.cssText =
        'position:absolute;left:0;top:0;pointer-events:none;transform-origin:0 0;';
      // Logo acima do mapa (WebGL) e abaixo dos controles (atribuição etc.).
      map.getCanvasContainer().insertAdjacentElement('afterend', this.canvas);
      // "render" vem no mesmo quadro em que o MapLibre desenha: o canvas acompanha sem atraso.
      map.on('render', this.onRender);
      map.on('zoom', this.onZoom);
      map.on('moveend', this.onMoveEnd);
      map.on('resize', this.onResize);
      this.schedule(true);
    }

    destroy() {
      window.clearInterval(this.flashTimer);
      window.clearTimeout(this.settleTimer);
      map.off('render', this.onRender);
      map.off('zoom', this.onZoom);
      map.off('moveend', this.onMoveEnd);
      map.off('resize', this.onResize);
      this.canvas.remove();
    }

    /** Pede um redesenho no próximo quadro do mapa (`full`: mesmo sem o mapa ter se movido). */
    schedule(full = false) {
      if (full) this.dirty = true;
      map.triggerRepaint();
    }

    /**
     * Durante o arraste/zoom, reaproveita o desenho anterior: move o canvas e, se o zoom mudou,
     * escala (CSS), sem redesenhar. Retorna false quando é preciso redesenhar (zoom/tamanho mudou
     * ou o arraste passou de `limit` da margem já desenhada).
     */
    private reposition(limit = 0.9): boolean {
      const r = this.placed;
      if (!r) return false;
      const box = map.getContainer();
      if (box.clientWidth !== r.w || box.clientHeight !== r.h) return false;
      const s = 2 ** (map.getZoom() - r.zoom);
      const a = map.project(r.anchor);
      // O ponto do canvas que estava sob a âncora continua sob ela, com o canvas escalado em s.
      const left = a.x - (r.ax - r.left) * s;
      const top = a.y - (r.ay - r.top) * s;
      const cs = this.canvas.style;
      cs.left = `${left}px`;
      cs.top = `${top}px`;
      cs.transform = s === 1 ? '' : `scale(${s})`;
      if (s !== 1) return false;
      const dx = a.x - r.ax;
      const dy = a.y - r.ay;
      return Math.abs(dx) < r.mx * limit && Math.abs(dy) < r.my * limit;
    }

    setLayers(layers: OverlayLayer[]) {
      const same =
        layers.length === this.layers.length &&
        layers.every(
          (l, i) =>
            l.id === this.layers[i].id &&
            l.prepared === this.layers[i].prepared &&
            l.style === this.layers[i].style,
        );
      if (same) return;
      this.layers = layers;
      this.schedule(true);
    }

    setSelected(layerId: string | null, keys: Set<string>) {
      if (layerId === this.selectedLayer && keys === this.selectedKeys) return;
      this.selectedLayer = layerId;
      this.selectedKeys = keys;
      this.schedule(true);
    }

    setGhost(ghost: Ghost | null) {
      if (ghost === this.ghost) return;
      this.ghost = ghost;
      this.schedule(true);
    }

    flash(points: LatLng[]) {
      window.clearInterval(this.flashTimer);
      if (!points.length) return;
      let tick = 0;
      this.flashing = { points, on: true };
      this.schedule(true);
      this.flashTimer = window.setInterval(() => {
        tick++;
        // 4 piscadas (liga/desliga) e some.
        if (tick >= 8) {
          window.clearInterval(this.flashTimer);
          this.flashing = null;
        } else this.flashing = { points, on: tick % 2 === 0 };
        this.schedule(true);
      }, 250);
    }

    styled(l: OverlayLayer) {
      const c = this.styledCache.get(l.prepared);
      if (c && c.style === l.style) return c.styled;
      const styled = styleLayer(l.prepared, l.style);
      this.styledCache.set(l.prepared, { style: l.style, styled });
      return styled;
    }

    private buffer(id: string, p: PreparedLayer): DrawBuffer {
      let b = this.drawn.get(id);
      if (!b || b.g.length < p.n) {
        b = {
          prepared: p,
          n: 0,
          g: new Int32Array(p.n),
          px: new Float32Array(p.n),
          py: new Float32Array(p.n),
          r: new Float32Array(p.n),
          clusters: [],
        };
        this.drawn.set(id, b);
      }
      b.prepared = p;
      b.n = 0;
      b.clusters = [];
      return b;
    }

    private textWidth(ctx: CanvasRenderingContext2D, text: string, font: string) {
      const k = `${font}\u0000${text}`;
      let w = this.widths.get(k);
      if (w === undefined) {
        if (this.widths.size > 50_000) this.widths.clear();
        w = ctx.measureText(text).width;
        this.widths.set(k, w);
      }
      return w;
    }

    private toCanvas(wx: number, wy: number) {
      const v = this.view;
      let dx = wx - v.cwx;
      if (dx > 128) dx -= 256;
      else if (dx < -128) dx += 256;
      return { px: dx * v.scale + v.offX, py: (wy - v.cwy) * v.scale + v.offY };
    }

    render() {
      const center = map.getCenter();
      const box = map.getContainer();
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (!w || !h) return;
      const mx = Math.round(w * MARGIN);
      const my = Math.round(h * MARGIN);
      const W = w + 2 * mx;
      const H = h + 2 * my;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Sem rotação/inclinação: o centro do mapa fica no centro do contêiner.
      const cDiv = { x: w / 2, y: h / 2 };

      const cv = this.canvas;
      const left = cDiv.x - w / 2 - mx;
      const top = cDiv.y - h / 2 - my;
      cv.style.left = `${left}px`;
      cv.style.top = `${top}px`;
      cv.style.transform = '';
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      const pw = Math.round(W * dpr);
      const ph = Math.round(H * dpr);
      if (cv.width !== pw || cv.height !== ph) {
        cv.width = pw;
        cv.height = ph;
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const zoom = map.getZoom();
      this.view = {
        cwx: worldX(center.lng),
        cwy: worldY(center.lat),
        scale: worldScaleOf(zoom),
        offX: w / 2 + mx,
        offY: h / 2 + my,
      };
      const v = this.view;
      this.placed = {
        zoom,
        w,
        h,
        mx,
        my,
        anchor: center,
        ax: cDiv.x,
        ay: cDiv.y,
        left,
        top,
      };
      this.dirty = false;
      for (const id of [...this.drawn.keys()])
        if (!this.layers.some((l) => l.id === id)) this.drawn.delete(id);
      // Afastado: só uma parte dos pontos (sempre os mesmos), o resto aparece ao aproximar.
      const frac = lodFraction(metersPerCm(v.scale, center.lat));

      // Pontos: da camada de baixo para a de cima.
      for (let li = this.layers.length - 1; li >= 0; li--) {
        const l = this.layers[li];
        const p = l.prepared;
        const st = this.styled(l);
        const buf = this.buffer(l.id, p);
        let k = 0;

        ctx.globalAlpha = l.style.opacity;
        // Com contorno, cada ponto é desenhado inteiro (contorno e depois cor) antes do próximo: o
        // contorno fica por fora de cada ponto, separa os vizinhos e é coberto pelo ponto de cima,
        // em vez de todos os contornos por cima de todas as cores (o preto tomava conta afastado).
        // Antes do preenchimento, com o dobro da espessura, só a metade de fora aparece.
        ctx.lineWidth = pointOutlineWidth(l.style) * 2;
        const outline = pointOutline(l.style);
        if (outline) ctx.strokeStyle = outline;
        for (const b of st.buckets) {
          const r = b.r;
          ctx.fillStyle = b.color;
          ctx.beginPath();
          let any = false;
          for (let i = 0; i < b.groups.length; i++) {
            const g = b.groups[i];
            if (p.rank[g] >= frac) continue;
            let dx = p.wx[g] - v.cwx;
            if (dx > 128) dx -= 256;
            else if (dx < -128) dx += 256;
            const px = dx * v.scale + v.offX;
            const py = (p.wy[g] - v.cwy) * v.scale + v.offY;
            if (px < -r || py < -r || px > W + r || py > H + r) continue;
            if (outline) {
              ctx.beginPath();
              ctx.arc(px, py, r, 0, TAU);
              ctx.stroke();
              ctx.fill();
            } else {
              ctx.moveTo(px + r, py);
              ctx.arc(px, py, r, 0, TAU);
              any = true;
            }
            buf.g[k] = g;
            buf.px[k] = px;
            buf.py[k] = py;
            buf.r[k] = r;
            k++;
          }
          if (any) ctx.fill();
        }

        // Coordenadas com vários registros: mesmo tamanho, com o número no centro.
        if (st.multi.length) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (let i = 0; i < st.multi.length; i++) {
            const g = st.multi[i];
            if (p.rank[g] >= frac) continue;
            const r = st.radius[g];
            const { px, py } = this.toCanvas(p.wx[g], p.wy[g]);
            if (px < -r || py < -r || px > W + r || py > H + r) continue;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, TAU);
            ctx.fillStyle = st.color[g];
            if (outline) ctx.stroke();
            ctx.fill();
            const text = st.vis[g] > 99 ? '99+' : String(st.vis[g]);
            const font = countFont(r, text);
            if (font) {
              ctx.font = font;
              ctx.fillStyle = '#ffffff';
              ctx.fillText(text, px, py + 0.5);
            }
            buf.g[k] = g;
            buf.px[k] = px;
            buf.py[k] = py;
            buf.r[k] = r;
            k++;
          }
        }
        ctx.globalAlpha = 1;

        // Seleção (somente na camada ativa).
        if (l.id === this.selectedLayer && this.selectedKeys.size) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (const key of this.selectedKeys) {
            const g = p.keyIndex.get(key);
            if (g === undefined || !st.vis[g]) continue;
            const r = st.radius[g] + 2;
            const { px, py } = this.toCanvas(p.wx[g], p.wy[g]);
            if (px < -r || py < -r || px > W + r || py > H + r) continue;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, TAU);
            ctx.fillStyle = '#f59e0b';
            ctx.fill();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#78350f';
            ctx.stroke();
            if (st.vis[g] > 1) {
              const text = st.vis[g] > 99 ? '99+' : String(st.vis[g]);
              const font = countFont(r, text);
              if (font) {
                ctx.font = font;
                ctx.fillStyle = '#ffffff';
                ctx.fillText(text, px, py + 0.5);
              }
            }
          }
        }

        // Clusters (tabelas grandes, zoom afastado).
        if (p.clusters.length) {
          ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (const c of p.clusters) {
            const r = Math.min(30, 11 + Math.log10(Math.max(c.cluster.count, 1)) * 5);
            const { px, py } = this.toCanvas(c.wx, c.wy);
            if (px < -r || py < -r || px > W + r || py > H + r) continue;
            ctx.beginPath();
            ctx.arc(px, py, r, 0, TAU);
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = l.style.color;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.fillText(shortCount(c.cluster.count), px, py + 0.5);
            buf.clusters.push({ cluster: c.cluster, px, py, r });
          }
        }
        buf.n = k;
      }

      // Rótulos: camada do topo tem prioridade. Cada rótulo procura uma posição livre ao redor do seu
      // ponto (acima, direita, abaixo, esquerda, diagonais e, se preciso, mais afastado com uma linha
      // de ligação); só some se não houver nenhuma posição sem sobrepor outro rótulo.
      // A grade de colisão é alinhada às coordenadas do mundo (não ao canvas): ao redesenhar depois de
      // um arraste, os mesmos rótulos vencem e nada "pisca".
      const gx = (((v.cwx * v.scale - v.offX) % LABEL_CELL) + LABEL_CELL) % LABEL_CELL;
      const gy = (((v.cwy * v.scale - v.offY) % LABEL_CELL) + LABEL_CELL) % LABEL_CELL;
      const gw = Math.ceil((W + gx) / LABEL_CELL);
      const gh = Math.ceil((H + gy) / LABEL_CELL);
      const grid = new Uint8Array(gw * gh);
      const cellX = (x: number) => Math.floor((x + gx) / LABEL_CELL);
      const cellY = (y: number) => Math.floor((y + gy) / LABEL_CELL);
      /** Marca uma área da grade (sem rebaixar um rótulo para ponto). */
      const mark = (x0: number, y0: number, x1: number, y1: number, v: number) => {
        const cx0 = Math.max(0, cellX(x0));
        const cx1 = Math.min(gw - 1, cellX(x1));
        const cy0 = Math.max(0, cellY(y0));
        const cy1 = Math.min(gh - 1, cellY(y1));
        for (let cy = cy0; cy <= cy1; cy++)
          for (let cx = cx0; cx <= cx1; cx++) if (grid[cy * gw + cx] < v) grid[cy * gw + cx] = v;
      };
      /** Células do próprio ponto do rótulo (não contam como obstáculo). */
      const own = [0, 0, -1, -1];
      /** Área livre? `limit` = maior ocupação aceita (0: nada; CELL_POINT: pode cobrir pontos). */
      const free = (x0: number, y0: number, x1: number, y1: number, limit: number) => {
        if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) return false; // inteiro dentro do canvas
        const cx0 = cellX(x0);
        const cx1 = Math.min(gw - 1, cellX(x1));
        const cy0 = cellY(y0);
        const cy1 = Math.min(gh - 1, cellY(y1));
        for (let cy = cy0; cy <= cy1; cy++)
          for (let cx = cx0; cx <= cx1; cx++) {
            const c = grid[cy * gw + cx];
            if (c <= limit) continue;
            const mine = cx >= own[0] && cx <= own[2] && cy >= own[1] && cy <= own[3];
            if (!(mine && c === CELL_POINT)) return false;
          }
        return true;
      };

      // Os pontos desenhados ocupam a grade: os rótulos evitam cobri-los (sem impedir de vez).
      for (const buf of this.drawn.values())
        for (let i = 0; i < buf.n; i++) {
          const x = buf.px[i];
          const y = buf.py[i];
          const r = buf.r[i];
          if (x >= -r && y >= -r && x <= W + r && y <= H + r)
            mark(x - r + 1, y - r + 1, x + r - 1, y + r - 1, CELL_POINT);
        }

      let placed = 0;
      /**
       * Procura uma posição livre ao redor do ponto (px, py) de raio `pr` e desenha o rótulo. Primeiro
       * evita rótulos e pontos; depois aceita cobrir pontos; com `force`, desenha acima de qualquer jeito.
       */
      const place = (
        lines: string[],
        px: number,
        py: number,
        pr: number,
        font: string,
        size: number,
        buffer: boolean,
        underline: boolean,
        force = false,
      ) => {
        let tw = 0;
        for (const t of lines) tw = Math.max(tw, this.textWidth(ctx, t, font));
        const lineH = Math.round(size * 1.15);
        const th = size + (lines.length - 1) * lineH;
        if (px + pr + tw < 0 || px - pr - tw > W || py + pr + th < 0 || py - pr - th > H) return;
        const pad = 2;
        const bw = tw + pad * 2;
        const bh = th + pad * 2;
        own[0] = cellX(px - pr);
        own[1] = cellY(py - pr);
        own[2] = cellX(px + pr);
        own[3] = cellY(py + pr);
        let box: [number, number, number, number] | null = null;
        let ring = 0;
        search: for (const limit of [0, CELL_POINT]) {
          for (let k = 0; k < LABEL_RINGS.length; k++) {
            const d = pr + 2 + LABEL_RINGS[k] * size;
            for (const [dx, dy] of LABEL_DIRS) {
              const ax = px + dx * d;
              const ay = py + dy * d;
              const x0 = dx > 0 ? ax : dx < 0 ? ax - bw : ax - bw / 2;
              const y0 = dy > 0 ? ay : dy < 0 ? ay - bh : ay - bh / 2;
              if (free(x0, y0, x0 + bw, y0 + bh, limit)) {
                box = [x0, y0, x0 + bw, y0 + bh];
                ring = k;
                break search;
              }
            }
          }
        }
        if (!box) {
          if (!force) return;
          box = [px - bw / 2, py - pr - 2 - bh, px + bw / 2, py - pr - 2];
        }
        const [x0, y0, x1, y1] = box;
        mark(x0, y0, x1, y1, CELL_LABEL);
        if (ring > 0) {
          // Linha de ligação do ponto até o rótulo afastado.
          const tx = Math.min(Math.max(px, x0), x1);
          const ty = Math.min(Math.max(py, y0), y1);
          const len = Math.hypot(tx - px, ty - py) || 1;
          ctx.save();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(51, 65, 85, 0.75)';
          ctx.beginPath();
          ctx.moveTo(px + ((tx - px) / len) * pr, py + ((ty - py) / len) * pr);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.restore();
        }
        const bx = x0 + pad;
        for (let i = 0; i < lines.length; i++) {
          const by = y1 - pad - (lines.length - 1 - i) * lineH;
          if (buffer) ctx.strokeText(lines[i], bx, by);
          ctx.fillText(lines[i], bx, by);
          if (underline) {
            // Sublinhado logo abaixo da linha de base (textBaseline = bottom inclui a descida).
            const uw = this.textWidth(ctx, lines[i], font);
            const th = Math.max(1, size / 14);
            const uy = by - size * 0.16;
            if (buffer) ctx.strokeRect(bx, uy, uw, th);
            ctx.fillRect(bx, uy, uw, th);
          }
        }
        placed++;
      };
      const labelStyle = (l: OverlayLayer) => {
        const lab = l.style.label;
        const font = labelCanvasFont(lab);
        ctx.font = font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        // O contorno é desenhado antes do texto: só a metade de fora aparece (daí o dobro).
        ctx.lineWidth = labelBufferWidth(lab) * 2;
        ctx.strokeStyle = labelBufferColor(lab);
        ctx.fillStyle = lab.color;
        return font;
      };
      const showLabels = (l: OverlayLayer) =>
        hasLabels(l.style.label) && zoom >= l.style.label.minZoom && !!l.prepared.recLabel;

      // 1º os selecionados (camada ativa): sempre aparecem, mesmo escondidos pelo nível de detalhe ou
      // disputando espaço com rótulos de outras camadas.
      const selLayer = this.layers.find((l) => l.id === this.selectedLayer);
      if (selLayer && this.selectedKeys.size && showLabels(selLayer)) {
        const p = selLayer.prepared;
        const st = this.styled(selLayer);
        const lab = selLayer.style.label;
        const max = lab.maxPerPoint ?? 1;
        const font = labelStyle(selLayer);
        for (const key of this.selectedKeys) {
          const g = p.keyIndex.get(key);
          if (g === undefined || !st.vis[g]) continue;
          const lines = groupLabelLines(p, st, g, max);
          if (!lines.length) continue;
          const r = st.radius[g] + 2;
          const { px, py } = this.toCanvas(p.wx[g], p.wy[g]);
          place(lines, px, py, r, font, lab.size, lab.buffer, !!lab.underline, true);
        }
      }

      for (const l of this.layers) {
        const p = l.prepared;
        const buf = this.drawn.get(l.id);
        if (!showLabels(l) || !buf) continue;
        const lab = l.style.label;
        const max = lab.maxPerPoint ?? 1;
        const st = this.styled(l);
        const font = labelStyle(l);
        const skipSelected = l === selLayer && this.selectedKeys.size > 0;
        for (let i = 0; i < buf.n && placed < MAX_LABELS; i++) {
          const g = buf.g[i];
          if (skipSelected && this.selectedKeys.has(p.key[g])) continue;
          const lines = groupLabelLines(p, st, g, max);
          if (!lines.length) continue;
          place(lines, buf.px[i], buf.py[i], buf.r[i], font, lab.size, lab.buffer, !!lab.underline);
        }
      }

      if (this.ghost) this.renderGhost(ctx, this.ghost, W, H);
      if (this.flashing?.on) this.renderFlash(ctx, this.flashing.points, W, H);
    }

    private renderFlash(ctx: CanvasRenderingContext2D, points: LatLng[], W: number, H: number) {
      const r = 9;
      ctx.beginPath();
      for (const p of points) {
        const { px, py } = this.toCanvas(worldX(p.lng), worldY(p.lat));
        if (px < -r || py < -r || px > W + r || py > H + r) continue;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, TAU);
      }
      ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#dc2626';
      ctx.stroke();
    }

    private renderGhost(ctx: CanvasRenderingContext2D, gh: Ghost, W: number, H: number) {
      const r = 7;
      const from = this.toCanvas(worldX(gh.anchor.lng), worldY(gh.anchor.lat));
      const to = this.toCanvas(worldX(gh.anchor.lng + gh.dLng), worldY(gh.anchor.lat + gh.dLat));
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#78350f';
      ctx.beginPath();
      ctx.moveTo(from.px, from.py);
      ctx.lineTo(to.px, to.py);
      ctx.stroke();
      ctx.setLineDash([3, 2]);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      for (const p of gh.points) {
        const { px, py } = this.toCanvas(worldX(p.lng + gh.dLng), worldY(p.lat + gh.dLat));
        if (px < -r || py < -r || px > W + r || py > H + r) continue;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, TAU);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    hitTest(lat: number, lng: number): Hit | null {
      const { px, py } = this.toCanvas(worldX(lng), worldY(lat));
      for (const l of this.layers) {
        const buf = this.drawn.get(l.id);
        if (!buf || buf.prepared !== l.prepared) continue;
        for (const c of buf.clusters) {
          const dx = c.px - px;
          const dy = c.py - py;
          if (dx * dx + dy * dy <= c.r * c.r)
            return { kind: 'cluster', layerId: l.id, cluster: c.cluster };
        }
        let best = -1;
        let bestD = Infinity;
        for (let i = buf.n - 1; i >= 0; i--) {
          const dx = buf.px[i] - px;
          const dy = buf.py[i] - py;
          const d = dx * dx + dy * dy;
          const rr = buf.r[i] + 3;
          if (d <= rr * rr && d < bestD) {
            best = i;
            bestD = d;
          }
        }
        if (best >= 0)
          return {
            kind: 'group',
            layerId: l.id,
            g: buf.g[best],
            prepared: l.prepared,
            styled: this.styled(l),
          };
      }
      return null;
    }
  }

  const overlay = new PointsOverlay();
  return {
    setLayers: (l) => overlay.setLayers(l),
    setSelected: (id, keys) => overlay.setSelected(id, keys),
    setGhost: (g) => overlay.setGhost(g),
    flash: (points) => overlay.flash(points),
    hitTest: (lat, lng) => overlay.hitTest(lat, lng),
    destroy: () => overlay.destroy(),
  };
}
