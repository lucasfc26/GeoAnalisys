/**
 * Leitura de coordenadas em texto livre e conversão latitude/longitude ↔ UTM (sem banco, testável).
 *
 * Valores aceitos (um eixo): -3,84386839999999 · -38.4041111 · 566160,537294959 · 9.575.107,59 ·
 * 3º 50' 37,926" S · 38°24'14.8"W · S 3 50 37.9 · 3:50:37.9S · 3° 50,632' S · 38,404 O.
 * Pares numa só célula: "-3,8438, -38,4041" · "-3.84;-38.40" · "566160,53 9575107,59" ·
 * "3º 50' 37,926" S 38º 24' 14,8" W" · "POINT(-38.40 -3.84)" · "lat: -3.84 lon: -38.40" · "(-3.84, -38.40)".
 */
import proj4 from 'proj4';

export type Axis = 'lat' | 'lng';

interface Token {
  value: number;
  /** Eixo indicado pelo hemisfério (N/S = latitude; E/W/L/O = longitude) */
  axis: Axis | null;
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;

/** Número com vírgula ou ponto decimal (e milhar pt-BR/en), sem limite de dígitos. */
export function parseNumber(text: string): number | null {
  const s = text
    .trim()
    .replace(/^\+\s*/, '')
    .replace(/^[−–]/, '-');
  let t: string | null = null;
  if (/^-?\d+(?:[.,]\d+)?$/.test(s)) t = s.replace(',', '.');
  else if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s)) t = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) t = s.replace(/,/g, '');
  else if (/^-?\d*[.,]\d+$/.test(s)) t = s.replace(',', '.').replace(/^(-?)\./, '$10.');
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Símbolos e palavras padronizados: ° ' " e hemisférios N S E W. */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/[º˚ᵒ°]/g, '°')
    .replace(/[’′´`‘]/g, "'")
    .replace(/[”″“]|''/g, '"')
    .replace(/[−–—]/g, '-')
    .replace(/\bgraus?\b/gi, '°')
    .replace(/\b(?:sul|south)\b/gi, 'S')
    .replace(/\b(?:norte|north)\b/gi, 'N')
    .replace(/\b(?:oeste|west)\b/gi, 'W')
    .replace(/\b(?:leste|este|east)\b/gi, 'E')
    .replace(/\s+/g, ' ');
}

const HEMI: Record<string, { sign: number; axis: Axis }> = {
  N: { sign: 1, axis: 'lat' },
  S: { sign: -1, axis: 'lat' },
  E: { sign: 1, axis: 'lng' },
  L: { sign: 1, axis: 'lng' },
  W: { sign: -1, axis: 'lng' },
  O: { sign: -1, axis: 'lng' },
};

/** Um eixo: decimal, graus/minutos(/segundos), com sinal ou hemisfério. */
function parseToken(raw: string): Token | null {
  let s = normalize(raw);
  if (!s) return null;
  let hemi: (typeof HEMI)[string] | null = null;
  const pre = /^([NSEWLO])\s*(?=[-+\d])/i.exec(s);
  const suf = /(?<=[\d°'".\s])\s*([NSEWLO])$/i.exec(s);
  if (pre) {
    hemi = HEMI[pre[1].toUpperCase()];
    s = s.slice(pre[0].length);
  } else if (suf) {
    hemi = HEMI[suf[1].toUpperCase()];
    s = s.slice(0, suf.index);
  }
  s = s.trim();
  let negative = false;
  if (/^[-+]/.test(s)) {
    negative = s[0] === '-';
    s = s.slice(1).trim();
  }

  let value: number | null = parseNumber(s);
  if (value === null) {
    // Graus, minutos e segundos: 3° 50' 37,9" · 3 50 37.9 · 3:50:37.9 · 3° 50,632'
    const m = new RegExp(
      String.raw`^(${NUM})\s*(?:°|:|\s)\s*(?:(${NUM})\s*(?:'|:|\s)?\s*(?:(${NUM})\s*"?)?)?$`,
    ).exec(s);
    if (!m || !/[°'":\s]/.test(s)) return null;
    const deg = parseNumber(m[1]);
    const min = m[2] ? parseNumber(m[2]) : 0;
    const sec = m[3] ? parseNumber(m[3]) : 0;
    if (deg === null || min === null || sec === null || min >= 60 || sec >= 60) return null;
    if ((m[3] && !Number.isInteger(min)) || (m[2] && !Number.isInteger(deg))) return null;
    value = deg + min / 60 + sec / 3600;
  }
  if (negative) value = -value;
  if (hemi) value = Math.abs(value) * hemi.sign;
  return { value, axis: hemi?.axis ?? null };
}

/** Valor de uma coordenada (um eixo) a partir de número ou texto; null se não for coordenada. */
export function parseCoordValue(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v !== 'string') return null;
  return parseToken(v)?.value ?? null;
}

/** O texto tem formato de graus/minutos/segundos ou hemisfério (só faz sentido em lat/lng). */
export function looksAngular(v: unknown): boolean {
  return typeof v === 'string' && /[°º˚'’′"”″]|\d\s*[NSWLOE]\s*$|^\s*[NSWLOE]\s*\d/i.test(v);
}

export interface RawPair {
  a: Token;
  b: Token;
  /** Ordem indicada pelo próprio texto (WKT/rótulos): 'xy' = X/longitude primeiro */
  order: 'xy' | 'yx' | null;
}

function tokens(a: string, b: string, order: RawPair['order'] = null): RawPair | null {
  const ta = parseToken(a);
  const tb = parseToken(b);
  return ta && tb ? { a: ta, b: tb, order } : null;
}

/** Os dois valores de uma célula com o par de coordenadas, na ordem em que aparecem. */
export function splitCoordPair(v: unknown): RawPair | null {
  if (typeof v !== 'string') return null;
  let s = normalize(v);
  if (!s) return null;

  // WKT: POINT (x y) — sempre X/longitude primeiro.
  const wkt = /^(?:SRID=\d+;)?\s*POINT\s*Z?\s*\(\s*(\S+)\s+(\S+)(?:\s+\S+)?\s*\)$/i.exec(s);
  if (wkt) return tokens(wkt[1], wkt[2], 'xy');

  // Rótulos: "lat: -3.8 lon: -38.4", "X=566160 Y=9575107", "E 566160 N 9575107".
  let order: RawPair['order'] = null;
  const label =
    /^(lat(?:itude)?|lon(?:gitude)?|lng|long|x|y|utm[ _]?[xyen]|leste|norte)\b\s*[:=]?/i.exec(s);
  if (label) {
    order = /^(lat|y|utm[ _]?[yn]|norte)/i.test(label[1]) ? 'yx' : 'xy';
    s = s
      .replace(/\b(?:lat(?:itude)?|lon(?:gitude)?|lng|long|utm[ _]?[xyen]|x|y)\b\s*[:=]?/gi, ' ')
      .trim();
  }
  s = s.replace(/^[([{]\s*|\s*[)\]}]$/g, '').trim();

  // Separadores sem ambiguidade.
  const sep = /\s*[;|\t]\s*|\s+\/\s+|\s*\/\s*(?=[-+\dNSEWLO])/i.exec(s);
  if (sep && sep.index > 0)
    return tokens(s.slice(0, sep.index), s.slice(sep.index + sep[0].length), order);

  // Graus/minutos/segundos ou hemisférios: "S 3°50' W 38°24'" ou "3°50'37"S 38°24'14"W".
  const prefix = /^([NSEWLO]\s*[^A-Za-z]+?)\s*,?\s*([NSEWLO]\s*[^A-Za-z]+)$/i.exec(s);
  if (prefix) return tokens(prefix[1], prefix[2], order);
  const suffix = /^([^A-Za-z]+?[NSEWLO])\s*,?\s*([^A-Za-z]+?[NSEWLO])$/i.exec(s);
  if (suffix) return tokens(suffix[1], suffix[2], order);
  if (/°/.test(s)) {
    const deg = new RegExp(String.raw`^(.+?)\s*[,\s]\s*([-+]?${NUM}\s*°.*)$`).exec(s);
    if (deg) return tokens(deg[1], deg[2], order);
    return null;
  }

  // Só números: espaço (com ou sem vírgula junto) ou vírgula.
  let parts: string[];
  if (/\s/.test(s)) parts = s.split(/[\s,]*\s[\s,]*/);
  else {
    const commas = s.split(',');
    if (commas.length === 2) parts = commas;
    else if (commas.length === 4)
      parts = [`${commas[0]},${commas[1]}`, `${commas[2]},${commas[3]}`];
    else return null;
  }
  parts = parts.filter(Boolean);
  return parts.length === 2 ? tokens(parts[0], parts[1], order) : null;
}

/** Faixas típicas de UTM: leste 100 mil–999 mil m; norte 0–10 milhões m. */
export const isEasting = (n: number) => n >= 100_000 && n <= 999_999;
export const isNorthing = (n: number) => n >= 0 && n <= 10_000_000;

/**
 * Par → X/Y no sistema da camada. Geográfico: X = longitude, Y = latitude (ordem pelo hemisfério,
 * pelos rótulos/WKT, pela faixa de valores ou, sem pistas, "latitude, longitude"). Projetado: leste
 * e norte na ordem que fizer sentido para UTM.
 */
export function pairToXY(pair: RawPair, geographic: boolean): { x: number; y: number } | null {
  const { a, b } = pair;
  if (geographic) {
    let lat: number;
    let lng: number;
    if (a.axis === 'lng' || b.axis === 'lat' || (!a.axis && !b.axis && pair.order === 'xy'))
      [lng, lat] = [a.value, b.value];
    else if (a.axis === 'lat' || b.axis === 'lng' || pair.order === 'yx')
      [lat, lng] = [a.value, b.value];
    else if (Math.abs(a.value) > 90) [lng, lat] = [a.value, b.value];
    else [lat, lng] = [a.value, b.value];
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { x: lng, y: lat } : null;
  }
  // "E 566160 N 9575107": hemisfério indica leste (E) e norte (N).
  if (a.axis || b.axis) {
    const swap = a.axis === 'lat' || b.axis === 'lng';
    return swap
      ? { x: Math.abs(b.value), y: Math.abs(a.value) }
      : { x: Math.abs(a.value), y: Math.abs(b.value) };
  }
  if (pair.order === 'yx') return { x: b.value, y: a.value };
  if (pair.order === 'xy') return { x: a.value, y: b.value };
  if (isNorthing(a.value) && isEasting(b.value) && !(isEasting(a.value) && isNorthing(b.value)))
    return { x: b.value, y: a.value };
  if (!isEasting(a.value) && isEasting(b.value) && b.value < a.value)
    return { x: b.value, y: a.value };
  return { x: a.value, y: b.value };
}

/** O par parece latitude/longitude (e não UTM). */
export function pairLooksGeographic(pair: RawPair): boolean {
  return (
    !!(pair.a.axis || pair.b.axis) ||
    (Math.abs(pair.a.value) <= 180 && Math.abs(pair.b.value) <= 180)
  );
}

// ------------------------------------------------------------------ UTM

const SIRGAS = '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';
const converters = new Map<string, proj4.Converter>();

export interface Utm {
  x: number;
  y: number;
  zone: number;
  hemisphere: 'N' | 'S';
  /** Ex.: "24S" */
  label: string;
  /** EPSG do SIRGAS 2000 / UTM da zona (WGS 84 fora do Brasil) */
  code: string;
}

/** Zona UTM de uma longitude (1–60). */
export function utmZoneOf(lng: number): number {
  return Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1));
}

/** EPSG da zona: SIRGAS 2000 (17–25 S, 11–22 N) ou WGS 84 nas demais. */
export function utmCode(zone: number, hemisphere: 'N' | 'S'): string {
  if (hemisphere === 'S' && zone >= 17 && zone <= 25) return `EPSG:${31977 + zone - 17}`;
  if (hemisphere === 'N' && zone >= 11 && zone <= 22) return `EPSG:${31965 + zone - 11}`;
  return `EPSG:${(hemisphere === 'S' ? 32700 : 32600) + zone}`;
}

/** UTM (zona calculada pela longitude) de um ponto lat/lng WGS84/SIRGAS 2000. */
export function latLngToUtm(lat: number, lng: number): Utm | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 84 || Math.abs(lng) > 180)
    return null;
  const zone = utmZoneOf(lng);
  const hemisphere = lat < 0 ? 'S' : 'N';
  const code = utmCode(zone, hemisphere);
  let conv = converters.get(code);
  if (!conv) {
    const datum = code.startsWith('EPSG:319') ? SIRGAS : '+datum=WGS84';
    conv = proj4(
      WGS84,
      `+proj=utm +zone=${zone}${hemisphere === 'S' ? ' +south' : ''} ${datum} +units=m +no_defs`,
    );
    converters.set(code, conv);
  }
  const [x, y] = conv.forward([lng, lat]);
  return Number.isFinite(x) && Number.isFinite(y)
    ? { x, y, zone, hemisphere, label: `${zone}${hemisphere}`, code }
    : null;
}

// ------------------------------------------------------------------ colunas convertidas

/** Colunas gravadas com as coordenadas convertidas para o "outro" sistema. */
export type ConvertedField = 'latitude' | 'longitude' | 'utm_x' | 'utm_y' | 'utm_zona';

/** Geográfico → UTM X/Y e zona; UTM → latitude/longitude; outro projetado → ambos. */
export function convertedFields(kind: 'utm' | 'geographic' | 'projected'): ConvertedField[] {
  const ll: ConvertedField[] = ['latitude', 'longitude'];
  const utm: ConvertedField[] = ['utm_x', 'utm_y', 'utm_zona'];
  return kind === 'geographic' ? utm : kind === 'utm' ? ll : [...ll, ...utm];
}

/** Valor de uma coluna convertida a partir do ponto em lat/lng (WGS84). */
export function convertedValue(
  field: ConvertedField,
  ll: { lat: number; lng: number } | null,
  utm: Utm | null = ll ? latLngToUtm(ll.lat, ll.lng) : null,
): number | string | null {
  if (!ll) return null;
  switch (field) {
    case 'latitude':
      return ll.lat;
    case 'longitude':
      return ll.lng;
    case 'utm_x':
      return utm ? Math.round(utm.x * 1000) / 1000 : null;
    case 'utm_y':
      return utm ? Math.round(utm.y * 1000) / 1000 : null;
    case 'utm_zona':
      return utm?.label ?? null;
  }
}
