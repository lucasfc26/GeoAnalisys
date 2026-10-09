import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Database, Gauge, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { queryKeys, useCrsList, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { pointsService } from '@/services/points';
import { databaseService, sourcesService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import type { ColumnMeta, DataSource, SourceConfig, SourceTestResult } from '@/types';
import { fmtCoord, fmtDeg, fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { Badge, ErrorState, Skeleton } from '../ui/States';
import { toast } from '../ui/Toaster';

const EMPTY: SourceConfig = {
  name: '',
  schema: 'public',
  tableName: '',
  idColumn: '',
  xColumn: '',
  yColumn: '',
  coordinateSystem: 'EPSG:31984',
  proj4: null,
  labelColumn: null,
  categoryColumn: null,
  geometryColumn: null,
  searchColumns: [],
};

/** Sugestões automáticas de papéis das colunas (o usuário sempre confirma). */
function suggest(cols: ColumnMeta[]): Partial<SourceConfig> {
  const find = (re: RegExp, pred: (c: ColumnMeta) => boolean = () => true) =>
    cols.find((c) => re.test(c.name) && pred(c))?.name;
  const coordOk = (c: ColumnMeta) => c.isNumeric || c.kind === 'text';
  const id =
    cols.find((c) => c.isPrimaryKey)?.name ?? find(/^(id|idd|gid|fid|objectid|codigo|cod)$/i) ?? cols[0]?.name;
  const x = find(/(utm[\s_]*x|^x$|coord.*x|leste|easting)/i, coordOk);
  const y = find(/(utm[\s_]*y|^y$|coord.*y|norte|northing)/i, coordOk);
  return {
    idColumn: id ?? '',
    xColumn: x ?? '',
    yColumn: y ?? '',
    labelColumn: find(/^(nome|name|endereco|endereço|descricao|label)$/i) ?? null,
    categoryColumn: find(/^(tipo|status|categoria|tipo_.*|classe)$/i) ?? null,
    geometryColumn: cols.find((c) => c.kind === 'geometry')?.name ?? null,
  };
}

function ColumnSelect({
  id,
  label,
  hint,
  value,
  onChange,
  columns,
  optional,
  highlight,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  columns: ColumnMeta[];
  optional?: boolean;
  highlight?: (c: ColumnMeta) => boolean;
}) {
  return (
    <div>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{optional ? '— nenhuma —' : 'Selecione…'}</option>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {highlight?.(c) ? '● ' : ''}
            {c.name} ({c.formatType})
          </option>
        ))}
      </Select>
    </div>
  );
}

function TestResultView({ r }: { r: SourceTestResult }) {
  const previewCols = r.preview[0] ? Object.keys(r.preview[0].data).filter((k) => k !== 'geom').slice(0, 5) : [];
  return (
    <div className="space-y-3">
      <div className={clsx('flex items-start gap-2 rounded-lg p-3 text-sm', r.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>
        {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
        <div>
          <p className="font-medium">
            {fmtInt(r.validCoordinates)} de {fmtInt(r.total)} registros com coordenadas válidas em {r.crs.name}
          </p>
          {r.extent && (
            <p className="mt-0.5 text-xs">
              Extensão: lat {fmtDeg(r.extent.minLat)} a {fmtDeg(r.extent.maxLat)} · lng {fmtDeg(r.extent.minLng)} a{' '}
              {fmtDeg(r.extent.maxLng)}
            </p>
          )}
        </div>
      </div>
      {r.warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
        </p>
      ))}
      {r.preview.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">X</th>
                <th className="px-2 py-1.5 font-medium">Y</th>
                <th className="px-2 py-1.5 font-medium">Lat</th>
                <th className="px-2 py-1.5 font-medium">Lng</th>
                {previewCols.map((c) => (
                  <th key={c} className="px-2 py-1.5 font-medium whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.preview.map((p, i) => (
                <tr key={i}>
                  <td className="px-2 py-1 font-mono">{fmtCoord(p.x)}</td>
                  <td className="px-2 py-1 font-mono">{fmtCoord(p.y)}</td>
                  <td className={clsx('px-2 py-1 font-mono', p.lat === null && 'text-red-500')}>{fmtDeg(p.lat)}</td>
                  <td className={clsx('px-2 py-1 font-mono', p.lng === null && 'text-red-500')}>{fmtDeg(p.lng)}</td>
                  {previewCols.map((c) => (
                    <td key={c} className="max-w-40 truncate px-2 py-1">
                      {String(p.data[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SourceForm({ editing, onDone }: { editing: DataSource | null; onDone: () => void }) {
  const qc = useQueryClient();
  const setSource = useAppStore((s) => s.setSource);
  const focusMap = useAppStore((s) => s.focusMap);
  const [cfg, setCfg] = useState<SourceConfig>(() =>
    editing
      ? (Object.fromEntries(Object.keys(EMPTY).map((k) => [k, editing[k as keyof SourceConfig]])) as unknown as SourceConfig)
      : EMPTY,
  );
  const [test, setTest] = useState<SourceTestResult | null>(null);
  const [crsSearch, setCrsSearch] = useState('');
  const set = (patch: Partial<SourceConfig>) => {
    setCfg((c) => ({ ...c, ...patch }));
    setTest(null);
  };

  const info = useQuery({ queryKey: ['db-info'], queryFn: databaseService.info });
  const databases = useQuery({ queryKey: ['db-list'], queryFn: databaseService.databases });
  const schemas = useQuery({ queryKey: ['db-schemas'], queryFn: databaseService.schemas });
  const tables = useQuery({
    queryKey: ['db-tables', cfg.schema],
    queryFn: () => databaseService.tables(cfg.schema),
    enabled: !!cfg.schema,
  });
  const columns = useQuery({
    queryKey: ['db-columns', cfg.schema, cfg.tableName],
    queryFn: () => databaseService.columns(cfg.schema, cfg.tableName),
    enabled: !!cfg.tableName,
  });
  const crsList = useCrsList();

  // Ao trocar de tabela (não na edição inicial), aplica as sugestões.
  const [autoFor, setAutoFor] = useState(editing ? `${editing.schema}.${editing.tableName}` : '');
  useEffect(() => {
    const key = `${cfg.schema}.${cfg.tableName}`;
    if (!columns.data || autoFor === key) return;
    setAutoFor(key);
    setCfg((c) => ({ ...c, ...suggest(columns.data), name: c.name || cfg.tableName, searchColumns: [] }));
  }, [columns.data, cfg.schema, cfg.tableName, autoFor]);

  const cols = columns.data ?? [];
  const coordCols = cols.filter((c) => c.isNumeric || c.kind === 'text');
  const plainCols = cols.filter((c) => c.kind !== 'geometry');
  const filteredCrs = useMemo(() => {
    const q = crsSearch.trim().toLowerCase();
    return (crsList.data ?? []).filter((c) => !q || `${c.code} ${c.name}`.toLowerCase().includes(q));
  }, [crsList.data, crsSearch]);
  const crsGroups = useMemo(() => {
    const m = new Map<string, typeof filteredCrs>();
    for (const c of filteredCrs) m.set(c.datum, [...(m.get(c.datum) ?? []), c]);
    return [...m.entries()];
  }, [filteredCrs]);
  const selectedCrs = crsList.data?.find((c) => c.code === cfg.coordinateSystem);

  const complete = cfg.name && cfg.tableName && cfg.idColumn && cfg.xColumn && cfg.yColumn && cfg.coordinateSystem;

  const runTest = useMutation({
    mutationFn: () => sourcesService.test(cfg),
    onSuccess: setTest,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const save = useMutation({
    mutationFn: () => (editing ? sourcesService.update(editing.id, cfg) : sourcesService.create(cfg)),
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: queryKeys.sources });
      qc.invalidateQueries({ queryKey: queryKeys.schema(saved.id) });
      qc.invalidateQueries({ queryKey: queryKeys.points(saved.id) });
      setSource(saved.id);
      try {
        const ext = await pointsService.extent(saved.id, []);
        if (ext.bounds) focusMap({ bounds: ext.bounds });
      } catch {
        /* o mapa continua utilizável */
      }
      toast.success(`Fonte "${saved.name}" carregada.`);
      useAppStore.getState().closeDialog('source');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="src-db" hint={info.data?.postgis ? `PostGIS ${info.data.postgis}` : undefined}>
            Database
          </Label>
          <Select id="src-db" value={info.data?.database ?? ''} disabled>
            {(databases.data ?? [info.data?.database ?? '']).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] text-slate-400">Definido em DATABASE_URL (backend/.env)</p>
        </div>
        <div>
          <Label htmlFor="src-schema">Schema</Label>
          <Select id="src-schema" value={cfg.schema} onChange={(e) => set({ schema: e.target.value, tableName: '' })}>
            {(schemas.data ?? [cfg.schema]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="src-table">Tabela</Label>
          <Select id="src-table" value={cfg.tableName} onChange={(e) => set({ tableName: e.target.value })}>
            <option value="">Selecione…</option>
            {tables.data?.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} (~{fmtInt(t.estimatedRows)}){t.type !== 'table' ? ` [${t.type}]` : ''}
              </option>
            ))}
          </Select>
        </div>
      </section>

      {cfg.tableName && columns.isLoading && <Skeleton className="h-32" />}
      {columns.isError && <ErrorState compact error={columns.error} onRetry={() => columns.refetch()} />}

      {cols.length > 0 && (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="src-name">Nome da fonte</Label>
              <Input id="src-name" value={cfg.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <ColumnSelect
              id="src-x"
              label="Coordenada X (UTM Leste)"
              hint="● = numérica"
              value={cfg.xColumn}
              onChange={(v) => set({ xColumn: v ?? '' })}
              columns={coordCols}
              highlight={(c) => c.isNumeric}
            />
            <ColumnSelect
              id="src-y"
              label="Coordenada Y (UTM Norte)"
              hint="● = numérica"
              value={cfg.yColumn}
              onChange={(v) => set({ yColumn: v ?? '' })}
              columns={coordCols}
              highlight={(c) => c.isNumeric}
            />
            <ColumnSelect
              id="src-id"
              label="Coluna ID"
              hint="● = chave primária"
              value={cfg.idColumn}
              onChange={(v) => set({ idColumn: v ?? '' })}
              columns={plainCols}
              highlight={(c) => c.isPrimaryKey}
            />
            <ColumnSelect
              id="src-label"
              label="Rótulo (tooltip)"
              value={cfg.labelColumn}
              onChange={(v) => set({ labelColumn: v })}
              columns={plainCols}
              optional
            />
            <ColumnSelect
              id="src-cat"
              label="Categoria (cor e resumo)"
              value={cfg.categoryColumn}
              onChange={(v) => set({ categoryColumn: v })}
              columns={plainCols}
              optional
            />
            <ColumnSelect
              id="src-geom"
              label="Geometria PostGIS (sincronizar)"
              value={cfg.geometryColumn}
              onChange={(v) => set({ geometryColumn: v })}
              columns={cols.filter((c) => c.kind === 'geometry')}
              optional
            />
          </section>

          <section>
            <Label>Colunas de busca (ID e rótulo já incluídos)</Label>
            <div className="scroll-thin flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-slate-200 p-2">
              {plainCols.map((c) => {
                const on = cfg.searchColumns.includes(c.name);
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() =>
                      set({
                        searchColumns: on ? cfg.searchColumns.filter((s) => s !== c.name) : [...cfg.searchColumns, c.name].slice(0, 20),
                      })
                    }
                    className={clsx(
                      'rounded-full border px-2 py-0.5 text-xs',
                      on ? 'border-accent-500 bg-accent-50 text-accent-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <div>
                <Label htmlFor="crs-search">Sistema de referência</Label>
                <Input id="crs-search" placeholder="Buscar: 31984, SIRGAS 24S…" value={crsSearch} onChange={(e) => setCrsSearch(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="crs-select" hint={selectedCrs?.kind === 'utm' ? `Zona ${selectedCrs.zone}${selectedCrs.hemisphere}` : undefined}>
                  EPSG
                </Label>
                <Select id="crs-select" value={cfg.coordinateSystem} onChange={(e) => set({ coordinateSystem: e.target.value })}>
                  {crsGroups.map(([datum, items]) => (
                    <optgroup key={datum} label={datum}>
                      {items.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <option value="CUSTOM">Personalizado (proj4)</option>
                </Select>
              </div>
            </div>
            {cfg.coordinateSystem === 'CUSTOM' && (
              <div className="mt-3">
                <Label htmlFor="crs-proj4">Definição proj4</Label>
                <Input
                  id="crs-proj4"
                  className="font-mono text-xs"
                  placeholder="+proj=utm +zone=23 +south +ellps=GRS80 +units=m +no_defs"
                  value={cfg.proj4 ?? ''}
                  onChange={(e) => set({ proj4: e.target.value })}
                />
              </div>
            )}
            <p className="mt-2 text-xs text-slate-500">
              A zona UTM e o hemisfério não são deduzidos dos valores: escolha o sistema correto e confira o resultado com
              “Testar”.
              {selectedCrs?.kind === 'utm' && selectedCrs.zone && (
                <> Zona {selectedCrs.zone} cobre longitudes de {-183 + 6 * selectedCrs.zone - 3}° a {-183 + 6 * selectedCrs.zone + 3}°.</>
              )}
            </p>
          </section>

          {test && <TestResultView r={test} />}
        </>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
        <Button onClick={onDone}>Cancelar</Button>
        <Button onClick={() => runTest.mutate()} loading={runTest.isPending} disabled={!complete}>
          Testar
        </Button>
        <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!complete}>
          {editing ? 'Salvar e recarregar mapa' : 'Salvar e carregar mapa'}
        </Button>
      </div>
    </div>
  );
}

function SourceList({ onEdit }: { onEdit: (s: DataSource | null) => void }) {
  const sources = useSources();
  const sourceId = useAppStore((s) => s.sourceId);
  const setSource = useAppStore((s) => s.setSource);
  const focusMap = useAppStore((s) => s.focusMap);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => sourcesService.remove(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.sources });
      if (id === sourceId) setSource(null);
      setConfirm(null);
      toast.success('Configuração removida (a tabela não foi alterada).');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const indexes = useMutation({
    mutationFn: (id: string) => sourcesService.createIndexes(id),
    onSuccess: (r) =>
      toast.success(r.created.length ? `Índices criados: ${r.created.join(', ')}` : 'Os índices já existem.'),
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (sources.isLoading) return <Skeleton className="h-20" />;
  if (sources.isError) return <ErrorState compact error={sources.error} onRetry={() => sources.refetch()} />;

  return (
    <div className="space-y-2">
      {sources.data?.map((s) => (
        <div
          key={s.id}
          className={clsx(
            'flex flex-wrap items-center gap-3 rounded-lg border p-3',
            s.id === sourceId ? 'border-accent-500 bg-accent-50/50' : 'border-slate-200',
          )}
        >
          <Database className="size-5 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-800">
              {s.name} {s.id === sourceId && <Badge tone="accent">ativa</Badge>}
            </p>
            <p className="truncate text-xs text-slate-500">
              {s.schema}.{s.tableName} · X: {s.xColumn} · Y: {s.yColumn} · {s.coordinateSystem}
            </p>
          </div>
          <div className="flex gap-1">
            {s.id !== sourceId && (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  setSource(s.id);
                  closeDialog('source');
                  try {
                    const ext = await pointsService.extent(s.id, []);
                    if (ext.bounds) focusMap({ bounds: ext.bounds });
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                Carregar
              </Button>
            )}
            <Button size="sm" variant="ghost" title="Criar índices em X/Y e ID" onClick={() => indexes.mutate(s.id)} loading={indexes.isPending && indexes.variables === s.id}>
              <Gauge className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" title="Editar" onClick={() => onEdit(s)}>
              <Pencil className="size-4" />
            </Button>
            {confirm === s.id ? (
              <Button size="sm" variant="danger" onClick={() => remove.mutate(s.id)} loading={remove.isPending}>
                Confirmar
              </Button>
            ) : (
              <Button size="sm" variant="ghost" title="Remover configuração" onClick={() => setConfirm(s.id)}>
                <Trash2 className="size-4 text-red-500" />
              </Button>
            )}
          </div>
        </div>
      ))}
      {!sources.data?.length && <p className="text-sm text-slate-500">Nenhuma fonte configurada ainda.</p>}
      <Button icon={<Plus className="size-4" />} onClick={() => onEdit(null)}>
        Nova fonte de dados
      </Button>
    </div>
  );
}

export default function SourceConfigDialog() {
  const open = useAppStore((s) => s.dialogs.source);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const sources = useSources();
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'form'; editing: DataSource | null }>({ kind: 'list' });

  useEffect(() => {
    if (open) setMode(sources.data?.length ? { kind: 'list' } : { kind: 'form', editing: null });
  }, [open, sources.data?.length]);

  if (!open) return null;
  return (
    <Dialog
      open
      size="lg"
      title={mode.kind === 'list' ? 'Fontes de dados' : mode.editing ? `Editar fonte: ${mode.editing.name}` : 'Nova fonte de dados'}
      description="Tabela do banco local com coordenadas UTM e o sistema de referência que as interpreta."
      onClose={() => closeDialog('source')}
    >
      {mode.kind === 'list' ? (
        <SourceList onEdit={(s) => setMode({ kind: 'form', editing: s })} />
      ) : (
        <SourceForm
          key={mode.editing?.id ?? 'new'}
          editing={mode.editing}
          onDone={() => (sources.data?.length ? setMode({ kind: 'list' }) : closeDialog('source'))}
        />
      )}
    </Dialog>
  );
}
