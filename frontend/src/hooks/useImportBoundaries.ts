import { useState } from 'react';
import { toast } from '@/components/ui/Toaster';
import { boundaryStore, readBoundaryFiles } from '@/lib/boundaries';
import { hasNoAttributes } from '@/lib/mapMaker';
import { useAppStore } from '@/stores/appStore';
import type { BoundaryLayer } from '@/types';
import { unionBounds } from '@/utils/geo';
import { useActiveSource, useCrsList } from './useSourceData';

export const BOUNDARY_ACCEPT = '.zip,.shp,.dbf,.prj,.cpg,.shx,.geojson,.json,.kml';

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase();

/**
 * Arquivos de origem de um limite: os de mesmo nome (shapefile = .shp + .dbf + .prj…) ou, sem
 * correspondência (ex.: um .zip com vários), todos. Caminho completo no programa desktop.
 */
function originOf(files: File[], name: string): string[] {
  const where = (f: File) => window.geoanalisys?.files?.pathOf(f) || f.name;
  const same = files.filter((f) => stem(f.name) === name.toLowerCase());
  return (same.length ? same : files).map(where);
}

/** Importa limites (shapefile/GeoJSON) para o mapa; devolve os limites criados. */
export function useImportBoundaries() {
  const addBoundaries = useAppStore((s) => s.addBoundaries);
  const focusMap = useAppStore((s) => s.focusMap);
  const { source } = useActiveSource();
  const crs = useCrsList();
  const [loading, setLoading] = useState(false);

  // Shapefile sem .prj: assume o CRS da camada ativa.
  const fallbackProj4 = source
    ? source.proj4 || crs.data?.find((c) => c.code === source.coordinateSystem)?.proj4 || null
    : null;

  const importFiles = async (files: FileList | null): Promise<BoundaryLayer[]> => {
    if (!files?.length) return [];
    setLoading(true);
    try {
      const parsed = await readBoundaryFiles([...files], fallbackProj4);
      const items: BoundaryLayer[] = [];
      let persisted = true;
      for (const p of parsed) {
        const id = newId();
        persisted = (await boundaryStore.set(id, p.data)) && persisted;
        items.push({
          id,
          name: p.name,
          color: '#ff0000',
          width: 3,
          visible: true,
          features: p.data.features.length,
          bounds: p.bounds,
          origin: originOf([...files], p.name),
        });
        if (hasNoAttributes(p.data))
          toast.info(
            `"${p.name}" veio sem atributos (falta o .dbf): não dará para escolher regiões pelo nome.`,
          );
        if (p.reprojected)
          toast.info(`"${p.name}" veio sem .prj: coordenadas lidas no sistema da camada ativa.`);
      }
      addBoundaries(items);
      toast.success(`${items.length} limite(s) adicionado(s).`);
      if (!persisted)
        toast.info('Não foi possível salvar no navegador: os limites valem só nesta sessão.');
      const b = unionBounds(items.map((i) => i.bounds));
      if (b) focusMap({ bounds: b });
      return items;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setLoading(false);
    }
  };

  return { importFiles, loading };
}
