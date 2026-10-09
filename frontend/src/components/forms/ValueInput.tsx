import type { ColumnMeta } from '@/types';
import { Input, Select } from '../ui/Field';

/** Converte um valor do banco para o texto exibido no input. */
export function toInputValue(col: ColumnMeta, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (col.kind === 'boolean') return v ? 'true' : 'false';
  if (col.kind === 'datetime' && typeof v === 'string') return v.slice(0, 16);
  if (col.kind === 'json' && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Converte o texto do input para o valor enviado à API (validação básica no cliente). */
export function fromInputValue(col: ColumnMeta, s: string): { value: unknown; error?: string } {
  const t = s.trim();
  if (t === '') {
    if (!col.nullable && !col.hasDefault) return { value: null, error: 'Obrigatório' };
    return { value: col.kind === 'text' && !col.nullable ? '' : null };
  }
  switch (col.kind) {
    case 'integer': {
      const n = Number(t);
      return Number.isInteger(n) ? { value: t } : { value: t, error: 'Número inteiro inválido' };
    }
    case 'number': {
      const n = Number(t.replace(',', '.'));
      return Number.isFinite(n) ? { value: t.replace(',', '.') } : { value: t, error: 'Número inválido' };
    }
    case 'boolean':
      return { value: t === 'true' };
    case 'json':
      try {
        return { value: JSON.parse(t) };
      } catch {
        return { value: t, error: 'JSON inválido' };
      }
    default:
      return { value: s };
  }
}

export function ValueInput({
  col,
  value,
  onChange,
  disabled,
  placeholder,
  list,
}: {
  col: ColumnMeta;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  list?: string;
}) {
  const id = `f-${col.name}`;
  if (col.kind === 'boolean') {
    return (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">—</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </Select>
    );
  }
  if (col.kind === 'json') {
    return (
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        className="block w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs focus:border-accent-500 focus:outline-none"
      />
    );
  }
  const type = col.kind === 'date' ? 'date' : col.kind === 'datetime' ? 'datetime-local' : 'text';
  return (
    <Input
      id={id}
      type={type}
      inputMode={col.kind === 'integer' ? 'numeric' : col.kind === 'number' ? 'decimal' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      list={list}
    />
  );
}
