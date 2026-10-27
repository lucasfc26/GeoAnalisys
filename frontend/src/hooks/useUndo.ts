import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { toast } from '@/components/ui/Toaster';
import { errorMessage } from '@/lib/api';
import { pointsService, type UndoInfo } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { fmtInt } from '@/utils/format';

/** Acima de tantos registros, o desfazer pede confirmação (um Ctrl+Z sem querer não reverte tudo). */
export const UNDO_CONFIRM_ABOVE = 20;

/** "movimento de 523 registros em Censo Atual; edição de 1 registro em Censo Anterior" */
export function describeUndo(info: UndoInfo) {
  return info.parts
    .map(
      (p) =>
        `${p.label} de ${fmtInt(p.count)} registro${p.count === 1 ? '' : 's'} em ${p.sourceName}`,
    )
    .join('; ');
}

interface UndoState {
  /** Operação esperando confirmação */
  pending: UndoInfo | null;
  /** O que está esperando confirmação: desfazer (Ctrl+Z) ou refazer (Ctrl+Y) */
  kind: 'undo' | 'redo';
  busy: boolean;
  set: (p: Partial<Pick<UndoState, 'pending' | 'kind' | 'busy'>>) => void;
}

export const useUndoStore = create<UndoState>()((set) => ({
  pending: null,
  kind: 'undo',
  busy: false,
  set: (p) => set(p),
}));

/**
 * Desfazer (Ctrl+Z) e refazer (Ctrl+Y): `request`/`requestRedo` consultam a última operação (ou o
 * último desfazer) do usuário e aplicam na hora, ou pedem confirmação quando afeta muitos
 * registros; `confirm` aplica a que está esperando.
 */
export function useUndo() {
  const qc = useQueryClient();

  const run = async (info: UndoInfo, kind: 'undo' | 'redo') => {
    const st = useUndoStore.getState();
    st.set({ busy: true });
    try {
      const res =
        kind === 'undo'
          ? await pointsService.undo(info.txId).then((r) => ({ ...r, done: r.undone }))
          : await pointsService.redo(info.txId).then((r) => ({ ...r, done: r.redone }));
      st.set({ pending: null });
      // Pontos, Tabela de Alterações e o que mais depender dos dados.
      await qc.invalidateQueries();
      if (res.removed) useAppStore.getState().clearSelection();
      toast.success(
        `${kind === 'undo' ? 'Desfeito' : 'Refeito'}: ${describeUndo(res.done)}.${res.skipped ? ` ${fmtInt(res.skipped)} registro(s) já não estavam como antes e ficaram de fora.` : ''}`,
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      st.set({ busy: false });
    }
  };

  const ask = async (kind: 'undo' | 'redo') => {
    const st = useUndoStore.getState();
    if (st.busy || st.pending) return;
    st.set({ busy: true });
    let info: UndoInfo | null | undefined;
    try {
      info =
        kind === 'undo'
          ? (await pointsService.lastUndo()).last
          : (await pointsService.lastRedo()).next;
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      st.set({ busy: false });
    }
    if (!info) {
      if (info === null) toast.info(kind === 'undo' ? 'Nada para desfazer.' : 'Nada para refazer.');
      return;
    }
    if (info.total > UNDO_CONFIRM_ABOVE) st.set({ pending: info, kind });
    else await run(info, kind);
  };

  return {
    request: () => ask('undo'),
    requestRedo: () => ask('redo'),
    confirm: () => {
      const { pending, kind } = useUndoStore.getState();
      if (pending) void run(pending, kind);
    },
    cancel: () => useUndoStore.getState().set({ pending: null }),
  };
}
