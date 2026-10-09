import clsx from 'clsx';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Layers,
  Loader2,
  Palette,
  Plus,
  Type,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LayerRuntime } from '@/hooks/useLayers';
import { queryKeys, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { catKey, categoryStyle, switchLabelTemplate } from '@/lib/layers';
import { TEMP_SCHEMA, layersService } from '@/services/layers';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import type { LayerStyle } from '@/types';
import { fmtInt, fmtValue } from '@/utils/format';
import { toast } from '../ui/Toaster';
import { BoundariesSection } from './BoundariesSection';
import { ActionButton, ColorDot } from './LayerControls';

const MAX_CATEGORIES = 60;

function LayerRow({
  rt,
  active,
  first,
  last,
}: {
  rt: LayerRuntime;
  active: boolean;
  first: boolean;
  last: boolean;
}) {
  const { layer, source, prepared } = rt;
  const id = layer.sourceId;
  const setSource = useAppStore((s) => s.setSource);
  const updateLayer = useAppStore((s) => s.updateLayer);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const moveLayer = useAppStore((s) => s.moveLayer);
  const openDialog = useAppStore((s) => s.openDialog);
  const focusMap = useAppStore((s) => s.focusMap);
  const categorized = !!rt.styleColumn && !!prepared?.categorized;

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

  return (
    <li>
      <div
        className={clsx(
          'group flex items-center gap-1.5 rounded px-1 py-1',
          active ? 'bg-accent-50 ring-1 ring-accent-300' : 'hover:bg-slate-50',
        )}
      >
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
        <button
          type="button"
          onClick={() => setSource(id)}
          className={clsx(
            'min-w-0 flex-1 truncate text-left text-xs',
            active
              ? 'font-semibold text-accent-800 underline decoration-accent-400 underline-offset-2'
              : 'text-slate-700',
            !layer.visible && 'text-slate-400 italic',
          )}
          title={
            active
              ? 'Camada ativa (seleção, filtros, edição e exportação)'
              : 'Clique para tornar a camada ativa'
          }
        >
          {source?.name ?? '…'}
          {rt.total !== null && (
            <span className="ml-1 font-normal text-slate-400">[{fmtInt(rt.total)}]</span>
          )}
        </button>
        {rt.isFetching && <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-600" />}
        {rt.mode === 'viewport' && (
          <span title="Tabela grande: pontos carregados por região do mapa">
            <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
          </span>
        )}
        <div
          className={clsx('flex shrink-0 items-center', !active && 'lg:hidden lg:group-hover:flex')}
        >
          <ActionButton
            title="Estilo (cor e tamanho)"
            onClick={() => openDialog('layerStyle', { sourceId: id, tab: 'symbology' })}
          >
            <Palette className="size-3.5" />
          </ActionButton>
          <ActionButton
            title={layer.label.enabled ? 'Rótulos (ligados)' : 'Rótulos'}
            active={layer.label.enabled}
            onClick={() => openDialog('layerStyle', { sourceId: id, tab: 'labels' })}
          >
            <Type className="size-3.5" />
          </ActionButton>
          <ActionButton title="Aproximar da camada" onClick={zoomTo}>
            <Crosshair className="size-3.5" />
          </ActionButton>
          {!first && (
            <ActionButton title="Mover para cima" onClick={() => moveLayer(id, -1)}>
              <ChevronUp className="size-3.5" />
            </ActionButton>
          )}
          {!last && (
            <ActionButton title="Mover para baixo" onClick={() => moveLayer(id, 1)}>
              <ChevronDown className="size-3.5" />
            </ActionButton>
          )}
          {armed ? (
            <button
              type="button"
              onClick={remove}
              disabled={removing}
              className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              title={`Apagar a tabela ${TEMP_SCHEMA}.${source?.tableName ?? ''} e remover a camada`}
            >
              {removing ? 'Apagando…' : 'Apagar tabela?'}
            </button>
          ) : (
            <ActionButton
              title={
                isTemp
                  ? `Remover do mapa e apagar a tabela temporária (${TEMP_SCHEMA})`
                  : 'Remover do mapa'
              }
              onClick={remove}
            >
              <X className="size-3.5" />
            </ActionButton>
          )}
        </div>
      </div>
      {!!layer.labelTemplates?.length && (
        <div className="ml-10 flex items-center gap-1.5 py-0.5 pr-1">
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
        <ul className="mt-0.5 mb-1 ml-8 space-y-0.5">
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

/** Painel de camadas sobre o mapa (estilo QGIS). */
export function LayersPanel({ runtimes }: { runtimes: LayerRuntime[] }) {
  const sources = useSources();
  const layers = useAppStore((s) => s.layers);
  const sourceId = useAppStore((s) => s.sourceId);
  const addLayer = useAppStore((s) => s.addLayer);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const openDialog = useAppStore((s) => s.openDialog);
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);

  // Remove do mapa as camadas cuja configuração de fonte foi excluída.
  useEffect(() => {
    if (!sources.data) return;
    for (const l of layers)
      if (!sources.data.some((s) => s.id === l.sourceId)) removeLayer(l.sourceId);
  }, [sources.data, layers, removeLayer]);

  const available = (sources.data ?? []).filter((s) => !layers.some((l) => l.sourceId === s.id));

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
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__config') openDialog('source', true);
            else if (v === '__import') openDialog('importLayer', true);
            else if (v) addLayer(v);
          }}
          className="h-6 max-w-28 rounded border border-slate-300 bg-white px-1 text-xs text-slate-700"
          aria-label="Adicionar camada"
          title="Adicionar tabela ao mapa"
        >
          <option value="">+ Adicionar</option>
          {available.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="__import">Importar CSV/XLSX/GeoJSON/KML…</option>
          <option value="__config">Configurar fontes…</option>
        </select>
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
        {runtimes.length ? (
          <ul className="space-y-0.5">
            {runtimes.map((rt, i) => (
              <LayerRow
                key={rt.layer.sourceId}
                rt={rt}
                active={rt.layer.sourceId === sourceId}
                first={i === 0}
                last={i === runtimes.length - 1}
              />
            ))}
          </ul>
        ) : (
          <div className="space-y-2 p-2 text-xs text-slate-500">
            <p>Nenhuma camada no mapa.</p>
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium text-accent-700 hover:underline"
              onClick={() => openDialog('source', true)}
            >
              <Plus className="size-3.5" /> Configurar fonte de dados
            </button>
          </div>
        )}
        {runtimes.length > 1 && (
          <p className="px-1 pt-1.5 text-[11px] text-slate-400">
            Clique no nome para tornar a camada ativa · clicar em um ponto também ativa a camada
            dele.
          </p>
        )}
        <BoundariesSection />
      </div>
    </div>
  );
}
