const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkRustBinary: () => ipcRenderer.invoke('check-rust-binary'),
  recordScreen: (params) => ipcRenderer.invoke('record-screen', params),
  startGlobalKbRecording: () => ipcRenderer.invoke('start-global-kb-recording'),
  stopGlobalKbRecording: (params) => ipcRenderer.invoke('stop-global-kb-recording', params),
  saveKeyboardTelemetry: (params) => ipcRenderer.invoke('save-keyboard-telemetry', params),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),

  // Event listeners for system-wide background keystrokes
  onGlobalShortcutEvent: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('global-shortcut-event', handler);
    return () => ipcRenderer.removeListener('global-shortcut-event', handler);
  },
  onGlobalRawKeyState: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('global-raw-key-state', handler);
    return () => ipcRenderer.removeListener('global-raw-key-state', handler);
  },
  onGlobalKeyUp: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('global-key-up', handler);
    return () => ipcRenderer.removeListener('global-key-up', handler);
  },

  // Global Mouse Telemetry APIs
  startGlobalMouseRecording: () => ipcRenderer.invoke('start-global-mouse-recording'),
  stopGlobalMouseRecording: (params) => ipcRenderer.invoke('stop-global-mouse-recording', params),
  getScreenBounds: () => ipcRenderer.invoke('get-screen-bounds'),

  // Event listeners for system-wide background mouse telemetry
  onGlobalMousePosition: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('global-mouse-position', handler);
    return () => ipcRenderer.removeListener('global-mouse-position', handler);
  },
  onGlobalMouseClick: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('global-mouse-click', handler);
    return () => ipcRenderer.removeListener('global-mouse-click', handler);
  },
  onGlobalMouseWheel: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('global-mouse-wheel', handler);
    return () => ipcRenderer.removeListener('global-mouse-wheel', handler);
  }
});


