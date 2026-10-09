// Ponte segura entre a tela de conexão e o processo principal (sem acesso direto ao Node).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('geoanalisys', {
  saved: () => ipcRenderer.invoke('saved:list'),
  removeSaved: (key) => ipcRenderer.invoke('saved:remove', key),
  databases: (conn) => ipcRenderer.invoke('db:list', conn),
  open: (conn) => ipcRenderer.invoke('db:open', conn),
  onStatus: (fn) => ipcRenderer.on('status', (_e, msg) => fn(msg)),
});
