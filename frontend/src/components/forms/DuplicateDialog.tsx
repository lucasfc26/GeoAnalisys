import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Copy, Eraser, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { queryKeys, useActiveSource, useSelectedIds, useSourceSchema } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import { smartPair, type AttributeMatch } from '@/utils/attributeMatch';
import { fmtInt, fmtValue } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Label, RadioCard, Select } from '../ui/Field';
import { toast } from '../ui/Toaster';

const MODE_KEY = 'geoanalisys-duplicate-mode';
const MAPPING_KEY = 'geoanalisys-duplicate-mapping';
/** Registros usados como amostra de valores no Pareamento Inteligente */
const SAMPLE = 100;

type Mapping = Record<string, string>;

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* só nesta sessão */
  }
}
const pairKey = (from: string, to: string) => `${from}>${to}`;

/**
 * Duplicar selecionados: na camada atual (arrastando a prévia no mapa, como antes) ou em outra
 * camada, na mesma posição, escolhendo qual atributo do destino recebe cada atributo da origem
 * (em branco = não copiar). O Pareamento Inteligente sugere os pares pelos nomes, valores e tipos.
 */
export default function DuplicateDialog() {
  const closeDialog = useAppStore((s) => s.closeDialog);
  const setTransform = useAppStore((s) => s.setTransform);
  const addLayer = useAppStore((s) => s.addLayer);
  const { sourceId, source, sources } = useActiveSource();
  const ids = useSelectedIds();
  const qc = useQueryClient();
  const close = () => closeDialog('duplicate');

  const [mode, setMode] = useState<'current' | 'other'>(() =>
    readJson<string>(MODE_KEY, 'current') === 'other' ? 'other' : 'current',
  );
  useEffect(() => writeJson(MODE_KEY, mode), [mode]);
  const others = useMemo(
    () => (sources.data ?? []).filter((s) => s.id !== sourceId),
    [sources.data, sourceId],
  );
  const [targetId, setTargetId] = useState('');
  const target = others.find((s) => s.id === targetId) ?? others[0] ?? null;

  const srcSchema = useSourceSchema(sourceId);
  const dstSchema = useSourceSchema(mode === 'other' ? (target?.id ?? null) : null);
  const srcCols = useMemo(() => {
    const s = srcSchema.data;
    if (!s) return [];
    const coord = new Set([s.source.xColumn, s.source.yColumn, s.source.geometryColumn]);
    return s.columns.filter((c) => c.kind !== 'geometry' && !coord.has(c.name));
  }, [srcSchema.data]);
  const dstCols = useMemo(() => {
    const s = dstSchema.data;
    if (!s) return [];
    const coord = new Set([s.source.xColumn, s.source.yColumn, s.source.geometryColumn]);
    return s.columns.filter((c) => !c.readOnly && c.kind !== 'geometry' && !coord.has(c.name));
  }, [dstSchema.data]);

  // Pareamento: origem → destino ('' = não copiar), lembrado por par de camadas.
  const [mapping, setMapping] = useState<Mapping>({});
  const [matches, setMatches] = useState<Record<string, AttributeMatch>>({});
  useEffect(() => {
    if (!sourceId || !target) return;
    setMapping(
      readJson<Record<string, Mapping>>(MAPPING_KEY, {})[pairKey(sourceId, target.id)] ?? {},
    );
    setMatches({});
  }, [sourceId, target]);
  const valid = useMemo(() => {
    const dst = new Set(dstCols.map((c) => c.name));
    const src = new Set(srcCols.map((c) => c.name));
    return Object.fromEntries(
      Object.entries(mapping).filter(([s, t]) => t && src.has(s) && dst.has(t)),
    ) as Mapping;
  }, [mapping, srcCols, dstCols]);
  const update = (next: Mapping) => {
    setMapping(next);
    if (sourceId && target) {
      const all = readJson<Record<string, Mapping>>(MAPPING_KEY, {});
      writeJson(MAPPING_KEY, { ...all, [pairKey(sourceId, target.id)]: next });
    }
  };
  const usedBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const [s, t] of Object.entries(valid)) m.set(t, s);
    return m;
  }, [valid]);

  // Exemplo de valor: primeiro registro selecionado.
  const example = useQuery({
    queryKey: ['points', sourceId, 'dup-example', ids[0]],
    queryFn: () => pointsService.records(sourceId!, [ids[0]], true),
    enabled: mode === 'other' && !!sourceId && ids.length > 0,
    staleTime: 30_000,
  });
  const exampleData = example.data?.[0]?.data ?? {};

  const pairing = useMutation({
    mutationFn: async () => {
      const [src, dst] = await Promise.all([
        pointsService.records(sourceId!, ids.slice(0, SAMPLE), true).catch(() => []),
        pointsService
          .sample(target!.id, SAMPLE)
          .then((r) => r.items)
          .catch(() => []),
      ]);
      return smartPair(
        srcCols,
        dstCols,
        src.map((r) => r.data),
        dst.map((r) => r.data),
      );
    },
    onSuccess: (found) => {
      update(Object.fromEntries(found.map((m) => [m.source, m.target])));
      setMatches(Object.fromEntries(found.map((m) => [m.source, m])));
      toast.success(
        found.length
          ? `${fmtInt(found.length)} de ${fmtInt(srcCols.length)} atributo(s) pareado(s). Confira e ajuste antes de duplicar.`
          : 'Nenhum atributo parecido encontrado: escolha os pares manualmente.',
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const [observation, setObservation] = useState('');
  const copy = useMutation({
    mutationFn: () =>
      pointsService.copyToSource(sourceId!, ids, target!.id, valid, observation.trim()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: queryKeys.points(r.targetId) });
      addLayer(r.targetId);
      const st = useAppStore.getState();
      st.setSource(r.targetId);
      useAppStore.getState().setSelection(r.groups);
      toast.success(
        `${fmtInt(r.count)} registro(s) duplicado(s) em "${r.targetName}" e selecionado(s).`,
      );
      const notes = [
        r.skipped > 0 &&
          `${fmtInt(r.skipped)} sem posição válida no sistema de coordenadas do destino não foram copiados.`,
        Object.keys(r.invalid).length > 0 &&
          `Valores que não cabiam no tipo do destino ficaram vazios: ${Object.entries(r.invalid)
            .map(([c, n]) => `${c} (${fmtInt(n)})`)
            .join(', ')}.`,
      ].filter(Boolean);
      if (notes.length) toast.info(notes.join(' '));
      close();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const n = ids.length;
  const pairs = Object.keys(valid).length;
  const ready =
    mode === 'current' ? n > 0 : n > 0 && !!target && !!dstSchema.data && !!observation.trim();

  const confirm = () => {
    if (!ready) return;
    if (mode === 'current') {
      close();
      setTransform('copy');
    } else copy.mutate();
  };

  return (
    <Dialog
      open
      size={mode === 'other' ? 'xl' : 'md'}
      title={`Duplicar ${fmtInt(n)} registro(s) selecionado(s)`}
      description={source ? `Origem: ${source.name}` : undefined}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button
            variant="primary"
            icon={<Copy className="size-4" />}
            onClick={confirm}
            loading={copy.isPending}
            disabled={!ready}
          >
            {mode === 'current'
              ? 'Continuar no mapa'
              : `Duplicar em ${target?.name ?? 'outra camada'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <RadioCard checked={mode === 'current'} onChange={() => setMode('current')}>
            Na camada atual
          </RadioCard>
          <RadioCard
            checked={mode === 'other'}
            disabled={!others.length}
            onChange={() => setMode('other')}
          >
            Em outra camada
          </RadioCard>
        </div>

        {mode === 'current' ? (
          <p className="text-sm text-slate-600">
            As cópias ficam em <b>{source?.name}</b>, com os mesmos atributos. No mapa, arraste a
            prévia até o destino (ou mantenha a mesma posição), informe o motivo e confirme.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div>
                <Label htmlFor="dup-target">Camada que vai receber as cópias</Label>
                <Select
                  id="dup-target"
                  value={target?.id ?? ''}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  {others.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.schema}.{s.tableName})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  icon={<Sparkles className="size-4" />}
                  onClick={() => pairing.mutate()}
                  loading={pairing.isPending}
                  disabled={!srcCols.length || !dstCols.length}
                  title="Sugere os pares pelos nomes (com abreviações e sinônimos), pelos valores em comum e pelos tipos"
                >
                  Pareamento Inteligente
                </Button>
                <Button
                  variant="ghost"
                  icon={<Eraser className="size-4" />}
                  onClick={() => {
                    update({});
                    setMatches({});
                  }}
                  disabled={!pairs}
                >
                  Limpar
                </Button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Escolha, para cada atributo de <b>{source?.name}</b>, o atributo de{' '}
              <b>{target?.name}</b> que vai receber o valor. Em branco, o atributo{' '}
              <b>não é copiado</b>. A posição é sempre copiada (convertida para o sistema de
              coordenadas do destino). {fmtInt(pairs)} de {fmtInt(srcCols.length)} pareado(s).
            </p>

            <div className="scroll-thin max-h-80 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-[1] bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Atributo de {source?.name}</th>
                    <th className="px-2 py-1.5 font-medium">Exemplo</th>
                    <th className="w-4" />
                    <th className="px-2 py-1.5 font-medium">Recebe em {target?.name}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {srcCols.map((c) => {
                    const t = valid[c.name] ?? '';
                    const m = matches[c.name];
                    return (
                      <tr key={c.name} className={t ? '' : 'text-slate-400'}>
                        <td className="px-2 py-1 font-medium text-slate-800">
                          {c.name}
                          {c.name === srcSchema.data?.source.idColumn && (
                            <span className="ml-1 text-[10px] text-slate-400">(ID)</span>
                          )}
                        </td>
                        <td
                          className="max-w-40 truncate px-2 py-1"
                          title={fmtValue(exampleData[c.name])}
                        >
                          {fmtValue(exampleData[c.name])}
                        </td>
                        <td>
                          <ArrowRight className="size-3.5 text-slate-400" />
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-2">
                            <select
                              value={t}
                              onChange={(e) => {
                                const next = { ...valid };
                                if (e.target.value) next[c.name] = e.target.value;
                                else delete next[c.name];
                                update(next);
                                setMatches((cur) => {
                                  const next = { ...cur };
                                  delete next[c.name];
                                  return next;
                                });
                              }}
                              className="h-7 min-w-40 rounded border border-slate-300 bg-white px-1 text-xs text-slate-800"
                              aria-label={`Atributo que recebe ${c.name}`}
                            >
                              <option value="">(não copiar)</option>
                              {dstCols.map((d) => {
                                const other = usedBy.get(d.name);
                                return (
                                  <option
                                    key={d.name}
                                    value={d.name}
                                    disabled={!!other && other !== c.name}
                                  >
                                    {d.name}
                                    {d.name === dstSchema.data?.source.idColumn ? ' (ID)' : ''}
                                    {other && other !== c.name ? ` — já recebe ${other}` : ''}
                                  </option>
                                );
                              })}
                            </select>
                            {m && t === m.target && (
                              <span
                                className="rounded bg-violet-50 px-1 text-[10px] whitespace-nowrap text-violet-700"
                                title={m.reason}
                              >
                                {Math.round(m.score * 100)}% · {m.reason}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <Label htmlFor="dup-obs" hint="Tabela de Alterações do destino">
                Observação (motivo da inclusão) <span className="text-red-500">*</span>
              </Label>
              <textarea
                id="dup-obs"
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                rows={2}
                maxLength={500}
                className="block w-full resize-y rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 focus:border-accent-500 focus:outline-none"
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
