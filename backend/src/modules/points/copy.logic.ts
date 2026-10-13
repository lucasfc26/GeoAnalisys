/**
 * Cópia de registros para outra camada (sem banco, testável): valor de uma coluna de origem
 * convertido para o tipo da coluna de destino.
 */
import { parseNumber } from '../../common/coords';
import type { ColumnMeta } from '../../common/sql';

const TRUE = /^(true|t|1|s|sim|y|yes|verdadeiro)$/i;
const FALSE = /^(false|f|0|n|n[aã]o|no|falso)$/i;

/**
 * Valor para gravar em `col`; `invalid` quando havia valor mas ele não cabe no tipo da coluna
 * (fica vazio, em vez de falhar a cópia inteira).
 */
export function coerceFor(col: ColumnMeta, v: unknown): { value: unknown; invalid: boolean } {
  if (v === null || v === undefined || v === '') return { value: null, invalid: false };
  const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
  const bad = { value: null, invalid: true };
  switch (col.kind) {
    case 'integer': {
      // Inteiro em texto passa como texto (CAST no banco), sem perder dígitos de bigint.
      if (/^\s*-?\d+\s*$/.test(text)) return { value: text.trim(), invalid: false };
      const n = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : parseNumber(text);
      return n !== null && Number.isFinite(n) && Number.isInteger(n)
        ? { value: n, invalid: false }
        : bad;
    }
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : parseNumber(text);
      return n !== null && Number.isFinite(n) ? { value: n, invalid: false } : bad;
    }
    case 'boolean':
      if (typeof v === 'boolean') return { value: v, invalid: false };
      if (TRUE.test(text.trim())) return { value: true, invalid: false };
      if (FALSE.test(text.trim())) return { value: false, invalid: false };
      return bad;
    case 'date':
    case 'datetime': {
      const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(text.trim());
      const d = new Date(
        br ? `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}${br[4]}` : text,
      );
      if (Number.isNaN(d.getTime())) return bad;
      return {
        value: col.kind === 'date' ? d.toISOString().slice(0, 10) : d.toISOString(),
        invalid: false,
      };
    }
    case 'json':
      return { value: v, invalid: false };
    default:
      return { value: text, invalid: false };
  }
}
