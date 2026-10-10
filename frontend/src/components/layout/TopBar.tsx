import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Filter, PanelRight, RefreshCw, Settings2 } from 'lucide-react';
import { useActiveSource, useInvalidatePoints } from '@/hooks/useSourceData';
import { layerName } from '@/lib/layers';
import { healthService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import { SearchBox } from './SearchBox';

function DbStatus() {
  const q = useQuery({
    queryKey: ['health-db'],
    queryFn: healthService.database,
    refetchInterval: 30_000,
    retry: false,
  });
  const ok = q.data?.status === 'ok';
  return (
    <span
      className="hidden items-center gap-1.5 text-xs text-slate-400 md:flex"
      title={
        ok ? `Banco ${q.data?.database} · ${q.data?.latencyMs} ms` : 'Banco de dados indisponível'
      }
    >
      <span
        className={clsx(
          'size-2 rounded-full',
          q.isLoading ? 'bg-slate-500' : ok ? 'bg-emerald-400' : 'bg-red-500',
        )}
      />
      {q.isLoading ? '' : ok ? q.data?.database : 'offline'}
    </span>
  );
}

export function TopBar() {
  const { sourceId, sources } = useActiveSource();
  const setSource = useAppStore((s) => s.setSource);
  const openDialog = useAppStore((s) => s.openDialog);
  const setPanelOpen = useAppStore((s) => s.setPanelOpen);
  const panelOpen = useAppStore((s) => s.panelOpen);
  const filters = useAppStore((s) => s.filters);
  const layers = useAppStore((s) => s.layers);
  const invalidate = useInvalidatePoints();

  return (
    <header className="tone-fixed flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-slate-900 px-3 py-2 text-white shadow-md sm:h-14 sm:flex-nowrap sm:py-0">
      <div className="flex items-center gap-2">
        <img src="/logo.png" alt="" className="size-7 rounded-md ring-1 ring-slate-400/45" />
        <span className="hidden font-semibold tracking-tight sm:inline">GeoAnalisys</span>
      </div>

      <select
        value={sourceId ?? ''}
        onChange={(e) =>
          e.target.value === '__new'
            ? openDialog('source', true)
            : setSource(e.target.value || null)
        }
        className="h-9 min-w-0 flex-1 rounded-md sm:max-w-56 sm:flex-none border border-white/10 bg-white/10 px-2 text-sm text-white focus:outline-none [&>option]:text-slate-900"
        aria-label="Camada ativa"
        title="Camada ativa: seleção, filtros, busca, edição e exportação"
      >
        <option value="">{sources.isLoading ? 'Carregando…' : 'Camada ativa…'}</option>
        {sources.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {layerName(
              layers.find((l) => l.sourceId === s.id),
              s,
            )}
          </option>
        ))}
        <option value="__new">+ Configurar fontes…</option>
      </select>

      <div className="order-last flex w-full min-w-0 justify-center sm:order-none sm:w-auto sm:flex-1">
        <SearchBox />
      </div>

      <DbStatus />
      <div className="flex items-center gap-1">
        <button
          className="relative rounded-md p-2 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
          onClick={() => openDialog('filters', true)}
          disabled={!sourceId}
          title="Filtros"
        >
          <Filter className="size-5" />
          {filters.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold">
              {filters.length}
            </span>
          )}
        </button>
        <button
          className="hidden rounded-md p-2 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40 sm:block"
          onClick={() => openDialog('export', true)}
          disabled={!sourceId}
          title="Exportar"
        >
          <Download className="size-5" />
        </button>
        <button
          className="hidden rounded-md p-2 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40 sm:block"
          onClick={invalidate}
          disabled={!sourceId}
          title="Atualizar dados"
        >
          <RefreshCw className="size-5" />
        </button>
        <button
          className="rounded-md p-2 text-slate-300 hover:bg-white/10 hover:text-white"
          onClick={() => openDialog('source', true)}
          title="Fontes de dados"
        >
          <Settings2 className="size-5" />
        </button>
        <button
          className={clsx(
            'rounded-md p-2 hover:bg-white/10 lg:hidden',
            panelOpen ? 'text-accent-500' : 'text-slate-300',
          )}
          onClick={() => setPanelOpen(!panelOpen)}
          title="Painel de informações"
        >
          <PanelRight className="size-5" />
        </button>
      </div>
    </header>
  );
}
