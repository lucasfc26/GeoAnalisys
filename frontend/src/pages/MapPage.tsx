import clsx from 'clsx';
import type { Map as MlMap } from 'maplibre-gl';
import { WifiOff } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { RightPanel } from '@/components/layout/RightPanel';
import { ToolPanel, useToolActions } from '@/components/layout/ToolPanel';
import { TopBar } from '@/components/layout/TopBar';
import { toast } from '@/components/ui/Toaster';
import { useActiveSource } from '@/hooks/useSourceData';
import { useOnline } from '@/hooks/useOnline';
import { useShortcuts } from '@/hooks/useShortcuts';
import { errorMessage } from '@/lib/api';
import { MapContext } from '@/lib/mapContext';
import type { ToolbarSide } from '@/lib/toolbar';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { Loader2 } from 'lucide-react';

// Componentes pesados e diálogos carregados sob demanda.
const MapView = lazy(() => import('@/components/map/MapView'));
const SourceConfigDialog = lazy(() => import('@/components/tables/SourceConfigDialog'));
const PointFormDialog = lazy(() => import('@/components/forms/PointFormDialog'));
const BulkEditDialog = lazy(() => import('@/components/forms/BulkEditDialog'));
const DeleteConfirmDialog = lazy(() => import('@/components/forms/DeleteConfirmDialog'));
const FilterDialog = lazy(() => import('@/components/forms/FilterDialog'));
const ExportDialog = lazy(() => import('@/components/export/ExportDialog'));
const LayerStyleDialog = lazy(() => import('@/components/layers/LayerStyleDialog'));
const ChangesDialog = lazy(() => import('@/components/changes/ChangesDialog'));
const ImportLayerDialog = lazy(() => import('@/components/layers/ImportLayerDialog'));
const CopyToLayerDialog = lazy(() => import('@/components/layers/CopyToLayerDialog'));
const ConvertCoordsDialog = lazy(() => import('@/components/layers/ConvertCoordsDialog'));
const DuplicateDialog = lazy(() => import('@/components/forms/DuplicateDialog'));
const MapMakerDialog = lazy(() => import('@/components/maps/MapMakerDialog'));
const AssociateLayersDialog = lazy(() => import('@/components/tools/AssociateLayersDialog'));
const DuplicatesDialog = lazy(() => import('@/components/tools/DuplicatesDialog'));
const OutsideBoundaryDialog = lazy(() => import('@/components/tools/OutsideBoundaryDialog'));
const AttributeDistanceDialog = lazy(() => import('@/components/tools/AttributeDistanceDialog'));
const ComparisonDialog = lazy(() => import('@/components/tools/ComparisonDialog'));
const LayerAboutDialog = lazy(() => import('@/components/layers/LayerAboutDialog'));
const ShortcutsDialog = lazy(() => import('@/components/help/ShortcutsDialog'));

function Dialogs() {
  const d = useAppStore((s) => s.dialogs);
  return (
    <Suspense fallback={null}>
      {d.source && <SourceConfigDialog />}
      {d.form && <PointFormDialog />}
      {d.bulkEdit && <BulkEditDialog />}
      {d.confirmDelete && <DeleteConfirmDialog />}
      {d.filters && <FilterDialog />}
      {d.export && <ExportDialog />}
      {d.layerStyle && <LayerStyleDialog key={d.layerStyle.sourceId + d.layerStyle.tab} />}
      {d.changes && <ChangesDialog />}
      {d.importLayer && <ImportLayerDialog />}
      {d.copyToLayer && <CopyToLayerDialog />}
      {d.duplicate && <DuplicateDialog />}
      {d.convertCoords && <ConvertCoordsDialog key={d.convertCoords.sourceId} />}
      {d.mapMaker && <MapMakerDialog />}
      {d.associate && <AssociateLayersDialog />}
      {d.duplicates && <DuplicatesDialog />}
      {d.outsideBoundary && <OutsideBoundaryDialog />}
      {d.attributeDistance && <AttributeDistanceDialog />}
      {d.comparison && <ComparisonDialog />}
      {d.layerAbout && <LayerAboutDialog />}
      {d.shortcuts && <ShortcutsDialog />}
    </Suspense>
  );
}

/** Ao abrir o sistema com uma fonte salva, enquadra o mapa nos pontos. */
function InitialFit() {
  const { sourceId, sources } = useActiveSource();
  const setSource = useAppStore((s) => s.setSource);
  const openDialog = useAppStore((s) => s.openDialog);
  const focusMap = useAppStore((s) => s.focusMap);
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !sources.data) return;
    done.current = true;
    if (!sources.data.length) {
      openDialog('source', true);
      return;
    }
    const id = sources.data.some((s) => s.id === sourceId) ? sourceId! : sources.data[0].id;
    // Também garante que a camada ativa esteja no mapa.
    setSource(id);
    // Projeto aberto com a posição do mapa salva: fica nela.
    if (useAppStore.getState().focus) return;
    pointsService
      .extent(id, useAppStore.getState().filters)
      .then((ext) => ext.bounds && focusMap({ bounds: ext.bounds }))
      .catch((err) => toast.error(errorMessage(err)));
  }, [sources.data, sourceId, setSource, openDialog, focusMap]);

  return null;
}

function Workspace() {
  const actions = useToolActions();
  useShortcuts(actions);
  const online = useOnline();
  const infoHidden = useAppStore((s) => s.viewHidden.info);
  const side = useAppStore((s) => s.toolbarSide);
  // Telas grandes: barra no lado escolhido; pequenas: sempre embaixo, sobre o mapa.
  const bar = (at: ToolbarSide) =>
    side === at && (
      <div
        className={clsx(
          'hidden min-h-0 min-w-0 lg:flex',
          at === 'top' || at === 'bottom' ? 'flex-col' : '',
        )}
      >
        <ToolPanel side={at} />
      </div>
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-amber-500 px-3 py-1 text-xs font-medium text-white">
          <WifiOff className="size-3.5" /> Sem conexão — os dados podem estar desatualizados.
        </div>
      )}
      {bar('top')}
      <div className="relative flex min-h-0 flex-1">
        {bar('left')}
        {/* isolate: o empilhamento das janelas flutuantes fica restrito à área do mapa. */}
        <main className="relative isolate min-w-0 flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-6 animate-spin text-slate-400" />
              </div>
            }
          >
            <MapView />
          </Suspense>
        </main>
        {!infoHidden && <RightPanel />}
        {bar('right')}
      </div>
      {bar('bottom')}
      <div className="lg:hidden">
        <ToolPanel side="bottom" mobile />
      </div>
      <InitialFit />
      <Dialogs />
    </div>
  );
}

export default function MapPage() {
  // Mapa compartilhado entre a área do mapa e as ferramentas (MapLibre — sem chave de API).
  const [map, setMap] = useState<MlMap | null>(null);
  const ctx = useMemo(() => ({ map, setMap }), [map]);
  return (
    <MapContext.Provider value={ctx}>
      <Workspace />
    </MapContext.Provider>
  );
}
