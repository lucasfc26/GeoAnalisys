import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { queryKeys, useActiveSource } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Label } from '../ui/Field';
import { toast } from '../ui/Toaster';

export default function DeleteConfirmDialog() {
  const target = useAppStore((s) => s.dialogs.confirmDelete);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const removeIds = useAppStore((s) => s.removeIds);
  const { sourceId, source } = useActiveSource();
  const qc = useQueryClient();
  const [ack, setAck] = useState(false);
  /** Motivo da exclusão (vai para a Tabela de Alterações) */
  const [observation, setObservation] = useState('');

  const close = () => {
    setAck(false);
    setObservation('');
    closeDialog('confirmDelete');
  };

  const del = useMutation({
    mutationFn: async (ids: string[]) =>
      ids.length === 1
        ? pointsService.remove(sourceId!, ids[0], observation.trim())
        : pointsService.bulkDelete(sourceId!, ids, observation.trim()),
    onSuccess: (r, ids) => {
      removeIds(ids);
      qc.invalidateQueries({ queryKey: queryKeys.points(sourceId!) });
      toast.success(`${fmtInt(r.deleted)} registro(s) excluído(s).`);
      close();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!target) return null;
  const n = target.ids.length;
  const needsAck = n > 1;
  const idLabel = source?.idColumn ?? 'ID';

  return (
    <Dialog
      open
      size="sm"
      title={n === 1 ? `Excluir ${idLabel} ${target.ids[0]}?` : `Excluir ${fmtInt(n)} registros?`}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={() => del.mutate(target.ids)}
            loading={del.isPending}
            disabled={(needsAck && !ack) || !observation.trim()}
          >
            Excluir
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <AlertTriangle className="size-6 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1 space-y-3 text-sm text-slate-600">
          <p>
            {n === 1
              ? 'O registro será removido da tabela de origem.'
              : 'Todos os registros selecionados serão removidos da tabela de origem em uma única transação.'}{' '}
            Os valores anteriores ficam guardados na auditoria.
          </p>
          <div>
            <Label htmlFor="del-observation" hint="Tabela de Alterações">
              Observação (motivo da exclusão) <span className="text-red-500">*</span>
            </Label>
            <textarea
              id="del-observation"
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Ex.: Duplicidade"
              className="block w-full resize-y rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 focus:border-accent-500 focus:outline-none"
            />
          </div>
          {needsAck && (
            <label className="flex items-center gap-2 font-medium text-slate-800">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              Confirmo a exclusão de {fmtInt(n)} registros
            </label>
          )}
        </div>
      </div>
    </Dialog>
  );
}
