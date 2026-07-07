// preload-capture.js — 캡처 창에 최소한의 IPC 표면만 노출 (contextIsolation)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('peekguard', {
  getSettings: () => ipcRenderer.invoke('pg-get-settings'),
  report: (r) => ipcRenderer.send('pg-report', r),
  camError: (msg) => ipcRenderer.send('pg-cam-error', msg),
  onConfig: (cb) => ipcRenderer.on('pg-config', (_e, sensitivity) => cb(sensitivity)),
});
