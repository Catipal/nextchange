const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getServerPort: () => ipcRenderer.invoke('get-server-port')
});
