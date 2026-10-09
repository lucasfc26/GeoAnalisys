import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListOrdered,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveSource, useSourceSchema } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import { pointsService } from '@/services/points';
import { useAppStore } from '@/stores/appStore';
import type { PointRecord, SelectedGroup } from '@/types';
import { fmtInt, fmtValue, isUrl } from '@/utils/format';
import { boundsOfPoints, distanceM, fmtDistance } from '@/utils/geo';
import { parseList } from '@/utils/list';
import { Button } from '../ui/Button';
import { FloatingPanel } from '../ui/FloatingPanel';
import { toast } from '../ui/Toaster';
import { metersPerCm, zoomOfScale } from './pointsOverlay';

/** Escalas do controle de aproximação (metros por 1 cm de tela). */
const SCALES = [1, 2, 5, 10, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000];
const DEFAULT_SCALE = SCALES.indexOf(10);
const MAX_LISTS = 6;
/** Registros com atributos exibidos por passo. */
const MAX_ROWS = 30;

/** Zoom (fracionado: escala exata) em que 1 cm de tela representa `mPerCm` metros na latitude dada. */
function zoomFor(mPerCm: number, lat: number) {
  return Math.min(22, Math.max(1, zoomOfScale(metersPerCm(1, lat) / mPerCm)));
}

interface Item {
  value: string;
  groups: SelectedGroup[];
}
interface ListInput {
  id: number;
  column: string;
  text: string;
}
/** Um passo da navegação: o valor de cada lista naquela posição. */
type Step = ({ list: number; item: Item } | null)[];

/** Passos pareados por posição; pula as posições em que nenhuma lista tem ponto encontrado. */
function buildSteps(results: { items: Item[] }[]): Step[] {
  const len = Math.max(0, ...results.map((r) => r.items.length));
  const out: Step[] = [];
  for (let i = 0; i < len; i++) {
    const step = results.map((r, list) => (r.items[i] ? { list, item: r.items[i] } : null));
    if (step.some((e) => e?.item.groups.length)) out.push(step);
  }
  return out;
}

const colsKey = (sourceId: string | null) => `geoanalisys-list-cols:${sourceId ?? ''}`;
function loadCols(sourceId: string | null): string[] {
  try {
    // Fallback: chave com o nome antigo do sistema ("Censo GIS").
    const raw =
      localStorage.getItem(colsKey(sourceId)) ??
      localStorage.getItem(`censo-list-cols:${sourceId ?? ''}`);
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

function Cell({ v }: { v: unknown }) {
  if (isUrl(v)) {
    return (
      <a
        href={v}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-accent-700 hover:underline"
      >
        abrir link <ExternalLink className="size-3" />
      </a>
    );
  }
  const s = fmtValue(v);
  return (
    <span className="block max-w-48 truncate" title={s}>
      {s}
    </span>
  );
}

/**
 * Modo lista: uma ou mais listas de valores (cada uma em um atributo). Com várias listas, elas são
 * comparadas por posição: cada passo centraliza e seleciona os pontos do 1º valor de cada lista, depois
 * do 2º, etc. As colunas escolhidas mostram os atributos dos pontos do passo atual (links clicáveis).
 */
export function ListModePanel() {
  const open = useAppStore((s) => s.listMode);
  const setListMode = useAppStore((s) => s.setListMode);
  const setSelection = useAppStore((s) => s.setSelection);
  const focusMap = useAppStore((s) => s.focusMap);
  const { sourceId, source } = useActiveSource();
  const schema = useSourceSchema(sourceId);
  const columns = useMemo(
    () => (schema.data?.columns ?? []).filter((c) => c.kind !== 'geometry'),
    [schema.data],
  );
  const defaultCol = source?.idColumn || columns[0]?.name || '';

  const [lists, setLists] = useState<ListInput[]>([{ id: 1, column: '', text: '' }]);
  const [results, setResults] = useState<{ column: string; items: Item[] }[] | null>(null);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [loading, setLoading] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  /** Recolhida: só navegação compacta + tabela de atributos */
  const [collapsed, setCollapsed] = useState(false);
  /** Selecionar também os demais registros das mesmas coordenadas */
  const [sameCoord, setSameCoord] = useState(false);
  const request = useRef(0);
  const [shownCols, setShownCols] = useState<string[]>(() => loadCols(sourceId));

  const multi = lists.length > 1;
  const parsed = useMemo(() => lists.map((l) => parseList(l.text, !multi)), [lists, multi]);

  const steps = useMemo(() => (results ? buildSteps(results) : []), [results]);
  const missing = useMemo(
    () =>
      results?.flatMap((r, list) =>
        r.items.filter((i) => !i.groups.length).map((i) => ({ list, value: i.value })),
      ) ?? [],
    [results],
  );
  const step = steps[index];

  const setCols = (cols: string[]) => {
    setShownCols(cols);
    try {
      localStorage.setItem(colsKey(sourceId), JSON.stringify(cols));
    } catch {
      /* só nesta sessão */
    }
  };

  /**
   * Seleciona os pontos do passo; um local (ou próximos) usa a escala escolhida, vários espalhados
   * enquadram todos. Com `all`, inclui também os demais registros das mesmas coordenadas (os
   * comparados ficam como "principais", em destaque no painel).
   */
  const go = useCallback(
    (i: number, scaleIdx = scale, list = steps, all = sameCoord) => {
      const s = list[i];
      if (!s) return;
      setIndex(i);
      const groups = s.flatMap((e) => e?.item.groups ?? []);
      const b = boundsOfPoints(groups);
      if (!b) return;
      const primary = groups.flatMap((g) => g.ids);
      const req = ++request.current;
      setSelection(groups, 'replace', all ? primary : undefined);
      if (all && sourceId) {
        const filters = useAppStore.getState().filters;
        Promise.all(groups.map((g) => pointsService.at(sourceId, g.x, g.y, filters, true)))
          .then((res) => {
            // Ignora respostas de um passo anterior (navegação rápida).
            if (req !== request.current) return;
            const full = groups.map((g, k) => ({
              ...g,
              ids: [...new Set([...g.ids, ...res[k].ids])],
            }));
            setSelection(full, 'replace', primary);
          })
          .catch((err) => toast.error(errorMessage(err)));
      }
      const center = { lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 };
      const span = distanceM({ lat: b.minLat, lng: b.minLng }, { lat: b.maxLat, lng: b.maxLng });
      // Cabe em ~10 cm de tela na escala escolhida: mantém a escala; senão enquadra todos.
      if (span <= SCALES[scaleIdx] * 10)
        focusMap({ center, zoom: zoomFor(SCALES[scaleIdx], center.lat) });
      else focusMap({ bounds: b });
    },
    [scale, steps, sameCoord, sourceId, setSelection, focusMap],
  );

  const load = async () => {
    if (!sourceId || parsed.every((p) => !p.length)) return;
    setLoading(true);
    try {
      const res = await Promise.all(
        lists.map((l, i) =>
          parsed[i].length
            ? pointsService.lookup(sourceId, l.column || defaultCol, parsed[i])
            : Promise.resolve({ column: l.column || defaultCol, items: [] }),
        ),
      );
      setResults(res);
      setShowMissing(false);
      setIndex(0);
      const next = buildSteps(res);
      const miss = res.reduce((n, r) => n + r.items.filter((i) => !i.groups.length).length, 0);
      if (!next.length) toast.info('Nenhum dos valores foi encontrado.');
      else {
        toast.success(
          `${fmtInt(next.length)} posição(ões) para percorrer${miss ? ` · ${fmtInt(miss)} valor(es) não encontrado(s)` : ''}.`,
        );
        go(0, scale, next);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Atributos dos pontos do passo atual.
  const rows = useMemo(() => {
    const out: { list: number; value: string; id: string | null }[] = [];
    for (const e of step ?? []) {
      if (!e) continue;
      const ids = e.item.groups.flatMap((g) => g.ids);
      if (!ids.length) out.push({ list: e.list, value: e.item.value, id: null });
      for (const id of ids) out.push({ list: e.list, value: e.item.value, id });
    }
    return out.slice(0, MAX_ROWS);
  }, [step]);
  const rowIds = useMemo(() => rows.flatMap((r) => (r.id ? [r.id] : [])), [rows]);
  const records = useQuery({
    queryKey: ['points', sourceId, 'list-records', rowIds],
    queryFn: () => pointsService.records(sourceId!, rowIds, true),
    enabled: !!sourceId && rowIds.length > 0 && shownCols.length > 0,
    staleTime: 30_000,
  });
  const byId = useMemo(
    () => new Map((records.data ?? []).map((r: PointRecord) => [r.id, r])),
    [records.data],
  );

  // ← / → percorrem a lista (fora de campos de texto e do próprio mapa, que usa as setas para mover).
  useEffect(() => {
    if (!open || !steps.length) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.closest('input, textarea, select, [contenteditable="true"], .gm-style') ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (e.key === 'ArrowRight' && index < steps.length - 1) go(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, steps.length, index, go]);

  if (!open) return null;

  const colSelect = (value: string, onChange: (v: string) => void, className = '') => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs text-slate-800 ${className}`}
    >
      {columns.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </select>
  );

  return (
    <FloatingPanel
      title={multi ? `Modo lista · comparar ${lists.length} listas` : 'Modo lista'}
      icon={<ListOrdered className="size-4 text-accent-600" />}
      onClose={() => setListMode(false)}
      defaultClassName="bottom-6 left-1/2 -translate-x-1/2 max-lg:bottom-20"
      className="w-[30rem] max-w-[calc(100%-1.5rem)]"
      actions={
        results && (
          <>
            {!collapsed && (
              <button
                type="button"
                onClick={() => setResults(null)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
              >
                <Pencil className="size-3.5" /> Editar listas
              </button>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title={
                collapsed
                  ? 'Expandir (escala, colunas, listas)'
                  : 'Recolher: só atributos (← → continuam navegando)'
              }
              aria-label={collapsed ? 'Expandir modo lista' : 'Recolher modo lista'}
            >
              {collapsed ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
            </button>
          </>
        )
      }
    >
      {!sourceId ? (
        <p className="p-3 text-sm text-slate-500">Ative uma camada para usar o modo lista.</p>
      ) : !results ? (
        <div className="space-y-3 p-3">
          {lists.map((l, i) => (
            <div key={l.id} className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <span className="w-14 shrink-0">{multi ? `Lista ${i + 1}` : 'Atributo'}</span>
                {colSelect(
                  l.column || defaultCol,
                  (column) =>
                    setLists((ls) => ls.map((x) => (x.id === l.id ? { ...x, column } : x))),
                  'min-w-0 flex-1',
                )}
                <span className="shrink-0 font-normal text-slate-400">
                  {fmtInt(parsed[i].length)} valor(es)
                </span>
                {multi && (
                  <button
                    type="button"
                    onClick={() => setLists((ls) => ls.filter((x) => x.id !== l.id))}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`Remover lista ${i + 1}`}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <textarea
                value={l.text}
                onChange={(e) =>
                  setLists((ls) =>
                    ls.map((x) => (x.id === l.id ? { ...x, text: e.target.value } : x)),
                  )
                }
                rows={multi ? 3 : 5}
                placeholder={'779771\n779772\n779773'}
                className="block w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm text-slate-800"
              />
            </div>
          ))}
          <p className="text-[11px] text-slate-400">
            Um valor por linha, ou separados por vírgula, ponto e vírgula ou espaço.
            {multi && ' As listas são comparadas por posição: 1º com 1º, 2º com 2º…'}
          </p>
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              disabled={lists.length >= MAX_LISTS}
              onClick={() =>
                setLists((ls) => [
                  ...ls,
                  { id: Math.max(...ls.map((x) => x.id)) + 1, column: '', text: '' },
                ])
              }
            >
              Adicionar lista (comparar)
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={load}
              loading={loading}
              disabled={parsed.every((p) => !p.length)}
            >
              Localizar
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 p-3">
          {step ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => go(index - 1)}
                disabled={index === 0}
                aria-label="Anterior"
                icon={<ChevronLeft className="size-4" />}
              />
              <div className="min-w-0 flex-1 text-center">
                <div className="truncate text-sm">
                  {step.map((e, li) => (
                    <span
                      key={li}
                      className={
                        e?.item.groups.length ? 'text-slate-900' : 'text-slate-400 line-through'
                      }
                    >
                      {li > 0 && <span className="text-slate-300"> · </span>}
                      <b>{e?.item.value ?? '—'}</b>
                    </span>
                  ))}
                </div>
                <div className="text-xs text-slate-500">
                  {fmtInt(index + 1)} de {fmtInt(steps.length)}
                  {!multi && results[0].column && ` · ${results[0].column}`}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => go(index + 1)}
                disabled={index >= steps.length - 1}
                aria-label="Próximo"
                icon={<ChevronRight className="size-4" />}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nenhum valor encontrado.</p>
          )}

          {!collapsed && (
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={sameCoord}
                onChange={(e) => {
                  setSameCoord(e.target.checked);
                  if (step) go(index, scale, steps, e.target.checked);
                }}
                className="mt-0.5 accent-accent-600"
              />
              <span>
                Selecionar todos os pontos das mesmas coordenadas
                <span className="block text-[11px] text-slate-400">
                  No painel, os comparados ficam em destaque e os demais do local, em cinza.
                </span>
              </span>
            </label>
          )}

          {!collapsed && (
            <label className="block text-xs text-slate-600">
              <span className="flex justify-between">
                <span>Aproximação</span>
                <b className="text-slate-800">1 cm ≈ {fmtDistance(SCALES[scale])}</b>
              </span>
              <input
                type="range"
                min={0}
                max={SCALES.length - 1}
                step={1}
                value={scale}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  setScale(s);
                  if (step) go(index, s);
                }}
                className="mt-1 w-full accent-accent-600"
              />
              <span className="flex justify-between text-[10px] text-slate-400">
                <span>1 cm ≈ {fmtDistance(SCALES[0])}</span>
                <span>1 cm ≈ {fmtDistance(SCALES[SCALES.length - 1])}</span>
              </span>
            </label>
          )}

          {/* Colunas de atributos exibidas para o passo atual. */}
          <div className="space-y-1.5">
            {collapsed && !shownCols.length && (
              <p className="text-xs text-slate-500">
                Nenhum atributo escolhido — expanda a janela e use “+ coluna”.
              </p>
            )}
            {!collapsed && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs font-medium text-slate-600">Atributos:</span>
                {shownCols.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-0.5 rounded bg-slate-100 py-0.5 pr-0.5 pl-1.5 text-[11px] text-slate-700"
                  >
                    {c}
                    <button
                      type="button"
                      onClick={() => setCols(shownCols.filter((x) => x !== c))}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      aria-label={`Remover coluna ${c}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onChange={(e) => e.target.value && setCols([...shownCols, e.target.value])}
                  className="h-6 rounded border border-dashed border-slate-300 bg-white px-1 text-[11px] text-slate-600"
                  aria-label="Adicionar coluna"
                >
                  <option value="">+ coluna</option>
                  {columns
                    .filter((c) => !shownCols.includes(c.name))
                    .map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {shownCols.length > 0 && rows.length > 0 && (
              <div className="scroll-thin max-h-56 overflow-auto rounded border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      {multi && <th className="px-2 py-1 font-medium">Lista</th>}
                      <th className="px-2 py-1 font-medium">Valor</th>
                      {shownCols.map((c) => (
                        <th key={c} className="px-2 py-1 font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {rows.map((r, i) => {
                      const rec = r.id ? byId.get(r.id) : undefined;
                      return (
                        <tr key={`${r.list}-${r.id ?? r.value}-${i}`}>
                          {multi && <td className="px-2 py-1 text-slate-500">{r.list + 1}</td>}
                          <td className="px-2 py-1 font-medium whitespace-nowrap">{r.value}</td>
                          {shownCols.map((c) => (
                            <td key={c} className="px-2 py-1">
                              {!r.id ? (
                                <span className="text-slate-400 italic">não encontrado</span>
                              ) : rec ? (
                                <Cell v={rec.data[c]} />
                              ) : (
                                '…'
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!collapsed && missing.length > 0 && (
            <div className="text-xs">
              <button
                type="button"
                onClick={() => setShowMissing((v) => !v)}
                className="text-amber-700 hover:underline"
              >
                {fmtInt(missing.length)} não encontrado(s) {showMissing ? '▲' : '▼'}
              </button>
              {showMissing && (
                <p className="scroll-thin mt-1 max-h-20 overflow-y-auto rounded bg-amber-50 px-2 py-1 font-mono text-amber-900">
                  {missing.map((m) => (multi ? `L${m.list + 1}: ${m.value}` : m.value)).join(', ')}
                </p>
              )}
            </div>
          )}
          {!collapsed && (
            <p className="text-[11px] text-slate-400">
              Dica: ← e → do teclado navegam · arraste a janela pelo título.
            </p>
          )}
        </div>
      )}
    </FloatingPanel>
  );
}
