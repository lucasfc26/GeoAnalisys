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
import type { ImportType } from '../layers/import.parse';
import { LayersService } from '../layers/layers.service';
import { PointsService } from '../points/points.service';
import { SourceContext, SourcesService } from '../tables/sources.service';
import { AssocPoint, aggregateCounts, associate, normalizeValue } from './association.logic';

export interface AssociationLayer {
  sourceId: string;
  filters: FilterDef[];
}

/** Como a divergência de uma prioridade aparece na coluna Status. */
export interface StatusRule {
  /** Não atender a prioridade gera divergência no Status (padrão: sim) */
  consider?: boolean;
  /** Se divergir, o Status mostra só esta prioridade (a primeira, se houver mais de uma) */
  unique?: boolean;
  /** Acrescenta à divergência o valor deste atributo do ponto, com nomes trocados por `labels` */
  attribute?: { side: 'A' | 'B'; column: string; labels?: Record<string, string> } | null;
}

export interface AssociationCriterion {
  columnA: string;
  columnB: string;
  maxDistance: number;
  /** Penalidade em metros (padrão 1) somada ao custo do par quando a prioridade não é atendida */
  weight?: number;
  status?: StatusRule;
}

export interface AddressCriterion {
  columnA: string;
  columnB: string;
  maxDistance: number;
  weight?: number;
  status?: StatusRule;
}

export interface AssociationRequest {
  a: AssociationLayer;
  b: AssociationLayer;
  maxDistance: number;
  criteria: AssociationCriterion[];
  /**
   * Prioridade de agregados: único com único e vários pontos na mesma coordenada com vários pontos
   * na mesma coordenada, até `maxDistance`. Ausente = desligada.
   */
  aggregates: { maxDistance: number; weight?: number; status?: StatusRule } | null;
  /**
   * Prioridade de endereço parecido (ex.: "Rua Exemplo 123" × "Ex 123"), até `maxDistance`. Endereço
   * vazio ou SDO em um dos pontos não conta contra o par. Ausente/null = desligada.
   */
  address?: AddressCriterion | null;
  /** Custo em metros de deixar um ponto sem par (ausente/null = associar o máximo possível) */
  unmatchedCost?: number | null;
  /** Status dos pontos sem par: de A (Ponto Novo; atributo de A) e de B (Não Identificado; de B) */
  unmatchedStatus?: { newPoints?: StatusRule; unidentified?: StatusRule };
  /** Também lista os pontos de B sem associação (0 na primeira coluna) */
  includeUnmatchedB: boolean;
  /** Nome escolhido para cada Status gerado (ex.: "Ponto Normal" → "OK"); ausente = o gerado */
  statusRenames?: Record<string, string>;
  /** Colunas do resultado, na ordem (chaves de `outputFields`); ausente = padrão */
  columns?: string[];
}

interface LoadedPoint extends AssocPoint {
  id: unknown;
  /** Coordenada original (X|Y) para achar pontos na mesma posição */
  coordKey: string | null;
  /** Coordenada original no CRS da camada */
  x: number | null;
  y: number | null;
  /** Valores das colunas de atributo pedidas, na ordem de `attrs` */
  attrs: unknown[];
  /** Valores dos atributos usados no Status (`StatusPlan.rules[k].attr.index`) */
  statusValues: unknown[];
}

export interface AssociationTable {
  headers: string[];
  /** Tipo de cada coluna, para gravar o resultado como camada */
  types: ImportType[];
  rows: unknown[][];
  /** Posição de cada linha: a do ponto de A ou, sem ele, a do ponto de B */
  coords: ({ lat: number; lng: number } | null)[];
  summary: {
    nameA: string;
    nameB: string;
    totalA: number;
    totalB: number;
    matched: number;
    unmatchedA: number;
    unmatchedB: number;
    withoutCoordsA: number;
    withoutCoordsB: number;
    /** Pares por quantidade de prioridades atendidas (índice = quantidade) */
    byCriteria: number[];
    /** Pares que atendem todas as prioridades (Ponto Normal) */
    normal: number;
    /** Pares com alguma prioridade não atendida (Divergência) */
    divergent: number;
    /** Linhas por Status, da mais frequente para a menos */
    byStatus: { status: string; original: string; count: number }[];
    averageDistance: number | null;
    durationMs: number;
  };
}

// ------------------------------------------------------------------ colunas do resultado

export const KEY_ID_A = '@idA';
export const KEY_ID_B = '@idB';
export const KEY_DISTANCE = '@distance';
export const KEY_SCORE = '@score';
export const KEY_WEIGHT = '@weight';
export const KEY_STATUS = '@status';
export const AGGREGATES_LABEL = 'agregados';
export const ADDRESS_LABEL = 'endereço';
/** Chave da coluna "Prioridade: <rótulo>" */
export const critKey = (label: string) => `@crit:${label}`;
/** Chave de um atributo da camada A ou B (`@lat`/`@lng` = latitude/longitude calculadas) */
export const attrKey = (side: 'A' | 'B', column: string) => `${side}:${column}`;
const LAT = '@lat';
const LNG = '@lng';

export function criterionLabel(c: AssociationCriterion) {
  return c.columnA === c.columnB ? c.columnA : `${c.columnA} = ${c.columnB}`;
}

/** Par associado de uma linha (null = ponto sem associação). */
interface PairInfo {
  distance: number;
  met: boolean[];
  /** Soma das penalidades (m) das prioridades não atendidas */
  score: number;
}

/** "a", "a e b", "a, b e c" */
export function joinPt(items: string[]) {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

interface StatusAttr {
  side: 'A' | 'B';
  /** Posição em `statusValues` do ponto da camada */
  index: number;
  /** Valor normalizado → nome */
  names: Map<string, string>;
}

export interface StatusPlan {
  /** Rótulo de cada prioridade (mesma ordem de `PairInfo.met`) */
  labels: string[];
  rules: { consider: boolean; unique: boolean; attr: StatusAttr | null }[];
  /** Pontos só de A (Ponto Novo) e só de B (Não Identificado); ausente = gera, sem atributo */
  newPoints?: { consider: boolean; attr: StatusAttr | null };
  unidentified?: { consider: boolean; attr: StatusAttr | null };
}

type StatusPoint = { statusValues: unknown[] } | null;

/** Nomes dos valores, comparados sem diferenciar maiúsculas e acentos ("" = vazio). */
export function valueNames(labels: Record<string, string> | undefined) {
  const names = new Map<string, string>();
  for (const [value, name] of Object.entries(labels ?? {})) {
    if (name.trim()) names.set(normalizeValue(value) ?? '', name.trim());
  }
  return names;
}

function valueName(raw: unknown, names: Map<string, string>): string | null {
  const key = normalizeValue(raw) ?? '';
  return names.get(key) ?? (key ? String(raw).trim() : null);
}

/**
 * Status da linha: ponto só de A = Ponto Novo; ponto só de B = Não Identificado em A (ambos viram
 * Ponto Normal se configurados para não gerar divergência); par sem divergência nas prioridades
 * consideradas = Ponto Normal; senão "Divergência de a e b" (só a primeira prioridade única que
 * divergiu, se houver). Em seguida, os valores dos atributos escolhidos.
 */
export function statusResolver(nameA: string, plan: StatusPlan) {
  return (p: StatusPoint, q: StatusPoint, pair: PairInfo | null): string => {
    const withValues = (base: string, attrs: (StatusAttr | null | undefined)[]) => {
      const suffix: string[] = [];
      const seen = new Set<string>();
      for (const at of attrs) {
        if (!at || seen.has(`${at.side}${at.index}`)) continue;
        seen.add(`${at.side}${at.index}`);
        const pt = at.side === 'A' ? p : q;
        const name = valueName(pt?.statusValues[at.index] ?? null, at.names);
        if (name) suffix.push(name);
      }
      return [base, ...suffix].join(' ');
    };
    if (!p || !q) {
      const rule = p ? plan.newPoints : plan.unidentified;
      if (rule && !rule.consider) return 'Ponto Normal';
      const base = p ? `Ponto Novo coletado em ${nameA}` : `Não Identificado em ${nameA}`;
      return withValues(base, [rule?.attr]);
    }
    const missing = plan.labels.flatMap((_, k) =>
      !pair?.met[k] && (plan.rules[k]?.consider ?? true) ? [k] : [],
    );
    if (!missing.length) return 'Ponto Normal';
    const unique = missing.find((k) => plan.rules[k]?.unique);
    const shown = unique === undefined ? missing : [unique];
    return withValues(
      `Divergência de ${joinPt(shown.map((k) => plan.labels[k]))}`,
      shown.map((k) => plan.rules[k]?.attr),
    );
  };
}

/** Texto da regra de Status para a aba de parâmetros. */
export function describeStatusRule(rule: StatusRule | undefined, nameA: string, nameB: string) {
  if (!(rule?.consider ?? true)) return 'não gera divergência';
  const parts = ['gera divergência'];
  if (rule?.unique) parts.push('divergência única');
  const at = rule?.attribute;
  if (at) {
    const names = Object.entries(at.labels ?? {})
      .filter(([, n]) => n.trim())
      .map(([v, n]) => `${v || '(vazio)'} → ${n.trim()}`);
    parts.push(
      `com o atributo ${at.column} de ${at.side === 'A' ? nameA : nameB}${names.length ? ` (${names.join(', ')})` : ''}`,
    );
  }
  return parts.join('; ');
}

export interface OutputField {
  key: string;
  header: string;
  type: ImportType;
  /** Coluna de atributo a ler da camada (null = campo da associação) */
  attr: { side: 'A' | 'B'; column: ColumnMeta | typeof LAT | typeof LNG } | null;
  value: (p: LoadedPoint | null, q: LoadedPoint | null, pair: PairInfo | null) => unknown;
}

interface LayerInfo {
  name: string;
  colMap: Map<string, ColumnMeta>;
  /** Tipo da coluna de ID (padrão: texto) */
  idKind?: ColumnMeta['kind'];
}

const typeOfKind = (kind: ColumnMeta['kind'] | undefined): ImportType =>
  kind === 'integer' ? 'integer' : kind === 'number' ? 'number' : 'text';

/** Chaves padrão: IDs, distância, prioridades atendidas, penalidade, status e uma coluna por prioridade. */
export function defaultColumns(critLabels: string[]) {
  return [
    KEY_ID_A,
    KEY_ID_B,
    KEY_DISTANCE,
    KEY_SCORE,
    KEY_WEIGHT,
    KEY_STATUS,
    ...critLabels.map(critKey),
  ];
}

/**
 * Campos pedidos, na ordem pedida (repetidos são ignorados). Os atributos lêem os índices em
 * `attrs` de cada ponto, preenchidos na ordem em que aparecem aqui (por camada).
 */
export function outputFields(
  a: LayerInfo,
  b: LayerInfo,
  critLabels: string[],
  columns?: string[],
  status = statusResolver(a.name, { labels: critLabels, rules: [] }),
): OutputField[] {
  const keys = [...new Set(columns ?? defaultColumns(critLabels))];
  if (!keys.length) throw new BadRequestException('Escolha ao menos uma coluna');
  const attrIndex = { A: 0, B: 0 };
  return keys.map((key): OutputField => {
    if (key === KEY_ID_A) {
      return {
        key,
        header: `ID ${a.name}`,
        type: typeOfKind(a.idKind),
        attr: null,
        value: (p) => (p ? p.id : 0),
      };
    }
    if (key === KEY_ID_B) {
      return {
        key,
        header: `ID ${b.name}`,
        type: typeOfKind(b.idKind),
        attr: null,
        value: (_, q) => (q ? q.id : 0),
      };
    }
    if (key === KEY_DISTANCE) {
      return {
        key,
        header: 'Distância (m)',
        type: 'number',
        attr: null,
        value: (_p, _q, pair) => (pair ? Math.round(pair.distance * 100) / 100 : null),
      };
    }
    if (key === KEY_SCORE) {
      return {
        key,
        header: 'Prioridades atendidas',
        type: 'integer',
        attr: null,
        value: (_p, _q, pair) => (pair ? pair.met.filter(Boolean).length : null),
      };
    }
    if (key === KEY_WEIGHT) {
      return {
        key,
        header: 'Penalidade (m)',
        type: 'number',
        attr: null,
        value: (_p, _q, pair) => (pair ? pair.score : null),
      };
    }
    if (key === KEY_STATUS) {
      return {
        key,
        header: 'Status',
        type: 'text',
        attr: null,
        value: (p, q, pair) => status(p, q, pair),
      };
    }
    if (key.startsWith('@crit:')) {
      const k = critLabels.indexOf(key.slice('@crit:'.length));
      if (k < 0) throw new BadRequestException(`Coluna desconhecida: ${key}`);
      return {
        key,
        header: `Prioridade: ${critLabels[k]}`,
        type: 'text',
        attr: null,
        value: (_p, _q, pair) => (pair ? (pair.met[k] ? 'Sim' : 'Não') : null),
      };
    }
    const m = /^([AB]):(.+)$/.exec(key);
    if (!m) throw new BadRequestException(`Coluna desconhecida: ${key}`);
    const side = m[1] as 'A' | 'B';
    const name = m[2];
    const layer = side === 'A' ? a : b;
    const column = name === LAT || name === LNG ? name : layer.colMap.get(name);
    if (!column) throw new BadRequestException(`Coluna "${name}" não existe em ${layer.name}`);
    const label = name === LAT ? 'Latitude' : name === LNG ? 'Longitude' : name;
    const idx = attrIndex[side]++;
    const pick = (pt: LoadedPoint | null) => (pt ? (pt.attrs[idx] ?? null) : null);
    return {
      key,
      header: `${label} ${layer.name}`,
      type: typeof column === 'string' ? 'number' : typeOfKind(column.kind),
      attr: { side, column },
      value: side === 'A' ? (p) => pick(p) : (_, q) => pick(q),
    };
  });
}

const PREVIEW_ROWS = 200;
/** Pares mandados para a lista de revisão (os mais suspeitos) */
const MAX_REVIEW = 5000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ReviewOptions {
  /** Par distante: acima desta distância em metros (null = não procura) */
  farDistance: number | null;
  /** Par dúbio: margem abaixo destes metros (null = não procura) */
  maxMargin: number | null;
}

export interface ReviewPoint {
  id: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
}

export interface ReviewPair {
  a: ReviewPoint;
  b: ReviewPoint;
  distance: number;
  /** Distância + penalidades */
  cost: number;
  /** Segundo melhor candidato − custo do par (null = sem outro candidato) */
  margin: number | null;
  far: boolean;
  dubious: boolean;
  /** Prioridades não atendidas */
  divergent: string[];
}

export interface AssociationReview {
  nameA: string;
  nameB: string;
  /** Pares encontrados (a lista traz até MAX_REVIEW) */
  total: number;
  far: number;
  dubious: number;
  pairs: ReviewPair[];
}

/** Onde gravar o resultado: nova camada em GeoAnalisysTemp ou substituir uma de lá. */
export type AssociationLayerTarget = { convertCoordinates?: boolean } & (
  { mode: 'create'; name: string } | { mode: 'replace'; sourceId: string; adjustColumns: boolean }
);

@Injectable()
export class AssociationService {
  private readonly logger = new Logger(AssociationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly layers: LayersService,
    private readonly points: PointsService,
  ) {}

  /** Resumo e primeiras linhas do resultado. */
  async preview(req: AssociationRequest) {
    const t = await this.run(req);
    return {
      headers: t.headers,
      summary: t.summary,
      rows: t.rows.slice(0, PREVIEW_ROWS),
      totalRows: t.rows.length,
    };
  }

  /** Resultado completo gravado como camada temporária (nova ou substituindo uma existente). */
  async toLayer(req: AssociationRequest, target: AssociationLayerTarget, userId: string) {
    if (target.mode === 'replace' && [req.a.sourceId, req.b.sourceId].includes(target.sourceId)) {
      throw new BadRequestException('A camada substituída não pode ser a camada A nem a B');
    }
    const t = await this.run(req);
    if (target.mode === 'create') {
      return this.layers.createFromTable(t, target.name, userId, {
        categoryHeader: 'Status',
        convertCoordinates: target.convertCoordinates,
      });
    }
    const replaced = await this.layers.replaceFromTable(
      t,
      target.sourceId,
      target.adjustColumns,
      userId,
    );
    if (!target.convertCoordinates) return replaced;
    const conv = await this.layers.convertCoordinates(target.sourceId, userId);
    return { ...replaced, source: conv.source };
  }

  async download(req: AssociationRequest, format: 'xlsx' | 'csv', res: Response) {
    const t = await this.run(req);
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const filename = `associacao_${t.summary.nameA}_${t.summary.nameB}_${stamp}.${format}`.replace(
      /[^\w.\-]+/g,
      '_',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      const cell = (v: unknown) => {
        if (v === null || v === undefined) return '';
        const s =
          typeof v === 'number'
            ? String(v).replace('.', ',')
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v);
        return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
    const sheet = wb.addWorksheet('Associação', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = t.headers.map((h) => ({
      header: h,
      width: Math.min(Math.max(h.length + 2, 14), 40),
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(
      t.rows.map((r) =>
        r.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)),
      ),
    );

    const s = t.summary;
    const num = (n: number) => String(n).replace('.', ',');
    const info = wb.addWorksheet('Parâmetros');
    info.columns = [
      { header: 'Propriedade', width: 42 },
      { header: 'Valor', width: 60 },
    ];
    info.getRow(1).font = { bold: true };
    info.addRows([
      ['Camada A (1ª coluna)', s.nameA],
      ['Camada B (2ª coluna)', s.nameB],
      ['Distância máxima (m)', req.maxDistance],
      ...req.criteria.map((c, k) => [
        `Prioridade ${k + 1}`,
        `${criterionLabel(c)} — até ${num(c.maxDistance)} m, penalidade ${num(c.weight ?? 1)} m`,
      ]),
      [
        'Prioridade de endereço parecido',
        req.address
          ? `${criterionLabel(req.address)} — algum número igual ou palavra igual/abreviada (vazio ou SDO não conta), até ${num(req.address.maxDistance)} m, penalidade ${num(req.address.weight ?? 1)} m`
          : 'Desligada',
      ],
      [
        'Prioridade de agregados',
        req.aggregates
          ? `mesma quantidade de pontos na coordenada (único com único, 3 com 3); 1 de diferença entre agregados paga metade — até ${num(req.aggregates.maxDistance)} m, penalidade ${num(req.aggregates.weight ?? 1)} m`
          : 'Desligada',
      ],
      ['Custo de ponto sem par (m)', req.unmatchedCost ?? 'sem limite (associa o máximo possível)'],
      ...[
        ...req.criteria.map((c) => ({ label: criterionLabel(c), rule: c.status })),
        ...(req.address ? [{ label: ADDRESS_LABEL, rule: req.address.status }] : []),
        ...(req.aggregates ? [{ label: AGGREGATES_LABEL, rule: req.aggregates.status }] : []),
        { label: `Ponto Novo coletado em ${s.nameA}`, rule: req.unmatchedStatus?.newPoints },
        { label: `Não Identificado em ${s.nameA}`, rule: req.unmatchedStatus?.unidentified },
      ].map(({ label, rule }) => [`Status: ${label}`, describeStatusRule(rule, s.nameA, s.nameB)]),
      ['Filtros da camada A', req.a.filters.length ? JSON.stringify(req.a.filters) : '-'],
      ['Filtros da camada B', req.b.filters.length ? JSON.stringify(req.b.filters) : '-'],
      [],
      [`Pontos de ${s.nameA}`, s.totalA],
      [`Pontos de ${s.nameB}`, s.totalB],
      ['Pares associados', s.matched],
      ['Ponto Normal', s.normal],
      ['Divergência', s.divergent],
      [`Ponto Novo coletado em ${s.nameA}`, s.unmatchedA],
      [`Não Identificado em ${s.nameA}`, s.unmatchedB],
      [`${s.nameA} sem coordenadas`, s.withoutCoordsA],
      [`${s.nameB} sem coordenadas`, s.withoutCoordsB],
      ...s.byCriteria.map((n, k) => [`Pares com ${k} prioridade(s) atendida(s)`, n]),
      ['Distância média dos pares (m)', s.averageDistance],
      ['Gerado em', new Date().toISOString()],
      [],
      ['Status', 'Quantidade'],
      ...s.byStatus.map((x) => [x.status, x.count]),
    ]);
    info.getRow(info.rowCount - s.byStatus.length).font = { bold: true };
    await wb.xlsx.write(res);
    res.end();
  }

  async run(req: AssociationRequest): Promise<AssociationTable> {
    return (await this.compute(req)).table;
  }

  /** Pares distantes ou dúbios, para revisar no mapa (os mais suspeitos primeiro). */
  async review(req: AssociationRequest, opts: ReviewOptions): Promise<AssociationReview> {
    const { table, a, b, r, labels } = await this.compute(req);
    const point = (p: LoadedPoint): ReviewPoint => ({
      id: String(p.id),
      x: p.x!,
      y: p.y!,
      lat: p.lat!,
      lng: p.lng!,
    });
    const pairs: ReviewPair[] = [];
    let far = 0;
    let dubious = 0;
    a.forEach((p, i) => {
      const j = r.matchA[i];
      if (j < 0) return;
      const isFar = opts.farDistance !== null && r.distance[i] > opts.farDistance;
      const isDubious = opts.maxMargin !== null && r.margin[i] < opts.maxMargin;
      if (!isFar && !isDubious) return;
      if (isFar) far++;
      if (isDubious) dubious++;
      pairs.push({
        a: point(p),
        b: point(b[j]),
        distance: round2(r.distance[i]),
        cost: round2(r.cost[i]),
        margin: Number.isFinite(r.margin[i]) ? round2(r.margin[i]) : null,
        far: isFar,
        dubious: isDubious,
        divergent: labels.filter((_, k) => ((r.metMask[i] >> k) & 1) === 0),
      });
    });
    // Distantes primeiro (da maior distância para a menor), depois os dúbios (menor margem primeiro).
    pairs.sort(
      (x, y) =>
        Number(y.far) - Number(x.far) ||
        (x.far ? y.distance - x.distance : (x.margin ?? Infinity) - (y.margin ?? Infinity)),
    );
    return {
      nameA: table.summary.nameA,
      nameB: table.summary.nameB,
      total: pairs.length,
      far,
      dubious,
      pairs: pairs.slice(0, MAX_REVIEW),
    };
  }

  /**
   * Corrige as coordenadas: cada ponto da camada `from` cujo par está a mais de `minDistance` m
   * recebe a coordenada do ponto associado da outra camada. `dryRun` só conta.
   */
  async fixCoordinates(
    req: AssociationRequest,
    from: 'A' | 'B',
    minDistance: number,
    dryRun: boolean,
    userId: string,
  ) {
    const { table, a, b, r } = await this.compute(req);
    const moves: { id: string; targetId: string }[] = [];
    a.forEach((p, i) => {
      const j = r.matchA[i];
      if (j < 0 || !(r.distance[i] > minDistance)) return;
      const [src, dst] = from === 'A' ? [p, b[j]] : [b[j], p];
      moves.push({ id: String(src.id), targetId: String(dst.id) });
    });
    const [nameFrom, nameTo] =
      from === 'A'
        ? [table.summary.nameA, table.summary.nameB]
        : [table.summary.nameB, table.summary.nameA];
    if (dryRun || !moves.length) {
      return { count: moves.length, moved: 0, nameFrom, nameTo, groups: [] };
    }
    const [sourceId, targetId] =
      from === 'A' ? [req.a.sourceId, req.b.sourceId] : [req.b.sourceId, req.a.sourceId];
    const res = await this.points.snapTo(sourceId, targetId, moves, userId);
    return { count: moves.length, moved: res.count, nameFrom, nameTo, groups: res.groups };
  }

  private async compute(req: AssociationRequest) {
    const started = Date.now();
    if (req.a.sourceId === req.b.sourceId) {
      throw new BadRequestException('Escolha duas camadas diferentes');
    }
    const [ctxA, ctxB] = await Promise.all([
      this.sources.context(req.a.sourceId),
      this.sources.context(req.b.sourceId),
    ]);
    const nameA = ctxA.source.name;
    const nameB = ctxB.source.name;

    // Endereço e agregados entram como mais prioridades (nesta ordem, depois das escolhidas); nos
    // agregados, a quantidade de pontos na coordenada é o valor.
    const criteria: {
      label: string;
      maxDistance: number;
      weight: number;
      kind?: 'address' | 'count';
    }[] =
      req.criteria.map((c) => ({
        label: criterionLabel(c),
        maxDistance: c.maxDistance,
        weight: c.weight ?? 1,
      }));
    if (req.address) {
      criteria.push({
        label: ADDRESS_LABEL,
        maxDistance: req.address.maxDistance,
        weight: req.address.weight ?? 1,
        kind: 'address',
      });
    }
    if (req.aggregates) {
      criteria.push({
        label: AGGREGATES_LABEL,
        maxDistance: req.aggregates.maxDistance,
        weight: req.aggregates.weight ?? 1,
        kind: 'count',
      });
    }
    const statusCols = { A: [] as ColumnMeta[], B: [] as ColumnMeta[] };
    const statusIndex = (side: 'A' | 'B', name: string) => {
      const col = this.column(side === 'A' ? ctxA : ctxB, name);
      const i = statusCols[side].indexOf(col);
      return i >= 0 ? i : statusCols[side].push(col) - 1;
    };
    const statusRules = [
      ...req.criteria.map((c) => c.status),
      ...(req.address ? [req.address.status] : []),
      ...(req.aggregates ? [req.aggregates.status] : []),
    ];
    const statusAttr = (s: StatusRule | undefined): StatusAttr | null =>
      s?.attribute
        ? {
            side: s.attribute.side,
            index: statusIndex(s.attribute.side, s.attribute.column),
            names: valueNames(s.attribute.labels),
          }
        : null;
    const unmatchedRule = (s: StatusRule | undefined, side: 'A' | 'B', what: string) => {
      if (!s) return undefined;
      if (s.attribute && s.attribute.side !== side) {
        const name = side === 'A' ? nameA : nameB;
        throw new BadRequestException(`O atributo do Status de ${what} deve ser de ${name}`);
      }
      return { consider: s.consider ?? true, attr: statusAttr(s) };
    };
    const plan: StatusPlan = {
      labels: criteria.map((c) => c.label),
      rules: statusRules.map((s) => ({
        consider: s?.consider ?? true,
        unique: s?.unique ?? false,
        attr: statusAttr(s),
      })),
      newPoints: unmatchedRule(req.unmatchedStatus?.newPoints, 'A', 'Ponto Novo'),
      unidentified: unmatchedRule(req.unmatchedStatus?.unidentified, 'B', 'Não Identificado'),
    };
    const statusOf = statusResolver(nameA, plan);
    const renames = new Map(Object.entries(req.statusRenames ?? {}));
    const rename = (status: string) => renames.get(status) ?? status;
    // Cada linha calcula o Status uma vez (contagem) e a coluna Status reaproveita, já renomeado.
    let lastStatus = '';
    const fields = outputFields(
      { name: nameA, colMap: ctxA.colMap, idKind: ctxA.idCol.kind },
      { name: nameB, colMap: ctxB.colMap, idKind: ctxB.idCol.kind },
      plan.labels,
      req.columns,
      () => rename(lastStatus),
    );
    const attrsOf = (side: 'A' | 'B') =>
      fields.flatMap((f) => (f.attr?.side === side ? [f.attr.column] : []));

    const [a, b] = await Promise.all([
      this.load(
        ctxA,
        req.a.filters,
        [...req.criteria, ...(req.address ? [req.address] : [])].map((c) =>
          this.column(ctxA, c.columnA),
        ),
        attrsOf('A'),
        statusCols.A,
      ),
      this.load(
        ctxB,
        req.b.filters,
        [...req.criteria, ...(req.address ? [req.address] : [])].map((c) =>
          this.column(ctxB, c.columnB),
        ),
        attrsOf('B'),
        statusCols.B,
      ),
    ]);
    if (req.aggregates) {
      for (const pts of [a, b]) {
        const counts = aggregateCounts(pts.map((p) => p.coordKey));
        pts.forEach((p, i) => p.values.push(counts[i]));
      }
    }

    let r;
    try {
      r = associate(a, b, {
        maxDistance: req.maxDistance,
        criteria,
        unmatchedCost: req.unmatchedCost,
      });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const byCriteria = new Array<number>(criteria.length + 1).fill(0);
    let matched = 0;
    let normal = 0;
    let sumDistance = 0;
    const byStatus = new Map<string, number>();
    const row = (p: LoadedPoint | null, q: LoadedPoint | null, pair: PairInfo | null) => {
      const status = statusOf(p, q, pair);
      lastStatus = status;
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
      if (pair && status === 'Ponto Normal') normal++;
      return fields.map((f) => f.value(p, q, pair) ?? null);
    };
    const position = (pt: LoadedPoint) =>
      pt.lat !== null && pt.lng !== null ? { lat: pt.lat, lng: pt.lng } : null;
    const coords = a.map(position);
    const rows: unknown[][] = a.map((p, i) => {
      const j = r.matchA[i];
      if (j < 0) return row(p, null, null);
      matched++;
      sumDistance += r.distance[i];
      const met = criteria.map((_, k) => ((r.metMask[i] >> k) & 1) === 1);
      byCriteria[met.filter(Boolean).length]++;
      // Penalidades somadas = custo − distância (agregados com 1 de diferença pagam só metade).
      const score = r.cost[i] - r.distance[i];
      return row(p, b[j], { distance: r.distance[i], met, score: Math.round(score * 1e6) / 1e6 });
    });
    let unmatchedB = 0;
    b.forEach((q, j) => {
      if (r.matchB[j] >= 0) return;
      unmatchedB++;
      const line = row(null, q, null);
      if (req.includeUnmatchedB) {
        rows.push(line);
        coords.push(position(q));
      }
    });

    const noCoords = (pts: LoadedPoint[]) =>
      pts.filter((p) => p.lat === null || p.lng === null).length;
    const summary = {
      nameA,
      nameB,
      totalA: a.length,
      totalB: b.length,
      matched,
      unmatchedA: a.length - matched,
      unmatchedB,
      withoutCoordsA: noCoords(a),
      withoutCoordsB: noCoords(b),
      byCriteria,
      normal,
      divergent: matched - normal,
      byStatus: [...byStatus]
        .map(([original, count]) => ({ status: rename(original), original, count }))
        .sort((x, y) => y.count - x.count || x.status.localeCompare(y.status, 'pt-BR')),
      averageDistance: matched ? Math.round((sumDistance / matched) * 100) / 100 : null,
      durationMs: Date.now() - started,
    };
    this.logger.log({ event: 'association', a: req.a.sourceId, b: req.b.sourceId, ...summary });
    const table: AssociationTable = {
      headers: fields.map((f) => f.header),
      types: fields.map((f) => f.type),
      rows,
      coords,
      summary,
    };
    return { table, a, b, r, labels: plan.labels };
  }

  private column(ctx: SourceContext, name: string) {
    const c = ctx.colMap.get(name);
    if (!c) throw new BadRequestException(`Coluna "${name}" não existe em ${ctx.source.name}`);
    if (c.kind === 'geometry')
      throw new BadRequestException(`Coluna geométrica não suportada: ${name}`);
    return c;
  }

  /**
   * ID, coordenadas (lat/lng), valores das colunas de prioridade e das colunas de atributo pedidas,
   * na ordem do ID.
   */
  private async load(
    ctx: SourceContext,
    filters: FilterDef[],
    cols: ColumnMeta[],
    attrs: (ColumnMeta | typeof LAT | typeof LNG)[],
    statusCols: ColumnMeta[],
  ): Promise<LoadedPoint[]> {
    const params = new Params();
    const conds = buildFilterConditions(filters, ctx.colMap, params);
    const where = conds.length ? `WHERE ${conds.map((c) => `(${c})`).join(' AND ')}` : '';
    const select = [
      selectExpr(ctx.idCol, '__id'),
      `${ctx.xExpr} AS "__x"`,
      `${ctx.yExpr} AS "__y"`,
      ...cols.map((c, k) => selectExpr(c, `__c${k}`)),
      ...attrs.flatMap((c, k) => (typeof c === 'string' ? [] : [selectExpr(c, `__a${k}`)])),
      ...statusCols.map((c, k) => selectExpr(c, `__s${k}`)),
    ].join(', ');
    const raw = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${select} FROM ${ctx.table} ${where} ORDER BY ${qi(ctx.idCol.name)}`,
      ...params.values,
    );
    return raw.map((r) => {
      const x = r.__x as number | null;
      const y = r.__y as number | null;
      const ll = x !== null && y !== null ? ctx.crs.toLatLng(x, y) : null;
      const lat = ll ? Math.round(ll.lat * 1e8) / 1e8 : null;
      const lng = ll ? Math.round(ll.lng * 1e8) / 1e8 : null;
      return {
        id: normalizeDb(r.__id, ctx.idCol.kind),
        lat,
        lng,
        coordKey: ll ? `${x}|${y}` : null,
        x,
        y,
        values: cols.map((c, k) => normalizeValue(normalizeDb(r[`__c${k}`], c.kind))),
        attrs: attrs.map((c, k) =>
          c === LAT ? lat : c === LNG ? lng : normalizeDb(r[`__a${k}`], c.kind),
        ),
        statusValues: statusCols.map((c, k) => normalizeDb(r[`__s${k}`], c.kind)),
      };
    });
  }
}
