// preload-overlay.js — 오버레이 창에 리포트 수신 + 일시정지 요청만 노출
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('peekguard', {
  onReport: (cb) => ipcRenderer.on('pg-report', (_e, report) => cb(report)),
  pause: () => ipcRenderer.send('pg-pause'),
});
