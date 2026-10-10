import clsx from 'clsx';
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Minus,
  Palette,
  Pencil,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { BOUNDARY_ACCEPT, useImportBoundaries } from '@/hooks/useImportBoundaries';
import { boundaryStore } from '@/lib/boundaries';
import { dropZone } from '@/lib/layerTree';
import { useAppStore } from '@/stores/appStore';
import type { BoundaryLayer } from '@/types';
import { fmtInt } from '@/utils/format';
import type { MenuEntry } from '../ui/Menu';
import { ColorDot, DragGrip, DropMark } from './LayerControls';
import type { OpenMenu } from './LayersPanel';

const WIDTHS = [1, 2, 3, 4, 5, 6, 8];

/**
 * Limites (shapefile/GeoJSON/KML) no painel de camadas: importar, renomear, cor/espessura da borda,
 * mostrar, reordenar (setas ou arrastando), remover; tudo também no botão direito.
 */
export function BoundariesSection({ openMenu }: { openMenu: OpenMenu }) {
  const boundaries = useAppStore((s) => s.boundaries);
  const updateBoundary = useAppStore((s) => s.updateBoundary);
  const removeBoundary = useAppStore((s) => s.removeBoundary);
  const moveBoundary = useAppStore((s) => s.moveBoundary);
  const dropBoundary = useAppStore((s) => s.dropBoundary);
  const openDialog = useAppStore((s) => s.openDialog);
  const focusMap = useAppStore((s) => s.focusMap);
  const inputRef = useRef<HTMLInputElement>(null);
  const { importFiles, loading } = useImportBoundaries();
  /** Limite sendo renomeado (só o nome exibido; o arquivo original não muda). */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: 'before' | 'after' } | null>(null);
  const commitRename = () => {
    if (editing?.name.trim()) updateBoundary(editing.id, { name: editing.name.trim() });
    setEditing(null);
  };

  const onFiles = async (files: FileList | null) => {
    await importFiles(files);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (b: BoundaryLayer) => {
    removeBoundary(b.id);
    void boundaryStore.remove(b.id);
  };

  const menu = (b: BoundaryLayer, i: number): MenuEntry[] => [
    {
      label: 'Editar nome',
      icon: <Pencil className="size-3.5" />,
      onSelect: () => setEditing({ id: b.id, name: b.name }),
    },
    'separator',
    {
      label: 'Cor da borda…',
      icon: <Palette className="size-3.5" />,
      // O menu fecha antes: abre o seletor de cor da bolinha no próximo quadro.
      onSelect: () =>
        requestAnimationFrame(() =>
          (document.getElementById(`boundary-color-${b.id}`) as HTMLInputElement | null)?.click(),
        ),
    },
    {
      label: `Espessura (${b.width}px)`,
      icon: <Minus className="size-3.5" />,
      submenu: WIDTHS.map((w) => ({
        label: `${w}px`,
        checked: w === b.width,
        onSelect: () => updateBoundary(b.id, { width: w }),
      })),
    },
    {
      label: 'Aproximar do limite',
      icon: <Crosshair className="size-3.5" />,
      disabled: !b.bounds,
      onSelect: () => b.bounds && focusMap({ bounds: b.bounds }),
    },
    {
      label: b.visible ? 'Ocultar no mapa' : 'Mostrar no mapa',
      icon: b.visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />,
      onSelect: () => updateBoundary(b.id, { visible: !b.visible }),
    },
    'separator',
    {
      label: 'Mover para cima',
      icon: <ChevronUp className="size-3.5" />,
      disabled: i === 0,
      onSelect: () => moveBoundary(b.id, -1),
    },
    {
      label: 'Mover para baixo',
      icon: <ChevronDown className="size-3.5" />,
      disabled: i === boundaries.length - 1,
      onSelect: () => moveBoundary(b.id, 1),
    },
    'separator',
    {
      label: 'Sobre',
      icon: <Info className="size-3.5" />,
      onSelect: () => openDialog('layerAbout', { kind: 'boundary', id: b.id }),
    },
    {
      label: 'Remover limite',
      icon: <X className="size-3.5" />,
      danger: true,
      onSelect: () => remove(b),
    },
  ];

  return (
    <div className="mt-1.5 border-t border-slate-200 pt-1.5">
      <div className="flex items-center gap-2 px-1 pb-1">
        <span className="flex-1 text-xs font-semibold text-slate-800">Limites</span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Shapefile (.zip, ou .shp + .dbf + .prj juntos), GeoJSON ou KML"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}{' '}
          Adicionar
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={BOUNDARY_ACCEPT}
          multiple
          hidden
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>
      {boundaries.length ? (
        <ul className="space-y-0.5">
          {boundaries.map((b, i) => (
            <li
              key={b.id}
              draggable={!editing}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', b.id);
                setDrag(b.id);
              }}
              onDragOver={(e) => {
                if (!drag || drag === b.id) return;
                e.preventDefault();
                e.stopPropagation();
                const where = dropZone(e) as 'before' | 'after';
                if (over?.id !== b.id || over.where !== where) setOver({ id: b.id, where });
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (drag && over) dropBoundary(drag, over.id, over.where);
                setDrag(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openMenu({ x: e.clientX, y: e.clientY }, menu(b, i));
              }}
              className={clsx(
                'group relative flex items-center gap-1.5 rounded px-1 py-1 hover:bg-slate-50',
                !editing && 'cursor-grab active:cursor-grabbing',
                drag === b.id && 'opacity-40',
              )}
            >
              <DropMark where={over?.id === b.id ? over.where : null} />
              <DragGrip />
              <input
                type="checkbox"
                checked={b.visible}
                onChange={() => updateBoundary(b.id, { visible: !b.visible })}
                className="ml-5 size-3.5 shrink-0 accent-accent-600"
                aria-label="Mostrar limite"
              />
              <ColorDot
                color={b.color}
                title="Cor da borda"
                inputId={`boundary-color-${b.id}`}
                onChange={(color) => updateBoundary(b.id, { color })}
              />
              {editing?.id === b.id ? (
                <input
                  autoFocus
                  value={editing.name}
                  maxLength={120}
                  onChange={(e) => setEditing({ id: b.id, name: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  className="h-5 min-w-0 flex-1 rounded border border-accent-400 bg-white px-1 text-xs text-slate-800 outline-none"
                  aria-label="Nome do limite"
                />
              ) : (
                <span
                  className={clsx(
                    'min-w-0 flex-1 truncate text-xs',
                    b.visible ? 'text-slate-700' : 'text-slate-400 italic',
                  )}
                  title={`${b.name} — duplo clique para renomear · botão direito: opções`}
                  onDoubleClick={() => setEditing({ id: b.id, name: b.name })}
                >
                  {b.name} <span className="text-slate-400">[{fmtInt(b.features)}]</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 pb-1 text-[11px] text-slate-400">
          Importe um shapefile (.zip ou .shp + .dbf + .prj), GeoJSON ou KML.
        </p>
      )}
    </div>
  );
}
