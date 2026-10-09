import clsx from 'clsx';
import { Crosshair, Loader2, Pencil, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { BOUNDARY_ACCEPT, useImportBoundaries } from '@/hooks/useImportBoundaries';
import { boundaryStore } from '@/lib/boundaries';
import { useAppStore } from '@/stores/appStore';
import { fmtInt } from '@/utils/format';
import { ActionButton, ColorDot } from './LayerControls';

const WIDTHS = [1, 2, 3, 4, 5, 6, 8];

/**
 * Limites (shapefile/GeoJSON/KML) no painel de camadas: importar, renomear, cor/espessura da borda,
 * mostrar, remover.
 */
export function BoundariesSection() {
  const boundaries = useAppStore((s) => s.boundaries);
  const updateBoundary = useAppStore((s) => s.updateBoundary);
  const removeBoundary = useAppStore((s) => s.removeBoundary);
  const focusMap = useAppStore((s) => s.focusMap);
  const inputRef = useRef<HTMLInputElement>(null);
  const { importFiles, loading } = useImportBoundaries();
  /** Limite sendo renomeado (só o nome exibido; o arquivo original não muda). */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const commitRename = () => {
    if (editing?.name.trim()) updateBoundary(editing.id, { name: editing.name.trim() });
    setEditing(null);
  };

  const onFiles = async (files: FileList | null) => {
    await importFiles(files);
    if (inputRef.current) inputRef.current.value = '';
  };

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
          {boundaries.map((b) => (
            <li
              key={b.id}
              className="group flex items-center gap-1.5 rounded px-1 py-1 hover:bg-slate-50"
            >
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
                  title={`${b.name} — duplo clique para renomear`}
                  onDoubleClick={() => setEditing({ id: b.id, name: b.name })}
                >
                  {b.name} <span className="text-slate-400">[{fmtInt(b.features)}]</span>
                </span>
              )}
              <select
                value={b.width}
                onChange={(e) => updateBoundary(b.id, { width: Number(e.target.value) })}
                className="h-5 shrink-0 rounded border border-slate-300 bg-white text-[11px] text-slate-600"
                title="Espessura da borda"
                aria-label="Espessura da borda"
              >
                {WIDTHS.map((w) => (
                  <option key={w} value={w}>
                    {w}px
                  </option>
                ))}
              </select>
              <div className="flex shrink-0 items-center lg:hidden lg:group-hover:flex">
                <ActionButton
                  title="Renomear limite"
                  onClick={() => setEditing({ id: b.id, name: b.name })}
                >
                  <Pencil className="size-3.5" />
                </ActionButton>
                {b.bounds && (
                  <ActionButton
                    title="Aproximar do limite"
                    onClick={() => focusMap({ bounds: b.bounds! })}
                  >
                    <Crosshair className="size-3.5" />
                  </ActionButton>
                )}
                <ActionButton
                  title="Remover limite"
                  onClick={() => {
                    removeBoundary(b.id);
                    void boundaryStore.remove(b.id);
                  }}
                >
                  <X className="size-3.5" />
                </ActionButton>
              </div>
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
