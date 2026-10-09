import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SourcesService } from '../tables/sources.service';
import { PointsService } from '../points/points.service';
import { FilterDef } from '../../common/filters';
import { LatLng, coordKey, pointInPolygon, polygonBounds } from '../../common/geo';
import { Params, coordRange, qi } from '../../common/sql';

const MAX_SELECTED_RECORDS = 200_000;

/** Seleção espacial (retângulo/polígono) feita no backend sobre as coordenadas originais. */
@Injectable()
export class SelectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly points: PointsService,
  ) {}

  async byPolygon(sourceId: string, polygon: LatLng[], filters: FilterDef[]) {
    const ctx = await this.sources.context(sourceId);
    const bounds = polygonBounds(polygon);
    const xy = ctx.crs.boundsToXY(bounds);
    if (!xy) return { count: 0, truncated: false, groups: [] };

    const params = new Params();
    const where = this.points.where(ctx, params, filters, [
      coordRange(ctx.xCol, params, xy.minX, xy.maxX),
      coordRange(ctx.yCol, params, xy.minY, xy.maxY),
    ]);
    const id = qi(ctx.idCol.name);
    const rows = await this.prisma.$queryRawUnsafe<{ x: number; y: number; ids: string[] }[]>(
      `SELECT x, y, array_agg(id ORDER BY id) AS ids
         FROM (SELECT ${ctx.xExpr} AS x, ${ctx.yExpr} AS y, ${id}::text AS id FROM ${ctx.table} ${where}
                LIMIT ${MAX_SELECTED_RECORDS * 2}) s
        GROUP BY x, y`,
      ...params.values,
    );

    const groups: { key: string; x: number; y: number; lat: number; lng: number; count: number; ids: string[] }[] = [];
    let count = 0;
    let truncated = false;
    for (const r of rows) {
      const ll = ctx.crs.toLatLng(r.x, r.y);
      if (!ll || !pointInPolygon(ll, polygon)) continue;
      if (count + r.ids.length > MAX_SELECTED_RECORDS) {
        truncated = true;
        break;
      }
      count += r.ids.length;
      groups.push({ key: coordKey(r.x, r.y), x: r.x, y: r.y, ...ll, count: r.ids.length, ids: r.ids });
    }
    return { count, truncated, groups };
  }
}
