/**
 * demo.js — Vercel 라이브 데모.
 * 확장과 동일한 파이프라인(웹캠 → pico → engine.js)을 브라우저에서 그대로 실행하고
 * 얼굴 상자·점수·신호를 시각화한다. 네트워크 전송 없음(정적 자산 로드 제외).
 * lib/engine.js 는 extension/engine.js 의 동기화 사본이다.
 */

import { createEngine, processFrame } from './lib/engine.js';

const ANALYSIS_WIDTH = 240;
const FPS = 6;

const $ = (id) => document.getElementById(id);
const view = $('view');
const vctx = view.getContext('2d');
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });
const video = document.createElement('video');
video.muted = true; video.playsInline = true;

const BAND_UI = {
  safe:    { text: '안전',  color: 'var(--accent)',  raw: '#27d3b6' },
  caution: { text: '주의',  color: 'var(--caution)', raw: '#f2b347' },
  danger:  { text: '위험',  color: 'var(--warn)',    raw: '#ff6f6f' },
};
const SEV_COLOR = { high: 'var(--warn)', medium: 'var(--caution)', low: 'var(--faint)', info: 'var(--info)' };
const SEV_TEXT = { high: '높음', medium: '보통', low: '낮음', info: '정보' };

let classify = null;
let engine = createEngine();
let running = false;
let timer = null;

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

function renderReport(report, faces, scale) {
  // 얼굴 상자: 가장 큰 얼굴(사용자)=틸, 나머지(제3자)=레드
  faces.sort((a, b) => b.size - a.size);
  faces.forEach((f, i) => {
    const r = (f.size / 2) * scale;
    vctx.strokeStyle = i === 0 ? '#27d3b6' : '#ff6f6f';
    vctx.lineWidth = 2.5;
    vctx.strokeRect(f.col * scale - r, f.row * scale - r, r * 2, r * 2);
  });

  const ui = BAND_UI[report.band];
  $('bandTxt').textContent = ui.text;
  $('bandTxt').style.color = ui.color;
  $('score').textContent = report.score;
  $('score').parentElement.style.color = ui.color;
  $('fill').style.width = `${report.score}%`;
  $('fill').style.background = ui.color;

  const list = $('signals');
  if (!report.signals.length) {
    list.innerHTML = `<li class="emptySig">신호 없음 — 감지된 얼굴 ${report.faces}개 (위협 0)</li>`;
  } else {
    list.innerHTML = report.signals.map((s) => `
      <li class="sig" style="--sev:${SEV_COLOR[s.severity]}">
        <span class="sigSev">${SEV_TEXT[s.severity]}</span>
        <span class="sigLabel">${s.label}</span>
        <span class="sigPts">${s.points ? '+' + s.points : ''}</span>
      </li>`).join('');
  }

  $('doc').classList.toggle('blurred', report.blur);
  $('docBanner').classList.toggle('show', report.blur);
}

function tick() {
  if (!running || video.readyState < 2) return;

  const w = ANALYSIS_WIDTH;
  const h = Math.round(video.videoHeight * (w / video.videoWidth)) || 180;
  work.width = w; work.height = h;
  wctx.drawImage(video, 0, 0, w, h);
  const gray = toGray(wctx.getImageData(0, 0, w, h).data, w * h);

  let dets = pico.run_cascade(
    { pixels: gray, nrows: h, ncols: w, ldim: w },
    classify,
    { shiftfactor: 0.1, minsize: 18, maxsize: 1000, scalefactor: 1.1 },
  );
  const faces = pico.cluster_detections(dets, 0.2)
    .map(([row, col, size, q]) => ({ row, col, size, q }));

  const report = processFrame(engine, faces, w, h);

  // 표시 캔버스: 프리뷰 + 상자
  const dispW = view.clientWidth || 440;
  const dispH = Math.round(dispW * (h / w));
  if (view.width !== dispW) { view.width = dispW; view.height = dispH; }
  vctx.drawImage(video, 0, 0, dispW, dispH);
  renderReport(report, faces.filter((f) => f.q >= engine.cfg.minQuality), dispW / w);
}

$('start').addEventListener('click', async () => {
  const btn = $('start');
  const err = $('err');
  err.style.display = 'none';

  if (running) { // 중지
    running = false;
    clearInterval(timer);
    timer = null;
    video.srcObject?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    btn.textContent = '카메라 시작 (로컬 데모)';
    btn.className = 'btn btnPrimary';
    $('camEmpty').style.display = 'flex';
    return;
  }

  btn.disabled = true;
  try {
    if (!classify) await loadCascade();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    engine = createEngine(); // 상태 초기화
    running = true;
    $('camEmpty').style.display = 'none';
    btn.textContent = '중지';
    btn.className = 'btn btnGhost';
    timer = setInterval(tick, 1000 / FPS);
  } catch (e) {
    err.style.display = 'block';
    err.textContent = e.name === 'NotAllowedError'
      ? '카메라 권한이 거부되었습니다. 주소창의 카메라 아이콘에서 허용해 주세요.'
      : `카메라 시작 실패: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
});
