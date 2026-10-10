import type { GeoJSONSourceSpecification, Map as MlMap } from 'maplibre-gl';
import clsx from 'clsx';
import {
  Check,
  ChevronDown,
  Info,
  Link2,
  Map as MapIcon,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_BASEMAPS,
  moveBasemap,
  orderedBasemaps,
  parseXyzUrl,
  resolveBasemap,
  type BasemapDef,
  type BasemapItem,
} from '@/lib/basemaps';
import { boundaryStore } from '@/lib/boundaries';
import { dropZone } from '@/lib/layerTree';
import { DragGrip, DropMark } from '../layers/LayerControls';
import { useMap } from '@/lib/mapContext';
import { useAppStore } from '@/stores/appStore';
import { Button } from '../ui/Button';
import { Menu, type MenuEntry } from '../ui/Menu';
import { BasemapAboutDialog, BasemapLinkDialog } from './BasemapDialogs';

const BASE = 'basemap';
const OVERLAY = 'basemap-overlay';

/** Primeira camada acima do fundo (limites/ferramentas): o fundo raster entra logo abaixo dela. */
const firstAboveBackground = (map: MlMap) =>
  map.getStyle().layers.find((l) => l.id !== 'background' && l.id !== BASE && l.id !== OVERLAY)?.id;

/** Troca o fundo raster (tiles XYZ) mantendo limites e ferramentas por cima. */
function applyBasemap(map: MlMap, def: BasemapDef) {
  for (const id of [OVERLAY, BASE]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  map.setPaintProperty('background', 'background-color', def.background ?? '#eef1f4');
  const before = firstAboveBackground(map);
  if (def.tiles.length) {
    map.addSource(BASE, {
      type: 'raster',
      tiles: def.tiles,
      tileSize: 256,
      maxzoom: def.maxzoom,
      scheme: def.scheme ?? 'xyz',
      attribution: def.attribution,
    });
    map.addLayer({ id: BASE, type: 'raster', source: BASE }, before);
  }
  if (def.overlay) {
    map.addSource(OVERLAY, {
      type: 'raster',
      tiles: def.overlay.tiles,
      tileSize: 256,
      maxzoom: def.overlay.maxzoom,
    });
    map.addLayer({ id: OVERLAY, type: 'raster', source: OVERLAY }, before);
  }
}

/** Formulário para adicionar um fundo por URL de tiles XYZ (como "Conexão XYZ" no QGIS). */
function AddBasemapForm({ onClose }: { onClose: () => void }) {
  const addCustomBasemap = useAppStore((s) => s.addCustomBasemap);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [maxZoom, setMaxZoom] = useState(19);
  const valid = !!name.trim() && !!parseXyzUrl(url);

  return (
    <div className="absolute top-12 right-3 z-30 w-80 max-w-[calc(100%-1.5rem)] space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-xl">
      <div className="flex items-center justify-between">
        <b className="text-sm text-slate-800">Adicionar mapa por URL (XYZ)</b>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </button>
      </div>
      <label className="block">
        Nome
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoFocus
          className="mt-0.5 block h-7 w-full rounded-md border border-slate-300 px-2 text-sm focus:border-accent-500 focus:outline-none"
        />
      </label>
      <label className="block">
        URL dos tiles
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://servidor/{z}/{x}/{y}.png"
          spellCheck={false}
          className="mt-0.5 block h-7 w-full rounded-md border border-slate-300 px-2 font-mono text-[11px] focus:border-accent-500 focus:outline-none"
        />
      </label>
      <label className="flex items-center gap-2">
        Zoom máximo do servidor
        <input
          type="number"
          min={1}
          max={24}
          value={maxZoom}
          onChange={(e) => setMaxZoom(Math.min(24, Math.max(1, Number(e.target.value) || 19)))}
          className="h-7 w-16 rounded-md border border-slate-300 px-2 text-sm"
        />
      </label>
      <p className="text-[11px] leading-snug text-slate-500">
        Aceita {'{z}'} {'{x}'} {'{y}'}, {'{q}'} (quadkey), {'{s}'} e {'{-y}'}, como no QGIS. Use
        apenas serviços cujos termos permitam esse acesso — Google e Bing, por exemplo, não liberam
        o uso direto dos tiles.
      </p>
      {url && !parseXyzUrl(url) && (
        <p className="text-[11px] text-red-600">
          A URL precisa começar com http(s) e ter {'{z}'}, {'{x}'} e {'{y}'} (ou {'{q}'}).
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!valid}
          onClick={() => {
            addCustomBasemap({
              id: Date.now().toString(36),
              name: name.trim(),
              url: url.trim(),
              maxZoom,
            });
            onClose();
          }}
        >
          Adicionar
        </Button>
      </div>
    </div>
  );
}

/**
 * Lista dos fundos (no lugar do select nativo, que não deixa arrastar): clique escolhe; clicar,
 * segurar e arrastar muda a ordem da lista (salva no projeto).
 */
export function BasemapPicker({
  current,
  label,
  onAdd,
}: {
  current: string;
  label: string;
  onAdd: () => void;
}) {
  const custom = useAppStore((s) => s.customBasemaps);
  const order = useAppStore((s) => s.basemapOrder);
  const names = useAppStore((s) => s.basemapNames);
  const setBasemap = useAppStore((s) => s.setBasemap);
  const setBasemapOrder = useAppStore((s) => s.setBasemapOrder);
  const setBasemapName = useAppStore((s) => s.setBasemapName);
  const updateCustomBasemap = useAppStore((s) => s.updateCustomBasemap);
  const removeCustomBasemap = useAppStore((s) => s.removeCustomBasemap);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: 'before' | 'after' } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  /** Fundo sendo renomeado na lista */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'link' | 'about'; id: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => orderedBasemaps(order, custom, names), [order, custom, names]);

  const rename = (id: string, value: string) => {
    if (id.startsWith('xyz:')) {
      if (value.trim()) updateCustomBasemap(id.slice(4), { name: value.trim() });
    } else {
      setBasemapName(id, value);
    }
  };

  const menuFor = (b: BasemapItem): MenuEntry[] => {
    const builtin = BUILTIN_BASEMAPS.find((x) => x.id === b.id);
    return [
      {
        label: 'Usar este mapa',
        icon: <Check className="size-3.5" />,
        disabled: b.id === current,
        onSelect: () => {
          setBasemap(b.id);
          setOpen(false);
        },
      },
      'separator',
      {
        label: 'Renomear',
        icon: <Pencil className="size-3.5" />,
        onSelect: () => setRenaming(b.id),
      },
      ...(builtin && names[b.id]
        ? [
            {
              label: `Restaurar nome (${builtin.label})`,
              icon: <RotateCcw className="size-3.5" />,
              onSelect: () => setBasemapName(b.id, ''),
            },
          ]
        : []),
      {
        label: b.custom ? 'Ver/editar link…' : 'Ver link…',
        icon: <Link2 className="size-3.5" />,
        disabled: !b.custom && !builtin?.tiles.length,
        onSelect: () => setDialog({ kind: 'link', id: b.id }),
      },
      {
        label: 'Sobre',
        icon: <Info className="size-3.5" />,
        onSelect: () => setDialog({ kind: 'about', id: b.id }),
      },
      ...(b.custom
        ? [
            'separator' as const,
            {
              label: 'Remover mapa',
              icon: <X className="size-3.5" />,
              danger: true,
              onSelect: () => removeCustomBasemap(b.id.slice(4)),
            },
          ]
        : []),
    ];
  };

  // Fecha ao clicar fora (o menu do botão direito conta como dentro) ou com Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (rootRef.current?.contains(t) || t.closest?.('[role="menu"]')) return;
      setOpen(false);
      setRenaming(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-44 items-center gap-1 text-xs font-medium outline-none"
        title="Mapa de fundo"
        aria-label="Mapa de fundo"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 w-60 rounded-md border border-slate-200 bg-white py-1 text-xs text-slate-700 shadow-xl">
          <ul
            role="listbox"
            aria-label="Mapas de fundo"
            className="scroll-thin max-h-80 overflow-y-auto"
          >
            {items.map((b) => (
              <li
                key={b.id}
                role="option"
                aria-selected={b.id === current}
                draggable={renaming !== b.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, items: menuFor(b) });
                }}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', b.id);
                  setDrag(b.id);
                }}
                onDragOver={(e) => {
                  if (!drag || drag === b.id) return;
                  e.preventDefault();
                  const where = dropZone(e) as 'before' | 'after';
                  if (over?.id !== b.id || over.where !== where) setOver({ id: b.id, where });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag && over) {
                    setBasemapOrder(
                      moveBasemap(
                        items.map((i) => i.id),
                        drag,
                        over.id,
                        over.where,
                      ),
                    );
                  }
                  endDrag();
                }}
                onDragEnd={endDrag}
                onClick={() => {
                  if (renaming === b.id) return;
                  setBasemap(b.id);
                  setOpen(false);
                }}
                className={clsx(
                  'group relative flex cursor-grab items-center gap-1.5 px-2 py-1.5 active:cursor-grabbing',
                  b.id === current
                    ? 'bg-accent-50 font-medium text-accent-800'
                    : 'hover:bg-slate-100',
                  drag === b.id && 'opacity-40',
                )}
                title="Clique para usar · arraste para mudar a ordem · botão direito: opções"
              >
                <DropMark where={over?.id === b.id ? over.where : null} />
                <DragGrip />
                {renaming === b.id ? (
                  <RenameField
                    initial={b.label}
                    onDone={(v) => {
                      if (v !== null) rename(b.id, v);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{b.label}</span>
                )}
                {b.custom && (
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">
                    URL
                  </span>
                )}
                {b.id === current && <Check className="size-3.5 shrink-0 text-accent-600" />}
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-slate-100 pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAdd();
              }}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-slate-100"
            >
              <Plus className="size-3.5 text-slate-500" /> Adicionar por URL (XYZ)…
            </button>
          </div>
        </div>
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dialog?.kind === 'link' && (
        <BasemapLinkDialog id={dialog.id} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'about' && (
        <BasemapAboutDialog id={dialog.id} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

/** Campo de renomear na lista: Enter/sair grava, Esc cancela (vazio volta ao nome original). */
function RenameField({
  initial,
  onDone,
}: {
  initial: string;
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
      maxLength={60}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(value);
        if (e.key === 'Escape') finish(null);
      }}
      className="h-5 min-w-0 flex-1 rounded border border-accent-400 bg-white px-1 text-xs text-slate-800 outline-none"
      aria-label="Nome do mapa"
    />
  );
}

/** Seletor do mapa de fundo (gratuitos, sem chave) + fundos adicionados por URL. */
export function BasemapControl({ hidden = false }: { hidden?: boolean }) {
  const map = useMap();
  const basemap = useAppStore((s) => s.basemap);
  const custom = useAppStore((s) => s.customBasemaps);
  const removeCustomBasemap = useAppStore((s) => s.removeCustomBasemap);
  const names = useAppStore((s) => s.basemapNames);
  const [adding, setAdding] = useState(false);
  const def = useMemo(() => resolveBasemap(basemap, custom), [basemap, custom]);
  const customId = def.id.startsWith('xyz:') ? def.id.slice(4) : null;
  const applied = useRef<{ map: MlMap; key: string } | null>(null);

  useEffect(() => {
    if (!map) return;
    // Só reaplica (e recarrega os tiles) se o fundo mudou de fato.
    const key = JSON.stringify(def);
    if (applied.current?.map === map && applied.current.key === key) return;
    applyBasemap(map, def);
    applied.current = { map, key };
  }, [map, def]);

  // Exibir › Mapas de fundo desligado: some só o seletor; o fundo continua aplicado no mapa.
  if (hidden) return null;
  return (
    <>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs text-slate-700 shadow-md">
        <MapIcon className="size-4 text-accent-600" />
        <BasemapPicker
          current={def.id}
          label={names[def.id] || def.label}
          onAdd={() => setAdding(true)}
        />
        {customId && (
          <button
            type="button"
            onClick={() => removeCustomBasemap(customId)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
            title="Remover este mapa de fundo"
            aria-label="Remover este mapa de fundo"
          >
            <X className="size-3.5" />
          </button>
        )}
        {!customId && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Adicionar mapa por URL (XYZ)"
            aria-label="Adicionar mapa por URL (XYZ)"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      {adding && <AddBasemapForm onClose={() => setAdding(false)} />}
    </>
  );
}

/** Camadas de limites: polígonos sem preenchimento, só a borda colorida (abaixo das ferramentas). */
export function BoundariesLayer() {
  const map = useMap();
  const boundaries = useAppStore((s) => s.boundaries);
  const latest = useRef(boundaries);
  latest.current = boundaries;
  const loading = useRef(new Set<string>());

  useEffect(() => {
    if (!map) return;
    const lid = (id: string) => `bnd-${id}`;
    const toolLayer = () => map.getStyle().layers.find((l) => l.id.startsWith('tool-'))?.id;
    /** Ordem do painel: o primeiro limite fica por cima. */
    const reorder = () => {
      const list = latest.current;
      for (let i = list.length - 1; i >= 0; i--)
        if (map.getLayer(lid(list[i].id))) map.moveLayer(lid(list[i].id), toolLayer());
    };
    const ids = new Set(boundaries.map((b) => b.id));
    for (const l of map.getStyle().layers) {
      if (!l.id.startsWith('bnd-') || ids.has(l.id.slice(4))) continue;
      map.removeLayer(l.id);
      if (map.getSource(l.id)) map.removeSource(l.id);
    }
    for (const b of boundaries) {
      const id = lid(b.id);
      const paint = { 'line-color': b.color, 'line-width': b.width };
      const visibility = b.visible ? 'visible' : 'none';
      if (map.getLayer(id)) {
        map.setPaintProperty(id, 'line-color', paint['line-color']);
        map.setPaintProperty(id, 'line-width', paint['line-width']);
        map.setLayoutProperty(id, 'visibility', visibility);
        continue;
      }
      if (loading.current.has(b.id)) continue;
      loading.current.add(b.id);
      void boundaryStore.get(b.id).then((data) => {
        loading.current.delete(b.id);
        const cur = latest.current.find((x) => x.id === b.id);
        if (!data || !cur || map.getLayer(id)) return;
        map.addSource(id, { type: 'geojson', data } as GeoJSONSourceSpecification);
        map.addLayer(
          {
            id,
            type: 'line',
            source: id,
            paint: { 'line-color': cur.color, 'line-width': cur.width },
            layout: { visibility: cur.visible ? 'visible' : 'none', 'line-join': 'round' },
          },
          toolLayer(),
        );
        reorder();
      });
    }
    reorder();
  }, [map, boundaries]);

  return null;
}
