/**
 * GeoAnalisys — programa desktop.
 *
 * Ao abrir, mostra a tela de conexão (servidor, porta, usuário, senha e banco, como no QGIS). Ao
 * escolher o banco: cria/atualiza as tabelas internas (schema gis_app) nesse banco, sobe o servidor
 * do sistema só para esta máquina (127.0.0.1) e abre o sistema numa janela própria.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { friendlyError, listDatabases, startSystem } = require('./server');

let connectWin = null;
let mainWin = null;
let started = false;

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
migrateOldUserData();

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

// ------------------------------------------------------------------ janelas

function openConnectWindow() {
  connectWin = new BrowserWindow({
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
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: `GeoAnalisys — ${c.database} (${c.user}@${c.host})`,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
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
  mainWin.on('closed', () => {
    mainWin = null;
    app.quit();
  });
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Arquivo',
        submenu: [
          {
            label: 'Trocar banco de dados…',
            click: () => {
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
        label: 'Ajuda',
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

// ------------------------------------------------------------------ ciclo de vida

process.on('unhandledRejection', (err) => {
  if (!started) return; // erros antes de subir são mostrados na tela de conexão
  dialog.showErrorBox('GeoAnalisys', String(err?.message ?? err));
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = mainWin ?? connectWin;
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(() => {
    buildMenu();
    openConnectWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
