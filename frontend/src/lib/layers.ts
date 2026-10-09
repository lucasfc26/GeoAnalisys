import type { CategoryStyle, DataSource, FilterDef, LabelStyle, LayerStyle } from '@/types';
import { categoryColor } from '@/utils/format';

/** Chave usada para o valor NULL nas categorias. */
export const NULL_KEY = '__null__';
export const catKey = (v: string | null) => (v === null ? NULL_KEY : v);

/** Cores padrão por camada (símbolo único), para diferenciar tabelas. */
const LAYER_COLORS = ['#16a34a', '#06b6d4', '#d946ef', '#f59e0b', '#2563eb', '#dc2626', '#65a30d', '#7c3aed'];

export const DEFAULT_SIZE = 6;
export const DEFAULT_OUTLINE_COLOR = '#000000';
export const DEFAULT_OUTLINE_WIDTH = 0.3;
export const DEFAULT_BUFFER_COLOR = '#000000';
export const DEFAULT_BUFFER_WIDTH = 0.3;
export const DEFAULT_LABEL_FONT = 'Arial';

/** Fontes oferecidas para os rótulos (todas comuns no Windows), com alternativas. */
export const LABEL_FONTS: { name: string; stack: string }[] = [
  { name: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { name: 'Calibri', stack: 'Calibri, Carlito, Arial, sans-serif' },
  { name: 'Segoe UI', stack: '"Segoe UI", Arial, sans-serif' },
  { name: 'Tahoma', stack: 'Tahoma, Verdana, sans-serif' },
  { name: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { name: 'Trebuchet MS', stack: '"Trebuchet MS", Arial, sans-serif' },
  { name: 'Arial Narrow', stack: '"Arial Narrow", Arial, sans-serif' },
  { name: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { name: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { name: 'Courier New', stack: '"Courier New", Courier, monospace' },
  { name: 'Consolas', stack: 'Consolas, "Courier New", monospace' },
];

/** Contorno efetivo dos pontos da camada (null = sem contorno). */
export const pointOutline = (l: LayerStyle) =>
  l.outline === false ? null : (l.outlineColor ?? DEFAULT_OUTLINE_COLOR);

/** Espessura do contorno dos pontos, em px. */
export const pointOutlineWidth = (l: LayerStyle) => l.outlineWidth ?? DEFAULT_OUTLINE_WIDTH;

/** Cor e espessura (px) do contorno do texto dos rótulos. */
export const labelBufferColor = (lab: LabelStyle) => lab.bufferColor ?? DEFAULT_BUFFER_COLOR;
export const labelBufferWidth = (lab: LabelStyle) => lab.bufferWidth ?? DEFAULT_BUFFER_WIDTH;

/** Família (com alternativas) da fonte do rótulo. */
export const labelFontStack = (lab: LabelStyle) =>
  LABEL_FONTS.find((f) => f.name === (lab.font ?? DEFAULT_LABEL_FONT))?.stack ??
  `"${(lab.font ?? DEFAULT_LABEL_FONT).replace(/"/g, '')}", Arial, sans-serif`;

/** `font` do canvas para o rótulo (itálico, negrito, tamanho e família). */
export const labelCanvasFont = (lab: LabelStyle) =>
  `${lab.italic ? 'italic ' : ''}${lab.bold ? 'bold ' : ''}${lab.size}px ${labelFontStack(lab)}`;

export function newLayer(sourceId: string, index: number): LayerStyle {
  return {
    sourceId,
    visible: true,
    expanded: true,
    color: LAYER_COLORS[index % LAYER_COLORS.length],
    size: DEFAULT_SIZE,
    opacity: 0.95,
    categories: {},
    label: {
      enabled: false,
      expression: '',
      size: 11,
      color: '#111827',
      bold: true,
      buffer: true,
      minZoom: 16,
    },
  };
}

// ------------------------------------------------------------------ templates de rótulo
// `label` é sempre o rótulo em uso; com um template ativo, as edições em `label` são gravadas nele
// (syncLabelTemplate) antes de trocar de template ou salvar a camada.

const newTemplateId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Copia o rótulo em uso para o template ativo. */
export function syncLabelTemplate(l: LayerStyle): LayerStyle {
  if (!l.activeLabelTemplate || !l.labelTemplates) return l;
  return {
    ...l,
    labelTemplates: l.labelTemplates.map((t) =>
      t.id === l.activeLabelTemplate ? { ...t, label: l.label } : t,
    ),
  };
}

/** Passa a usar o template `id` (o atual é salvo antes). */
export function switchLabelTemplate(l: LayerStyle, id: string): LayerStyle {
  const s = syncLabelTemplate(l);
  const t = s.labelTemplates?.find((x) => x.id === id);
  return t ? { ...s, label: { ...t.label }, activeLabelTemplate: id } : s;
}

/** Salva o rótulo em uso como um novo template (que passa a ser o ativo). */
export function addLabelTemplate(l: LayerStyle, name: string): LayerStyle {
  const s = syncLabelTemplate(l);
  const t = { id: newTemplateId(), name: name.trim() || 'Template', label: { ...s.label } };
  return { ...s, labelTemplates: [...(s.labelTemplates ?? []), t], activeLabelTemplate: t.id };
}

export function renameLabelTemplate(l: LayerStyle, id: string, name: string): LayerStyle {
  const n = name.trim();
  if (!n) return l;
  return {
    ...l,
    labelTemplates: (l.labelTemplates ?? []).map((t) => (t.id === id ? { ...t, name: n } : t)),
  };
}

/** Exclui o template; se era o ativo, o rótulo em uso continua igual (sem template). */
export function removeLabelTemplate(l: LayerStyle, id: string): LayerStyle {
  return {
    ...l,
    labelTemplates: (l.labelTemplates ?? []).filter((t) => t.id !== id),
    activeLabelTemplate: l.activeLabelTemplate === id ? null : l.activeLabelTemplate,
  };
}

export function quoteField(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

export function defaultLabelExpr(source?: DataSource | null) {
  return quoteField(source?.labelColumn || source?.idColumn || 'ID');
}

/** Rótulos ligados e com expressão (expressão vazia = sem rótulo). */
export const hasLabels = (lab: LabelStyle) => lab.enabled && !!lab.expression.trim();

/** Parâmetros efetivos de consulta da camada (coluna de estilo e expressão de rótulo). */
export function resolveLayer(layer: LayerStyle, source?: DataSource | null) {
  const styleColumn = layer.styleColumn === undefined ? (source?.categoryColumn ?? null) : layer.styleColumn;
  const label = hasLabels(layer.label) ? layer.label.expression.trim() : '';
  return { styleColumn, label };
}

export function categoryStyle(layer: LayerStyle, value: string | null): CategoryStyle {
  const c = layer.categories[catKey(value)];
  return { color: c?.color ?? categoryColor(value), size: c?.size ?? layer.size, visible: c?.visible ?? true };
}

/**
 * Filtros efetivos da camada: os filtros do usuário + categorias ocultas (para que a seleção por
 * região/clique respeite o que está desenhado).
 */
export function effectiveFilters(
  filters: FilterDef[],
  layer: LayerStyle | undefined,
  styleColumn: string | null,
  cats: (string | null)[] | null | undefined,
): FilterDef[] {
  if (!layer || !styleColumn || !cats?.length) return filters;
  const visible = cats.filter((v) => categoryStyle(layer, v).visible);
  if (visible.length === cats.length) return filters;
  return [...filters, { column: styleColumn, op: 'in', values: visible }];
}
