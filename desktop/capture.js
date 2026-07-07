/**
 * capture.js — 웹캠 프레임 → pico 얼굴 감지 → 결정엔진 → 메인 프로세스로 리포트.
 * extension/offscreen.js 와 같은 파이프라인 (chrome.* IPC 만 window.peekguard 로 교체).
 *
 * 프라이버시/성능 원칙 (확장과 동일):
 *  - 프레임은 캔버스에서 즉시 소비되고 어디에도 저장·전송되지 않는다.
 *  - 6fps 스로틀 + 320px 다운스케일 → CPU/배터리 최소화.
 *  - 판정은 engine.js(순수 함수)가 소유. 여기서는 사실(얼굴 좌표)만 수집.
 */

import { createEngine, processFrame, updateConfig, SENSITIVITY_PRESETS, DEFAULTS } from './lib/engine.js';

const ANALYSIS_WIDTH = 320;

const video = document.getElementById('cam');
const canvas = document.getElementById('work');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let classify = null;
let engine = createEngine();
let lastBand = null;
let lastKey = '';

async function loadCascade() {
  const res = await fetch('models/facefinder');
  classify = pico.unpack_cascade(new Int8Array(await res.arrayBuffer()));
}

function toGray(rgba, n) {
  const g = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    g[i] = (2 * rgba[o] + 7 * rgba[o + 1] + rgba[o + 2]) / 10;
  }
  return g;
}

function tick() {
  if (!classify || video.readyState < 2) return;

  const w = ANALYSIS_WIDTH;
  const h = Math.round(video.videoHeight * (w / video.videoWidth)) || 240;
  canvas.width = w; canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const gray = toGray(ctx.getImageData(0, 0, w, h).data, w * h);

  let dets = pico.run_cascade(
    { pixels: gray, nrows: h, ncols: w, ldim: w },
    classify,
    { shiftfactor: 0.1, minsize: 18, maxsize: 1000, scalefactor: 1.1 },
  );
  dets = pico.cluster_detections(dets, 0.2)
    .map(([row, col, size, q]) => ({ row, col, size, q }));

  const report = processFrame(engine, dets, w, h);

  // 전송 조건: 밴드 변화, 또는 danger 중 내용(점수·신호 구성)이 바뀐 경우만 (확장과 동일)
  const key = `${report.band}|${report.score}|${report.signals.map((s) => s.id).join(',')}`;
  if (report.band !== lastBand || (report.band === 'danger' && key !== lastKey)) {
    lastBand = report.band;
    lastKey = key;
    window.peekguard.report(report);
  }
}

async function start() {
  try {
    const settings = await window.peekguard.getSettings();
    const preset = SENSITIVITY_PRESETS[settings?.sensitivity];
    if (preset) updateConfig(engine, preset);
    window.peekguard.onConfig((s) => {
      const p = SENSITIVITY_PRESETS[s];
      if (p) updateConfig(engine, p);
    });

    await loadCascade();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    setInterval(tick, 1000 / (engine.cfg.fps || DEFAULTS.fps));
  } catch (err) {
    window.peekguard.camError(
      err.name === 'NotAllowedError' || err.name === 'NotReadableError'
        ? 'Windows 설정 > 개인정보 > 카메라에서 데스크톱 앱의 카메라 접근을 허용해 주세요.'
        : `카메라 시작 실패: ${err.message}`,
    );
  }
}

start();
