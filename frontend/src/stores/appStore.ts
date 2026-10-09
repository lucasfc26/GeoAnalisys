import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { newLayer } from '@/lib/layers';
import {
  SELECT_TOOLS,
  type Basemap,
  type BoundaryLayer,
  type CustomBasemap,
  type Bounds,
  type FilterDef,
  type LatLng,
  type LayerStyle,
  type SelectTool,
  type SelectedGroup,
  type Tool,
  type TransformMode,
} from '@/types';

/** Janela "Selecionar por valor" de uma camada. */
export interface SearchWindow {
  id: string;
  sourceId: string;
}

export type FormState =
  { mode: 'create'; initial?: Record<string, unknown> } | { mode: 'edit'; id: string } | null;

export interface MapFocus {
  bounds?: Bounds;
  center?: LatLng;
  zoom?: number;
  /** Pisca o centro ao chegar (ex.: coordenada digitada na busca) */
  flash?: boolean;
  nonce: number;
}

interface AppState {
  /** Camada ativa: alvo da seleção, filtros, busca, edição e exportação */
  sourceId: string | null;
  tool: Tool;
  /** Última ferramenta de seleção usada (a que aparece no botão do grupo) */
  lastSelectTool: SelectTool;
  /** Filtros da camada ativa */
  filters: FilterDef[];
  /** Camadas no mapa (índice 0 = topo, desenhada por cima) */
  layers: LayerStyle[];
  /** Filtros guardados de cada camada */
  layerFilters: Record<string, FilterDef[]>;
  /** Seleção: coordenada -> registros */
  selection: Record<string, SelectedGroup>;
  /**
   * Registros "principais" da seleção (ex.: os comparados no modo lista); os demais registros das
   * mesmas coordenadas aparecem em cinza no painel. null = todos iguais.
   */
  primaryIds: string[] | null;
  /** Coordenada em foco no painel (quando há várias selecionadas) */
  activeKey: string | null;
  /** Registro aberto no painel */
  activeRecordId: string | null;
  /** Mover/duplicar a seleção arrastando no mapa (null = desligado) */
  transform: TransformMode | null;
  /** Painel do modo lista aberto */
  listMode: boolean;
  /** Janelas "Selecionar por valor" abertas (várias, cada uma na sua camada) */
  searchWindows: SearchWindow[];
  /** Mapa de fundo */
  basemap: Basemap;
  /** Fundos adicionados por URL (XYZ) */
  customBasemaps: CustomBasemap[];
  /** Camadas de limites (só metadados; as geometrias ficam no IndexedDB) */
  boundaries: BoundaryLayer[];
  focus: MapFocus | null;
  panelOpen: boolean;
  /** Desktop: painel da direita recolhido (só a faixa para reabrir) */
  panelCollapsed: boolean;
  /** Desktop: largura do painel da direita (px) */
  panelWidth: number;
  /** Desktop: altura do painel fixo (px); null = altura toda (o mapa fica ao lado) */
  panelHeight: number | null;
  /** Desktop: painel como janela móvel sobre o mapa */
  panelFloating: boolean;
  /** Posição e tamanho da janela móvel (px, na janela do navegador) */
  panelFloat: { x: number; y: number; w: number; h: number } | null;
  /** Colunas do resumo da seleção, por camada (vazio = coluna de categoria da fonte) */
  summaryColumns: Record<string, string[]>;
  /** Último modelo de exportação usado, por camada */
  exportTemplates: Record<string, string>;
  /** Ordem dos campos no painel de informações, por camada (só visual; o banco não muda) */
  fieldOrder: Record<string, string[]>;
  dialogs: {
    source: boolean;
    export: boolean;
    bulkEdit: boolean;
    filters: boolean;
    form: FormState;
    confirmDelete: { ids: string[] } | null;
    layerStyle: { sourceId: string; tab: 'symbology' | 'labels' } | null;
    /** Tabela de Alterações */
    changes: boolean;
    /** Importar CSV/XLSX/GeoJSON/KML como camada */
    importLayer: boolean;
    /** Copiar os pontos selecionados para uma nova camada */
    copyToLayer: boolean;
    /** Criar mapa HTML (Comitê / Status 18) */
    mapMaker: boolean;
  };

  /** Torna a fonte a camada ativa (e a adiciona ao mapa, se preciso). */
  setSource: (id: string | null) => void;
  addLayer: (id: string) => void;
  removeLayer: (id: string) => void;
  updateLayer: (
    id: string,
    patch: Partial<LayerStyle> | ((l: LayerStyle) => Partial<LayerStyle>),
  ) => void;
  moveLayer: (id: string, delta: number) => void;
  setTool: (tool: Tool) => void;
  setTransform: (mode: TransformMode | null) => void;
  setListMode: (open: boolean) => void;
  /** Abre mais uma janela "Selecionar por valor" para a camada */
  openSearchWindow: (sourceId: string) => void;
  closeSearchWindow: (id: string) => void;
  setBasemap: (basemap: Basemap) => void;
  addCustomBasemap: (b: CustomBasemap) => void;
  removeCustomBasemap: (id: string) => void;
  addBoundaries: (items: BoundaryLayer[]) => void;
  updateBoundary: (id: string, patch: Partial<BoundaryLayer>) => void;
  removeBoundary: (id: string) => void;
  setFilters: (filters: FilterDef[]) => void;
  setSelection: (groups: SelectedGroup[], mode?: 'replace' | 'add', primaryIds?: string[]) => void;
  toggleGroup: (group: SelectedGroup) => void;
  clearSelection: () => void;
  removeIds: (ids: string[]) => void;
  openRecord: (key: string | null, id: string | null) => void;
  focusMap: (f: Omit<MapFocus, 'nonce'>) => void;
  setPanelOpen: (open: boolean) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  setPanelWidth: (width: number) => void;
  setPanelHeight: (height: number | null) => void;
  setPanelFloating: (floating: boolean) => void;
  setPanelFloat: (rect: AppState['panelFloat']) => void;
  setSummaryColumns: (sourceId: string, columns: string[]) => void;
  setExportTemplate: (sourceId: string, templateId: string | null) => void;
  /** Ordem dos campos (vazia = ordem da tabela) */
  setFieldOrder: (sourceId: string, order: string[]) => void;
  openDialog: <K extends keyof AppState['dialogs']>(name: K, value: AppState['dialogs'][K]) => void;
  closeDialog: (name: keyof AppState['dialogs']) => void;
}

const closedDialogs: AppState['dialogs'] = {
  source: false,
  export: false,
  bulkEdit: false,
  filters: false,
  form: null,
  confirmDelete: null,
  layerStyle: null,
  changes: false,
  importLayer: false,
  copyToLayer: false,
  mapMaker: false,
};

const noSelection = {
  selection: {},
  activeKey: null,
  activeRecordId: null,
  transform: null,
  primaryIds: null,
};

/** Preferências salvas no navegador. O sistema se chamava "Censo GIS": migra a chave antiga. */
const STORAGE_KEY = 'geoanalisys';
try {
  const old = localStorage.getItem('censo-gis');
  if (old !== null && localStorage.getItem(STORAGE_KEY) === null)
    localStorage.setItem(STORAGE_KEY, old);
  if (old !== null) localStorage.removeItem('censo-gis');
} catch {
  /* sem localStorage (modo privado): preferências só nesta sessão */
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sourceId: null,
      tool: 'select',
      lastSelectTool: 'select',
      filters: [],
      layers: [],
      layerFilters: {},
      selection: {},
      primaryIds: null,
      activeKey: null,
      activeRecordId: null,
      transform: null,
      listMode: false,
      searchWindows: [],
      basemap: 'osm',
      customBasemaps: [],
      boundaries: [],
      focus: null,
      panelOpen: false,
      panelCollapsed: false,
      panelWidth: 384,
      panelHeight: null,
      panelFloating: false,
      panelFloat: null,
      summaryColumns: {},
      exportTemplates: {},
      fieldOrder: {},
      dialogs: closedDialogs,

      setSource: (id) =>
        set((s) => {
          if (id === s.sourceId) {
            return id && !s.layers.some((l) => l.sourceId === id)
              ? { layers: [newLayer(id, s.layers.length), ...s.layers] }
              : {};
          }
          const layerFilters = s.sourceId
            ? { ...s.layerFilters, [s.sourceId]: s.filters }
            : s.layerFilters;
          let layers = s.layers;
          if (id) {
            layers = layers.some((l) => l.sourceId === id)
              ? layers.map((l) => (l.sourceId === id && !l.visible ? { ...l, visible: true } : l))
              : [newLayer(id, layers.length), ...layers];
          }
          return {
            sourceId: id,
            filters: id ? (layerFilters[id] ?? []) : [],
            layerFilters,
            layers,
            ...noSelection,
          };
        }),

      addLayer: (id) =>
        set((s) => {
          if (s.layers.some((l) => l.sourceId === id)) return {};
          const layers = [newLayer(id, s.layers.length), ...s.layers];
          // Primeira camada vira a ativa.
          return s.sourceId
            ? { layers }
            : { layers, sourceId: id, filters: s.layerFilters[id] ?? [], ...noSelection };
        }),

      removeLayer: (id) =>
        set((s) => {
          const layers = s.layers.filter((l) => l.sourceId !== id);
          // Janelas de pesquisa da camada removida fecham junto.
          const searchWindows = s.searchWindows.filter((w) => w.sourceId !== id);
          if (s.sourceId !== id) return { layers, searchWindows };
          const next = layers[0]?.sourceId ?? null;
          const layerFilters = { ...s.layerFilters, [id]: s.filters };
          return {
            layers,
            searchWindows,
            layerFilters,
            sourceId: next,
            filters: next ? (layerFilters[next] ?? []) : [],
            ...noSelection,
          };
        }),

      updateLayer: (id, patch) =>
        set((s) => ({
          layers: s.layers.map((l) =>
            l.sourceId === id ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l,
          ),
        })),

      moveLayer: (id, delta) =>
        set((s) => {
          const i = s.layers.findIndex((l) => l.sourceId === id);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= s.layers.length) return {};
          const layers = [...s.layers];
          [layers[i], layers[j]] = [layers[j], layers[i]];
          return { layers };
        }),

      setTool: (tool) =>
        set((s) => ({
          tool,
          transform: null,
          lastSelectTool: (SELECT_TOOLS as readonly Tool[]).includes(tool)
            ? (tool as SelectTool)
            : s.lastSelectTool,
        })),
      setTransform: (transform) =>
        set((s) => ({
          transform: transform && Object.keys(s.selection).length ? transform : null,
        })),
      setListMode: (listMode) => set({ listMode }),
      openSearchWindow: (sourceId) =>
        set((s) => ({
          searchWindows: [
            ...s.searchWindows,
            {
              id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
              sourceId,
            },
          ],
        })),
      closeSearchWindow: (id) =>
        set((s) => ({ searchWindows: s.searchWindows.filter((w) => w.id !== id) })),
      setBasemap: (basemap) => set({ basemap }),
      addCustomBasemap: (b) =>
        set((s) => ({ customBasemaps: [...s.customBasemaps, b], basemap: `xyz:${b.id}` })),
      removeCustomBasemap: (id) =>
        set((s) => ({
          customBasemaps: s.customBasemaps.filter((b) => b.id !== id),
          basemap: s.basemap === `xyz:${id}` ? 'osm' : s.basemap,
        })),
      addBoundaries: (items) => set((s) => ({ boundaries: [...items, ...s.boundaries] })),
      updateBoundary: (id, patch) =>
        set((s) => ({
          boundaries: s.boundaries.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        })),
      removeBoundary: (id) => set((s) => ({ boundaries: s.boundaries.filter((b) => b.id !== id) })),
      setFilters: (filters) =>
        set((s) => ({
          filters,
          layerFilters: s.sourceId ? { ...s.layerFilters, [s.sourceId]: filters } : s.layerFilters,
        })),

      setSelection: (groups, mode = 'replace', primaryIds) =>
        set((s) => {
          const next: Record<string, SelectedGroup> = mode === 'add' ? { ...s.selection } : {};
          for (const g of groups) next[g.key] = g;
          const keys = Object.keys(next);
          const single = keys.length === 1 ? next[keys[0]] : null;
          // Uma coordenada com um único registro principal: abre esse registro.
          const only =
            single &&
            (single.ids.length === 1
              ? single.ids[0]
              : primaryIds?.length === 1
                ? primaryIds[0]
                : null);
          return {
            selection: next,
            primaryIds: primaryIds?.length ? primaryIds : null,
            activeKey: single ? single.key : null,
            activeRecordId: only ?? null,
            panelOpen: keys.length > 0 ? true : s.panelOpen,
          };
        }),

      toggleGroup: (group) =>
        set((s) => {
          const next = { ...s.selection };
          if (next[group.key]) delete next[group.key];
          else next[group.key] = group;
          const keys = Object.keys(next);
          const single = keys.length === 1 ? next[keys[0]] : null;
          return {
            selection: next,
            primaryIds: null,
            activeKey: single ? single.key : null,
            activeRecordId: single && single.ids.length === 1 ? single.ids[0] : null,
          };
        }),

      clearSelection: () => set(noSelection),

      removeIds: (ids) =>
        set((s) => {
          const remove = new Set(ids);
          const next: Record<string, SelectedGroup> = {};
          for (const [k, g] of Object.entries(s.selection)) {
            const left = g.ids.filter((id) => !remove.has(id));
            if (left.length) next[k] = { ...g, ids: left };
          }
          const primary = s.primaryIds?.filter((id) => !remove.has(id)) ?? null;
          return {
            selection: next,
            primaryIds: primary?.length ? primary : null,
            activeRecordId:
              s.activeRecordId && remove.has(s.activeRecordId) ? null : s.activeRecordId,
            activeKey: s.activeKey && next[s.activeKey] ? s.activeKey : null,
            transform: Object.keys(next).length ? s.transform : null,
          };
        }),

      openRecord: (key, id) => set({ activeKey: key, activeRecordId: id, panelOpen: true }),
      focusMap: (f) => set({ focus: { ...f, nonce: Date.now() } }),
      setPanelOpen: (open) => set({ panelOpen: open }),
      setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
      setPanelWidth: (panelWidth) => set({ panelWidth }),
      setPanelHeight: (panelHeight) => set({ panelHeight }),
      setPanelFloating: (panelFloating) =>
        set(panelFloating ? { panelFloating, panelCollapsed: false } : { panelFloating }),
      setPanelFloat: (panelFloat) => set({ panelFloat }),
      setSummaryColumns: (sourceId, columns) =>
        set((s) => ({ summaryColumns: { ...s.summaryColumns, [sourceId]: columns } })),
      setExportTemplate: (sourceId, templateId) =>
        set((s) => {
          const exportTemplates = { ...s.exportTemplates };
          if (templateId) exportTemplates[sourceId] = templateId;
          else delete exportTemplates[sourceId];
          return { exportTemplates };
        }),
      setFieldOrder: (sourceId, order) =>
        set((s) => {
          const fieldOrder = { ...s.fieldOrder };
          if (order.length) fieldOrder[sourceId] = order;
          else delete fieldOrder[sourceId];
          return { fieldOrder };
        }),
      openDialog: (name, value) => set((s) => ({ dialogs: { ...s.dialogs, [name]: value } })),
      closeDialog: (name) =>
        set((s) => ({ dialogs: { ...s.dialogs, [name]: closedDialogs[name] } })),
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        sourceId: s.sourceId,
        tool: s.tool,
        lastSelectTool: s.lastSelectTool,
        filters: s.filters,
        layers: s.layers,
        layerFilters: s.layerFilters,
        basemap: s.basemap,
        customBasemaps: s.customBasemaps,
        boundaries: s.boundaries,
        panelCollapsed: s.panelCollapsed,
        panelWidth: s.panelWidth,
        panelHeight: s.panelHeight,
        panelFloating: s.panelFloating,
        panelFloat: s.panelFloat,
        summaryColumns: s.summaryColumns,
        exportTemplates: s.exportTemplates,
        fieldOrder: s.fieldOrder,
      }),
    },
  ),
);

/**
 * Partes do estado que pertencem ao projeto (.proj). O layout do painel fica fora: é preferência
 * da máquina, não do projeto.
 */
export const PROJECT_KEYS = [
  'sourceId',
  'tool',
  'lastSelectTool',
  'filters',
  'layers',
  'layerFilters',
  'basemap',
  'customBasemaps',
  'boundaries',
  'summaryColumns',
  'exportTemplates',
  'fieldOrder',
] as const satisfies readonly (keyof AppState)[];

export type ProjectState = Pick<AppState, (typeof PROJECT_KEYS)[number]>;

export function projectStateOf(s: Partial<AppState>): Partial<ProjectState> {
  const out: Partial<ProjectState> = {};
  for (const k of PROJECT_KEYS) {
    if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}

/** IDs de todos os registros selecionados (memoizar no componente). */
export function selectedIdsOf(selection: Record<string, SelectedGroup>): string[] {
  const out: string[] = [];
  for (const g of Object.values(selection)) out.push(...g.ids);
  return out;
}
