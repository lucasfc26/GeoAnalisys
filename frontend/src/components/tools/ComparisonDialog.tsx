import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Plus,
  RotateCcw,
  Table2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { queryKeys, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import {
  comparisonService,
  type ComparisonRequest,
  type ComparisonResult,
  type ComparisonSection,
} from '@/services/comparison';
import { databaseService, sourcesService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import type { FilterDef, FilterOp } from '@/types';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

const SETTINGS_KEY = 'geoanalisys-comparison';
const MAX_LAYERS = 10;
const MAX_BLOCKS = 30;

type CondOp = Extract<FilterOp, 'eq' | 'neq' | 'contains' | 'isNull' | 'notNull'>;

const OPS: { value: CondOp; label: string }[] = [
  { value: 'eq', label: 'igual a' },
  { value: 'neq', label: 'diferente de (ou vazio)' },
  { value: 'contains', label: 'contém' },
  { value: 'isNull', label: 'está vazio' },
  { value: 'notNull', label: 'está preenchido' },
];
const NO_VALUE: CondOp[] = ['isNull', 'notNull'];

interface Condition {
  column: string;
  op: CondOp;
  value: string;
}

interface Block {
  id: string;
  title: string;
  conditions: Condition[];
  groupBy: string[];
  /** '' = conta registros */
  distinctColumn: string;
  useLookup: boolean;
}

interface Settings {
  layers: { sourceId: string; label: string }[];
  blocks: Block[];
  lookupEnabled: boolean;
  lookupSchema: string;
  lookupTable: string;
  lookupKeys: { column: string; lookupColumn: string }[];
  lookupName: string;
  lookupFactor: string;
  ignoreCase: boolean;
  useFilters: boolean;
}

const newId = () => Math.random().toString(36).slice(2, 10);

const find = (cols: string[], re: RegExp, fallback: string) =>
  cols.find((c) => re.test(c)) ?? fallback;

/** Estimados, Relés e Medidos (mesma lógica do script do censo) com os nomes de coluna das camadas. */
function censoBlocks(cols: string[]): Block[] {
  const medicao = find(cols, /^medi[cç][aã]o$/i, 'medicao');
  const tipo = find(cols, /^tipo_?l[aâ]mpada$/i, 'tipo_lampada');
  const potencia = find(cols, /^pot[eê]ncia$/i, 'potencia');
  const rele = find(cols, /rel[eé].*foto/i, 'relé_fotoelétrico');
  const circuito = find(cols, /^circuito[ _]exclusivo$/i, 'circuito exclusivo');
  const nao: Condition = { column: medicao, op: 'eq', value: 'Não' };
  return [
    {
      id: newId(),
      title: 'Estimados',
      conditions: [nao],
      groupBy: [tipo, potencia],
      distinctColumn: '',
      useLookup: true,
    },
    {
      id: newId(),
      title: 'Relé (Sim)',
      conditions: [nao, { column: rele, op: 'eq', value: 'Sim' }],
      groupBy: [],
      distinctColumn: circuito,
      useLookup: false,
    },
    {
      id: newId(),
      title: 'Relé (Não)',
      conditions: [nao, { column: rele, op: 'neq', value: 'Sim' }],
      groupBy: [],
      distinctColumn: '',
      useLookup: false,
    },
    {
      id: newId(),
      title: 'Medidos',
      conditions: [{ column: medicao, op: 'eq', value: 'Sim' }],
      groupBy: [tipo, potencia],
      distinctColumn: '',
      useLookup: true,
    },
  ];
}

const DEFAULTS: Settings = {
  layers: [],
  blocks: censoBlocks([]),
  lookupEnabled: true,
  lookupSchema: 'public',
  lookupTable: 'mlampadas',
  lookupKeys: [
    { column: 'tipo_lampada', lookupColumn: 'tipo' },
    { column: 'potencia', lookupColumn: 'potencia' },
  ],
  lookupName: 'nome',
  lookupFactor: 'consumo',
  ignoreCase: true,
  useFilters: false,
};

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const fmtNum = (n: number | null) => (n === null ? '—' : nf.format(n));
const signed = (n: number) => (n > 0 ? `+${fmtInt(n)}` : fmtInt(n));

function ColumnSelect({
  id,
  value,
  options,
  onChange,
  empty,
  className,
}: {
  id?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  /** Texto da opção vazia (sem ela, a coluna é obrigatória) */
  empty?: string;
  className?: string;
}) {
  const missing = value !== '' && !options.includes(value);
  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(missing && 'border-amber-400 text-amber-700', className)}
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {empty === undefined && value === '' && <option value="">Escolha…</option>}
      {missing && <option value={value}>{value} (não existe)</option>}
      {options.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </Select>
  );
}

function BlockEditor({
  block,
  index,
  count,
  columns,
  lookupOn,
  onChange,
  onMove,
  onRemove,
}: {
  block: Block;
  index: number;
  count: number;
  columns: string[];
  lookupOn: boolean;
  onChange: (p: Partial<Block>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const available = columns.filter((c) => !block.groupBy.includes(c));
  const setCond = (k: number, p: Partial<Condition>) =>
    onChange({ conditions: block.conditions.map((c, i) => (i === k ? { ...c, ...p } : c)) });
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Título do bloco"
            value={block.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Título (ex.: Estimados)"
            className="font-medium"
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Subir bloco"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          icon={<ArrowUp className="size-3.5" />}
        />
        <Button
          size="sm"
          variant="ghost"
          aria-label="Descer bloco"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          icon={<ArrowDown className="size-3.5" />}
        />
        <Button
          size="sm"
          variant="ghost"
          aria-label="Remover bloco"
          disabled={count === 1}
          onClick={onRemove}
          icon={<X className="size-3.5" />}
        />
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">Condições (todas)</p>
        <div className="space-y-1.5">
          {block.conditions.map((c, k) => (
            <div
              key={k}
              className="grid grid-cols-[minmax(0,1fr)_12rem_minmax(0,1fr)_auto] items-center gap-1.5"
            >
              <ColumnSelect
                value={c.column}
                options={columns}
                onChange={(v) => setCond(k, { column: v })}
              />
              <Select
                aria-label="Operador"
                value={c.op}
                onChange={(e) => setCond(k, { op: e.target.value as CondOp })}
              >
                {OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Input
                aria-label="Valor"
                value={c.value}
                disabled={NO_VALUE.includes(c.op)}
                onChange={(e) => setCond(k, { value: e.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remover condição"
                onClick={() => onChange({ conditions: block.conditions.filter((_, i) => i !== k) })}
                icon={<X className="size-3.5" />}
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            disabled={!columns.length}
            onClick={() =>
              onChange({
                conditions: [...block.conditions, { column: columns[0], op: 'eq', value: '' }],
              })
            }
          >
            Condição
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Agrupar por (em ordem)</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {block.groupBy.map((g) => (
              <span
                key={g}
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                  columns.includes(g)
                    ? 'bg-accent-50 text-accent-700'
                    : 'bg-amber-50 text-amber-700',
                )}
              >
                {g}
                <button
                  type="button"
                  aria-label={`Remover ${g}`}
                  onClick={() => onChange({ groupBy: block.groupBy.filter((x) => x !== g) })}
                  className="rounded-full hover:bg-black/10"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <div className="w-40">
              <Select
                aria-label="Adicionar coluna de agrupamento"
                value=""
                onChange={(e) =>
                  e.target.value && onChange({ groupBy: [...block.groupBy, e.target.value] })
                }
                disabled={!available.length || block.groupBy.length >= 10}
              >
                <option value="">+ coluna</option>
                {available.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {!block.groupBy.length && (
            <p className="mt-1 text-xs text-slate-500">Sem agrupamento: uma linha com o total.</p>
          )}
        </div>
        <div>
          <Label htmlFor={`cmp-count-${block.id}`}>Contar</Label>
          <ColumnSelect
            id={`cmp-count-${block.id}`}
            value={block.distinctColumn}
            options={columns}
            empty="Registros (pontos)"
            onChange={(v) => onChange({ distinctColumn: v })}
          />
          {block.distinctColumn && (
            <p className="mt-1 text-xs text-slate-500">
              Valores distintos de {block.distinctColumn} (vazios não contam).
            </p>
          )}
        </div>
      </div>
      {lookupOn && (
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={block.useLookup}
            onChange={(e) => onChange({ useLookup: e.target.checked })}
            className="accent-accent-600"
          />
          Usar a tabela de apoio (descrição e fator × diferença)
        </label>
      )}
    </div>
  );
}

function SectionTable({
  section,
  layers,
  factorName,
}: {
  section: ComparisonSection;
  layers: string[];
  factorName: string | null;
}) {
  const withFactor = section.lookup && factorName !== null;
  const t = section.totals;
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-slate-800">
        {section.title}
        {section.unmatched > 0 && (
          <span className="ml-2 text-xs font-normal text-amber-700">
            {fmtInt(section.unmatched)} sem correspondência na tabela de apoio
          </span>
        )}
      </p>
      <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1 font-medium">Descrição</th>
              {section.groupBy.map((g) => (
                <th key={g} className="px-2 py-1 font-medium">
                  {g}
                </th>
              ))}
              {layers.map((l, i) => (
                <th key={i} className="px-2 py-1 text-right font-medium">
                  {l}
                </th>
              ))}
              <th className="px-2 py-1 text-right font-medium">Diferença</th>
              {withFactor && (
                <>
                  <th className="px-2 py-1 text-right font-medium">{factorName}</th>
                  <th className="px-2 py-1 text-right font-medium">{factorName} × dif.</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {section.rows.map((r, k) => (
              <tr key={k} className={clsx(r.matched === false && 'bg-amber-50')}>
                <td className="px-2 py-1">{r.label}</td>
                {r.values.map((v, j) => (
                  <td key={j} className="px-2 py-1 text-slate-600">
                    {v ?? <span className="text-slate-400">(vazio)</span>}
                  </td>
                ))}
                {r.counts.map((n, i) => (
                  <td key={i} className="px-2 py-1 text-right tabular-nums">
                    {fmtInt(n)}
                  </td>
                ))}
                <td
                  className={clsx(
                    'px-2 py-1 text-right tabular-nums',
                    r.diff > 0
                      ? 'text-emerald-700'
                      : r.diff < 0
                        ? 'text-red-700'
                        : 'text-slate-400',
                  )}
                >
                  {signed(r.diff)}
                </td>
                {withFactor && (
                  <>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.factor)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.result)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          {section.rows.length > 1 && (
            <tfoot className="sticky bottom-0 bg-slate-50 font-semibold text-slate-800">
              <tr>
                <td className="px-2 py-1" colSpan={1 + section.groupBy.length}>
                  Total
                </td>
                {t.counts.map((n, i) => (
                  <td key={i} className="px-2 py-1 text-right tabular-nums">
                    {fmtInt(n)}
                  </td>
                ))}
                <td className="px-2 py-1 text-right tabular-nums">{signed(t.diff)}</td>
                {withFactor && (
                  <>
                    <td />
                    <td className="px-2 py-1 text-right tabular-nums">{fmtNum(t.result)}</td>
                  </>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/**
 * Ferramentas › Lista comparativa: conta os pontos de 2 ou mais camadas por grupos de atributos
 * (ex.: tipo_lampada e potencia), em blocos com condições (ex.: medicao = Não), lado a lado com a
 * diferença; opcionalmente com descrição e fator (ex.: consumo) de uma tabela de apoio (ex.: mlampadas).
 */
export default function ComparisonDialog() {
  const closeDialog = useAppStore((st) => st.closeDialog);
  const sources = useSources();
  const list = useMemo(() => sources.data ?? [], [sources.data]);

  const [s, setS] = useState<Settings>(() => ({ ...DEFAULTS, ...loadSettings() }));
  const patch = (p: Partial<Settings>) => setS((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* só nesta sessão */
    }
  }, [s]);

  const layers = useMemo(() => {
    const valid = s.layers.filter((l) => list.some((x) => x.id === l.sourceId));
    if (valid.length >= 2 || list.length < 2) return valid;
    const text = (x: (typeof list)[number]) => `${x.name} ${x.tableName}`;
    const before = list.find((x) => /anterior/i.test(text(x))) ?? list[0];
    const after =
      list.find((x) => x.id !== before.id && /atual/i.test(text(x))) ??
      list.find((x) => x.id !== before.id)!;
    return [
      { sourceId: before.id, label: '' },
      { sourceId: after.id, label: '' },
    ];
  }, [s.layers, list]);
  const setLayers = (next: Settings['layers']) => patch({ layers: next });

  const schemas = useQueries({
    queries: layers.map((l) => ({
      queryKey: queryKeys.schema(l.sourceId),
      queryFn: () => sourcesService.schema(l.sourceId),
      staleTime: 60_000,
    })),
  });
  const schemasReady = schemas.length > 0 && schemas.every((q) => q.data);
  /** Colunas que existem em todas as camadas */
  const columns: string[] = [];
  if (schemasReady) {
    const sets = schemas.map(
      (q) => new Set(q.data!.columns.filter((c) => c.kind !== 'geometry').map((c) => c.name)),
    );
    columns.push(...[...sets[0]].filter((c) => sets.every((set) => set.has(c))));
  }

  const dbSchemas = useQuery({ queryKey: ['db-schemas'], queryFn: databaseService.schemas });
  const dbTables = useQuery({
    queryKey: ['db-tables', s.lookupSchema],
    queryFn: () => databaseService.tables(s.lookupSchema),
    enabled: s.lookupEnabled && !!s.lookupSchema,
  });
  const tableExists = !!dbTables.data?.some((t) => t.name === s.lookupTable);
  const dbColumns = useQuery({
    queryKey: ['db-columns', s.lookupSchema, s.lookupTable],
    queryFn: () => databaseService.columns(s.lookupSchema, s.lookupTable),
    enabled: s.lookupEnabled && tableExists,
  });
  const lookupCols = useMemo(
    () => (dbColumns.data ?? []).filter((c) => c.kind !== 'geometry').map((c) => c.name),
    [dbColumns.data],
  );
  const lookupKeys = s.lookupKeys.filter((k) => k.column && k.lookupColumn);
  const lookupOk = s.lookupEnabled && tableExists && lookupKeys.length > 0;

  const setBlock = (k: number, p: Partial<Block>) =>
    patch({ blocks: s.blocks.map((b, i) => (i === k ? { ...b, ...p } : b)) });
  const moveBlock = (k: number, delta: number) => {
    const next = [...s.blocks];
    const [b] = next.splice(k, 1);
    next.splice(k + delta, 0, b);
    patch({ blocks: next });
  };

  /** Colunas usadas pelos blocos que não existem em todas as camadas */
  const missing = schemasReady
    ? [
        ...new Set(
          s.blocks
            .flatMap((b) => [
              ...b.groupBy,
              ...b.conditions.map((c) => c.column),
              ...(b.distinctColumn ? [b.distinctColumn] : []),
              ...(lookupOk && b.useLookup ? lookupKeys.map((k) => k.column) : []),
            ])
            .filter((c) => c && !columns.includes(c)),
        ),
      ]
    : [];
  const lookupMissing =
    lookupOk && s.blocks.some((b) => b.useLookup)
      ? s.blocks
          .filter((b) => b.useLookup)
          .flatMap((b) =>
            lookupKeys
              .filter((k) => !b.groupBy.includes(k.column))
              .map((k) => `${b.title}: ${k.column}`),
          )
      : [];

  const filtersOf = (sourceId: string): FilterDef[] => {
    if (!s.useFilters) return [];
    const st = useAppStore.getState();
    return sourceId === st.sourceId ? st.filters : (st.layerFilters[sourceId] ?? []);
  };
  const toFilter = (c: Condition): FilterDef =>
    NO_VALUE.includes(c.op)
      ? { column: c.column, op: c.op }
      : { column: c.column, op: c.op, value: c.value, caseSensitive: !s.ignoreCase };

  const blocksOk = s.blocks.length > 0 && s.blocks.every((b) => b.title.trim());
  const request: ComparisonRequest | null =
    layers.length >= 2 && schemasReady && blocksOk && !missing.length && !lookupMissing.length
      ? {
          layers: layers.map((l) => ({
            sourceId: l.sourceId,
            label: l.label.trim() || null,
            filters: filtersOf(l.sourceId),
          })),
          blocks: s.blocks.map((b) => ({
            title: b.title.trim(),
            conditions: b.conditions.filter((c) => c.column).map(toFilter),
            groupBy: b.groupBy,
            distinctColumn: b.distinctColumn || null,
            useLookup: lookupOk && b.useLookup,
          })),
          lookup: lookupOk
            ? {
                schema: s.lookupSchema,
                table: s.lookupTable,
                keys: lookupKeys,
                nameColumn: s.lookupName || null,
                factorColumn: s.lookupFactor || null,
              }
            : null,
          ignoreCase: s.ignoreCase,
        }
      : null;

  const [result, setResult] = useState<{
    request: ComparisonRequest;
    data: ComparisonResult;
  } | null>(null);
  const run = useMutation({
    mutationFn: (req: ComparisonRequest) => comparisonService.preview(req),
    onSuccess: (data, req) => setResult({ request: req, data }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const download = useMutation({
    mutationFn: (format: 'xlsx' | 'csv') => comparisonService.download(result!.request, format),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const close = () => closeDialog('comparison');
  const stale = !!result && !!request && JSON.stringify(result.request) !== JSON.stringify(request);
  const summary = result?.data.summary;

  return (
    <Dialog
      open
      size="xl"
      title="Lista comparativa"
      description="Conta os pontos de 2 ou mais camadas agrupados por atributos (ex.: tipo_lampada e potencia), em blocos com condições (ex.: medicao = Não), e compara as camadas lado a lado."
      onClose={close}
      footer={
        <>
          <Button className="mr-auto" onClick={close}>
            Fechar
          </Button>
          <Button
            variant="primary"
            icon={<ListChecks className="size-4" />}
            loading={run.isPending}
            disabled={!request}
            onClick={() => request && run.mutate(request)}
          >
            Gerar lista
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2">
          <p className="text-xs font-medium text-slate-600">
            Camadas{' '}
            <span className="font-normal text-slate-400">(diferença = última − primeira)</span>
          </p>
          {layers.map((l, k) => (
            <div
              key={k}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)_14rem_auto_auto] items-center gap-1.5"
            >
              <span className="text-right text-xs text-slate-400">{k + 1}.</span>
              <Select
                aria-label={`Camada ${k + 1}`}
                value={l.sourceId}
                onChange={(e) =>
                  setLayers(
                    layers.map((x, i) => (i === k ? { ...x, sourceId: e.target.value } : x)),
                  )
                }
              >
                {list.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`Nome na lista da camada ${k + 1}`}
                placeholder="Nome na lista (opcional)"
                value={l.label}
                onChange={(e) =>
                  setLayers(layers.map((x, i) => (i === k ? { ...x, label: e.target.value } : x)))
                }
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Subir camada"
                disabled={k === 0}
                onClick={() => {
                  const next = [...layers];
                  [next[k - 1], next[k]] = [next[k], next[k - 1]];
                  setLayers(next);
                }}
                icon={<ArrowUp className="size-3.5" />}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remover camada"
                disabled={layers.length <= 2}
                onClick={() => setLayers(layers.filter((_, i) => i !== k))}
                icon={<X className="size-3.5" />}
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              disabled={!list.length || layers.length >= MAX_LAYERS}
              onClick={() => setLayers([...layers, { sourceId: list[0].id, label: '' }])}
            >
              Camada
            </Button>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={s.useFilters}
                onChange={(e) => patch({ useFilters: e.target.checked })}
                className="accent-accent-600"
              />
              Aplicar os filtros salvos de cada camada
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={s.ignoreCase}
                onChange={(e) => patch({ ignoreCase: e.target.checked })}
                className="accent-accent-600"
              />
              Ignorar maiúsculas e acentos ao juntar os grupos (VS = vs, 150 = 150.0)
            </label>
          </div>
        </section>

        <section className="space-y-2 rounded-md border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={s.lookupEnabled}
              onChange={(e) => patch({ lookupEnabled: e.target.checked })}
              className="accent-accent-600"
            />
            Tabela de apoio
            <span className="text-xs font-normal text-slate-500">
              descrição e fator por grupo (ex.: mlampadas: nome e consumo)
            </span>
          </label>
          {s.lookupEnabled && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <Label htmlFor="cmp-lk-schema">Schema</Label>
                  <ColumnSelect
                    id="cmp-lk-schema"
                    value={s.lookupSchema}
                    options={dbSchemas.data ?? []}
                    onChange={(v) => patch({ lookupSchema: v })}
                  />
                </div>
                <div>
                  <Label htmlFor="cmp-lk-table">Tabela</Label>
                  <ColumnSelect
                    id="cmp-lk-table"
                    value={s.lookupTable}
                    options={(dbTables.data ?? []).map((t) => t.name)}
                    onChange={(v) => patch({ lookupTable: v })}
                  />
                </div>
                <div>
                  <Label htmlFor="cmp-lk-name">Descrição</Label>
                  <ColumnSelect
                    id="cmp-lk-name"
                    value={s.lookupName}
                    options={lookupCols}
                    empty="(nenhuma)"
                    onChange={(v) => patch({ lookupName: v })}
                  />
                </div>
                <div>
                  <Label htmlFor="cmp-lk-factor" hint="× diferença">
                    Fator
                  </Label>
                  <ColumnSelect
                    id="cmp-lk-factor"
                    value={s.lookupFactor}
                    options={lookupCols}
                    empty="(nenhum)"
                    onChange={(v) => patch({ lookupFactor: v })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-slate-600">
                  Chaves{' '}
                  <span className="font-normal text-slate-400">
                    (coluna das camadas = coluna da tabela)
                  </span>
                </p>
                {s.lookupKeys.map((key, k) => (
                  <div
                    key={k}
                    className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1.5"
                  >
                    <ColumnSelect
                      value={key.column}
                      options={columns}
                      onChange={(v) =>
                        patch({
                          lookupKeys: s.lookupKeys.map((x, i) =>
                            i === k ? { ...x, column: v } : x,
                          ),
                        })
                      }
                    />
                    <span className="text-slate-400">=</span>
                    <ColumnSelect
                      value={key.lookupColumn}
                      options={lookupCols}
                      onChange={(v) =>
                        patch({
                          lookupKeys: s.lookupKeys.map((x, i) =>
                            i === k ? { ...x, lookupColumn: v } : x,
                          ),
                        })
                      }
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Remover chave"
                      onClick={() => patch({ lookupKeys: s.lookupKeys.filter((_, i) => i !== k) })}
                      icon={<X className="size-3.5" />}
                    />
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus className="size-3.5" />}
                  disabled={s.lookupKeys.length >= 10}
                  onClick={() =>
                    patch({ lookupKeys: [...s.lookupKeys, { column: '', lookupColumn: '' }] })
                  }
                >
                  Chave
                </Button>
              </div>
              {dbTables.data && !tableExists && (
                <p className="text-xs text-amber-700">
                  Tabela {s.lookupSchema}.{s.lookupTable} não encontrada: escolha outra ou desmarque
                  a tabela de apoio.
                </p>
              )}
              {lookupMissing.length > 0 && (
                <p className="text-xs text-amber-700">
                  Para usar a tabela de apoio, o bloco precisa agrupar pelas colunas-chave (falta{' '}
                  {lookupMissing.join('; ')}).
                </p>
              )}
            </>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="mr-auto text-xs font-medium text-slate-600">
              Blocos{' '}
              <span className="font-normal text-slate-400">
                (cada bloco conta os pontos que atendem às condições, por grupo)
              </span>
            </p>
            <Button
              size="sm"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => patch({ blocks: censoBlocks(columns) })}
              title="Estimados, Relé (Sim), Relé (Não) e Medidos"
            >
              Modelo do censo
            </Button>
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              disabled={s.blocks.length >= MAX_BLOCKS}
              onClick={() =>
                patch({
                  blocks: [
                    ...s.blocks,
                    {
                      id: newId(),
                      title: `Bloco ${s.blocks.length + 1}`,
                      conditions: [],
                      groupBy: [],
                      distinctColumn: '',
                      useLookup: false,
                    },
                  ],
                })
              }
            >
              Bloco
            </Button>
          </div>
          {s.blocks.map((b, k) => (
            <BlockEditor
              key={b.id}
              block={b}
              index={k}
              count={s.blocks.length}
              columns={columns}
              lookupOn={s.lookupEnabled}
              onChange={(p) => setBlock(k, p)}
              onMove={(d) => moveBlock(k, d)}
              onRemove={() => patch({ blocks: s.blocks.filter((_, i) => i !== k) })}
            />
          ))}
          {missing.length > 0 && (
            <p className="text-xs text-amber-700">
              Coluna(s) que não existem em todas as camadas: {missing.join(', ')}.
            </p>
          )}
        </section>

        {result && summary && (
          <section className="space-y-3 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Table2 className="size-4 text-slate-500" />
              <span className="mr-auto text-xs text-slate-600">
                {fmtInt(summary.rows)} linha(s) em {result.data.sections.length} bloco(s)
                {summary.unmatched > 0 && (
                  <span className="text-amber-700">
                    {' '}
                    · {fmtInt(summary.unmatched)} sem correspondência em {summary.lookupName}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                icon={<FileSpreadsheet className="size-3.5" />}
                loading={download.isPending && download.variables === 'xlsx'}
                onClick={() => download.mutate('xlsx')}
              >
                Baixar XLSX
              </Button>
              <Button
                size="sm"
                icon={<FileText className="size-3.5" />}
                loading={download.isPending && download.variables === 'csv'}
                onClick={() => download.mutate('csv')}
              >
                Baixar CSV
              </Button>
            </div>
            {stale && (
              <p className="text-xs text-amber-700">
                Os parâmetros mudaram desde a última lista: clique em Gerar lista para atualizar.
              </p>
            )}
            {result.data.sections.map((sec, k) => (
              <SectionTable
                key={k}
                section={sec}
                layers={summary.layers}
                factorName={summary.factorName}
              />
            ))}
          </section>
        )}
      </div>
    </Dialog>
  );
}
