import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Download,
  Eraser,
  FileUp,
  FilterX,
  MapPin,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '@/lib/api';
import { selectPoints, type ToolPoint } from '@/lib/selectPoints';
import { changesService, type ChangeAction, type ChangeRow } from '@/services/changes';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { changeObservation, fmtChangeList, fmtChangeValue } from '@/utils/changes';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorState, SkeletonList } from '../ui/States';
import { toast } from '../ui/Toaster';
import { ChangeEditDialog } from './ChangeEditDialog';
import { ChangeImportDialog } from './ChangeImportDialog';
import { ChangeObservationDialog } from './ChangeObservationDialog';

const PAGE = 200;
/** Linhas por requisição de rollback (cada ponto é desfeito na sua própria transação). */
const ROLLBACK_BATCH = 200;
const DOT: Record<ChangeAction, string> = {
  CREATE: 'bg-emerald-500',
  DELETE: 'bg-red-500',
  UPDATE: 'bg-amber-500',
};

type Confirm = { kind: 'clear' } | { kind: 'forget' | 'rollback'; ids: string[] };

/** Filtros por coluna (textos sem diferenciar maiúsculas e acentos; horários do datetime-local). */
interface Filters {
  table: string;
  observation: string;
  attribute: string;
  oldValue: string;
  newValue: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = {
  table: '',
  observation: '',
  attribute: '',
  oldValue: '',
  newValue: '',
  from: '',
  to: '',
};
/** Preencher os valores não alterados no XLSX (escolha lembrada) */
const FILL_KEY = 'geoanalisys-changes-fill';
/** Ids por requisição de registros (limite do backend) */
const RECORDS_BATCH = 1000;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

/** A linha passa nos filtros? Com atributo, os valores old/new olham só os atributos que casam. */
function matches(r: ChangeRow, q: string, f: Filters): boolean {
  if (q) {
    const hit = [
      r.sourceName,
      r.recordId,
      changeObservation(r.action, r.observation, r.attributes),
      ...r.attributes,
      ...r.oldValues.map(fmtChangeValue),
      ...r.newValues.map(fmtChangeValue),
    ].some((s) => fold(s).includes(q));
    if (!hit) return false;
  }
  if (f.table && r.sourceName !== f.table) return false;
  const obs = fold(f.observation);
  if (obs && !fold(changeObservation(r.action, r.observation, r.attributes)).includes(obs)) {
    return false;
  }
  const attr = fold(f.attribute);
  const idx = r.attributes.flatMap((a, i) => (!attr || fold(a).includes(attr) ? [i] : []));
  if (attr && !idx.length) return false;
  const oldV = fold(f.oldValue);
  if (oldV && !idx.some((i) => fold(fmtChangeValue(r.oldValues[i])).includes(oldV))) return false;
  const newV = fold(f.newValue);
  if (newV && !idx.some((i) => fold(fmtChangeValue(r.newValues[i])).includes(newV))) return false;
  const t = new Date(r.updatedAt).getTime();
  if (f.from && t < new Date(f.from).getTime()) return false;
  // Sem segundos no campo: "até 10:30" inclui 10:30:59.
  if (f.to && t >= new Date(f.to).getTime() + (f.to.length <= 16 ? 60_000 : 1000)) return false;
  return true;
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px] font-medium text-slate-500">
      {label}
      {children}
    </label>
  );
}

const filterInput =
  'h-7 w-full min-w-0 rounded-md border border-slate-300 px-2 text-xs text-slate-800 focus:border-accent-500 focus:outline-none';

function SelectBox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className="size-3.5 cursor-pointer accent-accent-600"
    />
  );
}

function RowAction({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={clsx('rounded p-1 text-slate-400 hover:bg-slate-100', className)}
    >
      {children}
    </button>
  );
}

/**
 * Tabela de Alterações do projeto aberto: pontos adicionados, removidos e alterados. Cada linha (ou as
 * marcadas) pode ser limpa da tabela, editada ou desfeita (rollback); também importa alterações de
 * planilha, baixa XLSX e limpa tudo (só as do projeto).
 */
export default function ChangesDialog() {
  const closeDialog = useAppStore((s) => s.closeDialog);
  const project = useProjectStore((s) => s.project);
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [locating, setLocating] = useState(false);
  const [fill, setFill] = useState(() => {
    try {
      return localStorage.getItem(FILL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const changeFill = (on: boolean) => {
    setFill(on);
    try {
      localStorage.setItem(FILL_KEY, on ? '1' : '0');
    } catch {
      /* só nesta sessão */
    }
  };
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<ChangeRow | null>(null);
  const [observing, setObserving] = useState<string[] | null>(null);
  const [importing, setImporting] = useState(false);

  const changes = useQuery({
    queryKey: ['changes', project?.id ?? null],
    queryFn: changesService.list,
    staleTime: 0,
  });

  const refresh = (pointsChanged: boolean) => {
    qc.invalidateQueries({ queryKey: ['changes'] });
    if (pointsChanged) qc.invalidateQueries({ queryKey: ['points'] });
  };

  const clear = useMutation({
    mutationFn: changesService.clear,
    onSuccess: (r) => {
      toast.success(`${fmtInt(r.deleted)} alteração(ões) removida(s) da tabela.`);
      setConfirm(null);
      setSelected(new Set());
      refresh(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const forget = useMutation({
    mutationFn: (ids: string[]) => changesService.forget(ids),
    onSuccess: (r, ids) => {
      toast.success(`${fmtInt(r.deleted)} alteração(ões) limpa(s) da tabela.`);
      setConfirm(null);
      const gone = new Set(ids);
      setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
      refresh(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const rollback = useMutation({
    mutationFn: async (ids: string[]) => {
      let done = 0;
      const errors: Awaited<ReturnType<typeof changesService.rollback>>['errors'] = [];
      for (let i = 0; i < ids.length; i += ROLLBACK_BATCH) {
        const r = await changesService.rollback(ids.slice(i, i + ROLLBACK_BATCH));
        done += r.done;
        errors.push(...r.errors);
      }
      return { done, errors };
    },
    onSuccess: (r, ids) => {
      const app = useAppStore.getState();
      const done = new Set(ids);
      const removed = (changes.data ?? []).filter(
        (c) => done.has(c.id) && c.action === 'CREATE' && c.sourceId === app.sourceId,
      );
      const failed = new Set(r.errors.map((e) => e.id));
      const gone = removed.filter((c) => !failed.has(c.id)).map((c) => c.recordId);
      if (gone.length) app.removeIds(gone);
      if (r.done) toast.success(`${fmtInt(r.done)} ponto(s) voltaram ao estado original.`);
      if (r.errors.length) {
        const first = r.errors
          .slice(0, 3)
          .map((e) => `${e.sourceName} ${e.recordId}: ${e.message}`)
          .join(' · ');
        toast.error(
          `${fmtInt(r.errors.length)} não puderam ser desfeito(s). ${first}${r.errors.length > 3 ? ' …' : ''}`,
        );
      }
      setConfirm(null);
      setSelected((s) => new Set([...s].filter((id) => !done.has(id) || failed.has(id))));
      refresh(r.done > 0);
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      refresh(true);
    },
  });

  const tables = useMemo(
    () =>
      [...new Set((changes.data ?? []).map((r) => r.sourceName))].sort((x, y) =>
        x.localeCompare(y, 'pt-BR'),
      ),
    [changes.data],
  );
  const filtering = q.trim() !== '' || Object.values(filters).some(Boolean);
  const rows = useMemo(() => {
    const all = changes.data ?? [];
    const t = fold(q);
    return all.filter(
      (r) => (!onlyMarked || selected.has(r.id)) && (!filtering || matches(r, t, filters)),
    );
  }, [changes.data, q, filters, filtering, onlyMarked, selected]);
  const setFilter = (p: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setPage(0);
  };
  const timeError =
    filters.from && filters.to && new Date(filters.from) > new Date(filters.to)
      ? 'O início é depois do fim.'
      : null;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE, current * PAGE + PAGE);
  const total = changes.data?.length ?? 0;

  /** Marcadas que ainda estão na tabela */
  const marked = useMemo(
    () => (changes.data ?? []).filter((r) => selected.has(r.id)).map((r) => r.id),
    [changes.data, selected],
  );
  const markedInView = rows.filter((r) => selected.has(r.id)).length;
  const allInView = rows.length > 0 && markedInView === rows.length;
  const toggleAll = (on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const r of rows) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** `ids` = só essas linhas; ausente = todas */
  const download = async (ids?: string[]) => {
    setDownloading(true);
    try {
      await changesService.downloadXlsx(ids, fill);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  /**
   * Seleciona no mapa os pontos das linhas marcadas (removidos não existem mais). Com várias
   * tabelas, fica a camada ativa ou a com mais pontos marcados.
   */
  const showOnMap = async () => {
    const bySource = new Map<string, string[]>();
    for (const r of changes.data ?? []) {
      if (!selected.has(r.id) || r.action === 'DELETE') continue;
      bySource.set(r.sourceId, [...(bySource.get(r.sourceId) ?? []), r.recordId]);
    }
    if (!bySource.size) {
      toast.error('As linhas marcadas são de pontos removidos: não há o que mostrar no mapa.');
      return;
    }
    const active = useAppStore.getState().sourceId;
    const [sourceId, ids] =
      (active && bySource.has(active) ? ([active, bySource.get(active)!] as const) : null) ??
      [...bySource].sort((x, y) => y[1].length - x[1].length)[0];
    setLocating(true);
    try {
      const points: ToolPoint[] = [];
      for (let i = 0; i < ids.length; i += RECORDS_BATCH) {
        const recs = await pointsService.records(sourceId, ids.slice(i, i + RECORDS_BATCH));
        for (const p of recs) {
          if (p.x !== null && p.y !== null && p.lat !== null && p.lng !== null) {
            points.push({ id: p.id, x: p.x, y: p.y, lat: p.lat, lng: p.lng });
          }
        }
      }
      if (!points.length) {
        toast.error('Os pontos marcados não foram encontrados ou estão sem coordenadas.');
        return;
      }
      selectPoints(sourceId, points);
      const others = bySource.size - 1;
      toast.success(
        `${fmtInt(points.length)} ponto(s) selecionado(s) no mapa${
          others ? ` (só de uma tabela; ${fmtInt(others)} outra(s) ficaram de fora)` : ''
        }.`,
      );
      closeDialog('changes');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLocating(false);
    }
  };

  const busy = clear.isPending || forget.isPending || rollback.isPending;
  const confirmText = (c: Confirm) => {
    if (c.kind === 'clear')
      return `Limpar as ${fmtInt(total)} alterações ${
        project ? `do projeto "${project.name}"` : 'feitas sem projeto'
      }? Essa ação não pode ser desfeita.`;
    if (c.kind === 'forget')
      return `Limpar ${fmtInt(c.ids.length)} alteração(ões) da tabela? Os pontos não mudam.`;
    return `Voltar ${fmtInt(c.ids.length)} ponto(s) ao estado original? Alterados recebem os valores antigos, adicionados são excluídos e removidos são restaurados.`;
  };
  const runConfirm = (c: Confirm) => {
    if (c.kind === 'clear') clear.mutate();
    else if (c.kind === 'forget') forget.mutate(c.ids);
    else rollback.mutate(c.ids);
  };

  return (
    <Dialog
      open
      size="xl"
      title={project ? `Tabela de Alterações — ${project.name}` : 'Tabela de Alterações'}
      description={`Pontos adicionados, removidos e alterados ${
        project ? 'neste projeto' : 'sem projeto aberto'
      } (edições repetidas mostram a 1ª versão e a atual).`}
      onClose={() => closeDialog('changes')}
      footer={
        confirm ? (
          <>
            <span
              className={clsx(
                'mr-auto text-sm font-medium',
                confirm.kind === 'forget' ? 'text-slate-700' : 'text-red-700',
              )}
            >
              {confirmText(confirm)}
            </span>
            <Button onClick={() => setConfirm(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant={confirm.kind === 'forget' ? 'primary' : 'danger'}
              loading={busy}
              onClick={() => runConfirm(confirm)}
            >
              {confirm.kind === 'rollback' ? 'Confirmar rollback' : 'Confirmar limpeza'}
            </Button>
          </>
        ) : (
          <>
            <Button
              className="mr-auto text-red-600"
              icon={<Trash2 className="size-4" />}
              disabled={!total}
              onClick={() => setConfirm({ kind: 'clear' })}
            >
              Limpar tabela
            </Button>
            <Button icon={<FileUp className="size-4" />} onClick={() => setImporting(true)}>
              Importar
            </Button>
            <label
              className="flex items-center gap-1.5 text-xs text-slate-600"
              title="No XLSX, os atributos das colunas de alteração que o ponto não alterou vêm com o valor atual dele (old = new). Adicionados: só new; removidos: só old. Atributos que nenhum ponto alterou continuam fora."
            >
              <input
                type="checkbox"
                checked={fill}
                onChange={(e) => changeFill(e.target.checked)}
                className="accent-accent-600"
              />
              Preencher valores não alterados
            </label>
            <Button
              icon={<Download className="size-4" />}
              loading={downloading}
              disabled={!rows.length}
              title={
                filtering || onlyMarked
                  ? 'Baixa só as linhas que aparecem com os filtros atuais'
                  : 'Baixa a tabela inteira'
              }
              onClick={() =>
                void download(filtering || onlyMarked ? rows.map((r) => r.id) : undefined)
              }
            >
              {filtering || onlyMarked
                ? `Baixar XLSX (${fmtInt(rows.length)} filtradas)`
                : 'Baixar XLSX'}
            </Button>
            <Button variant="primary" onClick={() => closeDialog('changes')}>
              Fechar
            </Button>
          </>
        )
      }
    >
      {/* Fixa no topo enquanto a lista rola (compensa o padding do corpo da janela). */}
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 mb-3 space-y-2 border-b border-slate-200 bg-white px-5 pt-4 pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              placeholder="Buscar em tudo (tabela, ID, observação, atributos e valores)…"
              className="h-8 w-full rounded-md border border-slate-300 pr-2 pl-7 text-sm focus:border-accent-500 focus:outline-none"
            />
          </div>
          <span className="text-xs text-slate-500">
            {fmtInt(rows.length)}
            {rows.length !== total && ` de ${fmtInt(total)}`} registro(s)
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className="size-3.5" />}
            onClick={() => changes.refetch()}
            loading={changes.isFetching}
          >
            Atualizar
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <FilterField label="Tabela">
            <select
              value={filters.table}
              onChange={(e) => setFilter({ table: e.target.value })}
              className={filterInput}
            >
              <option value="">Todas</option>
              {tables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Observação">
            <input
              value={filters.observation}
              onChange={(e) => setFilter({ observation: e.target.value })}
              placeholder="contém…"
              className={filterInput}
            />
          </FilterField>
          <FilterField label="Atributo alterado">
            <input
              value={filters.attribute}
              onChange={(e) => setFilter({ attribute: e.target.value })}
              placeholder="contém…"
              className={filterInput}
            />
          </FilterField>
          <FilterField label="Valor old">
            <input
              value={filters.oldValue}
              onChange={(e) => setFilter({ oldValue: e.target.value })}
              placeholder="contém…"
              className={filterInput}
            />
          </FilterField>
          <FilterField label="Valor new">
            <input
              value={filters.newValue}
              onChange={(e) => setFilter({ newValue: e.target.value })}
              placeholder="contém…"
              className={filterInput}
            />
          </FilterField>
          <FilterField label="De (horário)">
            <input
              type="datetime-local"
              step={1}
              value={filters.from}
              onChange={(e) => setFilter({ from: e.target.value })}
              className={filterInput}
            />
          </FilterField>
          <FilterField label="Até (horário)">
            <input
              type="datetime-local"
              step={1}
              value={filters.to}
              onChange={(e) => setFilter({ to: e.target.value })}
              className={filterInput}
            />
          </FilterField>
        </div>
        {timeError && <p className="text-xs text-red-600">{timeError}</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <Button size="sm" disabled={!rows.length || allInView} onClick={() => toggleAll(true)}>
            Marcar {filtering ? 'filtradas' : 'todas'} ({fmtInt(rows.length)})
          </Button>
          <Button size="sm" disabled={!markedInView} onClick={() => toggleAll(false)}>
            Desmarcar {filtering ? 'filtradas' : 'todas'}
          </Button>
          <label className="ml-1 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={onlyMarked}
              onChange={(e) => {
                setOnlyMarked(e.target.checked);
                setPage(0);
              }}
              className="accent-accent-600"
            />
            Mostrar só as marcadas
          </label>
          {(filtering || onlyMarked) && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              icon={<FilterX className="size-3.5" />}
              onClick={() => {
                setQ('');
                setFilters(NO_FILTERS);
                setOnlyMarked(false);
                setPage(0);
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>

        {marked.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-accent-50 px-2.5 py-1.5 text-xs text-slate-700">
            <span className="mr-auto font-medium">{fmtInt(marked.length)} marcada(s)</span>
            <Button
              size="sm"
              icon={<Download className="size-3.5" />}
              loading={downloading}
              disabled={busy}
              onClick={() => void download(marked)}
              title="Baixa só as linhas marcadas"
            >
              Baixar XLSX
            </Button>
            <Button
              size="sm"
              icon={<MapPin className="size-3.5" />}
              loading={locating}
              disabled={busy}
              onClick={() => void showOnMap()}
              title="Seleciona no mapa os pontos das linhas marcadas"
            >
              Ver no mapa
            </Button>
            <Button
              size="sm"
              icon={<Eraser className="size-3.5" />}
              disabled={busy}
              onClick={() => setConfirm({ kind: 'forget', ids: marked })}
            >
              Limpar
            </Button>
            <Button
              size="sm"
              icon={<MessageSquareText className="size-3.5" />}
              disabled={busy}
              onClick={() => setObserving(marked)}
            >
              Observação
            </Button>
            <Button
              size="sm"
              className="text-red-600"
              icon={<Undo2 className="size-3.5" />}
              disabled={busy}
              onClick={() => setConfirm({ kind: 'rollback', ids: marked })}
            >
              Rollback
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Desmarcar
            </Button>
          </div>
        )}
      </div>

      {changes.isLoading ? (
        <SkeletonList rows={6} />
      ) : changes.isError ? (
        <ErrorState error={changes.error} onRetry={() => changes.refetch()} />
      ) : !rows.length ? (
        <p className="py-10 text-center text-sm text-slate-500">
          {total ? 'Nenhuma alteração corresponde aos filtros.' : 'Nenhuma alteração registrada.'}
        </p>
      ) : (
        <>
          <div className="scroll-thin overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="w-8 px-2.5 py-2">
                    <SelectBox
                      checked={allInView}
                      indeterminate={markedInView > 0 && !allInView}
                      onChange={toggleAll}
                      label={allInView ? 'Desmarcar todas' : 'Marcar todas'}
                    />
                  </th>
                  <th className="px-1 py-2 font-semibold whitespace-nowrap">Ações</th>
                  {[
                    'Tabela',
                    'ID',
                    'Observação',
                    'Atributos Alterados',
                    'Valores Old',
                    'Valores New',
                    'Horário',
                  ].map((h) => (
                    <th key={h} className="px-2.5 py-2 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    className={clsx(
                      'align-top',
                      selected.has(r.id) ? 'bg-accent-50/60' : 'hover:bg-slate-50',
                    )}
                  >
                    <td className="px-2.5 py-1.5">
                      <SelectBox
                        checked={selected.has(r.id)}
                        onChange={(on) => toggle(r.id, on)}
                        label={`Marcar ${r.sourceName} ${r.recordId}`}
                      />
                    </td>
                    <td className="px-1 py-0.5 whitespace-nowrap">
                      <RowAction
                        label="Limpar alteração (o ponto não muda)"
                        className="hover:text-slate-700"
                        onClick={() => setConfirm({ kind: 'forget', ids: [r.id] })}
                      >
                        <Eraser className="size-3.5" />
                      </RowAction>
                      <RowAction
                        label="Editar"
                        className="hover:text-accent-700"
                        onClick={() => setEditing(r)}
                      >
                        <Pencil className="size-3.5" />
                      </RowAction>
                      <RowAction
                        label="Rollback (voltar o ponto ao estado original)"
                        className="hover:text-red-600"
                        onClick={() => setConfirm({ kind: 'rollback', ids: [r.id] })}
                      >
                        <Undo2 className="size-3.5" />
                      </RowAction>
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{r.sourceName}</td>
                    <td
                      className="px-2.5 py-1.5 font-mono whitespace-nowrap"
                      title={r.idColumn ? `Coluna ${r.idColumn}` : undefined}
                    >
                      {r.recordId}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={clsx('size-2 shrink-0 rounded-full', DOT[r.action])} />
                        {changeObservation(r.action, r.observation, r.attributes)}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 font-mono">{fmtChangeList(r.attributes)}</td>
                    <td className="px-2.5 py-1.5 font-mono">{fmtChangeList(r.oldValues)}</td>
                    <td className="px-2.5 py-1.5 font-mono">{fmtChangeList(r.newValues)}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-500">
                      {fmtTime(r.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-600">
              <Button size="sm" onClick={() => setPage(current - 1)} disabled={current === 0}>
                Anterior
              </Button>
              Página {current + 1} de {pages}
              <Button
                size="sm"
                onClick={() => setPage(current + 1)}
                disabled={current >= pages - 1}
              >
                Próxima
              </Button>
            </div>
          )}
        </>
      )}

      {editing &&
        createPortal(
          <ChangeEditDialog
            row={editing}
            onClose={() => setEditing(null)}
            onSaved={() => refresh(true)}
          />,
          document.body,
        )}
      {observing &&
        createPortal(
          <ChangeObservationDialog
            ids={observing}
            onClose={() => setObserving(null)}
            onSaved={() => refresh(false)}
          />,
          document.body,
        )}
      {importing &&
        createPortal(
          <ChangeImportDialog
            onClose={() => setImporting(false)}
            onImported={() => refresh(true)}
          />,
          document.body,
        )}
    </Dialog>
  );
}
