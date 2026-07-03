/**
 * background.js — PeekGuard 서비스 워커 (MV3).
 *
 * 역할: 상태 소유 + 중계만. 감지는 offscreen, 판정은 engine, 표시는 content/popup.
 *  - offscreen 문서(웹캠 보유) 수명주기 관리
 *  - offscreen 의 판정 리포트를 모든 탭 content script 로 중계
 *  - 배지(안전/주의/위험) 갱신, 이벤트 로그(메타데이터만) 기록
 */

const OFFSCREEN_URL = 'offscreen.html';

const DEFAULT_SETTINGS = {
  enabled: false,
  sensitivity: 'normal',   // low | normal | high
  mode: 'blur',            // blur | decoy
  pausedUntil: 0,          // epoch ms
};

// ── 설정 ────────────────────────────────────────────────────────────────────
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
async function setSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: s });
  return s;
}

// ── offscreen 수명주기 ──────────────────────────────────────────────────────
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: '숄더서핑 감지를 위해 웹캠 프레임을 로컬에서만 분석합니다. 영상은 저장·전송되지 않습니다.',
  });
}
async function closeOffscreen() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
}

async function applyEnabled() {
  const s = await getSettings();
  const active = s.enabled && Date.now() >= s.pausedUntil;
  if (active) {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ type: 'PG_CONFIG', sensitivity: s.sensitivity }).catch(() => {});
  } else {
    await closeOffscreen();
    await broadcast({ type: 'PG_CLEAR' });
    setBadge('off');
  }
}

// ── 배지 ────────────────────────────────────────────────────────────────────
function setBadge(state) {
  const map = {
    off:     { text: '',  color: '#5e7884' },
    safe:    { text: '',  color: '#27d3b6' },
    caution: { text: '!', color: '#f2b347' },
    danger:  { text: '●', color: '#ff4d4d' },
    error:   { text: 'x', color: '#ff4d4d' },
  };
  const b = map[state] || map.off;
  chrome.action.setBadgeText({ text: b.text });
  chrome.action.setBadgeBackgroundColor({ color: b.color });
}

// ── 탭 브로드캐스트 ─────────────────────────────────────────────────────────
async function broadcast(msg) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.allSettled(tabs.map((t) => chrome.tabs.sendMessage(t.id, msg)));
}

// ── 이벤트 로그 (메타데이터만: 시각·점수·신호 id·지속시간) ──────────────────
let openEvent = null; // { start, score, signalIds }

async function logThreatTransition(report) {
  if (report.band === 'danger' && !openEvent) {
    openEvent = { start: Date.now(), score: report.score, signalIds: report.signals.map((s) => s.id) };
  } else if (report.band !== 'danger' && openEvent) {
    const ev = {
      ts: openEvent.start,
      durationMs: Date.now() - openEvent.start,
      score: openEvent.score,
      signals: openEvent.signalIds,
    };
    openEvent = null;
    const { log = [] } = await chrome.storage.local.get('log');
    log.unshift(ev);
    await chrome.storage.local.set({ log: log.slice(0, 100) }); // 최근 100건만
  } else if (report.band === 'danger' && openEvent) {
    openEvent.score = Math.max(openEvent.score, report.score);
    for (const s of report.signals) {
      if (!openEvent.signalIds.includes(s.id)) openEvent.signalIds.push(s.id);
    }
  }
}

// ── 최근 리포트 캐시 (popup 실시간 표시용) ──────────────────────────────────
let lastReport = null;

// ── 메시지 라우팅 ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      // offscreen → 판정 리포트
      case 'PG_REPORT': {
        lastReport = msg.report;
        setBadge(msg.report.band);
        await logThreatTransition(msg.report);
        const s = await getSettings();
        await broadcast({ type: 'PG_THREAT', report: msg.report, mode: s.mode });
        sendResponse({ ok: true });
        break;
      }
      case 'PG_CAM_ERROR': {
        lastReport = { error: msg.error };
        setBadge('error');
        sendResponse({ ok: true });
        break;
      }
      // popup ↔
      case 'PG_GET_STATE': {
        const s = await getSettings();
        sendResponse({ settings: s, report: lastReport });
        break;
      }
      case 'PG_SET': {
        const s = await setSettings(msg.patch);
        if ('enabled' in msg.patch || 'pausedUntil' in msg.patch) await applyEnabled();
        if ('sensitivity' in msg.patch) {
          chrome.runtime.sendMessage({ type: 'PG_CONFIG', sensitivity: s.sensitivity }).catch(() => {});
        }
        sendResponse({ settings: s });
        break;
      }
      case 'PG_PAUSE': {
        const until = Date.now() + msg.minutes * 60 * 1000;
        await setSettings({ pausedUntil: until });
        await applyEnabled();
        // 일시정지 해제 알람
        chrome.alarms.create('pg-resume', { when: until });
        sendResponse({ pausedUntil: until });
        break;
      }
      // content → 사용자가 오버레이에서 '5분 일시정지'
      case 'PG_PAUSE_FROM_OVERLAY': {
        const until = Date.now() + 5 * 60 * 1000;
        await setSettings({ pausedUntil: until });
        await applyEnabled();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false });
    }
  })();
  return true; // async sendResponse
});

// 일시정지 만료 시 자동 재개
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'pg-resume') await applyEnabled();
});

// 설치 시: 카메라 권한 안내 페이지
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  }
  setBadge('off');
});

// 브라우저 시작 시 이전 enabled 상태 복원
chrome.runtime.onStartup?.addListener(applyEnabled);
