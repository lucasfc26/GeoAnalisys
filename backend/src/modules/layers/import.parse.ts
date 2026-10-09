/**
 * Leitura de planilhas para importar como camada (sem banco, testável isoladamente):
 * CSV (delimitador e codificação detectados), XLSX (via ExcelJS, uma aba por vez) e GeoJSON
 * (KML é convertido para GeoJSON no navegador antes do envio).
 */
import ExcelJS from 'exceljs';

export type ImportType = 'integer' | 'number' | 'text';
export type Cell = string | number | boolean | null;

export interface Sheet {
  headers: string[];
  rows: Cell[][];
}

// ------------------------------------------------------------------ CSV

/** UTF-8; se inválido (CSV salvo pelo Excel em "ANSI"), Windows-1252. */
export function decodeText(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  return text.replace(/^﻿/, '');
}

/** Delimitador mais frequente na 1ª linha (fora de aspas) entre ; , tab e |. */
export function detectDelimiter(text: string): string {
  const line = text.slice(0, text.search(/\r?\n|$/));
  const counts = new Map<string, number>([
    [';', 0],
    [',', 0],
    ['\t', 0],
    ['|', 0],
  ]);
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ';';
  for (const [d, n] of counts) if (n > counts.get(best)!) best = d;
  return best;
}

/** CSV com aspas (incluindo quebras de linha e "" dentro de campos). */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

// ------------------------------------------------------------------ XLSX

/** Valor "simples" de uma célula do ExcelJS (fórmula → resultado, texto rico → texto, data → ISO). */
export function cellValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('.000Z', 'Z');
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return cellValue(o.result);
    if (Array.isArray(o.richText))
      return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return cellValue(o.text);
    if ('error' in o) return null;
    return JSON.stringify(v);
  }
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  return String(v);
}

export async function readWorkbook(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Error(
      'Não foi possível ler o arquivo XLSX. Arquivos .xls antigos: salve como .xlsx ou .csv.',
    );
  }
  return wb;
}

export function sheetRows(ws: ExcelJS.Worksheet): Cell[][] {
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as unknown[]).slice(1).map(cellValue);
    if (values.some((v) => v !== null && String(v).trim() !== '')) rows.push(values);
  });
  return rows;
}

// ------------------------------------------------------------------ GeoJSON

type Position = number[];
interface Geometry {
  type: string;
  coordinates?: unknown;
  geometries?: Geometry[];
}

const isPos = (p: unknown): p is Position =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

function positions(coords: unknown, out: Position[] = []): Position[] {
  if (isPos(coords)) out.push(coords);
  else if (Array.isArray(coords)) for (const c of coords) positions(c, out);
  return out;
}

/** Centroide de área de um anel; null se degenerado. */
function ringCentroid(ring: Position[]): { p: Position; area: number } | null {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) return null;
  return { p: [cx / (3 * a), cy / (3 * a)], area: Math.abs(a / 2) };
}

/** Ponto do meio (pelo comprimento) de uma linha. */
function lineMidpoint(line: Position[]): Position | null {
  if (!line.length) return null;
  const seg = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
  let half = seg.reduce((s, d) => s + d, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] && seg[i] > 0) {
      const t = half / seg[i];
      return [
        line[i][0] + (line[i + 1][0] - line[i][0]) * t,
        line[i][1] + (line[i + 1][1] - line[i][1]) * t,
      ];
    }
    half -= seg[i];
  }
  return line[0];
}

const average = (pts: Position[]): Position | null =>
  pts.length
    ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
    : null;

/**
 * Ponto que representa a geometria na camada (camadas são de pontos): o próprio ponto; o meio da
 * linha mais longa; o centroide do maior polígono (anel externo).
 */
export function representativePoint(g: Geometry | null | undefined): Position | null {
  if (!g) return null;
  const c = g.coordinates as unknown;
  switch (g.type) {
    case 'Point':
      return isPos(c) ? [c[0], c[1]] : null;
    case 'MultiPoint':
      return average(positions(c));
    case 'LineString':
      return lineMidpoint(positions(c));
    case 'MultiLineString': {
      const lines = Array.isArray(c) ? c.map((l) => positions(l)) : [];
      const len = (l: Position[]) =>
        l.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0);
      const longest = lines.sort((a, b) => len(b) - len(a))[0];
      return longest ? lineMidpoint(longest) : null;
    }
    case 'Polygon':
    case 'MultiPolygon': {
      const polys = (g.type === 'Polygon' ? [c] : Array.isArray(c) ? c : []) as unknown[][];
      let best: { p: Position; area: number } | null = null;
      for (const poly of polys) {
        const outer = Array.isArray(poly) ? positions(poly[0]) : [];
        const r = ringCentroid(outer);
        if (r && (!best || r.area > best.area)) best = r;
      }
      return best?.p ?? average(positions(c));
    }
    case 'GeometryCollection':
      for (const part of g.geometries ?? []) {
        const p = representativePoint(part);
        if (p) return p;
      }
      return null;
    default:
      return null;
  }
}

/** Valor de propriedade como célula (objetos/listas viram JSON). */
function propCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(v);
}

/**
 * GeoJSON (FeatureCollection, Feature ou geometria) → linhas: uma por feição, com as propriedades
 * como colunas e mais as colunas de coordenada (ponto representativo) e, se houver geometrias que
 * não são pontos, o tipo de geometria. Devolve os nomes finais das colunas de X/Y.
 */
export function geoJsonToSheet(text: string): { sheet: Sheet; xColumn: string; yColumn: string } {
  let input: { type?: string; features?: unknown; geometry?: unknown; properties?: unknown };
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('Arquivo GeoJSON inválido (JSON mal formado)');
  }
  type Feat = { geometry?: Geometry | null; properties?: Record<string, unknown> | null };
  let features: Feat[];
  if (input?.type === 'FeatureCollection' && Array.isArray(input.features))
    features = input.features as Feat[];
  else if (input?.type === 'Feature') features = [input as Feat];
  else if (typeof input?.type === 'string') features = [{ geometry: input as Geometry }];
  else throw new Error('Arquivo GeoJSON inválido (esperado FeatureCollection, Feature ou geometria)');
  if (!features.length) throw new Error('O GeoJSON não tem feições');

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    for (const k of Object.keys(f?.properties ?? {})) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const nonPoint = features.some((f) => f?.geometry && f.geometry.type !== 'Point');
  const extra = ['longitude', 'latitude', ...(nonPoint ? ['tipo_geometria'] : [])];
  const header: Cell[] = [...keys, ...extra];
  const rows: Cell[][] = features.map((f) => {
    const props = f?.properties ?? {};
    const p = representativePoint(f?.geometry);
    return [
      ...keys.map((k) => propCell(props[k])),
      p ? p[0] : null,
      p ? p[1] : null,
      ...(nonPoint ? [f?.geometry?.type ?? null] : []),
    ];
  });
  const sheet = toSheet([header, ...rows]);
  // Nomes finais (cleanHeaders acrescenta _2… se uma propriedade já se chamar longitude/latitude).
  const xColumn = sheet.headers[keys.length];
  const yColumn = sheet.headers[keys.length + 1];
  return { sheet, xColumn, yColumn };
}

// ------------------------------------------------------------------ cabeçalhos, tipos e valores

/** Cabeçalhos válidos como nome de coluna: sem vazios/repetidos e até 60 caracteres. */
export function cleanHeaders(raw: Cell[]): string[] {
  const seen = new Set<string>();
  return raw.map((h, i) => {
    let base =
      String(h ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 60) || `coluna_${i + 1}`;
    let name = base;
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${base.slice(0, 56)}_${n}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

/** Primeira linha = cabeçalho; demais linhas com o mesmo número de colunas. */
export function toSheet(rows: Cell[][]): Sheet {
  if (!rows.length) return { headers: [], rows: [] };
  const width = Math.max(...rows.map((r) => r.length));
  const headers = cleanHeaders(Array.from({ length: width }, (_, i) => rows[0][i] ?? null));
  const body = rows.slice(1).map((r) =>
    Array.from({ length: width }, (_, i) => {
      const v = r[i] ?? null;
      return typeof v === 'string' && v.trim() === '' ? null : v;
    }),
  );
  return { headers, rows: body };
}

/**
 * Número a partir de texto (aceita vírgula decimal e milhar pt-BR/en). Códigos com zero à esquerda
 * ou com mais de 15 dígitos continuam texto.
 */
export function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (/^-?0\d/.test(s) || s.replace(/\D/g, '').length > 15) return null;
  let t: string | null = null;
  if (/^-?\d+$/.test(s)) t = s;
  else if (/^-?\d+[.,]\d+$/.test(s)) t = s.replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) t = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) t = s.replace(/,/g, '');
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Tipo de cada coluna pelo conteúdo: inteiro, decimal ou texto. */
export function inferTypes(sheet: Sheet): ImportType[] {
  return sheet.headers.map((_, c) => {
    let any = false;
    let integer = true;
    for (const r of sheet.rows) {
      const v = r[c];
      if (v === null) continue;
      any = true;
      const n = toNumber(v);
      if (n === null) return 'text';
      if (!Number.isInteger(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) integer = false;
    }
    if (!any) return 'text';
    return integer ? 'integer' : 'number';
  });
}

/** Valor convertido para o tipo da coluna (`invalid` quando havia valor mas não converteu). */
export function convert(
  v: Cell,
  type: ImportType,
): { value: string | number | null; invalid: boolean } {
  if (v === null) return { value: null, invalid: false };
  if (type === 'text')
    return { value: typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v), invalid: false };
  const n = toNumber(typeof v === 'boolean' ? null : v);
  if (n === null || (type === 'integer' && !Number.isInteger(n)))
    return { value: null, invalid: true };
  return { value: n, invalid: false };
}

const X_NAMES = [
  /^utm[_ ]?x$/i,
  /^x$/i,
  /^(leste|este|easting|coord[_ ]?x)$/i,
  /^(longitude|lon|lng|long)$/i,
];
const Y_NAMES = [/^utm[_ ]?y$/i, /^y$/i, /^(norte|northing|coord[_ ]?y)$/i, /^(latitude|lat)$/i];
const ID_NAMES = [/^(id|idd|gid|fid)$/i, /^(codigo|código|cod)$/i];

/** Sugestões de colunas (ID, X, Y) e do tipo de coordenada, pelos nomes e pelos valores. */
export function suggestColumns(sheet: Sheet, types: ImportType[]) {
  const pick = (patterns: RegExp[]) => {
    for (const p of patterns) {
      const i = sheet.headers.findIndex((h) => p.test(h.trim()));
      if (i >= 0) return i;
    }
    return -1;
  };
  let x = pick(X_NAMES);
  let y = pick(Y_NAMES);
  const sample = (c: number) =>
    sheet.rows
      .slice(0, 200)
      .map((r) => toNumber(r[c]))
      .filter((n): n is number => n !== null);
  const inRange = (c: number, min: number, max: number) => {
    const s = sample(c);
    return s.length > 0 && s.every((n) => n >= min && n <= max);
  };
  // Sem nomes reconhecidos: UTM (leste ~100 mil–900 mil; norte ~1–10 milhões).
  if (x < 0 || y < 0) {
    const numeric = types.map((t, i) => (t !== 'text' ? i : -1)).filter((i) => i >= 0);
    if (x < 0) x = numeric.find((i) => i !== y && inRange(i, 100_000, 999_999)) ?? -1;
    if (y < 0) y = numeric.find((i) => i !== x && inRange(i, 1_000_000, 10_000_000)) ?? -1;
  }
  const geographic = x >= 0 && y >= 0 && inRange(x, -180, 180) && inRange(y, -90, 90);
  const id = pick(ID_NAMES);
  return {
    idColumn: id >= 0 ? sheet.headers[id] : null,
    xColumn: x >= 0 ? sheet.headers[x] : null,
    yColumn: y >= 0 ? sheet.headers[y] : null,
    coordinates: geographic
      ? ('geographic' as const)
      : x >= 0 && y >= 0
        ? ('projected' as const)
        : null,
  };
}

/** Nome de tabela seguro a partir do nome da camada (minúsculas, sem acentos, até 50 caracteres). */
export function tableNameFrom(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
  return !base ? 'camada' : /^\d/.test(base) ? `camada_${base}`.slice(0, 50) : base;
}
