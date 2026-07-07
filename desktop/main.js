/**
 * main.js — PeekGuard 데스크톱 (Electron 메인 프로세스).
 *
 * 확장의 background.js 와 같은 역할: 상태 소유 + 중계만.
 *  - 감지: 숨김 캡처 창(capture.html — 확장의 offscreen 문서에 해당)
 *  - 판정: lib/engine.js (extension/engine.js 의 동기화 사본)
 *  - 표시: 위협 시 모든 모니터를 덮는 최상위 오버레이(overlay.html)
 *
 * 확장과의 차이: 보호 범위가 브라우저 탭이 아니라 OS 화면 전체다.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const SMOKE = process.argv.includes('--smoke'); // CI/검증용: 첫 리포트 확인 후 종료

const DEFAULT_SETTINGS = {
  enabled: true,
  sensitivity: 'normal', // low | normal | high
  mode: 'blur',          // blur(반투명 가림) | decoy(가짜 문서)
};

let settings = { ...DEFAULT_SETTINGS };
let tray = null;
let captureWin = null;
let overlays = [];        // 모니터당 1개
let overlaysShown = false;
let pausedUntil = 0;
let pauseTimer = null;
let lastEsc = 0;

// ── 설정 영속화 ─────────────────────────────────────────────────────────────
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; }
  catch { /* 첫 실행 */ }
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch { /* 무시 */ }
}

// ── 캡처 창 (웹캠 보유, 화면에 표시되지 않음) ───────────────────────────────
function ensureCapture() {
  if (captureWin && !captureWin.isDestroyed()) return;
  captureWin = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-capture.js'),
      contextIsolation: true,
      // 숨김 창은 타이머가 1s 로 스로틀되므로 반드시 해제 — 6fps 감지 유지
      backgroundThrottling: false,
    },
  });
  captureWin.loadFile('capture.html');
}
function closeCapture() {
  if (captureWin && !captureWin.isDestroyed()) captureWin.destroy();
  captureWin = null;
}

// ── 오버레이 (모니터 전체 덮기) ─────────────────────────────────────────────
function buildOverlays() {
  destroyOverlays();
  for (const d of screen.getAllDisplays()) {
    const w = new BrowserWindow({
      ...d.bounds,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      skipTaskbar: true,
      // Windows 11: 실제 블러(아크릴). 미지원 OS 는 backgroundColor 로 불투명 가림.
      backgroundMaterial: 'acrylic',
      backgroundColor: '#0c1419',
      webPreferences: {
        preload: path.join(__dirname, 'preload-overlay.js'),
        contextIsolation: true,
      },
    });
    w.setAlwaysOnTop(true, 'screen-saver'); // 게임/전체화면 앱 위에도 표시
    w.loadFile('overlay.html', { query: { mode: settings.mode } });
    overlays.push(w);
  }
}
function destroyOverlays() {
  for (const w of overlays) if (!w.isDestroyed()) w.destroy();
  overlays = [];
  overlaysShown = false;
  globalShortcut.unregister('Escape');
}

function showOverlays(report) {
  if (!overlays.length) buildOverlays();
  for (const w of overlays) {
    if (w.isDestroyed()) continue;
    w.webContents.send('pg-report', report);
    if (!overlaysShown) w.show();
  }
  if (!overlaysShown) {
    overlaysShown = true;
    // 탈출구: Esc 2연타(1초 내) → 5분 일시정지.
    // (키보드를 조작할 수 있는 사람 = 이미 기기를 쥔 사용자라는 전제 — 확장과 동일)
    globalShortcut.register('Escape', () => {
      const now = Date.now();
      if (now - lastEsc < 1000) pauseFor(5);
      lastEsc = now;
    });
  }
}
function hideOverlays() {
  for (const w of overlays) if (!w.isDestroyed()) w.hide();
  overlaysShown = false;
  globalShortcut.unregister('Escape');
}

// ── 활성화 상태 적용 (확장 background.js 의 applyEnabled 와 동일 구조) ──────
function applyEnabled() {
  const active = settings.enabled && Date.now() >= pausedUntil;
  if (active) {
    ensureCapture();
    buildOverlays(); // 미리 만들어 두면 위협 시 즉시 표시(생성 지연 없음)
  } else {
    closeCapture();
    destroyOverlays();
  }
  updateTray();
}

function pauseFor(minutes) {
  pausedUntil = Date.now() + minutes * 60 * 1000;
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => { pausedUntil = 0; applyEnabled(); }, minutes * 60 * 1000);
  applyEnabled();
}

// ── 트레이 ──────────────────────────────────────────────────────────────────
function trayState() {
  if (!settings.enabled) return '꺼짐';
  if (Date.now() < pausedUntil) return '일시정지';
  return overlaysShown ? '위험 — 화면 보호 중' : '감시 중';
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(`PeekGuard — ${trayState()}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `상태: ${trayState()}`, enabled: false },
    { type: 'separator' },
    {
      label: '활성화', type: 'checkbox', checked: settings.enabled,
      click: (item) => { settings.enabled = item.checked; pausedUntil = 0; saveSettings(); applyEnabled(); },
    },
    { label: '5분 일시정지', enabled: settings.enabled, click: () => pauseFor(5) },
    { type: 'separator' },
    {
      label: '민감도',
      submenu: ['low', 'normal', 'high'].map((s) => ({
        label: { low: '둔감 (혼잡한 곳)', normal: '보통', high: '민감 (금융작업)' }[s],
        type: 'radio', checked: settings.sensitivity === s,
        click: () => {
          settings.sensitivity = s; saveSettings();
          captureWin?.webContents.send('pg-config', s);
          updateTray();
        },
      })),
    },
    {
      label: '가림 방식',
      submenu: [['blur', '블러 (반투명 가림)'], ['decoy', '디코이 (가짜 문서)']].map(([m, label]) => ({
        label, type: 'radio', checked: settings.mode === m,
        click: () => { settings.mode = m; saveSettings(); buildOverlays(); updateTray(); },
      })),
    },
    {
      label: '로그인 시 자동 시작', type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: [app.getAppPath()] }),
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
}

// ── IPC (캡처 창 → 판정 리포트) ────────────────────────────────────────────
ipcMain.handle('pg-get-settings', () => settings);

ipcMain.on('pg-report', (_e, report) => {
  if (report.blur) showOverlays(report);
  else hideOverlays();
  updateTray();
  if (SMOKE) {
    console.log(`SMOKE OK: band=${report.band} score=${report.score} faces=${report.faces}`);
    app.exit(0);
  }
});

ipcMain.on('pg-cam-error', (_e, msg) => {
  tray?.setToolTip(`PeekGuard — 카메라 오류: ${msg}`);
  if (SMOKE) { console.log(`SMOKE CAM ERROR: ${msg}`); app.exit(1); }
});

ipcMain.on('pg-pause', () => pauseFor(5)); // 오버레이의 '5분 일시정지' 버튼

// ── 앱 수명주기 ─────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  loadSettings();

  // 데스크톱 앱은 권한 프롬프트를 띄울 창이 없으므로 카메라 요청을 직접 허용.
  // (Windows 설정 > 개인정보 > 카메라에서 '데스크톱 앱 허용'이 켜져 있어야 함)
  const ses = require('electron').session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icons', 'icon48.png')));
  updateTray();

  // 모니터 구성 변경 시 오버레이 재구성
  screen.on('display-added', () => settings.enabled && buildOverlays());
  screen.on('display-removed', () => settings.enabled && buildOverlays());

  if (SMOKE) {
    settings.enabled = true;
    setTimeout(() => { console.log('SMOKE TIMEOUT: 리포트 없음'); app.exit(1); }, 20000);
  }
  applyEnabled();
});

// 트레이 상주 앱: 모든 창이 닫혀도 종료하지 않음
app.on('window-all-closed', () => {});
app.on('will-quit', () => globalShortcut.unregisterAll());
