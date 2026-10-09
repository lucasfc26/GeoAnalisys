import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Database,
  Download,
  ExternalLink,
  Layers,
  MousePointerClick,
  PenSquare,
  Trash2,
} from 'lucide-react';
import { useMemo } from 'react';
import { useActiveSource, useSelectedIds, useSourceSchema } from '@/hooks/useSourceData';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import type { SelectedGroup } from '@/types';
import { categoryColor, fmtCoord, fmtDeg, fmtInt, fmtValue, isUrl } from '@/utils/format';
import { Button } from '../ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../ui/States';
import { RecordDetails } from './RecordDetails';
import { RecordList, type RecordItem } from './RecordList';

function CoordinateHeader({ group, isUtm }: { group: SelectedGroup; isUtm: boolean }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div>
        <dt className="text-slate-500">{isUtm ? 'UTM X' : 'X'}</dt>
        <dd className="font-mono text-slate-800">{fmtCoord(group.x)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">{isUtm ? 'UTM Y' : 'Y'}</dt>
        <dd className="font-mono text-slate-800">{fmtCoord(group.y)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Latitude</dt>
        <dd className="font-mono text-slate-800">{fmtDeg(group.lat)}</dd>
      </div>
      <div>
        <dt className="text-slate-500">Longitude</dt>
        <dd className="font-mono text-slate-800">{fmtDeg(group.lng)}</dd>
      </div>
    </dl>
  );
}

/**
 * Com registros principais (ex.: comparação do modo lista): cada coordenada traz primeiro os
 * principais, em destaque, e abaixo, em cinza, os demais registros do mesmo local; um espaço separa
 * as coordenadas. As coordenadas seguem a ordem dos principais.
 */
function itemsFor(groups: SelectedGroup[], primaryIds: string[] | null): RecordItem[] | undefined {
  if (!primaryIds) return undefined;
  const rank = new Map(primaryIds.map((id, i) => [id, i]));
  const first = (g: SelectedGroup) =>
    Math.min(Infinity, ...g.ids.map((id) => rank.get(id) ?? Infinity));
  const out: RecordItem[] = [];
  for (const g of [...groups].sort((a, b) => first(a) - first(b))) {
    const prim = g.ids.filter((id) => rank.has(id)).sort((a, b) => rank.get(a)! - rank.get(b)!);
    const rest = g.ids.filter((id) => !rank.has(id));
    prim.forEach((id, i) => out.push({ id, primary: true, gap: i === 0 }));
    rest.forEach((id, i) => out.push({ id, muted: true, gap: !prim.length && i === 0 }));
  }
  return out;
}

/** Uma coordenada selecionada: lista de registros sobrepostos + navegação < >. */
function GroupView({
  sourceId,
  group,
  isUtm,
  idLabel,
}: {
  sourceId: string;
  group: SelectedGroup;
  isUtm: boolean;
  idLabel: string;
}) {
  const activeRecordId = useAppStore((s) => s.activeRecordId);
  const openRecord = useAppStore((s) => s.openRecord);
  const primaryIds = useAppStore((s) => s.primaryIds);
  const items = useMemo(() => itemsFor([group], primaryIds), [group, primaryIds]);
  const index = activeRecordId ? group.ids.indexOf(activeRecordId) : -1;
  const multi = group.ids.length > 1;

  const go = (delta: number) => {
    const next = (index + delta + group.ids.length) % group.ids.length;
    openRecord(group.key, group.ids[next]);
  };

  return (
    <div className="space-y-4">
      <CoordinateHeader group={group} isUtm={isUtm} />
      {multi && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">
              <Layers className="mr-1 inline size-4 text-amber-500" />
              Registros nesta coordenada: <b>{group.ids.length}</b>
            </p>
            {index >= 0 && (
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <button
                  className="rounded p-1 hover:bg-slate-100"
                  onClick={() => go(-1)}
                  aria-label="Registro anterior"
                >
                  <ChevronLeft className="size-4" />
                </button>
                {index + 1}/{group.ids.length}
                <button
                  className="rounded p-1 hover:bg-slate-100"
                  onClick={() => go(1)}
                  aria-label="Próximo registro"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </div>
          <RecordList
            sourceId={sourceId}
            ids={group.ids}
            items={items}
            idLabel={idLabel}
            activeId={activeRecordId}
            maxHeight={index >= 0 ? 180 : 420}
            onOpen={(id) => openRecord(group.key, id)}
          />
        </div>
      )}
      {activeRecordId && group.ids.includes(activeRecordId) ? (
        <div>
          {multi && (
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Informações
            </h3>
          )}
          <RecordDetails sourceId={sourceId} id={activeRecordId} />
        </div>
      ) : (
        multi && (
          <p className="text-center text-xs text-slate-500">
            Selecione um registro para ver os detalhes.
          </p>
        )
      )}
    </div>
  );
}

/** Vários pontos selecionados: resumo, ações em massa e lista. */
function MultiView({
  sourceId,
  categoryColumn,
  idLabel,
}: {
  sourceId: string;
  categoryColumn: string | null;
  idLabel: string;
}) {
  const ids = useSelectedIds();
  const selection = useAppStore((s) => s.selection);
  const primaryIds = useAppStore((s) => s.primaryIds);
  const items = useMemo(
    () => itemsFor(Object.values(selection), primaryIds),
    [selection, primaryIds],
  );
  const openDialog = useAppStore((s) => s.openDialog);
  const openRecord = useAppStore((s) => s.openRecord);
  const groupCount = Object.keys(selection).length;
  const schema = useSourceSchema(sourceId);
  const allColumns = useMemo(
    () => (schema.data?.columns ?? []).filter((c) => c.kind !== 'geometry'),
    [schema.data],
  );
  const saved = useAppStore((s) => s.summaryColumns[sourceId]);
  const setSummaryColumns = useAppStore((s) => s.setSummaryColumns);
  // Sem escolha salva: a coluna de categoria da fonte.
  const sumCols = saved?.length ? saved : categoryColumn ? [categoryColumn] : [];

  const summary = useQuery({
    queryKey: ['points', sourceId, 'summary', ids.length, ids[0], ids[ids.length - 1], sumCols],
    queryFn: () => pointsService.summary(sourceId, ids, sumCols),
    enabled: sumCols.length > 0 && ids.length > 0,
  });
  const keyById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of Object.values(selection)) for (const id of g.ids) m.set(id, g.key);
    return m;
  }, [selection]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-2xl font-semibold text-slate-900">{fmtInt(ids.length)}</p>
        <p className="text-xs text-slate-500">
          registros selecionados em {fmtInt(groupCount)} coordenada{groupCount > 1 ? 's' : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          icon={<PenSquare className="size-3.5" />}
          onClick={() => openDialog('bulkEdit', true)}
        >
          Editar em massa
        </Button>
        <Button
          size="sm"
          className="text-red-600"
          icon={<Trash2 className="size-3.5" />}
          onClick={() => openDialog('confirmDelete', { ids })}
        >
          Excluir
        </Button>
        <Button
          size="sm"
          icon={<Download className="size-3.5" />}
          onClick={() => openDialog('export', true)}
        >
          Exportar selecionados
        </Button>
        <Button
          size="sm"
          icon={<CopyPlus className="size-3.5" />}
          onClick={() => openDialog('copyToLayer', true)}
        >
          Copiar para nova camada
        </Button>
      </div>

      <div>
        {/* "Por coluna + coluna…": agrupa pela combinação (ex.: tipo_lampada + potencia → "ME 70"). */}
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Por</h3>
          {sumCols.map((c, i) => (
            <span key={c} className="inline-flex items-center gap-0.5">
              {i > 0 && <span className="text-xs text-slate-400">+</span>}
              <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 py-0.5 pr-0.5 pl-1.5 text-[11px] font-medium text-slate-700">
                {c}
                <button
                  type="button"
                  onClick={() =>
                    setSummaryColumns(
                      sourceId,
                      sumCols.filter((x) => x !== c),
                    )
                  }
                  className="rounded px-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  aria-label={`Remover ${c} do resumo`}
                >
                  ×
                </button>
              </span>
            </span>
          ))}
          <select
            value=""
            onChange={(e) =>
              e.target.value && setSummaryColumns(sourceId, [...sumCols, e.target.value])
            }
            className="h-6 rounded border border-dashed border-slate-300 bg-white px-1 text-[11px] text-slate-600"
            aria-label="Adicionar atributo ao resumo"
            title="Adicionar atributo (os valores são combinados)"
          >
            <option value="">+</option>
            {allColumns
              .filter((c) => !sumCols.includes(c.name))
              .map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        {sumCols.length > 0 &&
          (summary.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : summary.isError ? (
            <ErrorState compact error={summary.error} onRetry={() => summary.refetch()} />
          ) : (
            <ul className="space-y-1.5">
              {summary.data?.values.map((v) => {
                const pct = (v.count / Math.max(ids.length, 1)) * 100;
                return (
                  <li key={v.value ?? '__null'} className="text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-slate-700">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: categoryColor(v.value) }}
                        />
                        {isUrl(v.value) ? (
                          // Link: mostra o endereço e abre no navegador padrão.
                          <a
                            href={v.value}
                            target="_blank"
                            rel="noreferrer"
                            title={`Abrir ${v.value}`}
                            className="min-w-0 break-all text-accent-700 hover:underline"
                          >
                            {v.value}
                            <ExternalLink className="ml-1 inline size-3 align-[-1px]" />
                          </a>
                        ) : (
                          fmtValue(v.value)
                        )}
                      </span>
                      <span className="shrink-0 font-medium text-slate-900">{fmtInt(v.count)}</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded bg-slate-100">
                      <div
                        className="h-1 rounded"
                        style={{ width: `${pct}%`, background: categoryColor(v.value) }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ))}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Registros
        </h3>
        {primaryIds && (
          <p className="mb-1.5 text-[11px] text-slate-500">
            Em destaque os pontos comparados; em cinza, os demais registros das mesmas coordenadas.
          </p>
        )}
        <RecordList
          sourceId={sourceId}
          ids={ids}
          items={items}
          idLabel={idLabel}
          activeId={null}
          onOpen={(id) => openRecord(keyById.get(id) ?? null, id)}
        />
      </div>
    </div>
  );
}

export function DataPanel() {
  const { sourceId, source, sources } = useActiveSource();
  const selection = useAppStore((s) => s.selection);
  const activeKey = useAppStore((s) => s.activeKey);
  const activeRecordId = useAppStore((s) => s.activeRecordId);
  const openRecord = useAppStore((s) => s.openRecord);
  const openDialog = useAppStore((s) => s.openDialog);
  const keys = Object.keys(selection);
  const isUtm = !source?.coordinateSystem.match(/^EPSG:(4326|4674)$/);

  if (sources.isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (!sourceId || !source) {
    return (
      <EmptyState icon={<Database className="size-10" />} title="Nenhuma fonte de dados">
        <p>Selecione a tabela, as colunas UTM e o sistema de coordenadas.</p>
        <Button variant="primary" className="mt-3" onClick={() => openDialog('source', true)}>
          Configurar fonte
        </Button>
      </EmptyState>
    );
  }
  if (!keys.length) {
    return (
      <EmptyState icon={<MousePointerClick className="size-10" />} title="Nenhum ponto selecionado">
        <ul className="mt-2 space-y-1 text-left text-xs">
          <li>• Clique em um ponto para ver os dados</li>
          <li>• Ctrl + clique para seleção múltipla</li>
          <li>• Use Retângulo ou Polígono para selecionar uma região</li>
          <li>• Pontos com número indicam registros sobrepostos</li>
        </ul>
      </EmptyState>
    );
  }

  // Detalhe aberto a partir da lista de seleção múltipla.
  if (keys.length > 1 && activeRecordId) {
    const group = activeKey ? selection[activeKey] : undefined;
    return (
      <div className="space-y-3 p-4">
        <button
          type="button"
          onClick={() => openRecord(null, null)}
          className="flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Voltar à seleção
        </button>
        {group && group.ids.length > 1 ? (
          <GroupView sourceId={sourceId} group={group} isUtm={isUtm} idLabel={source.idColumn} />
        ) : (
          <RecordDetails sourceId={sourceId} id={activeRecordId} />
        )}
      </div>
    );
  }

  if (keys.length === 1) {
    return (
      <div className="p-4">
        <GroupView
          sourceId={sourceId}
          group={selection[keys[0]]}
          isUtm={isUtm}
          idLabel={source.idColumn}
        />
      </div>
    );
  }

  return (
    <div className="p-4">
      <MultiView
        sourceId={sourceId}
        categoryColumn={source.categoryColumn}
        idLabel={source.idColumn}
      />
    </div>
  );
}

export function PanelTitle() {
  const selection = useAppStore((s) => s.selection);
  const ids = useSelectedIds();
  const n = Object.keys(selection).length;
  if (!n) return <>Informações</>;
  if (n === 1)
    return <>{ids.length > 1 ? `${ids.length} registros na coordenada` : 'Ponto selecionado'}</>;
  return <>{fmtInt(ids.length)} selecionados</>;
}
