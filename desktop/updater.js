/**
 * Atualização automática da pasta do programa (win-unpacked ou pasta instalada), sem precisar de admin.
 *
 * 1. Ao abrir, lê o latest.json do repositório público. Se a versão for maior que a deste programa,
 *    baixa o zip da versão do Release do GitHub (GeoAnalisys-<versão>-win.zip) e extrai numa pasta ao
 *    lado da pasta do programa ("<pasta>.update").
 * 2. Abre o GeoAnalisys.exe NOVO, de dentro dessa pasta, com --apply-update: ele espera este processo
 *    fechar, copia os arquivos por cima da pasta antiga (sem apagar projetos nem arquivos do usuário)
 *    e reabre o programa atualizado.
 * 3. O programa atualizado apaga a pasta ".update" ao abrir.
 *
 * Qualquer falha (sem internet, GitHub bloqueado, release ainda não publicado) só pula a atualização.
 */
const { app, BrowserWindow, dialog, ipcMain, net } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'lucasfc26/GeoAnalisys';
const LATEST_URL = process.env.GEOANALISYS_LATEST_URL || `https://raw.githubusercontent.com/${REPO}/main/latest.json`;
const zipUrl = (v) => `https://github.com/${REPO}/releases/download/v${v}/GeoAnalisys-${v}-win.zip`;

const appDir = path.dirname(process.execPath);
const exeName = path.basename(process.execPath);
// Sem isto um exe aberto a partir de um terminal do VS Code rodaria como Node puro.
const childEnv = () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
/**
 * Onde baixar e extrair a versão nova: ao lado da pasta do programa ("<pasta>.update") ou, quando
 * não dá para escrever ali (programa direto em C:\, por exemplo), na pasta temporária do usuário.
 */
const besideDir = `${appDir}.update`;
const tempDir = () => path.join(app.getPath('temp'), 'GeoAnalisys-update');
let updateDir = besideDir;
let zipFile = `${besideDir}.zip`;

function chooseWorkDir() {
  if (canWrite(path.dirname(appDir))) {
    updateDir = besideDir;
    zipFile = `${besideDir}.zip`;
  } else {
    updateDir = tempDir();
    zipFile = `${tempDir()}.zip`;
  }
}

/** Registro em %APPDATA%GeoAnalisysatualizacao.log, para diagnosticar falhas no computador do usuário. */
function log(...parts) {
  try {
    const file = path.join(app.getPath('appData'), 'GeoAnalisys', 'atualizacao.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = `${new Date().toISOString()} [${process.pid}] ${parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}
`;
    fs.appendFileSync(file, line);
  } catch {
    /* sem log */
  }
}

function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function canWrite(dir) {
  const probe = path.join(dir, `.geo-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Confere que a pasta é mesmo a do GeoAnalisys antes de espelhar arquivos nela. */
function isAppFolder(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'resources', 'app', 'package.json'), 'utf8'));
    return pkg.name === 'geoanalisys-desktop';
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await net.fetch(url, { signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------------ janela de progresso

let win = null;
const send = (msg) => win && !win.isDestroyed() && win.webContents.send('update', msg);

function openWindow(title) {
  win = new BrowserWindow({
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    width: 480,
    height: 250,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.on('page-title-updated', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'updater.html'));
  return new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
}

/** Mostra o erro e espera o usuário clicar em "Continuar" (ou fechar a janela). */
function failAndWait(error) {
  send({ step: 'error', error });
  return new Promise((resolve) => {
    const done = () => {
      ipcMain.removeAllListeners('update:continue');
      if (win && !win.isDestroyed()) {
        win.removeAllListeners('closed');
        win.close();
      }
      win = null;
      resolve();
    };
    ipcMain.once('update:continue', done);
    win.once('closed', done);
  });
}

// ------------------------------------------------------------------ etapas

async function download(res, version) {
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(zipFile);
  let got = 0;
  let last = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - last > 150) {
        last = Date.now();
        send({ step: 'download', version, done: got, total });
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (total && got !== total) throw new Error('Download incompleto. Verifique a conexão e abra o programa de novo.');
}

/** Extrai com o tar do Windows (bsdtar, lê zip), contando os arquivos para a barra de progresso. */
function extract(version) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return new Promise((resolve, reject) => {
    execFile(tar, ['-tf', zipFile], { maxBuffer: 64 * 1024 * 1024 }, (err, list) => {
      if (err) return reject(new Error('Não foi possível ler o arquivo baixado.'));
      const total = list.split('\n').filter(Boolean).length;
      const p = spawn(tar, ['-xvf', zipFile, '-C', updateDir], { windowsHide: true });
      let n = 0;
      const count = (buf) => {
        n += String(buf).split('\n').length - 1;
        send({ step: 'extract', version, done: n, total });
      };
      p.stdout.on('data', count);
      p.stderr.on('data', count);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Falha ao extrair (código ${code}).`))));
    });
  });
}

/** Pasta do programa dentro do zip: a raiz ou uma única subpasta com o executável. */
function extractedRoot() {
  if (fs.existsSync(path.join(updateDir, exeName))) return updateDir;
  const subs = fs.readdirSync(updateDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  if (subs.length === 1 && fs.existsSync(path.join(updateDir, subs[0].name, exeName))) {
    return path.join(updateDir, subs[0].name);
  }
  throw new Error('O pacote baixado não contém o GeoAnalisys.exe.');
}

/**
 * Procura e baixa uma versão nova. Retorna true se a atualização foi iniciada (o programa deve sair
 * imediatamente); false para seguir abrindo a versão atual.
 */
async function checkAndDownload() {
  if (!app.isPackaged || process.env.GEOANALISYS_NO_UPDATE) return false;

  // Resto de uma atualização anterior (o exe novo já terminou de copiar e saiu). Cancelado se uma
  // atualização nova começar, para não apagar o download em andamento.
  const cleanup = setTimeout(() => {
    for (const p of [besideDir, `${besideDir}.zip`, tempDir(), `${tempDir()}.zip`]) {
      fs.rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }, () => {});
    }
  }, 5000);

  let latest;
  let res;
  try {
    const r = await fetchWithTimeout(LATEST_URL.startsWith('http') ? `${LATEST_URL}?t=${Date.now()}` : LATEST_URL, 5000);
    if (!r.ok) {
      log('latest.json: HTTP', r.status);
      return false;
    }
    latest = await r.json();
    if (!latest?.version || !newer(latest.version, app.getVersion())) return false;
    if (!canWrite(appDir)) {
      log('sem permissão de escrita em', appDir);
      // Avisa (antes pulava em silêncio) e segue abrindo a versão atual.
      await dialog.showMessageBox({
        type: 'warning',
        title: 'GeoAnalisys — atualização',
        message: `Há uma versão nova (${latest.version}), mas não foi possível atualizar.`,
        detail:
          `O Windows não permite gravar na pasta do programa:\n${appDir}\n\n` +
          'Mova a pasta do GeoAnalisys para um local seu (ex.: Documentos ou C:\\Users\\<você>) ' +
          `ou baixe a versão ${latest.version} manualmente. O programa vai abrir na versão atual ` +
          `(${app.getVersion()}).`,
      });
      return false;
    }
    chooseWorkDir();
    // Só mostra a tela se o release realmente existe.
    const url = latest.url || zipUrl(latest.version);
    res = await fetchWithTimeout(url, 10000);
    if (!res.ok) {
      log(url, 'HTTP', res.status);
      return false;
    }
  } catch (err) {
    log('verificação falhou:', err);
    return false;
  }

  clearTimeout(cleanup);
  const version = latest.version;
  log(`atualizando ${app.getVersion()} → ${version} em`, appDir);
  await openWindow(`GeoAnalisys — Atualizando para ${version}`);
  try {
    send({ step: 'download', version, done: 0, total: 0 });
    fs.rmSync(updateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    fs.mkdirSync(updateDir, { recursive: true });
    await download(res, version);
    send({ step: 'extract', version, done: 0, total: 0 });
    await extract(version);
    fs.rm(zipFile, { force: true }, () => {});
    const root = extractedRoot();
    send({ step: 'install', version });
    spawn(path.join(root, exeName), ['--apply-update', `--target=${appDir}`, `--wait-pid=${process.pid}`, `--version=${version}`], {
      detached: true,
      stdio: 'ignore',
      env: childEnv(),
      cwd: root,
    }).unref();
    log('exe novo iniciado para instalar:', root);
    return true;
  } catch (err) {
    log('falha no download/extração:', err);
    await failAndWait(`${err?.message ?? err}\n\nO programa vai abrir na versão atual (${app.getVersion()}).`);
    return false;
  }
}

// ------------------------------------------------------------------ modo --apply-update (exe novo)

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const isApplyMode = () => process.argv.includes('--apply-update');

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitPid(pid, ms) {
  const end = Date.now() + ms;
  while (pid && pidAlive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

// Arquivos do usuário que nunca são apagados, mesmo dentro de resources\.
const KEEP = ['/XF', '*.proj', 'Uninstall *.exe', '/XD', 'projects', 'projetos'];

function robocopy(args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn('robocopy', [...args, '/R:10', '/W:1', '/NP', '/NDL', '/NJH', '/NJS', '/FP'], { windowsHide: true });
    p.stdout.on('data', (buf) => onLine(String(buf).split('\n').filter((l) => l.trim()).length));
    p.on('error', reject);
    // robocopy: 0–7 = sucesso, 8+ = falha.
    p.on('close', (code) => (code < 8 ? resolve() : reject(new Error(`Falha ao copiar os arquivos (robocopy ${code}).`))));
  });
}

/**
 * Copia a versão nova por cima da pasta do programa. Na pasta em si nada é apagado (projetos .proj,
 * pasta projects, desinstalador ou qualquer arquivo do usuário ficam); só dentro de resources\, que é
 * código do programa, os arquivos que não existem mais na versão nova são removidos.
 */
async function mirror(src, dst, version) {
  const total = countFiles(src);
  let n = 0;
  const progress = (lines) => {
    n += lines;
    send({ step: 'install', version, done: Math.min(n, total), total });
  };
  await robocopy([src, dst, '/E', ...KEEP], progress);
  await robocopy([path.join(src, 'resources'), path.join(dst, 'resources'), '/MIR', ...KEEP], () => {});
}

/** Executado pelo exe novo: substitui a pasta antiga e reabre o programa. */
async function applyUpdate() {
  const target = arg('target');
  const version = arg('version') || app.getVersion();
  await openWindow(`GeoAnalisys — Instalando ${version}`);
  send({ step: 'install', version, done: 0, total: 0 });
  try {
    if (!target || !isAppFolder(target)) throw new Error('Pasta do programa não encontrada.');
    await waitPid(Number(arg('wait-pid')), 30000);
    await mirror(appDir, target, version);
    send({ step: 'done', version });
    log('instalado', version, 'em', target);
    spawn(path.join(target, exeName), [], { detached: true, stdio: 'ignore', cwd: target, env: childEnv() }).unref();
    setTimeout(() => app.exit(0), 800);
  } catch (err) {
    log('falha na instalação:', err);
    await failAndWait(
      `${err?.message ?? err}\n\nFeche o GeoAnalisys e abra de novo para tentar outra vez. Se a pasta ficar ` +
        `incompleta, baixe a versão ${version} manualmente.`,
    );
    app.exit(1);
  }
}

module.exports = { checkAndDownload, applyUpdate, isApplyMode };
