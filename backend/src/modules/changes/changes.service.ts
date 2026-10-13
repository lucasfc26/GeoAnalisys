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
  concatObservation,
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

  /**
   * Remoções. A linha guarda todos os atributos e valores do ponto (só para desfazer a remoção:
   * não aparecem na tabela nem no XLSX).
   */
  async logDelete(
    tx: Db,
    ctx: SourceContext,
    removed: { id: string; data: Record<string, unknown> }[],
    observation?: string | null,
  ) {
    const order = this.order(ctx);
    await this.put(
      tx,
      ctx,
      removed.map((r) => {
        const attributes = order.filter((k) => k in r.data);
        return {
          ...this.plain(r.id, 'DELETE', observation),
          attributes,
          old_values: attributes.map((k) => r.data[k] ?? null),
        };
      }),
    );
  }

  /** Atributos e valores guardados na remoção do ponto (vazio se a linha não tem). */
  async removedSnapshot(ctx: SourceContext, recordId: string): Promise<Record<string, unknown>> {
    const project = projectFilter('project_id', 3);
    const [row] = await this.prisma.$queryRawUnsafe<
      { attributes: string[] | null; old_values: unknown[] | null }[]
    >(
      `SELECT attributes, old_values FROM alteracoes
        WHERE source_id = $1 AND record_id = $2 AND action = 'DELETE' AND ${project.sql}`,
      ctx.source.id,
      recordId,
      ...project.params,
    );
    const attrs = row?.attributes ?? [];
    return Object.fromEntries(attrs.map((a, i) => [a, row?.old_values?.[i] ?? null]));
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
    const observations = new Map<string, string | null>();
    for (let i = 0; i < changes.length; i += CHUNK) {
      const rows = await tx.$queryRawUnsafe<
        {
          record_id: string;
          action: ChangeAction;
          observation: string | null;
          attributes: string[];
          old_values: unknown[] | null;
          new_values: unknown[] | null;
        }[]
      >(
        `SELECT record_id, action, observation, attributes, old_values, new_values FROM alteracoes
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
        observations.set(r.record_id, r.observation);
      }
    }
    const puts: PutRow[] = [];
    const removes: string[] = [];
    for (const c of changes) {
      const prev = existing.get(c.id);
      const observation = observations.get(c.id)?.trim() || null;
      let r = mergeUpdate(prev, c.before, c.after, order);
      if (r === 'keep') continue;
      // Sem diferenças, a linha some — a não ser que tenha uma observação digitada.
      if (r === null && observation) {
        r = { action: 'UPDATE', attributes: [], oldValues: [], newValues: [] };
      }
      if (r === null) {
        if (prev) removes.push(c.id);
        continue;
      }
      puts.push({
        record_id: c.id,
        action: r.action,
        observation,
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

  /** Remove as linhas dos pontos (desfeitos na mesma transação da edição). */
  async forget(tx: Db, ctx: SourceContext, recordIds: string[]) {
    const project = projectFilter('project_id', 3);
    for (let i = 0; i < recordIds.length; i += CHUNK) {
      await tx.$executeRawUnsafe(
        `DELETE FROM alteracoes WHERE source_id = $1 AND record_id = ANY($2::text[]) AND ${project.sql}`,
        ctx.source.id,
        recordIds.slice(i, i + CHUNK),
        ...project.params,
      );
    }
  }

  /**
   * Acrescenta uma observação à linha do ponto; sem linha, cria uma de alteração só com a
   * observação (anotação manual).
   */
  async appendObservation(tx: Db, ctx: SourceContext, recordId: string, observation: string) {
    const project = projectFilter('project_id', 3);
    const [row] = await tx.$queryRawUnsafe<{ action: ChangeAction; observation: string | null }[]>(
      `SELECT action, observation FROM alteracoes
        WHERE source_id = $1 AND record_id = $2 AND ${project.sql}`,
      ctx.source.id,
      recordId,
      ...project.params,
    );
    if (!row) {
      await this.put(tx, ctx, [this.plain(recordId, 'UPDATE', observation)]);
      return;
    }
    const merged = concatObservation(row.observation, observation);
    if (merged === row.observation) return;
    const upd = projectFilter('project_id', 4);
    await tx.$executeRawUnsafe(
      `UPDATE alteracoes SET observation = $3, updated_at = now()
        WHERE source_id = $1 AND record_id = $2 AND ${upd.sql}`,
      ctx.source.id,
      recordId,
      merged,
      ...upd.params,
    );
  }

  /** Linhas do projeto aberto pelos ids da Tabela de Alterações. */
  async rows(ids: string[]): Promise<ChangeRow[]> {
    if (!ids.length) return [];
    return this.select((p) => `c.id = ANY($${p}::bigint[])`, [ids]);
  }

  /** Limpa linhas da tabela (os pontos não mudam). */
  async forgetRows(ids: string[]) {
    const project = projectFilter('project_id', 2);
    const deleted = await this.prisma.$executeRawUnsafe(
      `DELETE FROM alteracoes WHERE id = ANY($1::bigint[]) AND ${project.sql}`,
      ids,
      ...project.params,
    );
    return { deleted };
  }

  /** Troca (ou, com `append`, acrescenta) a observação das linhas. */
  async setObservation(ids: string[], observation: string, append: boolean) {
    const project = projectFilter('project_id', 3);
    const text = observation.trim() || null;
    const value = append
      ? `CASE WHEN $2::text IS NULL THEN observation
              WHEN COALESCE(btrim(observation), '') = '' THEN $2::text
              WHEN $2::text = ANY(string_to_array(regexp_replace(observation, '\\s*;\\s*', ';', 'g'), ';')) THEN observation
              ELSE observation || '; ' || $2::text END`
      : '$2::text';
    const updated = await this.prisma.$executeRawUnsafe(
      `UPDATE alteracoes SET observation = ${value}, updated_at = now()
        WHERE id = ANY($1::bigint[]) AND ${project.sql}`,
      ids,
      text,
      ...project.params,
    );
    return { updated };
  }

  async list(): Promise<ChangeRow[]> {
    return this.select();
  }

  /** Linhas do projeto aberto; `where` recebe o número do primeiro parâmetro de `params`. */
  private async select(
    where?: (firstParam: number) => string,
    params: unknown[] = [],
  ): Promise<ChangeRow[]> {
    const project = projectFilter('c.project_id', 1);
    const extra = where ? ` AND ${where(project.params.length + 1)}` : '';
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
        WHERE ${project.sql}${extra}
        ORDER BY c.updated_at DESC, c.id DESC`,
      ...project.params,
      ...params,
    );
    // Remoções: os atributos guardados servem só para desfazer; não saem daqui.
    return rows.map((r) =>
      r.action === 'DELETE'
        ? { ...r, attributes: [], oldValues: [], newValues: [] }
        : {
            ...r,
            attributes: r.attributes ?? [],
            oldValues: r.oldValues ?? [],
            newValues: r.newValues ?? [],
          },
    );
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
