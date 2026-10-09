import { BadRequestException, Injectable } from '@nestjs/common';
import proj4 from 'proj4';
import { LatLng, LatLngBounds } from '../../common/geo';
import { CRS_CATALOG, CUSTOM_CRS, CrsDef } from './crs.catalog';

export interface XYBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface CrsHandle {
  def: CrsDef;
  /** Faixa de valores válidos para X/Y nesse CRS. */
  validRange: XYBounds;
  isValid(x: number, y: number): boolean;
  toLatLng(x: number, y: number): LatLng | null;
  toXY(lat: number, lng: number): { x: number; y: number } | null;
  /** Retângulo X/Y que contém todo o retângulo lat/lng (amostra as bordas). */
  boundsToXY(b: LatLngBounds): XYBounds | null;
}

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

@Injectable()
export class CrsService {
  private readonly byCode = new Map(CRS_CATALOG.map((c) => [c.code, c]));
  private readonly cache = new Map<string, CrsHandle>();

  list(): CrsDef[] {
    return CRS_CATALOG;
  }

  /** Resolve e valida o CRS de uma fonte de dados. */
  resolve(code: string, customProj4?: string | null): CrsHandle {
    const cacheKey = code === CUSTOM_CRS ? `${code}:${customProj4}` : code;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let def: CrsDef | undefined;
    if (code === CUSTOM_CRS) {
      if (!customProj4?.trim()) throw new BadRequestException('Informe a definição proj4 do CRS personalizado');
      const isGeo = /\+proj=longlat/.test(customProj4);
      const zone = /\+zone=(\d+)/.exec(customProj4)?.[1];
      def = {
        code: CUSTOM_CRS,
        name: 'Personalizado',
        datum: 'personalizado',
        kind: isGeo ? 'geographic' : /\+proj=utm/.test(customProj4) ? 'utm' : 'projected',
        zone: zone ? Number(zone) : undefined,
        hemisphere: /\+south/.test(customProj4) ? 'S' : 'N',
        proj4: customProj4.trim(),
      };
    } else {
      def = this.byCode.get(code);
    }
    if (!def) throw new BadRequestException(`Sistema de coordenadas não suportado: ${code}`);

    let converter: proj4.Converter;
    try {
      converter = proj4(def.proj4, WGS84);
      converter.forward([500000, 1000000]);
    } catch (err) {
      throw new BadRequestException(`Definição de CRS inválida: ${(err as Error).message}`);
    }

    const validRange: XYBounds =
      def.kind === 'utm'
        ? { minX: 1, maxX: 999_999, minY: 0, maxY: 10_000_000 }
        : def.kind === 'geographic'
          ? { minX: -180, maxX: 180, minY: -90, maxY: 90 }
          : { minX: -1e8, maxX: 1e8, minY: -1e8, maxY: 1e8 };

    const isValid = (x: number, y: number) =>
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= validRange.minX &&
      x <= validRange.maxX &&
      y >= validRange.minY &&
      y <= validRange.maxY;

    const handle: CrsHandle = {
      def,
      validRange,
      isValid,
      toLatLng(x, y) {
        if (!isValid(x, y)) return null;
        const [lng, lat] = converter.forward([x, y]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          return null;
        }
        return { lat, lng };
      },
      toXY(lat, lng) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const [x, y] = converter.inverse([lng, lat]);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      },
      boundsToXY(b) {
        const steps = 8;
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = 0; i <= steps; i++) {
          for (let j = 0; j <= steps; j++) {
            // Bordas + grade interna: cobre a curvatura da projeção.
            const lat = b.minLat + ((b.maxLat - b.minLat) * i) / steps;
            const lng = b.minLng + ((b.maxLng - b.minLng) * j) / steps;
            const r = handle.toXY(lat, lng);
            if (r) {
              xs.push(r.x);
              ys.push(r.y);
            }
          }
        }
        if (!xs.length) return null;
        return {
          minX: Math.max(validRange.minX, Math.min(...xs)),
          maxX: Math.min(validRange.maxX, Math.max(...xs)),
          minY: Math.max(validRange.minY, Math.min(...ys)),
          maxY: Math.min(validRange.maxY, Math.max(...ys)),
        };
      },
    };
    this.cache.set(cacheKey, handle);
    return handle;
  }
}
