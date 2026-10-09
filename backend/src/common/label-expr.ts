import { BadRequestException } from '@nestjs/common';
import { ColumnMeta, Params, qi } from './sql';

/**
 * Expressões de rótulo no estilo QGIS: campos entre aspas duplas, textos entre aspas simples,
 * unidos por `||` (ou `+`). Ex.: "ID" || ' ' || "tipo_lampada" || ' ' || "potencia".
 *
 * A expressão nunca é concatenada no SQL: campos são validados contra o catálogo e textos viram parâmetros.
 * Valores nulos viram texto vazio (como concat do PostgreSQL).
 */

export const MAX_LABEL_EXPR = 500;

export type LabelToken = { t: 'field'; v: string } | { t: 'text'; v: string } | { t: 'concat' };

export function tokenizeLabel(expr: string): LabelToken[] {
  const out: LabelToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '|' && expr[i + 1] === '|') {
      out.push({ t: 'concat' });
      i += 2;
      continue;
    }
    if (c === '+') {
      out.push({ t: 'concat' });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let v = '';
      i++;
      for (;;) {
        if (i >= expr.length) throw new BadRequestException(`Aspas ${c} não fechadas na expressão de rótulo`);
        if (expr[i] === c) {
          if (expr[i + 1] === c) {
            v += c;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += expr[i++];
      }
      out.push(c === '"' ? { t: 'field', v } : { t: 'text', v });
      continue;
    }
    const rest = expr.slice(i);
    const num = /^-?\d+(?:[.,]\d+)?/.exec(rest);
    if (num) {
      out.push({ t: 'text', v: num[0] });
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_À-ſ][\wÀ-ſ]*/.exec(rest);
    if (ident) {
      out.push({ t: 'field', v: ident[0] });
      i += ident[0].length;
      continue;
    }
    throw new BadRequestException(`Caractere inesperado "${c}" na posição ${i + 1} da expressão de rótulo`);
  }
  return out;
}

/** Converte a expressão em SQL seguro (texto). Retorna null quando a expressão está vazia. */
export function labelSql(expr: string | undefined, colMap: Map<string, ColumnMeta>, params: Params): string | null {
  const src = (expr ?? '').trim();
  if (!src) return null;
  if (src.length > MAX_LABEL_EXPR) {
    throw new BadRequestException(`Expressão de rótulo muito longa (máx. ${MAX_LABEL_EXPR} caracteres)`);
  }
  const parts: string[] = [];
  let expectOperand = true;
  // `||` sobrando (no início, no fim ou repetido) é ignorado: `|| ' ' ||` vira só o espaço.
  for (const tok of tokenizeLabel(src)) {
    if (tok.t === 'concat') {
      expectOperand = true;
      continue;
    }
    if (!expectOperand) throw new BadRequestException('Expressão de rótulo: use || para juntar campos e textos');
    if (tok.t === 'field') {
      const col = colMap.get(tok.v);
      if (!col) throw new BadRequestException(`Campo desconhecido na expressão de rótulo: "${tok.v}"`);
      if (col.kind === 'geometry') throw new BadRequestException(`Campo geométrico "${tok.v}" não pode ser usado no rótulo`);
      parts.push(`${qi(col.name)}::text`);
    } else {
      parts.push(`CAST(${params.add(tok.v)} AS text)`);
    }
    expectOperand = false;
  }
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `concat(${parts.join(', ')})`;
}
