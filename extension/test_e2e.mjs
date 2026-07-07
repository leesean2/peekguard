// test_e2e.mjs — 다중 얼굴 E2E: pico(확장 실제 파라미터) → engine → 위험 판정
import fs from 'fs';
import { createEngine, processFrame } from './engine.js';

const src = fs.readFileSync('lib/pico.js', 'utf8');
const pico = new Function(src + '; return pico;')();
const classify = pico.unpack_cascade(new Int8Array(fs.readFileSync('models/facefinder')));

function detect(path, w, h, minsize) {
  const pixels = new Uint8Array(fs.readFileSync(path));
  let dets = pico.run_cascade(
    { pixels, nrows: h, ncols: w, ldim: w },
    classify,
    { shiftfactor: 0.1, minsize, maxsize: 1000, scalefactor: 1.1 }, // offscreen.js 와 동일
  );
  return pico.cluster_detections(dets, 0.2).map(([row, col, size, q]) => ({ row, col, size, q }));
}

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}: ${n}`); };

// 1) 원본 해상도에서 두 얼굴 모두 감지
const full = detect('e2e_full.gray', 512, 384, 40).filter(d => d.q >= 5);
console.log('  full(512):', full.map(d => `size=${d.size|0},q=${d.q.toFixed(1)}`).join(' / '));
check('원본 해상도: 얼굴 2개 감지', full.length === 2);

// 2) 확장 실제 분석 해상도(240px, minsize 18)에서도 두 얼굴 감지
const small = detect('e2e_240.gray', 240, 180, 18).filter(d => d.q >= 5);
console.log('  240px:', small.map(d => `size=${d.size|0},q=${d.q.toFixed(1)}`).join(' / '));
check('240px 분석 해상도: 얼굴 2개 감지', small.length === 2);

// 3) 같은 프레임을 반복 입력(지속 응시 시뮬레이션) → 엔진이 danger 판정
if (small.length === 2) {
  const e = createEngine();
  let r;
  for (let i = 0; i < 4; i++) r = processFrame(e, small, 240, 180);
  console.log('  판정:', r.band, r.score, '| 신호:', r.signals.map(s => `${s.id}+${s.points}`).join(' '));
  check('E2E: 4프레임(0.67초) 지속 → danger + 블러', r.band === 'danger' && r.blur === true);
  check('E2E: extraFace + persistentGaze 신호 포함',
    r.signals.some(s => s.id === 'extraFace') && r.signals.some(s => s.id === 'persistentGaze'));

  // 4) 제3자 소실 → 해제 히스테리시스 후 safe 복귀
  const userOnly = [small.sort((a, b) => b.size - a.size)[0]];
  for (let i = 0; i < 12; i++) r = processFrame(e, userOnly, 240, 180);
  check('E2E: 소실 12프레임(2초) 후 safe 복귀', r.band === 'safe' && !r.blur);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
