declare module 'shpjs' {
  type Buf = ArrayBuffer | ArrayBufferView;
  /** Lê um shapefile (.zip, ou partes .shp/.dbf/.prj/.cpg) e devolve GeoJSON em WGS84 (usando o .prj). */
  export default function shp(input: Buf | { shp: Buf; dbf?: Buf; prj?: string; cpg?: string }): Promise<unknown>;
}
