import clsx from 'clsx';
import {
  BoxSelect,
  Copy,
  CopyPlus,
  Crosshair,
  Download,
  Hand,
  History,
  Layers,
  ListChecks,
  ListOrdered,
  EyeOff,
  LogOut,
  MapPinPlus,
  MapPlus,
  Minus,
  MousePointer2,
  MousePointerClick,
  Move,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Pentagon,
  PersonStanding,
  Plus,
  RefreshCw,
  Ruler,
  Table2,
  TextSearch,
  Trash2,
  Tv,
  Undo2,
  Ungroup,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useActiveSource, useInvalidatePoints, useSelectedIds } from '@/hooks/useSourceData';
import { useUndo, useUndoStore } from '@/hooks/useUndo';
import { errorMessage } from '@/lib/api';
import { copyTable } from '@/lib/clipboard';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useMap } from '@/lib/mapContext';
import { TOOLBAR_SIDES, ToolbarSideContext, type ToolbarSide } from '@/lib/toolbar';
import {
  barsOf,
  groupButtons,
  MAX_BARS,
  slotsFor,
  TOOLBAR_DRAG,
  type ToolbarButtonId,
  type ToolbarItem,
} from '@/lib/toolbarLayout';
import { fetchSelectedTable } from '@/services/export';
import { pointsService } from '@/services/points';
import { fmtInt } from '@/utils/format';
import { useAppStore, type ListMode } from '@/stores/appStore';
import { useSelectionPreviewStore } from '@/stores/selectionPreviewStore';
import type { Bounds, TransformMode } from '@/types';
import { boundsOfPoints, unionBounds } from '@/utils/geo';
import { IconButton } from '../ui/Button';
import { HoldMenuButton, type HoldMenuItem } from '../ui/HoldMenuButton';
import { Menu, type MenuEntry } from '../ui/Menu';
import { toast } from '../ui/Toaster';
import { SHORTCUTS, useShortcutKeys, type ShortcutId } from '@/lib/shortcuts';

/** Ações compartilhadas entre a barra lateral (desktop) e a barra inferior (mobile). */
export function useToolActions() {
  const map = useMap();
  const { sourceId } = useActiveSource();
  const filters = useAppStore((s) => s.filters);
  const focusMap = useAppStore((s) => s.focusMap);
  const openDialog = useAppStore((s) => s.openDialog);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const activeRecordId = useAppStore((s) => s.activeRecordId);
  const ids = useSelectedIds();
  const invalidate = useInvalidatePoints();
  const undo = useUndo();

  const focusOr = (bounds: Bounds | null, empty: string) =>
    bounds ? focusMap({ bounds }) : toast.info(empty);
  const centerSelected = () =>
    focusOr(
      boundsOfPoints(Object.values(useAppStore.getState().selection)),
      'Nenhum ponto selecionado.',
    );
  const centerTable = async () => {
    if (!sourceId) return;
    try {
      focusOr(
        (await pointsService.extent(sourceId, filters)).bounds,
        'Nenhum ponto válido para centralizar.',
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  /** Todas as camadas visíveis (com os filtros de cada uma) e os limites exibidos. */
  const centerAll = async () => {
    const s = useAppStore.getState();
    try {
      const exts = await Promise.all(
        s.layers
          .filter((l) => l.visible)
          .map((l) =>
            pointsService.extent(
              l.sourceId,
              l.sourceId === s.sourceId ? s.filters : (s.layerFilters[l.sourceId] ?? []),
            ),
          ),
      );
      focusOr(
        unionBounds([
          ...exts.map((e) => e.bounds),
          ...s.boundaries.filter((b) => b.visible).map((b) => b.bounds),
        ]),
        'Nada exibido no mapa para centralizar.',
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return {
    hasSource: !!sourceId,
    hasSelection: ids.length > 0,
    canEdit: !!activeRecordId,
    /** Padrão: os selecionados; sem seleção, a tabela (camada) ativa. */
    center: () => (ids.length ? centerSelected() : centerTable()),
    centerSelected,
    centerTable,
    centerAll,
    zoom: (d: number) => map?.easeTo({ zoom: map.getZoom() + d, duration: 250 }),
    clear: clearSelection,
    edit: () => activeRecordId && openDialog('form', { mode: 'edit', id: activeRecordId }),
    remove: () => ids.length && openDialog('confirmDelete', { ids }),
    /** Ctrl+Z: desfaz a última operação do usuário (uma edição em massa inteira de uma vez) */
    undo: () => void undo.request(),
    /** Ctrl+Y: refaz o último desfazer (enquanto não houver outra ação depois) */
    redo: () => void undo.requestRedo(),
    transform: (mode: TransformMode) => {
      const s = useAppStore.getState();
      // Duplicar pergunta antes: na camada atual (arrastar) ou em outra camada.
      if (mode === 'copy' && s.transform !== 'copy') {
        if (Object.keys(s.selection).length) openDialog('duplicate', true);
        return;
      }
      s.setTransform(s.transform === mode ? null : mode);
    },
    exportData: () => openDialog('export', true),
    makeMap: () => openDialog('mapMaker', true),
    openChanges: () => openDialog('changes', true),
    copyToLayer: () => ids.length && openDialog('copyToLayer', true),
    /** Ctrl+C: selecionados para a área de transferência (cola no Excel com cabeçalho). */
    copy: (source: string, selected: string[]) => {
      copyTable(() => fetchSelectedTable(source, selected))
        .then((n) => toast.success(`${fmtInt(n)} registro(s) copiado(s) — cole no Excel (Ctrl+V).`))
        .catch((err) => toast.error(`Não foi possível copiar: ${errorMessage(err)}`));
    },
    refresh: invalidate,
  };
}

/** Item sendo arrastado (o dataTransfer só pode ser lido no drop). */
let draggingId: string | null = null;
let draggingTimer = 0;

function beginDrag(e: DragEvent<Element>, id: string) {
  e.dataTransfer.setData(TOOLBAR_DRAG, id);
  e.dataTransfer.setData('text/plain', id);
  e.dataTransfer.effectAllowed = 'move';
  draggingId = id;
  // Mostrar as áreas de soltar só depois do dragstart: mudar o layout durante ele (a barra de cima
  // aparecendo empurra a lateral) faz o Chrome cancelar o arraste.
  window.clearTimeout(draggingTimer);
  draggingTimer = window.setTimeout(() => useAppStore.getState().setToolbarDragging(true), 0);
}

/** Fim do arraste (soltou ou cancelou). */
export function endToolbarDrag() {
  window.clearTimeout(draggingTimer);
  draggingId = null;
  useAppStore.getState().setToolbarDragging(false);
}

function slotBefore(nav: HTMLElement, x: number, y: number, vertical: boolean) {
  for (const el of nav.querySelectorAll<HTMLElement>('[data-toolbar-slot]')) {
    const r = el.getBoundingClientRect();
    const mid = vertical ? r.top + r.height / 2 : r.left + r.width / 2;
    if ((vertical ? y : x) < mid) return el.dataset.toolbarSlot ?? null;
  }
  return null;
}

/** Tempo com um botão parado sobre outro para formar um grupo. */
const GROUP_HOLD_MS = 2000;

const SIDE_ICONS: Record<ToolbarSide, ReactNode> = {
  left: <PanelLeft className="size-5" />,
  right: <PanelRight className="size-5" />,
  top: <PanelTop className="size-5" />,
  bottom: <PanelBottom className="size-5" />,
};

interface ButtonSpec {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  /** Opções do botão (segurar abre o menu) */
  options?: HoldMenuItem[];
}

const TOOL_BUTTONS: Partial<Record<ToolbarButtonId, { label: string; icon: ReactNode }>> = {
  pan: { label: 'Navegar', icon: <Hand className="size-5" /> },
  select: { label: 'Selecionar ponto', icon: <MousePointer2 className="size-5" /> },
  multi: { label: 'Seleção múltipla', icon: <MousePointerClick className="size-5" /> },
  rectangle: { label: 'Seleção por retângulo', icon: <BoxSelect className="size-5" /> },
  polygon: { label: 'Seleção por polígono', icon: <Pentagon className="size-5" /> },
  measure: { label: 'Medir distância (régua)', icon: <Ruler className="size-5" /> },
  streetview: { label: 'Abrir no Street View', icon: <PersonStanding className="size-5" /> },
  add: { label: 'Adicionar ponto pelo mapa', icon: <MapPinPlus className="size-5" /> },
};

/**
 * Uma barra de um lado do mapa (cada lado pode ter até MAX_BARS). Arrastar um botão leva-o para
 * outra posição ou barra; parado ~2 s sobre outro botão, forma um grupo (pastinha). O botão direito
 * insere uma subdivisão ou oculta o botão (Exibir › Painel mostra de novo).
 */
export function ToolPanel({
  side,
  bar = 0,
  mobile,
}: {
  side: ToolbarSide;
  bar?: number;
  mobile?: boolean;
}) {
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);
  const transform = useAppStore((s) => s.transform);
  const layout = useAppStore((s) => s.toolbarLayout);
  const listOpen = useAppStore((s) => s.listWindows.length > 0);
  const searchOpen = useAppStore((s) => s.searchWindows.length > 0);
  const openList = (mode?: ListMode) => {
    const s = useAppStore.getState();
    if (s.sourceId) s.openListWindow(s.sourceId, mode);
  };
  const a = useToolActions();
  const undoBusy = useUndoStore((s) => s.busy);
  const previewOpen = useSelectionPreviewStore((s) => s.open);
  const setPreviewOpen = useSelectionPreviewStore((s) => s.setOpen);
  const keyOf = useShortcutKeys();
  const [menu, setMenu] = useState<{ x: number; y: number; item: ToolbarItem } | null>(null);
  /** Slot com um botão parado em cima; `ready` = já pode soltar para agrupar */
  const [hover, setHover] = useState<{ id: string; ready: boolean } | null>(null);
  const hoverTimer = useRef(0);
  const vertical = !mobile && (side === 'left' || side === 'right');
  const scope = mobile ? 'all' : side;
  const slots = mobile ? slotsFor(layout, 'all') : slotsFor(layout, side, bar);
  const bars = barsOf(layout, side);
  const shortcut = (id: string) =>
    SHORTCUTS.some((s) => s.id === id) ? keyOf(id as ShortcutId) : undefined;
  const needsSource = (id: ToolbarButtonId) =>
    ![
      'pan',
      'measure',
      'streetview',
      'zoomIn',
      'zoomOut',
      'mapMaker',
      'changes',
      'preview',
      'undo',
    ].includes(id);

  const clearHover = () => {
    window.clearTimeout(hoverTimer.current);
    setHover(null);
  };
  useEffect(() => {
    const end = () => {
      window.clearTimeout(hoverTimer.current);
      setHover(null);
    };
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.clearTimeout(hoverTimer.current);
    };
  }, []);

  const splitAfter = (id: string) => {
    const list = slotsFor(useAppStore.getState().toolbarLayout, scope, mobile ? undefined : bar);
    const i = list.findIndex((s) => s.id === id);
    const before = i >= 0 ? (list[i + 1]?.id ?? null) : null;
    const at = list[i]?.side ?? side;
    if (!useAppStore.getState().insertToolbarDivider(at, before, list[i]?.bar ?? bar))
      toast.info('A subdivisão precisa ficar entre dois botões.');
  };

  /** Ações e estado de cada botão */
  const specOf = (id: ToolbarButtonId): ButtonSpec => {
    const t = TOOL_BUTTONS[id];
    if (t) {
      return {
        ...t,
        active: !transform && tool === id,
        disabled: !a.hasSource && needsSource(id),
        onClick: () => setTool(id as Parameters<typeof setTool>[0]),
      };
    }
    switch (id) {
      case 'move':
      case 'duplicate': {
        const mode = id === 'move' ? 'move' : 'copy';
        return {
          label: id === 'move' ? 'Mover selecionados' : 'Duplicar selecionados',
          icon: id === 'move' ? <Move className="size-5" /> : <Copy className="size-5" />,
          active: transform === mode,
          disabled: !a.hasSelection,
          onClick: () => a.transform(mode),
        };
      }
      case 'list':
        return {
          label: 'Modo lista (percorrer valores)',
          icon: <ListOrdered className="size-5" />,
          active: listOpen,
          disabled: !a.hasSource,
          onClick: () => openList(),
          options: [
            {
              key: 'walk',
              label: 'Percorrer valores',
              icon: <ListOrdered className="size-5" />,
              onSelect: () => openList('walk'),
            },
            {
              key: 'all',
              label: 'Selecionar todos os itens da lista',
              icon: <ListChecks className="size-5" />,
              onSelect: () => openList('all'),
            },
          ],
        };
      case 'center':
        return {
          label: a.hasSelection ? 'Centralizar nos selecionados' : 'Centralizar na tabela atual',
          icon: <Crosshair className="size-5" />,
          disabled: !a.hasSource,
          onClick: a.center,
          options: [
            {
              key: 'selected',
              label: 'Pontos selecionados',
              icon: <MousePointer2 className="size-5" />,
              disabled: !a.hasSelection,
              onSelect: a.centerSelected,
            },
            {
              key: 'table',
              label: 'Tabela atual',
              icon: <Table2 className="size-5" />,
              onSelect: () => void a.centerTable(),
            },
            {
              key: 'all',
              label: 'Todos os dados exibidos',
              icon: <Layers className="size-5" />,
              onSelect: () => void a.centerAll(),
            },
          ],
        };
      case 'copyLayer':
        return {
          label: 'Copiar selecionados para nova camada',
          icon: <CopyPlus className="size-5" />,
          disabled: !a.hasSelection,
          onClick: () => a.copyToLayer(),
        };
      case 'remove':
        return {
          label: 'Excluir selecionados',
          icon: <Trash2 className="size-5" />,
          disabled: !a.hasSelection,
          onClick: a.remove,
        };
      case 'undo':
        return {
          label: 'Desfazer a última ação',
          icon: <Undo2 className="size-5" />,
          disabled: undoBusy,
          onClick: a.undo,
        };
      case 'preview':
        return {
          label: 'Preview do ponto selecionado (link, atributo ou Street View)',
          icon: <Tv className="size-5" />,
          active: previewOpen,
          onClick: () => setPreviewOpen(!previewOpen),
        };
      case 'search':
        return {
          label: 'Selecionar por valor (atributos)',
          icon: <TextSearch className="size-5" />,
          disabled: !a.hasSource,
          active: searchOpen,
          onClick: () => {
            const s = useAppStore.getState();
            if (s.sourceId) s.openSearchWindow(s.sourceId);
          },
        };
      case 'zoomIn':
        return {
          label: 'Aproximar',
          icon: <ZoomIn className="size-5" />,
          onClick: () => a.zoom(1),
        };
      case 'zoomOut':
        return {
          label: 'Afastar',
          icon: <ZoomOut className="size-5" />,
          onClick: () => a.zoom(-1),
        };
      case 'export':
        return {
          label: 'Exportar',
          icon: <Download className="size-5" />,
          disabled: !a.hasSource,
          onClick: a.exportData,
        };
      case 'mapMaker':
        return {
          label: 'Criar mapa (Comitê / Status 18)',
          icon: <MapPlus className="size-5" />,
          onClick: a.makeMap,
        };
      case 'changes':
        return {
          label: 'Tabela de Alterações',
          icon: <History className="size-5" />,
          onClick: () => a.openChanges(),
        };
      default:
        return {
          label: 'Atualizar dados',
          icon: <RefreshCw className="size-5" />,
          disabled: !a.hasSource,
          onClick: a.refresh,
        };
    }
  };

  const arrangeItems = (id: string): HoldMenuItem[] => [
    {
      key: 'split',
      label: 'Inserir subdivisão depois',
      icon: <Minus className="size-4" />,
      divider: true,
      onSelect: () => splitAfter(id),
    },
  ];

  const renderButton = (id: ToolbarButtonId) => {
    const spec = specOf(id);
    if (spec.options) {
      return (
        <HoldMenuButton
          draggable
          onDragStart={(e) => beginDrag(e, id)}
          label={spec.label}
          shortcut={shortcut(id)}
          icon={spec.icon}
          active={spec.active}
          disabled={spec.disabled}
          onClick={spec.onClick}
          items={[
            ...spec.options,
            ...arrangeItems(id),
            {
              key: 'hide',
              label: 'Ocultar botão',
              icon: <EyeOff className="size-4" />,
              onSelect: () => useAppStore.getState().setToolbarButtonShown(id, false),
            },
          ]}
        />
      );
    }
    return (
      <IconButton
        draggable
        onDragStart={(e) => beginDrag(e, id)}
        label={spec.label}
        shortcut={shortcut(id)}
        active={spec.active}
        disabled={spec.disabled}
        onClick={spec.onClick}
      >
        {spec.icon}
      </IconButton>
    );
  };

  /** Pastinha: mostra o botão ativo ou o usado por último; segurar abre os outros. */
  const renderGroup = (item: ToolbarItem) => {
    const members = groupButtons(layout, item);
    const specs = new Map(members.map((m) => [m, specOf(m)]));
    const shown =
      members.find((m) => specs.get(m)!.active) ??
      (item.current && members.includes(item.current) ? item.current : members[0]);
    const spec = specs.get(shown)!;
    const st = () => useAppStore.getState();
    return (
      <HoldMenuButton
        group
        draggable
        onDragStart={(e) => beginDrag(e, item.id)}
        label={`${spec.label} (grupo de ${members.length})`}
        shortcut={shortcut(shown)}
        icon={spec.icon}
        active={spec.active}
        // Desabilitado só se todos estiverem: senão o menu do grupo precisa abrir.
        disabled={members.every((m) => specs.get(m)!.disabled)}
        onClick={() => {
          if (!spec.disabled) spec.onClick();
        }}
        items={[
          ...members.map((m): HoldMenuItem => ({
            key: m,
            label: specs.get(m)!.label,
            icon: specs.get(m)!.icon,
            shortcut: shortcut(m),
            checked: m === shown,
            disabled: specs.get(m)!.disabled,
            onSelect: () => {
              st().setToolbarGroupCurrent(item.id, m);
              specs.get(m)!.onClick();
            },
          })),
          {
            key: 'takeOut',
            label: `Tirar "${spec.label}" do grupo`,
            icon: <LogOut className="size-4" />,
            divider: true,
            onSelect: () => {
              const list = slotsFor(st().toolbarLayout, scope, mobile ? undefined : bar);
              const next = list[list.findIndex((x) => x.id === item.id) + 1]?.id ?? null;
              st().placeToolbarItem(shown, item.side, next, 'side', item.bar ?? 0);
            },
          },
          {
            key: 'ungroup',
            label: 'Desagrupar',
            icon: <Ungroup className="size-4" />,
            onSelect: () => st().ungroupToolbarItem(item.id),
          },
          ...arrangeItems(item.id).map((x) => ({ ...x, divider: false })),
        ]}
      />
    );
  };

  const menuItems = (item: ToolbarItem): MenuEntry[] =>
    item.kind === 'divider'
      ? [
          {
            label: 'Remover subdivisão',
            icon: <X className="size-3.5" />,
            danger: true,
            onSelect: () => useAppStore.getState().removeToolbarDivider(item.id),
          },
        ]
      : item.kind === 'group'
        ? [
            {
              label: 'Desagrupar',
              icon: <Ungroup className="size-3.5" />,
              onSelect: () => useAppStore.getState().ungroupToolbarItem(item.id),
            },
            {
              label: 'Inserir subdivisão depois',
              icon: <Minus className="size-3.5" />,
              onSelect: () => splitAfter(item.id),
            },
          ]
        : [
            {
              label: 'Inserir subdivisão depois',
              icon: <Minus className="size-3.5" />,
              onSelect: () => splitAfter(item.id),
            },
            {
              label: 'Ocultar botão',
              icon: <EyeOff className="size-3.5" />,
              onSelect: () => useAppStore.getState().setToolbarButtonShown(item.id, false),
            },
          ];

  /** Arrastando sobre um botão/grupo: no meio dele, conta o tempo para agrupar. */
  const overSlot = (e: DragEvent<HTMLDivElement>, item: ToolbarItem) => {
    const dragged = draggingId;
    const draggedItem = dragged ? layout.items.find((i) => i.id === dragged) : null;
    if (
      !dragged ||
      dragged === item.id ||
      item.kind === 'divider' ||
      draggedItem?.kind === 'divider'
    ) {
      if (hover) clearHover();
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const t = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    if (t < 0.2 || t > 0.8) {
      if (hover) clearHover();
      return;
    }
    if (hover?.id === item.id) return;
    window.clearTimeout(hoverTimer.current);
    setHover({ id: item.id, ready: false });
    hoverTimer.current = window.setTimeout(
      () => setHover((h) => (h?.id === item.id ? { ...h, ready: true } : h)),
      GROUP_HOLD_MS,
    );
  };

  const st = () => useAppStore.getState();
  const extraEmpty = !mobile && bar > 0 && !slots.length;

  return (
    <ToolbarSideContext.Provider value={mobile ? 'bottom' : side}>
      <nav
        aria-label={bar ? `Ferramentas (barra ${bar + 1})` : 'Ferramentas'}
        title="Arraste um botão para outra posição ou barra; parado ~2 s sobre outro, forma um grupo. Botão direito: subdivisão ou ocultar."
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes(TOOLBAR_DRAG)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) clearHover();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData(TOOLBAR_DRAG) || e.dataTransfer.getData('text/plain');
          const target = hover?.ready ? hover.id : null;
          clearHover();
          if (!id) return;
          if (target) {
            st().groupToolbarItems(id, target);
            return;
          }
          const beforeId = slotBefore(e.currentTarget, e.clientX, e.clientY, vertical);
          const anchor = beforeId ? layout.items.find((i) => i.id === beforeId) : undefined;
          const targetSide = mobile ? (anchor?.side ?? side) : side;
          st().placeToolbarItem(
            id,
            targetSide,
            beforeId,
            mobile && !beforeId ? 'list' : 'side',
            mobile ? (anchor?.bar ?? 0) : bar,
          );
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-toolbar-slot]')) return;
          e.preventDefault();
          const before = slots.at(-1)?.id ?? null;
          if (!st().insertToolbarDivider(side, before, bar))
            toast.info('A subdivisão precisa ficar entre dois botões.');
        }}
        className={clsx(
          'scroll-thin flex shrink-0 items-center gap-1 border-slate-200 bg-white',
          mobile
            ? 'fixed right-0 bottom-0 left-0 z-30 overflow-x-auto border-t px-2 py-1.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]'
            : vertical
              ? 'w-13 flex-col overflow-x-hidden overflow-y-auto py-2'
              : 'overflow-x-auto overflow-y-hidden px-2 py-1.5',
          !mobile &&
            { left: 'border-r', right: 'border-l', top: 'border-b', bottom: 'border-t' }[side],
          !mobile && !slots.length && 'min-h-16 border-dashed border-accent-300 bg-accent-50/70',
        )}
      >
        {!slots.length && (
          <span
            className={clsx(
              'px-1 text-[10px] text-accent-700',
              vertical && '[writing-mode:vertical-rl]',
            )}
          >
            Solte aqui
          </span>
        )}
        {extraEmpty && (
          <button
            type="button"
            title="Remover esta barra"
            aria-label="Remover esta barra"
            onClick={() => st().removeToolbarBar(side, bar)}
            className={clsx(
              'rounded p-0.5 text-accent-700 hover:bg-accent-100',
              vertical ? 'mt-auto' : 'ml-auto',
            )}
          >
            <X className="size-3.5" />
          </button>
        )}
        {slots.map((item) => {
          const hovering = hover?.id === item.id;
          return (
            <div
              key={item.id}
              data-toolbar-slot={item.id}
              draggable
              title={
                hovering && hover.ready
                  ? 'Solte para agrupar'
                  : item.kind === 'divider'
                    ? 'Subdivisão — arraste para mover'
                    : 'Arraste para outra posição; parado sobre outro botão, agrupa'
              }
              onDragStart={(e) => beginDrag(e, item.id)}
              onDragOver={(e) => overSlot(e, item)}
              className={clsx(
                'group relative shrink-0 cursor-grab rounded-md transition active:cursor-grabbing',
                hovering && !hover.ready && 'ring-2 ring-accent-300',
                hovering && hover.ready && 'scale-110 bg-accent-100 ring-2 ring-accent-600',
              )}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, item });
              }}
            >
              {item.kind === 'divider' ? (
                <div
                  className={clsx(
                    'flex items-center justify-center',
                    vertical ? 'h-3 w-9' : 'h-9 w-3',
                  )}
                >
                  <div className={vertical ? 'h-px w-6 bg-slate-300' : 'h-6 w-px bg-slate-300'} />
                  <button
                    type="button"
                    aria-label="Remover subdivisão"
                    title="Remover subdivisão"
                    draggable={false}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => st().removeToolbarDivider(item.id)}
                    className="pointer-events-none absolute top-1/2 left-1/2 z-10 flex size-3.5 -translate-1/2 items-center justify-center rounded-full bg-slate-700 text-white opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ) : item.kind === 'group' ? (
                renderGroup(item)
              ) : (
                renderButton(item.id as ToolbarButtonId)
              )}
            </div>
          );
        })}
        {!mobile && slots.length > 0 && (
          <div className={clsx('flex shrink-0', vertical ? 'mt-auto pt-1' : 'ml-auto pl-1')}>
            <HoldMenuButton
              label={
                bars > 1
                  ? 'Mover os botões desta barra / barras'
                  : 'Mover os botões deste lado / barras'
              }
              icon={SIDE_ICONS[side]}
              menuOnClick
              items={[
                ...TOOLBAR_SIDES.map((o) => ({
                  key: o.side,
                  label: o.label,
                  icon: SIDE_ICONS[o.side],
                  checked: o.side === side,
                  disabled: o.side === side,
                  onSelect: () => st().moveToolbarSide(side, o.side, bars > 1 ? bar : undefined),
                })),
                {
                  key: 'addBar',
                  label: 'Adicionar barra deste lado',
                  icon: <Plus className="size-4" />,
                  divider: true,
                  disabled: bars >= MAX_BARS,
                  onSelect: () => st().addToolbarBar(side),
                },
                ...(bar > 0
                  ? [
                      {
                        key: 'removeBar',
                        label: 'Remover esta barra (os botões vão para a anterior)',
                        icon: <X className="size-4" />,
                        onSelect: () => st().removeToolbarBar(side, bar),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        )}
      </nav>
      {menu && (
        <Menu x={menu.x} y={menu.y} items={menuItems(menu.item)} onClose={() => setMenu(null)} />
      )}
    </ToolbarSideContext.Provider>
  );
}
