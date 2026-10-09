/**
 * Catálogo de sistemas de referência suportados. As definições proj4 seguem o epsg.io.
 * A zona/hemisfério/datum são sempre explícitos: o sistema nunca "adivinha" a zona pelos valores.
 */
export interface CrsDef {
  code: string;
  name: string;
  datum: string;
  kind: 'utm' | 'geographic' | 'projected';
  zone?: number;
  hemisphere?: 'N' | 'S';
  proj4: string;
}

const DATUMS = {
  SIRGAS2000: { label: 'SIRGAS 2000', params: '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0' },
  SAD69: { label: 'SAD69', params: '+ellps=aust_SA +towgs84=-57,1,-41,0,0,0,0' },
  CORREGO: { label: 'Córrego Alegre 1970-72', params: '+ellps=intl +towgs84=-205.57,168.77,-4.12,0,0,0,0' },
  WGS84: { label: 'WGS 84', params: '+datum=WGS84' },
} as const;

function utm(code: number, datum: keyof typeof DATUMS, zone: number, hemisphere: 'N' | 'S'): CrsDef {
  const d = DATUMS[datum];
  return {
    code: `EPSG:${code}`,
    name: `${d.label} / UTM zone ${zone}${hemisphere}`,
    datum: d.label,
    kind: 'utm',
    zone,
    hemisphere,
    proj4: `+proj=utm +zone=${zone}${hemisphere === 'S' ? ' +south' : ''} ${d.params} +units=m +no_defs`,
  };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export const CRS_CATALOG: CrsDef[] = [
  // SIRGAS 2000 (padrão oficial no Brasil)
  ...range(17, 25).map((z) => utm(31977 + (z - 17), 'SIRGAS2000', z, 'S')),
  ...range(11, 22).map((z) => utm(31965 + (z - 11), 'SIRGAS2000', z, 'N')),
  // SAD69
  ...range(17, 25).map((z) => utm(29187 + (z - 17), 'SAD69', z, 'S')),
  ...range(18, 22).map((z) => utm(29168 + (z - 18), 'SAD69', z, 'N')),
  // Córrego Alegre
  ...range(21, 25).map((z) => utm(22521 + (z - 21), 'CORREGO', z, 'S')),
  // WGS 84 / UTM (todas as zonas)
  ...range(1, 60).map((z) => utm(32700 + z, 'WGS84', z, 'S')),
  ...range(1, 60).map((z) => utm(32600 + z, 'WGS84', z, 'N')),
  // Geográficos (quando as colunas já são longitude/latitude)
  {
    code: 'EPSG:4674',
    name: 'SIRGAS 2000 (geográfico lon/lat)',
    datum: 'SIRGAS 2000',
    kind: 'geographic',
    proj4: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs',
  },
  {
    code: 'EPSG:4326',
    name: 'WGS 84 (geográfico lon/lat)',
    datum: 'WGS 84',
    kind: 'geographic',
    proj4: '+proj=longlat +datum=WGS84 +no_defs',
  },
];

export const CUSTOM_CRS = 'CUSTOM';
