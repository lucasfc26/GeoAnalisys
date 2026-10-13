import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FilterDef, buildFilterConditions } from '../../common/filters';
import {
  ColumnMeta,
  Params,
  normalizeValue as normalizeDb,
  qi,
  selectExpr,
} from '../../common/sql';
import { PrismaService } from '../../prisma/prisma.service';
import { SourceContext, SourcesService } from '../tables/sources.service';
import {
  AttrResult,
  PolygonArea,
  farFromCenter,
  farFromReference,
  parsePolygons,
} from './analysis.logic';

/** Pontos devolvidos para selecionar no mapa (como na seleção espacial). */
const MAX_POINTS = 200_000;

export interface LayerRef {
  sourceId: string;
  filters: FilterDef[];
}

export interface OutsideRequest {
  layer: LayerRef;
  /** Nome do limite (só para o resumo) */
  boundaryName: string;
  polygons: unknown;
  /** Fora, mas a até esta distância (m) da borda, não conta (erro de GPS) */
  tolerance: number;
}

export interface AttributeDistanceRequest {
  layer: LayerRef & { column: string };
  /** Camada com o ponto de cada valor (ex.: Medições / medidor_nc); null = centro dos pontos da própria camada */
  reference: (LayerRef & { column: string }) | null;
  maxDistance: number;
  /** Sem referência: centro pela mediana (não é puxado pelos distantes) ou pela média */
  center: 'median' | 'mean';
  /** Sem referência: mínimo de pontos com o mesmo valor para calcular o centro */
  minPoints: number;
  /** "000123" = "123" */
  stripZeros: boolean;
  /** Valores de preenchimento que não identificam o local (ex.: "SN", "0") */
  ignore: string[];
}

export interface PointRef {
  id: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
}

interface Loaded {
  id: unknown;
  x: number | null;
  y: number | null;
  lat: number | null;
  lng: number | null;
  value: unknown;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
  ) {}

  /** Pontos fora do limite, do mais distante da borda para o mais próximo. */
  async outside(req: OutsideRequest) {
    const started = Date.now();
    let area: PolygonArea;
    try {
      area = new PolygonArea(parsePolygons(req.polygons));
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const ctx = await this.sources.context(req.layer.sourceId);
    const pts = await this.load(ctx, req.layer.filters, null);

    let withoutCoords = 0;
    let inside = 0;
    let withinTolerance = 0;
    const outside: (PointRef & { distance: number })[] = [];
    for (const p of pts) {
      if (p.lat === null || p.lng === null) {
        withoutCoords++;
        continue;
      }
      if (area.contains(p.lng, p.lat)) {
        inside++;
        continue;
      }
      const distance = area.distance(p.lng, p.lat);
      if (distance <= req.tolerance) {
        withinTolerance++;
        continue;
      }
      outside.push({ ...this.ref(p), distance: round2(distance) });
    }
    outside.sort((a, b) => b.distance - a.distance);

    const summary = {
      name: ctx.source.name,
      boundaryName: req.boundaryName,
      total: pts.length,
      withoutCoords,
      inside,
      withinTolerance,
      outside: outside.length,
      truncated: outside.length > MAX_POINTS,
      durationMs: Date.now() - started,
    };
    this.logger.log({
      event: 'outside-boundary',
      layer: req.layer.sourceId,
      edges: area.edgeCount,
      ...summary,
    });
    return { summary, points: outside.slice(0, MAX_POINTS) };
  }

  /**
   * Pontos longe do ponto da referência com o mesmo valor (ou do centro dos pontos da própria camada
   * com o mesmo valor), do mais distante para o mais próximo.
   */
  async attributeDistance(req: AttributeDistanceRequest) {
    const started = Date.now();
    const ref = req.reference;
    if (ref && ref.sourceId === req.layer.sourceId && ref.column === req.layer.column) {
      throw new BadRequestException(
        'Referência igual à camada analisada: escolha outra camada/atributo ou use o centro dos próprios pontos',
      );
    }
    const [ctx, refCtx] = await Promise.all([
      this.sources.context(req.layer.sourceId),
      ref ? this.sources.context(ref.sourceId) : null,
    ]);
    const col = this.column(ctx, req.layer.column);
    const refCol = refCtx && ref ? this.column(refCtx, ref.column) : null;
    const [pts, refPts] = await Promise.all([
      this.load(ctx, req.layer.filters, col),
      refCtx && ref ? this.load(refCtx, ref.filters, refCol) : null,
    ]);

    const opts = { maxDistance: req.maxDistance, stripZeros: req.stripZeros, ignore: req.ignore };
    const results: AttrResult[] = refPts
      ? farFromReference(pts, refPts, opts)
      : farFromCenter(pts, { ...opts, center: req.center, minPoints: req.minPoints });

    const count = (s: AttrResult['status']) => results.filter((r) => r.status === s).length;
    const far = results
      .map((r, i) => ({ r, p: pts[i] }))
      .filter(({ r }) => r.status === 'far')
      .sort((a, b) => b.r.distance! - a.r.distance!)
      .map(({ r, p }) => {
        const target = r.ref >= 0 ? refPts![r.ref] : null;
        return {
          ...this.ref(p),
          value: p.value,
          distance: round2(r.distance!),
          /** Ponto da referência mais próximo com o mesmo valor, ou o centro */
          target: target
            ? { id: String(target.id), lat: target.lat!, lng: target.lng! }
            : r.center
              ? { id: null, lat: r.center.lat, lng: r.center.lng }
              : null,
          sameValue: r.sameValue,
        };
      });
    const noMatch = refPts
      ? results.flatMap((r, i) =>
          r.status === 'noMatch' && pts[i].lat !== null
            ? [{ ...this.ref(pts[i]), value: pts[i].value }]
            : [],
        )
      : [];

    const summary = {
      name: ctx.source.name,
      column: col.name,
      referenceName: refCtx?.source.name ?? null,
      referenceColumn: refCol?.name ?? null,
      total: pts.length,
      withoutCoords: count('noCoords'),
      withoutValue: count('noValue'),
      /** Valores da lista de ignorados (ex.: "SN") */
      ignored: count('ignored'),
      /** Valor não encontrado na referência */
      noMatch: count('noMatch'),
      /** Sem referência: valor com menos pontos que o mínimo */
      fewPoints: count('fewPoints'),
      evaluated: count('ok') + count('far'),
      far: far.length,
      truncated: far.length > MAX_POINTS || noMatch.length > MAX_POINTS,
      durationMs: Date.now() - started,
    };
    this.logger.log({ event: 'attribute-distance', layer: req.layer.sourceId, ...summary });
    return { summary, points: far.slice(0, MAX_POINTS), noMatch: noMatch.slice(0, MAX_POINTS) };
  }

  private ref(p: Loaded): PointRef {
    return { id: String(p.id), x: p.x!, y: p.y!, lat: p.lat!, lng: p.lng! };
  }

  private column(ctx: SourceContext, name: string): ColumnMeta {
    const c = ctx.colMap.get(name);
    if (!c) throw new BadRequestException(`Coluna "${name}" não existe em ${ctx.source.name}`);
    if (c.kind === 'geometry')
      throw new BadRequestException(`Coluna geométrica não suportada: ${name}`);
    return c;
  }

  /** ID, coordenadas (lat/lng) e o valor da coluna pedida. */
  private async load(
    ctx: SourceContext,
    filters: FilterDef[],
    col: ColumnMeta | null,
  ): Promise<Loaded[]> {
    const params = new Params();
    const conds = buildFilterConditions(filters, ctx.colMap, params);
    const where = conds.length ? `WHERE ${conds.map((c) => `(${c})`).join(' AND ')}` : '';
    const select = [
      selectExpr(ctx.idCol, '__id'),
      `${ctx.xExpr} AS "__x"`,
      `${ctx.yExpr} AS "__y"`,
      ...(col ? [selectExpr(col, '__v')] : []),
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
        value: col ? normalizeDb(r.__v, col.kind) : null,
      };
    });
  }
}
