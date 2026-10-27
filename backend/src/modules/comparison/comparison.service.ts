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
  sheetName,
} from './comparison.logic';
import {
  Cell,
  ComparisonColumn,
  CompiledColumns,
  FormulaError,
  NUMERIC_KINDS,
  compileColumns,
  defaultColumns,
  roundCell,
} from './comparison.columns';

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
}

export interface ComparisonRequest {
  layers: ComparisonLayer[];
  blocks: ComparisonBlock[];
  lookup: ComparisonLookup | null;
  /** "Não" = "nao" = "NÃO" ao juntar os grupos das camadas e a tabela de apoio */
  ignoreCase: boolean;
  /** Colunas da tabela, em ordem; null = padrão (descrição, grupos, quantidades e diferença) */
  columns: ComparisonColumn[] | null;
}

export interface ComparisonRow {
  /** Uma por coluna visível */
  cells: Cell[];
  /** null = bloco sem tabela de apoio */
  matched: boolean | null;
}

export interface ComparisonSection {
  title: string;
  groupBy: string[];
  distinctColumn: string | null;
  lookup: boolean;
  rows: ComparisonRow[];
  /** Soma das colunas marcadas para somar; "Total" na descrição */
  totals: Cell[];
  unmatched: number;
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
    const columns =
      req.columns ??
      defaultColumns([...new Set(req.blocks.flatMap((b) => b.groupBy))], labels.length);
    const layerColumns = [...ctxs[0].colMap.values()]
      .filter((c) => c.kind !== 'geometry' && ctxs.every((x) => x.colMap.has(c.name)))
      .map((c) => c.name);
    const lookupCols = req.lookup ? await this.lookupColumns(req.lookup) : null;
    let compiled: CompiledColumns;
    try {
      compiled = compileColumns(columns, labels, { layerColumns, lookupColumns: lookupCols });
    } catch (err) {
      if (err instanceof FormulaError) throw new BadRequestException(err.message);
      throw err;
    }
    const visible = columns.map((_, i) => i).filter((i) => !columns[i].hidden);
    const lookup =
      req.blocks.some((b) => b.useLookup) && req.lookup
        ? await this.loadLookup(req, compiled.lookupColumns)
        : null;

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
      const rows = mergeCounts(perLayer, req.ignoreCase).map((m) => {
        const found = useLookup
          ? findLookup(
              lookup!,
              keyPos.map((p) => m.keys[p]),
              req.ignoreCase,
            )
          : null;
        const label =
          found?.name ||
          (block.groupBy.length ? m.keys.map((k) => k ?? '(vazio)').join(' · ') : block.title);
        const all = compiled.evaluate({
          label,
          group: new Map(block.groupBy.map((g, k) => [g, m.keys[k]])),
          counts: m.counts,
          diff: m.counts[last] - m.counts[0],
          lookup: found?.values ?? null,
        });
        return { label, keys: m.keys, all, matched: useLookup ? found !== null : null };
      });
      rows.sort(compareRows);
      const totals = visible.map((i): Cell => {
        const c = columns[i];
        if (c.kind === 'label') return 'Total';
        if (!c.sum || !NUMERIC_KINDS.includes(c.kind)) return null;
        const sum = rows.reduce((s, r) => {
          const v = r.all[i];
          return s + (typeof v === 'number' ? v : 0);
        }, 0);
        return roundCell(sum, c.decimals);
      });
      sections.push({
        title: block.title,
        groupBy: block.groupBy,
        distinctColumn: block.distinctColumn,
        lookup: useLookup,
        rows: rows.map((r) => ({
          cells: visible.map((i) => roundCell(r.all[i], columns[i].decimals)),
          matched: r.matched,
        })),
        totals,
        unmatched: useLookup ? rows.filter((r) => !r.matched).length : 0,
      });
    }

    const summary = {
      layers: labels,
      columns: visible.map((i) => ({
        title: compiled.titles[i],
        kind: columns[i].kind,
        decimals: columns[i].decimals ?? null,
      })),
      lookupName: lookup ? `${req.lookup!.schema}.${req.lookup!.table}` : null,
      rows: sections.reduce((s, x) => s + x.rows.length, 0),
      unmatched: sections.reduce((s, x) => s + x.unmatched, 0),
      durationMs: Date.now() - started,
    };
    this.logger.log({
      event: 'comparison',
      ...summary,
      columns: summary.columns.length,
      sourceIds: req.layers.map((l) => l.sourceId),
      blocks: req.blocks.length,
    });
    return { summary, sections, columns, titles: compiled.titles };
  }

  async download(req: ComparisonRequest, format: 'xlsx' | 'csv', res: Response) {
    const { summary: s, sections, columns, titles } = await this.run(req);
    const headers = ['Bloco', ...s.columns.map((c) => c.title)];
    const body: { cells: unknown[]; total: boolean }[] = [];
    for (const x of sections) {
      for (const r of x.rows) body.push({ cells: [x.title, ...r.cells], total: false });
      if (x.rows.length > 1) body.push({ cells: [x.title, ...x.totals], total: true });
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
    const colHeaders = s.columns.map((c) => c.title);
    const usedSheets = new Set<string>(['parâmetros']);
    for (const x of sections) {
      const sheet = wb.addWorksheet(sheetName(x.title, usedSheets), {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      sheet.columns = colHeaders.map((h, k) => {
        const c = s.columns[k];
        const d = c?.decimals;
        return {
          header: h,
          width: c?.kind === 'label' ? 40 : Math.min(Math.max(h.length + 2, 12), 40),
          ...(d !== null && d !== undefined
            ? { style: { numFmt: d > 0 ? `#,##0.${'0'.repeat(d)}` : '#,##0' } }
            : {}),
        };
      });
      sheet.getRow(1).font = { bold: true };
      for (const r of x.rows) sheet.addRow(r.cells);
      if (x.rows.length > 1) {
        const row = sheet.addRow(x.totals);
        row.font = { bold: true };
      }
    }

    const info = wb.addWorksheet('Parâmetros');
    info.columns = [
      { header: 'Propriedade', width: 40 },
      { header: 'Valor', width: 90 },
    ];
    info.getRow(1).font = { bold: true };
    const lk = req.lookup;
    const describe = (c: ComparisonColumn) =>
      ({
        label: 'descrição',
        group: `coluna ${c.column}`,
        count: `quantidade em ${s.layers[c.layer ?? 0]}`,
        diff: `${s.layers[s.layers.length - 1]} − ${s.layers[0]}`,
        lookup: `${s.lookupName ?? 'tabela de apoio'}.${c.column}`,
        formula: `= ${c.expression}`,
      })[c.kind] +
      (c.hidden ? '; oculta' : '') +
      (c.sum && NUMERIC_KINDS.includes(c.kind) ? '; somada no total' : '');
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
            `${lk.nameColumn ? `; descrição: ${lk.nameColumn}` : ''})`
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
      ...columns.map((c, i) => [`Coluna ${i + 1}: ${titles[i]}`, describe(c)]),
      ['Sem correspondência na tabela de apoio', s.unmatched],
      ['Gerado em', new Date().toISOString()],
    ]);
    await wb.xlsx.write(res);
    res.end();
  }

  /**
   * IDs dos pontos de cada camada que caem num grupo sem correspondência na tabela de apoio
   * (as mesmas condições e o agrupamento do bloco).
   */
  async unmatchedPoints(req: ComparisonRequest): Promise<{
    layers: { sourceId: string; label: string; column: string; ids: string[] }[];
  }> {
    const blocks = req.blocks.filter((b) => b.useLookup);
    if (!req.lookup || !blocks.length) return { layers: [] };
    const ctxs = await Promise.all(req.layers.map((l) => this.sources.context(l.sourceId)));
    const labels = req.layers.map((l, i) => l.label?.trim() || ctxs[i].source.name);
    const lookup = await this.loadLookup(req, []);
    const ids = req.layers.map(() => new Set<string>());
    for (const block of blocks) {
      const keyPos = req.lookup.keys.map((k) => {
        const pos = block.groupBy.indexOf(k.column);
        if (pos < 0) {
          throw new BadRequestException(
            `O bloco "${block.title}" usa a tabela de apoio, mas não agrupa por "${k.column}"`,
          );
        }
        return pos;
      });
      const perLayer = await Promise.all(
        req.layers.map((l, i) => this.count(ctxs[i], labels[i], l.filters, block)),
      );
      for (let i = 0; i < req.layers.length; i++) {
        const seen = new Set<string>();
        const keys = perLayer[i]
          .filter((r) => {
            if (findLookup(lookup, keyPos.map((p) => r.keys[p]), req.ignoreCase)) return false;
            const sig = r.keys.map((k) => k ?? '\u0000').join('\u0001');
            if (seen.has(sig)) return false;
            seen.add(sig);
            return true;
          })
          .map((r) => r.keys);
        for (const id of await this.idsForKeys(ctxs[i], labels[i], req.layers[i].filters, block, keys)) {
          ids[i].add(id);
        }
      }
    }
    const MAX_IDS = 200_000;
    return {
      layers: req.layers.flatMap((l, i) => {
        if (ids[i].size > MAX_IDS) {
          throw new BadRequestException(
            `${labels[i]} tem ${ids[i].size} pontos sem correspondência; o limite da lista é ${MAX_IDS}`,
          );
        }
        return ids[i].size
          ? [{ sourceId: l.sourceId, label: labels[i], column: ctxs[i].idCol.name, ids: [...ids[i]] }]
          : [];
      }),
    };
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

  /** Registros da camada cujo grupo está em `keys`, com os filtros e as condições do bloco. */
  private async idsForKeys(
    ctx: SourceContext,
    label: string,
    filters: FilterDef[],
    block: ComparisonBlock,
    keys: (string | null)[][],
  ): Promise<string[]> {
    if (!keys.length || !block.groupBy.length) return [];
    const groups = block.groupBy.map((g) => this.column(ctx, label, g));
    const out: string[] = [];
    const chunk = 200;
    for (let i = 0; i < keys.length; i += chunk) {
      const part = keys.slice(i, i + chunk);
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
      const ors = part.map(
        (tuple) =>
          `(${groups
            .map((g, k) =>
              tuple[k] === null
                ? `${qi(g.name)}::text IS NULL`
                : `${qi(g.name)}::text = ${params.add(tuple[k])}`,
            )
            .join(' AND ')})`,
      );
      const where = [...conds.map((c) => `(${c})`), `(${ors.join(' OR ')})`].join(' AND ');
      const raw = await this.prisma.$queryRawUnsafe<{ id: string | null }[]>(
        `SELECT DISTINCT ${qi(ctx.idCol.name)}::text AS id FROM ${ctx.table} WHERE ${where}`,
        ...params.values,
      );
      for (const r of raw) if (r.id) out.push(r.id);
    }
    return out;
  }

  private async lookupColumns(lk: ComparisonLookup): Promise<string[]> {
    const cols = await this.catalog.getColumns(lk.schema, lk.table);
    if (!cols.length)
      throw new BadRequestException(`Tabela de apoio não encontrada: ${lk.schema}.${lk.table}`);
    return cols.filter((c) => c.kind !== 'geometry').map((c) => c.name);
  }

  private async loadLookup(
    req: ComparisonRequest,
    extra: string[],
  ): Promise<Map<string, LookupRow>> {
    const lk = req.lookup!;
    const names = new Set(await this.lookupColumns(lk));
    const col = (name: string) => {
      if (!names.has(name)) {
        throw new BadRequestException(`Coluna "${name}" não existe em ${lk.schema}.${lk.table}`);
      }
      return `${qi(name)}::text`;
    };
    const select = [
      ...lk.keys.map((k, i) => `${col(k.lookupColumn)} AS "k${i}"`),
      `${lk.nameColumn ? col(lk.nameColumn) : 'NULL::text'} AS "name"`,
      ...extra.map((c, i) => `${col(c)} AS "v${i}"`),
    ];
    const raw = await this.prisma.$queryRawUnsafe<Record<string, string | null>[]>(
      `SELECT ${select.join(', ')} FROM ${qualified(lk.schema, lk.table)} LIMIT ${MAX_LOOKUP_ROWS}`,
    );
    return indexLookup(
      raw.map((r) => ({
        keys: lk.keys.map((_, i) => r[`k${i}`] ?? null),
        name: r.name?.trim() || null,
        values: Object.fromEntries(extra.map((c, i) => [c, r[`v${i}`] ?? null])),
      })),
      req.ignoreCase,
    );
  }
}
