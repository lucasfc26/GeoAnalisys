import { useState } from 'react';
import { DEFAULT_PREVIEW, type PreviewConfig } from '@/lib/listPreview';

/** Configuração do preview (atributo do link ou modelo), lembrada por camada. */
const previewKey = (sourceId: string) => `geoanalisys-list-preview:${sourceId}`;
function loadPreview(sourceId: string): PreviewConfig {
  try {
    const v = JSON.parse(localStorage.getItem(previewKey(sourceId)) ?? 'null');
    return v && typeof v === 'object' ? { ...DEFAULT_PREVIEW, ...v } : DEFAULT_PREVIEW;
  } catch {
    return DEFAULT_PREVIEW;
  }
}

/** Link do preview da camada; o mesmo no modo lista e em Duplicidades. */
export function usePreviewConfig(sourceId: string) {
  const [cfg, setCfg] = useState<PreviewConfig>(() => loadPreview(sourceId));
  const update = (patch: Partial<PreviewConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    try {
      localStorage.setItem(previewKey(sourceId), JSON.stringify(next));
    } catch {
      /* só nesta sessão */
    }
  };
  return [cfg, update] as const;
}
