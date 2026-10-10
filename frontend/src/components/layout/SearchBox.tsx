import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Loader2, LocateFixed, MapPin, Search, X } from 'lucide-react';
import proj4 from 'proj4';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { useActiveSource, useCrsList } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { parseCoordinate } from '@/lib/coords';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import type { SearchResult } from '@/types';
import { toast } from '../ui/Toaster';

const fmtCoord = (n: number) => n.toFixed(7).replace(/\.?0+$/, '');

/**
 * Busca textual: centraliza o mapa, destaca o ponto e abre o painel. Uma coordenada digitada
 * (lat/lng ou UTM X/Y) leva o mapa até ela.
 */
export function SearchBox() {
  const sourceId = useAppStore((s) => s.sourceId);
  const setSelection = useAppStore((s) => s.setSelection);
  const openRecord = useAppStore((s) => s.openRecord);
  const focusMap = useAppStore((s) => s.focusMap);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(q.trim(), 350);
  const boxRef = useRef<HTMLDivElement>(null);
  const { source } = useActiveSource();
  const crs = useCrsList();

  const results = useQuery({
    queryKey: ['points', sourceId, 'search', debounced],
    queryFn: ({ signal }) => pointsService.search(sourceId!, debounced, signal),
    enabled: !!sourceId && debounced.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Coordenada digitada (lat/lng ou UTM no sistema da camada ativa): vira a 1ª opção da lista.
  const coord = useMemo(() => {
    const c = parseCoordinate(q);
    if (!c) return null;
    if (c.kind === 'latlng') return { lat: c.lat, lng: c.lng, text: `${fmtCoord(c.lat)}, ${fmtCoord(c.lng)}`, error: null };
    const code = source?.coordinateSystem;
    const def = source?.proj4 || crs.data?.find((x) => x.code === code)?.proj4 || null;
    const text = `X ${c.x} · Y ${c.y}`;
    if (!def || /\+proj=longlat/.test(def))
      return { lat: 0, lng: 0, text, error: 'Para X/Y (UTM), a camada ativa precisa estar num sistema projetado.' };
    try {
      const [lng, lat] = proj4(def, 'WGS84').forward([c.x, c.y]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
        throw new Error();
      return { lat, lng, text: `${text} (${code})`, error: null };
    } catch {
      return { lat: 0, lng: 0, text, error: `Não foi possível converter de ${code}.` };
    }
  }, [q, source, crs.data]);

  const goToCoord = () => {
    if (!coord) return;
    setOpen(false);
    if (coord.error) {
      toast.error(coord.error);
      return;
    }
    focusMap({ center: { lat: coord.lat, lng: coord.lng }, zoom: 19, flash: true });
  };

  // Seleciona só o registro pesquisado, mesmo que outros estejam na mesma coordenada.
  const pick = (r: SearchResult) => {
    setOpen(false);
    if (!sourceId || r.lat === null || r.lng === null) return;
    focusMap({ center: { lat: r.lat, lng: r.lng }, zoom: 19 });
    setSelection([{ key: r.key, x: r.x, y: r.y, lat: r.lat, lng: r.lng, ids: [r.id] }]);
    openRecord(r.key, r.id);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        disabled={!sourceId}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (coord) goToCoord();
            else if (results.data?.[0]) pick(results.data[0]);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={
          sourceId
            ? 'Pesquisar ID, nome, endereço ou coordenada…'
            : 'Configure uma fonte para pesquisar'
        }
        className="h-9 w-full rounded-md border border-white/10 bg-white/10 pr-8 pl-8 text-sm text-white placeholder:text-slate-400 focus:border-accent-500 focus:bg-white focus:text-slate-900 focus:outline-none disabled:opacity-50"
      />
      {results.isFetching ? (
        <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-slate-400" />
      ) : (
        q && (
          <button className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setQ('')} aria-label="Limpar busca">
            <X className="size-4" />
          </button>
        )
      )}
      {open && (coord || (debounced.length >= 2 && !results.isFetching && results.data)) && (
        <div className="absolute top-full right-0 left-0 z-40 mt-1 overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl tone-auto">
          {coord && (
            <button
              type="button"
              onClick={goToCoord}
              className="flex w-full items-start gap-2 border-b border-slate-100 bg-accent-50/50 px-3 py-2 text-left text-sm hover:bg-accent-50"
            >
              <LocateFixed className="mt-0.5 size-4 shrink-0 text-accent-600" />
              <span className="min-w-0">
                <span className="block font-medium text-slate-800">Ir para a coordenada</span>
                <span className={clsx('block truncate text-xs', coord.error ? 'text-red-600' : 'text-slate-500')}>
                  {coord.error ?? coord.text}
                </span>
              </span>
            </button>
          )}
          {!results.data || results.isFetching || debounced.length < 2 ? null : results.data.length === 0 ? (
            !coord && <p className="p-3 text-sm text-slate-500">Nenhum resultado.</p>
          ) : (
            <ul className="scroll-thin max-h-80 overflow-y-auto">
              {results.data.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-accent-600" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-800">
                        #{r.id} {r.label && <span className="font-normal text-slate-600">· {r.label}</span>}
                      </span>
                      {r.match && r.match.column !== undefined && (
                        <span className="block truncate text-xs text-slate-500">
                          {r.match.column}: {r.match.value}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {results.isError && open && (
        <div className="absolute top-full right-0 left-0 z-40 mt-1 rounded-md border border-red-200 bg-white p-3 text-sm text-red-600 shadow-xl">
          {errorMessage(results.error)}
        </div>
      )}
    </div>
  );
}
