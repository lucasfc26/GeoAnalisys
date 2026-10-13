import type { CrsDef } from '@/types';
import { displayCoords } from '@/lib/coords';
import { fmtCoord, fmtDeg } from '@/utils/format';

interface Props {
  point: { x: number | null; y: number | null; lat: number | null; lng: number | null };
  crs: CrsDef | undefined;
  /** Nomes das colunas de X/Y da tabela (mostrados quando a camada é UTM) */
  xColumn?: string;
  yColumn?: string;
}

/**
 * Sempre UTM X/Y e latitude/longitude: em camadas UTM o X/Y vem da tabela; nas demais (lat/lng ou
 * outro sistema) é calculado na zona UTM do ponto.
 */
export function CoordinateGrid({ point, crs, xColumn, yColumn }: Props) {
  const c = displayCoords(point, crs);
  const note = (col?: string) =>
    c.computed ? (c.zone ? `calculado, zona ${c.zone}` : 'calculado') : col;
  const xNote = note(xColumn);
  const yNote = note(yColumn);
  return (
    <>
      <div>
        <dt className="text-slate-500">
          UTM X {xNote && <span className="text-slate-400">({xNote})</span>}
        </dt>
        <dd className="font-mono text-slate-800">{fmtCoord(c.utmX)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">
          UTM Y {yNote && <span className="text-slate-400">({yNote})</span>}
        </dt>
        <dd className="font-mono text-slate-800">{fmtCoord(c.utmY)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Latitude</dt>
        <dd className="font-mono text-slate-800">{fmtDeg(c.lat)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Longitude</dt>
        <dd className="font-mono text-slate-800">{fmtDeg(c.lng)}</dd>
      </div>
    </>
  );
}
