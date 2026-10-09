import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ColumnMeta, kindOf, pgis, setPostgisSchema } from '../../common/sql';

/** Schemas que nunca são oferecidos como fonte de dados. */
const HIDDEN_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast', 'gis_app', 'topology', 'tiger'];
/** Tabelas de sistema do PostGIS. */
const HIDDEN_TABLES = ['spatial_ref_sys', 'geometry_columns', 'geography_columns', 'raster_columns', 'raster_overviews'];

interface RawColumn {
  name: string;
  formatType: string;
  udtName: string;
  nullable: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  identityAlways: boolean;
  isGenerated: boolean;
  position: number;
}

/** Descoberta de estrutura do banco (databases, schemas, tabelas, colunas). */
@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);
  private readonly columnCache = new Map<string, { at: number; cols: ColumnMeta[] }>();
  private static readonly TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ schema: string }[]>(
        `SELECT n.nspname::text AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
          WHERE e.extname = 'postgis'`,
      );
      setPostgisSchema(rows[0]?.schema ?? null);
      this.logger.log(rows[0] ? `PostGIS detectado no schema "${rows[0].schema}"` : 'PostGIS não instalado');
    } catch (err) {
      this.logger.warn(`Não foi possível detectar o PostGIS: ${(err as Error).message}`);
    }
  }

  async info() {
    const [row] = await this.prisma.$queryRawUnsafe<
      { database: string; version: string; user: string; postgis: string | null }[]
    >(
      `SELECT current_database()::text AS database, version()::text AS version, current_user::text AS "user",
              (SELECT extversion::text FROM pg_extension WHERE extname = 'postgis') AS postgis`,
    );
    return row;
  }

  async listDatabases(): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT datname::text AS name FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY 1`,
    );
    return rows.map((r) => r.name);
  }

  async listSchemas(): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT nspname::text AS name FROM pg_namespace
        WHERE nspname <> ALL($1::text[]) AND nspname NOT LIKE 'pg\\_%'
        ORDER BY 1`,
      HIDDEN_SCHEMAS,
    );
    return rows.map((r) => r.name);
  }

  async listTables(schema: string) {
    const rows = await this.prisma.$queryRawUnsafe<
      { name: string; type: string; estimatedRows: number; hasPrimaryKey: boolean }[]
    >(
      `SELECT c.relname::text AS name,
              CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' ELSE 'other' END AS type,
              GREATEST(c.reltuples, 0)::float8 AS "estimatedRows",
              EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary) AS "hasPrimaryKey"
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm')
          AND c.relname <> ALL($2::text[])
        ORDER BY 1`,
      schema,
      HIDDEN_TABLES,
    );
    return rows;
  }

  async tableExists(schema: string, table: string): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<{ ok: number }[]>(
      `SELECT 1 AS ok FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'v', 'm')`,
      schema,
      table,
    );
    return rows.length > 0;
  }

  /** Colunas com tipo, PK, identidade e se são numéricas (cache curto). */
  async getColumns(schema: string, table: string, fresh = false): Promise<ColumnMeta[]> {
    const key = `${schema}.${table}`;
    const cached = this.columnCache.get(key);
    if (!fresh && cached && Date.now() - cached.at < CatalogService.TTL_MS) return cached.cols;

    const rows = await this.prisma.$queryRawUnsafe<RawColumn[]>(
      `SELECT a.attname::text AS name,
              format_type(a.atttypid, a.atttypmod)::text AS "formatType",
              t.typname::text AS "udtName",
              NOT a.attnotnull AS nullable,
              (d.adbin IS NOT NULL OR a.attidentity <> '') AS "hasDefault",
              EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS "isPrimaryKey",
              (a.attidentity <> '') AS "isIdentity",
              (a.attidentity = 'a') AS "identityAlways",
              (a.attgenerated <> '') AS "isGenerated",
              a.attnum::int AS position
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_type t ON t.oid = a.atttypid
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      schema,
      table,
    );
    if (!rows.length) throw new NotFoundException(`Tabela ${schema}.${table} não encontrada`);

    const cols: ColumnMeta[] = rows.map((r) => {
      const kind = kindOf(r.udtName);
      return {
        name: r.name,
        formatType: r.formatType,
        udtName: r.udtName,
        kind,
        nullable: r.nullable,
        hasDefault: r.hasDefault,
        isPrimaryKey: r.isPrimaryKey,
        isIdentity: r.isIdentity,
        isGenerated: r.isGenerated,
        isNumeric: kind === 'integer' || kind === 'number',
        readOnly: r.isGenerated || r.identityAlways || kind === 'geometry',
        position: r.position,
      };
    });
    this.columnCache.set(key, { at: Date.now(), cols });
    return cols;
  }

  /** SRID registrado de uma coluna geométrica (0 quando não definido). */
  async geometrySrid(schema: string, table: string, column: string): Promise<number> {
    const rows = await this.prisma
      .$queryRawUnsafe<{ srid: number }[]>(
        `SELECT srid::int AS srid FROM ${pgis('geometry_columns')}
          WHERE f_table_schema = $1 AND f_table_name = $2 AND f_geometry_column = $3`,
        schema,
        table,
        column,
      )
      .catch(() => [] as { srid: number }[]);
    return rows[0]?.srid ?? 0;
  }

  invalidate(schema: string, table: string) {
    this.columnCache.delete(`${schema}.${table}`);
  }
}
