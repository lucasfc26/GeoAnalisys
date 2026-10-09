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
  ListOrdered,
  MapPinPlus,
  MapPlus,
  MousePointer2,
  MousePointerClick,
  Move,
  Pentagon,
  PersonStanding,
  RefreshCw,
  Ruler,
  Table2,
  TextSearch,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useActiveSource, useInvalidatePoints, useSelectedIds } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { copyTable } from '@/lib/clipboard';
import { useMap } from '@/lib/mapContext';
import { fetchSelectedTable } from '@/services/export';
import { pointsService } from '@/services/points';
import { fmtInt } from '@/utils/format';
import { useAppStore } from '@/stores/appStore';
import type { Bounds, TransformMode } from '@/types';
import { boundsOfPoints, unionBounds } from '@/utils/geo';
import { IconButton } from '../ui/Button';
import { HoldMenuButton } from '../ui/HoldMenuButton';
import { toast } from '../ui/Toaster';
import { ToolGroup, type ToolDef } from './ToolGroup';

const PAN: ToolDef = {
  tool: 'pan',
  label: 'Navegar',
  shortcut: 'N',
  icon: <Hand className="size-5" />,
};

/** Ferramentas de seleção: um único botão (segurar para escolher). */
const SELECTION_TOOLS: ToolDef[] = [
  {
    tool: 'select',
    label: 'Selecionar ponto',
    shortcut: 'S',
    icon: <MousePointer2 className="size-5" />,
  },
  {
    tool: 'multi',
    label: 'Seleção múltipla',
    shortcut: 'M',
    icon: <MousePointerClick className="size-5" />,
  },
  {
    tool: 'rectangle',
    label: 'Seleção por retângulo',
    shortcut: 'R',
    icon: <BoxSelect className="size-5" />,
  },
  {
    tool: 'polygon',
    label: 'Seleção por polígono',
    shortcut: 'P',
    icon: <Pentagon className="size-5" />,
  },
];

const OTHER_TOOLS: ToolDef[] = [
  {
    tool: 'measure',
    label: 'Medir distância (régua)',
    shortcut: 'I',
    icon: <Ruler className="size-5" />,
  },
  {
    tool: 'streetview',
    label: 'Abrir no Street View',
    shortcut: 'V',
    icon: <PersonStanding className="size-5" />,
  },
  {
    tool: 'add',
    label: 'Adicionar ponto pelo mapa',
    shortcut: 'A',
    icon: <MapPinPlus className="size-5" />,
  },
];

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
    transform: (mode: TransformMode) => {
      const s = useAppStore.getState();
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

function Divider({ vertical }: { vertical?: boolean }) {
  return <div className={vertical ? 'mx-1 h-6 w-px bg-slate-200' : 'my-1 h-px w-6 bg-slate-200'} />;
}

export function ToolPanel({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);
  const transform = useAppStore((s) => s.transform);
  const lastSelectTool = useAppStore((s) => s.lastSelectTool);
  const listMode = useAppStore((s) => s.listMode);
  const setListMode = useAppStore((s) => s.setListMode);
  const searchOpen = useAppStore((s) => s.searchWindows.length > 0);
  const a = useToolActions();
  const vertical = orientation === 'vertical';
  // Régua e Street View não dependem de uma camada.
  const needsSource = (t: ToolDef) =>
    t.tool !== 'pan' && t.tool !== 'measure' && t.tool !== 'streetview';
  const toolButton = (t: ToolDef) => (
    <IconButton
      key={t.tool}
      label={t.label}
      shortcut={t.shortcut}
      active={!transform && tool === t.tool}
      disabled={!a.hasSource && needsSource(t)}
      onClick={() => setTool(t.tool)}
    >
      {t.icon}
    </IconButton>
  );

  return (
    <nav
      aria-label="Ferramentas"
      className={clsx(
        'flex items-center gap-1 bg-white',
        vertical
          ? 'scroll-thin w-13 shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-slate-200 py-2'
          : 'scroll-thin fixed right-0 bottom-0 left-0 z-30 overflow-x-auto border-t border-slate-200 px-2 py-1.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]',
      )}
    >
      {toolButton(PAN)}
      <ToolGroup
        tools={SELECTION_TOOLS}
        current={transform ? 'pan' : tool}
        last={lastSelectTool}
        disabled={!a.hasSource}
        orientation={vertical ? 'vertical' : 'horizontal'}
        onPick={setTool}
      />
      {OTHER_TOOLS.map(toolButton)}
      <Divider vertical={!vertical} />
      <IconButton
        label="Mover selecionados"
        shortcut="G"
        active={transform === 'move'}
        disabled={!a.hasSelection}
        onClick={() => a.transform('move')}
      >
        <Move className="size-5" />
      </IconButton>
      <IconButton
        label="Duplicar selecionados"
        shortcut="D"
        active={transform === 'copy'}
        disabled={!a.hasSelection}
        onClick={() => a.transform('copy')}
      >
        <Copy className="size-5" />
      </IconButton>
      <IconButton
        label="Copiar selecionados para nova camada"
        disabled={!a.hasSelection}
        onClick={() => a.copyToLayer()}
      >
        <CopyPlus className="size-5" />
      </IconButton>
      <IconButton
        label="Excluir selecionados"
        shortcut="Del"
        disabled={!a.hasSelection}
        onClick={a.remove}
      >
        <Trash2 className="size-5" />
      </IconButton>
      <Divider vertical={!vertical} />
      <IconButton
        label="Modo lista (percorrer valores)"
        shortcut="L"
        active={listMode}
        disabled={!a.hasSource}
        onClick={() => setListMode(!listMode)}
      >
        <ListOrdered className="size-5" />
      </IconButton>
      <IconButton
        label="Selecionar por valor (atributos)"
        shortcut="F3"
        active={searchOpen}
        disabled={!a.hasSource}
        onClick={() => {
          // Sempre abre mais uma janela, para a camada ativa.
          const s = useAppStore.getState();
          if (s.sourceId) s.openSearchWindow(s.sourceId);
        }}
      >
        <TextSearch className="size-5" />
      </IconButton>
      <HoldMenuButton
        label={a.hasSelection ? 'Centralizar nos selecionados' : 'Centralizar na tabela atual'}
        shortcut="C"
        icon={<Crosshair className="size-5" />}
        disabled={!a.hasSource}
        orientation={vertical ? 'vertical' : 'horizontal'}
        onClick={a.center}
        items={[
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
        ]}
      />
      <IconButton label="Aproximar" shortcut="+" onClick={() => a.zoom(1)}>
        <ZoomIn className="size-5" />
      </IconButton>
      <IconButton label="Afastar" shortcut="-" onClick={() => a.zoom(-1)}>
        <ZoomOut className="size-5" />
      </IconButton>
      <Divider vertical={!vertical} />
      <IconButton label="Exportar" disabled={!a.hasSource} onClick={a.exportData}>
        <Download className="size-5" />
      </IconButton>
      <IconButton label="Criar mapa (Comitê / Status 18)" onClick={a.makeMap}>
        <MapPlus className="size-5" />
      </IconButton>
      <IconButton label="Tabela de Alterações" onClick={() => a.openChanges()}>
        <History className="size-5" />
      </IconButton>
      <IconButton label="Atualizar dados" disabled={!a.hasSource} onClick={a.refresh}>
        <RefreshCw className="size-5" />
      </IconButton>
    </nav>
  );
}
