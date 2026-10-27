import { copyFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CrsService } from '../maps/crs.service';
import { ImportJobStatus, LayersService } from './layers.service';

/** Importação de ponta a ponta com o banco simulado: guarda os comandos SQL e as linhas gravadas. */
function setup() {
  const sql: string[] = [];
  let inserted = 0;
  let insertDelay = 0;
  const prisma = {
    $executeRawUnsafe: async (q: string, ...args: unknown[]) => {
      sql.push(q.replace(/\s+/g, ' ').trim());
      if (q.includes('jsonb_to_recordset')) {
        if (insertDelay) await new Promise((r) => setTimeout(r, insertDelay));
        const n = (JSON.parse(args[0] as string) as unknown[]).length;
        inserted += n;
        return n;
      }
      return 0;
    },
  };
  const sources = {
    create: async (dto: { name: string }) => ({ id: 'src-1', name: dto.name }),
    createIndexes: async () => undefined,
  };
  const catalog = { tableExists: async () => false, schemas: async () => ['GeoAnalisysTemp'] };
  const service = new LayersService(
    prisma as never,
    sources as never,
    catalog as never,
    new CrsService(),
  );
  // Schema de destino sem consultar o banco.
  (service as unknown as { targetSchema: () => Promise<string> }).targetSchema = async () =>
    'GeoAnalisysTemp';
  return {
    service,
    sql,
    inserted: () => inserted,
    slowInserts: (ms: number) => (insertDelay = ms),
  };
}

async function waitJob(service: LayersService, id: string): Promise<ImportJobStatus> {
  for (;;) {
    const s = service.importStatus(id, 'u');
    if (s.phase === 'done' || s.phase === 'error' || s.phase === 'cancelled') return s;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('importação de camada em segundo plano', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'geo-layers-test-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Simula o upload: o serviço apaga o arquivo depois de importar, então cada teste usa uma cópia. */
  const stored = (name: string, content: string) => {
    const src = join(dir, `orig-${name}`);
    writeFileSync(src, content, 'utf8');
    const path = join(dir, `${Date.now()}-${Math.random()}-${name}`);
    copyFileSync(src, path);
    return { originalname: name, path, size: statSync(path).size };
  };

  const config = {
    name: 'Postes',
    idColumn: 'id',
    xColumn: 'x',
    yColumn: 'y',
    coordinateSystem: 'EPSG:31984',
  };

  it('prévia lê só o começo; importação grava tudo em partes e alarga o tipo que não cabe', async () => {
    const lines = ['id;x;y;codigo;obs'];
    for (let i = 1; i <= 12_000; i++) {
      // "codigo" parece inteiro nas primeiras linhas; perto do fim aparece texto.
      lines.push(`${i};${550000 + i},5;9580000;${i > 11_000 ? `A${i}` : i};`);
    }
    const { service, sql, inserted } = setup();
    const p = await service.preview(stored('postes.csv', lines.join('\n')), null, null);
    expect(p.total).toBeNull();
    expect(p.rows).toHaveLength(20);
    expect(p.types[3]).toBe('integer');

    const { jobId } = await service.startImport(p.uploadId, config as never, 'u');
    const done = await waitJob(service, jobId);
    expect(done.error).toBeUndefined();
    expect(done.phase).toBe('done');
    expect(done.rows).toBe(12_000);
    expect(inserted()).toBe(12_000);
    expect(done.result?.invalid).toEqual({});
    expect(sql.some((q) => /ALTER TABLE .* ALTER COLUMN "codigo" TYPE text/.test(q))).toBe(true);
    expect(sql.filter((q) => q.includes('jsonb_to_recordset')).length).toBe(3);
    // O arquivo enviado é apagado depois de importar.
    expect(() => service.importStatus(jobId, 'outro')).toThrow();
  });

  it('tipo escolhido pelo usuário fica fixo: o que não cabe fica vazio', async () => {
    const lines = ['id;x;y;codigo'];
    for (let i = 1; i <= 100; i++) lines.push(`${i};550000;9580000;${i === 50 ? 'abc' : i}`);
    const { service, sql } = setup();
    const p = await service.preview(stored('fixo.csv', lines.join('\n')), null, null);
    expect(p.total).toBe(100);
    const { jobId } = await service.startImport(
      p.uploadId,
      { ...config, types: { codigo: 'integer' } } as never,
      'u',
    );
    const done = await waitJob(service, jobId);
    expect(done.phase).toBe('done');
    expect(done.result?.invalid).toEqual({ codigo: 1 });
    expect(sql.some((q) => q.includes('ALTER TABLE'))).toBe(false);
  });

  it('erro de configuração volta na hora; cancelar apaga a tabela', async () => {
    const lines = ['id;x;y'];
    for (let i = 1; i <= 30_000; i++) lines.push(`${i};550000;9580000`);
    const { service, sql, slowInserts } = setup();
    const p = await service.preview(stored('cancelar.csv', lines.join('\n')), null, null);
    await expect(
      service.startImport(p.uploadId, { ...config, xColumn: 'nao_existe' } as never, 'u'),
    ).rejects.toThrow('Escolha as colunas de X e Y');

    slowInserts(30);
    const { jobId } = await service.startImport(p.uploadId, config as never, 'u');
    service.cancelImport(jobId, 'u');
    const done = await waitJob(service, jobId);
    expect(done.phase).toBe('cancelled');
    expect(sql.at(-1)).toMatch(/^DROP TABLE IF EXISTS/);
  });
});
