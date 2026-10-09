/**
 * Reconhece coordenadas digitadas na busca: latitude/longitude ou UTM X/Y, separadas por vírgula,
 * ponto e vírgula ou espaço, com ponto ou vírgula decimal. Exemplos:
 *   -3.5073866,-38.9065257 · -3,5073866; -38,9065257 · 510376,5  9612212,7 · 510376.5 9612212.7
 */

export type ParsedCoord =
  | { kind: 'latlng'; lat: number; lng: number }
  | { kind: 'projected'; x: number; y: number };

const NUM = /^[-+]?\d+(?:[.,]\d+)?$/;
const toNum = (s: string) => (NUM.test(s) ? Number(s.replace(',', '.')) : NaN);

/** Os dois números do texto, ou null se não for um par de números. */
export function splitPair(text: string): [number, number] | null {
  const t = text.trim();
  if (!t) return null;
  let parts: string[];
  if (t.includes(';')) parts = t.split(';');
  else if (/\s/.test(t)) parts = t.split(/[\s,]*\s[\s,]*/); // espaço (com ou sem vírgula junto)
  else {
    const commas = t.split(',');
    if (commas.length === 2) parts = commas; // -3.5,-38.9
    else if (commas.length === 4) parts = [`${commas[0]},${commas[1]}`, `${commas[2]},${commas[3]}`];
    else return null;
  }
  parts = parts.map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const a = toNum(parts[0]);
  const b = toNum(parts[1]);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

/** Faixas típicas de UTM: leste 100 mil–900 mil m; norte 0–10 milhões m. */
const isEasting = (n: number) => n >= 100_000 && n <= 999_999;
const isNorthing = (n: number) => n >= 0 && n <= 10_000_000;

/**
 * Interpreta o par: lat/lng (na ordem "latitude, longitude"; invertido se a 1ª passar de 90) ou
 * coordenada projetada X/Y (na ordem que fizer sentido para UTM).
 */
export function parseCoordinate(text: string): ParsedCoord | null {
  const pair = splitPair(text);
  if (!pair) return null;
  const [a, b] = pair;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { kind: 'latlng', lat: a, lng: b };
  if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return { kind: 'latlng', lat: b, lng: a };
  if (isEasting(a) && isNorthing(b)) return { kind: 'projected', x: a, y: b };
  if (isNorthing(a) && isEasting(b)) return { kind: 'projected', x: b, y: a };
  if (Math.abs(a) > 180 || Math.abs(b) > 180) return { kind: 'projected', x: a, y: b };
  return null;
}
