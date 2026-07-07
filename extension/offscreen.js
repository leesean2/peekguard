/**
 * offscreen.js — 웹캠 프레임 → pico 얼굴 감지 → 결정엔진 → 리포트 전송.
 *
 * 프라이버시/성능 원칙:
 *  - 프레임은 캔버스에서 즉시 소비되고 어디에도 저장·전송되지 않는다.
 *  - 6fps 로 스로틀 + 240px 다운스케일 → CPU/배터리 최소화.
 *  - 판정은 engine.js(순수 함수)가 소유. 여기서는 사실(얼굴 좌표)만 수집.
 */

import { createEngine, processFrame, updateConfig, SENSITIVITY_PRESETS, DEFAULTS } from './engine.js';

// 분석 해상도: 640×480 캡처의 정확히 1/2. 240px 에서는 원거리(1.5m+) 얼굴의
// 디테일이 부족해 열화 조건에서 q 가 임계 미달 → 320px 로 상향 (연산 1.8배, 6fps 에선 미미).
const ANALYSIS_WIDTH = 320;

const video = document.getElementById('cam');
const canvas = document.getElementById('work');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let classify = null;
let engine = createEngine();
let timer = null;
let lastBand = null;
let lastKey = '';
// 저조도 q 출렁임 안정화는 engine.js 의 위치 추적 q 누적(qTracks)이 담당한다.
// (pico detection memory 는 얼굴이 움직이면 잔상이 제3자로 오인되는 문제가 있어 제거)

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

// 민감도: 메시지 대신 storage 를 직접 읽는다.
// (background 가 문서 생성 직후 보내는 메시지는 리스너 등록 전이면 유실될 수 있음)
async function applySensitivityFromStorage() {
  const { settings } = await chrome.storage.local.get('settings');
  const preset = SENSITIVITY_PRESETS[settings?.sensitivity];
  if (preset) updateConfig(engine, preset);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    const preset = SENSITIVITY_PRESETS[changes.settings.newValue?.sensitivity];
    if (preset) updateConfig(engine, preset);
  }
});

// ── 시작 ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await applySensitivityFromStorage();
    await loadCascade();
    const stream = await navigator.mediaDevices.getUserMedia({
      // 640×480 캡처 후 240px 로 다운스케일 — 카메라 네이티브에 가까운 해상도가
      // 320×240 직접 요청보다 노이즈가 적어 감지 품질이 좋다.
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
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

start();
