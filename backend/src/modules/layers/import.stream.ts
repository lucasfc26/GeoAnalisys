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

/** Abre o arquivo pelo formato (extensão do nome original). */
export async function openRows(
  path: string,
  originalName: string,
  sheet?: string | null,
): Promise<RowSource> {
  const ext = extname(originalName || '').toLowerCase();
  if (ext === '.geojson' || ext === '.json') return openGeoJson(path);
  if (ext === '.xlsx' || ext === '.xlsm') return openXlsx(path, sheet ?? null);
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') return openCsv(path);
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

function openCsv(path: string): RowSource {
  const { stream, progress } = counted(path);
  async function* rows(): AsyncGenerator<Cell[]> {
    let decoder: TextDecoder | null = null;
    let parser: CsvParser | null = null;
    const out: string[][] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      let text: string;
      if (!decoder) {
        decoder = new TextDecoder(sniffEncoding(chunk));
        text = decoder.decode(chunk, { stream: true }).replace(/^﻿/, '');
        parser = new CsvParser(detectDelimiter(text));
      } else text = decoder.decode(chunk, { stream: true });
      parser!.push(text, out);
      for (const r of out) if (hasValue(r)) yield r;
      out.length = 0;
    }
    if (!parser || !decoder) return;
    parser.push(decoder.decode(), out);
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
