import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { SourceContext, SourcesService } from '../tables/sources.service';
import { FilterDef, buildFilterConditions } from '../../common/filters';
import { ColumnMeta, Params, castType, normalizeRow, qi, selectExpr } from '../../common/sql';

export type ExportScope = 'all' | 'filtered' | 'selected';
export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'kml';

/** Texto seguro dentro de XML (escapa e remove caracteres de controle inválidos). */
export function xmlText(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface ExportRequest {
  sourceId: string;
  format: ExportFormat;
  scope: ExportScope;
  filters: FilterDef[];
  ids?: string[];
  delimiter?: string;
  decimal?: '.' | ',';
  /** Colunas na ordem do arquivo (chaves de `exportFields`); ausente = todas, na ordem padrão */
  columns?: string[];
  /** Nome alternativo no cabeçalho do arquivo, por chave de coluna */
  headers?: Record<string, string>;
}

export type PreviewRequest = Omit<ExportRequest, 'format' | 'delimiter' | 'decimal'>;

interface ExportRow {
  id: unknown;
  x: number | null;
  y: number | null;
  lat: number | null;
  lng: number | null;
  data: Record<string, unknown>;
}

/** Chaves das colunas calculadas (não existem na tabela): latitude/longitude em WGS84. */
export const LAT_KEY = '@lat';
export const LNG_KEY = '@lng';

export interface ExportField {
  key: string;
  header: string;
  kind?: ColumnMeta['kind'];
  value: (r: ExportRow) => unknown;
}

/** Campos exportáveis na ordem padrão: ID, X, Y, latitude, longitude e as demais colunas. */
export function exportFields(ctx: SourceContext): ExportField[] {
  const isUtm = ctx.crs.def.kind === 'utm';
  const roles = new Set([ctx.idCol.name, ctx.xCol.name, ctx.yCol.name]);
  return [
    { key: ctx.idCol.name, header: ctx.idCol.name, value: (r) => r.id },
    { key: ctx.xCol.name, header: isUtm ? 'UTMX' : 'X', value: (r) => r.x },
    { key: ctx.yCol.name, header: isUtm ? 'UTMY' : 'Y', value: (r) => r.y },
    { key: LAT_KEY, header: 'Latitude', value: (r) => r.lat },
    { key: LNG_KEY, header: 'Longitude', value: (r) => r.lng },
    ...ctx.columns
      .filter((c) => !roles.has(c.name))
      .map((c) => ({
        key: c.name,
        header: c.name,
        kind: c.kind,
        value: (r: ExportRow) => r.data[c.name],
      })),
  ];
}

export const MAX_HEADER_LENGTH = 100;

/**
 * Nomes alternativos { coluna: nome no arquivo }: só textos (sem espaços nas pontas), vazios
 * descartados. Sem nenhum nome, undefined.
 */
export function cleanHeaders(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('headers deve ser um objeto { coluna: nome }');
  }
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(raw)) {
    if (typeof v !== 'string') throw new BadRequestException(`Nome inválido para a coluna ${key}`);
    const name = v.trim();
    if (name.length > MAX_HEADER_LENGTH) {
      throw new BadRequestException(
        `Nome da coluna ${key} com mais de ${MAX_HEADER_LENGTH} caracteres`,
      );
    }
    if (name) out[key] = name;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Campos pedidos, na ordem pedida (repetidos são ignorados); sem lista, todos na ordem padrão.
 * `headers` troca o cabeçalho das colunas renomeadas (os nomes no arquivo não podem se repetir).
 */
export function pickFields(
  ctx: SourceContext,
  columns?: string[],
  headers?: Record<string, string>,
): ExportField[] {
  const all = exportFields(ctx);
  let out = all;
  if (columns) {
    const byKey = new Map(all.map((f) => [f.key, f]));
    out = [];
    for (const key of new Set(columns)) {
      const f = byKey.get(key);
      if (!f) throw new BadRequestException(`Coluna desconhecida: ${key}`);
      out.push(f);
    }
    if (!out.length) throw new BadRequestException('Escolha ao menos uma coluna para exportar');
  }
  if (!headers) return out;
  out = out.map((f) => (headers[f.key] ? { ...f, header: headers[f.key] } : f));
  const count = new Map<string, number>();
  for (const f of out)
    count.set(f.header.toLowerCase(), (count.get(f.header.toLowerCase()) ?? 0) + 1);
  const dup = out.find((f) => headers[f.key] && count.get(f.header.toLowerCase())! > 1);
  if (dup) throw new BadRequestException(`Nome de coluna repetido no arquivo: ${dup.header}`);
  return out;
}

const BATCH = 5000;
const PREVIEW_ROWS = 10;

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
  ) {}

  async export(req: ExportRequest, res: Response) {
    const ctx = await this.sources.context(req.sourceId);
    if (req.scope === 'selected' && !req.ids?.length) {
      throw new BadRequestException('Nenhum registro selecionado para exportar');
    }
    const fields = pickFields(ctx, req.columns, req.headers);
    const started = Date.now();
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const base = `${ctx.source.tableName}_${req.scope}_${stamp}`.replace(/[^\w.\-]+/g, '_');
    const filename = `${base}.${req.format}`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');

    let aborted = false;
    res.on('close', () => {
      if (!res.writableFinished) aborted = true;
    });

    const headers = fields.map((f) => f.header);
    // GeoJSON/KML sem modelo: todos os campos com o nome original; com modelo (ou nomes
    // alternativos): os campos escolhidos, com os cabeçalhos do arquivo.
    const plainProps = ctx.columns.filter((c) => c.kind !== 'geometry');
    const propsOf = (r: ExportRow): [string, unknown][] =>
      req.columns || req.headers
        ? fields.map((f) => [f.header, f.value(r)])
        : plainProps.map((c) => [c.name, r.data[c.name]]);
    const categories = new Map<string, number>();
    let total = 0;

    const rows = this.iterate(ctx, req, () => aborted);

    if (req.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      const delimiter = req.delimiter === 'tab' ? '\t' : req.delimiter || ';';
      if (delimiter.length !== 1) throw new BadRequestException('Delimitador inválido');
      const decimal = req.decimal ?? '.';
      if (decimal === delimiter)
        throw new BadRequestException('Separador decimal igual ao delimitador');
      const fmt = (v: unknown) => this.csvCell(v, delimiter, decimal);
      await this.write(res, '﻿' + headers.map(fmt).join(delimiter) + '\r\n');
      for await (const batch of rows) {
        const lines = batch.map((r) => {
          total++;
          this.countCategory(ctx, r, categories);
          return fields.map((f) => fmt(f.value(r))).join(delimiter);
        });
        await this.write(res, lines.join('\r\n') + '\r\n');
      }
      res.end();
    } else if (req.format === 'json') {
      // GeoJSON (RFC 7946): pontos em WGS84 (lng, lat) e todos os campos como propriedades.
      res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
      await this.write(
        res,
        `{"type":"FeatureCollection","name":${JSON.stringify(ctx.source.name)},"features":[\n`,
      );
      let first = true;
      for await (const batch of rows) {
        if (!batch.length) continue;
        const features = batch.map((r) => {
          total++;
          this.countCategory(ctx, r, categories);
          const properties: Record<string, unknown> = {};
          for (const [k, v] of propsOf(r)) properties[k] = v ?? null;
          const geometry =
            r.lat !== null && r.lng !== null
              ? { type: 'Point', coordinates: [r.lng, r.lat] }
              : null;
          return JSON.stringify({ type: 'Feature', id: r.id, geometry, properties });
        });
        await this.write(res, (first ? '' : ',\n') + features.join(',\n'));
        first = false;
      }
      await this.write(res, '\n]}\n');
      res.end();
    } else if (req.format === 'kml') {
      // KML (Google Earth): um Placemark por registro, com os campos em ExtendedData.
      res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
      await this.write(
        res,
        `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>${xmlText(ctx.source.name)}</name>\n`,
      );
      for await (const batch of rows) {
        const marks = batch.map((r) => {
          total++;
          this.countCategory(ctx, r, categories);
          const label = (ctx.labelCol && r.data[ctx.labelCol.name]) ?? r.id;
          const data = propsOf(r)
            .map(([k, v]) => `<Data name="${xmlText(k)}"><value>${xmlText(v)}</value></Data>`)
            .join('');
          const point =
            r.lat !== null && r.lng !== null
              ? `<Point><coordinates>${r.lng},${r.lat},0</coordinates></Point>`
              : '';
          return `<Placemark><name>${xmlText(label)}</name><ExtendedData>${data}</ExtendedData>${point}</Placemark>`;
        });
        if (marks.length) await this.write(res, marks.join('\n') + '\n');
      }
      await this.write(res, '</Document>\n</kml>\n');
      res.end();
    } else {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: res,
        useStyles: true,
        useSharedStrings: false,
        zip: { zlib: { level: 1 } },
      } as unknown as ExcelJS.stream.xlsx.WorkbookStreamWriterOptions);
      wb.creator = 'GeoAnalisys';
      wb.created = new Date();
      const sheet = wb.addWorksheet('Pontos', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = fields.map((f, i) => ({
        header: f.header,
        key: `c${i}`,
        width: Math.min(Math.max(f.header.length + 2, f.kind ? 12 : 14), 40),
      }));
      sheet.getRow(1).font = { bold: true };
      for await (const batch of rows) {
        for (const r of batch) {
          total++;
          this.countCategory(ctx, r, categories);
          sheet.addRow(fields.map((f) => this.xlsxCell(f.value(r), f.kind))).commit();
        }
      }
      sheet.commit();

      const info = wb.addWorksheet('Informações');
      info.columns = [
        {
          header: ctx.categoryCol ? `Categoria (${ctx.categoryCol.name})` : 'Categoria',
          key: 'k',
          width: 40,
        },
        { header: 'Quantidade', key: 'v', width: 14 },
      ];
      info.getRow(1).font = { bold: true };
      if (ctx.categoryCol) {
        [...categories.entries()]
          .sort((a, b) => b[1] - a[1])
          .forEach(([k, v]) => info.addRow([k, v]).commit());
      }
      info.addRow([]).commit();
      info.addRow(['Total de registros', total]).commit();
      info.addRow([]).commit();
      const fieldsHeader = info.addRow(['Campo', 'Tipo']);
      fieldsHeader.font = { bold: true };
      fieldsHeader.commit();
      ctx.columns.forEach((c) => info.addRow([c.name, c.formatType]).commit());
      info.commit();

      const meta = wb.addWorksheet('Metadados');
      meta.columns = [
        { header: 'Propriedade', key: 'k', width: 28 },
        { header: 'Valor', key: 'v', width: 80 },
      ];
      meta.getRow(1).font = { bold: true };
      const crs = ctx.crs.def;
      [
        ['Fonte', ctx.source.name],
        ['Banco', ctx.source.database],
        ['Tabela', `${ctx.source.schema}.${ctx.source.tableName}`],
        ['Coluna ID', ctx.idCol.name],
        ['Coluna X', ctx.xCol.name],
        ['Coluna Y', ctx.yCol.name],
        ['Sistema de coordenadas', `${crs.code} - ${crs.name}`],
        ['Datum', crs.datum],
        ['Zona UTM', crs.zone ?? '-'],
        ['Hemisfério', crs.hemisphere ?? '-'],
        ['Definição proj4', crs.proj4],
        ['Escopo', req.scope],
        ['Filtros', req.scope === 'all' ? '-' : JSON.stringify(req.filters)],
        ['Colunas exportadas', req.columns || req.headers ? headers.join(', ') : 'Todas'],
        ['Total exportado', total],
        ['Gerado em', new Date().toISOString()],
      ].forEach((r) => meta.addRow(r).commit());
      meta.commit();
      await wb.commit();
    }
    this.logger.log({
      event: 'export',
      format: req.format,
      scope: req.scope,
      sourceId: req.sourceId,
      rows: total,
      aborted,
      durationMs: Date.now() - started,
    });
  }

  /** Primeiras linhas do arquivo (mesmos registros, ordem e colunas da exportação). */
  async preview(req: PreviewRequest) {
    const ctx = await this.sources.context(req.sourceId);
    const fields = pickFields(ctx, req.columns, req.headers);
    const filters = req.scope === 'all' ? [] : req.filters;
    let raw: Record<string, unknown>[];
    let total: number | null = null;
    if (req.scope === 'selected') {
      if (!req.ids?.length) throw new BadRequestException('Nenhum registro selecionado');
      const id = qi(ctx.idCol.name);
      const t = castType(ctx.idCol);
      raw = await this.query(
        ctx,
        filters,
        (p) => [`${id} = ANY(CAST(${p.add(req.ids)} AS ${t}[]))`],
        PREVIEW_ROWS,
      );
    } else {
      [raw, total] = await Promise.all([
        this.query(ctx, filters, () => [], PREVIEW_ROWS),
        this.count(ctx, filters),
      ]);
    }
    return {
      headers: fields.map((f) => f.header),
      rows: raw.map((r) => {
        const row = this.toRow(ctx, r);
        return fields.map((f) => f.value(row) ?? null);
      }),
      total,
    };
  }

  /**
   * SELECT de todas as colunas (mais ID texto e X/Y numéricos) ordenado pelo ID.
   * `extra` recebe o acumulador de parâmetros e devolve condições adicionais.
   */
  private query(
    ctx: SourceContext,
    filters: FilterDef[],
    extra: (p: Params) => string[],
    limit?: number,
  ) {
    const id = qi(ctx.idCol.name);
    const select = `${ctx.columns.map((c) => selectExpr(c)).join(', ')}, ${id}::text AS "__id", ${ctx.xExpr} AS "__x", ${ctx.yExpr} AS "__y"`;
    const params = new Params();
    const conds = [...extra(params), ...buildFilterConditions(filters, ctx.colMap, params)];
    const where = conds.length ? `WHERE ${conds.map((c) => `(${c})`).join(' AND ')}` : '';
    return this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${select} FROM ${ctx.table} ${where} ORDER BY ${id}${limit ? ` LIMIT ${limit}` : ''}`,
      ...params.values,
    );
  }

  private async count(ctx: SourceContext, filters: FilterDef[]): Promise<number> {
    const params = new Params();
    const conds = buildFilterConditions(filters, ctx.colMap, params);
    const where = conds.length ? `WHERE ${conds.map((c) => `(${c})`).join(' AND ')}` : '';
    const [r] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::float8 AS n FROM ${ctx.table} ${where}`,
      ...params.values,
    );
    return r.n;
  }

  /** Lê os registros em lotes (keyset pelo ID, tratando IDs repetidos). */
  private async *iterate(
    ctx: SourceContext,
    req: ExportRequest,
    isAborted: () => boolean,
  ): AsyncGenerator<ExportRow[]> {
    const id = qi(ctx.idCol.name);
    const filters = req.scope === 'all' ? [] : req.filters;
    const t = castType(ctx.idCol);
    const run = (extra: (p: Params) => string[], limit?: number) =>
      this.query(ctx, filters, extra, limit);
    const rowsOf = (raw: Record<string, unknown>[]) => raw.map((r) => this.toRow(ctx, r));

    if (req.scope === 'selected') {
      const ids = req.ids ?? [];
      for (let i = 0; i < ids.length && !isAborted(); i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        yield rowsOf(await run((p) => [`${id} = ANY(CAST(${p.add(chunk)} AS ${t}[]))`]));
      }
      return;
    }

    let last: string | null = null;
    while (!isAborted()) {
      const after = last;
      let raw = await run(
        (p) => (after === null ? [`${id} IS NOT NULL`] : [`${id} > CAST(${p.add(after)} AS ${t})`]),
        BATCH,
      );
      if (!raw.length) break;
      if (raw.length < BATCH) {
        yield rowsOf(raw);
        break;
      }
      // Garante que todos os registros com o último ID (IDs repetidos) entrem no mesmo lote.
      const lastId = String(raw[raw.length - 1].__id);
      raw = raw.filter((r) => String(r.__id) !== lastId);
      raw.push(...(await run((p) => [`${id} = CAST(${p.add(lastId)} AS ${t})`])));
      last = lastId;
      yield rowsOf(raw);
    }
    if (!isAborted()) {
      const nulls = await run(() => [`${id} IS NULL`]);
      if (nulls.length) yield rowsOf(nulls);
    }
  }

  private toRow(ctx: SourceContext, r: Record<string, unknown>): ExportRow {
    const { __id, __x, __y, ...data } = r as {
      __id: unknown;
      __x: number | null;
      __y: number | null;
    };
    const ll = __x !== null && __y !== null ? ctx.crs.toLatLng(__x, __y) : null;
    const norm = normalizeRow(data, ctx.colMap);
    return {
      id: norm[ctx.idCol.name] ?? __id,
      x: __x,
      y: __y,
      lat: ll ? Math.round(ll.lat * 1e8) / 1e8 : null,
      lng: ll ? Math.round(ll.lng * 1e8) / 1e8 : null,
      data: norm,
    };
  }

  private countCategory(ctx: SourceContext, r: ExportRow, map: Map<string, number>) {
    if (!ctx.categoryCol) return;
    const v = r.data[ctx.categoryCol.name];
    const k = v === null || v === undefined || v === '' ? '(vazio)' : String(v);
    map.set(k, (map.get(k) ?? 0) + 1);
  }

  private csvCell(v: unknown, delimiter: string, decimal: string): string {
    if (v === null || v === undefined) return '';
    let s: string;
    if (typeof v === 'number') s = decimal === ',' ? String(v).replace('.', ',') : String(v);
    else if (typeof v === 'boolean') s = v ? 'true' : 'false';
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  private xlsxCell(v: unknown, kind?: ColumnMeta['kind']): unknown {
    if (v === null || v === undefined) return null;
    if ((kind === 'date' || kind === 'datetime') && typeof v === 'string') {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? v : d;
    }
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }

  private write(res: Response, chunk: string): Promise<void> {
    return new Promise((resolve) => {
      if (res.write(chunk)) resolve();
      else res.once('drain', () => resolve());
    });
  }
}
