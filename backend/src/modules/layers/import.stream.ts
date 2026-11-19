/**
 * Leitura em partes dos arquivos importados (gravados em disco pelo upload): as linhas saem uma a
 * uma, sem carregar a planilha inteira na memória — CSV e XLSX com milhões de linhas.
 */
import ExcelJS from 'exceljs';
import { createReadStream, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import {
  Cell,
  CsvParser,
  decodeText,
  detectDelimiter,
  geoJsonToSheet,
  hasValue,
  rowValues,
  sniffEncoding,
} from './import.parse';

export interface RowSource {
  /** Abas do XLSX (vazio nos outros formatos) */
  sheets: string[];
  /** Aba lida */
  sheet: string | null;
  /** GeoJSON: colunas de coordenada geradas (lon/lat) */
  geo: { xColumn: string; yColumn: string } | null;
  /** Linhas com algum valor; a primeira é o cabeçalho */
  rows: AsyncGenerator<Cell[]>;
  /** Parte do arquivo já lida (0–1) */
  progress: () => number;
  /** Para de ler (ex.: a prévia já tem as linhas que precisa) */
  close: () => void;
}

/** Erro de leitura que vira mensagem para o usuário (400). */
export class ImportFileError extends Error {}

const CHUNK = 1 << 20;

/** Codificações aceitas para CSV/TXT (além da detecção automática). */
const TEXT_ENCODINGS = new Set(['utf-8', 'iso-8859-1', 'iso-8859-15', 'windows-1252', 'utf-16le']);

/**
 * Nome de codificação para o TextDecoder, ou null = detectar (UTF-8 ou Windows-1252).
 * Aceita apelidos: utf8, latin1, ansi, iso.
 */
export function normalizeTextEncoding(value: string | null | undefined): string | null {
  if (value == null) return null;
  const v = value.trim().toLowerCase().replace(/_/g, '-');
  if (!v || v === 'auto') return null;
  if (v === 'utf8' || v === 'utf-8') return 'utf-8';
  if (v === 'latin1' || v === 'latin-1' || v === 'iso' || v === 'iso8859-1' || v === 'iso-8859-1')
    return 'iso-8859-1';
  if (v === 'iso8859-15' || v === 'iso-8859-15') return 'iso-8859-15';
  if (v === 'windows-1252' || v === 'cp1252' || v === 'ansi') return 'windows-1252';
  if (v === 'utf16' || v === 'utf-16' || v === 'utf16le' || v === 'utf-16le') return 'utf-16le';
  if (TEXT_ENCODINGS.has(v)) return v;
  throw new ImportFileError(
    `Codificação não suportada: ${value}. Use UTF-8, ISO-8859-1, Windows-1252, ISO-8859-15 ou UTF-16 LE.`,
  );
}

/** Abre o arquivo pelo formato (extensão do nome original). `encoding` só vale para CSV/TXT. */
export async function openRows(
  path: string,
  originalName: string,
  sheet?: string | null,
  encoding?: string | null,
): Promise<RowSource> {
  const ext = extname(originalName || '').toLowerCase();
  if (ext === '.geojson' || ext === '.json') return openGeoJson(path);
  if (ext === '.xlsx' || ext === '.xlsm') return openXlsx(path, sheet ?? null);
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv')
    return openCsv(path, normalizeTextEncoding(encoding));
  if (ext === '.xls') {
    throw new ImportFileError('Arquivos .xls antigos não são suportados: salve como .xlsx ou .csv');
  }
  throw new ImportFileError('Formato não suportado: use .csv, .xlsx, .geojson ou .kml');
}

/** Stream do arquivo contando os bytes lidos (para o progresso). */
function counted(path: string) {
  const size = Math.max(statSync(path).size, 1);
  const stream = createReadStream(path, { highWaterMark: CHUNK });
  let read = 0;
  stream.on('data', (c) => (read += c.length));
  // Fechar no meio (prévia) não pode derrubar o processo.
  stream.on('error', () => undefined);
  return { stream, progress: () => Math.min(read / size, 1) };
}

function openCsv(path: string, encoding: string | null): RowSource {
  const { stream, progress } = counted(path);
  async function* rows(): AsyncGenerator<Cell[]> {
    let decoder: TextDecoder | null = null;
    let latin1 = false;
    let parser: CsvParser | null = null;
    const out: string[][] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      let text: string;
      if (!decoder && !latin1) {
        const enc = encoding ?? sniffEncoding(chunk);
        // O TextDecoder trata "iso-8859-1" como Windows-1252. Latin-1 de verdade é byte = caractere.
        if (enc === 'iso-8859-1') {
          latin1 = true;
          text = chunk.toString('latin1').replace(/^\uFEFF/, '');
        } else {
          decoder = new TextDecoder(enc);
          text = decoder.decode(chunk, { stream: true }).replace(/^\uFEFF/, '');
        }
        parser = new CsvParser(detectDelimiter(text));
      } else if (latin1) text = chunk.toString('latin1');
      else text = decoder!.decode(chunk, { stream: true });
      parser!.push(text, out);
      for (const r of out) if (hasValue(r)) yield r;
      out.length = 0;
    }
    if (!parser || (!decoder && !latin1)) return;
    if (decoder) parser.push(decoder.decode(), out);
    parser.end(out);
    for (const r of out) if (hasValue(r)) yield r;
  }
  return {
    sheets: [],
    sheet: null,
    geo: null,
    rows: rows(),
    progress,
    close: () => stream.destroy(),
  };
}

async function openXlsx(path: string, sheet: string | null): Promise<RowSource> {
  const { stream, progress } = counted(path);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    // Estilos: datas chegam como data (pelo formato da célula).
    styles: 'cache',
    hyperlinks: 'ignore',
    entries: 'ignore',
  });
  const sheetsIt = reader[Symbol.asyncIterator]();
  const model = () =>
    ((reader as unknown as { model?: { sheets?: { name: string }[] } }).model?.sheets ?? []).map(
      (s) => s.name,
    );
  let names: string[] = [];
  let ws: ExcelJS.stream.xlsx.WorksheetReader | null = null;
  try {
    // As abas chegam na ordem do arquivo; as que não interessam são descartadas sem ler.
    for (;;) {
      const next = await sheetsIt.next();
      if (next.done) break;
      names = model();
      const target = sheet && names.includes(sheet) ? sheet : (names[0] ?? null);
      const current = (next.value as unknown as { name?: string }).name ?? null;
      if (!target || current === target) {
        ws = next.value;
        break;
      }
    }
  } catch {
    stream.destroy();
    throw new ImportFileError(
      'Não foi possível ler o arquivo XLSX. Arquivos .xls antigos: salve como .xlsx ou .csv.',
    );
  }
  if (!ws) {
    stream.destroy();
    throw new ImportFileError('A planilha não tem abas');
  }
  const chosen = (ws as unknown as { name?: string }).name ?? names[0] ?? null;
  const worksheet = ws;
  async function* rows(): AsyncGenerator<Cell[]> {
    for await (const row of worksheet) {
      const values = rowValues(row.values);
      if (hasValue(values)) yield values;
    }
  }
  return {
    sheets: names,
    sheet: chosen,
    geo: null,
    rows: rows(),
    progress,
    close: () => {
      stream.destroy();
      void sheetsIt.return?.(undefined).catch(() => undefined);
    },
  };
}

async function openGeoJson(path: string): Promise<RowSource> {
  let parsed;
  try {
    parsed = geoJsonToSheet(decodeText(await readFile(path)));
  } catch (e) {
    throw new ImportFileError((e as Error).message);
  }
  const { sheet, xColumn, yColumn } = parsed;
  let done = false;
  async function* rows(): AsyncGenerator<Cell[]> {
    yield sheet.headers;
    for (const r of sheet.rows) yield r;
    done = true;
  }
  return {
    sheets: [],
    sheet: null,
    geo: { xColumn, yColumn },
    rows: rows(),
    progress: () => (done ? 1 : 0.5),
    close: () => undefined,
  };
}
