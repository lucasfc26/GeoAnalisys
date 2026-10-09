export type ColumnKind =
  'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'text' | 'json' | 'geometry' | 'other';

export interface ColumnMeta {
  name: string;
  formatType: string;
  udtName: string;
  kind: ColumnKind;
  nullable: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  isGenerated: boolean;
  isNumeric: boolean;
  readOnly: boolean;
  position: number;
}

export interface CrsDef {
  code: string;
  name: string;
  datum: string;
  kind: 'utm' | 'geographic' | 'projected';
  zone?: number;
  hemisphere?: 'N' | 'S';
  proj4: string;
}

export interface DataSource {
  id: string;
  name: string;
  database: string;
  schema: string;
  tableName: string;
  idColumn: string;
  xColumn: string;
  yColumn: string;
  coordinateSystem: string;
  proj4: string | null;
  labelColumn: string | null;
  categoryColumn: string | null;
  geometryColumn: string | null;
  searchColumns: string[];
  createdAt: string;
  updatedAt: string;
}

export type SourceConfig = Omit<DataSource, 'id' | 'database' | 'createdAt' | 'updatedAt'>;

export interface SourceSchema {
  source: DataSource;
  crs: CrsDef;
  columns: ColumnMeta[];
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapGroup {
  key: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
  count: number;
  ids: string[] | null;
  label: string | null;
  /** Rótulos de cada registro do grupo (quando há vários e poucos o bastante) */
  labels?: (string | null)[] | null;
  category: string | null;
}

export interface MapCluster {
  lat: number;
  lng: number;
  count: number;
  bounds: Bounds | null;
}

export interface MapPointsResponse {
  mode: 'points' | 'clusters';
  total: number;
  groups: MapGroup[];
  clusters: MapCluster[];
  truncated: boolean;
}

export interface PointRecord {
  id: string;
  x: number | null;
  y: number | null;
  lat: number | null;
  lng: number | null;
  data: Record<string, unknown>;
}

export interface AtResponse {
  key: string;
  x: number;
  y: number;
  lat: number | null;
  lng: number | null;
  count: number;
  ids: string[];
  records: PointRecord[];
}

/** Grupo selecionado: uma coordenada com um ou mais registros. */
export interface SelectedGroup {
  key: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
  ids: string[];
}

export interface SelectionResponse {
  count: number;
  truncated: boolean;
  groups: (SelectedGroup & { count: number })[];
}

/** Mapa de fundo: 'osm' | 'satellite' | 'hybrid' | 'none' ou `xyz:<id>` (adicionado por URL). */
export type Basemap = string;

/** Mapa de fundo adicionado pelo usuário a partir de uma URL de tiles XYZ (como no QGIS). */
export interface CustomBasemap {
  id: string;
  name: string;
  url: string;
  /** Último zoom com imagens no servidor */
  maxZoom: number;
}

/** Camada de limites (polígonos importados de shapefile/GeoJSON), desenhada só com as bordas. */
export interface BoundaryLayer {
  id: string;
  name: string;
  color: string;
  /** Espessura da borda (px) */
  width: number;
  visible: boolean;
  features: number;
  bounds: Bounds | null;
}

/** Mover ou duplicar os pontos selecionados arrastando-os no mapa. */
export type TransformMode = 'move' | 'copy';

export interface TranslateResponse {
  count: number;
  /** Deslocamento aplicado, nas unidades do CRS da fonte */
  dx: number;
  dy: number;
  groups: (SelectedGroup & { count: number })[];
}

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'isNull'
  | 'notNull';

export interface FilterDef {
  column: string;
  op: FilterOp;
  value?: unknown;
  values?: unknown[];
  /** Texto: true diferencia maiúsculas, false ignora; ausente = padrão do operador */
  caseSensitive?: boolean;
}

/** Resultado de "Selecionar por valor". */
export interface QueryResponse {
  count: number;
  truncated: boolean;
  bounds: Bounds | null;
  groups: SelectedGroup[];
}

export interface SearchResult {
  id: string;
  label: string | null;
  x: number;
  y: number;
  key: string;
  lat: number | null;
  lng: number | null;
  match: { column: string; value: string | null } | null;
}

export interface SourceTestResult {
  ok: boolean;
  crs: CrsDef;
  total: number;
  validCoordinates: number;
  distinctIds: number;
  extent: Bounds | null;
  indexes: { hasIndex: boolean; hasIdIndex: boolean };
  warnings: string[];
  preview: PointRecord[];
}

export interface TableInfo {
  name: string;
  type: string;
  estimatedRows: number;
  hasPrimaryKey: boolean;
}

export type Tool =
  'pan' | 'select' | 'multi' | 'rectangle' | 'polygon' | 'add' | 'measure' | 'streetview';

/** Ferramentas agrupadas no botão de seleção (segurar para escolher). */
export type SelectTool = 'select' | 'multi' | 'rectangle' | 'polygon';
export const SELECT_TOOLS: readonly SelectTool[] = ['select', 'multi', 'rectangle', 'polygon'];

/** Camada inteira em formato colunar (só ID, posição, categoria e rótulo). */
export interface LayerPayloadFull {
  mode: 'full';
  version: string | null;
  total: number;
  ids: string[];
  x: number[];
  y: number[];
  lat: number[];
  lng: number[];
  cats: (string | null)[] | null;
  cat: number[] | null;
  labels: (string | null)[] | null;
}

export interface LayerPayloadTooLarge {
  mode: 'tooLarge';
  version: string | null;
  total: number;
  limit: number;
}

export type LayerPayload =
  LayerPayloadFull | LayerPayloadTooLarge | { mode: 'unchanged'; version: string };

export interface CategoryStyle {
  color: string;
  size: number;
  visible: boolean;
}

export interface LabelStyle {
  enabled: boolean;
  /** Expressão estilo QGIS: "ID" || ' ' || "medicao" (vazia = sem rótulo) */
  expression: string;
  size: number;
  color: string;
  bold: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Nome da fonte (LABEL_FONTS; padrão: Arial) */
  font?: string;
  /** Contorno em volta do texto */
  buffer: boolean;
  /** Cor do contorno do texto (padrão: DEFAULT_BUFFER_COLOR) */
  bufferColor?: string;
  /** Espessura do contorno do texto, em px (padrão: DEFAULT_BUFFER_WIDTH) */
  bufferWidth?: number;
  /** Zoom mínimo para exibir os rótulos */
  minZoom: number;
  /** Rótulos por coordenada quando há vários registros no mesmo ponto (padrão: 1) */
  maxPerPoint?: number;
}

/** Versão salva da configuração de rótulos de uma camada (alternável num seletor). */
export interface LabelTemplate {
  id: string;
  name: string;
  label: LabelStyle;
}

/** Configuração visual de uma camada (fonte de dados) no mapa. */
export interface LayerStyle {
  sourceId: string;
  visible: boolean;
  expanded: boolean;
  /** Símbolo único (e padrão das categorias) */
  color: string;
  size: number;
  opacity: number;
  /** Contorno dos pontos (padrão: ligado) */
  outline?: boolean;
  /** Cor do contorno dos pontos (padrão: DEFAULT_OUTLINE_COLOR) */
  outlineColor?: string;
  /** Espessura do contorno dos pontos, em px (padrão: DEFAULT_OUTLINE_WIDTH) */
  outlineWidth?: number;
  /** Coluna para categorizar; undefined = coluna de categoria da fonte; null = símbolo único */
  styleColumn?: string | null;
  /** Estilo por valor da coluna (chave: valor ou NULL_KEY) */
  categories: Record<string, CategoryStyle>;
  /** Rótulo em uso (é o conteúdo do template ativo, quando houver templates) */
  label: LabelStyle;
  /** Versões salvas dos rótulos */
  labelTemplates?: LabelTemplate[];
  /** Template em uso (id em labelTemplates) */
  activeLabelTemplate?: string | null;
}
