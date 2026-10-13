import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DataSource } from '@prisma/client';
import { extname } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Cell,
  decodeText,
  parseCsv,
  readWorkbook,
  sheetRows,
  toNumber,
} from '../layers/import.parse';
import type { Upload } from '../layers/layers.service';
import { PointsService } from '../points/points.service';
import { SourceContext, SourcesService } from '../tables/sources.service';
import { importColumns, parseChangeList, removalObservation } from './changes.logic';
import { ChangeRow, ChangesService } from './changes.service';

export interface ChangeActionError {
  id: string;
  recordId: string;
  sourceName: string;
  message: string;
}

export interface ChangeImportResult {
  rows: number;
  applied: number;
  /** Pontos removidos (observação "Removido…") */
  removed: number;
  unchanged: number;
  errors: { line: number; message: string }[];
}

/** Erros listados na resposta da importação (o total é `rows - applied - removed - unchanged`). */
const MAX_ERRORS = 200;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Ações sobre linhas da Tabela de Alterações que mexem nos pontos (rollback, edição, importação).
 * Separado de ChangesService porque PointsService depende dele.
 */
@Injectable()
export class ChangeActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ChangesService,
    private readonly points: PointsService,
    private readonly sources: SourcesService,
  ) {}

  /**
   * Volta cada ponto ao estado original: alteração → valores antigos; adicionado → removido;
   * removido → recriado com os dados do histórico. A linha sai da tabela.
   */
  async rollback(ids: string[], userId: string) {
    const rows = await this.changes.rows(ids);
    const errors: ChangeActionError[] = [];
    let done = 0;
    for (const row of rows) {
      try {
        await this.rollbackRow(row, userId);
        done++;
      } catch (e) {
        errors.push({
          id: row.id,
          recordId: row.recordId,
          sourceName: row.sourceName,
          message: message(e),
        });
      }
    }
    return { done, errors };
  }

  private async rollbackRow(row: ChangeRow, userId: string) {
    if (row.action === 'CREATE') {
      await this.points.remove(row.sourceId, row.recordId, userId, undefined, {
        forgetChange: true,
      });
      return;
    }
    if (row.action === 'DELETE') {
      await this.points.restoreDeleted(row.sourceId, row.recordId, userId);
      return;
    }
    if (row.attributes.length) {
      const old = Object.fromEntries(row.attributes.map((a, i) => [a, row.oldValues[i] ?? null]));
      await this.points.update(row.sourceId, row.recordId, old, userId);
    }
    await this.changes.forgetRows([row.id]);
  }

  /** Edição de uma linha: novos valores aplicados ao ponto e/ou observação substituída. */
  async edit(
    id: string,
    dto: { observation?: string | null; values?: Record<string, unknown> },
    userId: string,
  ) {
    const [row] = /^\d+$/.test(id) ? await this.changes.rows([id]) : [];
    if (!row) throw new NotFoundException('Linha não encontrada na Tabela de Alterações');
    const values = dto.values ?? {};
    if (Object.keys(values).length) {
      if (row.action === 'DELETE') {
        throw new BadRequestException('O ponto foi removido: só a observação pode ser editada');
      }
      await this.points.update(row.sourceId, row.recordId, values, userId);
    }
    if (dto.observation !== undefined) {
      await this.changes.setObservation([id], dto.observation ?? '', false);
    }
    const [updated] = await this.changes.rows([id]);
    return updated ?? null;
  }

  /**
   * Importa alterações de uma planilha (Tabela, ID, Observação, Atributos Alterados, Valores Novos).
   * Os valores novos são gravados nos pontos — a Tabela de Alterações acompanha (atributo igual ao
   * original sai da lista) — e a observação é acrescentada à existente.
   */
  async import(file: Upload | undefined, userId: string): Promise<ChangeImportResult> {
    const rows = await this.readFile(file);
    if (rows.length < 2) throw new BadRequestException('A planilha não tem linhas de dados');
    const headers = rows[0].map((h) => String(h ?? '').trim());
    const cols = importColumns(headers);
    if (cols.table < 0 || cols.id < 0) {
      throw new BadRequestException('A planilha precisa das colunas "Tabela" e "ID"');
    }
    if (cols.attributes < 0 && cols.observation < 0) {
      throw new BadRequestException(
        'A planilha precisa de "Atributos Alterados" e "Valores Novos" ou de "Observacao"',
      );
    }

    const sources = await this.sources.list();
    const findSource = this.sourceFinder(sources);
    const contexts = new Map<string, SourceContext>();
    const result: ChangeImportResult = {
      rows: 0,
      applied: 0,
      removed: 0,
      unchanged: 0,
      errors: [],
    };
    const fail = (line: number, msg: string) => {
      if (result.errors.length < MAX_ERRORS) result.errors.push({ line, message: msg });
    };

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const line = r + 1;
      const cell = (i: number): Cell => (i >= 0 ? (row[i] ?? null) : null);
      const tableName = String(cell(cols.table) ?? '').trim();
      const recordId = String(cell(cols.id) ?? '').trim();
      if (!tableName && !recordId) continue;
      result.rows++;
      try {
        if (!tableName) throw new Error('Tabela não informada');
        if (!recordId) throw new Error('ID não informado');
        const source = findSource(tableName);
        if (!source) throw new Error(`Tabela "${tableName}" não encontrada`);
        let ctx = contexts.get(source.id);
        if (!ctx) {
          ctx = await this.sources.context(source.id);
          contexts.set(source.id, ctx);
        }

        const observation = String(cell(cols.observation) ?? '').trim();
        const removedBefore = (await this.changes.removed(source.id, [recordId])).has(recordId);
        const removal = removalObservation(observation);
        if (removal !== undefined) {
          if (removedBefore) {
            result.unchanged++;
            continue;
          }
          await this.existing(source.id, recordId);
          await this.points.remove(source.id, recordId, userId, removal ?? undefined);
          result.removed++;
          continue;
        }

        const values = this.rowValues(ctx, cell(cols.attributes), cell(cols.values));
        if (!Object.keys(values).length && !observation) {
          result.unchanged++;
          continue;
        }
        if (removedBefore) throw new Error(`O registro ${recordId} foi removido`);
        const before = await this.existing(source.id, recordId);
        let changed = false;
        if (Object.keys(values).length) {
          const after = await this.points.update(source.id, recordId, values, userId);
          changed = Object.keys(values).some(
            (k) => JSON.stringify(before.data[k] ?? null) !== JSON.stringify(after.data[k] ?? null),
          );
        }
        if (observation) {
          await this.changes.appendObservation(this.prisma, ctx, recordId, observation);
          changed = true;
        }
        if (changed) result.applied++;
        else result.unchanged++;
      } catch (e) {
        fail(line, message(e));
      }
    }
    return result;
  }

  /** Ponto que já existe na camada (a importação não cria pontos). */
  private async existing(sourceId: string, recordId: string) {
    try {
      return await this.points.findOne(sourceId, recordId);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw new Error(
          `O ponto ${recordId} não existe na camada (a importação só altera ou remove pontos)`,
        );
      }
      throw e;
    }
  }

  /** Atributo → valor novo de uma linha da planilha (item vazio = valor vazio). */
  private rowValues(
    ctx: SourceContext,
    attributesCell: Cell,
    valuesCell: Cell,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const column = (name: string) => {
      const exact = ctx.colMap.get(name);
      if (exact) return exact;
      const lower = name.toLowerCase();
      const found = ctx.columns.find((c) => c.name.toLowerCase() === lower);
      if (!found) throw new Error(`Atributo "${name}" não existe em ${ctx.source.name}`);
      return found;
    };
    const put = (name: string, raw: unknown) => {
      const col = column(name);
      let value: unknown = raw === '' || raw === undefined ? null : raw;
      if (typeof value === 'string' && (col.kind === 'number' || col.kind === 'integer')) {
        value = toNumber(value) ?? value;
      }
      if (typeof value === 'number' && col.kind === 'text') value = String(value);
      out[col.name] = value;
    };

    const attributes = parseChangeList(attributesCell).map((a) => String(a ?? '').trim());
    if (attributes.some((a) => !a)) throw new Error('Atributo vazio em "Atributos Alterados"');
    const values = parseChangeList(valuesCell);
    if (attributes.length) {
      if (values.length !== attributes.length) {
        throw new Error(
          `"Atributos Alterados" tem ${attributes.length} item(ns) e "Valores Novos" tem ${values.length}` +
            ' (use ";" para separar valores que tenham vírgula)',
        );
      }
      attributes.forEach((a, i) => put(a, values[i]));
    } else if (values.length) {
      throw new Error('"Valores Novos" sem "Atributos Alterados"');
    }
    return out;
  }

  /** Fonte pelo nome exibido, pelo nome da tabela ou por "schema.tabela" (sem diferenciar maiúsculas). */
  private sourceFinder(sources: DataSource[]) {
    const byKey = new Map<string, DataSource>();
    const add = (key: string, s: DataSource) => {
      const k = key.trim().toLowerCase();
      if (k && !byKey.has(k)) byKey.set(k, s);
    };
    for (const s of sources) add(s.name, s);
    for (const s of sources) add(`${s.schema}.${s.tableName}`, s);
    for (const s of sources) add(s.tableName, s);
    return (name: string) => byKey.get(name.trim().toLowerCase());
  }

  private async readFile(file: Upload | undefined): Promise<Cell[][]> {
    if (!file?.buffer?.length)
      throw new BadRequestException('Envie um arquivo .xlsx, .xlsm ou .csv');
    const ext = extname(file.originalname || '').toLowerCase();
    if (ext === '.xlsx' || ext === '.xlsm') {
      const wb = await readWorkbook(file.buffer).catch((e: Error) => {
        throw new BadRequestException(e.message);
      });
      const ws = wb.worksheets[0];
      if (!ws) throw new BadRequestException('A planilha está vazia');
      return sheetRows(ws);
    }
    if (ext === '.csv' || ext === '.txt' || ext === '.tsv')
      return parseCsv(decodeText(file.buffer));
    if (ext === '.xls') {
      throw new BadRequestException(
        'Arquivos .xls antigos não são suportados: salve como .xlsx ou .csv',
      );
    }
    throw new BadRequestException('Formato não suportado: use .xlsx, .xlsm ou .csv');
  }
}
