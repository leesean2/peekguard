// test_engine.mjs — 결정엔진 시나리오 테스트 (6fps 가정)
import { createEngine, processFrame } from './engine.js';

const W = 240, H = 180;
const USER = { row: 120, col: 120, size: 70, q: 40 };           // 사용자(큰 얼굴)
const PEEK = (size = 20) => ({ row: 60, col: 200, size, q: 20 }); // 뒤쪽 위협 얼굴 (20/180=11% < 근거리 16%)

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`); };

// ── 시나리오 1: 혼자 작업 → 항상 safe ──
{
  const e = createEngine();
  let r;
  for (let i = 0; i < 20; i++) r = processFrame(e, [USER], W, H);
  check('혼자 작업: safe, 블러 없음', r.band === 'safe' && !r.blur && r.score === 0);
}

// ── 시나리오 2: 행인이 1~2프레임 스쳐감 → caution까지만, 블러 금지 ──
{
  const e = createEngine();
  processFrame(e, [USER], W, H);
  const r1 = processFrame(e, [USER, PEEK()], W, H);       // 1프레임 등장
  const r2 = processFrame(e, [USER, PEEK()], W, H);       // 2프레임 (holdFrames=3 미만)
  const r3 = processFrame(e, [USER], W, H);                // 사라짐
  check('스쳐감 1프레임: 블러 없음 (extraFace=35 → caution)', !r1.blur && r1.band === 'caution');
  check('스쳐감 2프레임: 여전히 블러 없음', !r2.blur);
  check('사라진 뒤: safe 복귀', r3.band === 'safe' && !r3.blur);
}

// ── 시나리오 3: 지속 응시(0.5초+) → danger + 블러, 신호 근거 포함 ──
{
  const e = createEngine();
  let r;
  for (let i = 0; i < 4; i++) r = processFrame(e, [USER, PEEK()], W, H); // age 4 ≥ hold 3
  check('지속 응시: danger + 블러', r.band === 'danger' && r.blur);
  check('신호에 extraFace + persistentGaze 포함',
    r.signals.some(s => s.id === 'extraFace') && r.signals.some(s => s.id === 'persistentGaze'));
  check('점수 = 65 (35+30)', r.score === 65);
}

// ── 시나리오 4: 근거리 + 지속 → 점수 상승(85) ──
{
  const e = createEngine();
  let r;
  const close = PEEK(Math.ceil(H * 0.18)); // closeRangeRatio 0.16 초과
  for (let i = 0; i < 4; i++) r = processFrame(e, [USER, close], W, H);
  check('근거리 지속: closeRange 신호 + 85점', r.signals.some(s => s.id === 'closeRange') && r.score === 85);
}

// ── 시나리오 5: 해제 히스테리시스 — 위협 소실 후 12프레임(2초) 유지 뒤 해제 ──
{
  const e = createEngine();
  for (let i = 0; i < 4; i++) processFrame(e, [USER, PEEK()], W, H); // danger 래치
  let r;
  for (let i = 0; i < 11; i++) {
    r = processFrame(e, [USER], W, H);
    if (!r.blur) { check(`해제가 너무 빠름 (${i + 1}프레임)`, false); break; }
  }
  check('소실 후 11프레임까지 블러 유지(깜빡임 방지)', r.blur === true);
  r = processFrame(e, [USER], W, H); // 12번째
  check('12프레임(2초) 후 해제', r.blur === false && r.band === 'safe');
}

// ── 시나리오 6: 접근 감지 — 얼굴이 커지면 approaching ──
{
  const e = createEngine();
  let r;
  const sizes = [24, 26, 30, 34]; // 24→34 = 1.42배 ≥ 1.35
  for (const s of sizes) r = processFrame(e, [USER, PEEK(s)], W, H);
  check('접근 중: approaching 신호', r.signals.some(x => x.id === 'approaching'));
}

// ── 시나리오 7: 1프레임 깜빡임(감지 실패) 허용 — 트랙 유지 ──
{
  const e = createEngine();
  processFrame(e, [USER, PEEK()], W, H);
  processFrame(e, [USER], W, H);            // 1프레임 미검출
  const r = processFrame(e, [USER, PEEK()], W, H); // 같은 위치 재등장
  // age 는 '감지된 프레임 수'(=2). 핵심은 새 트랙이 아니라 기존 트랙이 유지되는 것.
  check('1프레임 깜빡임에도 동일 트랙 유지(age=2, 트랙 1개)', r.tracks.length === 1 && r.tracks[0].age === 2);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
