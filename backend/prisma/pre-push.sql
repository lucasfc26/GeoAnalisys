-- Executado antes do "prisma db push": renomeações que o push faria apagando dados.
-- Tabela de Alterações: gis_app.change_log -> gis_app.alteracoes (mantém as linhas).
DO $$
BEGIN
  IF to_regclass('gis_app.change_log') IS NOT NULL AND to_regclass('gis_app.alteracoes') IS NULL THEN
    ALTER TABLE gis_app.change_log RENAME TO alteracoes;
    ALTER INDEX IF EXISTS gis_app.change_log_pkey RENAME TO alteracoes_pkey;
    ALTER INDEX IF EXISTS gis_app.change_log_source_id_record_id_key RENAME TO alteracoes_source_id_record_id_key;
    ALTER INDEX IF EXISTS gis_app.change_log_updated_at_idx RENAME TO alteracoes_updated_at_idx;
    ALTER SEQUENCE IF EXISTS gis_app.change_log_id_seq RENAME TO alteracoes_id_seq;
  END IF;
END $$;

-- Tabela de Alterações por projeto: coluna project_id e a chave única (projeto, fonte, ponto) no
-- lugar de (fonte, ponto). Feito aqui porque o push pediria --accept-data-loss para trocar a chave.
DO $$
BEGIN
  IF to_regclass('gis_app.alteracoes') IS NOT NULL THEN
    ALTER TABLE gis_app.alteracoes ADD COLUMN IF NOT EXISTS project_id TEXT;
    DROP INDEX IF EXISTS gis_app.alteracoes_source_id_record_id_key;
    CREATE UNIQUE INDEX IF NOT EXISTS alteracoes_project_id_source_id_record_id_key
      ON gis_app.alteracoes (project_id, source_id, record_id);
  END IF;
END $$;
