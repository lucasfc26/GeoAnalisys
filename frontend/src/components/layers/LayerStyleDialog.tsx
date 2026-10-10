import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Eye, Palette, Pencil, Plus, Shuffle, Trash2, Type } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { useSourceSchema, useSources } from '@/hooks/useSourceData';
import { errorMessage } from '@/lib/api';
import {
  DEFAULT_LABEL_FONT,
  DEFAULT_OUTLINE_COLOR,
  LABEL_FONTS,
  addLabelTemplate,
  catKey,
  categoryStyle,
  defaultLabelExpr,
  labelBufferColor,
  labelBufferWidth,
  labelFontStack,
  pointOutline,
  pointOutlineWidth,
  quoteField,
  removeLabelTemplate,
  renameLabelTemplate,
  switchLabelTemplate,
  syncLabelTemplate,
} from '@/lib/layers';
import { pointsService } from '@/services/points';
import { sourcesService } from '@/services/sources';
import { useAppStore } from '@/stores/appStore';
import type { LayerStyle } from '@/types';
import { fmtInt } from '@/utils/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input, Label, Select } from '../ui/Field';
import { Skeleton } from '../ui/States';

const RANDOM_PALETTE = [
  '#ef4444',
  '#22c55e',
  '#3b82f6',
  '#eab308',
  '#a855f7',
  '#06b6d4',
  '#f97316',
  '#ec4899',
  '#84cc16',
  '#6366f1',
  '#14b8a6',
  '#78716c',
];

function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
}) {
  return (
    <Input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      className={className}
    />
  );
}

function Symbology({
  draft,
  set,
  sourceId,
}: {
  draft: LayerStyle;
  set: (p: Partial<LayerStyle>) => void;
  sourceId: string;
}) {
  const schema = useSourceSchema(sourceId);
  const source = schema.data?.source;
  const column =
    draft.styleColumn === undefined ? (source?.categoryColumn ?? null) : draft.styleColumn;
  const columns = (schema.data?.columns ?? []).filter((c) => c.kind !== 'geometry');
  const distinct = useQuery({
    queryKey: ['distinct', sourceId, column],
    queryFn: () => sourcesService.distinct(sourceId, column!),
    enabled: !!column,
    staleTime: 60_000,
  });
  const [bulkSize, setBulkSize] = useState(draft.size);

  const setCat = (value: string | null, patch: Partial<ReturnType<typeof categoryStyle>>) =>
    set({
      categories: {
        ...draft.categories,
        [catKey(value)]: { ...categoryStyle(draft, value), ...patch },
      },
    });

  const values = distinct.data ?? [];
  const applyAll = (
    fn: (value: string | null, i: number) => Partial<ReturnType<typeof categoryStyle>>,
  ) => {
    const categories = { ...draft.categories };
    values.forEach((v, i) => {
      categories[catKey(v.value)] = { ...categoryStyle(draft, v.value), ...fn(v.value, i) };
    });
    set({ categories });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="style-col" hint="ex.: medicao">
            Categorizar por coluna
          </Label>
          <Select
            id="style-col"
            value={column ?? ''}
            onChange={(e) => set({ styleColumn: e.target.value || null, categories: {} })}
          >
            <option value="">— Símbolo único —</option>
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{column ? 'Tamanho padrão' : 'Tamanho'}</Label>
            <NumberField value={draft.size} min={2} max={24} onChange={(size) => set({ size })} />
          </div>
          {!column && (
            <div>
              <Label>Cor</Label>
              <input
                type="color"
                value={draft.color}
                onChange={(e) => set({ color: e.target.value })}
                className="h-9 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1"
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label hint={`${Math.round(draft.opacity * 100)}%`}>Opacidade</Label>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={draft.opacity}
            onChange={(e) => set({ opacity: Number(e.target.value) })}
            className="w-full accent-accent-600"
          />
        </div>
        <div>
          <Label>Contorno dos pontos</Label>
          <div className="flex h-9 items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.outline !== false}
                onChange={(e) => set({ outline: e.target.checked })}
                className="size-4 accent-accent-600"
              />
              Mostrar
            </label>
            <input
              type="color"
              value={draft.outlineColor ?? DEFAULT_OUTLINE_COLOR}
              onChange={(e) => set({ outlineColor: e.target.value, outline: true })}
              className={clsx(
                'h-9 w-16 cursor-pointer rounded-md border border-slate-300 bg-white p-1',
                draft.outline === false && 'opacity-40',
              )}
              title="Cor do contorno"
              aria-label="Cor do contorno dos pontos"
            />
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.1}
              value={pointOutlineWidth(draft)}
              onChange={(e) => set({ outlineWidth: Number(e.target.value), outline: true })}
              className={clsx(
                'min-w-0 flex-1 accent-accent-600',
                draft.outline === false && 'opacity-40',
              )}
              title="Espessura do contorno"
              aria-label="Espessura do contorno dos pontos"
            />
            <span className="w-12 shrink-0 text-right text-xs text-slate-500">
              {pointOutlineWidth(draft).toFixed(1)} px
            </span>
          </div>
        </div>
      </div>

      {column && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="flex-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Valores de {column}
            </h3>
            <Button
              size="sm"
              icon={<Shuffle className="size-3.5" />}
              onClick={() =>
                applyAll((_, i) => ({ color: RANDOM_PALETTE[i % RANDOM_PALETTE.length] }))
              }
            >
              Cores distintas
            </Button>
            <Button
              size="sm"
              icon={<Eye className="size-3.5" />}
              onClick={() => applyAll(() => ({ visible: true }))}
            >
              Mostrar todos
            </Button>
            <div className="flex items-center gap-1">
              <NumberField
                value={bulkSize}
                min={2}
                max={24}
                onChange={setBulkSize}
                className="!h-7 w-16 text-xs"
              />
              <Button size="sm" onClick={() => applyAll(() => ({ size: bulkSize }))}>
                Tamanho p/ todos
              </Button>
            </div>
          </div>
          {distinct.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6" />
              <Skeleton className="h-6" />
            </div>
          ) : distinct.isError ? (
            <p className="text-sm text-red-600">{errorMessage(distinct.error)}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="w-10 px-2 py-1.5">Exibir</th>
                    <th className="w-14 px-2 py-1.5">Cor</th>
                    <th className="w-20 px-2 py-1.5">Tamanho</th>
                    <th className="px-2 py-1.5">Valor</th>
                    <th className="px-2 py-1.5 text-right">Registros</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {values.map((v) => {
                    const cs = categoryStyle(draft, v.value);
                    return (
                      <tr
                        key={catKey(v.value)}
                        className={clsx(!cs.visible && 'bg-slate-50 text-slate-400')}
                      >
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={cs.visible}
                            onChange={() => setCat(v.value, { visible: !cs.visible })}
                            className="size-4 accent-accent-600"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="color"
                            value={cs.color}
                            onChange={(e) => setCat(v.value, { color: e.target.value })}
                            className="h-7 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <NumberField
                            value={cs.size}
                            min={2}
                            max={24}
                            onChange={(size) => setCat(v.value, { size })}
                            className="!h-7 w-16 text-xs"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <span className="flex items-center gap-2">
                            <span
                              className="inline-block shrink-0 rounded-full border shadow-[0_0_0_1px_rgba(15,23,42,0.25)]"
                              style={{
                                borderColor: pointOutline(draft) ?? 'transparent',
                                background: cs.color,
                                width: cs.size * 2,
                                height: cs.size * 2,
                              }}
                            />
                            {v.value === null || v.value === '' ? <i>(vazio)</i> : v.value}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right text-slate-500">{fmtInt(v.count)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {values.length >= 100 && (
                <p className="border-t border-slate-200 px-2 py-1.5 text-xs text-slate-500">
                  Mostrando os 100 valores mais frequentes; os demais usam cores automáticas.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Templates de rótulo: alternar, salvar como novo, renomear e excluir. */
function LabelTemplates({
  draft,
  update,
}: {
  draft: LayerStyle;
  update: (fn: (d: LayerStyle) => LayerStyle) => void;
}) {
  const templates = draft.labelTemplates ?? [];
  const active = templates.find((t) => t.id === draft.activeLabelTemplate) ?? null;
  // Nome sendo digitado: novo template ou renomear o ativo.
  const [editing, setEditing] = useState<{ mode: 'new' | 'rename'; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const commit = () => {
    if (!editing?.name.trim()) return;
    if (editing.mode === 'new') update((d) => addLabelTemplate(d, editing.name));
    else if (active) update((d) => renameLabelTemplate(d, active.id, editing.name));
    setEditing(null);
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <Label hint="versões salvas dos rótulos desta camada">Template</Label>
      {editing ? (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={editing.name}
            maxLength={60}
            placeholder="Nome do template"
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(null);
            }}
          />
          <Button size="sm" variant="primary" onClick={commit} disabled={!editing.name.trim()}>
            {editing.mode === 'new' ? 'Salvar' : 'Renomear'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Select
            value={active?.id ?? ''}
            onChange={(e) => {
              setConfirmDelete(false);
              if (e.target.value) update((d) => switchLabelTemplate(d, e.target.value));
            }}
            className="min-w-40 flex-1"
            aria-label="Template de rótulo"
          >
            {!active && (
              <option value="">
                {templates.length ? '(rótulo atual, sem template)' : '(nenhum template salvo)'}
              </option>
            )}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            icon={<Plus className="size-3.5" />}
            onClick={() => setEditing({ mode: 'new', name: `Template ${templates.length + 1}` })}
            title="Salva a configuração atual como um novo template"
          >
            Novo
          </Button>
          {active && (
            <>
              <Button
                size="sm"
                icon={<Pencil className="size-3.5" />}
                onClick={() => setEditing({ mode: 'rename', name: active.name })}
              >
                Renomear
              </Button>
              {confirmDelete ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    update((d) => removeLabelTemplate(d, active.id));
                    setConfirmDelete(false);
                  }}
                >
                  Confirmar exclusão
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() => setConfirmDelete(true)}
                >
                  Excluir
                </Button>
              )}
            </>
          )}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-slate-500">
        {active
          ? `As alterações abaixo ficam salvas no template "${active.name}".`
          : 'Clique em "Novo" para guardar a configuração abaixo e poder alternar entre versões.'}
      </p>
    </div>
  );
}

function Labels({
  draft,
  set,
  update,
  sourceId,
}: {
  draft: LayerStyle;
  set: (p: Partial<LayerStyle>) => void;
  update: (fn: (d: LayerStyle) => LayerStyle) => void;
  sourceId: string;
}) {
  const schema = useSourceSchema(sourceId);
  const source = schema.data?.source;
  const lab = draft.label;
  const setLab = (p: Partial<LayerStyle['label']>) => set({ label: { ...lab, ...p } });
  // Expressão vazia = sem rótulo (não cai na coluna de rótulo/ID da fonte).
  const expression = lab.expression.trim();
  const debounced = useDebounce(expression, 400);
  const columns = (schema.data?.columns ?? []).filter((c) => c.kind !== 'geometry');
  const preview = useQuery({
    queryKey: ['label-preview', sourceId, debounced],
    queryFn: ({ signal }) => pointsService.labelPreview(sourceId, debounced, signal),
    enabled: lab.enabled && !!debounced,
    retry: false,
    staleTime: 60_000,
  });

  const insertField = (name: string) => {
    const cur = lab.expression.trim();
    setLab({ expression: cur ? `${cur} || ' ' || ${quoteField(name)}` : quoteField(name) });
  };

  const bufferColor = labelBufferColor(lab);
  const bufferWidth = labelBufferWidth(lab);
  const sample = !expression
    ? ''
    : (preview.data?.find((r) => r.label)?.label ?? (preview.data ? '' : 'O texto ficará assim'));
  const textStyle: CSSProperties = {
    fontSize: lab.size,
    fontWeight: lab.bold ? 700 : 400,
    fontStyle: lab.italic ? 'italic' : 'normal',
    textDecoration: lab.underline ? 'underline' : 'none',
    color: lab.color,
    fontFamily: labelFontStack(lab),
    whiteSpace: 'pre',
    // Como no mapa: contorno por fora do texto (traço desenhado antes do preenchimento).
    WebkitTextStroke: lab.buffer ? `${bufferWidth * 2}px ${bufferColor}` : undefined,
    paintOrder: 'stroke fill',
  };

  return (
    <div className="space-y-4">
      <LabelTemplates draft={draft} update={update} />
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={lab.enabled}
          onChange={(e) =>
            // Ao ligar sem expressão, sugere a coluna de rótulo (ou o ID) da fonte.
            setLab(
              e.target.checked && !lab.expression.trim()
                ? { enabled: true, expression: defaultLabelExpr(source) }
                : { enabled: e.target.checked },
            )
          }
          className="size-4 accent-accent-600"
        />
        Mostrar rótulos (texto acima de cada ponto)
      </label>

      <div className={clsx('space-y-4', !lab.enabled && 'pointer-events-none opacity-50')}>
        <div>
          <Label hint={`campos entre "aspas duplas", textos entre 'aspas simples', unidos por ||`}>
            Valor (expressão)
          </Label>
          <textarea
            value={lab.expression}
            onChange={(e) => setLab({ expression: e.target.value })}
            placeholder={`vazio = sem rótulo   (ex.: ${defaultLabelExpr(source)})`}
            rows={2}
            spellCheck={false}
            className="block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-800 shadow-sm focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 focus:outline-none"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {columns.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => insertField(c.name)}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 hover:border-accent-400 hover:bg-accent-50"
                title={`Inserir ${quoteField(c.name)}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
            Amostra de texto
          </div>
          <div className="flex min-h-16 items-center bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#f8fafc_0%_50%)] bg-[length:16px_16px] px-3 py-3">
            {preview.isError ? (
              <span className="text-sm text-red-600">{errorMessage(preview.error)}</span>
            ) : sample.trim() ? (
              <span style={textStyle}>{sample}</span>
            ) : (
              <i className="text-sm text-slate-400">
                {expression
                  ? sample
                    ? '(rótulo só com espaços)'
                    : '(rótulo vazio)'
                  : '(sem rótulo — expressão vazia)'}
              </i>
            )}
          </div>
          {preview.data && preview.data.length > 1 && (
            <ul className="space-y-0.5 border-t border-slate-200 px-3 py-1.5 text-xs text-slate-500">
              {preview.data.map((r) => (
                <li key={r.id} className="truncate">
                  <span className="text-slate-400">#{r.id}:</span> {r.label ?? '—'}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <Label>Tamanho</Label>
            <NumberField value={lab.size} min={6} max={40} onChange={(size) => setLab({ size })} />
          </div>
          <div>
            <Label>Cor</Label>
            <input
              type="color"
              value={lab.color}
              onChange={(e) => setLab({ color: e.target.value })}
              className="h-9 w-full cursor-pointer rounded-md border border-slate-300 bg-white p-1"
            />
          </div>
          <div>
            <Label hint="0–22">A partir do zoom</Label>
            <NumberField
              value={lab.minZoom}
              min={0}
              max={22}
              onChange={(minZoom) => setLab({ minZoom })}
            />
          </div>
          <div>
            <Label>Fonte</Label>
            <Select
              value={lab.font ?? DEFAULT_LABEL_FONT}
              onChange={(e) => setLab({ font: e.target.value })}
              className="w-full"
            >
              {LABEL_FONTS.map((f) => (
                <option key={f.name} value={f.name} style={{ fontFamily: f.stack }}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700">
          {(
            [
              ['bold', 'Negrito', 'font-bold'],
              ['italic', 'Itálico', 'italic'],
              ['underline', 'Sublinhado', 'underline'],
            ] as const
          ).map(([key, text, cls]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!lab[key]}
                onChange={(e) => setLab({ [key]: e.target.checked })}
                className="size-4 accent-accent-600"
              />
              <span className={cls}>{text}</span>
            </label>
          ))}
        </div>
        <div>
          <Label>Contorno do texto</Label>
          <div className="flex h-9 items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={lab.buffer}
                onChange={(e) => setLab({ buffer: e.target.checked })}
                className="size-4 accent-accent-600"
              />
              Mostrar
            </label>
            <input
              type="color"
              value={bufferColor}
              onChange={(e) => setLab({ bufferColor: e.target.value, buffer: true })}
              className={clsx(
                'h-9 w-16 cursor-pointer rounded-md border border-slate-300 bg-white p-1',
                !lab.buffer && 'opacity-40',
              )}
              title="Cor do contorno do texto"
              aria-label="Cor do contorno do texto"
            />
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.1}
              value={bufferWidth}
              onChange={(e) => setLab({ bufferWidth: Number(e.target.value), buffer: true })}
              className={clsx('min-w-0 flex-1 accent-accent-600', !lab.buffer && 'opacity-40')}
              title="Espessura do contorno do texto"
              aria-label="Espessura do contorno do texto"
            />
            <span className="w-12 shrink-0 text-right text-xs text-slate-500">
              {bufferWidth.toFixed(1)} px
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
          <div>
            <Label hint="1–20">Rótulos por ponto</Label>
            <NumberField
              value={lab.maxPerPoint ?? 1}
              min={1}
              max={20}
              onChange={(maxPerPoint) => setLab({ maxPerPoint })}
            />
          </div>
          <p className="col-span-1 pb-1 text-xs text-slate-500 sm:col-span-3">
            Quando vários registros estão na mesma coordenada (bolinha com número), mostra o rótulo
            de cada um, um por linha, até esse limite; os que sobrarem aparecem como “+N”.
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Rótulos que se sobrepõem são omitidos automaticamente; aproxime o mapa para ver todos.
        </p>
      </div>
    </div>
  );
}

export default function LayerStyleDialog() {
  const state = useAppStore((s) => s.dialogs.layerStyle);
  const closeDialog = useAppStore((s) => s.closeDialog);
  const updateLayer = useAppStore((s) => s.updateLayer);
  const layer = useAppStore((s) => s.layers.find((l) => l.sourceId === state?.sourceId));
  const sources = useSources();
  const [tab, setTab] = useState(state?.tab ?? 'symbology');
  const [draft, setDraft] = useState<LayerStyle | null>(layer ?? null);
  const name = useMemo(
    () => sources.data?.find((s) => s.id === state?.sourceId)?.name ?? '',
    [sources.data, state],
  );

  if (!state || !layer || !draft) return null;
  const set = (p: Partial<LayerStyle>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const update = (fn: (d: LayerStyle) => LayerStyle) => setDraft((d) => (d ? fn(d) : d));
  const apply = () => {
    // Visibilidade/expansão podem ter mudado no painel enquanto o diálogo estava aberto.
    // O rótulo em uso é gravado no template ativo.
    updateLayer(layer.sourceId, (l) => ({
      ...syncLabelTemplate(draft),
      sourceId: l.sourceId,
      visible: l.visible,
      expanded: l.expanded,
    }));
  };
  const close = () => closeDialog('layerStyle');

  return (
    <Dialog
      open
      size="lg"
      title={`Propriedades da camada — ${name}`}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={apply}>Aplicar</Button>
          <Button
            variant="primary"
            onClick={() => {
              apply();
              close();
            }}
          >
            OK
          </Button>
        </>
      }
    >
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            ['symbology', 'Simbologia', <Palette key="p" className="size-4" />],
            ['labels', 'Rótulos', <Type key="t" className="size-4" />],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={clsx(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium',
              tab === key
                ? 'border-accent-600 text-accent-700'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
      {tab === 'symbology' ? (
        <Symbology draft={draft} set={set} sourceId={layer.sourceId} />
      ) : (
        <Labels draft={draft} set={set} update={update} sourceId={layer.sourceId} />
      )}
      <p className="mt-4 text-xs text-slate-400">
        As configurações de estilo ficam salvas neste navegador.
      </p>
    </Dialog>
  );
}
