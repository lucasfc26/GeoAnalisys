import { useAppStore } from '@/stores/appStore';

/**
 * "Manter zoom": ao ir para o próximo/outro ponto, só centraliza e mantém o zoom atual do mapa
 * (em vez de voltar à escala da ferramenta). Vale para todas as ferramentas de lista e busca.
 */
export function KeepZoomToggle() {
  const keep = useAppStore((s) => s.keepZoom);
  const setKeep = useAppStore((s) => s.setKeepZoom);
  return (
    <label
      className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] font-normal text-slate-600 select-none"
      title="Ao ir para outro ponto, só centraliza e mantém o zoom atual do mapa (vale para todas as ferramentas de lista e busca)"
    >
      <input
        type="checkbox"
        checked={keep}
        onChange={(e) => setKeep(e.target.checked)}
        className="size-3.5 accent-accent-600"
      />
      Manter zoom
    </label>
  );
}
