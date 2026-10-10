/**
 * GeoAnalisys — programa desktop.
 *
 * Ao abrir, mostra a tela de conexão (servidor, porta, usuário, senha e banco, como no QGIS). Ao
 * escolher o banco: cria/atualiza as tabelas internas (schema gis_app) nesse banco, sobe o servidor
 * do sistema só para esta máquina (127.0.0.1) e abre o sistema numa janela própria.
 *
 * Projetos (Arquivo > Novo/Abrir/Recentes): arquivos <nome>.proj com camadas, limites, mapas e
 * configurações. O sistema (janela principal) monta e aplica o conteúdo; aqui ficam os diálogos de
 * arquivo, a leitura/gravação no disco e a lista de recentes.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, safeStorage, session, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { friendlyError, listDatabases, startSystem } = require('./server');
const updater = require('./updater');

const ICON = path.join(__dirname, 'assets', 'icon.ico');

// Exe novo aplicando uma atualização: usa uma pasta de dados própria para não disputar com o programa.
const applyingUpdate = updater.isApplyMode();
if (applyingUpdate) app.setPath('userData', path.join(app.getPath('temp'), 'GeoAnalisys-updater'));

let connectWin = null;
let mainWin = null;
let started = false;
/** Título da janela principal sem o projeto: "GeoAnalisys — banco (usuário@servidor)" */
let mainTitle = 'GeoAnalisys';

// ------------------------------------------------------------------ nome antigo (Censo GIS)

/**
 * O programa se chamava "Censo GIS": a pasta de dados (conexões salvas, preferências e cache do
 * mapa) era %APPDATA%\Censo GIS. Na primeira execução com o nome novo, copia tudo para a pasta nova.
 */
function migrateOldUserData() {
  try {
    const oldDir = path.join(app.getPath('appData'), 'Censo GIS');
    const newDir = app.getPath('userData');
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) fs.cpSync(oldDir, newDir, { recursive: true });
  } catch {
    /* sem migração: começa com a pasta nova vazia */
  }
}
if (!applyingUpdate) migrateOldUserData();

// ------------------------------------------------------------------ conexões salvas

const storeFile = () => path.join(app.getPath('userData'), 'conexoes.json');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
  } catch {
    return { connections: [], last: null };
  }
}

function writeStore(s) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(s, null, 2));
}

/** Senha guardada criptografada pelo Windows (DPAPI), legível só por este usuário nesta máquina. */
function encrypt(text) {
  if (!text || !safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(text).toString('base64');
}

function decrypt(b64) {
  try {
    return b64 && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(b64, 'base64')) : '';
  } catch {
    return '';
  }
}

const keyOf = (c) => `${c.user}@${c.host}:${c.port}/${c.database}`;

// ------------------------------------------------------------------ tema (Sobre > Tema)

const prefsFile = () => path.join(app.getPath('userData'), 'preferencias.json');

function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
  } catch {
    return {};
  }
}

/** 'light' | 'dark'. As janelas seguem pelo prefers-color-scheme (CSS do sistema e da conexão). */
function readTheme() {
  return readPrefs().theme === 'dark' ? 'dark' : 'light';
}

function setTheme(theme) {
  nativeTheme.themeSource = theme;
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), theme }, null, 2));
  } catch {
    /* não grava: vale só nesta execução */
  }
  buildMenu();
}

// ------------------------------------------------------------------ projetos (.proj)

const PROJECT_EXT = 'proj';
const MAX_RECENT = 10;
const projectsFile = () => path.join(app.getPath('userData'), 'projetos.json');

/** { recent: caminhos (mais recente primeiro), last: projeto aberto por último (reabre ao iniciar) } */
function readProjects() {
  try {
    const s = JSON.parse(fs.readFileSync(projectsFile(), 'utf8'));
    return { recent: Array.isArray(s.recent) ? s.recent : [], last: s.last ?? null };
  } catch {
    return { recent: [], last: null };
  }
}

function writeProjects(s) {
  fs.mkdirSync(path.dirname(projectsFile()), { recursive: true });
  fs.writeFileSync(projectsFile(), JSON.stringify(s, null, 2));
}

/**
 * Pasta padrão dos projetos: "projects" ao lado do GeoAnalisys.exe (dentro do win-unpacked ou da pasta
 * instalada; a atualização automática nunca apaga essa pasta). Rodando em desenvolvimento ou sem
 * permissão de escrita ali (instalado em Program Files), usa Documentos.
 */
function projectsDir() {
  if (app.isPackaged) {
    const dir = path.join(path.dirname(process.execPath), 'projects');
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Teste real de escrita: no Windows o accessSync(W_OK) não confere as permissões da pasta.
      const probe = path.join(dir, `.geo-write-test-${process.pid}`);
      fs.writeFileSync(probe, '');
      fs.rmSync(probe);
      return dir;
    } catch {
      /* sem permissão: Documentos */
    }
  }
  return app.getPath('documents');
}

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const projectName = (file) => path.basename(file, path.extname(file));
const isProjectFile = (file) => typeof file === 'string' && path.extname(file).toLowerCase() === `.${PROJECT_EXT}`;

function addRecent(file) {
  const s = readProjects();
  s.recent = [file, ...s.recent.filter((f) => !samePath(f, file))].slice(0, MAX_RECENT);
  s.last = file;
  writeProjects(s);
  buildMenu();
}

function removeRecent(file) {
  const s = readProjects();
  s.recent = s.recent.filter((f) => !samePath(f, file));
  if (s.last && samePath(s.last, file)) s.last = null;
  writeProjects(s);
  buildMenu();
}

function readProjectFile(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data?.format !== 'geoanalisys-project' || typeof data.id !== 'string') {
    throw new Error('O arquivo não é um projeto do GeoAnalisys.');
  }
  return data;
}

/** Grava via arquivo temporário: uma falha no meio não corrompe o projeto. */
function writeProjectFile(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** Pede ao sistema para trocar de projeto (ele salva o atual antes). */
function openProject(file) {
  if (!mainWin) return;
  let data;
  try {
    data = readProjectFile(file);
  } catch (err) {
    const missing = err?.code === 'ENOENT';
    dialog.showErrorBox(
      'Abrir projeto',
      missing ? `Arquivo não encontrado:\n${file}` : `Não foi possível abrir ${path.basename(file)}:\n${err?.message ?? err}`,
    );
    if (missing) removeRecent(file);
    return;
  }
  mainWin.webContents.send('project:open', { path: file, name: projectName(file), data });
}

async function newProject() {
  if (!mainWin) return;
  const r = await dialog.showSaveDialog(mainWin, {
    title: 'Novo projeto',
    defaultPath: path.join(projectsDir(), `Novo projeto.${PROJECT_EXT}`),
    buttonLabel: 'Criar projeto',
    filters: [{ name: 'Projeto GeoAnalisys', extensions: [PROJECT_EXT] }],
  });
  if (r.canceled || !r.filePath) return;
  const file = isProjectFile(r.filePath) ? r.filePath : `${r.filePath}.${PROJECT_EXT}`;
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'question',
    title: 'Novo projeto',
    message: `Criar o projeto "${projectName(file)}"`,
    detail: 'Começar em branco ou levar as camadas, limites e configurações abertas agora?',
    buttons: ['Em branco', 'Copiar configuração atual', 'Cancelar'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 2) return;
  mainWin.webContents.send('project:new', {
    path: file,
    name: projectName(file),
    id: crypto.randomUUID(),
    copy: response === 1,
  });
}

async function openProjectDialog() {
  if (!mainWin) return;
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Abrir projeto',
    defaultPath: projectsDir(),
    filters: [{ name: 'Projeto GeoAnalisys', extensions: [PROJECT_EXT] }],
    properties: ['openFile'],
  });
  if (!r.canceled && r.filePaths[0]) openProject(r.filePaths[0]);
}

/**
 * Antes de fechar/trocar de banco, o sistema grava o projeto aberto (o salvamento automático tem
 * alguns segundos de atraso). Sem resposta em 5 s, segue mesmo assim.
 */
function flushProject() {
  if (!mainWin) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, 5000);
    function done() {
      clearTimeout(timer);
      ipcMain.removeListener('project:flushed', done);
      resolve();
    }
    ipcMain.once('project:flushed', done);
    mainWin.webContents.send('project:flush');
  });
}

// ------------------------------------------------------------------ janelas

function openConnectWindow() {
  connectWin = new BrowserWindow({
    icon: ICON,
    width: 560,
    height: 700,
    resizable: false,
    title: 'GeoAnalisys — Conectar ao banco',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  connectWin.loadFile(path.join(__dirname, 'connect.html'));
  connectWin.on('closed', () => {
    connectWin = null;
    if (!mainWin) app.quit();
  });
}

function openMainWindow(origin, c) {
  mainTitle = `GeoAnalisys — ${c.database} (${c.user}@${c.host})`;
  mainWin = new BrowserWindow({
    icon: ICON,
    width: 1440,
    height: 900,
    show: false,
    title: mainTitle,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Leitor de PDF (relatórios abertos no preview do modo lista).
      plugins: true,
    },
  });
  buildMenu();
  mainWin.maximize();
  mainWin.once('ready-to-show', () => mainWin.show());
  // O título do sistema não substitui o do programa (mostra o banco em uso).
  mainWin.on('page-title-updated', (e) => e.preventDefault());
  // Links externos (Street View, links dos registros) abrem no navegador padrão.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWin.loadURL(origin);
  // Grava o projeto aberto antes de fechar.
  let closing = false;
  mainWin.on('close', (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    flushProject().then(() => mainWin?.destroy());
  });
  mainWin.on('closed', () => {
    mainWin = null;
    app.quit();
  });
}

function buildMenu() {
  const hasMain = !!mainWin;
  const { recent } = readProjects();
  const theme = readTheme();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Arquivo',
        submenu: [
          { label: 'Novo Projeto…', accelerator: 'CmdOrCtrl+N', enabled: hasMain, click: newProject },
          { label: 'Abrir Projeto…', accelerator: 'CmdOrCtrl+O', enabled: hasMain, click: openProjectDialog },
          {
            label: 'Projetos Recentes',
            enabled: hasMain,
            submenu: recent.length
              ? [
                  ...recent.map((file, i) => ({
                    label: `${i + 1}. ${projectName(file)}`,
                    sublabel: path.dirname(file),
                    toolTip: file,
                    click: () => openProject(file),
                  })),
                  { type: 'separator' },
                  {
                    label: 'Limpar lista',
                    click: () => {
                      writeProjects({ ...readProjects(), recent: [] });
                      buildMenu();
                    },
                  },
                ]
              : [{ label: 'Nenhum projeto recente', enabled: false }],
          },
          {
            label: 'Salvar Projeto',
            accelerator: 'CmdOrCtrl+S',
            enabled: hasMain,
            click: () => mainWin?.webContents.send('project:save'),
          },
          { type: 'separator' },
          {
            label: 'Trocar banco de dados…',
            click: async () => {
              await flushProject();
              app.relaunch();
              app.exit(0);
            },
          },
          { type: 'separator' },
          { role: 'quit', label: 'Sair' },
        ],
      },
      {
        label: 'Exibir',
        submenu: [
          { role: 'reload', label: 'Recarregar' },
          { role: 'togglefullscreen', label: 'Tela cheia' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Tamanho original' },
          { role: 'zoomIn', label: 'Aumentar' },
          { role: 'zoomOut', label: 'Diminuir' },
          { type: 'separator' },
          { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' },
        ],
      },
      {
        label: 'Ferramentas',
        submenu: [
          {
            label: 'Associar Camadas…',
            enabled: hasMain,
            click: () => mainWin?.webContents.send('tool:open', 'associate'),
          },
        ],
      },
      {
        label: 'Sobre',
        submenu: [
          {
            label: 'Sobre o GeoAnalisys',
            click: () =>
              dialog.showMessageBox({
                type: 'info',
                title: 'GeoAnalisys',
                message: `GeoAnalisys ${app.getVersion()}`,
                detail: 'Sistema GIS de pontos (PostgreSQL/PostGIS + MapLibre).',
              }),
          },
          {
            label: 'Atalhos…',
            enabled: hasMain,
            click: () => mainWin?.webContents.send('tool:open', 'shortcuts'),
          },
          { type: 'separator' },
          {
            label: 'Tema',
            submenu: [
              { label: 'Claro', type: 'radio', checked: theme === 'light', click: () => setTheme('light') },
              { label: 'Escuro', type: 'radio', checked: theme === 'dark', click: () => setTheme('dark') },
            ],
          },
        ],
      },
    ]),
  );
}

// ------------------------------------------------------------------ IPC (tela de conexão)

ipcMain.handle('saved:list', () => {
  const s = readStore();
  return {
    last: s.last,
    connections: s.connections.map(({ password, ...c }) => ({ ...c, password: decrypt(password), hasPassword: !!password })),
  };
});

ipcMain.handle('saved:remove', (_e, key) => {
  const s = readStore();
  s.connections = s.connections.filter((c) => keyOf(c) !== key);
  if (s.last === key) s.last = null;
  writeStore(s);
});

ipcMain.handle('db:list', async (_e, c) => {
  try {
    return { ok: true, databases: await listDatabases(c) };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
});

ipcMain.handle('db:open', async (e, c) => {
  if (started) return { ok: false, error: 'O sistema já está aberto.' };
  const send = (msg) => e.sender.send('status', msg);
  try {
    const s = readStore();
    const key = keyOf(c);
    const entry = {
      host: c.host,
      port: Number(c.port) || 5432,
      user: c.user,
      database: c.database,
      password: c.savePassword ? encrypt(c.password) : null,
    };
    s.connections = [entry, ...s.connections.filter((x) => keyOf(x) !== key)].slice(0, 20);
    s.last = key;
    writeStore(s);

    const origin = await startSystem(c, send);
    started = true;
    openMainWindow(origin, c);
    connectWin?.close();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
});

// ------------------------------------------------------------------ IPC (projetos)

/** Projeto a abrir ao carregar o sistema: o último usado, se o arquivo ainda existir. */
ipcMain.handle('project:initial', () => {
  const { last } = readProjects();
  if (!last) return null;
  try {
    return { path: last, name: projectName(last), data: readProjectFile(last) };
  } catch {
    return null;
  }
});

ipcMain.handle('project:write', (_e, file, data) => {
  if (!isProjectFile(file)) return { ok: false, error: 'Arquivo de projeto inválido.' };
  try {
    writeProjectFile(file, data);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
});

/** O sistema passou a usar este projeto (null = nenhum): título da janela e recentes. */
ipcMain.on('project:activated', (_e, file) => {
  if (file && isProjectFile(file)) {
    addRecent(file);
    mainWin?.setTitle(`${projectName(file)} — ${mainTitle}`);
  } else {
    mainWin?.setTitle(mainTitle);
  }
});

/**
 * Preview do modo lista: muitos sites proíbem ser exibidos dentro de outra página (X-Frame-Options,
 * CSP frame-ancestors). Só para páginas carregadas em frames, esses bloqueios são removidos; o frame
 * continua isolado do sistema (sandbox, sem acesso ao preload).
 */
function allowFramedPreviews() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'subFrame') return callback({});
    const headers = { ...details.responseHeaders };
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      if (lower === 'x-frame-options') delete headers[name];
      else if (lower === 'content-security-policy') {
        headers[name] = headers[name]
          .map((v) => v.split(';').filter((d) => !/^\s*frame-ancestors\b/i.test(d)).join(';'))
          .filter((v) => v.trim());
        if (!headers[name].length) delete headers[name];
      }
    }
    callback({ responseHeaders: headers });
  });
}

// ------------------------------------------------------------------ ciclo de vida

process.on('unhandledRejection', (err) => {
  if (!started) return; // erros antes de subir são mostrados na tela de conexão
  dialog.showErrorBox('GeoAnalisys', String(err?.message ?? err));
});

let checkingUpdate = false;

if (applyingUpdate) {
  app.whenReady().then(updater.applyUpdate);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = mainWin ?? connectWin;
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(async () => {
    checkingUpdate = true;
    const updating = await updater.checkAndDownload();
    checkingUpdate = false;
    if (updating) return app.exit(0); // o exe novo assume: instala e reabre o programa
    allowFramedPreviews();
    nativeTheme.themeSource = readTheme();
    buildMenu();
    openConnectWindow();
  });
  app.on('window-all-closed', () => {
    if (!checkingUpdate) app.quit();
  });
}
