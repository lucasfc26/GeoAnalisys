import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { queryKeys, useSourceSchema } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import {
  layersService,
  type AppendJob,
  type ImportPreview,
  type ImportType,
} from '@/services/layers';
import type { ColumnKind, ColumnMeta, DataSource } from '@/types';
import { smartPair, type MatchColumn } from '@/utils/attributeMatch';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Label, Select } from '../ui/Field';
import { ErrorState, Skeleton } from '../ui/States';
import { toast } from '../ui/Toaster';

const ACCEPT = '.csv,.txt,.tsv,.xlsx,.xlsm';
const POLL_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENCODINGS = [
  { id: 'auto', label: 'Detectar automaticamente' },
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'iso-8859-1', label: 'ISO-8859-1 (Latin-1)' },
  { id: 'windows-1252', label: 'Windows-1252 (ANSI)' },
  { id: 'iso-8859-15', label: 'ISO-8859-15' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
];

const isTextFile = (name: string) => /\.(csv|txt|tsv)$/i.test(name);

const fmtSize = (bytes: number) =>
  bytes >= 1 << 30
    ? `${(bytes / (1 << 30)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`
    : `${(bytes / (1 << 20)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

/** Colunas que o banco deixa preencher (geometria, identidade sempre e geradas ficam de fora). */
function writableOf(columns: ColumnMeta[]) {
  return columns.filter((c) => !c.readOnly && c.kind !== 'geometry' && c.kind !== 'other');
}

const fileKind = (t: ImportType): ColumnKind =>
  t === 'integer' ? 'integer' : t === 'number' ? 'number' : 'text';

/** Liga cada coluna da tabela à coluna do arquivo mais parecida (nome, abreviação e coordenada). */
function suggestMap(
  headers: string[],
  types: ImportType[],
  rows: ImportPreview['rows'],
  columns: ColumnMeta[],
): Record<string, string> {
  const fileCols: MatchColumn[] = headers.map((name, i) => ({
    name,
    kind: fileKind(types[i] ?? 'text'),
  }));
  const tableCols: MatchColumn[] = columns.map((c) => ({ name: c.name, kind: c.kind }));
  const fileRows = rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
  return Object.fromEntries(
    smartPair(fileCols, tableCols, fileRows, []).map((m) => [m.target, m.source]),
  );
}

function ProgressBar({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-600">
        <span>{label}</span>
        {value !== null && <span className="tabular-nums">{Math.round(value * 100)}%</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className={
            value === null
              ? 'h-full w-1/3 animate-pulse rounded-full bg-accent-500'
              : 'h-full rounded-full bg-accent-600 transition-[width] duration-500'
          }
          style={value === null ? undefined : { width: `${Math.max(value * 100, 1)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Acrescenta (ou substitui) linhas de um CSV/TXT/XLSX na tabela da fonte já configurada,
 * associando cada coluna da tabela a uma coluna do arquivo.
 */
export function AppendSourceDialog({ source, onClose }: { source: DataSource; onClose: () => void }) {
  const qc = useQueryClient();
  const schema = useSourceSchema(source.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortUpload = useRef<(() => void) | null>(null);
  const jobRef = useRef<string | null>(null);

  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [job, setJob] = useState<AppendJob | null>(null);
  const [encoding, setEncoding] = useState('auto');
  const [truncate, setTruncate] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState('');

  useEffect(
    () => () => {
      abortUpload.current?.();
      if (jobRef.current) void layersService.cancelAppend(jobRef.current).catch(() => undefined);
    },
    [],
  );

  const columns = useMemo(() => writableOf(schema.data?.columns ?? []), [schema.data]);
  const headers = preview?.headers ?? [];
  const textFile = isTextFile(fileName);
  const fileKey = preview ? `${preview.uploadId}|${preview.sheet ?? ''}|${headers.join('\u0001')}` : '';

  useEffect(() => {
    if (!preview || !columns.length || applied === fileKey) return;
    setApplied(fileKey);
    setMapping(suggestMap(preview.headers, preview.types, preview.rows, columns));
  }, [applied, columns, fileKey, preview]);

  const sendEncoding = () => (textFile && encoding !== 'auto' ? encoding : null);

  const readSheet = async (uploadId: string, sheet: string | null, enc: string | null) => {
    setReading(true);
    try {
      setPreview(await layersService.preview(uploadId, sheet, enc));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReading(false);
    }
  };

  const readFile = async (f: File, enc: string) => {
    setReading(true);
    setUploading(0);
    const up = layersService.upload(f, setUploading, isTextFile(f.name) && enc !== 'auto' ? enc : null);
    abortUpload.current = up.abort;
    try {
      const p = await up.promise;
      setFileName(f.name);
      setPreview(p);
    } catch (err) {
      toast.error(errorMessage(err));
      setPreview(null);
    } finally {
      abortUpload.current = null;
      setUploading(null);
      setReading(false);
    }
  };

  const busy = reading || uploading !== null || !!job;
  const missing = columns.filter((c) => !c.nullable && !c.hasDefault && !mapping[c.name]);
  const mapped = columns.filter((c) => mapping[c.name] && headers.includes(mapping[c.name]));
  const ready = !!preview && mapped.length > 0 && missing.length === 0 && !busy && !schema.isLoading;

  const assimilate = () => {
    if (!preview) return;
    const next = suggestMap(preview.headers, preview.types, preview.rows, columns);
    const n = Object.keys(next).length;
    setMapping(next);
    toast.success(
      n
        ? `${fmtInt(n)} de ${fmtInt(columns.length)} coluna(s) assimilada(s). Confira antes de importar.`
        : 'Nenhuma coluna parecida. Escolha os pares manualmente.',
    );
  };

  const run = useMutation({
    mutationFn: async () => {
      const p = preview!;
      const chosen = Object.fromEntries(mapped.map((c) => [c.name, mapping[c.name]]));
      const { jobId } = await layersService.startAppend(source.id, {
        uploadId: p.uploadId,
        sheet: p.sheet,
        encoding: sendEncoding(),
        truncate,
        mapping: chosen,
      });
      jobRef.current = jobId;
      setJob({ id: jobId, phase: 'reading', rows: 0, percent: 0 });
      try {
        for (;;) {
          await sleep(POLL_MS);
          const s = await layersService.appendStatus(jobId);
          setJob(s);
          if (s.phase === 'done' && s.result) return s.result;
          if (s.phase === 'error') throw new Error(s.error ?? 'Erro ao importar');
          if (s.phase === 'cancelled') throw new Error('Importação cancelada.');
        }
      } finally {
        jobRef.current = null;
        setJob(null);
      }
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: queryKeys.points(source.id) });
      const verb = r.truncated ? 'substituído(s)' : 'acrescentado(s)';
      toast.success(`${fmtInt(r.rows)} registro(s) ${verb} em ${source.schema}.${source.tableName}.`);
      const bad = Object.entries(r.invalid);
      if (bad.length) {
        toast.info(
          `Valores que não cabiam no tipo da coluna ficaram vazios: ${bad
            .map(([c, n]) => `${c} (${fmtInt(n)})`)
            .join(', ')}.`,
        );
      }
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const example = (header: string) => {
    const i = headers.indexOf(header);
    if (i < 0 || !preview) return '';
    const v = preview.rows.find((row) => row[i] !== null && row[i] !== '')?.[i];
    return v == null ? '' : String(v);
  };

  return (
    <Dialog
      open
      size="xl"
      title={`Importar dados em ${source.name}`}
      description={`Grava linhas de um CSV, TXT, XLSX ou XLSM na tabela ${source.schema}.${source.tableName}. A primeira linha do arquivo é o nome das colunas.`}
      onClose={onClose}
      footer={
        <>
          {job ? (
            <Button onClick={() => void layersService.cancelAppend(job.id).catch(() => undefined)}>
              Parar importação
            </Button>
          ) : uploading !== null ? (
            <Button onClick={() => abortUpload.current?.()}>Cancelar envio</Button>
          ) : (
            <Button onClick={onClose}>Fechar</Button>
          )}
          <Button
            variant={truncate ? 'danger' : 'primary'}
            onClick={() => run.mutate()}
            loading={run.isPending}
            disabled={!ready}
          >
            {truncate ? 'Apagar e importar' : 'Acrescentar dados'}
            {preview?.total != null ? ` (${fmtInt(preview.total)})` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {uploading !== null && <ProgressBar value={uploading} label="Enviando o arquivo…" />}
        {uploading === null && reading && <ProgressBar value={null} label="Lendo as primeiras linhas…" />}
        {job && (
          <ProgressBar
            value={job.percent}
            label={`Importando… ${fmtInt(job.rows)} registro(s) gravado(s)`}
          />
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Arquivo</Label>
            <Button
              icon={<FileUp className="size-4" />}
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {fileName ? 'Trocar arquivo' : 'Escolher arquivo…'}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void readFile(f, encoding);
              }}
            />
          </div>
          {fileName && (
            <span className="pb-2 text-sm text-slate-700">
              {fileName}
              {preview && !reading && (
                <span className="ml-2 text-xs text-slate-500">{fmtSize(preview.size)}</span>
              )}
            </span>
          )}
          {reading && <Loader2 className="mb-2 size-4 animate-spin text-accent-600" />}
          {preview && preview.sheets.length > 0 && (
            <div className="min-w-48">
              <Label htmlFor="append-sheet">Aba</Label>
              <Select
                id="append-sheet"
                value={preview.sheet ?? ''}
                disabled={busy}
                onChange={(e) => void readSheet(preview.uploadId, e.target.value, sendEncoding())}
              >
                {preview.sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="min-w-56">
            <Label htmlFor="append-enc" hint={textFile ? undefined : 'planilha já traz o texto'}>
              Codificação
            </Label>
            <Select
              id="append-enc"
              value={textFile ? encoding : 'auto'}
              disabled={busy || !textFile}
              onChange={(e) => {
                const next = e.target.value;
                setEncoding(next);
                if (preview && textFile) {
                  void readSheet(preview.uploadId, preview.sheet, next === 'auto' ? null : next);
                }
              }}
            >
              {ENCODINGS.map((enc) => (
                <option key={enc.id} value={enc.id}>
                  {enc.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={truncate}
            disabled={busy}
            onChange={(e) => setTruncate(e.target.checked)}
          />
          <span>
            Truncar a tabela antes de importar
            <span className="mt-0.5 block text-xs text-slate-500">
              Apaga os registros atuais de {source.schema}.{source.tableName} e grava só o arquivo.
              Sem esta opção, as linhas novas são acrescentadas.
            </span>
          </span>
        </label>

        {schema.isLoading && <Skeleton className="h-24" />}
        {schema.isError && <ErrorState compact error={schema.error} onRetry={() => schema.refetch()} />}

        {!preview && !schema.isLoading && (
          <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Escolha um .csv, .txt, .xlsx ou .xlsm. CSV e TXT aceitam UTF-8, ISO-8859-1 e Windows-1252;
            o separador (; , tabulação ou |) é detectado na primeira linha.
          </p>
        )}

        {preview && !schema.isLoading && columns.length === 0 && (
          <p className="text-sm text-slate-500">
            Esta tabela não tem colunas que possam receber dados (só geometria ou colunas calculadas).
          </p>
        )}

        {preview && columns.length > 0 && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-800">Assimilação das colunas</p>
                <p className="text-xs text-slate-500">
                  {fmtInt(mapped.length)} de {fmtInt(columns.length)} coluna(s) da tabela ligada(s) ao arquivo.
                  Colunas calculadas e de geometria não entram.
                </p>
              </div>
              <Button
                size="sm"
                icon={<Sparkles className="size-3.5" />}
                onClick={assimilate}
                disabled={busy}
              >
                Assimilação inteligente
              </Button>
            </div>
            {missing.length > 0 && (
              <p className="text-xs text-red-600">
                Colunas obrigatórias sem par: {missing.map((c) => c.name).join(', ')}.
              </p>
            )}
            <div className="scroll-thin max-h-80 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Coluna da tabela</th>
                    <th className="px-2 py-1.5 font-medium">Tipo</th>
                    <th className="px-2 py-1.5 font-medium">Coluna do arquivo</th>
                    <th className="px-2 py-1.5 font-medium">Exemplo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {columns.map((c) => {
                    const fileCol = mapping[c.name] ?? '';
                    const required = !c.nullable && !c.hasDefault;
                    return (
                      <tr key={c.name}>
                        <td className="px-2 py-1 font-medium text-slate-800">
                          {c.name}
                          {required && <span className="ml-1 text-red-500">*</span>}
                        </td>
                        <td className="px-2 py-1 text-slate-500">{c.formatType}</td>
                        <td className="px-2 py-1">
                          <Select
                            value={headers.includes(fileCol) ? fileCol : ''}
                            disabled={busy}
                            onChange={(e) =>
                              setMapping((m) => ({ ...m, [c.name]: e.target.value }))
                            }
                            aria-label={`Arquivo para ${c.name}`}
                          >
                            <option value="">{required ? 'Selecione…' : '— não importar —'}</option>
                            {headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="max-w-48 truncate px-2 py-1 text-slate-500">
                          {fileCol ? example(fileCol) : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
