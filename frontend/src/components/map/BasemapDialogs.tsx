import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BUILTIN_BASEMAPS, basemapLink, parseXyzUrl, resolveBasemap } from '@/lib/basemaps';
import { useAppStore } from '@/stores/appStore';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      title="Copiar"
      aria-label="Copiar"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <Check className="size-3.5 text-accent-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Row({ label, children, copy }: { label: string; children: ReactNode; copy?: string }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-2 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="flex min-w-0 items-start gap-1 text-sm text-slate-800">
        <span
          className={
            copy ? 'min-w-0 flex-1 font-mono text-xs break-all' : 'min-w-0 flex-1 break-words'
          }
        >
          {children}
        </span>
        {copy && <CopyButton text={copy} />}
      </dd>
    </div>
  );
}

/** Dados de um fundo para as janelas: definição, nome exibido e o registro (se adicionado por URL). */
function useBasemap(id: string) {
  const custom = useAppStore((s) => s.customBasemaps);
  const names = useAppStore((s) => s.basemapNames);
  const def = resolveBasemap(id, custom);
  const entry = id.startsWith('xyz:') ? custom.find((c) => `xyz:${c.id}` === id) : undefined;
  const builtin = BUILTIN_BASEMAPS.find((b) => b.id === id);
  const name = entry?.name ?? names[id] ?? def.label;
  return { def, entry, builtin, name };
}

/**
 * Ver/editar o link do fundo. Adicionados por URL: link e zoom máximo editáveis. Padrões
 * (OpenStreetMap, Esri): só leitura, com botão de copiar.
 */
export function BasemapLinkDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { def, entry, name } = useBasemap(id);
  const updateCustomBasemap = useAppStore((s) => s.updateCustomBasemap);
  const [url, setUrl] = useState(entry?.url ?? basemapLink(def));
  const [maxZoom, setMaxZoom] = useState(entry?.maxZoom ?? def.maxzoom);
  const valid = !!parseXyzUrl(url);
  const save = () => {
    if (!entry || !valid) return;
    updateCustomBasemap(entry.id, { url: url.trim(), maxZoom });
    onClose();
  };

  return (
    <Dialog
      open
      size="md"
      title={`Link do mapa: ${name}`}
      description={
        entry
          ? 'URL dos tiles no formato XYZ (como no QGIS). Ao salvar, o mapa recarrega com o link novo.'
          : 'Mapa padrão do sistema: o link é fixo (só para ver e copiar).'
      }
      onClose={onClose}
      footer={
        entry ? (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!valid} onClick={save}>
              Salvar
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Fechar</Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs text-slate-500">URL dos tiles</span>
          <div className="mt-0.5 flex items-center gap-1">
            <input
              value={url}
              readOnly={!entry}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              spellCheck={false}
              autoFocus={!!entry}
              placeholder="https://servidor/{z}/{x}/{y}.png"
              className="block h-8 w-full rounded-md border border-slate-300 bg-white px-2 font-mono text-xs text-slate-800 read-only:bg-slate-50 focus:border-accent-500 focus:outline-none"
              aria-label="URL dos tiles"
            />
            {url && <CopyButton text={url} />}
          </div>
        </label>
        {entry && url && !valid && (
          <p className="text-xs text-red-600">
            A URL precisa começar com http(s) e ter {'{z}'}, {'{x}'} e {'{y}'} (ou {'{q}'}).
          </p>
        )}
        {def.overlay && (
          <Row label="Camada de rótulos" copy={def.overlay.tiles[0]}>
            {def.overlay.tiles[0]}
          </Row>
        )}
        {entry && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Zoom máximo do servidor
            <input
              type="number"
              min={1}
              max={24}
              value={maxZoom}
              onChange={(e) => setMaxZoom(Math.min(24, Math.max(1, Number(e.target.value) || 19)))}
              className="h-7 w-16 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
            />
          </label>
        )}
      </div>
    </Dialog>
  );
}

/** Sobre o fundo: nome, tipo, link, zoom, sistema de tiles e créditos. */
export function BasemapAboutDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { def, entry, builtin, name } = useBasemap(id);
  const link = basemapLink(def, entry);
  const credits = def.attribution.replace(/<[^>]+>/g, '');
  return (
    <Dialog
      open
      size="md"
      title={`Sobre: ${name}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>Fechar</Button>}
    >
      <dl>
        <Row label="Nome">{name}</Row>
        {builtin && name !== builtin.label && <Row label="Nome original">{builtin.label}</Row>}
        <Row label="Tipo">
          {entry
            ? 'Adicionado por URL (XYZ)'
            : def.tiles.length
              ? 'Padrão do sistema'
              : 'Sem imagem (só cor de fundo)'}
        </Row>
        {link && (
          <Row label="Link (tiles)" copy={link}>
            {link}
          </Row>
        )}
        {def.overlay && (
          <Row label="Rótulos por cima" copy={def.overlay.tiles[0]}>
            {def.overlay.tiles[0]}
          </Row>
        )}
        {link && (
          <>
            <Row label="Zoom máximo">{def.maxzoom} (acima disso o mapa amplia a última imagem)</Row>
            <Row label="Sistema de tiles">
              {def.scheme === 'tms' ? 'TMS ({-y})' : 'XYZ'} · imagens de 256 px · Web Mercator
              (EPSG:3857)
            </Row>
          </>
        )}
        {credits && <Row label="Créditos">{credits}</Row>}
        <Row label="Guardado em">
          {entry ? 'Projeto (.proj) / preferências deste computador' : 'Embutido no programa'}
        </Row>
      </dl>
    </Dialog>
  );
}
