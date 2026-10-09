import clsx from 'clsx';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { create } from 'zustand';

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const useToasts = create<{ items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>(
  (set) => ({
    items: [],
    push: (t) => {
      const id = Date.now() + Math.random();
      set((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }));
      setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), t.tone === 'error' ? 7000 : 3500);
    },
    dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  }),
);

export const toast = {
  success: (message: string) => useToasts.getState().push({ tone: 'success', message }),
  error: (message: string) => useToasts.getState().push({ tone: 'error', message }),
  info: (message: string) => useToasts.getState().push({ tone: 'info', message }),
};

const icons = {
  success: <CheckCircle2 className="size-4 text-emerald-500" />,
  error: <AlertTriangle className="size-4 text-red-500" />,
  info: <Info className="size-4 text-sky-500" />,
};

export function Toaster() {
  const { items, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 bottom-20 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 lg:bottom-4">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={clsx(
            'pointer-events-auto flex items-start gap-2 rounded-lg border bg-white px-3 py-2.5 text-sm shadow-lg',
            t.tone === 'error' ? 'border-red-200' : 'border-slate-200',
          )}
        >
          <span className="mt-0.5">{icons[t.tone]}</span>
          <span className="flex-1 break-words text-slate-700">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-700" aria-label="Fechar">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
