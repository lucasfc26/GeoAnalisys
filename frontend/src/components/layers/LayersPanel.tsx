import clsx from 'clsx';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Database,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Info,
  Layers,
  Loader2,
  MousePointerClick,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  SquarePen,
  Type,
  Ungroup,
  Upload,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LayerRuntime } from '@/hooks/useLayers';
import { queryKeys, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { catKey, categoryStyle, layerName, switchLabelTemplate } from '@/lib/layers';
import {
  canStep,
  dropZone,
  groupOf,
  isGroup,
  normalizeTree,
  type DropWhere,
  type TreeRef,
} from '@/lib/layerTree';
import { TEMP_SCHEMA, layersService } from '@/services/layers';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import type { LayerStyle, LayerTreeNode } from '@/types';
import { fmtInt, fmtValue } from '@/utils/format';
import { Menu, type MenuEntry } from '../ui/Menu';
import { toast } from '../ui/Toaster';
import { BoundariesSection } from './BoundariesSection';
import { ColorDot, DragGrip, DropMark } from './LayerControls';

const MAX_CATEGORIES = 60;

type Group = Extract<LayerTreeNode, { kind: 'group' }>;

/** Abre o menu (botão direito ou botão "+ Adicionar") na posição do clique. */
export type OpenMenu = (at: { x: number; y: number }, items: MenuEntry[]) => void;

/** Props de arrastar e soltar de uma linha do painel + a marca de onde vai cair. */
interface RowDnd {
  props: {
    draggable: boolean;
    onDragStart: (e: DragEvent<HTMLElement>) => void;
    onDragOver: (e: DragEvent<HTMLElement>) => void;
    onDrop: (e: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
  over: DropWhere | null;
  dragging: boolean;
}

const menuAt = (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  return { x: e.clientX, y: e.clientY };
};

/** Campo de renomear no lugar do nome: Enter/sair do campo grava, Esc cancela. */
function RenameInput({
  initial,
  placeholder,
  label,
  onDone,
}: {
  initial: string;
  placeholder?: string;
  label: string;
  /** null = cancelado */
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={120}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value);
        if (e.key === 'Escape') finish(null);
      }}
      className="h-5 min-w-0 flex-1 rounded border border-accent-400 bg-white px-1 text-xs text-slate-800 outline-none"
      aria-label={label}
    />
  );
}

function LayerRow({
  rt,
  active,
  tree,
  dnd,
  renaming,
  onRename,
  onRenameDone,
  openMenu,
  onNewGroup,
  nested,
}: {
  rt: LayerRuntime;
  active: boolean;
  tree: LayerTreeNode[];
  dnd: RowDnd;
  renaming: boolean;
  onRename: () => void;
  onRenameDone: () => void;
  openMenu: OpenMenu;
  /** Cria um grupo já com esta camada */
  onNewGroup: () => void;
  /** Dentro de um grupo (recuo) */
  nested: boolean;
}) {
  const { layer, source, prepared } = rt;
  const id = layer.sourceId;
  const setSource = useAppStore((s) => s.setSource);
  const updateLayer = useAppStore((s) => s.updateLayer);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const moveLayer = useAppStore((s) => s.moveLayer);
  const setLayerGroup = useAppStore((s) => s.setLayerGroup);
  const openDialog = useAppStore((s) => s.openDialog);
  const focusMap = useAppStore((s) => s.focusMap);
  const categorized = !!rt.styleColumn && !!prepared?.categorized;
  const name = layerName(layer, source);
  const ref: TreeRef = { kind: 'layer', id };
  const canUp = canStep(tree, ref, -1);
  const canDown = canStep(tree, ref, 1);
  const group = groupOf(tree, id);
  const groups = tree.filter(isGroup);

  const cats = useMemo(() => {
    if (!categorized || !prepared) return [];
    return prepared.cats
      .map((value, i) => ({ value, count: prepared.catCounts[i] }))
      .sort(
        (a, b) => b.count - a.count || String(a.value ?? '').localeCompare(String(b.value ?? '')),
      );
  }, [categorized, prepared]);

  const setCat = (value: string | null, patch: Partial<ReturnType<typeof categoryStyle>>) =>
    updateLayer(id, (l) => ({
      categories: { ...l.categories, [catKey(value)]: { ...categoryStyle(l, value), ...patch } },
    }));

  const zoomTo = async () => {
    try {
      const ext = await pointsService.extent(id, rt.filters);
      if (ext.bounds) focusMap({ bounds: ext.bounds });
      else toast.info('Nenhum ponto válido nesta camada.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const toggle = (patch: Partial<LayerStyle>) => updateLayer(id, patch);

  // Camada em GeoAnalisysTemp: o ✕ apaga a tabela (confirmação com um 2º clique). Outros schemas:
  // só sai do mapa, a tabela fica.
  const qc = useQueryClient();
  const isTemp = source?.schema === TEMP_SCHEMA;
  const [armed, setArmed] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const remove = async () => {
    if (!isTemp) return removeLayer(id);
    if (!armed) return setArmed(true);
    setRemoving(true);
    try {
      const r = await layersService.removeTemp(id);
      removeLayer(id);
      await qc.invalidateQueries({ queryKey: queryKeys.sources });
      toast.success(
        r.dropped
          ? `Camada removida e tabela ${TEMP_SCHEMA}.${r.tableName} apagada.`
          : 'Camada removida do mapa.',
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoving(false);
      setArmed(false);
    }
  };

  const menu = (): MenuEntry[] => [
    {
      label: 'Tornar camada ativa',
      icon: <MousePointerClick className="size-3.5" />,
      disabled: active,
      onSelect: () => setSource(id),
    },
    'separator',
    {
      label: 'Editar fonte de dados…',
      icon: <SquarePen className="size-3.5" />,
      title: 'Tabela, colunas de ID/X/Y, rótulo, categoria e sistema de coordenadas',
      onSelect: () => openDialog('source', { edit: id }),
    },
    { label: 'Renomear', icon: <Pencil className="size-3.5" />, onSelect: onRename },
    ...(layer.name?.trim()
      ? [
          {
            label: `Restaurar nome (${source?.name ?? 'fonte'})`,
            icon: <RotateCcw className="size-3.5" />,
            onSelect: () => updateLayer(id, { name: undefined }),
          },
        ]
      : []),
    {
      label: 'Estilo (cor e tamanho)…',
      icon: <Palette className="size-3.5" />,
      onSelect: () => openDialog('layerStyle', { sourceId: id, tab: 'symbology' }),
    },
    {
      label: layer.label.enabled ? 'Rótulos (ligados)…' : 'Rótulos…',
      icon: <Type className="size-3.5" />,
      onSelect: () => openDialog('layerStyle', { sourceId: id, tab: 'labels' }),
    },
    {
      label: 'Aproximar da camada',
      icon: <Crosshair className="size-3.5" />,
      onSelect: () => void zoomTo(),
    },
    {
      label: layer.visible ? 'Ocultar no mapa' : 'Mostrar no mapa',
      icon: layer.visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />,
      onSelect: () => toggle({ visible: !layer.visible }),
    },
    'separator',
    {
      label: 'Mover para cima',
      icon: <ChevronUp className="size-3.5" />,
      disabled: !canUp,
      onSelect: () => moveLayer(id, -1),
    },
    {
      label: 'Mover para baixo',
      icon: <ChevronDown className="size-3.5" />,
      disabled: !canDown,
      onSelect: () => moveLayer(id, 1),
    },
    {
      label: 'Mover para o grupo',
      icon: <FolderInput className="size-3.5" />,
      submenu: [
        {
          label: 'Fora de grupos',
          checked: !group,
          onSelect: () => setLayerGroup(id, null),
        },
        ...groups.map((g) => ({
          label: g.name,
          icon: <Folder className="size-3.5" />,
          checked: g.id === group?.id,
          onSelect: () => setLayerGroup(id, g.id),
        })),
        'separator',
        { label: 'Novo grupo…', icon: <FolderPlus className="size-3.5" />, onSelect: onNewGroup },
      ],
    },
    'separator',
    {
      label: 'Sobre',
      icon: <Info className="size-3.5" />,
      onSelect: () => openDialog('layerAbout', { kind: 'layer', id }),
    },
    {
      label: isTemp ? 'Remover e apagar tabela temporária…' : 'Remover do mapa',
      icon: <X className="size-3.5" />,
      danger: true,
      onSelect: () => void remove(),
    },
  ];

  return (
    <li className={clsx(dnd.dragging && 'opacity-40')}>
      <div
        {...dnd.props}
        onContextMenu={(e) => openMenu(menuAt(e), menu())}
        className={clsx(
          'group relative flex items-center gap-1.5 rounded px-1 py-1',
          nested && 'ml-4',
          active ? 'bg-accent-50 ring-1 ring-accent-300' : 'hover:bg-slate-50',
          dnd.props.draggable && 'cursor-grab active:cursor-grabbing',
        )}
      >
        <DropMark where={dnd.over} />
        <DragGrip />
        <button
          type="button"
          className={clsx(
            'rounded text-slate-400 hover:text-slate-700',
            !categorized && 'invisible',
          )}
          onClick={() => toggle({ expanded: !layer.expanded })}
          aria-label={layer.expanded ? 'Recolher categorias' : 'Expandir categorias'}
        >
          {layer.expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <input
          type="checkbox"
          checked={layer.visible}
          onChange={() => toggle({ visible: !layer.visible })}
          className="size-3.5 shrink-0 accent-accent-600"
          aria-label="Mostrar camada"
        />
        {!categorized && (
          <ColorDot
            color={layer.color}
            title="Cor dos pontos"
            onChange={(color) => toggle({ color })}
          />
        )}
        {renaming ? (
          <RenameInput
            initial={name}
            placeholder={source?.name}
            label="Nome da camada"
            onDone={(v) => {
              if (v !== null) {
                const t = v.trim();
                updateLayer(id, { name: t && t !== source?.name ? t : undefined });
              }
              onRenameDone();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setSource(id)}
            onDoubleClick={onRename}
            className={clsx(
              'min-w-0 flex-1 truncate text-left text-xs',
              active
                ? 'font-semibold text-accent-800 underline decoration-accent-400 underline-offset-2'
                : 'text-slate-700',
              !layer.visible && 'text-slate-400 italic',
            )}
            title={`${name}${layer.name?.trim() ? ` (fonte: ${source?.name ?? '…'})` : ''}\n${
              active
                ? 'Camada ativa (seleção, filtros, edição e exportação)'
                : 'Clique para tornar a camada ativa'
            } · duplo clique para renomear · botão direito: opções`}
          >
            {name}
            {rt.total !== null && (
              <span className="ml-1 font-normal text-slate-400">[{fmtInt(rt.total)}]</span>
            )}
          </button>
        )}
        {rt.isFetching && <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-600" />}
        {rt.mode === 'viewport' && (
          <span title="Tabela grande: pontos carregados por região do mapa">
            <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
          </span>
        )}
        {layer.label.enabled && (
          <span title="Rótulos ligados">
            <Type className="size-3 shrink-0 text-accent-600" />
          </span>
        )}
        {/* Opções no botão direito; aqui só a confirmação de apagar a tabela temporária */}
        {armed && (
          <button
            type="button"
            onClick={remove}
            disabled={removing}
            className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            title={`Apagar a tabela ${TEMP_SCHEMA}.${source?.tableName ?? ''} e remover a camada`}
          >
            {removing ? 'Apagando…' : 'Apagar tabela?'}
          </button>
        )}
      </div>
      {!!layer.labelTemplates?.length && (
        <div className={clsx('flex items-center gap-1.5 py-0.5 pr-1', nested ? 'ml-14' : 'ml-10')}>
          <Type className="size-3 shrink-0 text-slate-400" />
          <select
            value={layer.activeLabelTemplate ?? ''}
            onChange={(e) =>
              e.target.value && updateLayer(id, (l) => switchLabelTemplate(l, e.target.value))
            }
            className="h-5 min-w-0 flex-1 rounded border border-slate-300 bg-white text-[11px] text-slate-600"
            title="Template de rótulo"
            aria-label="Template de rótulo"
          >
            {!layer.activeLabelTemplate && <option value="">(rótulo sem template)</option>}
            {layer.labelTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {categorized && layer.expanded && (
        <ul className={clsx('mt-0.5 mb-1 space-y-0.5', nested ? 'ml-12' : 'ml-8')}>
          {cats.slice(0, MAX_CATEGORIES).map(({ value, count }) => {
            const cs = categoryStyle(layer, value);
            return (
              <li key={catKey(value)} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={cs.visible}
                  onChange={() => setCat(value, { visible: !cs.visible })}
                  className="size-3.5 shrink-0 accent-accent-600"
                  aria-label={`Mostrar ${fmtValue(value)}`}
                />
                <ColorDot
                  color={cs.color}
                  title="Cor da categoria"
                  onChange={(color) => setCat(value, { color })}
                />
                <span
                  className={clsx(
                    'min-w-0 truncate',
                    cs.visible ? 'text-slate-700' : 'text-slate-400',
                  )}
                >
                  {value === null || value === '' ? <i>(vazio)</i> : value}
                </span>
                <span className="shrink-0 text-slate-400">[{fmtInt(count)}]</span>
              </li>
            );
          })}
          {cats.length > MAX_CATEGORIES && (
            <li className="text-xs text-slate-400">
              … e mais {fmtInt(cats.length - MAX_CATEGORIES)} valores (veja em Estilo)
            </li>
          )}
          {rt.mode === 'viewport' && (
            <li className="text-[11px] text-slate-400">Contagens da região visível</li>
          )}
        </ul>
      )}
    </li>
  );
}

/** Grupo (pasta) de camadas: mostrar/ocultar todas, recolher, renomear, desfazer. */
function GroupRow({
  group,
  tree,
  members,
  dnd,
  renaming,
  onRename,
  onRenameDone,
  openMenu,
  children,
}: {
  group: Group;
  tree: LayerTreeNode[];
  members: LayerStyle[];
  dnd: RowDnd;
  renaming: boolean;
  onRename: () => void;
  onRenameDone: () => void;
  openMenu: OpenMenu;
  children: ReactNode;
}) {
  const updateGroup = useAppStore((s) => s.updateGroup);
  const removeGroup = useAppStore((s) => s.removeGroup);
  const updateLayer = useAppStore((s) => s.updateLayer);
  const moveLayer = useAppStore((s) => s.moveLayer);
  const openDialog = useAppStore((s) => s.openDialog);
  const ref: TreeRef = { kind: 'group', id: group.id };
  const canUp = canStep(tree, ref, -1);
  const canDown = canStep(tree, ref, 1);
  const shown = members.filter((l) => l.visible).length;
  const all = members.length > 0 && shown === members.length;
  const some = shown > 0 && !all;
  const checkRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkRef.current) checkRef.current.indeterminate = some;
  }, [some]);
  const setAll = (visible: boolean) => members.forEach((l) => updateLayer(l.sourceId, { visible }));
  const expand = () => updateGroup(group.id, { expanded: !group.expanded });

  const menu = (): MenuEntry[] => [
    { label: 'Renomear', icon: <Pencil className="size-3.5" />, onSelect: onRename },
    {
      label: group.expanded ? 'Recolher' : 'Expandir',
      icon: group.expanded ? <Folder className="size-3.5" /> : <FolderOpen className="size-3.5" />,
      onSelect: expand,
    },
    'separator',
    {
      label: 'Mostrar todas',
      icon: <Eye className="size-3.5" />,
      disabled: !members.length || all,
      onSelect: () => setAll(true),
    },
    {
      label: 'Ocultar todas',
      icon: <EyeOff className="size-3.5" />,
      disabled: !shown,
      onSelect: () => setAll(false),
    },
    'separator',
    {
      label: 'Mover para cima',
      icon: <ChevronUp className="size-3.5" />,
      disabled: !canUp,
      onSelect: () => moveLayer(group.id, -1, 'group'),
    },
    {
      label: 'Mover para baixo',
      icon: <ChevronDown className="size-3.5" />,
      disabled: !canDown,
      onSelect: () => moveLayer(group.id, 1, 'group'),
    },
    'separator',
    {
      label: 'Sobre',
      icon: <Info className="size-3.5" />,
      onSelect: () => openDialog('layerAbout', { kind: 'group', id: group.id }),
    },
    {
      label: 'Desfazer grupo (mantém as camadas)',
      icon: <Ungroup className="size-3.5" />,
      danger: true,
      onSelect: () => removeGroup(group.id),
    },
  ];

  return (
    <li className={clsx(dnd.dragging && 'opacity-40')}>
      <div
        {...dnd.props}
        onContextMenu={(e) => openMenu(menuAt(e), menu())}
        className={clsx(
          'group relative flex items-center gap-1.5 rounded px-1 py-1 hover:bg-slate-50',
          dnd.props.draggable && 'cursor-grab active:cursor-grabbing',
        )}
      >
        <DropMark where={dnd.over} />
        <DragGrip />
        <button
          type="button"
          className="rounded text-slate-400 hover:text-slate-700"
          onClick={expand}
          aria-label={group.expanded ? 'Recolher grupo' : 'Expandir grupo'}
        >
          {group.expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <input
          ref={checkRef}
          type="checkbox"
          checked={all}
          disabled={!members.length}
          onChange={() => setAll(!all)}
          className="size-3.5 shrink-0 accent-accent-600"
          aria-label="Mostrar camadas do grupo"
        />
        {group.expanded ? (
          <FolderOpen className="size-3.5 shrink-0 text-amber-500" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-amber-500" />
        )}
        {renaming ? (
          <RenameInput
            initial={group.name}
            label="Nome do grupo"
            onDone={(v) => {
              if (v?.trim()) updateGroup(group.id, { name: v.trim() });
              onRenameDone();
            }}
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700"
            title={`${group.name} — duplo clique para renomear · arraste camadas para cá`}
            onDoubleClick={onRename}
          >
            {group.name} <span className="font-normal text-slate-400">({members.length})</span>
          </span>
        )}
      </div>
      {group.expanded &&
        (members.length ? (
          <ul className="space-y-0.5">{children}</ul>
        ) : (
          <p className="ml-9 py-0.5 text-[11px] text-slate-400 italic">
            Vazio — arraste camadas para cá
          </p>
        ))}
    </li>
  );
}

/** Painel de camadas sobre o mapa (estilo QGIS). */
export function LayersPanel({ runtimes }: { runtimes: LayerRuntime[] }) {
  const sources = useSources();
  const layers = useAppStore((s) => s.layers);
  const layerTree = useAppStore((s) => s.layerTree);
  const sourceId = useAppStore((s) => s.sourceId);
  const addLayer = useAppStore((s) => s.addLayer);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const addGroup = useAppStore((s) => s.addGroup);
  const setLayerGroup = useAppStore((s) => s.setLayerGroup);
  const dropLayer = useAppStore((s) => s.dropLayer);
  const openDialog = useAppStore((s) => s.openDialog);
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [renaming, setRenaming] = useState<TreeRef | null>(null);
  const [drag, setDrag] = useState<TreeRef | null>(null);
  const [over, setOver] = useState<{ ref: TreeRef; where: DropWhere } | null>(null);

  // Remove do mapa as camadas cuja configuração de fonte foi excluída.
  useEffect(() => {
    if (!sources.data) return;
    for (const l of layers)
      if (!sources.data.some((s) => s.id === l.sourceId)) removeLayer(l.sourceId);
  }, [sources.data, layers, removeLayer]);

  const tree = useMemo(
    () =>
      normalizeTree(
        layerTree,
        layers.map((l) => l.sourceId),
      ),
    [layerTree, layers],
  );
  const runtimeOf = useMemo(() => new Map(runtimes.map((r) => [r.layer.sourceId, r])), [runtimes]);
  const layerOf = useMemo(() => new Map(layers.map((l) => [l.sourceId, l])), [layers]);
  const available = (sources.data ?? []).filter((s) => !layers.some((l) => l.sourceId === s.id));

  const openMenu: OpenMenu = (at, items) => setMenu({ ...at, items });
  const same = (a: TreeRef | null, b: TreeRef) => !!a && a.kind === b.kind && a.id === b.id;

  const createGroup = (layerId?: string) => {
    const names = new Set(tree.filter(isGroup).map((g) => g.name));
    let n = 1;
    while (names.has(`Grupo ${n}`)) n++;
    const id = addGroup(`Grupo ${n}`);
    if (layerId) setLayerGroup(layerId, id);
    setRenaming({ kind: 'group', id });
  };

  const dndOf = (ref: TreeRef, allowInside: boolean): RowDnd => ({
    props: {
      draggable: !renaming,
      onDragStart: (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ref.id);
        setDrag(ref);
      },
      onDragOver: (e) => {
        if (!drag) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const where = same(drag, ref) ? null : dropZone(e, allowInside && drag.kind === 'layer');
        if (!where) return setOver(null);
        if (!over || !same(over.ref, ref) || over.where !== where) setOver({ ref, where });
      },
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (drag && over) dropLayer(drag, over.ref, over.where);
        setDrag(null);
        setOver(null);
      },
      onDragEnd: () => {
        setDrag(null);
        setOver(null);
      },
    },
    over: over && same(over.ref, ref) ? over.where : null,
    dragging: same(drag, ref),
  });

  const layerRow = (id: string, nested: boolean) => {
    const rt = runtimeOf.get(id);
    if (!rt) return null;
    const ref: TreeRef = { kind: 'layer', id };
    return (
      <LayerRow
        key={id}
        rt={rt}
        active={id === sourceId}
        tree={tree}
        dnd={dndOf(ref, false)}
        renaming={same(renaming, ref)}
        onRename={() => setRenaming(ref)}
        onRenameDone={() => setRenaming(null)}
        openMenu={openMenu}
        onNewGroup={() => createGroup(id)}
        nested={nested}
      />
    );
  };

  const addMenu = (): MenuEntry[] => [
    {
      label: 'Grupo',
      icon: <FolderPlus className="size-3.5" />,
      title: 'Pasta para organizar camadas (arraste camadas para dentro)',
      onSelect: () => createGroup(),
    },
    {
      label: 'Camada',
      icon: <Layers className="size-3.5" />,
      submenu: [
        ...available.map((s) => ({
          label: s.name,
          icon: <Plus className="size-3.5" />,
          title: `${s.schema}.${s.tableName}`,
          onSelect: () => addLayer(s.id),
        })),
        ...(available.length ? (['separator'] as const) : []),
        {
          label: 'Banco de dados…',
          icon: <Database className="size-3.5" />,
          title: 'Escolher uma tabela do banco (schema e tabela)',
          onSelect: () => openDialog('source', 'new'),
        },
        {
          label: 'Importar CSV/XLSX/GeoJSON/KML…',
          icon: <Upload className="size-3.5" />,
          onSelect: () => openDialog('importLayer', true),
        },
        'separator',
        {
          label: 'Configurar fontes…',
          icon: <Settings2 className="size-3.5" />,
          onSelect: () => openDialog('source', true),
        },
      ],
    },
  ];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-md hover:bg-slate-50"
      >
        <Layers className="size-4 text-accent-600" /> Camadas ({layers.length})
      </button>
    );
  }

  return (
    <div className="absolute top-3 left-3 z-10 flex max-h-[calc(100%-7rem)] w-72 max-w-[calc(100%-1.5rem)] flex-col rounded-lg border border-slate-200 bg-white/97 shadow-lg">
      <div className="flex items-center gap-2 border-b border-slate-200 px-2.5 py-1.5">
        <Layers className="size-4 text-accent-600" />
        <span className="flex-1 text-xs font-semibold text-slate-800">Camadas</span>
        <button
          type="button"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu({ x: r.left, y: r.bottom + 2 }, addMenu());
          }}
          className="inline-flex h-6 items-center gap-1 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-700 hover:bg-slate-50"
          aria-haspopup="menu"
          title="Adicionar grupo ou camada"
        >
          <Plus className="size-3.5" /> Adicionar <ChevronDown className="size-3 text-slate-400" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Recolher painel de camadas"
        >
          <ChevronUp className="size-4" />
        </button>
      </div>
      <div className="scroll-thin overflow-y-auto p-1.5">
        {tree.length ? (
          <ul className="space-y-0.5">
            {tree.map((n) =>
              isGroup(n) ? (
                <GroupRow
                  key={n.id}
                  group={n}
                  tree={tree}
                  members={n.children.map((id) => layerOf.get(id)!).filter(Boolean)}
                  dnd={dndOf({ kind: 'group', id: n.id }, true)}
                  renaming={same(renaming, { kind: 'group', id: n.id })}
                  onRename={() => setRenaming({ kind: 'group', id: n.id })}
                  onRenameDone={() => setRenaming(null)}
                  openMenu={openMenu}
                >
                  {n.children.map((id) => layerRow(id, true))}
                </GroupRow>
              ) : (
                layerRow(n.id, false)
              ),
            )}
          </ul>
        ) : (
          <div className="space-y-2 p-2 text-xs text-slate-500">
            <p>Nenhuma camada no mapa.</p>
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium text-accent-700 hover:underline"
              onClick={() => openDialog('source', 'new')}
            >
              <Plus className="size-3.5" /> Adicionar tabela do banco de dados
            </button>
          </div>
        )}
        {layers.length > 0 && (
          <p className="px-1 pt-1.5 text-[11px] text-slate-400">
            Clique no nome para ativar · arraste para reordenar ou pôr num grupo · botão direito:
            opções.
          </p>
        )}
        <BoundariesSection openMenu={openMenu} />
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
