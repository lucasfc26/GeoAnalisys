import { Redo2, Undo2 } from 'lucide-react';
import { describeUndo, useUndo, useUndoStore } from '@/hooks/useUndo';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

/** Confirmação do desfazer (Ctrl+Z) ou refazer (Ctrl+Y) quando a operação afeta muitos registros. */
export function UndoConfirmDialog() {
  const pending = useUndoStore((s) => s.pending);
  const kind = useUndoStore((s) => s.kind);
  const busy = useUndoStore((s) => s.busy);
  const undo = useUndo();
  if (!pending) return null;
  const redo = kind === 'redo';
  return (
    <Dialog
      open
      size="sm"
      title={redo ? 'Refazer a ação desfeita?' : 'Desfazer a última ação?'}
      onClose={undo.cancel}
      footer={
        <>
          <Button onClick={undo.cancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            icon={redo ? <Redo2 className="size-4" /> : <Undo2 className="size-4" />}
            loading={busy}
            onClick={undo.confirm}
            autoFocus
          >
            {redo ? 'Refazer' : 'Desfazer'} {fmtInt(pending.total)} registro(s)
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">
        {describeUndo(pending)[0].toUpperCase() + describeUndo(pending).slice(1)}, feita em{' '}
        {new Date(pending.at).toLocaleString('pt-BR')}.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {redo
          ? 'A ação volta a valer como foi feita (valores, pontos adicionados e excluídos). Fica registrado na Tabela de Alterações; o Ctrl+Z desfaz de novo.'
          : 'Os valores voltam ao que eram antes, pontos adicionados são removidos e pontos excluídos voltam. Fica registrado na Tabela de Alterações; o Ctrl+Y refaz, enquanto não houver outra ação depois.'}
      </p>
    </Dialog>
  );
}
