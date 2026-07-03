/**
 * engine.js — PeekGuard 결정엔진 (순수 로직, 부수효과 없음).
 *
 * qshing-detector 와 같은 설계 철학:
 *  - 판정은 "왜"가 보이는 신호 목록 + 가중치 점수 + 밴드로 투명하게.
 *  - 감지기(pico)는 사실 수집만, 판정 권한은 이 결정론적 엔진이 가진다.
 *  - 오탐 억제는 히스테리시스로: 지속될 때만 발동(trigger), 여유를 두고 해제(release).
 *
 * 입력(프레임마다): detections = [{ row, col, size, q }]  (pico 클러스터 결과)
 * 출력: { band, score, signals[], faces, tracks } — UI 는 이걸 그대로 표시만 한다.
 *
 * 설계 근거(솔직한 한계 포함):
 *  - "정밀 시선각"은 웹캠+경량모델로는 신뢰도가 낮아 MVP 신호에서 제외했다.
 *    대신 pico 가 정면(화면 방향) 얼굴에 강하다는 특성 자체를 신호로 쓴다:
 *    카메라(≈화면)를 향하지 않는 얼굴은 애초에 잘 잡히지 않는다 → 자연스러운 시선 프록시.
 *  - 전면 카메라 화각 밖(정후방 등)은 물리적으로 감지 불가. README 에 명시.
 */

// ── 신호 가중치 (튜닝 가능, 한곳에 모음) ────────────────────────────────────
export const WEIGHTS = {
  extraFace:      { points: 35, severity: 'high',
    label: (n) => `사용자 외 얼굴 ${n}명이 화면 방향을 향해 감지됨` },
  persistentGaze: { points: 30, severity: 'high',
    label: (sec) => `해당 얼굴이 약 ${sec.toFixed(1)}초 이상 지속 응시 — 스쳐 지나감 아님` },
  closeRange:     { points: 20, severity: 'medium',
    label: (pct) => `화면을 읽을 수 있는 근거리(프레임 높이의 ${pct}%)` },
  approaching:    { points: 15, severity: 'medium',
    label: () => `얼굴 크기가 커지는 중 — 접근하고 있음` },
  crowd:          { points: 15, severity: 'medium',
    label: (n) => `주변 인원 다수(${n}명) — 노출 위험 환경` },
  userAbsent:     { points: 0, severity: 'info',
    label: () => `사용자 얼굴 미감지 — 자리 비움 가능성(참고용)` },
};

export const BANDS = {
  safe:    { min: 0,  label: '안전' },
  caution: { min: 30, label: '주의' },   // 배지 색만 변경, 화면은 가리지 않음
  danger:  { min: 60, label: '위험' },   // 블러/디코이 발동
};

export function bandFromScore(score) {
  if (score >= BANDS.danger.min) return 'danger';
  if (score >= BANDS.caution.min) return 'caution';
  return 'safe';
}

// ── 기본 설정 (popup 에서 민감도로 조절) ────────────────────────────────────
export const DEFAULTS = {
  fps: 6,                 // 감지 주기(배터리 절약: 30fps 대신 6fps)
  holdFrames: 3,          // 이 프레임 수 이상 지속되어야 persistentGaze (6fps 기준 0.5초)
  releaseFrames: 12,      // 위협 소실 후 이 프레임 동안 깨끗해야 해제 (2초) — 깜빡임 방지
  closeRangeRatio: 0.16,  // 얼굴 높이 / 프레임 높이 ≥ 이 값 → 근거리
  approachGrowth: 1.35,   // 트랙 내 얼굴 크기가 이 배율 이상 커지면 접근 중
  trackMatchDist: 0.22,   // 트랙 매칭 허용 거리(프레임 대각선 비율)
  minQuality: 5.0,        // pico q 임계
};

export const SENSITIVITY_PRESETS = {
  low:    { holdFrames: 6, releaseFrames: 18, closeRangeRatio: 0.20 }, // 둔감(카페 등 혼잡)
  normal: { holdFrames: 3, releaseFrames: 12, closeRangeRatio: 0.16 },
  high:   { holdFrames: 2, releaseFrames: 10, closeRangeRatio: 0.12 }, // 민감(금융작업 등)
};

// ── 엔진 상태 생성 ──────────────────────────────────────────────────────────
export function createEngine(config = {}) {
  return {
    cfg: { ...DEFAULTS, ...config },
    tracks: [],        // { id, row, col, size, age, firstSize, missing }
    nextId: 1,
    clearStreak: 0,    // 위협 없는 연속 프레임 수 (해제 히스테리시스)
    latched: false,    // danger 래치 상태
  };
}

export function updateConfig(engine, config) {
  engine.cfg = { ...engine.cfg, ...config };
}

// ── 프레임 1개 처리 ─────────────────────────────────────────────────────────
/**
 * @param {object} engine   createEngine() 상태 (변이됨)
 * @param {Array}  dets     [{row, col, size, q}] — 품질 필터 전 pico 클러스터
 * @param {number} frameW   분석 프레임 너비
 * @param {number} frameH   분석 프레임 높이
 * @returns {object} report { band, bandLabel, score, signals, faces, blur, tracks }
 */
export function processFrame(engine, dets, frameW, frameH) {
  const { cfg } = engine;
  const diag = Math.hypot(frameW, frameH);

  // 1) 품질 필터
  const faces = dets
    .filter((d) => d.q >= cfg.minQuality)
    .map((d) => ({ row: d.row, col: d.col, size: d.size, q: d.q }));

  // 2) 사용자(primary) = 가장 큰 얼굴. 나머지 = 잠재 위협.
  faces.sort((a, b) => b.size - a.size);
  const primary = faces[0] || null;
  const extras = faces.slice(1);

  // 3) 위협 얼굴 트래킹(중심거리 매칭) — 지속시간·접근 판정용
  const matched = new Set();
  for (const t of engine.tracks) t.missing++;
  for (const f of extras) {
    let best = null, bestDist = Infinity;
    for (const t of engine.tracks) {
      if (matched.has(t.id)) continue;
      const dist = Math.hypot(f.row - t.row, f.col - t.col) / diag;
      if (dist < cfg.trackMatchDist && dist < bestDist) { best = t; bestDist = dist; }
    }
    if (best) {
      best.row = f.row; best.col = f.col; best.size = f.size;
      best.age++; best.missing = 0;
      matched.add(best.id);
    } else {
      engine.tracks.push({
        id: engine.nextId++, row: f.row, col: f.col, size: f.size,
        firstSize: f.size, age: 1, missing: 0,
      });
    }
  }
  // 2프레임 연속 미검출 트랙 제거(1프레임 깜빡임은 허용)
  engine.tracks = engine.tracks.filter((t) => t.missing <= 1);

  // 4) 신호 수집 (근거를 라벨로 남김 — UI에 그대로 노출)
  const signals = [];
  const add = (id, arg) => {
    const w = WEIGHTS[id];
    signals.push({ id, points: w.points, severity: w.severity, label: w.label(arg) });
  };

  const liveTracks = engine.tracks.filter((t) => t.missing === 0);

  if (liveTracks.length >= 1) add('extraFace', liveTracks.length);

  const persistent = liveTracks.filter((t) => t.age >= cfg.holdFrames);
  if (persistent.length >= 1) {
    const maxAge = Math.max(...persistent.map((t) => t.age));
    add('persistentGaze', maxAge / cfg.fps);
  }

  const close = liveTracks.find((t) => t.size / frameH >= cfg.closeRangeRatio);
  if (close) add('closeRange', Math.round((close.size / frameH) * 100));

  const approaching = liveTracks.find(
    (t) => t.age >= 3 && t.size >= t.firstSize * cfg.approachGrowth,
  );
  if (approaching) add('approaching', null);

  if (liveTracks.length >= 3) add('crowd', liveTracks.length + 1);

  if (!primary) add('userAbsent', null);

  // 5) 점수·밴드
  const score = Math.min(100, signals.reduce((s, x) => s + x.points, 0));
  let band = bandFromScore(score);

  // 6) 히스테리시스(래치): danger 진입 후엔 releaseFrames 동안 깨끗해야 해제
  if (band === 'danger') {
    engine.latched = true;
    engine.clearStreak = 0;
  } else if (engine.latched) {
    if (liveTracks.length === 0) {
      engine.clearStreak++;
      if (engine.clearStreak >= cfg.releaseFrames) {
        engine.latched = false;
        engine.clearStreak = 0;
      } else {
        band = 'danger'; // 아직 래치 유지
      }
    } else {
      engine.clearStreak = 0;
      band = 'danger';   // 위협 얼굴이 남아있으면 유지
    }
  }

  // 심각도 순 정렬
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  signals.sort((a, b) => (order[a.severity] - order[b.severity]) || (b.points - a.points));

  return {
    band,
    bandLabel: BANDS[band].label,
    score,
    signals,
    blur: band === 'danger',
    faces: faces.length,
    extras: liveTracks.length,
    tracks: liveTracks.map((t) => ({ id: t.id, age: t.age, size: t.size })),
  };
}
