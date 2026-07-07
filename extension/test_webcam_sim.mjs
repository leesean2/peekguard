// test_webcam_sim.mjs — 열화 웹캠 시뮬레이션으로 파이프라인 검증.
// (버그 리포트 1: "혼자인데 사용자를 인식 못 함" → 엔진 내 위치 추적 q 누적으로 수정)
// (버그 리포트 2: "고개를 움직이면 혼자인데 위험 오탐" → detection memory 제거로 수정)
// offscreen.js / demo.js 와 동일하게 cluster → engine 순서로 실행한다.
import fs from 'fs';
import { createEngine, processFrame, DEFAULTS } from './engine.js';

const src = fs.readFileSync('lib/pico.js', 'utf8');
const P = new Function(src + '; return pico;')();
const classify = P.unpack_cascade(new Int8Array(fs.readFileSync('models/facefinder')));
const params = { shiftfactor: 0.1, minsize: 18, maxsize: 1000, scalefactor: 1.1 };

function pipelineRun(prefix, nFrames, w, h) {
  const engine = createEngine();
  const perFrame = [];
  for (let i = 0; i < nFrames; i++) {
    const pixels = new Uint8Array(fs.readFileSync(`${prefix}${i}.gray`));
    let dets = P.run_cascade({ pixels, nrows: h, ncols: w, ldim: w }, classify, params);
    dets = P.cluster_detections(dets, 0.2).map(([row, col, size, q]) => ({ row, col, size, q }));
    perFrame.push(processFrame(engine, dets, w, h));
  }
  return perFrame;
}

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}: ${n}`); };

console.log(`minQuality = ${DEFAULTS.minQuality} (위치 추적 ${DEFAULTS.qMemFrames}프레임 누적 기준)`);

// ── 시나리오 1: 사용자 혼자, 정지 (버그 1 재현 조건) ──
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

// ── 시나리오 3: 사용자 혼자, 고개를 움직임 (버그 2 재현 조건) ──
// detection memory 방식은 이전 위치 잔상이 별도 클러스터로 쪼개져
// "제3자 감지 → danger 오탐"을 만들었다. 전 구간 blur 없음을 보장해야 한다.
const move = pipelineRun('sim_move', 10, 320, 240);
console.log('  move 프레임별 인식:', move.map(r => r.faces).join(','), '| 밴드:', move.map(r => r.band[0]).join(''));
check('움직이는 혼자: 전 구간 블러 없음 (잔상 오탐 없음)', move.every(r => !r.blur));
check('움직이는 혼자: danger 미도달', move.every(r => r.band !== 'danger'));

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
