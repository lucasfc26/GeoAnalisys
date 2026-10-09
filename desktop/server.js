/**
 * Parte do programa desktop que não depende de janelas (testável fora do Electron): conexão ao
 * PostgreSQL, listagem dos bancos, preparação das tabelas internas e início do servidor do sistema.
 */
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const APP_DIR = path.join(__dirname, 'app');
const SCHEMA = path.join(APP_DIR, 'backend', 'prisma', 'schema.prisma');
const PRE_PUSH = path.join(APP_DIR, 'backend', 'prisma', 'pre-push.sql');
const BACKEND_MAIN = path.join(APP_DIR, 'backend', 'dist', 'main.js');
/** Porta fixa (com alternativas se estiver ocupada): o endereço do sistema fica previsível. */
const PORTS = [47800, 47801, 47802, 47803, 47804];

function dbUrl(c, database) {
  const u = encodeURIComponent(c.user);
  const p = encodeURIComponent(c.password ?? '');
  return `postgresql://${u}:${p}@${c.host}:${Number(c.port) || 5432}/${encodeURIComponent(database)}?schema=gis_app&connect_timeout=8`;
}

/** Mensagem curta e em português para os erros mais comuns de conexão. */
function friendlyError(err) {
  const msg = String(err?.message ?? err);
  if (/password authentication failed|Authentication failed|credentials .* not valid|autentica/i.test(msg)) {
    return 'Usuário ou senha inválidos.';
  }
  if (/database .* does not exist|banco de dados .* não existe/i.test(msg)) return 'Banco de dados não encontrado.';
  if (/Can't reach database server|ECONNREFUSED|timed out|ENOTFOUND/i.test(msg)) {
    return 'Não foi possível conectar ao servidor. Verifique servidor/porta e se o PostgreSQL está rodando.';
  }
  if (/permission denied/i.test(msg)) return 'Sem permissão nesse banco (o usuário precisa poder criar o schema gis_app).';
  return msg.split('\n').filter(Boolean).slice(-3).join(' ');
}

/** Bancos disponíveis no servidor (consulta pelo banco "postgres" ou pelo informado). */
async function listDatabases(c) {
  const { PrismaClient } = require('@prisma/client');
  let lastErr;
  for (const db of [...new Set(['postgres', c.database].filter(Boolean))]) {
    const prisma = new PrismaClient({ datasourceUrl: dbUrl(c, db) });
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT datname::text AS name FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY 1`,
      );
      return rows.map((r) => r.name);
    } catch (err) {
      lastErr = err;
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  }
  throw new Error(friendlyError(lastErr));
}

/**
 * Cria/atualiza as tabelas internas do sistema (schema gis_app) no banco escolhido — o mesmo
 * "prisma db push" que o modo web roda ao iniciar. Nunca apaga dados (sem --accept-data-loss).
 */
async function prepareDatabase(url) {
  // Renomeações que o push faria apagando dados (ex.: change_log -> alteracoes).
  await prisma(url, ['db', 'execute', '--file', PRE_PUSH, '--schema', SCHEMA]);
  return prisma(url, ['db', 'push', '--skip-generate', '--schema', SCHEMA]);
}

function prisma(url, args) {
  return new Promise((resolve, reject) => {
    const cli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(friendlyError(out)))));
  });
}

function freePort(ports = PORTS) {
  return new Promise((resolve, reject) => {
    const tryPort = (i) => {
      if (i >= ports.length) return reject(new Error(`Portas ${ports[0]}–${ports.at(-1)} ocupadas.`));
      const srv = net.createServer();
      srv.once('error', () => tryPort(i + 1));
      srv.listen(ports[i], '127.0.0.1', () => srv.close(() => resolve(ports[i])));
    };
    tryPort(0);
  });
}

function waitHealth(origin, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const retry = () =>
      Date.now() > until ? reject(new Error('O servidor interno não respondeu.')) : setTimeout(check, 300);
    const check = () => {
      const req = http.get(`${origin}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => req.destroy());
    };
    check();
  });
}

/** Prepara o banco e sobe o sistema neste processo; devolve a origem (http://127.0.0.1:porta). */
async function startSystem(c, send = () => {}, ports = PORTS) {
  const url = dbUrl(c, c.database);
  send('Preparando o banco (tabelas internas)…');
  await prepareDatabase(url);

  send('Iniciando o sistema…');
  const port = await freePort(ports);
  const origin = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    DATABASE_URL: url,
    PORT: String(port),
    HOST: '127.0.0.1',
    CORS_ORIGIN: origin,
    LOG_JSON: 'false',
  });
  require(BACKEND_MAIN); // sobe o NestJS neste processo
  await waitHealth(origin);
  return origin;
}

module.exports = { dbUrl, friendlyError, listDatabases, prepareDatabase, startSystem };
