import { ExternalLink, MonitorPlay } from 'lucide-react';
import type { CSSProperties } from 'react';
import { FloatingPanel } from '../ui/FloatingPanel';

/**
 * Frame do preview (modo lista, Duplicidades): um por registro em análise. A janela fica montada
 * enquanto o preview estiver ligado; ao navegar, só o endereço muda (posição e tamanho escolhidos são
 * mantidos).
 */
export function PreviewFrame({
  title,
  url,
  message,
  index,
  onClose,
  placement,
}: {
  title: string;
  /** Link a carregar; sem link, mostra `message` */
  url: string | null;
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
            href={url}
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
        <iframe
          title={title}
          src={url}
          // Sem acesso ao sistema: não navega a janela principal nem lê o conteúdo dela.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
          className="block h-full w-full border-0 bg-white"
        />
      ) : (
        <p className="p-4 text-sm text-slate-500">{message}</p>
      )}
    </FloatingPanel>
  );
}
