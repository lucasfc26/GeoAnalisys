import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { queryKeys, useActiveSource, useCrsList } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { kmlFileToGeoJson } from '@/lib/kml';
import {
  TEMP_SCHEMA,
  layersService,
  withTempSchema,
  type ImportPreview,
  type ImportType,
} from '@/services/layers';
import { pointsService } from '@/services/points';
import { databaseService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import { fmtInt, fmtValue } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

const TYPE_LABEL: Record<ImportType, string> = {
  text: 'Texto',
  integer: 'Inteiro',
  number: 'Decimal',
};
const ACCEPT = '.csv,.txt,.tsv,.xlsx,.xlsm,.geojson,.json,.kml';
const baseName = (f: string) => f.replace(/\.[^.]+$/, '');

/**
 * Importa um CSV/XLSX (uma aba), GeoJSON ou KML como nova camada: vira uma tabela no banco, igual às
 * demais. KML é convertido para GeoJSON aqui antes do envio.
 */
export default function ImportLayerDialog() {
  const closeDialog = useAppStore((s) => s.closeDialog);
  const setSource = useAppStore((s) => s.setSource);
  const focusMap = useAppStore((s) => s.focusMap);
  const { source: active } = useActiveSource();
  const crsList = useCrsList();
  const schemas = useQuery({
    queryKey: ['db-schemas'],
    queryFn: databaseService.schemas,
    staleTime: 60_000,
  });
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  /** Arquivo enviado (KML já convertido para GeoJSON) e o nome original escolhido. */
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [name, setName] = useState('');
  const [schema, setSchema] = useState('');
  const [idColumn, setIdColumn] = useState('');
  const [xColumn, setXColumn] = useState('');
  const [yColumn, setYColumn] = useState('');
  /** 'xy' = X e Y em colunas separadas; 'pair' = as duas na mesma célula */
  const [coordMode, setCoordMode] = useState<'xy' | 'pair'>('xy');
  const [coordColumn, setCoordColumn] = useState('');
  const [convertCoords, setConvertCoords] = useState(true);
  const [crs, setCrs] = useState('');
  const [labelColumn, setLabelColumn] = useState('');
  const [categoryColumn, setCategoryColumn] = useState('');
  const [types, setTypes] = useState<Record<string, ImportType>>({});

  // Padrão: GeoAnalisysTemp (tabela apagada ao remover a camada do mapa).
  const schemaValue = schema || TEMP_SCHEMA;

  /** Lê o arquivo (ou outra aba) e aplica as sugestões de colunas. */
  const read = async (f: File, sheet?: string | null) => {
    setReading(true);
    try {
      const p = await layersService.preview(f, sheet);
      setPreview(p);
      setTypes(Object.fromEntries(p.headers.map((h, i) => [h, p.types[i]])));
      setIdColumn(p.suggested.idColumn ?? '');
      setXColumn(p.suggested.xColumn ?? '');
      setYColumn(p.suggested.yColumn ?? '');
      setCoordColumn(p.suggested.coordColumn ?? '');
      setCoordMode(p.suggested.coordColumn ? 'pair' : 'xy');
      setLabelColumn('');
      setCategoryColumn('');
      if (p.suggested.coordinateSystem) setCrs(p.suggested.coordinateSystem);
      else if (p.suggested.coordinates === 'geographic') setCrs('EPSG:4674');
      else if (!crs)
        setCrs(
          active?.coordinateSystem && active.coordinateSystem !== 'CUSTOM'
            ? active.coordinateSystem
            : 'EPSG:31984',
        );
      setName(
        p.sheets.length > 1 && p.sheet ? `${baseName(f.name)} - ${p.sheet}` : baseName(f.name),
      );
    } catch (err) {
      toast.error(errorMessage(err));
      setPreview(null);
    } finally {
      setReading(false);
    }
  };

  const run = useMutation({
    mutationFn: () =>
      layersService.import(file!, {
        sheet: preview?.sheet ?? null,
        name: name.trim(),
        schema: schemaValue,
        idColumn: idColumn || null,
        xColumn: coordMode === 'xy' ? xColumn : null,
        yColumn: coordMode === 'xy' ? yColumn : null,
        coordColumn: coordMode === 'pair' ? coordColumn : null,
        convertCoordinates: convertCoords,
        coordinateSystem: crs,
        labelColumn: labelColumn || null,
        categoryColumn: categoryColumn || null,
        types,
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: queryKeys.sources });
      qc.invalidateQueries({ queryKey: ['db-schemas'] });
      setSource(r.source.id);
      const bad = Object.entries(r.invalid);
      toast.success(
        `Camada "${r.source.name}" criada com ${fmtInt(r.rows)} registro(s) (tabela ${r.source.schema}.${r.tableName}).`,
      );
      if (bad.length) {
        toast.info(
          `Valores que não eram do tipo escolhido ficaram vazios: ${bad.map(([c, n]) => `${c} (${fmtInt(n)})`).join(', ')}.`,
        );
      }
      pointsService
        .extent(r.source.id, [])
        .then((e) => e.bounds && focusMap({ bounds: e.bounds }))
        .catch(() => undefined);
      closeDialog('importLayer');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const headers = preview?.headers ?? [];
  const ready =
    !!file &&
    !!preview &&
    !!name.trim() &&
    !!schemaValue &&
    (coordMode === 'pair' ? !!coordColumn : !!xColumn && !!yColumn && xColumn !== yColumn) &&
    !!crs;
  const crsKind = crsList.data?.find((c) => c.code === crs)?.kind;
  const coordCols = coordMode === 'pair' ? [coordColumn] : [xColumn, yColumn];
  const colOptions = (allowEmpty: string | null) => (
    <>
      {allowEmpty !== null && <option value="">{allowEmpty}</option>}
      {headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </>
  );

  return (
    <Dialog
      open
      size="xl"
      title="Importar camada (CSV, XLSX, GeoJSON ou KML)"
      description="O arquivo vira uma tabela no banco e uma camada no mapa, igual às que já vêm do banco."
      onClose={() => closeDialog('importLayer')}
      footer={
        <>
          <Button onClick={() => closeDialog('importLayer')}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={() => run.mutate()}
            loading={run.isPending}
            disabled={!ready}
          >
            Importar {preview ? `${fmtInt(preview.total)} registro(s)` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Arquivo</Label>
            <Button
              icon={<FileUp className="size-4" />}
              onClick={() => inputRef.current?.click()}
              disabled={reading}
            >
              {file ? 'Trocar arquivo' : 'Escolher arquivo…'}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                let upload = f;
                if (/\.kml$/i.test(f.name)) {
                  try {
                    upload = await kmlFileToGeoJson(f);
                  } catch (err) {
                    toast.error(errorMessage(err));
                    return;
                  }
                }
                setFile(upload);
                setFileName(f.name);
                void read(upload);
              }}
            />
          </div>
          {file && <span className="pb-2 text-sm text-slate-700">{fileName}</span>}
          {reading && <Loader2 className="mb-2 size-4 animate-spin text-accent-600" />}
          {preview && preview.sheets.length > 0 && (
            <div className="min-w-48">
              <Label htmlFor="imp-sheet">Aba (sheet)</Label>
              <Select
                id="imp-sheet"
                value={preview.sheet ?? ''}
                onChange={(e) => file && void read(file, e.target.value)}
                disabled={reading}
              >
                {preview.sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {!preview ? (
          <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Escolha um arquivo .csv, .xlsx, .geojson ou .kml. Planilhas: a primeira linha deve ter
            os nomes das colunas; CSV separado por ; , tabulação ou |, com vírgula decimal ou ponto.
            GeoJSON/KML: cada feição vira um registro com seus atributos; linhas e polígonos viram
            um ponto (meio da linha / centro do polígono).
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label htmlFor="imp-name">Nome da camada</Label>
                <Input
                  id="imp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div>
                <Label htmlFor="imp-schema" hint="onde a tabela é criada">
                  Schema
                </Label>
                <Select
                  id="imp-schema"
                  value={schemaValue}
                  onChange={(e) => setSchema(e.target.value)}
                >
                  {withTempSchema(schemas.data).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-[11px] text-slate-500">
                  {schemaValue === TEMP_SCHEMA
                    ? 'Temporária: a tabela é apagada ao remover a camada do mapa.'
                    : 'Permanente: remover a camada do mapa não apaga a tabela.'}
                </p>
              </div>
              <div>
                <Label htmlFor="imp-id">Coluna de ID (registro principal)</Label>
                <Select id="imp-id" value={idColumn} onChange={(e) => setIdColumn(e.target.value)}>
                  {colOptions('(gerar ID automático)')}
                </Select>
              </div>
              <div>
                <Label htmlFor="imp-mode">Coordenadas</Label>
                <Select
                  id="imp-mode"
                  value={coordMode}
                  onChange={(e) => setCoordMode(e.target.value as 'xy' | 'pair')}
                >
                  <option value="xy">X e Y em colunas separadas</option>
                  <option value="pair">X e Y juntos numa coluna</option>
                </Select>
              </div>
              {coordMode === 'xy' ? (
                <>
                  <div>
                    <Label htmlFor="imp-x">Coluna X (leste / longitude)</Label>
                    <Select id="imp-x" value={xColumn} onChange={(e) => setXColumn(e.target.value)}>
                      {colOptions('— escolha —')}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="imp-y">Coluna Y (norte / latitude)</Label>
                    <Select id="imp-y" value={yColumn} onChange={(e) => setYColumn(e.target.value)}>
                      {colOptions('— escolha —')}
                    </Select>
                  </div>
                </>
              ) : (
                <div className="sm:col-span-2">
                  <Label htmlFor="imp-pair" hint='ex.: "-3,84, -38,40" ou "566160 9575107"'>
                    Coluna com as coordenadas
                  </Label>
                  <Select
                    id="imp-pair"
                    value={coordColumn}
                    onChange={(e) => setCoordColumn(e.target.value)}
                  >
                    {colOptions('— escolha —')}
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="imp-crs">Sistema de coordenadas</Label>
                <Select id="imp-crs" value={crs} onChange={(e) => setCrs(e.target.value)}>
                  {(crsList.data ?? [])
                    .filter((c) => c.code !== 'CUSTOM')
                    .map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="imp-label" hint="opcional">
                  Coluna de rótulo
                </Label>
                <Select
                  id="imp-label"
                  value={labelColumn}
                  onChange={(e) => setLabelColumn(e.target.value)}
                >
                  {colOptions('(nenhuma)')}
                </Select>
              </div>
              <div>
                <Label htmlFor="imp-cat" hint="opcional">
                  Coluna de categoria
                </Label>
                <Select
                  id="imp-cat"
                  value={categoryColumn}
                  onChange={(e) => setCategoryColumn(e.target.value)}
                >
                  {colOptions('(nenhuma)')}
                </Select>
              </div>
            </div>
            {coordMode === 'xy' && xColumn && xColumn === yColumn && (
              <p className="text-xs text-red-600">X e Y devem ser colunas diferentes.</p>
            )}
            <div className="space-y-1 rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
              <p>
                Formatos reconhecidos: decimal com vírgula ou ponto (-3,8438 · 566160,53), graus,
                minutos e segundos (3º 50' 37,9" S · 38°24'14.8"W · S 3 50 37), graus e minutos (3°
                50,63' S) e, na mesma célula, pares separados por vírgula, ponto e vírgula, espaço
                ou barra, além de POINT(x y). Textos em graus ficam como estão e o valor decimal vai
                para colunas novas.
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={convertCoords}
                  onChange={(e) => setConvertCoords(e.target.checked)}
                />
                {crsKind === 'geographic'
                  ? 'Gravar também UTM X, UTM Y e a zona UTM de cada ponto (colunas utm_x, utm_y, utm_zona)'
                  : crsKind === 'utm'
                    ? 'Gravar também latitude e longitude de cada ponto (colunas latitude, longitude)'
                    : 'Gravar também as coordenadas convertidas (latitude/longitude e UTM)'}
              </label>
            </div>

            <div>
              <p className="mb-1.5 text-xs text-slate-500">
                Prévia ({fmtInt(Math.min(preview.rows.length, 10))} de {fmtInt(preview.total)}{' '}
                linhas) — confira o tipo de cada coluna; valores que não forem do tipo escolhido
                ficam vazios.
              </p>
              <div className="scroll-thin max-h-72 overflow-auto rounded-md border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      {headers.map((h) => (
                        <th
                          key={h}
                          className="px-2 py-1.5 align-top font-semibold whitespace-nowrap text-slate-700"
                        >
                          <div>{h}</div>
                          {coordCols.includes(h) ? (
                            <span className="text-[11px] font-normal text-amber-700">
                              coordenada
                            </span>
                          ) : (
                            <select
                              value={types[h] ?? 'text'}
                              onChange={(e) =>
                                setTypes((t) => ({ ...t, [h]: e.target.value as ImportType }))
                              }
                              className="mt-0.5 h-6 rounded border border-slate-300 bg-white text-[11px] font-normal"
                              aria-label={`Tipo da coluna ${h}`}
                            >
                              {(Object.keys(TYPE_LABEL) as ImportType[]).map((t) => (
                                <option key={t} value={t}>
                                  {TYPE_LABEL[t]}
                                </option>
                              ))}
                            </select>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {preview.rows.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        {headers.map((h, c) => (
                          <td
                            key={h}
                            className="max-w-48 truncate px-2 py-1"
                            title={r[c] === null ? '' : String(r[c])}
                          >
                            {r[c] === null ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              fmtValue(r[c])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
