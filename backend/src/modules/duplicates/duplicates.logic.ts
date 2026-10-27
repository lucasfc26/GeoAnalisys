/**
 * Duplicidades: pares de pontos da camada 1 que podem ser o mesmo ponto cadastrado duas vezes em
 * relação à camada 2 (referência).
 *
 * Todo par a até `radius` metros é candidato. A pontuação do par soma os pesos dos sinais atendidos
 * (pesos negativos diminuem a chance):
 * - associação à referência: os dois disputam o mesmo ponto da referência (um ficou com ele e o
 *   outro ficou sem par, mas o alcança), cada um tem o seu, só um associado ou nenhum;
 * - mesma coordenada;
 * - IDs em sequência (cadastro intencional de dois pontos) ou sem relação (cadastro repetido por
 *   engano);
 * - atributos iguais/diferentes (ex.: mesma lâmpada e potência com cadastrador diferente);
 * - quantidade de pontos sem associação por perto (área nova, onde pontos próximos são esperados).
 * Ficam os pares com pontuação ≥ `minScore` (suspeitos).
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
  /** Posição do ponto da referência associado (null = sem associação) */
  refPos?: { lat: number; lng: number } | null;
  /** ID comparado pela regra de IDs (null = vazio) */
  idKey?: string | null;
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
  /**
   * Pesos pela associação à referência; null = sem referência. `shared`: um associado e o outro sem
   * par, mas a até `maxDistance` m do mesmo ponto da referência (disputam o mesmo ponto); `oneMatched`:
   * um associado e o outro sem par e sem alcançar o ponto dele.
   */
  reference: {
    maxDistance: number;
    shared: number;
    bothMatched: number;
    oneMatched: number;
    noneMatched: number;
  } | null;
  /** IDs em sequência (diferença até `maxGap` ou um começa com o outro) ou sem relação; null = desligado */
  ids: { maxGap: number; sequential: number; unrelated: number } | null;
  /** A partir de `minCount` pontos sem associação a até `radius` m do par (sem contar os dois): `weight` */
  density: { radius: number; minCount: number; weight: number } | null;
  minScore: number;
  /** Também lista os pares abaixo da mínima que envolvem um ponto suspeito */
  includeNearby?: boolean;
}

/**
 * Parcela da pontuação: 'same', 'rule:<k>', 'ref:shared' | 'ref:both' | 'ref:one' | 'ref:none',
 * 'id:seq' | 'id:unrelated', 'density'
 */
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

/**
 * Relação entre dois IDs: "sequential" quando parecem cadastrados de propósito em sequência (números
 * a até `maxGap` um do outro, ou um começa com o outro: 123456 e 123457 ou 1234562); "unrelated"
 * quando menos da metade do começo é igual (123456 e 234123: provável cadastro repetido por
 * engano); null nos demais casos (ou ID vazio/igual).
 */
export function idRelation(a: string | null, b: string | null, maxGap: number) {
  if (a === null || b === null || a === b) return null;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const gap = BigInt(a) > BigInt(b) ? BigInt(a) - BigInt(b) : BigInt(b) - BigInt(a);
    if (gap <= BigInt(Math.max(0, Math.floor(maxGap)))) return 'sequential' as const;
  }
  if (a.startsWith(b) || b.startsWith(a)) return 'sequential' as const;
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return common < Math.max(a.length, b.length) / 2 ? ('unrelated' as const) : null;
}

export function findDuplicates(pts: DupPoint[], opts: DupOptions): DupPair[] {
  if (opts.rules.length > MAX_RULES) throw new Error(`No máximo ${MAX_RULES} regras de atributo`);
  if (!(opts.radius > 0)) return [];
  const near = opts.density && opts.reference ? unmatchedNeighbors(pts, opts.density.radius) : null;

  const scorePair = (i: number, j: number, distance: number) => {
    const p = pts[i];
    const q = pts[j];
    const sameCoord = p.coordKey !== null && p.coordKey === q.coordKey;
    const parts: DupPart[] = [];
    if (sameCoord && opts.sameCoordWeight)
      parts.push({ key: 'same', weight: opts.sameCoordWeight });
    opts.rules.forEach((r, k) => {
      if (r.scope === 'sameCoord' && !sameCoord) return;
      const a = p.values[k];
      const b = q.values[k];
      if (a === null || b === null) return;
      if ((r.mode === 'equal') === (a === b)) parts.push({ key: `rule:${k}`, weight: r.weight });
    });
    if (opts.reference && p.matched !== null && q.matched !== null) {
      const ref = opts.reference;
      const n = Number(p.matched) + Number(q.matched);
      let key: string;
      let weight: number;
      if (n === 2) [key, weight] = ['ref:both', ref.bothMatched];
      else if (n === 0) [key, weight] = ['ref:none', ref.noneMatched];
      else {
        // O sem par alcança o ponto da referência que ficou com o outro: disputam o mesmo ponto.
        const [hit, other] = p.matched ? [p, q] : [q, p];
        const pos = hit.refPos;
        const shared =
          !!pos &&
          hasCoords(other) &&
          haversine(other.lat!, other.lng!, pos.lat, pos.lng) <= ref.maxDistance;
        [key, weight] = shared ? ['ref:shared', ref.shared] : ['ref:one', ref.oneMatched];
      }
      if (weight) parts.push({ key, weight });
    }
    if (opts.ids) {
      const rel = idRelation(p.idKey ?? null, q.idKey ?? null, opts.ids.maxGap);
      if (rel === 'sequential' && opts.ids.sequential)
        parts.push({ key: 'id:seq', weight: opts.ids.sequential });
      if (rel === 'unrelated' && opts.ids.unrelated)
        parts.push({ key: 'id:unrelated', weight: opts.ids.unrelated });
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
