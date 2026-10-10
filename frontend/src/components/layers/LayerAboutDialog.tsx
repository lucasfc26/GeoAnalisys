import { useQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSources } from '@/hooks/useSourceData';
import { layerName } from '@/lib/layers';
import { normalizeTree } from '@/lib/layerTree';
import { TEMP_SCHEMA } from '@/services/layers';
import { databaseService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import { fmtInt } from '@/utils/format';
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

/** Linha "rótulo: valor"; `copy` mostra o valor em fonte fixa com botão de copiar. */
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

/** Camadas › Sobre: de onde vem a camada (banco, servidor, tabela), o limite (arquivo) ou o grupo. */
export default function LayerAboutDialog() {
  const target = useAppStore((s) => s.dialogs.layerAbout);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const layers = useAppStore((s) => s.layers);
  const layerTree = useAppStore((s) => s.layerTree);
  const boundaries = useAppStore((s) => s.boundaries);
  const sources = useSources();
  const info = useQuery({
    queryKey: ['db-info'],
    queryFn: databaseService.info,
    enabled: target?.kind === 'layer',
  });
  if (!target) return null;
  const close = () => closeDialog('layerAbout');

  let title = 'Sobre';
  let body: ReactNode = null;

  if (target.kind === 'layer') {
    const layer = layers.find((l) => l.sourceId === target.id);
    const source = sources.data?.find((s) => s.id === target.id);
    const db = info.data;
    const server = db?.host ? `${db.host}:${db.port ?? 5432}` : null;
    const table = source ? `${source.schema}.${source.tableName}` : null;
    const database = source?.database || db?.database;
    const address =
      source && database
        ? `postgresql://${db?.user ? `${db.user}@` : ''}${server ?? 'localhost'}/${database}/${table}`
        : null;
    title = `Sobre: ${layerName(layer, source)}`;
    body = source ? (
      <dl>
        <Row label="Nome no painel">{layerName(layer, source)}</Row>
        {layer?.name?.trim() && <Row label="Nome da fonte">{source.name}</Row>}
        <Row label="Endereço" copy={address ?? undefined}>
          {address ?? '…'}
        </Row>
        <Row label="Servidor">{server ?? (info.isLoading ? '…' : 'não informado')}</Row>
        <Row label="Banco de dados" copy={database}>
          {database ?? '…'}
        </Row>
        {db?.user && <Row label="Usuário">{db.user}</Row>}
        <Row label="Tabela" copy={table ?? undefined}>
          {table}
        </Row>
        {source.schema === TEMP_SCHEMA && (
          <Row label="Tipo">Camada importada (tabela temporária em {TEMP_SCHEMA})</Row>
        )}
        <Row label="Colunas">
          ID: {source.idColumn} · X: {source.xColumn} · Y: {source.yColumn}
        </Row>
        <Row label="Sistema de coordenadas">
          {source.coordinateSystem}
          {source.proj4 ? ` (${source.proj4})` : ''}
        </Row>
        <Row label="ID da fonte" copy={source.id}>
          {source.id}
        </Row>
      </dl>
    ) : (
      <p className="text-sm text-slate-500">Fonte de dados não encontrada.</p>
    );
  } else if (target.kind === 'boundary') {
    const b = boundaries.find((x) => x.id === target.id);
    title = `Sobre: ${b?.name ?? 'limite'}`;
    body = b ? (
      <dl>
        <Row label="Nome">{b.name}</Row>
        {b.origin?.length ? (
          b.origin.map((path, i) => (
            <Row
              key={path + i}
              label={i ? '' : b.origin!.length > 1 ? 'Arquivos de origem' : 'Arquivo de origem'}
              copy={path}
            >
              {path}
            </Row>
          ))
        ) : (
          <Row label="Arquivo de origem">não registrado (limite importado antes desta versão)</Row>
        )}
        <Row label="Feições">{fmtInt(b.features)}</Row>
        <Row label="Armazenado em">
          Projeto / navegador (cópia das geometrias; o arquivo original não é alterado)
        </Row>
        {b.bounds && (
          <Row label="Extensão">
            {b.bounds.minLat.toFixed(5)}, {b.bounds.minLng.toFixed(5)} →{' '}
            {b.bounds.maxLat.toFixed(5)}, {b.bounds.maxLng.toFixed(5)}
          </Row>
        )}
      </dl>
    ) : (
      <p className="text-sm text-slate-500">Limite não encontrado.</p>
    );
  } else {
    const tree = normalizeTree(
      layerTree,
      layers.map((l) => l.sourceId),
    );
    const g = tree.find((n) => n.kind === 'group' && n.id === target.id);
    title = `Sobre: ${g?.kind === 'group' ? g.name : 'grupo'}`;
    body =
      g?.kind === 'group' ? (
        <dl>
          <Row label="Grupo">{g.name}</Row>
          <Row label="Camadas">
            {g.children.length
              ? g.children
                  .map((id) =>
                    layerName(
                      layers.find((l) => l.sourceId === id),
                      sources.data?.find((s) => s.id === id),
                    ),
                  )
                  .join(', ')
              : 'nenhuma (arraste camadas para o grupo)'}
          </Row>
          <Row label="Observação">Grupos só organizam o painel; não alteram o banco.</Row>
        </dl>
      ) : (
        <p className="text-sm text-slate-500">Grupo não encontrado.</p>
      );
  }

  return (
    <Dialog
      open
      size="md"
      title={title}
      onClose={close}
      footer={<Button onClick={close}>Fechar</Button>}
    >
      {body}
    </Dialog>
  );
}
