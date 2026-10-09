import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { crsService, sourcesService } from '@/services/sources';
import { selectedIdsOf, useAppStore } from '@/stores/appStore';
import type { Bounds, FilterDef } from '@/types';

export const queryKeys = {
  sources: ['sources'] as const,
  schema: (id: string) => ['schema', id] as const,
  crs: ['crs'] as const,
  points: (id: string) => ['points', id] as const,
  bbox: (id: string, b: Bounds, f: FilterDef[]) => ['points', id, 'bbox', b, f] as const,
  record: (id: string, rid: string) => ['points', id, 'record', rid] as const,
  at: (id: string, key: string, f: FilterDef[]) => ['points', id, 'at', key, f] as const,
};

export function useSources() {
  return useQuery({ queryKey: queryKeys.sources, queryFn: sourcesService.list, staleTime: 60_000 });
}

export function useCrsList() {
  return useQuery({ queryKey: queryKeys.crs, queryFn: crsService.list, staleTime: Infinity });
}

export function useActiveSource() {
  const sourceId = useAppStore((s) => s.sourceId);
  const sources = useSources();
  const source = sources.data?.find((s) => s.id === sourceId) ?? null;
  return { sourceId, source, sources };
}

export function useSourceSchema(sourceId: string | null) {
  return useQuery({
    queryKey: queryKeys.schema(sourceId ?? ''),
    queryFn: () => sourcesService.schema(sourceId!),
    enabled: !!sourceId,
    staleTime: 60_000,
  });
}

/** Arredonda o viewport para evitar chamadas duplicadas por micro-movimentos. */
export function roundBounds(b: Bounds): Bounds {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return { minLat: r(b.minLat), maxLat: r(b.maxLat), minLng: r(b.minLng), maxLng: r(b.maxLng) };
}

export function useSelectedIds() {
  const selection = useAppStore((s) => s.selection);
  return useMemo(() => selectedIdsOf(selection), [selection]);
}

/** Recarrega os dados de todas as camadas do mapa. */
export function useInvalidatePoints() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['points'] });
}
