import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { newLayer } from '@/lib/layers';
import {
  dropNode,
  moveToGroup,
  newGroupId,
  stepNode,
  syncTree,
  ungroup,
  type DropWhere,
  type TreeRef,
} from '@/lib/layerTree';
import {
  SELECT_TOOLS,
  type Basemap,
  type BoundaryLayer,
  type CustomBasemap,
  type Bounds,
  type FilterDef,
  type LatLng,
  type LayerStyle,
  type LayerTreeNode,
  type SelectTool,
  type SelectedGroup,
  type Tool,
  type TransformMode,
} from '@/types';

/** Janela flutuante presa a uma camada ("Selecionar por valor" ou "Modo lista"). */
export interface SearchWindow {
  id: string;
  sourceId: string;
}

const windowId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

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
  /** Painel de camadas: grupos (pastas) e camadas soltas; achatada = ordem de `layers` */
  layerTree: LayerTreeNode[];
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
  /** Janelas do modo lista: várias, cada uma presa à camada em que foi aberta */
  listWindows: SearchWindow[];
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
    /** 'new': abre direto no formulário de nova fonte (Adicionar › Camada › Banco de dados) */
    source: boolean | 'new' | { edit: string };
    /** Camadas › Sobre: origem da camada ou do limite */
    layerAbout: TreeRef | { kind: 'boundary'; id: string } | null;
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
    /** Ferramentas › Associar Camadas */
    associate: boolean;
    /** Sobre › Atalhos */
    shortcuts: boolean;
  };

  /** Torna a fonte a camada ativa (e a adiciona ao mapa, se preciso). */
  setSource: (id: string | null) => void;
  addLayer: (id: string) => void;
  removeLayer: (id: string) => void;
  updateLayer: (
    id: string,
    patch: Partial<LayerStyle> | ((l: LayerStyle) => Partial<LayerStyle>),
  ) => void;
  /** Setas: sobe/desce a camada ou o grupo dentro do mesmo nível */
  moveLayer: (id: string, delta: -1 | 1, kind?: TreeRef['kind']) => void;
  /** Arrastar e soltar no painel de camadas */
  dropLayer: (drag: TreeRef, target: TreeRef, where: DropWhere) => void;
  /** Novo grupo no topo; devolve o id */
  addGroup: (name: string) => string;
  updateGroup: (id: string, patch: { name?: string; expanded?: boolean }) => void;
  /** Desfaz o grupo (as camadas ficam) */
  removeGroup: (id: string) => void;
  /** Põe a camada no grupo (null = fora de grupos) */
  setLayerGroup: (layerId: string, groupId: string | null) => void;
  moveBoundary: (id: string, delta: -1 | 1) => void;
  /** Arrastar e soltar um limite antes/depois de outro */
  dropBoundary: (dragId: string, targetId: string, where: 'before' | 'after') => void;
  setTool: (tool: Tool) => void;
  setTransform: (mode: TransformMode | null) => void;
  openListWindow: (sourceId: string) => void;
  closeListWindow: (id: string) => void;
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
  layerAbout: null,
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
  associate: false,
  shortcuts: false,
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
      layerTree: [],
      layerFilters: {},
      selection: {},
      primaryIds: null,
      activeKey: null,
      activeRecordId: null,
      transform: null,
      listWindows: [],
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
              ? syncTree([newLayer(id, s.layers.length), ...s.layers], s.layerTree)
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
            ...syncTree(layers, s.layerTree),
            ...noSelection,
          };
        }),

      addLayer: (id) =>
        set((s) => {
          if (s.layers.some((l) => l.sourceId === id)) return {};
          const tree = syncTree([newLayer(id, s.layers.length), ...s.layers], s.layerTree);
          // Primeira camada vira a ativa.
          return s.sourceId
            ? tree
            : { ...tree, sourceId: id, filters: s.layerFilters[id] ?? [], ...noSelection };
        }),

      removeLayer: (id) =>
        set((s) => {
          const tree = syncTree(
            s.layers.filter((l) => l.sourceId !== id),
            s.layerTree,
          );
          const { layers } = tree;
          // Janelas de pesquisa e do modo lista da camada removida fecham junto.
          const searchWindows = s.searchWindows.filter((w) => w.sourceId !== id);
          const listWindows = s.listWindows.filter((w) => w.sourceId !== id);
          if (s.sourceId !== id) return { ...tree, searchWindows, listWindows };
          const next = layers[0]?.sourceId ?? null;
          const layerFilters = { ...s.layerFilters, [id]: s.filters };
          return {
            ...tree,
            searchWindows,
            listWindows,
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

      moveLayer: (id, delta, kind = 'layer') =>
        set((s) => {
          const { layers, layerTree } = syncTree(s.layers, s.layerTree);
          return syncTree(layers, stepNode(layerTree, { kind, id }, delta));
        }),

      dropLayer: (drag, target, where) =>
        set((s) => {
          const { layers, layerTree } = syncTree(s.layers, s.layerTree);
          return syncTree(layers, dropNode(layerTree, drag, target, where));
        }),

      addGroup: (name) => {
        const id = newGroupId();
        set((s) => {
          const { layers, layerTree } = syncTree(s.layers, s.layerTree);
          return syncTree(layers, [
            { kind: 'group', id, name, expanded: true, children: [] },
            ...layerTree,
          ]);
        });
        return id;
      },

      updateGroup: (id, patch) =>
        set((s) => ({
          layerTree: s.layerTree.map((n) =>
            n.kind === 'group' && n.id === id ? { ...n, ...patch } : n,
          ),
        })),

      removeGroup: (id) =>
        set((s) => {
          const { layers, layerTree } = syncTree(s.layers, s.layerTree);
          return syncTree(layers, ungroup(layerTree, id));
        }),

      setLayerGroup: (layerId, groupId) =>
        set((s) => {
          const { layers, layerTree } = syncTree(s.layers, s.layerTree);
          return syncTree(layers, moveToGroup(layerTree, layerId, groupId));
        }),

      moveBoundary: (id, delta) =>
        set((s) => {
          const i = s.boundaries.findIndex((b) => b.id === id);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= s.boundaries.length) return {};
          const boundaries = [...s.boundaries];
          [boundaries[i], boundaries[j]] = [boundaries[j], boundaries[i]];
          return { boundaries };
        }),

      dropBoundary: (dragId, targetId, where) =>
        set((s) => {
          const item = s.boundaries.find((b) => b.id === dragId);
          if (!item || dragId === targetId) return {};
          const rest = s.boundaries.filter((b) => b.id !== dragId);
          const i = rest.findIndex((b) => b.id === targetId);
          if (i < 0) return {};
          rest.splice(where === 'after' ? i + 1 : i, 0, item);
          return { boundaries: rest };
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
      openListWindow: (sourceId) =>
        set((s) => ({ listWindows: [...s.listWindows, { id: windowId(), sourceId }] })),
      closeListWindow: (id) =>
        set((s) => ({ listWindows: s.listWindows.filter((w) => w.id !== id) })),
      openSearchWindow: (sourceId) =>
        set((s) => ({
          searchWindows: [...s.searchWindows, { id: windowId(), sourceId }],
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
        layerTree: s.layerTree,
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
  'layerTree',
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
