// Ponte segura entre as janelas (conexão e sistema) e o processo principal (sem acesso direto ao Node).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('geoanalisys', {
  saved: () => ipcRenderer.invoke('saved:list'),
  removeSaved: (key) => ipcRenderer.invoke('saved:remove', key),
  databases: (conn) => ipcRenderer.invoke('db:list', conn),
  open: (conn) => ipcRenderer.invoke('db:open', conn),
  onStatus: (fn) => ipcRenderer.on('status', (_e, msg) => fn(msg)),
  // Tela de atualização
  onUpdate: (fn) => ipcRenderer.on('update', (_e, msg) => fn(msg)),
  continueUpdate: () => ipcRenderer.send('update:continue'),
  // Projetos (.proj), usados pelo sistema; os eventos vêm do menu Arquivo
  project: {
    initial: () => ipcRenderer.invoke('project:initial'),
    write: (file, data) => ipcRenderer.invoke('project:write', file, data),
    activated: (file) => ipcRenderer.send('project:activated', file),
    flushed: () => ipcRenderer.send('project:flushed'),
    onOpen: (fn) => ipcRenderer.on('project:open', (_e, msg) => fn(msg)),
    onNew: (fn) => ipcRenderer.on('project:new', (_e, msg) => fn(msg)),
    onSave: (fn) => ipcRenderer.on('project:save', () => fn()),
    onFlush: (fn) => ipcRenderer.on('project:flush', () => fn()),
  },
  // Caminho no disco de um arquivo escolhido (Camadas > Sobre mostra a origem dos limites)
  files: {
    pathOf: (file) => {
      try {
        return webUtils.getPathForFile(file) || null;
      } catch {
        return null;
      }
    },
  },
  // Menu Exibir: mostrar/ocultar painel de camadas, mapas de fundo e aba de informações
  view: {
    onToggle: (fn) => ipcRenderer.on('view:toggle', (_e, part) => fn(part)),
    state: (state) => ipcRenderer.send('view:state', state),
  },
  // Menus Ferramentas e Sobre (abrem diálogos do sistema)
  tools: {
    onOpen: (fn) => ipcRenderer.on('tool:open', (_e, name) => fn(name)),
  },
});
