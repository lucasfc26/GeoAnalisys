/**
 * Associação 1 para 1 entre os pontos de duas camadas.
 *
 * Um par (a, b) é candidato quando está a até `maxDistance` metros, ou quando atende a algum critério
 * de prioridade dentro da distância desse critério. Um critério é atendido quando os valores
 * (normalizados) das colunas escolhidas são iguais e não vazios e o par está a até a distância dele.
 *
 * Custo de um par = distância + penalidade (em metros) de cada critério não atendido. Cada ponto
 * sem par custa `unmatchedCost`. A associação escolhida é a de menor custo total, olhando todos os
 * pontos juntos (não par a par): um par só "rouba" o ponto de outro se isso diminuir o total.
 *
 * Resolvido como atribuição retangular (linhas = A; colunas = B + uma coluna "sem par" por linha,
 * custo 2 × unmatchedCost) com caminhos mínimos sucessivos (Dijkstra com potenciais, como no
 * Jonker-Volgenant esparso). Cada ponto de A começa no seu par mais barato, se estiver livre; só os
 * que disputam um ponto fazem a busca, que fica restrita à vizinhança da disputa.
 */

export interface AssocPoint {
  lat: number | null;
  lng: number | null;
  /** Valor normalizado de cada critério (null = vazio, nunca atende) */
  values: (string | null)[];
}

export interface AssocOptions {
  maxDistance: number;
  /**
   * Distância máxima e penalidade em metros quando não atendido (padrão 1) de cada critério.
   * `address`: atendido quando os endereços são parecidos (`addressesMatch`) ou quando um dos dois
   * está vazio/SDO (a regra não se aplica); só os parecidos estendem a distância de busca.
   * `count`: valores são quantidades de pontos na coordenada (`aggregateCounts`); ver `countCredit`.
   */
  criteria: { maxDistance: number; weight?: number; kind?: 'equal' | 'address' | 'count' }[];
  /** Custo em metros de deixar um ponto sem par (ausente/null = associar o máximo possível) */
  unmatchedCost?: number | null;
}

export interface AssocResult {
  /** Índice do ponto de B associado a cada ponto de A (-1 = sem associação) */
  matchA: Int32Array;
  /** Índice do ponto de A associado a cada ponto de B (-1 = sem associação) */
  matchB: Int32Array;
  /** Distância do par de cada ponto de A (NaN = sem associação) */
  distance: Float64Array;
  /** Custo do par de cada ponto de A: distância + penalidades (NaN = sem associação) */
  cost: Float64Array;
  /**
   * Margem do par de cada ponto de A: custo do segundo melhor candidato (de A ou de B) menos o
   * custo do par. Pequena ou negativa = interpretação dúbia (negativa: havia um par mais barato
   * para um dos pontos, deixado de lado pelo conjunto). Infinity = sem outro candidato; NaN = sem par.
   */
  margin: Float64Array;
  /** Critérios atendidos pelo par de cada ponto de A (bit k = critério k) */
  metMask: Uint32Array;
}

export const MAX_CRITERIA = 21;
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
 * Quantos pontos da mesma camada há na coordenada exata de cada ponto ("1" = sozinho). Usado como
 * valor da prioridade de agregados. Sem coordenada: null.
 */
export function aggregateCounts(coordKeys: (string | null)[]): (string | null)[] {
  const count = new Map<string, number>();
  for (const k of coordKeys) if (k !== null) count.set(k, (count.get(k) ?? 0) + 1);
  return coordKeys.map((k) => (k === null ? null : String(count.get(k))));
}

/**
 * Quanto da prioridade de agregados o par atende, pela quantidade de pontos na coordenada de cada
 * um: 1 = mesma quantidade (único com único, 3 com 3); 0,5 = agregados com 1 ponto de diferença (3
 * com 2 ou 4), metade da penalidade; 0 = o resto (único com agregado, 3 com 5…).
 */
export function countCredit(x: string | null, y: string | null): number {
  if (x === null || y === null) return 0;
  const a = Number(x);
  const b = Number(y);
  if (a === b) return 1;
  return a > 1 && b > 1 && Math.abs(a - b) === 1 ? 0.5 : 0;
}

/** Endereço em partes comparáveis: palavras (sem tipo de logradouro e conectivos) e números. */
export interface AddressTokens {
  words: string[];
  numbers: string[];
}

/**
 * Tipos de logradouro, complementos e conectivos: não identificam o endereço. Letras soltas como
 * "a", "e" e "o" ficam de fora (podem ser o nome da rua: "Rua A").
 */
const ADDRESS_STOPWORDS = new Set(
  (
    'r rua ruas av ave avn avenida tv trav travessa al alam alameda est estr estrada rod rodovia ' +
    'pc pca praca lg largo bc beco vl vila viela via lad ladeira passagem psg servidao srv ' +
    'qd qda quadra lt lote cs casa bl bloco ap apt apto apartamento km cj conj conjunto ' +
    'n no nr num numero de da do das dos em na nas nos ao prox proximo esq esquina ' +
    'frente fundos entre com sem s'
  ).split(' '),
);
/** Endereço ausente (comparado já normalizado, com as partes separadas por espaço). */
const NO_ADDRESS = new Set([
  'sdo',
  's d o',
  'sd',
  's d',
  'sn',
  's n',
  'ni',
  'n i',
  'na',
  'n a',
  'null',
  'sem endereco',
  'sem end',
  'nao informado',
  'nao consta',
  'nao possui',
  'nao identificado',
]);

/**
 * Partes do endereço (valor já normalizado por `normalizeValue`), ou null quando vazio, ausente
 * ("SDO", "S/N", "não informado"…) ou sem nada além do tipo de logradouro (ex.: só "Rua").
 */
export function addressTokens(value: string | null): AddressTokens | null {
  if (value === null) return null;
  const parts = value.match(/[a-z]+|\d+/g) ?? [];
  if (!parts.length || NO_ADDRESS.has(parts.join(' '))) return null;
  const words: string[] = [];
  const numbers: string[] = [];
  for (const t of parts) {
    if (/^\d/.test(t)) {
      const n = t.replace(/^0+/, '');
      if (n) numbers.push(n);
    } else if (!ADDRESS_STOPWORDS.has(t) && t !== 'sdo') words.push(t);
  }
  return words.length || numbers.length ? { words, numbers } : null;
}

/**
 * Endereços parecidos: algum número igual ou alguma palavra parecida. Palavra de 1 ou 2 letras só
 * casa com a mesma palavra ("Rua A" com "A"); de 3 letras ou mais, também com uma palavra que
 * comece por ela (abreviação: "Exe", "Exem" com "Exemplo"). Ex.: "Rua Exemplo 123" é parecido com
 * "Ex 123" (pelo número), "123", "exemplo" e "R. Exem"; não com "Ex" nem com "Av. Brasil 500".
 */
export function addressesMatch(x: AddressTokens, y: AddressTokens): boolean {
  for (const n of x.numbers) if (y.numbers.includes(n)) return true;
  for (const u of x.words) {
    for (const w of y.words) {
      if (u === w) return true;
      const [short, long] = u.length <= w.length ? [u, w] : [w, u];
      if (short.length >= 3 && long.startsWith(short)) return true;
    }
  }
  return false;
}

const hasCoords = (p: AssocPoint) =>
  p.lat !== null && p.lng !== null && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Custo de "sem par" quando não há limite: grande o bastante para valer mais que qualquer par. */
const NO_LIMIT = 1e9;

/** Fila de prioridade mínima (heap binário) de colunas por distância, com remoção preguiçosa. */
class MinHeap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;

  clear() {
    this.size = 0;
  }

  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      const v = new Int32Array(this.size * 2);
      k.set(this.keys);
      v.set(this.vals);
      this.keys = k;
      this.vals = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  /** Remove o menor; devolve o valor (a chave fica em `top`). */
  top = 0;
  pop(): number {
    const val = this.vals[0];
    this.top = this.keys[0];
    const n = --this.size;
    const key = this.keys[n];
    const v = this.vals[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = key;
    this.vals[i] = v;
    return val;
  }
}

export function associate(a: AssocPoint[], b: AssocPoint[], opts: AssocOptions): AssocResult {
  if (opts.criteria.length > MAX_CRITERIA) throw new Error(`No máximo ${MAX_CRITERIA} prioridades`);
  const nA = a.length;
  const nB = b.length;
  const matchA = new Int32Array(nA).fill(-1);
  const matchB = new Int32Array(nB).fill(-1);
  const distance = new Float64Array(nA).fill(NaN);
  const cost = new Float64Array(nA).fill(NaN);
  const metMask = new Uint32Array(nA);
  const margin = new Float64Array(nA).fill(NaN);

  const radius = Math.max(opts.maxDistance, ...opts.criteria.map((c) => c.maxDistance));
  if (!(radius > 0)) return { matchA, matchB, distance, cost, margin, metMask };
  const unmatched =
    opts.unmatchedCost === null || opts.unmatchedCost === undefined
      ? NO_LIMIT
      : Math.max(opts.unmatchedCost, 0);
  // Um par só compensa se custar menos que deixar os dois pontos sem par.
  const dummyCost = 2 * unmatched;
  const penalties = opts.criteria.map((c) => c.weight ?? 1);
  const allPenalties = penalties.reduce((s, w) => s + w, 0);

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

  // Pares candidatos, agrupados por ponto de A (rowStart[i]..rowStart[i+1]).
  let cap = 1024;
  let cj = new Int32Array(cap);
  let cd = new Float64Array(cap);
  let cc = new Float64Array(cap);
  let cmask = new Uint32Array(cap);
  let n = 0;
  const push = (j: number, d: number, c: number, mask: number) => {
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
      cj = grow(cj, new Int32Array(cap));
      cd = grow(cd, new Float64Array(cap));
      cc = grow(cc, new Float64Array(cap));
      cmask = grow(cmask, new Uint32Array(cap));
    }
    cj[n] = j;
    cd[n] = d;
    cc[n] = c;
    cmask[n] = mask;
    n++;
  };

  // Endereços em partes, uma vez por ponto (null = vazio/ausente: a regra não se aplica).
  const addresses = opts.criteria.map((c, k) =>
    c.kind === 'address'
      ? {
          a: a.map((p) => addressTokens(p.values[k])),
          b: b.map((q) => addressTokens(q.values[k])),
        }
      : null,
  );

  const rowStart = new Int32Array(nA + 1);
  a.forEach((p, i) => {
    rowStart[i] = n;
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
          let penalty = allPenalties;
          let mask = 0;
          /** Critérios atendidos de fato (sem os endereços vazios), que estendem a distância */
          let extend = 0;
          opts.criteria.forEach((c, k) => {
            if (d > c.maxDistance) return;
            if (c.kind === 'count') {
              // Quantidade parecida também estende a busca, mas só a igual conta como atendida.
              const credit = countCredit(p.values[k], q.values[k]);
              if (!credit) return;
              extend |= 1 << k;
              penalty -= penalties[k] * credit;
              if (credit === 1) mask |= 1 << k;
              return;
            }
            const addr = addresses[k];
            if (addr) {
              const x = addr.a[i];
              const y = addr.b[j];
              if (x && y && !addressesMatch(x, y)) return;
              if (x && y) extend |= 1 << k;
            } else {
              const v = p.values[k];
              if (v === null || v !== q.values[k]) return;
              extend |= 1 << k;
            }
            penalty -= penalties[k];
            mask |= 1 << k;
          });
          const c = d + Math.round(penalty * 1e6) / 1e6;
          if ((d <= opts.maxDistance || extend !== 0) && c < dummyCost) push(j, d, c, mask);
        }
      }
    }
  });
  rowStart[nA] = n;

  // Colunas: 0..nB-1 = pontos de B; nB + i = "sem par" do ponto i de A (custo dummyCost).
  const nCols = nB + nA;
  const colRow = new Int32Array(nCols).fill(-1);
  const rowCol = new Int32Array(nA).fill(-1);
  /** Par escolhido de cada linha (-1 = sem par) */
  const rowEdge = new Int32Array(nA).fill(-1);
  /** Potencial de cada coluna (custo reduzido = custo − v) */
  const v = new Float64Array(nCols);
  const edgeCost = (e: number) => (e < 0 ? dummyCost : cc[e]);

  // Início: cada linha no seu par mais barato (empate: ponto de B de menor índice), se estiver
  // livre. Com v = 0, isso é ótimo para as linhas atribuídas. As mais baratas escolhem primeiro.
  const best = new Int32Array(nA).fill(-1);
  const bestCost = new Float64Array(nA).fill(dummyCost);
  for (let i = 0; i < nA; i++) {
    for (let e = rowStart[i]; e < rowStart[i + 1]; e++) {
      if (cc[e] < bestCost[i] || (cc[e] === bestCost[i] && best[i] >= 0 && cj[e] < cj[best[i]])) {
        bestCost[i] = cc[e];
        best[i] = e;
      }
    }
  }
  const rows = new Uint32Array(nA);
  for (let i = 0; i < nA; i++) rows[i] = i;
  rows.sort((x, y) => bestCost[x] - bestCost[y] || x - y);
  const pending: number[] = [];
  for (const i of rows) {
    const e = best[i];
    const col = e < 0 ? nB + i : cj[e];
    if (colRow[col] < 0) {
      colRow[col] = i;
      rowCol[i] = col;
      rowEdge[i] = e;
    } else pending.push(i);
  }

  // Cada linha restante entra pelo caminho de aumento mais barato (Dijkstra nos custos reduzidos).
  const dist = new Float64Array(nCols).fill(Infinity);
  const predRow = new Int32Array(nCols);
  const predEdge = new Int32Array(nCols);
  const scanned = new Uint8Array(nCols);
  const touched: number[] = [];
  const scannedList: number[] = [];
  const heap = new MinHeap();
  const relax = (row: number, base: number) => {
    const visit = (col: number, e: number) => {
      if (scanned[col]) return;
      const alt = base + edgeCost(e) - v[col];
      if (alt < dist[col]) {
        if (dist[col] === Infinity) touched.push(col);
        dist[col] = alt;
        predRow[col] = row;
        predEdge[col] = e;
        heap.push(alt, col);
      }
    };
    for (let e = rowStart[row]; e < rowStart[row + 1]; e++) visit(cj[e], e);
    visit(nB + row, -1);
  };

  for (const i of pending) {
    relax(i, 0);
    let end = -1;
    let mu = 0;
    while (heap.size) {
      const col = heap.pop();
      if (scanned[col] || heap.top > dist[col]) continue;
      mu = dist[col];
      if (colRow[col] < 0) {
        end = col;
        break;
      }
      scanned[col] = 1;
      scannedList.push(col);
      const k = colRow[col];
      // Custo reduzido do par atual de k é o "potencial" da linha: o caminho segue a partir dele.
      relax(k, mu - (edgeCost(rowEdge[k]) - v[col]));
    }
    for (const col of scannedList) v[col] += dist[col] - mu;
    // Aumento: cada coluna do caminho passa para a linha que chegou nela.
    for (let col = end; ;) {
      const k = predRow[col];
      const prev = rowCol[k];
      colRow[col] = k;
      rowCol[k] = col;
      rowEdge[k] = predEdge[col];
      if (k === i) break;
      col = prev;
    }
    for (const col of touched) {
      dist[col] = Infinity;
      scanned[col] = 0;
    }
    touched.length = 0;
    scannedList.length = 0;
    heap.clear();
  }

  // Menor custo de outro candidato do ponto de B de cada par.
  const colAlt = new Float64Array(nB).fill(Infinity);
  for (let i = 0; i < nA; i++) {
    for (let e = rowStart[i]; e < rowStart[i + 1]; e++) {
      if (e !== rowEdge[i] && cc[e] < colAlt[cj[e]]) colAlt[cj[e]] = cc[e];
    }
  }
  for (let i = 0; i < nA; i++) {
    const e = rowEdge[i];
    if (e < 0) continue;
    matchA[i] = cj[e];
    matchB[cj[e]] = i;
    distance[i] = cd[e];
    cost[i] = cc[e];
    metMask[i] = cmask[e];
    let alt = colAlt[cj[e]];
    for (let f = rowStart[i]; f < rowStart[i + 1]; f++) if (f !== e && cc[f] < alt) alt = cc[f];
    margin[i] = alt - cc[e];
  }
  return { matchA, matchB, distance, cost, margin, metMask };
}
