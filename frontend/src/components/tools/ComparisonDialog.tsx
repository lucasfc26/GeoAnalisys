import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  ListChecks,
  ListOrdered,
  Plus,
  RotateCcw,
  Sigma,
  Table2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { queryKeys, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import {
  NUMERIC_KINDS,
  columnTitle,
  compileColumns,
  defaultColumns,
  type Cell,
  type ComparisonColumn,
  type ComparisonColumnKind,
} from '@/lib/comparisonColumns';
import {
  comparisonService,
  type ComparisonRequest,
  type ComparisonResult,
  type ComparisonSection,
} from '@/services/comparison';
import { databaseService, sourcesService } from '@/services/sources';
import { useAppStore, type ListMode } from '@/stores/appStore';
import type { FilterDef, FilterOp } from '@/types';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { Menu, type MenuEntry } from '../ui/Menu';
import { toast } from '../ui/Toaster';
import { ToolTemplateBar } from './ToolTemplateBar';

const SETTINGS_KEY = 'geoanalisys-comparison';
const MAX_LAYERS = 10;
const MAX_BLOCKS = 30;
const MAX_COLUMNS = 60;

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

type OutColumn = ComparisonColumn & { id: string };

interface Settings {
  layers: { sourceId: string; label: string }[];
  blocks: Block[];
  lookupEnabled: boolean;
  lookupSchema: string;
  lookupTable: string;
  lookupKeys: { column: string; lookupColumn: string }[];
  lookupName: string;
  ignoreCase: boolean;
  useFilters: boolean;
  /** null = automáticas (descrição, grupos, quantidades, diferença e consumo × dif.) */
  columns: OutColumn[] | null;
}

const newId = () => Math.random().toString(36).slice(2, 10);

const find = (cols: string[], re: RegExp, fallback: string) =>
  cols.find((c) => re.test(c)) ?? fallback;

const KINDS: { value: ComparisonColumnKind; label: string }[] = [
  { value: 'label', label: 'Descrição' },
  { value: 'group', label: 'Coluna das camadas' },
  { value: 'count', label: 'Quantidade da camada' },
  { value: 'diff', label: 'Diferença (última − primeira)' },
  { value: 'lookup', label: 'Coluna da tabela de apoio' },
  { value: 'formula', label: 'Fórmula' },
];

/** Exemplo do censo: consumo (kWh/mês) do censo anterior e do atual, com as perdas da tabela de apoio. */
function consumoColumns(cols: string[], lookupCols: string[], layerCount: number): OutColumn[] {
  const potencia = find(cols, /^pot[eê]ncia$/i, 'potencia');
  const perda = find(lookupCols, /^perdas?$/i, 'perda');
  const last = Math.max(layerCount - 1, 1);
  const consumo = (q: string) =>
    `([${q}] * [${potencia}] + [${q}] * [Perdas]) * 11,483333333 * 30 / 1000`;
  const out: ComparisonColumn[] = [
    { kind: 'label', title: 'Descrição' },
    { kind: 'group', title: null, column: potencia },
    { kind: 'formula', title: 'Perdas', expression: `[${perda}] * [${potencia}]` },
    { kind: 'count', title: 'Quantidade Censo Anterior', layer: 0, sum: true },
    {
      kind: 'formula',
      title: 'Consumo Anterior',
      expression: consumo('Quantidade Censo Anterior'),
      sum: true,
      decimals: 2,
    },
    { kind: 'count', title: 'Quantidade Censo Atual', layer: last, sum: true },
    {
      kind: 'formula',
      title: 'Consumo Atual',
      expression: consumo('Quantidade Censo Atual'),
      sum: true,
      decimals: 2,
    },
    {
      kind: 'formula',
      title: 'Diferença de Lâmpadas',
      expression: '[Quantidade Censo Atual] - [Quantidade Censo Anterior]',
      sum: true,
      decimals: 0,
    },
    {
      kind: 'formula',
      title: 'Consumo Total',
      expression: '[Consumo Atual] - [Consumo Anterior]',
      sum: true,
      decimals: 2,
    },
  ];
  return out.map((c) => ({ ...c, id: newId() }));
}

/** Colunas automáticas: as padrão e, com a tabela de apoio, consumo e consumo × diferença. */
function autoColumns(groupBy: string[], layerCount: number, lookupCols: string[] | null) {
  const out: ComparisonColumn[] = defaultColumns(groupBy, layerCount);
  const factor = lookupCols?.find((c) => /^consumo$/i.test(c));
  if (factor) {
    out.push(
      { kind: 'lookup', title: null, column: factor },
      {
        kind: 'formula',
        title: `${factor} × dif.`,
        expression: `[${factor}] * [Diferença]`,
        sum: true,
      },
    );
  }
  return out.map((c): OutColumn => ({ ...c, id: newId() }));
}

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
  ignoreCase: true,
  useFilters: false,
  columns: null,
};

function loadSettings(): Partial<Settings> {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings> & {
      lookupFactor?: string;
    };
    delete saved.lookupFactor; // versões antigas: o fator agora é uma coluna
    return saved;
  } catch {
    return {};
  }
}

const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const fixed = new Map<number, Intl.NumberFormat>();
function fmtNum(n: number, decimals: number | null) {
  if (decimals === null) return nf.format(n);
  if (!fixed.has(decimals)) {
    fixed.set(
      decimals,
      new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    );
  }
  return fixed.get(decimals)!.format(n);
}
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
          Usar a tabela de apoio (descrição e colunas da tabela)
        </label>
      )}
    </div>
  );
}

function ColumnsEditor({
  items,
  layers,
  layerColumns,
  lookupCols,
  lookupOn,
  onChange,
}: {
  items: OutColumn[];
  /** Nomes das camadas, na ordem */
  layers: string[];
  layerColumns: string[];
  lookupCols: string[];
  lookupOn: boolean;
  onChange: (next: OutColumn[]) => void;
}) {
  const set = (k: number, p: Partial<OutColumn>) =>
    onChange(items.map((c, i) => (i === k ? { ...c, ...p } : c)));
  const move = (k: number, delta: number) => {
    const next = [...items];
    const [c] = next.splice(k, 1);
    next.splice(k + delta, 0, c);
    onChange(next);
  };
  const setKind = (k: number, kind: ComparisonColumnKind) =>
    set(k, {
      kind,
      column: kind === 'group' ? layerColumns[0] : kind === 'lookup' ? lookupCols[0] : null,
      layer: kind === 'count' ? 0 : null,
      expression: kind === 'formula' ? (items[k].expression ?? '') : null,
      sum: ['count', 'diff', 'formula'].includes(kind),
    });
  return (
    <div className="space-y-1.5">
      {items.map((c, k) => {
        const numeric = NUMERIC_KINDS.includes(c.kind);
        return (
          <div
            key={c.id}
            className={clsx(
              'grid grid-cols-[1.25rem_11rem_minmax(0,1fr)_minmax(0,1.6fr)_4.5rem_auto_auto_auto_auto_auto] items-center gap-1.5',
              c.hidden && 'opacity-60',
            )}
          >
            <span className="text-right text-xs text-slate-400">{k + 1}.</span>
            <Select
              aria-label={`Tipo da coluna ${k + 1}`}
              value={c.kind}
              onChange={(e) => setKind(k, e.target.value as ComparisonColumnKind)}
            >
              {KINDS.filter((o) => o.value !== 'lookup' || lookupOn || c.kind === 'lookup').map(
                (o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ),
              )}
            </Select>
            <Input
              aria-label={`Título da coluna ${k + 1}`}
              value={c.title ?? ''}
              placeholder={columnTitle({ ...c, title: null }, k, layers)}
              onChange={(e) => set(k, { title: e.target.value })}
            />
            <div className="min-w-0">
              {c.kind === 'group' && (
                <ColumnSelect
                  value={c.column ?? ''}
                  options={layerColumns}
                  onChange={(v) => set(k, { column: v })}
                />
              )}
              {c.kind === 'lookup' && (
                <ColumnSelect
                  value={c.column ?? ''}
                  options={lookupCols}
                  onChange={(v) => set(k, { column: v })}
                />
              )}
              {c.kind === 'count' && (
                <Select
                  aria-label={`Camada da coluna ${k + 1}`}
                  value={String(c.layer ?? 0)}
                  onChange={(e) => set(k, { layer: Number(e.target.value) })}
                >
                  {layers.map((l, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {l}
                    </option>
                  ))}
                  {(c.layer ?? 0) >= layers.length && (
                    <option value={c.layer ?? 0}>{(c.layer ?? 0) + 1}. (não existe)</option>
                  )}
                </Select>
              )}
              {c.kind === 'formula' && (
                <Input
                  aria-label={`Fórmula da coluna ${k + 1}`}
                  value={c.expression ?? ''}
                  placeholder="ex.: [Quantidade Censo Atual] * potencia"
                  onChange={(e) => set(k, { expression: e.target.value })}
                  className="font-mono text-xs"
                />
              )}
              {(c.kind === 'label' || c.kind === 'diff') && (
                <span className="px-1 text-xs text-slate-400">
                  {c.kind === 'label'
                    ? 'nome da tabela de apoio ou valores do grupo'
                    : `${layers[layers.length - 1] ?? ''} − ${layers[0] ?? ''}`}
                </span>
              )}
            </div>
            <Input
              aria-label={`Casas decimais da coluna ${k + 1}`}
              type="number"
              min={0}
              max={10}
              placeholder="casas"
              title="Casas decimais (vazio = automático)"
              disabled={!numeric}
              value={c.decimals ?? ''}
              onChange={(e) =>
                set(k, {
                  decimals:
                    e.target.value === ''
                      ? null
                      : Math.min(10, Math.max(0, Math.round(Number(e.target.value)))),
                })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Somar a coluna ${k + 1} no total`}
              aria-pressed={!!c.sum}
              title={c.sum ? 'Somada na linha de total' : 'Não somada na linha de total'}
              disabled={!numeric}
              onClick={() => set(k, { sum: !c.sum })}
              icon={
                <Sigma
                  className={clsx(
                    'size-3.5',
                    c.sum && numeric ? 'text-accent-600' : 'text-slate-300',
                  )}
                />
              }
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={c.hidden ? `Mostrar a coluna ${k + 1}` : `Ocultar a coluna ${k + 1}`}
              title={c.hidden ? 'Oculta (só para as fórmulas)' : 'Visível'}
              onClick={() => set(k, { hidden: !c.hidden })}
              icon={c.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Subir a coluna ${k + 1}`}
              disabled={k === 0}
              onClick={() => move(k, -1)}
              icon={<ArrowUp className="size-3.5" />}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Descer a coluna ${k + 1}`}
              disabled={k === items.length - 1}
              onClick={() => move(k, 1)}
              icon={<ArrowDown className="size-3.5" />}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remover a coluna ${k + 1}`}
              disabled={items.length === 1}
              onClick={() => onChange(items.filter((_, i) => i !== k))}
              icon={<X className="size-3.5" />}
            />
          </div>
        );
      })}
    </div>
  );
}

function CellView({
  value,
  kind,
  decimals,
}: {
  value: Cell;
  kind: ComparisonColumnKind;
  decimals: number | null;
}) {
  if (value === null) {
    return <span className="text-slate-400">{kind === 'group' ? '(vazio)' : '—'}</span>;
  }
  if (typeof value !== 'number') return <>{value}</>;
  if (kind === 'count') return <>{fmtInt(value)}</>;
  if (kind === 'diff') return <>{signed(value)}</>;
  return <>{fmtNum(value, decimals)}</>;
}

function SectionTable({
  section,
  columns,
}: {
  section: ComparisonSection;
  columns: ComparisonResult['summary']['columns'];
}) {
  const numeric = (k: ComparisonColumnKind) => NUMERIC_KINDS.includes(k);
  const totals = [...section.totals];
  if (!totals.includes('Total')) {
    const free = totals.findIndex((v) => v === null);
    if (free >= 0) totals[free] = 'Total';
  }
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
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={clsx('px-2 py-1 font-medium', numeric(c.kind) && 'text-right')}
                >
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {section.rows.map((r, k) => (
              <tr key={k} className={clsx(r.matched === false && 'bg-amber-50')}>
                {r.cells.map((v, i) => {
                  const c = columns[i];
                  return (
                    <td
                      key={i}
                      className={clsx(
                        'px-2 py-1',
                        numeric(c.kind) && 'text-right tabular-nums',
                        c.kind === 'group' && 'text-slate-600',
                        c.kind === 'diff' &&
                          typeof v === 'number' &&
                          (v > 0 ? 'text-emerald-700' : v < 0 ? 'text-red-700' : 'text-slate-400'),
                      )}
                    >
                      <CellView value={v} kind={c.kind} decimals={c.decimals} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {section.rows.length > 1 && (
            <tfoot className="sticky bottom-0 bg-slate-50 font-semibold text-slate-800">
              <tr>
                {totals.map((v, i) => (
                  <td
                    key={i}
                    className={clsx(
                      'px-2 py-1',
                      typeof v === 'number' && 'text-right tabular-nums',
                    )}
                  >
                    {v !== null && (
                      <CellView value={v} kind={columns[i].kind} decimals={columns[i].decimals} />
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/**
 * Ferramentas › Quadro Comparativo: conta os pontos de 2 ou mais camadas por grupos de atributos
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

  const layerNames = layers.map(
    (l) => l.label.trim() || list.find((x) => x.id === l.sourceId)?.name || '',
  );
  /** Colunas da tabela de apoio para as colunas do quadro (null = desligada) */
  const lookupForColumns = lookupOk ? lookupCols : null;
  const lookupColsReady = !lookupOk || !!dbColumns.data;
  const autoKey = JSON.stringify([
    [...new Set(s.blocks.flatMap((b) => b.groupBy))],
    layers.length,
    lookupForColumns,
  ]);
  const autoCols = useMemo(() => {
    const [groupBy, count, lk] = JSON.parse(autoKey) as [string[], number, string[] | null];
    return autoColumns(groupBy, count, lk);
  }, [autoKey]);
  const outCols = s.columns ?? autoCols;
  const setColumns = (next: OutColumn[] | null) => patch({ columns: next });
  let columnsError: string | null = null;
  if (schemasReady && lookupColsReady && outCols.length) {
    try {
      compileColumns(outCols, layerNames, {
        layerColumns: columns,
        lookupColumns: lookupForColumns,
      });
      if (outCols.every((c) => c.hidden)) columnsError = 'Deixe ao menos uma coluna visível';
    } catch (err) {
      columnsError = (err as Error).message;
    }
  }

  const blocksOk = s.blocks.length > 0 && s.blocks.every((b) => b.title.trim());
  const request: ComparisonRequest | null =
    layers.length >= 2 &&
    schemasReady &&
    blocksOk &&
    !missing.length &&
    !lookupMissing.length &&
    lookupColsReady &&
    outCols.length > 0 &&
    !columnsError
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
              }
            : null,
          ignoreCase: s.ignoreCase,
          columns: outCols.map((c) => ({
            kind: c.kind,
            title: c.title?.trim() || null,
            column: c.column ?? null,
            layer: c.layer ?? null,
            expression: c.expression ?? null,
            hidden: !!c.hidden,
            sum: !!c.sum,
            decimals: c.decimals ?? null,
          })),
        }
      : null;

  const [result, setResult] = useState<{
    request: ComparisonRequest;
    data: ComparisonResult;
  } | null>(null);
  const [listMenu, setListMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(
    null,
  );
  const [listBusy, setListBusy] = useState(false);
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

  const openUnmatched = async (anchor: HTMLButtonElement) => {
    if (!result) return;
    setListBusy(true);
    try {
      const data = await comparisonService.unmatched(result.request);
      if (!data.layers.length) {
        toast.info('Nenhum ponto das camadas está nos grupos sem correspondência.');
        return;
      }
      const open = (sourceId: string, column: string, values: string[], mode: ListMode) => {
        useAppStore.getState().openListWindow(sourceId, mode, { column, values });
        setListMenu(null);
        close();
      };
      const choices = (sourceId: string, column: string, values: string[], prefix: string) => [
        {
          label: `${prefix}Percorrer (${fmtInt(values.length)})`,
          icon: <ListOrdered className="size-4" />,
          onSelect: () => open(sourceId, column, values, 'walk'),
        },
        {
          label: `${prefix}Selecionar todos (${fmtInt(values.length)})`,
          icon: <ListChecks className="size-4" />,
          onSelect: () => open(sourceId, column, values, 'all'),
        },
      ];
      const items: MenuEntry[] =
        data.layers.length === 1
          ? choices(data.layers[0].sourceId, data.layers[0].column, data.layers[0].ids, '')
          : data.layers.flatMap((layer, i) => [
              ...(i ? (['separator'] as const) : []),
              ...choices(layer.sourceId, layer.column, layer.ids, `${layer.label} · `),
            ]);
      const r = anchor.getBoundingClientRect();
      setListMenu({ x: r.left, y: r.bottom + 4, items });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setListBusy(false);
    }
  };

  return (
    <>
    <Dialog
      open
      size="xl"
      title="Quadro Comparativo"
      description="Conta os pontos de 2 ou mais camadas agrupados por atributos (ex.: tipo_lampada e potencia), em blocos com condições (ex.: medicao = Não), e compara as camadas lado a lado, com as colunas e fórmulas que você escolher."
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
        <ToolTemplateBar
          tool="comparison"
          settings={s}
          onApply={(saved) => setS({ ...DEFAULTS, ...saved })}
        />

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
              descrição e colunas por grupo (ex.: mlampadas: nome, consumo, perda)
            </span>
          </label>
          {s.lookupEnabled && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
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

        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-xs font-medium text-slate-600">
              Colunas da tabela{' '}
              <span className="font-normal text-slate-400">
                {s.columns ? '(em ordem; as ocultas só servem às fórmulas)' : '(automáticas)'}
              </span>
            </p>
            {s.columns && (
              <Button
                size="sm"
                icon={<RotateCcw className="size-3.5" />}
                onClick={() => setColumns(null)}
                title="Descrição, colunas de agrupamento, quantidade por camada e diferença"
              >
                Automáticas
              </Button>
            )}
            <Button
              size="sm"
              icon={<Calculator className="size-3.5" />}
              onClick={() => setColumns(consumoColumns(columns, lookupCols, layers.length))}
              title="Descrição, potência, perdas, quantidade e consumo dos censos anterior e atual, diferença de lâmpadas e consumo total"
            >
              Modelo de consumo
            </Button>
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              disabled={outCols.length >= MAX_COLUMNS}
              onClick={() =>
                setColumns([
                  ...outCols,
                  { id: newId(), kind: 'formula', title: '', expression: '', sum: true },
                ])
              }
            >
              Coluna
            </Button>
          </div>
          <ColumnsEditor
            items={outCols}
            layers={layerNames}
            layerColumns={columns}
            lookupCols={lookupCols}
            lookupOn={lookupOk}
            onChange={setColumns}
          />
          {columnsError && <p className="text-xs text-amber-700">{columnsError}</p>}
          <p className="text-xs text-slate-500">
            Fórmulas: use <code>[Título de outra coluna]</code> ou o nome de uma coluna das camadas
            ou da tabela de apoio (ex.: <code>potencia</code>, <code>perda</code>); operadores{' '}
            <code>+ - * / ^</code> e parênteses; decimal com vírgula ou ponto; funções{' '}
            <code>arred(x; casas)</code>, <code>abs</code>, <code>min</code>, <code>max</code> e{' '}
            <code>sevazio(x; y)</code> (argumentos separados por <code>;</code>). Se um valor
            estiver vazio (ex.: bloco sem a coluna ou sem correspondência na tabela de apoio), o
            resultado fica vazio. <Sigma className="inline size-3" /> soma a coluna na linha de
            total.
          </p>
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
              {summary.unmatched > 0 && (
                <Button
                  size="sm"
                  icon={<ListChecks className="size-3.5" />}
                  loading={listBusy}
                  title="Abre no modo lista os pontos dos grupos sem correspondência na tabela de apoio"
                  onClick={(e) => void openUnmatched(e.currentTarget)}
                >
                  Sem correspondência
                </Button>
              )}
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
              <SectionTable key={k} section={sec} columns={summary.columns} />
            ))}
          </section>
        )}
      </div>
    </Dialog>
    {listMenu && (
      <Menu x={listMenu.x} y={listMenu.y} items={listMenu.items} onClose={() => setListMenu(null)} />
    )}
    </>
  );
}
