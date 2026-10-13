/**
 * Duplicidades: pares de pontos da mesma camada que podem ser o mesmo ponto coletado duas vezes.
 *
 * Todo par a até `radius` metros é candidato. A pontuação do par soma os pesos das regras atendidas
 * (pesos negativos diminuem a chance): mesma coordenada, atributos iguais/diferentes, associação dos
 * dois pontos à camada de referência e quantidade de pontos sem associação por perto (área nova, onde
 * pontos próximos são esperados). Ficam os pares com pontuação ≥ `minScore` (suspeitos).
 *
 * Não é 1 para 1: um ponto pode estar em vários pares. Pares ligados por pontos em comum formam um
 * grupo (a área da duplicidade). Com `includeNearby`, os demais pares a até o raio que envolvem um
 * ponto suspeito também entram, marcados como abaixo da mínima, para mostrar todos os candidatos.
 */
import { haversine } from '../association/association.logic';

export interface DupPoint {
  lat: number | null;
  lng: number | null;
  /** Coordenada original (X|Y): mesma chave = mesma coordenada */
  coordKey: string | null;
  /** Valor normalizado de cada regra de atributo (null = vazio, nunca atende) */
  values: (string | null)[];
  /** Associado a um ponto da camada de referência (null = sem referência) */
  matched: boolean | null;
}

export interface DupRule {
  /** equal: valores iguais; different: valores diferentes (os dois preenchidos) */
  mode: 'equal' | 'different';
  /** sameCoord: só vale para pontos na mesma coordenada */
  scope: 'radius' | 'sameCoord';
  weight: number;
}

export interface DupOptions {
  radius: number;
  /** Peso de estar na mesma coordenada */
  sameCoordWeight: number;
  rules: DupRule[];
  /** Pesos pela associação à referência; null = sem referência */
  reference: { bothMatched: number; oneMatched: number; noneMatched: number } | null;
  /** A partir de `minCount` pontos sem associação a até `radius` m do par (sem contar os dois): `weight` */
  density: { radius: number; minCount: number; weight: number } | null;
  minScore: number;
  /** Também lista os pares abaixo da mínima que envolvem um ponto suspeito */
  includeNearby?: boolean;
}

/** Parcela da pontuação: 'same', 'rule:<k>', 'ref:both' | 'ref:one' | 'ref:none', 'density' */
export interface DupPart {
  key: string;
  weight: number;
}

export interface DupPair {
  i: number;
  j: number;
  distance: number;
  sameCoord: boolean;
  score: number;
  parts: DupPart[];
  /** Pontos sem associação perto do par (null = regra desligada) */
  nearbyUnmatched: number | null;
  /** Grupo (pares suspeitos ligados por um ponto em comum), a partir de 1 */
  group: number;
  /** Pontuação abaixo da mínima (outro candidato perto de um ponto suspeito) */
  belowMin: boolean;
}

export const MAX_RULES = 20;
/** Limite de pares a até o raio (memória): acima disso, pede para diminuir o raio. */
export const MAX_CANDIDATES = 5_000_000;
/** Limite de pares no resultado */
export const MAX_PAIRS = 200_000;

const EARTH_RADIUS = 6_371_008.8;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS;
const RAD = Math.PI / 180;

const hasCoords = (p: { lat: number | null; lng: number | null }) =>
  p.lat !== null && p.lng !== null && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Chama `fn` para cada par i < j a até `radius` metros (grade em graus, como na associação). */
export function forEachPairWithin(
  pts: { lat: number | null; lng: number | null }[],
  radius: number,
  fn: (i: number, j: number, d: number) => void,
) {
  if (!(radius >= 0)) return;
  let maxAbsLat = 0;
  for (const p of pts) if (hasCoords(p)) maxAbsLat = Math.max(maxAbsLat, Math.abs(p.lat!));
  const cellLat = (Math.max(radius, 0.01) / M_PER_DEG_LAT) * 1.01;
  const cellLng = cellLat / Math.max(Math.cos(Math.min(maxAbsLat, 89) * RAD), 0.01);
  const grid = new Map<string, number[]>();
  const cells = new Int32Array(pts.length * 2);
  pts.forEach((p, i) => {
    if (!hasCoords(p)) return;
    const cx = Math.floor(p.lng! / cellLng);
    const cy = Math.floor(p.lat! / cellLat);
    cells[i * 2] = cx;
    cells[i * 2 + 1] = cy;
    const k = `${cx}:${cy}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  pts.forEach((p, i) => {
    if (!hasCoords(p)) return;
    const cx = cells[i * 2];
    const cy = cells[i * 2 + 1];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${cx + dx}:${cy + dy}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const q = pts[j];
          const d = haversine(p.lat!, p.lng!, q.lat!, q.lng!);
          if (d <= radius) fn(i, j, d);
        }
      }
    }
  });
}

/** Para cada ponto, os pontos sem associação a até `radius` m (sem ele mesmo). */
function unmatchedNeighbors(pts: DupPoint[], radius: number): number[][] {
  const out: number[][] = pts.map(() => []);
  forEachPairWithin(pts, radius, (i, j) => {
    if (pts[j].matched === false) out[i].push(j);
    if (pts[i].matched === false) out[j].push(i);
  });
  return out;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function findDuplicates(pts: DupPoint[], opts: DupOptions): DupPair[] {
  if (opts.rules.length > MAX_RULES) throw new Error(`No máximo ${MAX_RULES} regras de atributo`);
  if (!(opts.radius > 0)) return [];
  const near = opts.density && opts.reference ? unmatchedNeighbors(pts, opts.density.radius) : null;

  const scorePair = (i: number, j: number, distance: number) => {
    const p = pts[i];
    const q = pts[j];
    const sameCoord = p.coordKey !== null && p.coordKey === q.coordKey;
    const parts: DupPart[] = [];
    if (sameCoord && opts.sameCoordWeight) parts.push({ key: 'same', weight: opts.sameCoordWeight });
    opts.rules.forEach((r, k) => {
      if (r.scope === 'sameCoord' && !sameCoord) return;
      const a = p.values[k];
      const b = q.values[k];
      if (a === null || b === null) return;
      if ((r.mode === 'equal') === (a === b)) parts.push({ key: `rule:${k}`, weight: r.weight });
    });
    if (opts.reference && p.matched !== null && q.matched !== null) {
      const n = Number(p.matched) + Number(q.matched);
      const [key, weight] =
        n === 2
          ? ['ref:both', opts.reference.bothMatched]
          : n === 1
            ? ['ref:one', opts.reference.oneMatched]
            : ['ref:none', opts.reference.noneMatched];
      if (weight) parts.push({ key, weight });
    }
    let nearbyUnmatched: number | null = null;
    if (near && opts.density) {
      const set = new Set(near[i]);
      for (const k of near[j]) set.add(k);
      set.delete(i);
      set.delete(j);
      nearbyUnmatched = set.size;
      if (nearbyUnmatched >= opts.density.minCount && opts.density.weight) {
        parts.push({ key: 'density', weight: opts.density.weight });
      }
    }
    const score = round(parts.reduce((s, x) => s + x.weight, 0));
    return { i, j, distance, sameCoord, score, parts, nearbyUnmatched, group: 0, belowMin: false };
  };

  const pairs: DupPair[] = [];
  const add = (pair: DupPair) => {
    if (pairs.length >= MAX_PAIRS) {
      throw new Error(
        `Mais de ${MAX_PAIRS.toLocaleString('pt-BR')} pares no resultado. Aumente a pontuação mínima ou diminua o raio.`,
      );
    }
    pairs.push(pair);
  };

  let candidates = 0;
  forEachPairWithin(pts, opts.radius, (i, j, d) => {
    if (++candidates > MAX_CANDIDATES) {
      throw new Error('Pontos demais dentro do raio escolhido. Diminua o raio máximo.');
    }
    const pair = scorePair(i, j, d);
    if (pair.score >= opts.minScore) add(pair);
  });
  pairs.sort((x, y) => y.score - x.score || x.distance - y.distance || x.i - y.i || x.j - y.j);
  const groupOf = assignGroups(pairs, pts.length);

  // Os outros candidatos dos pontos suspeitos, para ver a área toda (nem sempre é 1 para 1).
  if (opts.includeNearby && pairs.length) {
    forEachPairWithin(pts, opts.radius, (i, j, d) => {
      const gi = groupOf[i];
      const gj = groupOf[j];
      if (!gi && !gj) return;
      const pair = scorePair(i, j, d);
      if (pair.score >= opts.minScore) return;
      add({ ...pair, belowMin: true, group: gi && gj ? Math.min(gi, gj) : gi || gj });
    });
  }

  pairs.sort(
    (x, y) =>
      x.group - y.group ||
      Number(x.belowMin) - Number(y.belowMin) ||
      y.score - x.score ||
      x.distance - y.distance ||
      x.i - y.i ||
      x.j - y.j,
  );
  return pairs;
}

/**
 * Grupos: pares ligados por pontos em comum, numerados na ordem em que aparecem (o grupo 1 tem o par
 * mais suspeito). Devolve o grupo de cada ponto (0 = em nenhum par).
 */
function assignGroups(pairs: DupPair[], n: number): Int32Array {
  const parent = new Int32Array(n).map((_, k) => k);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const p of pairs) {
    const a = find(p.i);
    const b = find(p.j);
    if (a !== b) parent[a] = b;
  }
  const numbers = new Map<number, number>();
  const groupOf = new Int32Array(n);
  for (const p of pairs) {
    const root = find(p.i);
    if (!numbers.has(root)) numbers.set(root, numbers.size + 1);
    p.group = numbers.get(root)!;
    groupOf[p.i] = p.group;
    groupOf[p.j] = p.group;
  }
  return groupOf;
}

