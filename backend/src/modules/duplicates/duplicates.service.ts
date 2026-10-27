import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { FilterDef, buildFilterConditions } from '../../common/filters';
import {
  ColumnMeta,
  Params,
  normalizeValue as normalizeDb,
  qi,
  selectExpr,
} from '../../common/sql';
import { PrismaService } from '../../prisma/prisma.service';
import { associate, normalizeValue } from '../association/association.logic';
import { SourceContext, SourcesService } from '../tables/sources.service';
import { DupPair, DupPart, DupPoint, findDuplicates } from './duplicates.logic';

export interface DuplicateRule {
  column: string;
  mode: 'equal' | 'different';
  scope: 'radius' | 'sameCoord';
  weight: number;
}

export interface DuplicatesRequest {
  layer: { sourceId: string; filters: FilterDef[] };
  radius: number;
  sameCoordWeight: number;
  rules: DuplicateRule[];
  /** Camada de referência (ex.: Censo Anterior), associada 1 para 1 até `maxDistance`; null = não usa */
  reference: {
    sourceId: string;
    filters: FilterDef[];
    maxDistance: number;
    /** Um associado e o outro sem par, mas alcançando o mesmo ponto da referência */
    sharedMatched: number;
    bothMatched: number;
    oneMatched: number;
    noneMatched: number;
  } | null;
  density: { radius: number; minCount: number; weight: number } | null;
  /**
   * IDs dos dois pontos: em sequência (diferença até `maxGap` ou um começa com o outro) ou sem
   * relação. `column` null = coluna de ID da camada. null = desligado.
   */
  ids: { column: string | null; maxGap: number; sequential: number; unrelated: number } | null;
  minScore: number;
  /** Também lista os outros pares a até o raio dos pontos suspeitos (abaixo da mínima) */
  includeNearby: boolean;
}

/** Ponto do resultado, para selecionar e centralizar no mapa. */
export interface DupPointRef {
  id: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
}

export interface DupPreviewPair {
  group: number;
  distance: number;
  sameCoord: boolean;
  score: number;
  /** Abaixo da pontuação mínima (outro candidato de um ponto suspeito) */
  belowMin: boolean;
  reasons: string;
  nearbyUnmatched: number | null;
  a: DupPointRef & { ref: unknown };
  b: DupPointRef & { ref: unknown };
}

interface LoadedPoint extends DupPoint {
  id: unknown;
  x: number | null;
  y: number | null;
  /** Valores originais das colunas das regras (na ordem de `columns`) */
  raw: unknown[];
  /** ID do ponto da referência associado */
  ref: unknown;
}

export interface DuplicatesResult {
  headers: string[];
  rows: unknown[][];
  /** Primeiros grupos inteiros (prévia) */
  pairs: DupPreviewPair[];
  /** Todos os pontos dos pares suspeitos */
  points: DupPointRef[];
  /** Por ponto suspeito, todos os seus candidatos (aba "Por ponto" do XLSX) */
  byPoint: { headers: string[]; rows: unknown[][] };
  summary: {
    name: string;
    referenceName: string | null;
    total: number;
    withoutCoords: number;
    /** Pontos associados à referência (null = sem referência) */
    matchedReference: number | null;
    /** Pares suspeitos (≥ pontuação mínima) */
    pairs: number;
    /** Outros pares dos pontos suspeitos, abaixo da mínima */
    nearbyPairs: number;
    /** Pares na prévia (grupos inteiros) */
    previewPairs: number;
    sameCoordPairs: number;
    points: number;
    groups: number;
    durationMs: number;
  };
}

const PREVIEW_PAIRS = 500;

const signed = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${String(Math.abs(n)).replace('.', ',')}`;

export function ruleLabel(r: Pick<DuplicateRule, 'column' | 'mode' | 'scope'>) {
  return `${r.column} ${r.mode === 'equal' ? 'igual' : 'diferente'}${r.scope === 'sameCoord' ? ' na mesma coordenada' : ''}`;
}

/** "mesma coordenada (+2); tipo_lampada igual (+1); só um associado a Censo Anterior (+2)" */
export function describeParts(
  parts: DupPart[],
  req: Pick<DuplicatesRequest, 'rules' | 'density'>,
  referenceName: string | null,
  nearbyUnmatched: number | null,
) {
  return parts
    .map((p) => {
      let label: string;
      if (p.key === 'same') label = 'mesma coordenada';
      else if (p.key.startsWith('rule:')) label = ruleLabel(req.rules[Number(p.key.slice(5))]);
      else if (p.key === 'ref:shared') label = `disputam o mesmo ponto de ${referenceName}`;
      else if (p.key === 'ref:both') label = `cada um com o seu ponto em ${referenceName}`;
      else if (p.key === 'ref:one') label = `só um associado a ${referenceName}`;
      else if (p.key === 'id:seq') label = 'IDs em sequência';
      else if (p.key === 'id:unrelated') label = 'IDs sem relação';
      else if (p.key === 'ref:none') label = `nenhum associado a ${referenceName}`;
      else
        label = `${nearbyUnmatched} sem associação a até ${String(req.density?.radius).replace('.', ',')} m`;
      return `${label} (${signed(p.weight)})`;
    })
    .join('; ');
}

@Injectable()
export class DuplicatesService {
  private readonly logger = new Logger(DuplicatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
  ) {}

  /** Resumo, primeiros pares e todos os pontos suspeitos (para selecionar no mapa). */
  async preview(req: DuplicatesRequest) {
    const { summary, pairs, points } = await this.run(req);
    return { summary, pairs, points };
  }

  async download(req: DuplicatesRequest, format: 'xlsx' | 'csv', res: Response) {
    const t = await this.run(req);
    const s = t.summary;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const filename = `duplicidades_${s.name}_${stamp}.${format}`.replace(/[^\w.\-]+/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    const plain = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      const cell = (v: unknown) => {
        if (v === null || v === undefined) return '';
        const str = typeof v === 'number' ? String(v).replace('.', ',') : String(plain(v));
        return /[;"\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const lines = [t.headers, ...t.rows].map((r) => r.map(cell).join(';'));
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
    const sheet = wb.addWorksheet('Duplicidades', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = t.headers.map((h) => ({
      header: h,
      width: Math.min(Math.max(h.length + 2, 12), 60),
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(t.rows.map((r) => r.map(plain)));

    const perPoint = wb.addWorksheet('Por ponto', { views: [{ state: 'frozen', ySplit: 1 }] });
    perPoint.columns = t.byPoint.headers.map((h, k) => ({
      header: h,
      width: k === t.byPoint.headers.length - 1 ? 100 : Math.max(h.length + 2, 12),
    }));
    perPoint.getRow(1).font = { bold: true };
    perPoint.addRows(t.byPoint.rows.map((r) => r.map(plain)));

    const num = (n: number) => String(n).replace('.', ',');
    const info = wb.addWorksheet('Parâmetros');
    info.columns = [
      { header: 'Propriedade', width: 44 },
      { header: 'Valor', width: 60 },
    ];
    info.getRow(1).font = { bold: true };
    const ref = req.reference;
    info.addRows([
      ['Camada', s.name],
      ['Raio máximo (m)', req.radius],
      ['Pontuação mínima', req.minScore],
      ['Mesma coordenada', `peso ${signed(req.sameCoordWeight)}`],
      ...req.rules.map((r, k) => [`Regra ${k + 1}`, `${ruleLabel(r)} — peso ${signed(r.weight)}`]),
      ['Camada de referência', s.referenceName ?? 'Não usada'],
      ...(ref
        ? [
            ['Associação à referência até (m)', ref.maxDistance],
            ['Disputam o mesmo ponto da referência', `peso ${signed(ref.sharedMatched)}`],
            ['Cada um com o seu ponto na referência', `peso ${signed(ref.bothMatched)}`],
            ['Só um associado (sem disputa)', `peso ${signed(ref.oneMatched)}`],
            ['Nenhum associado', `peso ${signed(ref.noneMatched)}`],
          ]
        : []),
      [
        'Pontos sem associação por perto',
        req.density && ref
          ? `${req.density.minCount} ou mais a até ${num(req.density.radius)} m — peso ${signed(req.density.weight)}`
          : 'Desligado',
      ],
      [
        'IDs',
        req.ids
          ? `${req.ids.column ?? 'ID da camada'}: em sequência (diferença até ${num(req.ids.maxGap)} ou um começa com o outro) peso ${signed(req.ids.sequential)}; sem relação peso ${signed(req.ids.unrelated)}`
          : 'Desligado',
      ],
      ['Filtros da camada', req.layer.filters.length ? JSON.stringify(req.layer.filters) : '-'],
      ...(ref
        ? [['Filtros da referência', ref.filters.length ? JSON.stringify(ref.filters) : '-']]
        : []),
      [],
      [`Pontos de ${s.name}`, s.total],
      ['Sem coordenadas', s.withoutCoords],
      ...(s.matchedReference !== null
        ? [[`Associados a ${s.referenceName}`, s.matchedReference]]
        : []),
      ['Pares suspeitos', s.pairs],
      [
        'Outros pares dos pontos suspeitos (abaixo da mínima)',
        req.includeNearby ? s.nearbyPairs : 'Não listados',
      ],
      ['Pares suspeitos na mesma coordenada', s.sameCoordPairs],
      ['Pontos envolvidos', s.points],
      ['Grupos', s.groups],
      ['Gerado em', new Date().toISOString()],
    ]);
    await wb.xlsx.write(res);
    res.end();
  }

  async run(req: DuplicatesRequest): Promise<DuplicatesResult> {
    const started = Date.now();
    if (req.reference && req.reference.sourceId === req.layer.sourceId) {
      throw new BadRequestException(
        'A camada de referência deve ser diferente da camada analisada',
      );
    }
    const [ctx, refCtx] = await Promise.all([
      this.sources.context(req.layer.sourceId),
      req.reference ? this.sources.context(req.reference.sourceId) : null,
    ]);
    const name = ctx.source.name;
    const referenceName = refCtx?.source.name ?? null;

    // Cada coluna é lida uma vez, mesmo usada em mais de uma regra.
    const columns: ColumnMeta[] = [];
    const colIndex = (name: string) => {
      const col = this.column(ctx, name);
      const i = columns.indexOf(col);
      return i >= 0 ? i : columns.push(col) - 1;
    };
    const ruleCol = req.rules.map((r) => colIndex(r.column));
    // Regra de IDs numa coluna própria (ex.: id_ponto); sem coluna, o ID da camada.
    const idCol = req.ids?.column ? colIndex(req.ids.column) : null;

    const [pts, refPts] = await Promise.all([
      this.load(ctx, req.layer.filters, columns),
      refCtx && req.reference ? this.load(refCtx, req.reference.filters, []) : null,
    ]);
    for (const p of pts) {
      p.values = ruleCol.map((c) => normalizeValue(p.raw[c]));
      p.idKey = normalizeValue(idCol === null ? p.id : p.raw[idCol]);
    }

    let matchedReference: number | null = null;
    if (refPts && req.reference) {
      const r = associate(pts, refPts, { maxDistance: req.reference.maxDistance, criteria: [] });
      matchedReference = 0;
      pts.forEach((p, i) => {
        const j = r.matchA[i];
        p.matched = j >= 0;
        p.ref = j >= 0 ? refPts[j].id : null;
        p.refPos = j >= 0 ? { lat: refPts[j].lat!, lng: refPts[j].lng! } : null;
        if (j >= 0) matchedReference!++;
      });
    }

    let pairs: DupPair[];
    try {
      pairs = findDuplicates(pts, {
        radius: req.radius,
        sameCoordWeight: req.sameCoordWeight,
        rules: req.rules,
        reference: req.reference
          ? {
              maxDistance: req.reference.maxDistance,
              shared: req.reference.sharedMatched,
              bothMatched: req.reference.bothMatched,
              oneMatched: req.reference.oneMatched,
              noneMatched: req.reference.noneMatched,
            }
          : null,
        ids: req.ids,
        density: req.reference ? req.density : null,
        minScore: req.minScore,
        includeNearby: req.includeNearby,
      });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const refOf = (p: LoadedPoint): DupPointRef => ({
      id: String(p.id),
      x: p.x!,
      y: p.y!,
      lat: p.lat!,
      lng: p.lng!,
    });
    const reasons = pairs.map((pr) =>
      describeParts(pr.parts, req, referenceName, pr.nearbyUnmatched),
    );
    const involved = new Set<number>();
    for (const pr of pairs) if (!pr.belowMin) involved.add(pr.i).add(pr.j);
    const situation = (pr: DupPair) => (pr.belowMin ? 'Abaixo da mínima' : 'Suspeito');

    const headers = [
      'Grupo',
      'ID 1',
      'ID 2',
      'Distância (m)',
      'Mesma coordenada',
      'Pontuação',
      'Situação',
      'Motivos',
      ...(referenceName ? [`ID ${referenceName} 1`, `ID ${referenceName} 2`] : []),
      ...(referenceName && req.density ? ['Sem associação próximos'] : []),
      ...columns.flatMap((c) => [`${c.name} 1`, `${c.name} 2`]),
      'Latitude 1',
      'Longitude 1',
      'Latitude 2',
      'Longitude 2',
    ];
    const rows = pairs.map((pr, k) => {
      const p = pts[pr.i];
      const q = pts[pr.j];
      return [
        pr.group,
        p.id,
        q.id,
        Math.round(pr.distance * 100) / 100,
        pr.sameCoord ? 'Sim' : 'Não',
        pr.score,
        situation(pr),
        reasons[k],
        ...(referenceName ? [p.ref ?? 0, q.ref ?? 0] : []),
        ...(referenceName && req.density ? [pr.nearbyUnmatched] : []),
        ...columns.flatMap((_, c) => [p.raw[c] ?? null, q.raw[c] ?? null]),
        p.lat,
        p.lng,
        q.lat,
        q.lng,
      ];
    });

    // Prévia: grupos inteiros (os pares já vêm ordenados por grupo), até o limite de pares.
    let previewCount = 0;
    while (
      previewCount < pairs.length &&
      (previewCount < PREVIEW_PAIRS || pairs[previewCount].group === pairs[previewCount - 1].group)
    ) {
      previewCount++;
    }

    const suspects = pairs.filter((p) => !p.belowMin);
    const summary = {
      name,
      referenceName,
      total: pts.length,
      withoutCoords: pts.filter((p) => p.lat === null || p.lng === null).length,
      matchedReference,
      pairs: suspects.length,
      nearbyPairs: pairs.length - suspects.length,
      previewPairs: previewCount,
      sameCoordPairs: suspects.filter((p) => p.sameCoord).length,
      points: involved.size,
      groups: pairs.reduce((m, p) => Math.max(m, p.group), 0),
      durationMs: Date.now() - started,
    };
    this.logger.log({ event: 'duplicates', layer: req.layer.sourceId, ...summary });
    return {
      headers,
      rows,
      pairs: pairs.slice(0, previewCount).map((pr, k) => ({
        group: pr.group,
        distance: Math.round(pr.distance * 100) / 100,
        sameCoord: pr.sameCoord,
        score: pr.score,
        belowMin: pr.belowMin,
        reasons: reasons[k],
        nearbyUnmatched: pr.nearbyUnmatched,
        a: { ...refOf(pts[pr.i]), ref: pts[pr.i].ref },
        b: { ...refOf(pts[pr.j]), ref: pts[pr.j].ref },
      })),
      points: [...involved].map((i) => refOf(pts[i])),
      byPoint: this.byPoint(pts, pairs, referenceName),
      summary,
    };
  }

  /**
   * Uma linha por ponto suspeito com todos os candidatos (mais suspeito primeiro):
   * "845668 (8,17 m; 4 pts); 845669 (11,4 m; 3 pts)". Mostra quando há mais de uma duplicidade.
   */
  private byPoint(pts: LoadedPoint[], pairs: DupPair[], referenceName: string | null) {
    const byIdx = new Map<number, { group: number; list: { other: number; pair: DupPair }[] }>();
    for (const pr of pairs) {
      for (const [self, other] of [
        [pr.i, pr.j],
        [pr.j, pr.i],
      ]) {
        const entry = byIdx.get(self) ?? { group: pr.group, list: [] };
        entry.list.push({ other, pair: pr });
        byIdx.set(self, entry);
      }
    }
    const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
    const rows = [...byIdx]
      .filter(([, e]) => e.list.some((x) => !x.pair.belowMin))
      .sort(
        ([a, x], [b, y]) =>
          x.group - y.group ||
          String(pts[a].id).localeCompare(String(pts[b].id), 'pt-BR', { numeric: true }),
      )
      .map(([idx, e]) => {
        const list = e.list.sort(
          (x, y) =>
            Number(x.pair.belowMin) - Number(y.pair.belowMin) ||
            y.pair.score - x.pair.score ||
            x.pair.distance - y.pair.distance,
        );
        const suspects = list.filter((x) => !x.pair.belowMin).length;
        return [
          e.group,
          pts[idx].id,
          ...(referenceName ? [pts[idx].ref ?? 0] : []),
          suspects,
          list
            .map(
              (x) =>
                `${String(pts[x.other].id)} (${num(x.pair.distance)} m; ${num(x.pair.score)} pts${x.pair.belowMin ? '; abaixo da mínima' : ''})`,
            )
            .join('; '),
        ];
      });
    return {
      headers: [
        'Grupo',
        'ID',
        ...(referenceName ? [`ID ${referenceName}`] : []),
        'Candidatos suspeitos',
        'Candidatos (ID, distância, pontuação)',
      ],
      rows,
    };
  }

  private column(ctx: SourceContext, name: string) {
    const c = ctx.colMap.get(name);
    if (!c) throw new BadRequestException(`Coluna "${name}" não existe em ${ctx.source.name}`);
    if (c.kind === 'geometry')
      throw new BadRequestException(`Coluna geométrica não suportada: ${name}`);
    return c;
  }

  /** ID, coordenadas e valores das colunas pedidas, na ordem do ID. */
  private async load(
    ctx: SourceContext,
    filters: FilterDef[],
    cols: ColumnMeta[],
  ): Promise<LoadedPoint[]> {
    const params = new Params();
    const conds = buildFilterConditions(filters, ctx.colMap, params);
    const where = conds.length ? `WHERE ${conds.map((c) => `(${c})`).join(' AND ')}` : '';
    const select = [
      selectExpr(ctx.idCol, '__id'),
      `${ctx.xExpr} AS "__x"`,
      `${ctx.yExpr} AS "__y"`,
      ...cols.map((c, k) => selectExpr(c, `__c${k}`)),
    ].join(', ');
    const raw = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${select} FROM ${ctx.table} ${where} ORDER BY ${qi(ctx.idCol.name)}`,
      ...params.values,
    );
    return raw.map((r) => {
      const x = r.__x as number | null;
      const y = r.__y as number | null;
      const ll = x !== null && y !== null ? ctx.crs.toLatLng(x, y) : null;
      return {
        id: normalizeDb(r.__id, ctx.idCol.kind),
        x,
        y,
        lat: ll ? Math.round(ll.lat * 1e8) / 1e8 : null,
        lng: ll ? Math.round(ll.lng * 1e8) / 1e8 : null,
        coordKey: ll ? `${x}|${y}` : null,
        raw: cols.map((c, k) => normalizeDb(r[`__c${k}`], c.kind)),
        values: [],
        matched: null,
        ref: null,
      };
    });
  }
}
