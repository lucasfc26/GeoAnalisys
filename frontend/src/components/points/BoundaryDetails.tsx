import { useQuery } from '@tanstack/react-query';
import { MousePointerClick } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { boundaryStore, featureLabels } from '@/lib/boundaries';
import { useAppStore } from '@/stores/appStore';
import { fmtInt, fmtValue, isUrl } from '@/utils/format';
import { EmptyState, Skeleton } from '../ui/States';

/** Atributos da feição consultada no limite ativo. */
export function BoundaryDetails({ layerId }: { layerId: string }) {
  const boundary = useAppStore((s) => s.boundaries.find((b) => b.id === layerId));
  const picked = useAppStore((s) =>
    s.boundarySelection?.layerId === layerId ? s.boundarySelection : null,
  );
  const geo = useQuery({
    queryKey: ['boundary-geometry', layerId],
    queryFn: async () => (await boundaryStore.get(layerId)) ?? null,
  });
  const [filter, setFilter] = useState('');
  useEffect(() => setFilter(''), [layerId, picked?.index]);
  const feature = picked && geo.data ? geo.data.features[picked.index] : undefined;
  const label = useMemo(() => {
    if (!geo.data || !picked) return null;
    return featureLabels(geo.data)[picked.index] ?? `Feição ${picked.index + 1}`;
  }, [geo.data, picked]);
  const fields = useMemo(() => {
    const props = feature?.properties ?? {};
    const q = filter.trim().toLowerCase();
    return Object.keys(props).filter((k) => {
      if (!q) return true;
      return k.toLowerCase().includes(q) || fmtValue(props[k]).toLowerCase().includes(q);
    });
  }, [feature, filter]);

  if (!boundary) {
    return (
      <EmptyState icon={<MousePointerClick className="size-10" />} title="Limite removido">
        <p>Esse limite não está mais no mapa.</p>
      </EmptyState>
    );
  }
  if (!picked) {
    return (
      <EmptyState icon={<MousePointerClick className="size-10" />} title="Nenhuma feição selecionada">
        <p>
          Clique no mapa dentro de <b>{boundary.name}</b> para ver os atributos da feição.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Clique numa camada de pontos para voltar a selecionar pontos.
        </p>
      </EmptyState>
    );
  }
  if (geo.isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (!geo.data || !feature) {
    return (
      <EmptyState icon={<MousePointerClick className="size-10" />} title="Geometria indisponível">
        <p>A geometria deste limite não está mais salva neste computador. Importe o arquivo de novo.</p>
      </EmptyState>
    );
  }

  const total = geo.data.features.length;
  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">
          {boundary.name} · feição {fmtInt(picked.index + 1)} de {fmtInt(total)}
        </p>
      </div>
      {Object.keys(feature.properties ?? {}).length > 6 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar campos…"
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs focus:border-accent-500 focus:outline-none"
        />
      )}
      {fields.length ? (
        <dl className="divide-y divide-slate-100">
          {fields.map((name) => {
            const v = feature.properties?.[name];
            return (
              <div key={name} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 py-1.5 text-xs">
                <dt className="truncate text-slate-500" title={name}>
                  {name}
                </dt>
                <dd className="break-words text-slate-800">
                  {isUrl(v) ? (
                    <a
                      href={v}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-700 hover:underline"
                    >
                      {v}
                    </a>
                  ) : (
                    fmtValue(v)
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="text-xs text-slate-500">
          {filter ? 'Nenhum campo com esse texto.' : 'Esta feição não tem atributos.'}
        </p>
      )}
    </div>
  );
}
