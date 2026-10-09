export function coordKey(x: number, y: number): string {
  return `${x}|${y}`;
}

const nf = new Intl.NumberFormat('pt-BR');
const coordNf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const degNf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 });

export const fmtInt = (n: number) => nf.format(n);
export const fmtCoord = (n: number | null | undefined) => (n === null || n === undefined ? '—' : coordNf.format(n));
export const fmtDeg = (n: number | null | undefined) => (n === null || n === undefined ? '—' : degNf.format(n));

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return nf.format(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function isUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());
}

/** Paleta categórica estável (hash do valor). */
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#c026d3', '#65a30d', '#ea580c', '#4f46e5'];

export function categoryColor(value: string | null | undefined): string {
  if (!value) return '#64748b';
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
