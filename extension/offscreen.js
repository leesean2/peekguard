/**
 * offscreen.js — 웹캠 프레임 → pico 얼굴 감지 → 결정엔진 → 리포트 전송.
 *
 * 프라이버시/성능 원칙:
 *  - 프레임은 캔버스에서 즉시 소비되고 어디에도 저장·전송되지 않는다.
 *  - 6fps 로 스로틀 + 240px 다운스케일 → CPU/배터리 최소화.
 *  - 판정은 engine.js(순수 함수)가 소유. 여기서는 사실(얼굴 좌표)만 수집.
 */

import { createEngine, processFrame, updateConfig, SENSITIVITY_PRESETS, DEFAULTS } from './engine.js';

const ANALYSIS_WIDTH = 240;

const video = document.getElementById('cam');
const canvas = document.getElementById('work');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let classify = null;
let engine = createEngine();
let timer = null;
let lastBand = null;
let lastKey = '';

// ── 캐스케이드 로드 (확장 패키지에 번들) ────────────────────────────────────
async function loadCascade() {
  const res = await fetch(chrome.runtime.getURL('models/facefinder'));
  const buf = await res.arrayBuffer();
  classify = pico.unpack_cascade(new Int8Array(buf));
}

// ── RGBA → grayscale ────────────────────────────────────────────────────────
function toGray(rgba, n) {
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    g[i] = (2 * rgba[o] + 7 * rgba[o + 1] + rgba[o + 2]) / 10;
  }
  return g;
}

// ── 프레임 1회 분석 ─────────────────────────────────────────────────────────
function tick() {
  if (!classify || video.readyState < 2) return;

  const w = ANALYSIS_WIDTH;
  const h = Math.round(video.videoHeight * (w / video.videoWidth)) || 180;
  canvas.width = w; canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = toGray(rgba, w * h);

  let dets = pico.run_cascade(
    { pixels: gray, nrows: h, ncols: w, ldim: w },
    classify,
    { shiftfactor: 0.1, minsize: 18, maxsize: 1000, scalefactor: 1.1 },
  );
  dets = pico.cluster_detections(dets, 0.2)
    .map(([row, col, size, q]) => ({ row, col, size, q }));

  const report = processFrame(engine, dets, w, h);

  // 전송 조건: 밴드 변화, 또는 danger 중 내용(점수·신호 구성)이 실제로 바뀐 경우만.
  // danger 중 매 프레임 전송하면 오버레이가 계속 재렌더링되어 UI 상호작용이 끊긴다.
  const key = `${report.band}|${report.score}|${report.signals.map((s) => s.id).join(',')}`;
  if (report.band !== lastBand || (report.band === 'danger' && key !== lastKey)) {
    lastBand = report.band;
    lastKey = key;
    chrome.runtime.sendMessage({ type: 'PG_REPORT', report }).catch(() => {});
  }
}

// ── 시작 ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await loadCascade();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    timer = setInterval(tick, 1000 / (engine.cfg.fps || DEFAULTS.fps));
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'PG_CAM_ERROR',
      error: err.name === 'NotAllowedError'
        ? '카메라 권한이 없습니다. 확장 옵션(권한 설정 페이지)에서 허용해 주세요.'
        : `카메라 시작 실패: ${err.message}`,
    }).catch(() => {});
  }
}

// 민감도 변경 수신
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg.type === 'PG_CONFIG' && msg.sensitivity) {
    updateConfig(engine, SENSITIVITY_PRESETS[msg.sensitivity] || {});
    sendResponse({ ok: true });
  }
  return false;
});

start();
