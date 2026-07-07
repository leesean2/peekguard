// overlay.js — 오버레이 UI 렌더링 (blur: 근거 표시 / decoy: 가짜 문서)

const mode = new URLSearchParams(location.search).get('mode') === 'decoy' ? 'decoy' : 'blur';
document.body.className = mode;

const SEV = {
  high:   { color: 'var(--warn)',    text: '높음' },
  medium: { color: 'var(--caution)', text: '보통' },
  low:    { color: 'var(--faint)',   text: '낮음' },
  info:   { color: 'var(--info)',    text: '정보' },
};

if (mode === 'blur') {
  document.body.innerHTML = `
    <div class="shield">
      <span class="badge"><span class="pulse"></span>PeekGuard — 화면 보호 중</span>
      <h1>제3자의 화면 응시가 감지되었습니다</h1>
      <ul id="signals"></ul>
      <button id="pauseBtn" class="pauseBtn">5분 일시정지</button>
      <span class="hint"><b>Esc 2번</b>을 빠르게 눌러도 5분간 해제됩니다 · 위협이 사라지면 약 2초 뒤 자동 해제</span>
    </div>`;
  document.getElementById('pauseBtn').addEventListener('click', () => peekguard.pause());
  peekguard.onReport((report) => {
    document.getElementById('signals').innerHTML = (report.signals || [])
      .filter((s) => s.points > 0)
      .map((s) => {
        const sev = SEV[s.severity] || SEV.info;
        return `<li class="sig">
          <span class="sigSev" style="color:${sev.color};border:1px solid ${sev.color}">${sev.text}</span>
          <span>${s.label}</span>
          <span style="margin-left:auto;font:600 11px var(--mono);color:var(--faint)">+${s.points}</span>
        </li>`;
      }).join('');
  });
} else {
  // 디코이: 눈에 띄는 보안 UI 없음. 하단에 아주 옅은 상태점만.
  const widths = [92, 88, 95, 72, 90, 85, 94, 60, 91, 87, 93, 78, 89, 52];
  document.body.innerHTML = `
    <div class="doc">
      <div class="title"></div>
      ${widths.map((w) => `<div class="line" style="width:${w}%"></div>`).join('')}
    </div>
    <div class="dot" title="PeekGuard — Esc 2번으로 해제"></div>`;
}
