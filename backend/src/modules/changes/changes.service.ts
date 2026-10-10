import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { currentProjectId } from '../../common/project-context';
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

/**
 * Filtro do projeto atual sobre a coluna project_id (`IS NULL` sem projeto aberto, para usar o
 * índice) e o parâmetro correspondente, se houver.
 */
function projectFilter(column: string, param: number): { sql: string; params: string[] } {
  const id = currentProjectId();
  return id
    ? { sql: `${column} = $${param}`, params: [id] }
    : { sql: `${column} IS NULL`, params: [] };
}

/**
 * Tabela de Alterações (gis_app.alteracoes), separada pelo projeto aberto (x-project-id). As
 * gravações acontecem na transação da edição.
 */
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
    const project = projectFilter('project_id', 3);
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
          WHERE source_id = $1 AND record_id = ANY($2::text[]) AND ${project.sql}`,
        ctx.source.id,
        changes.slice(i, i + CHUNK).map((c) => c.id),
        ...project.params,
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
        `DELETE FROM alteracoes WHERE source_id = $1 AND record_id = ANY($2::text[]) AND ${project.sql}`,
        ctx.source.id,
        removes.slice(i, i + CHUNK),
        ...project.params,
      );
    }
  }

  /**
   * Pontos removidos (DELETE na Tabela de Alterações do projeto aberto) entre os ids informados:
   * id → justificativa da remoção.
   */
  async removed(sourceId: string, recordIds: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const project = projectFilter('project_id', 3);
    for (let i = 0; i < recordIds.length; i += CHUNK) {
      const rows = await this.prisma.$queryRawUnsafe<
        { record_id: string; observation: string | null }[]
      >(
        `SELECT record_id, observation FROM alteracoes
          WHERE source_id = $1 AND action = 'DELETE' AND record_id = ANY($2::text[]) AND ${project.sql}`,
        sourceId,
        recordIds.slice(i, i + CHUNK),
        ...project.params,
      );
      for (const r of rows) out.set(r.record_id, r.observation);
    }
    return out;
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

  /**
   * Insere ou substitui (um ponto = uma linha por projeto) em lotes. Sem ON CONFLICT: a chave única
   * inclui project_id, que é null sem projeto aberto (nulls não colidem no índice).
   */
  private async put(tx: Db, ctx: SourceContext, rows: PutRow[]) {
    const projectId = currentProjectId();
    // $4 = id do projeto (ou null), usado no filtro e na inserção.
    const project = projectFilter('a.project_id', 4);
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.$executeRawUnsafe(
        `WITH t AS (
           SELECT t.record_id, t.action, t.observation,
                  ARRAY(SELECT jsonb_array_elements_text(COALESCE(t.attributes, '[]'::jsonb))) AS attributes,
                  t.old_values, t.new_values
             FROM jsonb_to_recordset($3::jsonb)
               AS t(record_id text, action text, observation text, attributes jsonb, old_values jsonb, new_values jsonb)
         ), upd AS (
           UPDATE alteracoes a
              SET source_name = $2, action = t.action, observation = t.observation,
                  attributes = t.attributes, old_values = t.old_values, new_values = t.new_values,
                  updated_at = now()
             FROM t
            WHERE a.source_id = $1 AND a.record_id = t.record_id AND ${project.sql}
           RETURNING a.record_id
         )
         INSERT INTO alteracoes (project_id, source_id, source_name, record_id, action, observation, attributes, old_values, new_values, created_at, updated_at)
         SELECT $4::text, $1, $2, t.record_id, t.action, t.observation, t.attributes,
                t.old_values, t.new_values, now(), now()
           FROM t
          WHERE NOT EXISTS (SELECT 1 FROM upd WHERE upd.record_id = t.record_id)`,
        ctx.source.id,
        ctx.source.name,
        JSON.stringify(rows.slice(i, i + CHUNK)),
        projectId,
      );
    }
  }

  async list(): Promise<ChangeRow[]> {
    const project = projectFilter('c.project_id', 1);
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
        WHERE ${project.sql}
        ORDER BY c.updated_at DESC, c.id DESC`,
      ...project.params,
    );
    return rows.map((r) => ({
      ...r,
      attributes: r.attributes ?? [],
      oldValues: r.oldValues ?? [],
      newValues: r.newValues ?? [],
    }));
  }

  /** Limpa só as alterações do projeto aberto. */
  async clear() {
    const project = projectFilter('project_id', 1);
    const deleted = await this.prisma.$executeRawUnsafe(
      `DELETE FROM alteracoes WHERE ${project.sql}`,
      ...project.params,
    );
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
