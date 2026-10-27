import { useMutation } from '@tanstack/react-query';
import { FileText, List, MousePointerClick, Ruler } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSourceSchema, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { csvBlob, selectPoints } from '@/lib/selectPoints';
import {
  analysisService,
  type AttributeDistanceRequest,
  type AttributeDistanceResult,
} from '@/services/analysis';
import { triggerDownload } from '@/services/export';
import { useAppStore } from '@/stores/appStore';
import { useToolListsStore } from '@/stores/toolListsStore';
import type { FilterDef } from '@/types';
import { fmtInt, fmtValue } from '@/utils/format';
import { boundsOfPoints, fmtDistance } from '@/utils/geo';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';
import { ToolTemplateBar } from './ToolTemplateBar';

const SETTINGS_KEY = 'geoanalisys-attribute-distance';
const MAX_DISTANCE = 1_000_000;
const PREVIEW = 15;

interface Settings {
  layerId: string;
  column: string;
  useReference: boolean;
  referenceId: string;
  referenceColumn: string;
  maxDistance: string;
  center: 'median' | 'mean';
  minPoints: string;
  stripZeros: boolean;
  /** Valores ignorados, separados por vírgula */
  ignore: string;
  useFilters: boolean;
}

const DEFAULTS: Settings = {
  ignore: 'SN, S/N, SEM, SEM IDENTIFICAÇÃO, 0, -, NA, N/A',
  layerId: '',
  column: '',
  useReference: true,
  referenceId: '',
  referenceColumn: '',
  maxDistance: '50',
  center: 'median',
  minPoints: '2',
  stripZeros: true,
  useFilters: false,
};

function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
  } catch {
    return {};
  }
}

const MEDIDOR = /medidor/i;

const names = (cols?: { name: string; kind: string }[]) =>
  (cols ?? []).filter((c) => c.kind !== 'geometry').map((c) => c.name);

/**
 * Ferramentas › Distância por atributo: pontos longe do ponto da referência com o mesmo valor (ex.:
 * medidor do Censo Atual × medidor_nc das Medições) ou, sem referência, longe do centro dos pontos da
 * própria camada com o mesmo valor.
 */
export default function AttributeDistanceDialog() {
  const closeDialog = useAppStore((st) => st.closeDialog);
  const activeId = useAppStore((st) => st.sourceId);
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

  const layer =
    list.find((x) => x.id === s.layerId) ??
    list.find((x) => /atual/i.test(`${x.name} ${x.tableName}`)) ??
    list.find((x) => x.id === activeId) ??
    list[0];
  const others = list.filter((x) => x.id !== layer?.id);
  const reference =
    others.find((x) => x.id === s.referenceId) ??
    others.find((x) => /medi[cç]/i.test(`${x.name} ${x.tableName}`)) ??
    others[0];
  const useReference = s.useReference && !!reference;

  const schema = useSourceSchema(layer?.id ?? null);
  const refSchema = useSourceSchema(useReference ? reference!.id : null);
  const columns = useMemo(() => names(schema.data?.columns), [schema.data]);
  const refColumns = useMemo(() => names(refSchema.data?.columns), [refSchema.data]);
  const column =
    (columns.includes(s.column) && s.column) || columns.find((c) => MEDIDOR.test(c)) || columns[0];
  const refColumn =
    (refColumns.includes(s.referenceColumn) && s.referenceColumn) ||
    refColumns.find((c) => c === column) ||
    refColumns.find((c) => MEDIDOR.test(c)) ||
    refColumns[0];

  const maxDistance = Number(s.maxDistance.replace(',', '.'));
  const distanceOk = s.maxDistance.trim() !== '' && maxDistance > 0 && maxDistance <= MAX_DISTANCE;
  const minPoints = Number(s.minPoints);
  const minPointsOk = Number.isInteger(minPoints) && minPoints >= 2 && minPoints <= 100_000;
  const ignore = s.ignore
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);

  const filtersOf = (sourceId: string): FilterDef[] => {
    if (!s.useFilters) return [];
    const st = useAppStore.getState();
    return sourceId === st.sourceId ? st.filters : (st.layerFilters[sourceId] ?? []);
  };
  const request: AttributeDistanceRequest | null =
    layer && column && distanceOk && (useReference ? !!refColumn : minPointsOk)
      ? {
          layer: { sourceId: layer.id, filters: filtersOf(layer.id), column },
          reference: useReference
            ? { sourceId: reference!.id, filters: filtersOf(reference!.id), column: refColumn! }
            : null,
          maxDistance,
          center: s.center,
          minPoints: minPointsOk ? minPoints : 2,
          stripZeros: s.stripZeros,
          ignore: ignore.slice(0, 200),
        }
      : null;

  const [result, setResult] = useState<{
    request: AttributeDistanceRequest;
    data: AttributeDistanceResult;
  } | null>(() => useToolListsStore.getState().attrDist);
  const run = useMutation({
    mutationFn: (req: AttributeDistanceRequest) => analysisService.attributeDistance(req),
    onSuccess: (data, req) => {
      setResult({ request: req, data });
      useToolListsStore.getState().setAttrDist({ request: req, data });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const close = () => closeDialog('attributeDistance');
  const summary = result?.data.summary;
  const stale = !!result && !!request && JSON.stringify(result.request) !== JSON.stringify(request);

  /** Lista por valor do atributo sobre o mapa (selecionar, ver e alterar atributos). */
  const listPoints = () => {
    if (!result) return;
    const st = useToolListsStore.getState();
    st.setAttrDist(result);
    st.setAttrDistOpen(true);
    close();
  };
  const selectFar = () => {
    if (!result) return;
    const pts = result.data.points;
    // Enquadra também o ponto de referência (ou centro) de cada um.
    const bounds = boundsOfPoints([...pts, ...pts.flatMap((p) => (p.target ? [p.target] : []))]);
    selectPoints(result.request.layer.sourceId, pts, bounds);
    toast.success(`${fmtInt(pts.length)} ponto(s) distante(s) selecionado(s).`);
    close();
  };
  const selectNoMatch = () => {
    if (!result) return;
    selectPoints(result.request.layer.sourceId, result.data.noMatch);
    toast.success(
      `${fmtInt(result.data.noMatch.length)} ponto(s) sem correspondente selecionado(s).`,
    );
    close();
  };
  const downloadCsv = () => {
    if (!result) return;
    const sm = result.data.summary;
    const withRef = sm.referenceName !== null;
    const headers = [
      'ID',
      sm.column,
      'Situação',
      'Distância (m)',
      withRef ? `ID ${sm.referenceName} mais próximo` : 'Referência',
      withRef ? `Pontos em ${sm.referenceName} com o valor` : 'Pontos com o mesmo valor',
      'Latitude',
      'Longitude',
      withRef ? 'Latitude da referência' : 'Latitude do centro',
      withRef ? 'Longitude da referência' : 'Longitude do centro',
    ];
    const rows: unknown[][] = [
      ...result.data.points.map((p) => [
        p.id,
        fmtValue(p.value),
        'Distante',
        p.distance,
        p.target?.id ??
          (result.request.center === 'median' ? 'Centro (mediana)' : 'Centro (média)'),
        p.sameValue,
        p.lat,
        p.lng,
        p.target?.lat ?? null,
        p.target?.lng ?? null,
      ]),
      ...result.data.noMatch.map((p) => [
        p.id,
        fmtValue(p.value),
        `Sem correspondente em ${sm.referenceName}`,
        null,
        null,
        0,
        p.lat,
        p.lng,
        null,
        null,
      ]),
    ];
    const href = URL.createObjectURL(csvBlob(headers, rows));
    const name = `distancia_${sm.column}_${sm.name}`.replace(/[^\w.-]+/g, '_');
    triggerDownload(href, `${name}.csv`);
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };

  const columnSelect = (
    id: string,
    value: string | undefined,
    options: string[],
    onChange: (v: string) => void,
  ) => (
    <Select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={!options.length}
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </Select>
  );

  return (
    <Dialog
      open
      size="lg"
      title="Distância por atributo"
      description="Pontos mais distantes que a distância informada do ponto que tem o mesmo valor de atributo em outra camada (ex.: medidor do Censo Atual × medidor_nc das Medições) ou, sem essa camada, do centro dos pontos da própria camada com o mesmo valor."
      onClose={close}
      footer={
        <>
          <Button className="mr-auto" onClick={close}>
            Fechar
          </Button>
          <Button
            variant="primary"
            icon={<Ruler className="size-4" />}
            loading={run.isPending}
            disabled={!request}
            onClick={() => request && run.mutate(request)}
          >
            Buscar pontos distantes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ToolTemplateBar
          tool="attribute-distance"
          settings={s}
          onApply={(saved) => setS({ ...DEFAULTS, ...saved })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ad-layer" hint="ex.: Censo Atual">
              Camada analisada
            </Label>
            <Select
              id="ad-layer"
              value={layer?.id ?? ''}
              onChange={(e) => patch({ layerId: e.target.value })}
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
            <Label htmlFor="ad-col" hint="ex.: medidor">
              Atributo
            </Label>
            {columnSelect('ad-col', column, columns, (v) => patch({ column: v }))}
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-slate-600">Comparar com</legend>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="ad-mode"
              checked={useReference}
              disabled={!reference}
              onChange={() => patch({ useReference: true })}
              className="mt-1 accent-accent-600"
            />
            <span>
              O ponto com o mesmo valor em outra camada
              <span className="block text-xs text-slate-500">
                Distância até o ponto da referência com o mesmo valor (se houver vários, o mais
                próximo).
              </span>
            </span>
          </label>
          {useReference && (
            <div className="ml-6 grid gap-3 rounded-md border border-slate-200 p-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="ad-ref" hint="ex.: Medições">
                  Camada de referência
                </Label>
                <Select
                  id="ad-ref"
                  value={reference?.id ?? ''}
                  onChange={(e) => patch({ referenceId: e.target.value })}
                >
                  {others.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ad-refcol" hint="ex.: medidor_nc">
                  Atributo na referência
                </Label>
                {columnSelect('ad-refcol', refColumn, refColumns, (v) =>
                  patch({ referenceColumn: v }),
                )}
              </div>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="ad-mode"
              checked={!useReference}
              onChange={() => patch({ useReference: false })}
              className="mt-1 accent-accent-600"
            />
            <span>
              O centro dos pontos da própria camada com o mesmo valor
              <span className="block text-xs text-slate-500">
                Sem camada de referência: o local do valor é estimado pelos próprios pontos.
              </span>
            </span>
          </label>
          {!useReference && (
            <div className="ml-6 grid gap-3 rounded-md border border-slate-200 p-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="ad-center">Centro</Label>
                <Select
                  id="ad-center"
                  value={s.center}
                  onChange={(e) => patch({ center: e.target.value as Settings['center'] })}
                >
                  <option value="median">Mediana (recomendado)</option>
                  <option value="mean">Média</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="ad-min" hint="com o mesmo valor">
                  Mínimo de pontos
                </Label>
                <Input
                  id="ad-min"
                  type="number"
                  min={2}
                  step={1}
                  value={s.minPoints}
                  onChange={(e) => patch({ minPoints: e.target.value })}
                />
                {!minPointsOk && <p className="mt-1 text-xs text-red-600">Inteiro ≥ 2.</p>}
              </div>
              <p className="text-xs text-slate-500 sm:col-span-2">
                A mediana não é puxada pelos pontos distantes (com 3 ou mais pontos, o que está
                longe aparece sozinho); a média é. Com só 2 pontos, o centro é o meio deles: os dois
                aparecem se estiverem longe um do outro.
              </p>
            </div>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <div>
            <Label htmlFor="ad-dist" hint="m">
              Distância máxima
            </Label>
            <Input
              id="ad-dist"
              type="number"
              min={0}
              step="any"
              value={s.maxDistance}
              onChange={(e) => patch({ maxDistance: e.target.value })}
            />
            {!distanceOk && <p className="mt-1 text-xs text-red-600">Número maior que 0.</p>}
          </div>
          <div className="space-y-1.5 pt-5 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={s.stripZeros}
                onChange={(e) => patch({ stripZeros: e.target.checked })}
                className="accent-accent-600"
              />
              Ignorar zeros à esquerda (000123 = 123)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={s.useFilters}
                onChange={(e) => patch({ useFilters: e.target.checked })}
                className="accent-accent-600"
              />
              Aplicar os filtros salvos de cada camada
            </label>
          </div>
        </div>
        <div>
          <Label htmlFor="ad-ignore" hint="separados por vírgula">
            Ignorar os valores
          </Label>
          <Input
            id="ad-ignore"
            value={s.ignore}
            onChange={(e) => patch({ ignore: e.target.value })}
            placeholder="SN, S/N, 0"
          />
          <p className="mt-1 text-xs text-slate-500">
            Valores de preenchimento (ex.: SN = sem número) não identificam um local: sem isso,
            todos os pontos com SN seriam comparados entre si. Valores comparados sem diferenciar
            maiúsculas e acentos; pontos sem valor não entram.
          </p>
        </div>

        {result && summary && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>
                <span className="font-semibold text-slate-800">{fmtInt(summary.far)}</span> a mais
                de {fmtDistance(result.request.maxDistance)}
              </span>
              <span>{fmtInt(summary.evaluated)} comparados</span>
              {summary.referenceName !== null && summary.noMatch > 0 && (
                <span className="text-amber-700">
                  {fmtInt(summary.noMatch)} com {summary.column} que não existe em{' '}
                  {summary.referenceName}.{summary.referenceColumn}
                </span>
              )}
              {summary.fewPoints > 0 && (
                <span>
                  {fmtInt(summary.fewPoints)} com menos pontos que o mínimo no mesmo valor
                </span>
              )}
              {summary.withoutValue > 0 && <span>{fmtInt(summary.withoutValue)} sem valor</span>}
              {summary.ignored > 0 && (
                <span>{fmtInt(summary.ignored)} com valor ignorado (ex.: SN)</span>
              )}
              {summary.withoutCoords > 0 && (
                <span className="text-amber-700">
                  {fmtInt(summary.withoutCoords)} sem coordenadas
                </span>
              )}
              <span>
                {fmtInt(summary.total)} pontos em {summary.name}
              </span>
            </div>
            {stale && (
              <p className="text-xs text-amber-700">
                Os parâmetros mudaram desde a última busca: clique em Buscar pontos distantes para
                atualizar.
              </p>
            )}
            {result.data.points.length > 0 && (
              <>
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1 font-medium">ID</th>
                      <th className="py-1 font-medium">{summary.column}</th>
                      <th className="py-1 font-medium">
                        {summary.referenceName
                          ? `${summary.referenceName} mais próximo`
                          : 'Comparado com'}
                      </th>
                      <th className="py-1 text-right font-medium">Distância</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {result.data.points.slice(0, PREVIEW).map((p) => (
                      <tr key={p.id}>
                        <td className="py-1 font-mono">{p.id}</td>
                        <td className="max-w-40 truncate py-1">{fmtValue(p.value)}</td>
                        <td className="py-1 text-slate-600">
                          {p.target?.id ?? `centro de ${fmtInt(p.sameValue)} pontos`}
                        </td>
                        <td className="py-1 text-right tabular-nums">{fmtDistance(p.distance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.data.points.length > PREVIEW && (
                  <p className="text-xs text-slate-500">
                    … e mais {fmtInt(result.data.points.length - PREVIEW)} (do mais distante para o
                    mais próximo).
                  </p>
                )}
              </>
            )}
            <div className="flex flex-wrap gap-2">
              {result.data.points.length + result.data.noMatch.length > 0 && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<List className="size-3.5" />}
                  onClick={listPoints}
                  title="Lista por valor do atributo sobre o mapa: selecionar, ver e alterar atributos"
                >
                  Listar pontos
                </Button>
              )}
              {result.data.points.length > 0 && (
                <Button
                  size="sm"
                  icon={<MousePointerClick className="size-3.5" />}
                  onClick={selectFar}
                >
                  Selecionar os {fmtInt(result.data.points.length)} pontos distantes
                </Button>
              )}
              {result.data.noMatch.length > 0 && (
                <Button
                  size="sm"
                  icon={<MousePointerClick className="size-3.5" />}
                  onClick={selectNoMatch}
                >
                  Selecionar os {fmtInt(result.data.noMatch.length)} sem correspondente
                </Button>
              )}
              {result.data.points.length + result.data.noMatch.length > 0 && (
                <Button size="sm" icon={<FileText className="size-3.5" />} onClick={downloadCsv}>
                  Baixar CSV
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
