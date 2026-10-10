import clsx from 'clsx';
import { Keyboard, Pencil, RotateCcw } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import {
  FIXED_SHORTCUTS,
  SHORTCUTS,
  comboOf,
  keyOf,
  reservedUse,
  useShortcutStore,
  type ShortcutId,
} from '@/lib/shortcuts';
import { useAppStore } from '@/stores/appStore';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

const labelOf = (id: ShortcutId) => SHORTCUTS.find((s) => s.id === id)?.label ?? id;
const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];

function Key({ children, muted }: { children: string; muted?: boolean }) {
  return (
    <kbd
      className={clsx(
        'inline-block min-w-7 rounded border px-1.5 py-0.5 text-center font-mono text-xs',
        muted
          ? 'border-slate-200 bg-slate-50 text-slate-400'
          : 'border-slate-300 bg-white text-slate-700 shadow-[0_1px_0_rgba(0,0,0,0.08)]',
      )}
    >
      {children}
    </kbd>
  );
}

/** Sobre › Atalhos: teclas dos botões, com troca de tecla e ativar/desativar. */
export default function ShortcutsDialog() {
  const closeDialog = useAppStore((s) => s.closeDialog);
  const keys = useShortcutStore((s) => s.keys);
  const disabled = useShortcutStore((s) => s.disabled);
  const setKey = useShortcutStore((s) => s.setKey);
  const setEnabled = useShortcutStore((s) => s.setEnabled);
  const reset = useShortcutStore((s) => s.reset);
  const resetAll = useShortcutStore((s) => s.resetAll);
  const [editing, setEditing] = useState<ShortcutId | null>(null);
  const [notice, setNotice] = useState<{ error?: boolean; text: string } | null>(null);
  const close = () => closeDialog('shortcuts');

  // Aguardando a nova tecla: captura antes de tudo (a janela não fecha com Esc nem dispara atalhos).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        setEditing(null);
        return;
      }
      const combo = comboOf(e);
      if (!combo) return;
      const reserved = reservedUse(combo);
      if (reserved) {
        setNotice({ error: true, text: `${combo} é usada pelo programa (${reserved}). Escolha outra tecla.` });
        return;
      }
      const other = setKey(editing, combo);
      setNotice(
        other ? { text: `${combo} estava em "${labelOf(other)}", que ficou sem tecla.` } : null,
      );
      setEditing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing, setKey]);

  return (
    <Dialog
      open
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Keyboard className="size-5 text-slate-500" /> Atalhos
        </span>
      }
      description="Teclas dos botões do sistema. Clique em Alterar e pressione a nova tecla (Esc cancela); desmarque para desativar."
      onClose={close}
      footer={
        <>
          <Button
            className="mr-auto"
            icon={<RotateCcw className="size-4" />}
            onClick={() => {
              resetAll();
              setEditing(null);
              setNotice({ text: 'Todos os atalhos voltaram ao padrão.' });
            }}
          >
            Restaurar padrões
          </Button>
          <Button onClick={close}>Fechar</Button>
        </>
      }
    >
      {notice && (
        <p
          role="status"
          className={clsx(
            'mb-3 rounded-md px-3 py-2 text-sm',
            notice.error ? 'bg-red-50 text-red-700' : 'bg-accent-50 text-accent-700',
          )}
        >
          {notice.text}
        </p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="w-14 py-1.5 font-medium">Ativo</th>
            <th className="py-1.5 font-medium">Ação</th>
            <th className="w-48 py-1.5 font-medium">Tecla</th>
            <th className="w-40 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((group) => (
            <Fragment key={group}>
              <tr>
                <td colSpan={4} className="pt-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  {group}
                </td>
              </tr>
              {SHORTCUTS.filter((d) => d.group === group).map((d) => {
                const prefs = { keys, disabled };
                const key = keyOf(prefs, d.id);
                const enabled = !disabled.includes(d.id);
                const changed = key !== d.key || !enabled;
                const capturing = editing === d.id;
                return (
                  <tr key={d.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        checked={enabled}
                        aria-label={`Ativar atalho: ${d.label}`}
                        onChange={(e) => setEnabled(d.id, e.target.checked)}
                        className="size-4 accent-accent-600"
                      />
                    </td>
                    <td className={clsx('py-1.5', enabled ? 'text-slate-800' : 'text-slate-400')}>
                      {d.label}
                    </td>
                    <td className="py-1.5">
                      {capturing ? (
                        <span className="animate-pulse rounded border border-accent-500 bg-accent-50 px-2 py-0.5 text-xs text-accent-700">
                          Pressione a nova tecla…
                        </span>
                      ) : key ? (
                        <Key muted={!enabled}>{key}</Key>
                      ) : (
                        <span className="text-xs text-slate-400 italic">sem tecla</span>
                      )}
                      {key !== d.key && !capturing && (
                        <span className="ml-2 text-xs text-slate-400">padrão: {d.key}</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant={capturing ? 'primary' : 'ghost'}
                          icon={<Pencil className="size-3.5" />}
                          onClick={() => {
                            setNotice(null);
                            setEditing(capturing ? null : d.id);
                          }}
                        >
                          {capturing ? 'Cancelar' : 'Alterar'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={`Restaurar padrão (${d.key}, ativo)`}
                          aria-label={`Restaurar padrão: ${d.label}`}
                          disabled={!changed}
                          className={changed ? '' : 'invisible'}
                          onClick={() => {
                            reset(d.id);
                            setEditing(null);
                            setNotice(null);
                          }}
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>

      <h3 className="mt-5 mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
        Teclas fixas do programa
      </h3>
      <dl className="text-sm">
        {FIXED_SHORTCUTS.map((f) => (
          <div
            key={f.label}
            className="grid grid-cols-[12rem_minmax(0,1fr)] items-center gap-2 border-b border-slate-100 py-1.5 last:border-b-0"
          >
            <dt className="flex flex-wrap gap-1">
              {f.keys.map((k) => (
                <Key key={k}>{k}</Key>
              ))}
            </dt>
            <dd className="text-slate-600">{f.label}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
