import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Map as MapIcon, MousePointerClick, Plus, ScanSearch, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSourceSchema, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { duplicatesService, type DuplicateRule, type DuplicatesRequest } from '@/services/duplicates';
import { useAppStore } from '@/stores/appStore';
import { selectDuplicatePoints, useDuplicatesStore } from '@/stores/duplicatesStore';
import type { FilterDef } from '@/types';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

const SETTINGS_KEY = 'geoanalisys-duplicates';
const MAX_RADIUS = 1000;
const MAX_REFERENCE_DISTANCE = 5000;
const MAX_WEIGHT = 1000;
const MAX_RULES = 20;

interface Rule {
  column: string;
  mode: DuplicateRule['mode'];
  scope: DuplicateRule['scope'];
  /** Texto do campo */
  weight: string;
}

interface Settings {
  layerId: string;
  radius: string;
  minScore: string;
  sameCoordWeight: string;
  /** null = regras sugeridas pelas colunas da camada */
  rules: Rule[] | null;
  useFilters: boolean;
  includeNearby: boolean;
  useReference: boolean;
  referenceId: string;
  referenceDistance: string;
  bothMatched: string;
  oneMatched: string;
  noneMatched: string;
  useDensity: boolean;
  densityRadius: string;
  densityCount: string;
  densityWeight: string;
}

const DEFAULTS: Omit<Settings, 'layerId' | 'referenceId'> = {
  radius: '10',
  minScore: '3',
  sameCoordWeight: '2',
  rules: null,
  useFilters: false,
  includeNearby: true,
  useReference: true,
  referenceDistance: '25',
  bothMatched: '-3',
  oneMatched: '2',
  noneMatched: '1',
  useDensity: true,
  densityRadius: '30',
  densityCount: '3',
  densityWeight: '-2',
};

/** Regras sugeridas quando a camada tem colunas com estes nomes. */
const SUGGESTED: { re: RegExp; mode: Rule['mode']; scope: Rule['scope'] }[] = [
  { re: /tipo.?l[aâ]mp/i, mode: 'equal', scope: 'radius' },
  { re: /pot[eê]ncia/i, mode: 'equal', scope: 'radius' },
  { re: /cadastr/i, mode: 'equal', scope: 'radius' },
  { re: /^id.?poste$/i, mode: 'different', scope: 'sameCoord' },
  { re: /transformador/i, mode: 'different', scope: 'sameCoord' },
  { re: /^cod.?poste$/i, mode: 'different', scope: 'sameCoord' },
];

function suggestedRules(columns: string[]): Rule[] {
  const used = new Set<string>();
  return SUGGESTED.flatMap(({ re, mode, scope }) => {
    const column = columns.find((c) => re.test(c) && !used.has(c));
    if (!column) return [];
    used.add(column);
    return [{ column, mode, scope, weight: '1' }];
  });
}

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}

/** Número do campo dentro da faixa, ou null. */
function parseNum(s: string, min: number, max: number, exclusiveMin = false): number | null {
  if (!s.trim()) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && (exclusiveMin ? n > min : n >= min) && n <= max ? n : null;
}
const parseWeight = (s: string) => parseNum(s, -MAX_WEIGHT, MAX_WEIGHT);
const WEIGHT_ERROR = `Peso entre −${fmtInt(MAX_WEIGHT)} e ${fmtInt(MAX_WEIGHT)}.`;

function NumberField({
  id,
  label,
  hint,
  value,
  error,
  onChange,
  className = 'w-24',
}: {
  id: string;
  label: ReactNode;
  hint?: string;
  value: string;
  error?: string | null;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <Input id={id} type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function DuplicatesDialog() {
  const closeDialog = useAppStore((st) => st.closeDialog);
  const activeId = useAppStore((st) => st.sourceId);
  const sources = useSources();
  const list = useMemo(() => sources.data ?? [], [sources.data]);
  const result = useDuplicatesStore((st) => st.result);
  const setResult = useDuplicatesStore((st) => st.setResult);
  const setPanelOpen = useDuplicatesStore((st) => st.setPanelOpen);

  const [s, setS] = useState<Settings>(() => {
    const saved = loadSettings();
    return { layerId: '', referenceId: '', ...DEFAULTS, ...saved };
  });
  const patch = (p: Partial<Settings>) => setS((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* sem localStorage: as escolhas valem só agora */
    }
  }, [s]);

  const layer =
    list.find((x) => x.id === s.layerId) ??
    list.find((x) => /atual/i.test(`${x.name} ${x.tableName}`)) ??
    list.find((x) => x.id === activeId) ??
    list[0];
  const reference =
    list.find((x) => x.id === s.referenceId && x.id !== layer?.id) ??
    list.find((x) => x.id !== layer?.id && /anterior/i.test(`${x.name} ${x.tableName}`)) ??
    list.find((x) => x.id !== layer?.id);
  const schema = useSourceSchema(layer?.id ?? null);
  const columns = useMemo(
    () => (schema.data?.columns ?? []).filter((c) => c.kind !== 'geometry').map((c) => c.name),
    [schema.data],
  );
  const rules = s.rules ?? suggestedRules(columns);
  const setRules = (next: Rule[]) => patch({ rules: next });
  const setRule = (i: number, p: Partial<Rule>) => setRules(rules.map((r, k) => (k === i ? { ...r, ...p } : r)));

  const radius = parseNum(s.radius, 0, MAX_RADIUS, true);
  const minScore = parseNum(s.minScore, -100_000, 100_000);
  const sameCoordWeight = parseWeight(s.sameCoordWeight);
  const ruleErrors = rules.map((r) =>
    !columns.includes(r.column)
      ? `A coluna "${r.column}" não existe em ${layer?.name ?? 'na camada'}.`
      : parseWeight(r.weight) === null
        ? WEIGHT_ERROR
        : null,
  );
  const useReference = s.useReference && !!reference;
  const refDistance = parseNum(s.referenceDistance, 0, MAX_REFERENCE_DISTANCE, true);
  const refWeights = [s.bothMatched, s.oneMatched, s.noneMatched].map(parseWeight);
  const useDensity = useReference && s.useDensity;
  const densityRadius = parseNum(s.densityRadius, 0, MAX_RADIUS, true);
  const densityCount = parseNum(s.densityCount, 1, 100_000);
  const densityWeight = parseWeight(s.densityWeight);

  const filtersOf = (sourceId: string): FilterDef[] => {
    if (!s.useFilters) return [];
    const st = useAppStore.getState();
    return sourceId === st.sourceId ? st.filters : (st.layerFilters[sourceId] ?? []);
  };
  const valid =
    !!layer &&
    !schema.isLoading &&
    radius !== null &&
    minScore !== null &&
    sameCoordWeight !== null &&
    ruleErrors.every((e) => !e) &&
    (!useReference || (refDistance !== null && refWeights.every((w) => w !== null))) &&
    (!useDensity || (densityRadius !== null && densityCount !== null && Number.isInteger(densityCount) && densityWeight !== null));
  const request: DuplicatesRequest | null = valid
    ? {
        layer: { sourceId: layer.id, filters: filtersOf(layer.id) },
        radius: radius!,
        sameCoordWeight: sameCoordWeight!,
        rules: rules.map((r) => ({ column: r.column, mode: r.mode, scope: r.scope, weight: parseWeight(r.weight)! })),
        reference:
          useReference && reference
            ? {
                sourceId: reference.id,
                filters: filtersOf(reference.id),
                maxDistance: refDistance!,
                bothMatched: refWeights[0]!,
                oneMatched: refWeights[1]!,
                noneMatched: refWeights[2]!,
              }
            : null,
        density: useDensity ? { radius: densityRadius!, minCount: densityCount!, weight: densityWeight! } : null,
        minScore: minScore!,
        includeNearby: s.includeNearby,
      }
    : null;
  const requestKey = request ? JSON.stringify(request) : null;

  const run = useMutation({
    mutationFn: (req: DuplicatesRequest) => duplicatesService.preview(req),
    onSuccess: (data, req) => setResult({ request: req, data }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const [downloading, setDownloading] = useState<'xlsx' | 'csv' | null>(null);
  const download = async (format: 'xlsx' | 'csv') => {
    if (!request) return;
    setDownloading(format);
    try {
      await duplicatesService.download(request, format);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(null);
    }
  };
  const close = () => closeDialog('duplicates');
  const summary = result?.data.summary;
  const stale = !!result && JSON.stringify(result.request) !== requestKey;

  return (
    <Dialog
      open
      size="xl"
      title="Duplicidades"
      description="Pontos da camada a até o raio máximo um do outro que podem ter sido coletados duas vezes. Cada regra atendida soma o seu peso (negativo diminui a chance); ficam os pares com a pontuação mínima."
      onClose={close}
      footer={
        <>
          <Button className="mr-auto" onClick={close}>
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
            variant="primary"
            icon={<ScanSearch className="size-4" />}
            loading={run.isPending}
            disabled={!request}
            onClick={() => request && run.mutate(request)}
          >
            Buscar duplicidades
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
          <div>
            <Label htmlFor="dup-layer" hint="ex.: Censo Atual">
              Camada analisada
            </Label>
            <Select
              id="dup-layer"
              value={layer?.id ?? ''}
              onChange={(e) => patch({ layerId: e.target.value, rules: null })}
              disabled={!list.length}
            >
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </div>
          <NumberField
            id="dup-radius"
            label="Raio máximo"
            hint="m"
            className=""
            value={s.radius}
            error={radius === null ? `Entre 0 e ${fmtInt(MAX_RADIUS)} m.` : null}
            onChange={(radius) => patch({ radius })}
          />
          <NumberField
            id="dup-min"
            label="Pontuação mínima"
            className=""
            value={s.minScore}
            error={minScore === null ? 'Informe um número.' : null}
            onChange={(minScore) => patch({ minScore })}
          />
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
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={s.includeNearby}
              onChange={(e) => patch({ includeNearby: e.target.checked })}
              className="mt-0.5 accent-accent-600"
            />
            <span>
              Mostrar todos os candidatos de cada ponto suspeito
              <span className="block text-xs text-slate-500">
                Um ponto pode ser duplicidade de mais de um: os outros pontos a até o raio também
                aparecem no grupo, com a pontuação, marcados como abaixo da mínima.
              </span>
            </span>
          </label>
        </div>

        <div className="space-y-2">
          <Label hint="iguais/diferentes entre os dois pontos do par">Regras de atributos</Label>
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-2">
            <div className="min-w-0 flex-1 text-sm text-slate-700">
              <span className="font-medium">Mesma coordenada</span>
              <span className="block text-xs text-slate-500">Os dois pontos exatamente no mesmo X/Y.</span>
            </div>
            <NumberField
              id="dup-same"
              label="Peso"
              value={s.sameCoordWeight}
              error={sameCoordWeight === null ? WEIGHT_ERROR : null}
              onChange={(sameCoordWeight) => patch({ sameCoordWeight })}
            />
          </div>
          {rules.map((r, i) => (
            <div key={i} className="rounded-md border border-slate-200 p-2">
              <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_12rem_6rem_auto]">
                <div>
                  <Label htmlFor={`dup-col-${i}`}>Coluna</Label>
                  <Select id={`dup-col-${i}`} value={r.column} onChange={(e) => setRule(i, { column: e.target.value })}>
                    {!columns.includes(r.column) && <option value={r.column}>{r.column || '—'}</option>}
                    {columns.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`dup-mode-${i}`}>Valores</Label>
                  <Select
                    id={`dup-mode-${i}`}
                    value={r.mode}
                    onChange={(e) => setRule(i, { mode: e.target.value as Rule['mode'] })}
                  >
                    <option value="equal">iguais</option>
                    <option value="different">diferentes</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`dup-scope-${i}`}>Quando</Label>
                  <Select
                    id={`dup-scope-${i}`}
                    value={r.scope}
                    onChange={(e) => setRule(i, { scope: e.target.value as Rule['scope'] })}
                  >
                    <option value="radius">em qualquer par do raio</option>
                    <option value="sameCoord">só na mesma coordenada</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`dup-w-${i}`}>Peso</Label>
                  <Input
                    id={`dup-w-${i}`}
                    type="number"
                    step="any"
                    value={r.weight}
                    onChange={(e) => setRule(i, { weight: e.target.value })}
                  />
                </div>
                <Button
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  aria-label={`Remover regra ${i + 1}`}
                  title="Remover regra"
                  onClick={() => setRules(rules.filter((_, k) => k !== i))}
                />
              </div>
              {ruleErrors[i] && <p className="mt-1 text-xs text-red-600">{ruleErrors[i]}</p>}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<Plus className="size-3.5" />}
              disabled={!columns.length || rules.length >= MAX_RULES}
              onClick={() =>
                setRules([...rules, { column: columns[0] ?? '', mode: 'equal', scope: 'radius', weight: '1' }])
              }
            >
              Adicionar regra
            </Button>
            {s.rules !== null && (
              <Button size="sm" variant="ghost" onClick={() => patch({ rules: null })}>
                Usar as regras sugeridas
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Valores comparados sem diferenciar maiúsculas e acentos; vazios não contam. Ex.: mesmo
            tipo_lampada, potencia e cadastrador somam chance; id_poste, transformador ou cod_poste
            diferentes na mesma coordenada indicam o mesmo poste coletado duas vezes com códigos
            diferentes (use peso negativo se, para você, indicarem pontos distintos).
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={s.useReference}
              disabled={!reference}
              onChange={(e) => patch({ useReference: e.target.checked })}
              className="accent-accent-600"
            />
            Associação com a camada de referência
          </label>
          {useReference && (
            <div className="space-y-3 rounded-md border border-slate-200 p-2">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <div>
                  <Label htmlFor="dup-ref" hint="ex.: Censo Anterior">
                    Camada de referência
                  </Label>
                  <Select
                    id="dup-ref"
                    value={reference?.id ?? ''}
                    onChange={(e) => patch({ referenceId: e.target.value })}
                  >
                    {list
                      .filter((x) => x.id !== layer?.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <NumberField
                  id="dup-refd"
                  label="Associar até"
                  hint="m"
                  className=""
                  value={s.referenceDistance}
                  error={refDistance === null ? `Entre 0 e ${fmtInt(MAX_REFERENCE_DISTANCE)} m.` : null}
                  onChange={(referenceDistance) => patch({ referenceDistance })}
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <NumberField
                  id="dup-both"
                  label="Os dois associados"
                  className="w-40"
                  value={s.bothMatched}
                  error={refWeights[0] === null ? WEIGHT_ERROR : null}
                  onChange={(bothMatched) => patch({ bothMatched })}
                />
                <NumberField
                  id="dup-one"
                  label="Só um associado"
                  className="w-40"
                  value={s.oneMatched}
                  error={refWeights[1] === null ? WEIGHT_ERROR : null}
                  onChange={(oneMatched) => patch({ oneMatched })}
                />
                <NumberField
                  id="dup-none"
                  label="Nenhum associado"
                  className="w-40"
                  value={s.noneMatched}
                  error={refWeights[2] === null ? WEIGHT_ERROR : null}
                  onChange={(noneMatched) => patch({ noneMatched })}
                />
              </div>
              <p className="text-xs text-slate-500">
                Cada ponto é associado 1 para 1 ao ponto mais próximo da referência (como em Associar
                Camadas). Os dois associados = cada um tem o seu ponto na referência, provavelmente são
                pontos distintos; só um associado = o outro pode ser a mesma coleta repetida.
              </p>

              <div className="border-t border-slate-100 pt-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={s.useDensity}
                    onChange={(e) => patch({ useDensity: e.target.checked })}
                    className="accent-accent-600"
                  />
                  Muitos pontos sem associação por perto (área nova: pontos próximos são esperados)
                </label>
                {useDensity && (
                  <div className="mt-2 flex flex-wrap items-start gap-3">
                    <NumberField
                      id="dup-dc"
                      label="A partir de"
                      hint="pontos"
                      className="w-28"
                      value={s.densityCount}
                      error={densityCount === null || !Number.isInteger(densityCount) ? 'Número inteiro ≥ 1.' : null}
                      onChange={(densityCount) => patch({ densityCount })}
                    />
                    <NumberField
                      id="dup-dr"
                      label="A até"
                      hint="m do par"
                      className="w-28"
                      value={s.densityRadius}
                      error={densityRadius === null ? `Entre 0 e ${fmtInt(MAX_RADIUS)} m.` : null}
                      onChange={(densityRadius) => patch({ densityRadius })}
                    />
                    <NumberField
                      id="dup-dw"
                      label="Peso"
                      value={s.densityWeight}
                      error={densityWeight === null ? WEIGHT_ERROR : null}
                      onChange={(densityWeight) => patch({ densityWeight })}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {result && summary && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>
                <span className="font-semibold text-slate-800">{fmtInt(summary.pairs)}</span> pares
                suspeitos
              </span>
              {summary.nearbyPairs > 0 && (
                <span>+ {fmtInt(summary.nearbyPairs)} outros candidatos abaixo da mínima</span>
              )}
              <span>{fmtInt(summary.points)} pontos suspeitos</span>
              <span>{fmtInt(summary.groups)} grupos</span>
              <span>{fmtInt(summary.sameCoordPairs)} na mesma coordenada</span>
              <span>
                {fmtInt(summary.total)} pontos em {summary.name}
              </span>
              {summary.matchedReference !== null && (
                <span>
                  {fmtInt(summary.matchedReference)} associados a {summary.referenceName}
                </span>
              )}
              {summary.withoutCoords > 0 && (
                <span className="text-amber-700">{fmtInt(summary.withoutCoords)} sem coordenadas</span>
              )}
            </div>
            {stale && (
              <p className="text-xs text-amber-700">
                Os parâmetros mudaram desde a última busca: clique em Buscar duplicidades para atualizar.
              </p>
            )}
            {summary.pairs > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<MapIcon className="size-3.5" />}
                  onClick={() => {
                    setPanelOpen(true);
                    close();
                  }}
                >
                  Ver lista no mapa
                </Button>
                <Button
                  size="sm"
                  icon={<MousePointerClick className="size-3.5" />}
                  onClick={() => {
                    selectDuplicatePoints(result.request.layer.sourceId, result.data.points);
                    close();
                  }}
                >
                  Selecionar os {fmtInt(summary.points)} pontos no mapa
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
