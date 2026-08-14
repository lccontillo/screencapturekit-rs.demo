const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkRustBinary: () => ipcRenderer.invoke('check-rust-binary'),
  recordScreen: (params) => ipcRenderer.invoke('record-screen', params)
});
