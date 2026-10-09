import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  FileJson,
  FileSpreadsheet,
  FileText,
  Globe,
  GripVertical,
  Loader2,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { useActiveSource, useSelectedIds, useSourceSchema } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import {
  exportData,
  exportService,
  type ExportFormat,
  type ExportOptions,
  type ExportTemplate,
} from '@/services/export';
import { useAppStore } from '@/stores/appStore';
import {
  defaultItems,
  enabledKeys,
  exportColumns,
  isDefaultOrder,
  itemsFromTemplate,
  moveItem,
  sameKeys,
  type ColumnItem,
} from '@/utils/exportColumns';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, RadioCard as Radio, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

type Scope = ExportOptions['scope'];

/** A prévia só precisa das primeiras linhas: limita os IDs enviados. */
const PREVIEW_IDS = 5000;

function previewCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function ExportDialog() {
  const open = useAppStore((s) => s.dialogs.export);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const filters = useAppStore((s) => s.filters);
  const setExportTemplate = useAppStore((s) => s.setExportTemplate);
  const { sourceId, source } = useActiveSource();
  const savedTemplateId = useAppStore((s) => (sourceId ? s.exportTemplates[sourceId] : undefined));
  const ids = useSelectedIds();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>('all');
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [delimiter, setDelimiter] = useState<ExportOptions['delimiter']>(';');
  const [decimal, setDecimal] = useState<'.' | ','>(',');
  const [busy, setBusy] = useState(false);
  /** '' = padrão (todas as colunas) */
  const [templateId, setTemplateId] = useState('');
  const [items, setItems] = useState<ColumnItem[] | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Nome do novo modelo (null = campo fechado) */
  const [newName, setNewName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const schema = useSourceSchema(open ? sourceId : null);
  const cols = useMemo(() => (schema.data ? exportColumns(schema.data) : []), [schema.data]);
  const colByKey = useMemo(() => new Map(cols.map((c) => [c.key, c])), [cols]);
  const templatesKey = ['export-templates', sourceId] as const;
  const templates = useQuery({
    queryKey: templatesKey,
    queryFn: () => exportService.templates(sourceId!),
    enabled: open && !!sourceId,
  });
  const template: ExportTemplate | undefined = templates.data?.find((t) => t.id === templateId);

  useEffect(() => {
    if (open) setScope(ids.length ? 'selected' : filters.length ? 'filtered' : 'all');
  }, [open, ids.length, filters.length]);

  // Ao abrir: aplica o último modelo usado nesta camada (se ainda existir).
  useEffect(() => {
    if (items || !cols.length || !templates.data) return;
    const t = templates.data.find((x) => x.id === savedTemplateId);
    setTemplateId(t?.id ?? '');
    setItems(t ? itemsFromTemplate(cols, t.columns) : defaultItems(cols));
  }, [items, cols, templates.data, savedTemplateId]);

  const chosen = useMemo(() => (items ? enabledKeys(items) : []), [items]);
  const isDefault = !!items && isDefaultOrder(items, cols);
  const dirty = template
    ? !sameKeys(chosen, itemsFromTemplate(cols, template.columns).filter((i) => i.enabled).map((i) => i.key))
    : !isDefault;
  const columns = isDefault ? undefined : chosen;

  const previewColumns = useDebounce(columns, 300);
  const preview = useQuery({
    queryKey: ['export-preview', sourceId, scope, filters, scope === 'selected' ? ids : null, previewColumns],
    queryFn: () =>
      exportService.preview({
        sourceId: sourceId!,
        scope,
        filters,
        ids: ids.slice(0, PREVIEW_IDS),
        columns: previewColumns,
      }),
    enabled: open && !!sourceId && !!items && chosen.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });

  const pick = (id: string) => {
    if (!sourceId) return;
    const t = templates.data?.find((x) => x.id === id);
    setTemplateId(t?.id ?? '');
    setItems(t ? itemsFromTemplate(cols, t.columns) : defaultItems(cols));
    setExportTemplate(sourceId, t?.id ?? null);
    setConfirmDelete(false);
    setNewName(null);
  };

  const refreshTemplates = () => qc.invalidateQueries({ queryKey: templatesKey });
  const create = useMutation({
    mutationFn: (name: string) =>
      exportService.createTemplate({ sourceId: sourceId!, name, columns: chosen }),
    onSuccess: async (t) => {
      await refreshTemplates();
      setTemplateId(t.id);
      setExportTemplate(t.sourceId, t.id);
      setNewName(null);
      toast.success(`Modelo "${t.name}" salvo.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const update = useMutation({
    mutationFn: () => exportService.updateTemplate(templateId, { columns: chosen }),
    onSuccess: async (t) => {
      await refreshTemplates();
      toast.success(`Modelo "${t.name}" atualizado.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => exportService.removeTemplate(templateId),
    onSuccess: async () => {
      const name = template?.name;
      await refreshTemplates();
      pick('');
      toast.success(`Modelo "${name}" excluído.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!open || !sourceId) return null;

  const setAll = (enabled: boolean) => setItems((list) => list?.map((i) => ({ ...i, enabled })) ?? list);
  const toggle = (key: string) =>
    setItems((list) => list?.map((i) => (i.key === key ? { ...i, enabled: !i.enabled } : i)) ?? list);
  const move = (from: number, to: number) => setItems((list) => (list ? moveItem(list, from, to) : list));

  const run = async () => {
    setBusy(true);
    try {
      await exportData({ sourceId, format, scope, filters, ids, delimiter, decimal, columns });
      toast.success('Exportação iniciada.');
      closeDialog('export');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const total = scope === 'selected' ? ids.length : preview.data?.total;

  return (
    <Dialog
      open
      size="xl"
      title="Exportar"
      description={source ? `${source.schema}.${source.tableName}` : undefined}
      onClose={() => closeDialog('export')}
      footer={
        <>
          <Button onClick={() => closeDialog('export')}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={run}
            loading={busy}
            disabled={(delimiter === decimal && format === 'csv') || !chosen.length}
          >
            Exportar
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Registros</Label>
            <Radio checked={scope === 'all'} onChange={() => setScope('all')}>
              Todos os registros
            </Radio>
            <Radio
              checked={scope === 'filtered'}
              disabled={!filters.length}
              onChange={() => setScope('filtered')}
            >
              Registros filtrados{' '}
              {filters.length
                ? `(${filters.length} filtro${filters.length > 1 ? 's' : ''})`
                : '(sem filtros)'}
            </Radio>
            <Radio
              checked={scope === 'selected'}
              disabled={!ids.length}
              onChange={() => setScope('selected')}
            >
              Registros selecionados ({fmtInt(ids.length)})
            </Radio>
          </div>
          <div className="space-y-2">
            <Label>Formato</Label>
            <div className="grid grid-cols-2 gap-2">
              <Radio checked={format === 'xlsx'} onChange={() => setFormat('xlsx')}>
                <FileSpreadsheet className="size-4 text-emerald-600" /> XLSX
              </Radio>
              <Radio checked={format === 'csv'} onChange={() => setFormat('csv')}>
                <FileText className="size-4 text-slate-600" /> CSV
              </Radio>
              <Radio checked={format === 'json'} onChange={() => setFormat('json')}>
                <FileJson className="size-4 text-amber-600" /> GeoJSON
              </Radio>
              <Radio checked={format === 'kml'} onChange={() => setFormat('kml')}>
                <Globe className="size-4 text-sky-600" /> KML
              </Radio>
            </div>
          </div>
          {format === 'csv' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exp-delim">Delimitador</Label>
                <Select
                  id="exp-delim"
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.target.value as ExportOptions['delimiter'])}
                >
                  <option value=";">Ponto e vírgula (;)</option>
                  <option value=",">Vírgula (,)</option>
                  <option value="tab">Tabulação</option>
                  <option value="|">Barra vertical (|)</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="exp-dec">Separador decimal</Label>
                <Select
                  id="exp-dec"
                  value={decimal}
                  onChange={(e) => setDecimal(e.target.value as '.' | ',')}
                >
                  <option value=",">Vírgula (Excel pt-BR)</option>
                  <option value=".">Ponto</option>
                </Select>
              </div>
            </div>
          )}
          <p className="text-xs text-slate-500">
            {format === 'json'
              ? 'GeoJSON (abre no QGIS e em outros SIG): cada registro é um ponto em latitude/longitude (WGS84) com as colunas escolhidas como propriedades.'
              : format === 'kml'
                ? 'KML (Google Earth / Google My Maps): um marcador por registro, com o rótulo como nome e as colunas escolhidas nos detalhes.'
                : `Arquivo UTF-8 com cabeçalho e as colunas escolhidas, na ordem da lista.${format === 'xlsx' ? ' Abas: Pontos, Informações e Metadados.' : ''}`}{' '}
            O arquivo é gerado em streaming no servidor.
          </p>
        </div>

        <div className="min-w-0 space-y-2">
          <Label htmlFor="exp-template" hint="salvo no banco, por tabela">
            Modelo de colunas
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              id="exp-template"
              className="min-w-0 flex-1"
              value={templateId}
              onChange={(e) => pick(e.target.value)}
              disabled={!templates.data}
            >
              <option value="">Padrão — todas as colunas</option>
              {templates.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            {template && (
              <Button
                size="sm"
                icon={<Save className="size-3.5" />}
                disabled={!dirty || !chosen.length}
                loading={update.isPending}
                onClick={() => update.mutate()}
                title="Grava a seleção e a ordem atuais neste modelo"
              >
                Salvar
              </Button>
            )}
            <Button
              size="sm"
              disabled={!chosen.length}
              onClick={() => setNewName(newName === null ? '' : null)}
            >
              Salvar como novo…
            </Button>
            {template &&
              (confirmDelete ? (
                <Button
                  size="sm"
                  variant="danger"
                  loading={remove.isPending}
                  onClick={() => remove.mutate()}
                  onBlur={() => setConfirmDelete(false)}
                >
                  Confirmar exclusão
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() => setConfirmDelete(true)}
                  title="Excluir modelo"
                  aria-label="Excluir modelo"
                />
              ))}
          </div>
          {newName !== null && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newName.trim()) create.mutate(newName.trim());
              }}
            >
              <Input
                autoFocus
                placeholder="Nome do modelo (ex.: Comitê)"
                value={newName}
                maxLength={100}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                loading={create.isPending}
                disabled={!newName.trim()}
              >
                Salvar
              </Button>
            </form>
          )}

          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-slate-500">
            <span>
              {items ? `${chosen.length} de ${items.length} colunas` : 'Carregando colunas…'}
              {dirty && template && <span className="ml-1 text-amber-600">(alterado)</span>}
            </span>
            <span className="flex gap-2">
              <button type="button" className="hover:text-accent-700" onClick={() => setAll(true)}>
                Marcar todas
              </button>
              <button type="button" className="hover:text-accent-700" onClick={() => setAll(false)}>
                Desmarcar todas
              </button>
              <button
                type="button"
                className="hover:text-accent-700"
                onClick={() => setItems(defaultItems(cols))}
              >
                Ordem original
              </button>
            </span>
          </div>
          {schema.isError ? (
            <p className="text-sm text-red-600">{errorMessage(schema.error)}</p>
          ) : !items ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <ul className="scroll-thin max-h-72 overflow-y-auto rounded-md border border-slate-200">
              {items.map((it, i) => {
                const c = colByKey.get(it.key);
                if (!c) return null;
                return (
                  <li
                    key={it.key}
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== i) {
                        move(dragIndex, i);
                        setDragIndex(i);
                      }
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className={clsx(
                      'group flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-sm last:border-b-0',
                      dragIndex === i ? 'bg-accent-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <GripVertical className="size-3.5 shrink-0 cursor-grab text-slate-300" />
                    <input
                      type="checkbox"
                      checked={it.enabled}
                      onChange={() => toggle(it.key)}
                      className="size-3.5 shrink-0 accent-accent-600"
                      aria-label={`Exportar ${c.label}`}
                    />
                    <span
                      className={clsx(
                        'min-w-0 flex-1 truncate',
                        it.enabled ? 'text-slate-800' : 'text-slate-400',
                      )}
                      title={c.label}
                    >
                      {c.label}
                    </span>
                    <span className="hidden shrink-0 truncate text-xs text-slate-400 sm:inline">
                      {c.hint}
                    </span>
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                      aria-label="Subir"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                      disabled={i === items.length - 1}
                      onClick={() => move(i, i + 1)}
                      aria-label="Descer"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <Label
          hint={
            preview.isFetching ? (
              <Loader2 className="inline size-3.5 animate-spin" />
            ) : preview.data ? (
              `primeiras ${preview.data.rows.length} linha(s)${total != null ? ` de ${fmtInt(total)}` : ''}`
            ) : undefined
          }
        >
          Prévia
        </Label>
        {!chosen.length ? (
          <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            Marque ao menos uma coluna para exportar.
          </p>
        ) : preview.isError ? (
          <p className="text-sm text-red-600">{errorMessage(preview.error)}</p>
        ) : !preview.data ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="scroll-thin max-h-64 overflow-auto rounded-md border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-100 text-left text-slate-700">
                <tr>
                  {preview.data.headers.map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.data.rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50">
                    {r.map((v, j) => (
                      <td
                        key={j}
                        className="max-w-64 truncate whitespace-nowrap px-2 py-1 text-slate-700"
                        title={previewCell(v)}
                      >
                        {previewCell(v)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!preview.data.rows.length && (
                  <tr>
                    <td
                      colSpan={preview.data.headers.length}
                      className="px-2 py-4 text-center text-slate-500"
                    >
                      Nenhum registro para exportar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
