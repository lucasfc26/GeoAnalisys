/**
 * Associação 1 para 1 entre os pontos de duas camadas.
 *
 * Um par (a, b) é candidato quando está a até `maxDistance` metros, ou quando atende a algum critério
 * de prioridade dentro da distância desse critério. Um critério é atendido quando os valores
 * (normalizados) das colunas escolhidas são iguais e não vazios e o par está a até a distância dele.
 *
 * Os pares são escolhidos do melhor para o pior: maior soma dos pesos dos critérios atendidos, depois
 * menor distância. Cada ponto entra em no máximo um par.
 */

export interface AssocPoint {
  lat: number | null;
  lng: number | null;
  /** Valor normalizado de cada critério (null = vazio, nunca atende) */
  values: (string | null)[];
}

export interface AssocOptions {
  maxDistance: number;
  /** Distância máxima e peso (padrão 1) de cada critério de prioridade */
  criteria: { maxDistance: number; weight?: number }[];
}

export interface AssocResult {
  /** Índice do ponto de B associado a cada ponto de A (-1 = sem associação) */
  matchA: Int32Array;
  /** Índice do ponto de A associado a cada ponto de B (-1 = sem associação) */
  matchB: Int32Array;
  /** Distância do par de cada ponto de A (NaN = sem associação) */
  distance: Float64Array;
  /** Critérios atendidos pelo par de cada ponto de A (bit k = critério k) */
  metMask: Uint32Array;
}

export const MAX_CRITERIA = 20;
/** Limite de pares candidatos (memória): acima disso, pede para diminuir as distâncias. */
export const MAX_CANDIDATES = 20_000_000;

const EARTH_RADIUS = 6_371_008.8;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS;
const RAD = Math.PI / 180;

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Texto comparável: sem acentos, minúsculo e sem espaços nas pontas; vazio vira null. */
export function normalizeValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = (typeof v === 'object' ? JSON.stringify(v) : String(v))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  return s === '' ? null : s;
}

/**
 * Tipo de cada ponto pela coordenada exata: "unico" (sozinho na coordenada) ou "agregado" (há outros
 * pontos da mesma camada nela). Usado como valor da prioridade de agregados. Sem coordenada: null.
 */
export function aggregateKinds(coordKeys: (string | null)[]): (string | null)[] {
  const count = new Map<string, number>();
  for (const k of coordKeys) if (k !== null) count.set(k, (count.get(k) ?? 0) + 1);
  return coordKeys.map((k) => (k === null ? null : count.get(k)! > 1 ? 'agregado' : 'unico'));
}

const hasCoords = (p: AssocPoint) =>
  p.lat !== null && p.lng !== null && Number.isFinite(p.lat) && Number.isFinite(p.lng);

export function associate(a: AssocPoint[], b: AssocPoint[], opts: AssocOptions): AssocResult {
  if (opts.criteria.length > MAX_CRITERIA) throw new Error(`No máximo ${MAX_CRITERIA} prioridades`);
  const matchA = new Int32Array(a.length).fill(-1);
  const matchB = new Int32Array(b.length).fill(-1);
  const distance = new Float64Array(a.length).fill(NaN);
  const metMask = new Uint32Array(a.length);

  const radius = Math.max(opts.maxDistance, ...opts.criteria.map((c) => c.maxDistance));
  if (!(radius > 0)) return { matchA, matchB, distance, metMask };

  // Grade em graus: a célula de longitude usa a maior latitude (a mais estreita), então os vizinhos
  // diretos sempre cobrem o raio.
  let maxAbsLat = 0;
  for (const p of a) if (hasCoords(p)) maxAbsLat = Math.max(maxAbsLat, Math.abs(p.lat!));
  for (const p of b) if (hasCoords(p)) maxAbsLat = Math.max(maxAbsLat, Math.abs(p.lat!));
  const cellLat = (radius / M_PER_DEG_LAT) * 1.01;
  const cellLng = cellLat / Math.max(Math.cos(Math.min(maxAbsLat, 89) * RAD), 0.01);
  const cellKey = (cx: number, cy: number) => `${cx}:${cy}`;
  const grid = new Map<string, number[]>();
  b.forEach((p, j) => {
    if (!hasCoords(p)) return;
    const k = cellKey(Math.floor(p.lng! / cellLng), Math.floor(p.lat! / cellLat));
    const list = grid.get(k);
    if (list) list.push(j);
    else grid.set(k, [j]);
  });

  let cap = 1024;
  let ci = new Int32Array(cap);
  let cj = new Int32Array(cap);
  let cd = new Float64Array(cap);
  let cscore = new Float64Array(cap);
  let cmask = new Uint32Array(cap);
  let n = 0;
  const push = (i: number, j: number, d: number, score: number, mask: number) => {
    if (n === cap) {
      if (cap >= MAX_CANDIDATES) {
        throw new Error(
          'Pontos demais dentro das distâncias escolhidas. Diminua a distância máxima ou a das prioridades.',
        );
      }
      cap = Math.min(cap * 2, MAX_CANDIDATES);
      const grow = <T extends Int32Array | Float64Array | Uint32Array>(arr: T, next: T) => {
        next.set(arr);
        return next;
      };
      ci = grow(ci, new Int32Array(cap));
      cj = grow(cj, new Int32Array(cap));
      cd = grow(cd, new Float64Array(cap));
      cscore = grow(cscore, new Float64Array(cap));
      cmask = grow(cmask, new Uint32Array(cap));
    }
    ci[n] = i;
    cj[n] = j;
    cd[n] = d;
    cscore[n] = score;
    cmask[n] = mask;
    n++;
  };

  a.forEach((p, i) => {
    if (!hasCoords(p)) return;
    const cx = Math.floor(p.lng! / cellLng);
    const cy = Math.floor(p.lat! / cellLat);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(cellKey(cx + dx, cy + dy));
        if (!list) continue;
        for (const j of list) {
          const q = b[j];
          const d = haversine(p.lat!, p.lng!, q.lat!, q.lng!);
          if (d > radius) continue;
          let score = 0;
          let mask = 0;
          opts.criteria.forEach((c, k) => {
            const v = p.values[k];
            if (v !== null && v === q.values[k] && d <= c.maxDistance) {
              score += c.weight ?? 1;
              mask |= 1 << k;
            }
          });
          if (d <= opts.maxDistance || mask !== 0) push(i, j, d, Math.round(score * 1e6) / 1e6, mask);
        }
      }
    }
  });

  const order = new Uint32Array(n);
  for (let k = 0; k < n; k++) order[k] = k;
  order.sort(
    (x, y) => cscore[y] - cscore[x] || cd[x] - cd[y] || ci[x] - ci[y] || cj[x] - cj[y],
  );
  for (const k of order) {
    const i = ci[k];
    const j = cj[k];
    if (matchA[i] >= 0 || matchB[j] >= 0) continue;
    matchA[i] = j;
    matchB[j] = i;
    distance[i] = cd[k];
    metMask[i] = cmask[k];
  }
  return { matchA, matchB, distance, metMask };
}
