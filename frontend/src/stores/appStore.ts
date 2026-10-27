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
import type { ToolbarSide } from '@/lib/toolbar';
import { isToolbarSide } from '@/lib/toolbar';
import {
  addToolbarBar,
  defaultToolbarLayout,
  groupToolbarItems,
  moveAllToSide,
  moveSide,
  normalizeToolbarLayout,
  insertDivider,
  placeToolbarItem,
  removeDivider,
  removeToolbarBar,
  setGroupCurrent,
  toggleToolbarButton,
  ungroupToolbarItem,
  type ToolbarButtonId,
  type ToolbarLayout,
} from '@/lib/toolbarLayout';
import {
  SELECT_TOOLS,
  type Basemap,
  type BoundaryLayer,
  type BoundarySelection,
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

/** Partes da tela que o menu Exibir mostra/oculta: painel de camadas, mapas de fundo, informações. */
export type ViewPart = 'layers' | 'maps' | 'info';
export type ViewHidden = Record<ViewPart, boolean>;

/** Janela flutuante presa a uma camada ("Selecionar por valor" ou "Modo lista"). */
export interface SearchWindow {
  id: string;
  sourceId: string;
}

/**
 * O que o clique num ponto seleciona: só a camada ativa, a camada de cima naquele local (que vira a
 * ativa) ou os pontos de todas as camadas ali (a de cima vira a ativa; as demais ficam marcadas).
 */
export type ClickTarget = 'active' | 'top' | 'all';

/** Modo lista: percorrer os valores um a um ou selecionar todos os pontos da lista de uma vez. */
export type ListMode = 'walk' | 'all';

export interface ListSeed {
  /** Coluna dos valores (em geral a de ID) */
  column: string;
  values: string[];
}

export interface ListWindow extends SearchWindow {
  /** Modo inicial da janela */
  mode?: ListMode;
  /** Lista já preenchida e localizada ao abrir */
  seed?: ListSeed;
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
  /**
   * Pontos de outras camadas selecionados junto (clique em "todas as camadas"): camada -> coordenada
   * -> registros. Só a camada ativa é editável; estes aparecem marcados no mapa e listados no painel.
   */
  otherSelection: Record<string, Record<string, SelectedGroup>>;
  /** O que o clique num ponto seleciona (preferência da máquina) */
  clickTarget: ClickTarget;
  /** Coordenada em foco no painel (quando há várias selecionadas) */
  activeKey: string | null;
  /** Registro aberto no painel */
  activeRecordId: string | null;
  /** Mover/duplicar a seleção arrastando no mapa (null = desligado) */
  transform: TransformMode | null;
  /** Painel do modo lista aberto */
  /** Janelas do modo lista: várias, cada uma presa à camada em que foi aberta */
  listWindows: ListWindow[];
  /** Janelas "Selecionar por valor" abertas (várias, cada uma na sua camada) */
  searchWindows: SearchWindow[];
  /** Mapa de fundo */
  basemap: Basemap;
  /** Fundos adicionados por URL (XYZ) */
  customBasemaps: CustomBasemap[];
  /** Ordem da lista de fundos (ids; arrastando na lista). Vazia = ordem padrão */
  basemapOrder: string[];
  /** Nomes dados aos fundos padrão (OpenStreetMap, Esri…), só visual */
  basemapNames: Record<string, string>;
  /** Camadas de limites (só metadados; as geometrias ficam no IndexedDB) */
  boundaries: BoundaryLayer[];
  /** Limite escolhido no painel: o clique no mapa consulta as feições dele */
  activeBoundaryId: string | null;
  /** Feição consultada (índice na coleção do limite) */
  boundarySelection: BoundarySelection | null;
  focus: MapFocus | null;
  panelOpen: boolean;
  /** Menu Exibir: partes da tela ocultas (preferência da máquina, fora do projeto) */
  viewHidden: ViewHidden;
  /** Lado da barra de ferramentas nas telas grandes (preferência da máquina, fora do projeto) */
  toolbarSide: ToolbarSide;
  /** Onde cada botão está e quais subdivisões existem (preferência da máquina) */
  toolbarLayout: ToolbarLayout;
  /** Arraste de um botão em andamento: os lados vazios viram alvo */
  toolbarDragging: boolean;
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
    /** `sourceId`: camada dos registros (padrão: a ativa); `observation`: motivo já preenchido */
    confirmDelete: { ids: string[]; sourceId?: string; observation?: string } | null;
    layerStyle: { sourceId: string; tab: 'symbology' | 'labels' } | null;
    /** Tabela de Alterações */
    changes: boolean;
    /** Importar CSV/XLSX/GeoJSON/KML como camada */
    importLayer: boolean;
    /** Copiar os pontos selecionados para uma nova camada */
    copyToLayer: boolean;
    /** Camadas › Converter coordenadas (grava lat/lng ↔ UTM na tabela) */
    convertCoords: { sourceId: string } | null;
    /** Criar mapa HTML (Comitê / Status 18) */
    mapMaker: boolean;
    /** Ferramentas › Associar Camadas */
    associate: boolean;
    /** Ferramentas › Duplicidades */
    duplicates: boolean;
    /** Ferramentas › Fora do limite */
    outsideBoundary: boolean;
    /** Ferramentas › Distância por atributo */
    attributeDistance: boolean;
    /** Duplicar selecionados: na camada atual (arrastar) ou em outra camada (pareando atributos) */
    duplicate: boolean;
    /** Ferramentas › Quadro Comparativo */
    comparison: boolean;
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
  /** Ativa um limite para consultar feições no mapa (null encerra a consulta) */
  setActiveBoundary: (id: string | null) => void;
  /** Feição do limite ativo sob o clique; null limpa só a feição */
  setBoundarySelection: (selection: BoundarySelection | null) => void;
  setTool: (tool: Tool) => void;
  setTransform: (mode: TransformMode | null) => void;
  openListWindow: (sourceId: string, mode?: ListMode, seed?: ListSeed) => void;
  closeListWindow: (id: string) => void;
  /** Abre mais uma janela "Selecionar por valor" para a camada */
  openSearchWindow: (sourceId: string) => void;
  closeSearchWindow: (id: string) => void;
  setBasemap: (basemap: Basemap) => void;
  setBasemapOrder: (order: string[]) => void;
  /** Renomeia um fundo padrão (vazio = nome original) */
  setBasemapName: (id: string, name: string) => void;
  updateCustomBasemap: (id: string, patch: Partial<Omit<CustomBasemap, 'id'>>) => void;
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
  setClickTarget: (target: ClickTarget) => void;
  /** Substitui os pontos selecionados das outras camadas */
  setOtherSelection: (other: Record<string, Record<string, SelectedGroup>>) => void;
  /** Tira registros de outra camada da seleção */
  removeOtherIds: (layerId: string, ids: string[]) => void;
  /**
   * Torna ativa uma das outras camadas selecionadas, mantendo a seleção de todas (a camada ativa
   * anterior passa para as "outras"), e abre o registro `id`.
   */
  promoteLayer: (layerId: string, key: string | null, id: string | null) => void;
  openRecord: (key: string | null, id: string | null) => void;
  focusMap: (f: Omit<MapFocus, 'nonce'>) => void;
  /** Mostra/oculta uma parte da tela (sem `show`: alterna) */
  setViewHidden: (part: ViewPart, hidden?: boolean) => void;
  setToolbarSide: (side: ToolbarSide) => void;
  setToolbarDragging: (dragging: boolean) => void;
  /** Leva os botões de um lado da tela (ou só de uma barra dele) para outro. */
  moveToolbarSide: (from: ToolbarSide, to: ToolbarSide, bar?: number) => void;
  /** Solta um botão, grupo ou subdivisão diante de `beforeId` (null = fim da barra). */
  placeToolbarItem: (
    id: string,
    side: ToolbarSide,
    beforeId: string | null,
    end?: 'side' | 'list',
    bar?: number,
  ) => void;
  insertToolbarDivider: (side: ToolbarSide, beforeId: string | null, bar?: number) => boolean;
  removeToolbarDivider: (id: string) => void;
  /** Botão solto sobre outro: vira grupo (pastinha) ou entra no grupo. */
  groupToolbarItems: (dragId: string, targetId: string) => void;
  ungroupToolbarItem: (groupId: string) => void;
  setToolbarGroupCurrent: (groupId: string, id: ToolbarButtonId) => void;
  addToolbarBar: (side: ToolbarSide) => void;
  removeToolbarBar: (side: ToolbarSide, bar: number) => void;
  /** Exibir › Painel: mostra ou oculta o botão (sem argumento, alterna). */
  setToolbarButtonShown: (id: string, shown?: boolean) => void;
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
  convertCoords: null,
  mapMaker: false,
  associate: false,
  duplicates: false,
  outsideBoundary: false,
  attributeDistance: false,
  duplicate: false,
  comparison: false,
  shortcuts: false,
};

const noSelection = {
  selection: {},
  otherSelection: {},
  activeKey: null,
  activeRecordId: null,
  transform: null,
  primaryIds: null,
};

const noBoundaryPick = {
  activeBoundaryId: null,
  boundarySelection: null,
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
    (set, get) => ({
      sourceId: null,
      tool: 'select',
      lastSelectTool: 'select',
      filters: [],
      layers: [],
      layerTree: [],
      layerFilters: {},
      selection: {},
      otherSelection: {},
      clickTarget: 'top',
      primaryIds: null,
      activeKey: null,
      activeRecordId: null,
      transform: null,
      listWindows: [],
      searchWindows: [],
      basemap: 'osm',
      customBasemaps: [],
      basemapOrder: [],
      basemapNames: {},
      boundaries: [],
      activeBoundaryId: null,
      boundarySelection: null,
      focus: null,
      viewHidden: { layers: false, maps: false, info: false },
      toolbarSide: 'left',
      toolbarLayout: defaultToolbarLayout(),
      toolbarDragging: false,
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
            const tree =
              id && !s.layers.some((l) => l.sourceId === id)
                ? syncTree([newLayer(id, s.layers.length), ...s.layers], s.layerTree)
                : {};
            return { ...tree, ...noBoundaryPick };
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
            ...noBoundaryPick,
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
      openListWindow: (sourceId, mode, seed) =>
        set((s) => ({
          listWindows: [...s.listWindows, { id: windowId(), sourceId, mode, seed }],
        })),
      closeListWindow: (id) =>
        set((s) => ({ listWindows: s.listWindows.filter((w) => w.id !== id) })),
      openSearchWindow: (sourceId) =>
        set((s) => ({
          searchWindows: [...s.searchWindows, { id: windowId(), sourceId }],
        })),
      closeSearchWindow: (id) =>
        set((s) => ({ searchWindows: s.searchWindows.filter((w) => w.id !== id) })),
      setBasemap: (basemap) => set({ basemap }),
      setBasemapOrder: (basemapOrder) => set({ basemapOrder }),
      setBasemapName: (id, name) =>
        set((s) => {
          const basemapNames = { ...s.basemapNames };
          if (name.trim()) basemapNames[id] = name.trim();
          else delete basemapNames[id];
          return { basemapNames };
        }),
      updateCustomBasemap: (id, patch) =>
        set((s) => ({
          customBasemaps: s.customBasemaps.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        })),
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
      removeBoundary: (id) =>
        set((s) => ({
          boundaries: s.boundaries.filter((b) => b.id !== id),
          ...(s.activeBoundaryId === id ? noBoundaryPick : {}),
        })),
      setActiveBoundary: (id) =>
        set((s) => ({
          activeBoundaryId: id,
          boundarySelection: id && id === s.activeBoundaryId ? s.boundarySelection : null,
          ...(id ? { panelOpen: true, panelCollapsed: false } : {}),
          boundaries:
            id && s.boundaries.some((b) => b.id === id && !b.visible)
              ? s.boundaries.map((b) => (b.id === id ? { ...b, visible: true } : b))
              : s.boundaries,
        })),
      setBoundarySelection: (boundarySelection) =>
        set(
          boundarySelection
            ? { boundarySelection, panelOpen: true, panelCollapsed: false }
            : { boundarySelection },
        ),
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
            otherSelection: mode === 'add' ? s.otherSelection : {},
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
          const keys = Object.keys(next);
          // Sobrou um único registro: abre-o (ex.: tirou da seleção os demais da coordenada).
          const only = keys.length === 1 && next[keys[0]].ids.length === 1 ? next[keys[0]] : null;
          return {
            selection: next,
            primaryIds: primary?.length ? primary : null,
            activeRecordId: only
              ? only.ids[0]
              : s.activeRecordId && remove.has(s.activeRecordId)
                ? null
                : s.activeRecordId,
            activeKey: only ? only.key : s.activeKey && next[s.activeKey] ? s.activeKey : null,
            transform: Object.keys(next).length ? s.transform : null,
          };
        }),

      setClickTarget: (clickTarget) => set({ clickTarget }),
      setOtherSelection: (otherSelection) => set({ otherSelection }),
      removeOtherIds: (layerId, ids) =>
        set((s) => {
          const remove = new Set(ids);
          const groups: Record<string, SelectedGroup> = {};
          for (const [k, g] of Object.entries(s.otherSelection[layerId] ?? {})) {
            const left = g.ids.filter((id) => !remove.has(id));
            if (left.length) groups[k] = { ...g, ids: left };
          }
          const otherSelection = { ...s.otherSelection, [layerId]: groups };
          if (!Object.keys(groups).length) delete otherSelection[layerId];
          return { otherSelection };
        }),
      promoteLayer: (layerId, key, id) => {
        const s = get();
        const target = s.otherSelection[layerId];
        if (!target) return;
        const rest = { ...s.otherSelection };
        delete rest[layerId];
        if (s.sourceId && Object.keys(s.selection).length) rest[s.sourceId] = s.selection;
        s.setSource(layerId);
        get().setSelection(Object.values(target));
        set({ otherSelection: rest });
        if (id) get().openRecord(key, id);
      },
      openRecord: (key, id) => set({ activeKey: key, activeRecordId: id, panelOpen: true }),
      focusMap: (f) => set({ focus: { ...f, nonce: Date.now() } }),
      setViewHidden: (part, hidden) =>
        set((s) => ({
          viewHidden: { ...s.viewHidden, [part]: hidden ?? !s.viewHidden[part] },
        })),
      setToolbarSide: (toolbarSide) =>
        set((s) => ({
          toolbarSide,
          toolbarLayout: moveAllToSide(s.toolbarLayout, toolbarSide),
        })),
      setToolbarDragging: (toolbarDragging) => set({ toolbarDragging }),
      moveToolbarSide: (from, to, bar) =>
        set((s) => ({ toolbarLayout: moveSide(s.toolbarLayout, from, to, bar) })),
      placeToolbarItem: (id, side, beforeId, end, bar) =>
        set((s) => ({
          toolbarLayout: placeToolbarItem(s.toolbarLayout, id, side, beforeId, end, bar),
        })),
      groupToolbarItems: (dragId, targetId) =>
        set((s) => ({ toolbarLayout: groupToolbarItems(s.toolbarLayout, dragId, targetId) })),
      ungroupToolbarItem: (groupId) =>
        set((s) => ({ toolbarLayout: ungroupToolbarItem(s.toolbarLayout, groupId) })),
      setToolbarGroupCurrent: (groupId, id) =>
        set((s) => {
          const next = setGroupCurrent(s.toolbarLayout, groupId, id);
          return next === s.toolbarLayout ? {} : { toolbarLayout: next };
        }),
      addToolbarBar: (side) =>
        set((s) => ({ toolbarLayout: addToolbarBar(s.toolbarLayout, side) })),
      removeToolbarBar: (side, bar) =>
        set((s) => ({ toolbarLayout: removeToolbarBar(s.toolbarLayout, side, bar) })),
      insertToolbarDivider: (side, beforeId, bar) => {
        const next = insertDivider(get().toolbarLayout, side, beforeId, bar);
        if (!next) return false;
        set({ toolbarLayout: next });
        return true;
      },
      removeToolbarDivider: (id) =>
        set((s) => ({ toolbarLayout: removeDivider(s.toolbarLayout, id) })),
      setToolbarButtonShown: (id, shown) =>
        set((s) => {
          const isShown = !s.toolbarLayout.hidden.some((x) => x === id);
          if (shown !== undefined && shown === isShown) return {};
          return { toolbarLayout: toggleToolbarButton(s.toolbarLayout, id) };
        }),
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
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const side = isToolbarSide(p.toolbarSide) ? p.toolbarSide : current.toolbarSide;
        return {
          ...current,
          ...p,
          toolbarLayout: normalizeToolbarLayout(p.toolbarLayout, side),
          toolbarDragging: false,
        };
      },
      partialize: (s) => ({
        sourceId: s.sourceId,
        clickTarget: s.clickTarget,
        tool: s.tool,
        lastSelectTool: s.lastSelectTool,
        filters: s.filters,
        layers: s.layers,
        layerTree: s.layerTree,
        layerFilters: s.layerFilters,
        basemap: s.basemap,
        customBasemaps: s.customBasemaps,
        basemapOrder: s.basemapOrder,
        basemapNames: s.basemapNames,
        boundaries: s.boundaries,
        viewHidden: s.viewHidden,
        toolbarSide: s.toolbarSide,
        toolbarLayout: s.toolbarLayout,
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
  'basemapOrder',
  'basemapNames',
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
