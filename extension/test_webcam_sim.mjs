// test_webcam_sim.mjs — 열화 웹캠 시뮬레이션으로 새 파이프라인 검증.
// (버그 리포트 재현: "혼자인데 사용자를 인식 못 함" → memory(5) + 임계 15로 수정)
// offscreen.js / demo.js 와 동일하게 memory → cluster → engine 순서로 실행한다.
import fs from 'fs';
import { createEngine, processFrame, DEFAULTS } from './engine.js';

const src = fs.readFileSync('lib/pico.js', 'utf8');
const P = new Function(src + '; return pico;')();
const classify = P.unpack_cascade(new Int8Array(fs.readFileSync('models/facefinder')));
const params = { shiftfactor: 0.1, minsize: 18, maxsize: 1000, scalefactor: 1.1 };

function pipelineRun(prefix, nFrames, w, h) {
  const mem = P.instantiate_detection_memory(5);
  const engine = createEngine();
  const perFrame = [];
  for (let i = 0; i < nFrames; i++) {
    const pixels = new Uint8Array(fs.readFileSync(`${prefix}${i}.gray`));
    let dets = P.run_cascade({ pixels, nrows: h, ncols: w, ldim: w }, classify, params);
    dets = mem(dets);
    dets = P.cluster_detections(dets, 0.2).map(([row, col, size, q]) => ({ row, col, size, q }));
    perFrame.push(processFrame(engine, dets, w, h));
  }
  return perFrame;
}

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}: ${n}`); };

console.log(`minQuality = ${DEFAULTS.minQuality} (memory 누적 기준)`);

// ── 시나리오 1: 사용자 혼자 (버그 재현 조건) ──
const solo = pipelineRun('sim_solo', 8, 320, 240);
console.log('  solo 프레임별 인식:', solo.map(r => r.faces).join(','), '| 밴드:', solo.map(r => r.band[0]).join(''));
check('열화 조건 혼자: 2프레임째부터 사용자 지속 인식 (faces=1)',
  solo.slice(1).every(r => r.faces >= 1));
check('열화 조건 혼자: 전 구간 safe, 블러 없음',
  solo.every(r => r.band === 'safe' && !r.blur));

// ── 시나리오 2: 사용자 + 1.5m 뒤 지속 응시자 (열화 조건) ──
const two = pipelineRun('sim_two', 8, 320, 240);
console.log('  two  프레임별 인식:', two.map(r => r.faces).join(','), '| 밴드:', two.map(r => r.band[0]).join(''));
const last = two[two.length - 1];
check('열화 조건 두 얼굴: 종반 두 얼굴 모두 인식', last.faces === 2);
check('열화 조건 두 얼굴: danger 도달 + 블러 (8프레임 내)', last.band === 'danger' && last.blur);
check('열화 조건 두 얼굴: 근거 신호(extraFace, persistentGaze) 포함',
  last.signals.some(s => s.id === 'extraFace') && last.signals.some(s => s.id === 'persistentGaze'));

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
