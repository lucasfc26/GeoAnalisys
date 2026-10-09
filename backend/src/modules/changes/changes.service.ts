import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { SourceContext } from '../tables/sources.service';
import {
  ChangeAction,
  ChangeEntry,
  attributeColumns,
  mergeUpdate,
  observationLabel,
  xlsxValue,
} from './changes.logic';

type Db = Prisma.TransactionClient | PrismaService;

export interface ChangeRow extends ChangeEntry {
  id: string;
  sourceId: string;
  sourceName: string;
  /** Coluna de ID (registro principal) da fonte */
  idColumn: string | null;
  recordId: string;
  observation: string | null;
  updatedAt: Date;
}

interface PutRow {
  record_id: string;
  action: ChangeAction;
  observation: string | null;
  attributes: string[];
  old_values: unknown[] | null;
  new_values: unknown[] | null;
}

const CHUNK = 2000;

/** Tabela de Alterações (gis_app.alteracoes). As gravações acontecem na transação da edição. */
@Injectable()
export class ChangesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Colunas comparáveis, na ordem da tabela (a geometria acompanha X/Y e fica de fora). */
  private order(ctx: SourceContext) {
    return ctx.columns.filter((c) => c.kind !== 'geometry').map((c) => c.name);
  }

  async logCreate(tx: Db, ctx: SourceContext, ids: string[], observation?: string | null) {
    await this.put(
      tx,
      ctx,
      ids.map((id) => this.plain(id, 'CREATE', observation)),
    );
  }

  async logDelete(tx: Db, ctx: SourceContext, ids: string[], observation?: string | null) {
    await this.put(
      tx,
      ctx,
      ids.map((id) => this.plain(id, 'DELETE', observation)),
    );
  }

  /** Edições (antes → depois) mescladas com o que já houver na tabela para cada ponto. */
  async logUpdate(
    tx: Db,
    ctx: SourceContext,
    changes: { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
  ) {
    if (!changes.length) return;
    const order = this.order(ctx);
    const existing = new Map<string, ChangeEntry>();
    for (let i = 0; i < changes.length; i += CHUNK) {
      const rows = await tx.$queryRawUnsafe<
        {
          record_id: string;
          action: ChangeAction;
          attributes: string[];
          old_values: unknown[] | null;
          new_values: unknown[] | null;
        }[]
      >(
        `SELECT record_id, action, attributes, old_values, new_values FROM alteracoes
          WHERE source_id = $1 AND record_id = ANY($2::text[])`,
        ctx.source.id,
        changes.slice(i, i + CHUNK).map((c) => c.id),
      );
      for (const r of rows) {
        existing.set(r.record_id, {
          action: r.action,
          attributes: r.attributes ?? [],
          oldValues: r.old_values ?? [],
          newValues: r.new_values ?? [],
        });
      }
    }
    const puts: PutRow[] = [];
    const removes: string[] = [];
    for (const c of changes) {
      const prev = existing.get(c.id);
      const r = mergeUpdate(prev, c.before, c.after, order);
      if (r === 'keep') continue;
      if (r === null) {
        if (prev) removes.push(c.id);
        continue;
      }
      puts.push({
        record_id: c.id,
        action: 'UPDATE',
        observation: null,
        attributes: r.attributes,
        old_values: r.oldValues,
        new_values: r.newValues,
      });
    }
    await this.put(tx, ctx, puts);
    for (let i = 0; i < removes.length; i += CHUNK) {
      await tx.$executeRawUnsafe(
        `DELETE FROM alteracoes WHERE source_id = $1 AND record_id = ANY($2::text[])`,
        ctx.source.id,
        removes.slice(i, i + CHUNK),
      );
    }
  }

  private plain(id: string, action: ChangeAction, observation?: string | null): PutRow {
    return {
      record_id: id,
      action,
      observation: observation?.trim() || null,
      attributes: [],
      old_values: null,
      new_values: null,
    };
  }

  /** Insere ou substitui (um ponto = uma linha) em lotes. */
  private async put(tx: Db, ctx: SourceContext, rows: PutRow[]) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.$executeRawUnsafe(
        `INSERT INTO alteracoes (source_id, source_name, record_id, action, observation, attributes, old_values, new_values, created_at, updated_at)
         SELECT $1, $2, t.record_id, t.action, t.observation,
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(t.attributes, '[]'::jsonb))),
                t.old_values, t.new_values, now(), now()
           FROM jsonb_to_recordset($3::jsonb)
             AS t(record_id text, action text, observation text, attributes jsonb, old_values jsonb, new_values jsonb)
         ON CONFLICT (source_id, record_id) DO UPDATE
            SET source_name = EXCLUDED.source_name, action = EXCLUDED.action, observation = EXCLUDED.observation,
                attributes = EXCLUDED.attributes, old_values = EXCLUDED.old_values, new_values = EXCLUDED.new_values,
                updated_at = now()`,
        ctx.source.id,
        ctx.source.name,
        JSON.stringify(rows.slice(i, i + CHUNK)),
      );
    }
  }

  async list(): Promise<ChangeRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: string;
        sourceId: string;
        sourceName: string;
        idColumn: string | null;
        recordId: string;
        action: ChangeAction;
        observation: string | null;
        attributes: string[] | null;
        oldValues: unknown[] | null;
        newValues: unknown[] | null;
        updatedAt: Date;
      }[]
    >(
      `SELECT c.id::text AS id, c.source_id AS "sourceId", COALESCE(d.name, c.source_name) AS "sourceName",
              d."idColumn" AS "idColumn", c.record_id AS "recordId", c.action, c.observation, c.attributes,
              c.old_values AS "oldValues", c.new_values AS "newValues", c.updated_at AS "updatedAt"
         FROM alteracoes c LEFT JOIN data_source d ON d.id = c.source_id
        ORDER BY c.updated_at DESC, c.id DESC`,
    );
    return rows.map((r) => ({
      ...r,
      attributes: r.attributes ?? [],
      oldValues: r.oldValues ?? [],
      newValues: r.newValues ?? [],
    }));
  }

  async clear() {
    const deleted = await this.prisma.$executeRawUnsafe(`DELETE FROM alteracoes`);
    return { deleted };
  }

  /**
   * XLSX: Tabela | ID | Observação | <atributo> old … | <atributo> new … — uma coluna por atributo
   * alterado (em qualquer linha); números como número (o Excel em PT-BR usa a vírgula decimal).
   */
  async exportXlsx(res: Response) {
    const rows = await this.list();
    const attrs = attributeColumns(rows);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GeoAnalisys';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Alterações', { views: [{ state: 'frozen', ySplit: 1 }] });
    const headers = [
      'Tabela',
      'ID',
      'Observação',
      ...attrs.map((a) => `${a} old`),
      ...attrs.map((a) => `${a} new`),
    ];
    sheet.columns = headers.map((h, i) => ({
      header: h,
      width: i === 2 ? 30 : Math.min(Math.max(h.length + 2, 12), 40),
    }));
    sheet.getRow(1).font = { bold: true };
    for (const r of rows) {
      const old = new Map(r.attributes.map((a, i) => [a, r.oldValues[i]]));
      const now = new Map(r.attributes.map((a, i) => [a, r.newValues[i]]));
      sheet.addRow([
        r.sourceName,
        xlsxValue(r.recordId),
        observationLabel(r.action, r.observation, r.attributes),
        ...attrs.map((a) => (old.has(a) ? xlsxValue(old.get(a)) : null)),
        ...attrs.map((a) => (now.has(a) ? xlsxValue(now.get(a)) : null)),
      ]);
    }
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const filename = `alteracoes_${stamp}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    await wb.xlsx.write(res);
    res.end();
  }
}
