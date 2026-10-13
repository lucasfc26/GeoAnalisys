import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { FilterDef, buildFilterConditions } from '../../common/filters';
import { ColumnMeta, Params, qi, qualified } from '../../common/sql';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../tables/catalog.service';
import { SourceContext, SourcesService } from '../tables/sources.service';
import {
  CountRow,
  LookupRow,
  compareRows,
  findLookup,
  indexLookup,
  mergeCounts,
} from './comparison.logic';

/** Linhas lidas da tabela de apoio (ex.: mlampadas tem algumas centenas). */
const MAX_LOOKUP_ROWS = 200_000;

export interface ComparisonLayer {
  sourceId: string;
  /** Nome na lista (padrão: nome da camada) */
  label: string | null;
  filters: FilterDef[];
}

export interface ComparisonBlock {
  /** Ex.: "Estimados" */
  title: string;
  /** Ex.: medicao = 'Não'; aplicadas a todas as camadas */
  conditions: FilterDef[];
  /** Ex.: tipo_lampada, potencia; vazio = uma linha só com o total do bloco */
  groupBy: string[];
  /** null = conta registros; coluna = conta valores distintos (ex.: "circuito exclusivo") */
  distinctColumn: string | null;
  useLookup: boolean;
}

export interface ComparisonLookup {
  schema: string;
  table: string;
  /** Coluna de agrupamento das camadas ↔ coluna da tabela de apoio (ex.: tipo_lampada ↔ tipo) */
  keys: { column: string; lookupColumn: string }[];
  /** Descrição da linha (ex.: nome) */
  nameColumn: string | null;
  /** Multiplicado pela diferença (ex.: consumo) */
  factorColumn: string | null;
}

export interface ComparisonRequest {
  layers: ComparisonLayer[];
  blocks: ComparisonBlock[];
  lookup: ComparisonLookup | null;
  /** "Não" = "nao" = "NÃO" ao juntar os grupos das camadas e a tabela de apoio */
  ignoreCase: boolean;
}

export interface ComparisonRow {
  label: string;
  /** Valores das colunas de agrupamento do bloco */
  values: (string | null)[];
  counts: number[];
  /** Última camada − primeira */
  diff: number;
  factor: number | null;
  /** factor × diff */
  result: number | null;
  /** null = bloco sem tabela de apoio */
  matched: boolean | null;
}

export interface ComparisonSection {
  title: string;
  groupBy: string[];
  distinctColumn: string | null;
  lookup: boolean;
  rows: ComparisonRow[];
  totals: { counts: number[]; diff: number; result: number | null };
  unmatched: number;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function parseNumber(v: string | null): number | null {
  if (v === null) return null;
  const s = v.trim();
  const n = Number(/^[+-]?\d+,\d+$/.test(s) ? s.replace(',', '.') : s);
  return s && Number.isFinite(n) ? n : null;
}

@Injectable()
export class ComparisonService {
  private readonly logger = new Logger(ComparisonService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly catalog: CatalogService,
  ) {}

  async run(req: ComparisonRequest) {
    const started = Date.now();
    const ctxs = await Promise.all(req.layers.map((l) => this.sources.context(l.sourceId)));
    const labels = req.layers.map((l, i) => l.label?.trim() || ctxs[i].source.name);
    const lookup =
      req.blocks.some((b) => b.useLookup) && req.lookup ? await this.loadLookup(req) : null;

    const sections: ComparisonSection[] = [];
    for (const block of req.blocks) {
      const useLookup = block.useLookup && lookup !== null;
      const keyPos = useLookup
        ? req.lookup!.keys.map((k) => {
            const pos = block.groupBy.indexOf(k.column);
            if (pos < 0) {
              throw new BadRequestException(
                `O bloco "${block.title}" usa a tabela de apoio, mas não agrupa por "${k.column}"`,
              );
            }
            return pos;
          })
        : [];
      const perLayer = await Promise.all(
        req.layers.map((l, i) => this.count(ctxs[i], labels[i], l.filters, block)),
      );
      const last = req.layers.length - 1;
      const rows = mergeCounts(perLayer, req.ignoreCase).map((m): ComparisonRow => {
        const diff = m.counts[last] - m.counts[0];
        const found = useLookup
          ? findLookup(
              lookup!,
              keyPos.map((p) => m.keys[p]),
              req.ignoreCase,
            )
          : null;
        const factor = found?.factor ?? null;
        const label =
          found?.name ||
          (block.groupBy.length ? m.keys.map((k) => k ?? '(vazio)').join(' · ') : block.title);
        return {
          label,
          values: m.keys,
          counts: m.counts,
          diff,
          factor,
          result: factor === null ? null : round(factor * diff),
          matched: useLookup ? found !== null : null,
        };
      });
      rows.sort((a, b) =>
        compareRows({ label: a.label, keys: a.values }, { label: b.label, keys: b.values }),
      );
      const hasFactor = useLookup && req.lookup!.factorColumn !== null;
      sections.push({
        title: block.title,
        groupBy: block.groupBy,
        distinctColumn: block.distinctColumn,
        lookup: useLookup,
        rows,
        totals: {
          counts: labels.map((_, i) => rows.reduce((s, r) => s + r.counts[i], 0)),
          diff: rows.reduce((s, r) => s + r.diff, 0),
          result: hasFactor ? round(rows.reduce((s, r) => s + (r.result ?? 0), 0)) : null,
        },
        unmatched: useLookup ? rows.filter((r) => !r.matched).length : 0,
      });
    }

    const summary = {
      layers: labels,
      lookupName: lookup ? `${req.lookup!.schema}.${req.lookup!.table}` : null,
      factorName: lookup ? req.lookup!.factorColumn : null,
      rows: sections.reduce((s, x) => s + x.rows.length, 0),
      unmatched: sections.reduce((s, x) => s + x.unmatched, 0),
      durationMs: Date.now() - started,
    };
    this.logger.log({
      event: 'comparison',
      ...summary,
      sourceIds: req.layers.map((l) => l.sourceId),
      blocks: req.blocks.length,
    });
    return { summary, sections };
  }

  async download(req: ComparisonRequest, format: 'xlsx' | 'csv', res: Response) {
    const { summary: s, sections } = await this.run(req);
    const groupCols = [...new Set(sections.flatMap((x) => x.groupBy))];
    const withFactor = s.factorName !== null && sections.some((x) => x.lookup);
    const headers = [
      'Bloco',
      'Descrição',
      ...groupCols,
      ...s.layers.map((l) => `Qtd ${l}`),
      `Diferença (${s.layers[s.layers.length - 1]} − ${s.layers[0]})`,
      ...(withFactor ? [s.factorName!, `${s.factorName} × diferença`] : []),
    ];
    const line = (
      title: string,
      label: string,
      values: Map<string, string | null>,
      r: {
        counts: number[];
        diff: number;
        factor?: number | null;
        result: number | null;
      },
    ) => [
      title,
      label,
      ...groupCols.map((c) => values.get(c) ?? null),
      ...r.counts,
      r.diff,
      ...(withFactor ? [r.factor ?? null, r.result] : []),
    ];
    const body: { cells: unknown[]; total: boolean }[] = [];
    for (const x of sections) {
      for (const r of x.rows) {
        const values = new Map(x.groupBy.map((c, k) => [c, r.values[k]]));
        body.push({ cells: line(x.title, r.label, values, r), total: false });
      }
      if (x.rows.length > 1) {
        body.push({ cells: line(x.title, `Total ${x.title}`, new Map(), x.totals), total: true });
      }
    }

    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const filename = `comparativo_${stamp}.${format}`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      const cell = (v: unknown) => {
        if (v === null || v === undefined) return '';
        const str = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
        return /[;"\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const lines = [headers, ...body.map((b) => b.cells)].map((r) => r.map(cell).join(';'));
      res.end('\uFEFF' + lines.join('\r\n') + '\r\n');
      return;
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GeoAnalisys';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Comparativo', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = headers.map((h, k) => ({
      header: h,
      width: k === 1 ? 40 : Math.min(Math.max(h.length + 2, 12), 40),
    }));
    sheet.getRow(1).font = { bold: true };
    for (const b of body) {
      const row = sheet.addRow(b.cells);
      if (b.total) row.font = { bold: true };
    }

    const info = wb.addWorksheet('Parâmetros');
    info.columns = [
      { header: 'Propriedade', width: 40 },
      { header: 'Valor', width: 90 },
    ];
    info.getRow(1).font = { bold: true };
    const lk = req.lookup;
    info.addRows([
      ...req.layers.map((l, i) => [
        `Camada ${i + 1}`,
        `${s.layers[i]}${l.filters.length ? ` — filtros: ${JSON.stringify(l.filters)}` : ''}`,
      ]),
      ['Diferença', `${s.layers[s.layers.length - 1]} − ${s.layers[0]}`],
      ['Ignorar maiúsculas e acentos', req.ignoreCase ? 'Sim' : 'Não'],
      [
        'Tabela de apoio',
        lk && s.lookupName
          ? `${s.lookupName} (${lk.keys.map((k) => `${k.column} = ${k.lookupColumn}`).join(', ')}` +
            `${lk.nameColumn ? `; descrição: ${lk.nameColumn}` : ''}` +
            `${lk.factorColumn ? `; fator: ${lk.factorColumn}` : ''})`
          : 'Não usada',
      ],
      ...req.blocks.map((b, i) => [
        `Bloco ${i + 1}: ${b.title}`,
        [
          b.conditions.length ? `condições: ${JSON.stringify(b.conditions)}` : 'sem condições',
          b.groupBy.length ? `agrupa por: ${b.groupBy.join(', ')}` : 'sem agrupamento',
          b.distinctColumn ? `conta valores distintos de ${b.distinctColumn}` : 'conta registros',
          b.useLookup && s.lookupName ? `usa ${s.lookupName}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      ]),
      ['Sem correspondência na tabela de apoio', s.unmatched],
      ['Gerado em', new Date().toISOString()],
    ]);
    await wb.xlsx.write(res);
    res.end();
  }

  private column(ctx: SourceContext, label: string, name: string): ColumnMeta {
    const c = ctx.colMap.get(name);
    if (!c) throw new BadRequestException(`Coluna "${name}" não existe em ${label}`);
    if (c.kind === 'geometry')
      throw new BadRequestException(`Coluna geométrica não suportada: ${name}`);
    return c;
  }

  /** Contagem por grupo numa camada: SELECT grupo, COUNT(*) … WHERE filtros AND condições GROUP BY grupo. */
  private async count(
    ctx: SourceContext,
    label: string,
    filters: FilterDef[],
    block: ComparisonBlock,
  ): Promise<CountRow[]> {
    const groups = block.groupBy.map((g) => this.column(ctx, label, g));
    const distinct = block.distinctColumn ? this.column(ctx, label, block.distinctColumn) : null;
    const params = new Params();
    let conds: string[];
    try {
      conds = buildFilterConditions([...filters, ...block.conditions], ctx.colMap, params);
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw new BadRequestException(`${label}, bloco "${block.title}": ${err.message}`);
      }
      throw err;
    }
    const where = conds.length ? `WHERE ${conds.map((c) => `(${c})`).join(' AND ')}` : '';
    const n = distinct ? `COUNT(DISTINCT ${qi(distinct.name)})` : 'COUNT(*)';
    const select = [...groups.map((g, k) => `${qi(g.name)}::text AS "g${k}"`), `${n}::int AS "n"`];
    const groupBy = groups.length ? `GROUP BY ${groups.map((_, k) => k + 1).join(', ')}` : '';
    const raw = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${select.join(', ')} FROM ${ctx.table} ${where} ${groupBy}`,
      ...params.values,
    );
    return raw
      .map((r) => ({
        keys: groups.map((_, k) => (r[`g${k}`] as string | null) ?? null),
        n: Number(r.n),
      }))
      .filter((r) => groups.length === 0 || r.n > 0);
  }

  private async loadLookup(req: ComparisonRequest): Promise<Map<string, LookupRow>> {
    const lk = req.lookup!;
    const cols = await this.catalog.getColumns(lk.schema, lk.table);
    if (!cols.length)
      throw new BadRequestException(`Tabela de apoio não encontrada: ${lk.schema}.${lk.table}`);
    const byName = new Map(cols.map((c) => [c.name, c]));
    const col = (name: string) => {
      if (!byName.has(name)) {
        throw new BadRequestException(`Coluna "${name}" não existe em ${lk.schema}.${lk.table}`);
      }
      return `${qi(name)}::text`;
    };
    const select = [
      ...lk.keys.map((k, i) => `${col(k.lookupColumn)} AS "k${i}"`),
      `${lk.nameColumn ? col(lk.nameColumn) : 'NULL::text'} AS "name"`,
      `${lk.factorColumn ? col(lk.factorColumn) : 'NULL::text'} AS "factor"`,
    ];
    const raw = await this.prisma.$queryRawUnsafe<Record<string, string | null>[]>(
      `SELECT ${select.join(', ')} FROM ${qualified(lk.schema, lk.table)} LIMIT ${MAX_LOOKUP_ROWS}`,
    );
    return indexLookup(
      raw.map((r) => ({
        keys: lk.keys.map((_, i) => r[`k${i}`] ?? null),
        name: r.name?.trim() || null,
        factor: parseNumber(r.factor),
      })),
      req.ignoreCase,
    );
  }
}
