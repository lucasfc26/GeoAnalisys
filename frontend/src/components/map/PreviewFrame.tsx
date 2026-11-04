import { ExternalLink, MonitorPlay } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { fileUrlOf, isImageFile, localFileEmbedUrl, localFilePath } from '@/lib/listPreview';
import { FloatingPanel } from '../ui/FloatingPanel';

/** O que o frame mostra: página da web, imagem local ou outro arquivo local. */
export function PreviewSurface({ title, url }: { title: string; url: string }) {
  const local = localFilePath(url);
  const [failed, setFailed] = useState(false);
  if (local && !window.geoanalisys) {
    return (
      <p className="p-4 text-sm text-slate-500">
        Este link é um arquivo do computador. Ele abre no programa GeoAnalisys.
      </p>
    );
  }
  if (failed) {
    return (
      <p className="p-4 text-sm text-slate-500">
        Não foi possível abrir o arquivo. Confira se ele ainda está nesse caminho.
      </p>
    );
  }
  const src = local ? localFileEmbedUrl(local) : url;
  if (local && isImageFile(local)) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-50">
        <img
          src={src}
          alt={title}
          className="max-h-full max-w-full object-contain"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  return (
    <iframe
      title={title}
      src={src}
      // Página da web: sem acesso ao sistema. Arquivo local: o endereço interno precisa carregar
      // a imagem ou o PDF, e o sandbox impediria isso.
      sandbox={local ? undefined : 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'}
      referrerPolicy="no-referrer"
      className="block h-full w-full border-0 bg-white"
    />
  );
}

export function openOutside(url: string, externalUrl?: string) {
  const local = localFilePath(url);
  const href = local ? fileUrlOf(local) : (externalUrl ?? url);
  return {
    href,
    onClick: (e: { preventDefault: () => void }) => {
      if (!local || !window.geoanalisys?.files?.open) return;
      e.preventDefault();
      void window.geoanalisys.files.open(href);
    },
  };
}

/**
 * Frame do preview (modo lista, Duplicidades): um por registro em análise. A janela fica montada
 * enquanto o preview estiver ligado; ao navegar, só o endereço muda (posição e tamanho escolhidos são
 * mantidos).
 */
export function PreviewFrame({
  title,
  url,
  externalUrl,
  message,
  index,
  onClose,
  placement,
}: {
  title: string;
  /** Link a carregar; sem link, mostra `message` */
  url: string | null;
  /** Link de "Abrir fora do sistema", quando difere de `url` (ex.: Street View) */
  externalUrl?: string;
  message: string;
  /** Ordem (lista 1, 2…): janelas deslocadas para não ficarem uma sobre a outra */
  index: number;
  onClose: () => void;
  /** Posição e tamanho iniciais no lugar do padrão (canto superior direito, em cascata) */
  placement?: { defaultClassName: string; defaultStyle?: CSSProperties; className: string };
}) {
  return (
    <FloatingPanel
      title={title}
      icon={<MonitorPlay className="size-4 text-accent-600" />}
      onClose={onClose}
      defaultClassName={placement?.defaultClassName ?? 'top-3 right-3'}
      defaultStyle={
        placement
          ? placement.defaultStyle
          : { marginTop: (index % 6) * 32, marginRight: (index % 6) * 32 }
      }
      className={placement?.className ?? 'h-[26rem] w-[34rem] max-w-[calc(100%-1.5rem)]'}
      resizable={{ minWidth: 240, minHeight: 160 }}
      actions={
        url && (
          <a
            {...openOutside(url, externalUrl)}
            target="_blank"
            rel="noreferrer"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Abrir fora do sistema"
            aria-label="Abrir fora do sistema"
          >
            <ExternalLink className="size-4" />
          </a>
        )
      }
    >
      {url ? (
        <PreviewSurface title={title} url={url} />
      ) : (
        <p className="p-4 text-sm text-slate-500">{message}</p>
      )}
    </FloatingPanel>
  );
}
