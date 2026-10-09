import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { changesService, type ChangeAction } from '@/services/changes';
import { useAppStore } from '@/stores/appStore';
import { changeObservation, fmtChangeList } from '@/utils/changes';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorState, SkeletonList } from '../ui/States';
import { toast } from '../ui/Toaster';

const PAGE = 200;
const DOT: Record<ChangeAction, string> = {
  CREATE: 'bg-emerald-500',
  DELETE: 'bg-red-500',
  UPDATE: 'bg-amber-500',
};

/** Tabela de Alterações: pontos adicionados, removidos e alterados, com download XLSX e limpeza. */
export default function ChangesDialog() {
  const closeDialog = useAppStore((s) => s.closeDialog);
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const changes = useQuery({ queryKey: ['changes'], queryFn: changesService.list, staleTime: 0 });
  const clear = useMutation({
    mutationFn: changesService.clear,
    onSuccess: (r) => {
      toast.success(`${fmtInt(r.deleted)} alteração(ões) removida(s) da tabela.`);
      setConfirmClear(false);
      qc.invalidateQueries({ queryKey: ['changes'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const rows = useMemo(() => {
    const all = changes.data ?? [];
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter((r) =>
      [r.sourceName, r.recordId, changeObservation(r.action, r.observation), ...r.attributes].some(
        (s) => s.toLowerCase().includes(t),
      ),
    );
  }, [changes.data, q]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE, current * PAGE + PAGE);
  const total = changes.data?.length ?? 0;

  const download = async () => {
    setDownloading(true);
    try {
      await changesService.downloadXlsx();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog
      open
      size="xl"
      title="Tabela de Alterações"
      description="Pontos adicionados, removidos e alterados (edições repetidas mostram a 1ª versão e a atual)."
      onClose={() => closeDialog('changes')}
      footer={
        confirmClear ? (
          <>
            <span className="mr-auto text-sm font-medium text-red-700">
              Limpar as {fmtInt(total)} alterações? Essa ação não pode ser desfeita.
            </span>
            <Button onClick={() => setConfirmClear(false)}>Cancelar</Button>
            <Button variant="danger" loading={clear.isPending} onClick={() => clear.mutate()}>
              Confirmar limpeza
            </Button>
          </>
        ) : (
          <>
            <Button
              className="mr-auto text-red-600"
              icon={<Trash2 className="size-4" />}
              disabled={!total}
              onClick={() => setConfirmClear(true)}
            >
              Limpar tabela
            </Button>
            <Button
              icon={<Download className="size-4" />}
              loading={downloading}
              disabled={!total}
              onClick={download}
            >
              Baixar XLSX
            </Button>
            <Button variant="primary" onClick={() => closeDialog('changes')}>
              Fechar
            </Button>
          </>
        )
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Filtrar por tabela, ID, observação ou atributo…"
            className="h-8 w-full rounded-md border border-slate-300 pr-2 pl-7 text-sm focus:border-accent-500 focus:outline-none"
          />
        </div>
        <span className="text-xs text-slate-500">
          {fmtInt(rows.length)}
          {rows.length !== total && ` de ${fmtInt(total)}`} registro(s)
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className="size-3.5" />}
          onClick={() => changes.refetch()}
          loading={changes.isFetching}
        >
          Atualizar
        </Button>
      </div>

      {changes.isLoading ? (
        <SkeletonList rows={6} />
      ) : changes.isError ? (
        <ErrorState error={changes.error} onRetry={() => changes.refetch()} />
      ) : !rows.length ? (
        <p className="py-10 text-center text-sm text-slate-500">
          {total ? 'Nenhuma alteração corresponde ao filtro.' : 'Nenhuma alteração registrada.'}
        </p>
      ) : (
        <>
          <div className="scroll-thin overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  {[
                    'Tabela',
                    'ID',
                    'Observação',
                    'Atributos Alterados',
                    'Valores Old',
                    'Valores New',
                  ].map((h) => (
                    <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {shown.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-slate-50">
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{r.sourceName}</td>
                    <td
                      className="px-2.5 py-1.5 font-mono whitespace-nowrap"
                      title={r.idColumn ? `Coluna ${r.idColumn}` : undefined}
                    >
                      {r.recordId}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={clsx('size-2 shrink-0 rounded-full', DOT[r.action])} />
                        {changeObservation(r.action, r.observation)}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 font-mono">{fmtChangeList(r.attributes)}</td>
                    <td className="px-2.5 py-1.5 font-mono">{fmtChangeList(r.oldValues)}</td>
                    <td className="px-2.5 py-1.5 font-mono">{fmtChangeList(r.newValues)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-600">
              <Button size="sm" onClick={() => setPage(current - 1)} disabled={current === 0}>
                Anterior
              </Button>
              Página {current + 1} de {pages}
              <Button
                size="sm"
                onClick={() => setPage(current + 1)}
                disabled={current >= pages - 1}
              >
                Próxima
              </Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
