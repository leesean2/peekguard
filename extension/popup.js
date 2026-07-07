/** popup.js — 상태 표시 + 설정 제어. 판정 로직 없음(표시 전용). */

const $ = (id) => document.getElementById(id);
const BAND_UI = {
  safe:    { text: '안전',  color: 'var(--accent)' },
  caution: { text: '주의',  color: 'var(--caution)' },
  danger:  { text: '위험',  color: 'var(--warn)' },
};
const SIG_KO = {
  extraFace: '타인 얼굴', persistentGaze: '지속 응시', closeRange: '근거리',
  approaching: '접근', crowd: '다수 인원', userAbsent: '자리비움',
};

function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
}
function fmtTs(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderReport(settings, report) {
  const on = settings.enabled && Date.now() >= settings.pausedUntil;
  $('toggle').checked = settings.enabled;
  $('sens').value = settings.sensitivity;
  $('mode').value = settings.mode;

  if (!on) {
    const paused = settings.enabled && Date.now() < settings.pausedUntil;
    $('dot').className = 'dot';
    $('band').textContent = paused ? '일시정지' : '꺼짐';
    $('band').style.color = 'var(--faint)';
    $('score').textContent = '–';
    $('fill').style.width = '0%';
    $('sub').textContent = paused
      ? `${fmtTs(settings.pausedUntil)} 에 자동 재개됩니다`
      : '감지를 켜면 실시간 판정이 표시됩니다';
    return;
  }

  if (report?.error) {
    $('err').style.display = 'block';
    $('err').textContent = report.error;
    $('dot').className = 'dot';
    $('band').textContent = '오류';
    $('band').style.color = 'var(--warn)';
    $('score').textContent = '–';
    $('fill').style.width = '0%';
    $('sub').textContent = '카메라 문제를 해결한 뒤 토글을 껐다 켜세요';
    return;
  }
  $('err').style.display = 'none';

  const band = report?.band || 'safe';
  const ui = BAND_UI[band];
  $('dot').className = `dot ${band}`;
  $('band').textContent = ui.text;
  $('band').style.color = ui.color;
  $('score').textContent = report?.score ?? 0;
  $('fill').style.width = `${report?.score ?? 0}%`;
  $('fill').style.background = ui.color;
  $('sub').textContent = report
    ? (report.signals.length
        ? report.signals.map((s) => SIG_KO[s.id] || s.id).join(' · ')
        : `감지된 위협 없음 (얼굴 ${report.faces ?? 0})`)
    : '카메라 초기화 중…';
}

async function refresh() {
  const { settings, report } = await chrome.runtime.sendMessage({ type: 'PG_GET_STATE' });
  renderReport(settings, report);
}

async function renderLog() {
  const { log = [] } = await chrome.storage.local.get('log');
  const box = $('events');
  if (!log.length) { box.innerHTML = '<span class="empty">아직 기록이 없습니다</span>'; return; }
  box.innerHTML = log.slice(0, 6).map((e) => `
    <div class="ev">
      <span>${fmtTs(e.ts)} · ${(e.signals || []).map((s) => SIG_KO[s] || s).join(', ')}</span>
      <span><b>${e.score}</b> · ${fmtDur(e.durationMs)}</span>
    </div>`).join('');
}

$('toggle').addEventListener('change', async (e) => {
  await chrome.runtime.sendMessage({ type: 'PG_SET', patch: { enabled: e.target.checked, pausedUntil: 0 } });
  refresh();
});
$('sens').addEventListener('change', (e) =>
  chrome.runtime.sendMessage({ type: 'PG_SET', patch: { sensitivity: e.target.value } }));
$('mode').addEventListener('change', (e) =>
  chrome.runtime.sendMessage({ type: 'PG_SET', patch: { mode: e.target.value } }));
$('pause').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'PG_PAUSE', minutes: 5 });
  refresh();
});
$('perm').addEventListener('click', () =>
  chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }));

refresh();
renderLog();
setInterval(refresh, 700); // 팝업 열려있는 동안 실시간 갱신
