import { describe, expect, it } from 'vitest';
import { readBoundaryFiles } from '@/lib/boundaries';

const UTM24S =
  'PROJCS["SIRGAS_2000_UTM_Zone_24S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],' +
  'PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-39.0],PARAMETER["Scale_Factor",0.9996],' +
  'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
const PROJ4_UTM24S = '+proj=utm +zone=24 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

/** Shapefile mínimo (.shp) com um polígono (anel de 5 pontos). */
function polygonShp(ring: [number, number][]) {
  const content = 4 + 32 + 4 + 4 + 4 + 16 * ring.length;
  const buf = new ArrayBuffer(100 + 8 + content);
  const v = new DataView(buf);
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  v.setInt32(0, 9994);
  v.setInt32(24, buf.byteLength / 2);
  v.setInt32(28, 1000, true);
  v.setInt32(32, 5, true);
  box.forEach((n, i) => v.setFloat64(36 + i * 8, n, true));
  v.setInt32(100, 1);
  v.setInt32(104, content / 2);
  let o = 108;
  v.setInt32(o, 5, true);
  box.forEach((n, i) => v.setFloat64(o + 4 + i * 8, n, true));
  o += 36;
  v.setInt32(o, 1, true);
  v.setInt32(o + 4, ring.length, true);
  v.setInt32(o + 8, 0, true);
  o += 12;
  for (const [x, y] of ring) {
    v.setFloat64(o, x, true);
    v.setFloat64(o + 8, y, true);
    o += 16;
  }
  return buf;
}

const RING: [number, number][] = [
  [550000, 9585000],
  [551000, 9585000],
  [551000, 9586000],
  [550000, 9586000],
  [550000, 9585000],
];

describe('readBoundaryFiles', () => {
  it('lê .shp + .prj (UTM 24S) e converte para lat/lng', async () => {
    const files = [new File([polygonShp(RING)], 'limite.shp'), new File([UTM24S], 'limite.prj')];
    const [b] = await readBoundaryFiles(files, null);
    expect(b.name).toBe('limite');
    expect(b.reprojected).toBe(false);
    expect(b.data.features).toHaveLength(1);
    expect(b.bounds!.minLat).toBeCloseTo(-3.76, 1);
    expect(b.bounds!.minLng).toBeCloseTo(-38.55, 1);
  });

  it('sem .prj usa o CRS de fallback; sem fallback, explica o erro', async () => {
    const shp = () => [new File([polygonShp(RING)], 'semprj.shp')];
    await expect(readBoundaryFiles(shp(), null)).rejects.toThrow(/\.prj/);
    const [b] = await readBoundaryFiles(shp(), PROJ4_UTM24S);
    expect(b.reprojected).toBe(true);
    expect(b.bounds!.maxLat).toBeLessThan(0);
    expect(b.bounds!.maxLng).toBeGreaterThan(-39);
  });

  it('lê GeoJSON em lat/lng', async () => {
    const gj = { type: 'Polygon', coordinates: [[[-38.5, -3.7], [-38.4, -3.7], [-38.4, -3.6], [-38.5, -3.7]]] };
    const [b] = await readBoundaryFiles([new File([JSON.stringify(gj)], 'area.geojson')], null);
    expect(b.data.features).toHaveLength(1);
    expect(b.bounds).toEqual({ minLat: -3.7, maxLat: -3.6, minLng: -38.5, maxLng: -38.4 });
  });
});
