import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Layers, Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSourceSchema, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import {
  associationService,
  type AssociationPreview,
  type AssociationRequest,
} from '@/services/association';
import { useAppStore } from '@/stores/appStore';
import type { FilterDef, SourceSchema } from '@/types';
import {
  ADDRESS_LABEL,
  AGGREGATES_LABEL,
  associationColumns,
  criterionLabel,
  defaultAssociationItems,
  reconcileItems,
} from '@/utils/associationColumns';
import {
  STATUS_NEW,
  STATUS_UNIDENTIFIED,
  defaultStatusRule,
  statusAttributeError,
  statusRows,
  statusRuleRequest,
  type StatusRuleState,
  type StatusValueNames,
} from '@/utils/associationStatus';
import { enabledKeys, type ColumnItem } from '@/utils/exportColumns';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';
import { AssociationColumnPicker } from './AssociationColumnPicker';
import { AssociationFixSection } from './AssociationFixSection';
import { AssociationLayerDialog } from './AssociationLayerDialog';
import { StatusRulesEditor } from './StatusRulesEditor';
import { ToolTemplateBar } from './ToolTemplateBar';

const SETTINGS_KEY = 'geoanalisys-association';
const MAX_DISTANCE = 5000;
/** Duas vagas do backend ficam para as prioridades de endereço e de agregados */
const MAX_CRITERIA = 19;
const ADDRESS_COLUMN = /endere/i;
/** Penalidade de prioridade e custo de ponto sem par, em metros */
const MAX_PENALTY = 1_000_000;
/** Penalidade de uma prioridade nova */
const DEFAULT_PENALTY = '10';

interface Criterion {
  columnA: string;
  columnB: string;
  /** Texto do campo (número em metros) */
  maxDistance: string;
  /** Penalidade em metros quando não atendida (texto do campo); ausente nas configurações antigas */
  weight?: string;
}

interface Settings {
  aId: string;
  bId: string;
  maxDistance: string;
  criteria: Criterion[];
  aggregates: boolean;
  /** Texto do campo (número em metros) */
  aggregatesDistance: string;
  aggregatesWeight: string;
  /** Prioridade de endereço parecido; colunas vazias = a coluna "endereco" de cada camada */
  address: boolean;
  addressColumnA: string;
  addressColumnB: string;
  addressDistance: string;
  addressWeight: string;
  /** Custo em metros de deixar um ponto sem par (texto do campo; vazio = sem limite) */
  unmatchedCost: string;
  useFilters: boolean;
  includeUnmatchedB: boolean;
  /** Colunas do arquivo (escolha e ordem); vazio = padrão */
  columns: ColumnItem[];
  /** Regras de Status por rótulo da prioridade */
  status: Record<string, StatusRuleState>;
  statusNames: StatusValueNames;
  /** Status gerado → nome escolhido no resultado */
  statusRenames: Record<string, string>;
}

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}

/** Configurações salvas (localStorage ou template) completadas com os padrões. */
function settingsFrom(saved: Partial<Settings>, activeId: string | null): Settings {
  return {
    aId: saved.aId ?? activeId ?? '',
    bId: saved.bId ?? '',
    maxDistance: saved.maxDistance ?? '25',
    criteria: saved.criteria ?? [],
    aggregates: saved.aggregates ?? false,
    aggregatesDistance: saved.aggregatesDistance ?? saved.maxDistance ?? '25',
    aggregatesWeight: saved.aggregatesWeight ?? DEFAULT_PENALTY,
    address: saved.address ?? false,
    addressColumnA: saved.addressColumnA ?? '',
    addressColumnB: saved.addressColumnB ?? '',
    addressDistance: saved.addressDistance ?? saved.maxDistance ?? '25',
    addressWeight: saved.addressWeight ?? DEFAULT_PENALTY,
    unmatchedCost: saved.unmatchedCost ?? '',
    useFilters: saved.useFilters ?? false,
    includeUnmatchedB: saved.includeUnmatchedB ?? false,
    columns: saved.columns ?? [],
    status: saved.status ?? {},
    statusNames: saved.statusNames ?? {},
    statusRenames: saved.statusRenames ?? {},
  };
}

/** Colunas que podem ser comparadas (sem geometria). */
const columnNames = (schema: SourceSchema | undefined) =>
  (schema?.columns ?? []).filter((c) => c.kind !== 'geometry').map((c) => c.name);

/** Distância válida em metros (0 < d ≤ máximo) ou null. */
function parseDistance(s: string): number | null {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= MAX_DISTANCE ? n : null;
}

/** Penalidade válida em metros (0 ≤ p ≤ MAX_PENALTY) ou null; vazio = 1. */
function parseWeight(s: string | undefined): number | null {
  if (!s?.trim()) return 1;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= MAX_PENALTY ? n : null;
}
const WEIGHT_ERROR = `Penalidade entre 0 e ${fmtInt(MAX_PENALTY)} m.`;

/** Custo de ponto sem par em metros; vazio = sem limite (null); inválido = undefined. */
function parseUnmatchedCost(s: string): number | null | undefined {
  if (!s.trim()) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= MAX_PENALTY ? n : undefined;
}

const cellText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export default function AssociateLayersDialog() {
  const closeDialog = useAppStore((s) => s.closeDialog);
  const activeId = useAppStore((s) => s.sourceId);
  const sources = useSources();
  const list = useMemo(() => sources.data ?? [], [sources.data]);

  const [s, setS] = useState<Settings>(() => settingsFrom(loadSettings(), activeId));
  const patch = (p: Partial<Settings>) => setS((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* sem localStorage: as escolhas valem só agora */
    }
  }, [s]);

  const a = list.find((x) => x.id === s.aId) ?? list.find((x) => x.id === activeId) ?? list[0];
  const b =
    list.find((x) => x.id === s.bId && x.id !== a?.id) ??
    list.find((x) => x.id !== a?.id && /anterior/i.test(`${x.name} ${x.tableName}`)) ??
    list.find((x) => x.id !== a?.id);
  const schemaA = useSourceSchema(a?.id ?? null);
  const schemaB = useSourceSchema(b?.id ?? null);
  const colsA = useMemo(() => columnNames(schemaA.data), [schemaA.data]);
  const colsB = useMemo(() => columnNames(schemaB.data), [schemaB.data]);

  const setCriterion = (i: number, p: Partial<Criterion>) =>
    patch({ criteria: s.criteria.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  const addCriterion = () => {
    const columnA = colsA.find((c) => /medicao/i.test(c)) ?? colsA[0] ?? '';
    const columnB = colsB.includes(columnA) ? columnA : (colsB[0] ?? '');
    patch({ criteria: [...s.criteria, { columnA, columnB, maxDistance: s.maxDistance, weight: DEFAULT_PENALTY }] });
  };

  const addressA =
    (colsA.includes(s.addressColumnA) && s.addressColumnA) ||
    colsA.find((c) => ADDRESS_COLUMN.test(c)) ||
    '';
  const addressB =
    (colsB.includes(s.addressColumnB) && s.addressColumnB) ||
    (colsB.includes(addressA) && addressA) ||
    colsB.find((c) => ADDRESS_COLUMN.test(c)) ||
    '';
  const addressDistance = parseDistance(s.addressDistance);
  const addressWeight = parseWeight(s.addressWeight);
  const addressError = !s.address
    ? null
    : !addressA
      ? `Escolha a coluna de endereço de ${a?.name ?? 'A'}.`
      : !addressB
        ? `Escolha a coluna de endereço de ${b?.name ?? 'B'}.`
        : addressDistance === null
          ? `Distância entre 0 e ${fmtInt(MAX_DISTANCE)} m.`
          : addressWeight === null
            ? WEIGHT_ERROR
            : null;

  const maxDistance = parseDistance(s.maxDistance);
  const aggregatesDistance = parseDistance(s.aggregatesDistance);
  const aggregatesWeight = parseWeight(s.aggregatesWeight);
  const unmatchedCost = parseUnmatchedCost(s.unmatchedCost);
  const criteriaErrors = s.criteria.map((c) =>
    !colsA.includes(c.columnA)
      ? `A coluna "${c.columnA}" não existe em ${a?.name ?? 'A'}.`
      : !colsB.includes(c.columnB)
        ? `A coluna "${c.columnB}" não existe em ${b?.name ?? 'B'}.`
        : parseDistance(c.maxDistance) === null
          ? `Distância entre 0 e ${fmtInt(MAX_DISTANCE)} m.`
          : parseWeight(c.weight) === null
            ? WEIGHT_ERROR
            : null,
  );

  const critLabels = useMemo(
    () => [
      ...s.criteria.map(criterionLabel),
      ...(s.address ? [ADDRESS_LABEL] : []),
      ...(s.aggregates ? [AGGREGATES_LABEL] : []),
    ],
    [s.criteria, s.address, s.aggregates],
  );
  const statusRuleOf = (key: string) => s.status[key] ?? defaultStatusRule(key);
  const statusLayerA = a ? { id: a.id, name: a.name, columns: colsA } : null;
  const statusLayerB = b ? { id: b.id, name: b.name, columns: colsB } : null;
  const statusValid = statusRows(critLabels, a?.name ?? 'A', s.includeUnmatchedB).every((row) => {
    const r = statusRuleOf(row.key);
    return !r.consider || !statusAttributeError(r.attribute, row.sides, statusLayerA, statusLayerB);
  });
  const outCols = useMemo(
    () => associationColumns(schemaA.data, schemaB.data, critLabels),
    [schemaA.data, schemaB.data, critLabels],
  );
  const items = useMemo(() => reconcileItems(s.columns, outCols), [s.columns, outCols]);
  const chosen = enabledKeys(items);

  const filtersOf = (sourceId: string): FilterDef[] => {
    if (!s.useFilters) return [];
    const st = useAppStore.getState();
    return sourceId === st.sourceId ? st.filters : (st.layerFilters[sourceId] ?? []);
  };
  const request: AssociationRequest | null =
    a &&
    b &&
    maxDistance !== null &&
    unmatchedCost !== undefined &&
    (!s.aggregates || (aggregatesDistance !== null && aggregatesWeight !== null)) &&
    !addressError &&
    !schemaA.isLoading &&
    !schemaB.isLoading &&
    chosen.length > 0 &&
    criteriaErrors.every((e) => !e) &&
    statusValid
      ? {
          a: { sourceId: a.id, filters: filtersOf(a.id) },
          b: { sourceId: b.id, filters: filtersOf(b.id) },
          maxDistance,
          criteria: s.criteria.map((c) => ({
            columnA: c.columnA,
            columnB: c.columnB,
            maxDistance: parseDistance(c.maxDistance)!,
            weight: parseWeight(c.weight)!,
            status: statusRuleRequest(statusRuleOf(criterionLabel(c)), s.statusNames),
          })),
          aggregates: s.aggregates
            ? {
                maxDistance: aggregatesDistance!,
                weight: aggregatesWeight!,
                status: statusRuleRequest(statusRuleOf(AGGREGATES_LABEL), s.statusNames),
              }
            : null,
          address: s.address
            ? {
                columnA: addressA,
                columnB: addressB,
                maxDistance: addressDistance!,
                weight: addressWeight!,
                status: statusRuleRequest(statusRuleOf(ADDRESS_LABEL), s.statusNames),
              }
            : null,
          unmatchedCost,
          includeUnmatchedB: s.includeUnmatchedB,
          statusRenames: Object.fromEntries(
            Object.entries(s.statusRenames).flatMap(([from, to]) =>
              to.trim() && to.trim() !== from ? [[from, to.trim()]] : [],
            ),
          ),
          unmatchedStatus: {
            newPoints: statusRuleRequest(statusRuleOf(STATUS_NEW), s.statusNames),
            unidentified: statusRuleRequest(statusRuleOf(STATUS_UNIDENTIFIED), s.statusNames),
          },
          columns: chosen,
        }
      : null;
  const requestKey = request ? JSON.stringify(request) : null;

  const [result, setResult] = useState<{ key: string; data: AssociationPreview } | null>(null);
  const run = useMutation({
    mutationFn: (req: AssociationRequest) => associationService.preview(req),
    onSuccess: (data, req) => setResult({ key: JSON.stringify(req), data }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const [downloading, setDownloading] = useState<'xlsx' | 'csv' | null>(null);
  const download = async (format: 'xlsx' | 'csv') => {
    if (!request) return;
    setDownloading(format);
    try {
      await associationService.download(request, format);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(null);
    }
  };
  const [layerOpen, setLayerOpen] = useState(false);
  const stale = !!result && result.key !== requestKey;
  const summary = result?.data.summary;

  return (
    <Dialog
      open
      size="xl"
      title="Associar Camadas"
      description="Liga os pontos da camada A aos da camada B, 1 para 1, com o menor custo total (distância + penalidades), olhando todos os pontos juntos."
      onClose={() => closeDialog('associate')}
      footer={
        <>
          <Button className="mr-auto" onClick={() => closeDialog('associate')}>
            Fechar
          </Button>
          <Button
            icon={<FileText className="size-4" />}
            loading={downloading === 'csv'}
            disabled={!request || !!downloading}
            onClick={() => void download('csv')}
          >
            Baixar CSV
          </Button>
          <Button
            icon={<FileSpreadsheet className="size-4" />}
            loading={downloading === 'xlsx'}
            disabled={!request || !!downloading}
            onClick={() => void download('xlsx')}
          >
            Baixar XLSX
          </Button>
          <Button
            icon={<Layers className="size-4" />}
            disabled={!request || !!downloading}
            title="Grava o resultado como camada no schema GeoAnalisysTemp (nova ou substituindo uma existente)"
            onClick={() => setLayerOpen(true)}
          >
            Camada temporária
          </Button>
          <Button
            variant="primary"
            icon={<Link2 className="size-4" />}
            loading={run.isPending}
            disabled={!request}
            onClick={() => request && run.mutate(request)}
          >
            Associar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ToolTemplateBar
          tool="association"
          settings={s}
          onApply={(saved) => setS(settingsFrom(saved, activeId))}
        />

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor="as-a" hint="1ª coluna do resultado">
              Camada A
            </Label>
            <Select
              id="as-a"
              value={a?.id ?? ''}
              onChange={(e) => patch({ aId: e.target.value })}
              disabled={!list.length}
            >
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="as-b" hint="2ª coluna do resultado">
              Camada B
            </Label>
            <Select
              id="as-b"
              value={b?.id ?? ''}
              onChange={(e) => patch({ bId: e.target.value })}
              disabled={list.length < 2}
            >
              {!b && <option value="">Escolha outra camada…</option>}
              {list
                .filter((x) => x.id !== a?.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="as-dist" hint="metros">
              Distância máxima
            </Label>
            <Input
              id="as-dist"
              type="number"
              min={0}
              max={MAX_DISTANCE}
              step="any"
              value={s.maxDistance}
              onChange={(e) => patch({ maxDistance: e.target.value })}
            />
            {maxDistance === null && (
              <p className="mt-1 text-xs text-red-600">
                Informe uma distância entre 0 e {fmtInt(MAX_DISTANCE)} m.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="as-unmatched" hint="metros; vazio = associar o máximo">
              Custo de ponto sem par
            </Label>
            <Input
              id="as-unmatched"
              type="number"
              min={0}
              max={MAX_PENALTY}
              step="any"
              placeholder="sem limite"
              value={s.unmatchedCost}
              onChange={(e) => patch({ unmatchedCost: e.target.value })}
            />
            {unmatchedCost === undefined && (
              <p className="mt-1 text-xs text-red-600">
                Informe um custo entre 0 e {fmtInt(MAX_PENALTY)} m, ou deixe vazio.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={s.useFilters}
              onChange={(e) => patch({ useFilters: e.target.checked })}
              className="accent-accent-600"
            />
            Aplicar os filtros salvos de cada camada (senão, usa todos os registros)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={s.includeUnmatchedB}
              onChange={(e) => patch({ includeUnmatchedB: e.target.checked })}
              className="accent-accent-600"
            />
            Listar também os pontos de B sem associação (com 0 na 1ª coluna)
          </label>
        </div>

        <div className="space-y-2">
          <Label hint="cada prioridade não atendida soma a penalidade dela à distância do par">
            Prioridades
          </Label>
          <div className="rounded-md border border-slate-200 p-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex min-w-0 flex-1 items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={s.aggregates}
                  onChange={(e) => patch({ aggregates: e.target.checked })}
                  className="mt-0.5 accent-accent-600"
                />
                <span>
                  <span className="font-medium">Agregados de pontos</span>
                  <span className="block text-xs text-slate-500">
                    Pela quantidade de pontos na mesma coordenada: único com único e grupo com grupo
                    do mesmo tamanho (3 com 3). Grupos com 1 ponto de diferença (3 com 2 ou 4) pagam
                    metade da penalidade; único com grupo ou diferença maior, a penalidade toda.
                  </span>
                </span>
              </label>
              {s.aggregates && (
                <div className="flex items-center gap-2">
                  <label htmlFor="as-agg" className="text-xs font-medium text-slate-600">
                    Até
                  </label>
                  <div className="w-24 shrink-0">
                    <Input
                      id="as-agg"
                      type="number"
                      min={0}
                      max={MAX_DISTANCE}
                      step="any"
                      value={s.aggregatesDistance}
                      onChange={(e) => patch({ aggregatesDistance: e.target.value })}
                    />
                  </div>
                  <span className="text-xs text-slate-500">m</span>
                  <label htmlFor="as-aggw" className="ml-2 text-xs font-medium text-slate-600">
                    Penalidade (m)
                  </label>
                  <div className="w-20 shrink-0">
                    <Input
                      id="as-aggw"
                      type="number"
                      min={0}
                      max={MAX_PENALTY}
                      step="any"
                      value={s.aggregatesWeight}
                      onChange={(e) => patch({ aggregatesWeight: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>
            {s.aggregates && aggregatesDistance === null && (
              <p className="mt-1 text-xs text-red-600">
                Distância entre 0 e {fmtInt(MAX_DISTANCE)} m.
              </p>
            )}
            {s.aggregates && aggregatesWeight === null && (
              <p className="mt-1 text-xs text-red-600">{WEIGHT_ERROR}</p>
            )}
          </div>
          <div className="rounded-md border border-slate-200 p-2">
            <label className="flex min-w-0 items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={s.address}
                onChange={(e) => patch({ address: e.target.checked })}
                className="mt-0.5 accent-accent-600"
              />
              <span>
                <span className="font-medium">Endereço parecido</span>
                <span className="block text-xs text-slate-500">
                  Atendida quando os endereços têm algum número igual ou alguma palavra parecida:
                  com 1 ou 2 letras, a mesma palavra ("Rua A" com "A"); com 3 ou mais, também a
                  abreviação ("Exe" ou "Rua Exem" com "Exemplo"). Ex.: "Rua Exemplo 123" com "123",
                  "Ex 123" ou "exemplo"; muito diferentes, não. Endereço vazio ou SDO em um dos
                  pontos não conta contra o par.
                </span>
              </span>
            </label>
            {s.address && (
              <div className="mt-2 grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_5rem]">
                <div>
                  <Label htmlFor="as-addr-a">Coluna em A</Label>
                  <Select
                    id="as-addr-a"
                    value={addressA}
                    onChange={(e) => {
                      const columnA = e.target.value;
                      patch({
                        addressColumnA: columnA,
                        ...(colsB.includes(columnA) ? { addressColumnB: columnA } : {}),
                      });
                    }}
                  >
                    {!addressA && <option value="">Escolha…</option>}
                    {colsA.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="as-addr-b">Coluna em B</Label>
                  <Select
                    id="as-addr-b"
                    value={addressB}
                    onChange={(e) => patch({ addressColumnB: e.target.value })}
                  >
                    {!addressB && <option value="">Escolha…</option>}
                    {colsB.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="as-addr-d" hint="m">
                    Até
                  </Label>
                  <Input
                    id="as-addr-d"
                    type="number"
                    min={0}
                    max={MAX_DISTANCE}
                    step="any"
                    value={s.addressDistance}
                    onChange={(e) => patch({ addressDistance: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="as-addr-w" hint="m">
                    Penalidade
                  </Label>
                  <Input
                    id="as-addr-w"
                    type="number"
                    min={0}
                    max={MAX_PENALTY}
                    step="any"
                    value={s.addressWeight}
                    onChange={(e) => patch({ addressWeight: e.target.value })}
                  />
                </div>
              </div>
            )}
            {addressError && <p className="mt-1 text-xs text-red-600">{addressError}</p>}
          </div>
          {s.criteria.length === 0 && !s.aggregates && !s.address && (
            <p className="text-xs text-slate-500">
              Sem prioridades: a associação minimiza a soma das distâncias dos pares.
            </p>
          )}
          {s.criteria.map((c, i) => (
            <div key={i} className="rounded-md border border-slate-200 p-2">
              <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_7rem_5rem_auto]">
                <div>
                  <Label htmlFor={`as-ca-${i}`}>Coluna em A</Label>
                  <Select
                    id={`as-ca-${i}`}
                    value={c.columnA}
                    onChange={(e) => {
                      const columnA = e.target.value;
                      setCriterion(i, {
                        columnA,
                        ...(colsB.includes(columnA) ? { columnB: columnA } : {}),
                      });
                    }}
                  >
                    {!colsA.includes(c.columnA) && <option value={c.columnA}>{c.columnA || '—'}</option>}
                    {colsA.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <span className="pb-2 text-sm text-slate-500">igual a</span>
                <div>
                  <Label htmlFor={`as-cb-${i}`}>Coluna em B</Label>
                  <Select
                    id={`as-cb-${i}`}
                    value={c.columnB}
                    onChange={(e) => setCriterion(i, { columnB: e.target.value })}
                  >
                    {!colsB.includes(c.columnB) && <option value={c.columnB}>{c.columnB || '—'}</option>}
                    {colsB.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`as-cd-${i}`} hint="m">
                    Até
                  </Label>
                  <Input
                    id={`as-cd-${i}`}
                    type="number"
                    min={0}
                    max={MAX_DISTANCE}
                    step="any"
                    value={c.maxDistance}
                    onChange={(e) => setCriterion(i, { maxDistance: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={`as-cw-${i}`} hint="m">
                    Penalidade
                  </Label>
                  <Input
                    id={`as-cw-${i}`}
                    type="number"
                    min={0}
                    max={MAX_PENALTY}
                    step="any"
                    value={c.weight ?? '1'}
                    onChange={(e) => setCriterion(i, { weight: e.target.value })}
                  />
                </div>
                <Button
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  aria-label={`Remover prioridade ${i + 1}`}
                  title="Remover prioridade"
                  onClick={() => patch({ criteria: s.criteria.filter((_, k) => k !== i) })}
                />
              </div>
              {criteriaErrors[i] && <p className="mt-1 text-xs text-red-600">{criteriaErrors[i]}</p>}
            </div>
          ))}
          <Button
            size="sm"
            icon={<Plus className="size-3.5" />}
            disabled={!colsA.length || !colsB.length || s.criteria.length >= MAX_CRITERIA}
            onClick={addCriterion}
          >
            Adicionar prioridade
          </Button>
          <p className="text-xs text-slate-500">
            Uma prioridade é atendida quando os valores das duas colunas são iguais (sem diferenciar
            maiúsculas e acentos) e o par está a até a distância dela. Se essa distância for maior que a
            máxima, pares que atendem a prioridade podem ser associados até ela. O custo de um par é a
            distância mais a penalidade de cada prioridade não atendida, e a associação escolhe o menor
            custo total olhando todos os pontos juntos. Penalidade pequena (ex.: 10 m) desempata pela
            proximidade; penalidade grande (ex.: 1000 m) só é quebrada quando não há outra opção, desde
            que o custo de ponto sem par seja maior que metade dela. Como as prioridades não atendidas
            aparecem na coluna Status se configura em Status, logo abaixo.
          </p>
        </div>

        <div className="space-y-2">
          <Label hint="como as divergências aparecem na coluna Status">Status</Label>
          <StatusRulesEditor
            labels={critLabels}
            rules={s.status}
            names={s.statusNames}
            a={statusLayerA}
            b={statusLayerB}
            includeUnmatchedB={s.includeUnmatchedB}
            onRule={(key, p) =>
              setS((cur) => ({
                ...cur,
                status: { ...cur.status, [key]: { ...(cur.status[key] ?? defaultStatusRule(key)), ...p } },
              }))
            }
            onNames={(attribute, values) =>
              setS((cur) => ({ ...cur, statusNames: { ...cur.statusNames, [attribute]: values } }))
            }
          />
        </div>

        <div className="space-y-1">
          <Label hint="arraste ou use as setas para ordenar">Colunas do arquivo</Label>
          {schemaA.isLoading || schemaB.isLoading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <AssociationColumnPicker
              items={items}
              columns={outCols}
              nameA={a?.name ?? 'Camada A'}
              nameB={b?.name ?? 'Camada B'}
              onChange={(columns) => patch({ columns })}
              onReset={() => patch({ columns: defaultAssociationItems(outCols) })}
            />
          )}
          {!chosen.length && !schemaA.isLoading && !schemaB.isLoading && (
            <p className="text-xs text-red-600">Inclua ao menos uma coluna.</p>
          )}
        </div>

        <AssociationFixSection
          request={request}
          nameA={a?.name ?? 'A'}
          nameB={b?.name ?? 'B'}
          onOpenReview={() => closeDialog('associate')}
        />

        {result && summary && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>
                <span className="font-semibold text-slate-800">{fmtInt(summary.matched)}</span> pares
                associados
              </span>
              <span className="text-emerald-700">Ponto Normal: {fmtInt(summary.normal)}</span>
              <span className="text-amber-700">Divergência: {fmtInt(summary.divergent)}</span>
              <span>
                Ponto Novo coletado em {summary.nameA}: {fmtInt(summary.unmatchedA)} de{' '}
                {fmtInt(summary.totalA)}
              </span>
              <span>
                Não Identificado em {summary.nameA}: {fmtInt(summary.unmatchedB)} de{' '}
                {fmtInt(summary.totalB)} de {summary.nameB}
              </span>
              {summary.averageDistance !== null && (
                <span>distância média {summary.averageDistance.toLocaleString('pt-BR')} m</span>
              )}
              {summary.byCriteria.length > 1 &&
                summary.byCriteria.map((n, k) => (
                  <span key={k}>
                    {k} prioridade{k === 1 ? '' : 's'}: {fmtInt(n)}
                  </span>
                ))}
              {summary.withoutCoordsA + summary.withoutCoordsB > 0 && (
                <span className="text-amber-700">
                  sem coordenadas: {fmtInt(summary.withoutCoordsA)} em A, {fmtInt(summary.withoutCoordsB)}{' '}
                  em B
                </span>
              )}
            </div>
            {summary.byStatus.length > 0 && (
              <details className="rounded-md border border-slate-200 text-xs text-slate-700" open>
                <summary className="cursor-pointer px-3 py-1.5 font-medium text-slate-600">
                  Contagem por Status ({fmtInt(summary.byStatus.length)})
                </summary>
                <div className="scroll-thin max-h-64 overflow-y-auto border-t border-slate-100 px-3 py-1.5">
                  <table className="w-full">
                    <thead className="text-left text-[11px] text-slate-500">
                      <tr>
                        <th className="py-0.5 pr-3 font-medium">Status gerado</th>
                        <th className="py-0.5 pr-3 font-medium">
                          Nome no resultado (vazio = o gerado; salvo no template)
                        </th>
                        <th className="py-0.5 text-right font-medium">Quantidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byStatus.map((x) => (
                        <tr key={x.original}>
                          <td className="py-0.5 pr-3">{x.original}</td>
                          <td className="py-0.5 pr-3">
                            <input
                              aria-label={`Nome no resultado para ${x.original}`}
                              value={s.statusRenames[x.original] ?? ''}
                              placeholder={x.original}
                              maxLength={200}
                              onChange={(e) =>
                                setS((cur) => ({
                                  ...cur,
                                  statusRenames: { ...cur.statusRenames, [x.original]: e.target.value },
                                }))
                              }
                              className="h-6 w-full min-w-40 rounded border border-slate-300 bg-transparent px-1.5 text-xs focus:border-accent-500 focus:outline-none"
                            />
                          </td>
                          <td className="py-0.5 text-right tabular-nums">{fmtInt(x.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {stale && (
              <p className="text-xs text-amber-700">
                Os parâmetros mudaram desde a última associação: clique em Associar para atualizar.
              </p>
            )}
            <Label hint={`primeiras ${fmtInt(result.data.rows.length)} de ${fmtInt(result.data.totalRows)} linhas`}>
              Prévia
            </Label>
            <div className="scroll-thin max-h-72 overflow-auto rounded-md border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-100 text-left text-slate-700">
                  <tr>
                    {result.data.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 odd:bg-white even:bg-slate-50">
                      {r.map((v, j) => (
                        <td key={j} className="whitespace-nowrap px-2 py-1 text-slate-700">
                          {cellText(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {layerOpen &&
          request &&
          // No body: dentro desta janela o backdrop-filter prenderia o `fixed` da outra.
          createPortal(
            <AssociationLayerDialog
              request={request}
              nameA={a?.name ?? 'A'}
              nameB={b?.name ?? 'B'}
              onClose={() => setLayerOpen(false)}
            />,
            document.body,
          )}
      </div>
    </Dialog>
  );
}
