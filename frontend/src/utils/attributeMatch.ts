/**
 * Pareamento Inteligente de atributos entre duas camadas: compara os nomes (sem acentos, maiúsculas
 * ou separadores, com abreviações e sinônimos comuns — cod = código, obs = observação…), os valores
 * de uma amostra das duas camadas (valores em comum) e a compatibilidade dos tipos. Cada atributo de
 * destino recebe no máximo um de origem: os pares mais parecidos são escolhidos primeiro.
 */
import type { ColumnKind } from '@/types';

export interface MatchColumn {
  name: string;
  kind: ColumnKind;
}

export interface AttributeMatch {
  source: string;
  target: string;
  /** 0–1 */
  score: number;
  reason: string;
}

/** Abaixo disso o atributo fica sem par (em branco = não copiar). */
export const MIN_SCORE = 0.5;

const SYNONYMS: Record<string, string[]> = {
  codigo: ['cod', 'code', 'cd'],
  numero: ['num', 'nr', 'nro', 'no', 'n', 'number', 'numer'],
  descricao: ['desc', 'descr', 'description'],
  observacao: ['obs', 'observacoes', 'comentario', 'comentarios', 'nota', 'notas', 'remark'],
  endereco: ['end', 'address', 'logradouro', 'logr', 'rua'],
  bairro: ['distrito', 'neighborhood', 'bair'],
  municipio: ['munic', 'mun', 'cidade', 'city'],
  latitude: ['lat'],
  longitude: ['lon', 'lng', 'long'],
  potencia: ['pot', 'power', 'watts', 'watt'],
  lampada: ['lamp', 'lampadas'],
  quantidade: ['qtd', 'qtde', 'quant', 'qty', 'qt'],
  data: ['dt', 'date'],
  tipo: ['tp', 'type'],
  situacao: ['sit', 'status', 'estado'],
  medidor: ['med', 'meter'],
  nome: ['name', 'nm'],
  id: ['idd', 'gid', 'fid', 'identificador'],
  foto: ['fotos', 'photo', 'photos', 'imagem'],
  link: ['url', 'href'],
  poste: ['post', 'postes'],
};
const CANON = new Map<string, string>();
for (const [canon, list] of Object.entries(SYNONYMS)) {
  CANON.set(canon, canon);
  for (const s of list) CANON.set(s, canon);
}
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'the', 'of']);

/** Sem acento, minúsculo e sem separador: "UTM X" e "utm_x" viram "utmx". */
function flatName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Papel de coordenada. Neste cadastro UTMX fica no lugar da latitude e UTMY no da longitude
 * (o arquivo traz o valor projetado na coluna geográfica da tabela).
 */
function coordRole(name: string): 'latitude' | 'longitude' | null {
  const n = flatName(name);
  if (/^(lat|latitude|utmx|coordx|coordenadax)$/.test(n)) return 'latitude';
  if (/^(lon|lng|long|longitude|utmy|coordy|coordenaday)$/.test(n)) return 'longitude';
  return null;
}

/** Palavras do nome: sem acentos, separando camelCase, _ e números, com sinônimos padronizados. */
export function nameTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => CANON.get(t) ?? t);
}

/**
 * Mesma quantidade de palavras, e cada uma é igual ou um prefixo da outra (placa ≈ placall).
 * 0 quando a estrutura não acompanha.
 */
function prefixTokenScore(ta: string[], tb: string[]): number {
  if (!ta.length || ta.length !== tb.length) return 0;
  let soft = 0;
  for (let i = 0; i < ta.length; i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    if (s.length >= 3 && l.startsWith(s) && l.length - s.length <= 4) {
      soft++;
      continue;
    }
    return 0;
  }
  return soft ? 0.92 : 0;
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Coeficiente de Dice nos bigramas (0–1). */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** Semelhança dos nomes (0–1). */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  const ja = ta.join('');
  const jb = tb.join('');
  if (!ja || !jb) return 0;
  if (ja === jb) return 1;
  const roleA = coordRole(a);
  const roleB = coordRole(b);
  if (roleA && roleB) return roleA === roleB ? 0.98 : 0.15;
  const sa = new Set(ta);
  const sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const jaccard = inter / new Set([...sa, ...sb]).size;
  const [short, long] = ja.length <= jb.length ? [ja, jb] : [jb, ja];
  const contained =
    short.length >= 3 && long.includes(short) ? 0.7 + 0.2 * (short.length / long.length) : 0;
  return Math.max(jaccard * 0.95, dice(ja, jb) * 0.9, contained, prefixTokenScore(ta, tb));
}

const isNumeric = (k: ColumnKind) => k === 'integer' || k === 'number';
const isDate = (k: ColumnKind) => k === 'date' || k === 'datetime';
const numLike = (v: unknown) =>
  typeof v === 'number' || (typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v));

/** Quanto o valor de origem cabe no tipo de destino (0–1). */
export function typeFit(src: MatchColumn, dst: MatchColumn, srcValues: unknown[] = []): number {
  if (src.kind === dst.kind) return 1;
  if (isNumeric(src.kind) && isNumeric(dst.kind)) return dst.kind === 'integer' ? 0.85 : 0.95;
  if (isDate(src.kind) && isDate(dst.kind)) return 0.95;
  if (dst.kind === 'text') return 0.9;
  if (src.kind === 'text' && isNumeric(dst.kind)) {
    const vals = srcValues.filter((v) => v !== null && v !== undefined && v !== '');
    return vals.length && vals.filter(numLike).length / vals.length >= 0.9 ? 0.85 : 0.3;
  }
  if (src.kind === 'text' && (dst.kind === 'boolean' || isDate(dst.kind))) return 0.5;
  return 0.4;
}

const valueKey = (v: unknown) =>
  (typeof v === 'object' ? JSON.stringify(v) : String(v))
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Valores em comum nas amostras: |A ∩ B| / min(|A|, |B|); 0 com poucos valores distintos. */
export function valueOverlap(a: unknown[], b: unknown[]): number {
  const set = (vs: unknown[]) =>
    new Set(vs.filter((v) => v !== null && v !== undefined && v !== '').map(valueKey));
  const A = set(a);
  const B = set(b);
  if (A.size < 3 || B.size < 3) return 0;
  let inter = 0;
  for (const v of A) if (B.has(v)) inter++;
  return inter / Math.min(A.size, B.size);
}

/**
 * Melhores pares origem → destino. `sourceRows`/`targetRows`: amostras de registros (dados por
 * coluna) para comparar valores; sem elas, só nomes e tipos.
 */
export function smartPair(
  source: MatchColumn[],
  target: MatchColumn[],
  sourceRows: Record<string, unknown>[] = [],
  targetRows: Record<string, unknown>[] = [],
): AttributeMatch[] {
  const values = (rows: Record<string, unknown>[], col: string) => rows.map((r) => r[col]);
  const candidates: AttributeMatch[] = [];
  for (const s of source) {
    const sv = values(sourceRows, s.name);
    for (const t of target) {
      const name = nameSimilarity(s.name, t.name);
      const overlap = valueOverlap(sv, values(targetRows, t.name));
      let base = name;
      let reason = name === 1 ? 'mesmo nome' : `nome parecido (${Math.round(name * 100)}%)`;
      if (overlap >= 0.3) {
        const combined = name >= 0.4 ? Math.min(1, name * 0.7 + overlap * 0.45) : overlap * 0.8;
        if (combined > base) {
          base = combined;
          reason = `${name >= 0.4 ? `${reason} e ` : ''}valores em comum (${Math.round(overlap * 100)}%)`;
        }
      }
      const fit = typeFit(s, t, sv);
      // Nome quase igual (espaço, acento, abreviação, prefixo) não se perde por o arquivo ter sido lido como texto.
      let score = base * fit;
      if (name >= 0.85) score = Math.max(score, name * 0.9);
      if (score >= MIN_SCORE) candidates.push({ source: s.name, target: t.name, score, reason });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source));
  const usedS = new Set<string>();
  const usedT = new Set<string>();
  const out: AttributeMatch[] = [];
  for (const c of candidates) {
    if (usedS.has(c.source) || usedT.has(c.target)) continue;
    usedS.add(c.source);
    usedT.add(c.target);
    out.push(c);
  }
  return out;
}
