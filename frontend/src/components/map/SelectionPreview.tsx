import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ExternalLink, MonitorPlay, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePreviewConfig } from '@/hooks/usePreviewConfig';
import { useSourceSchema, useSources } from '@/hooks/useSourceData';
import { previewUrl } from '@/lib/listPreview';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { useSelectionPreviewStore } from '@/stores/selectionPreviewStore';
import { FloatingPanel } from '../ui/FloatingPanel';
import { PreviewSettings } from './PreviewSettings';

interface Target {
  sourceId: string;
  id: string;
}

/**
 * Ponto do preview: o registro aberto (expandido) no painel Registros; senão, o primeiro registro da
 * coordenada em foco ou da última selecionada. null = nada selecionado.
 */
function useCurrentTarget(): Target | null {
  const sourceId = useAppStore((s) => s.sourceId);
  const selection = useAppStore((s) => s.selection);
  const activeKey = useAppStore((s) => s.activeKey);
  const activeRecordId = useAppStore((s) => s.activeRecordId);
  return useMemo(() => {
    if (!sourceId) return null;
    if (activeRecordId) return { sourceId, id: activeRecordId };
    const keys = Object.keys(selection);
    const key = activeKey && selection[activeKey] ? activeKey : keys[keys.length - 1];
    const id = key ? selection[key]?.ids[0] : undefined;
    return id ? { sourceId, id } : null;
  }, [sourceId, selection, activeKey, activeRecordId]);
}

/**
 * Preview (botão da TV): o link do último ponto selecionado num frame — link montado, atributo com
 * o link ou Street View, configurado como no modo lista (por camada). Ao limpar a seleção, continua
 * no último ponto.
 */
export function SelectionPreview() {
  const current = useCurrentTarget();
  const [last, setLast] = useState<Target | null>(current);
  // Guarda o último ponto (ajuste de estado durante o render, sem efeito).
  if (current && (current.id !== last?.id || current.sourceId !== last?.sourceId)) setLast(current);
  const target = current ?? last;
  // Configuração lembrada por camada: remonta ao trocar de camada.
  return <Preview key={target?.sourceId ?? ''} target={target} />;
}

function Preview({ target }: { target: Target | null }) {
  const setOpen = useSelectionPreviewStore((s) => s.setOpen);
  const sourceId = target?.sourceId ?? '';
  const [cfg, setCfg] = usePreviewConfig(sourceId);
  const incomplete =
    (cfg.mode === 'column' && !cfg.column) || (cfg.mode === 'template' && !cfg.template.trim());
  const [settings, setSettings] = useState(incomplete);
  const sources = useSources();
  const layerName = sources.data?.find((s) => s.id === sourceId)?.name ?? '';
  const schema = useSourceSchema(target ? sourceId : null);
  const columns = useMemo(
    () => (schema.data?.columns ?? []).filter((c) => c.kind !== 'geometry'),
    [schema.data],
  );
  const record = useQuery({
    queryKey: ['points', sourceId, 'preview-record', target?.id ?? null],
    queryFn: async () => (await pointsService.records(sourceId, [target!.id], true))[0] ?? null,
    enabled: !!target,
    staleTime: 30_000,
  });
  const link = record.data ? previewUrl(cfg, record.data.data, record.data) : null;
  const url = link && 'url' in link ? link.url : null;
  const external = link && 'url' in link ? (link.external ?? link.url) : null;
  const message = !target
    ? 'Selecione um ponto no mapa para ver o preview.'
    : record.isError
      ? 'Erro ao carregar o ponto.'
      : record.isLoading
        ? 'Carregando…'
        : !record.data
          ? 'O ponto não existe mais na camada.'
          : link && 'error' in link
            ? link.error
            : '';

  return (
    <FloatingPanel
      title={target ? `Preview · ${layerName ? `${layerName} ` : ''}${target.id}` : 'Preview'}
      icon={<MonitorPlay className="size-4 text-accent-600" />}
      onClose={() => setOpen(false)}
      defaultClassName="top-3 right-3"
      className="h-[26rem] w-[34rem] max-w-[calc(100%-1.5rem)]"
      resizable={{ minWidth: 240, minHeight: 160 }}
      actions={
        <>
          <button
            type="button"
            onClick={() => setSettings((v) => !v)}
            className={clsx(
              'rounded p-0.5 hover:bg-slate-100 hover:text-slate-700',
              settings ? 'text-accent-700' : 'text-slate-400',
            )}
            title="Configurar o link"
            aria-label="Configurar o link"
            aria-pressed={settings}
          >
            <Settings2 className="size-4" />
          </button>
          {external && (
            <a
              href={external}
              target="_blank"
              rel="noreferrer"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="Abrir fora do sistema"
              aria-label="Abrir fora do sistema"
            >
              <ExternalLink className="size-4" />
            </a>
          )}
        </>
      }
    >
      <div className="flex h-full flex-col">
        {settings && target && (
          <div className="space-y-1 border-b border-slate-100 px-3 py-2">
            <PreviewSettings
              name="selection-preview-mode"
              columns={columns}
              cfg={cfg}
              onChange={setCfg}
            />
            <p className="text-xs text-slate-500">
              Vale para {layerName || 'a camada'} (a mesma configuração do modo lista).
            </p>
          </div>
        )}
        {url ? (
          <iframe
            title="Preview"
            src={url}
            // Sem acesso ao sistema: não navega a janela principal nem lê o conteúdo dela.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            referrerPolicy="no-referrer"
            className="block min-h-0 w-full flex-1 border-0 bg-white"
          />
        ) : (
          <p className="p-4 text-sm text-slate-500">{message}</p>
        )}
      </div>
    </FloatingPanel>
  );
}
