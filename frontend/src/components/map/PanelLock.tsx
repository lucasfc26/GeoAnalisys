import { Lock, LockOpen } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

/** Estado do cadeado de um painel do mapa: travado (padrão) ou livre para mover. */
export function usePanelLock(id: string) {
  const unlocked = useAppStore((s) => s.unlockedPanels.includes(id));
  const setUnlocked = useAppStore((s) => s.setPanelUnlocked);
  return { locked: !unlocked, toggle: () => setUnlocked(id, !unlocked) };
}

/** Cadeadinho: travado = painel fixo; destravado = pode ser arrastado (e redimensionado). */
export function PanelLockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  const label = locked ? 'Destravar para mover o painel' : 'Travar o painel nesta posição';
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={!locked}
      className={
        locked
          ? 'rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
          : 'rounded p-0.5 text-accent-600 hover:bg-accent-50'
      }
    >
      {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
    </button>
  );
}
