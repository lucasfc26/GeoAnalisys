/**
 * Quais colunas da tabela recebem quais colunas do arquivo (importar dados numa fonte já existente).
 */
import { BadRequestException } from '@nestjs/common';
import type { ColumnMeta } from '../../common/sql';

export interface AppendPlan {
  columns: ColumnMeta[];
  /** Índice da coluna no arquivo, na mesma ordem de `columns` */
  indexes: number[];
}

/** Colunas que podem receber valor vindo do arquivo. */
export function writableColumns(columns: ColumnMeta[]): ColumnMeta[] {
  return columns.filter((c) => !c.readOnly && c.kind !== 'geometry' && c.kind !== 'other');
}

/**
 * `mapping`: nome da coluna da tabela → nome da coluna do arquivo.
 * Colunas em branco são ignoradas. Pelo menos uma associação; obrigatórias (sem nulo e sem padrão)
 * precisam estar associadas.
 */
export function buildAppendPlan(
  columns: ColumnMeta[],
  headers: string[],
  mapping: Record<string, string | null | undefined>,
): AppendPlan {
  const writable = writableColumns(columns);
  const byName = new Map(writable.map((c) => [c.name, c]));
  const headerAt = new Map(headers.map((h, i) => [h, i]));
  const chosen: AppendPlan = { columns: [], indexes: [] };
  for (const [tableCol, fileCol] of Object.entries(mapping ?? {})) {
    if (!fileCol) continue;
    const col = byName.get(tableCol);
    if (!col) {
      throw new BadRequestException(
        `A coluna "${tableCol}" não existe na tabela ou não pode receber dados`,
      );
    }
    const index = headerAt.get(fileCol);
    if (index === undefined) {
      throw new BadRequestException(`A coluna "${fileCol}" não existe no arquivo`);
    }
    chosen.columns.push(col);
    chosen.indexes.push(index);
  }
  if (!chosen.columns.length) {
    throw new BadRequestException('Associe pelo menos uma coluna da tabela a uma coluna do arquivo');
  }
  const missing = writable.filter(
    (c) =>
      !c.nullable &&
      !c.hasDefault &&
      !chosen.columns.some((picked) => picked.name === c.name),
  );
  if (missing.length) {
    throw new BadRequestException(
      `Colunas obrigatórias sem valor: ${missing.map((c) => c.name).join(', ')}`,
    );
  }
  return chosen;
}
