/**
 * content.js — 위협 판정 시 페이지 위 오버레이(블러/디코이) 표시.
 *
 * 투명성 원칙: 그냥 가리지 않고, "왜 가렸는지"(신호+점수)를 카드로 보여준다.
 * Shadow DOM(closed)으로 사이트 CSS 간섭·탐지를 차단한다.
 */

(() => {
  let host = null;
  let shadow = null;
  let lastKey = '';   // 동일 내용 재렌더링 방지 ("누르는 동안 보기" 상호작용 보호)

  const SEV_COLOR = { high: '#ff6f6f', medium: '#f2b347', low: '#90a7b3', info: '#46b0dd' };
  const SEV_TEXT = { high: '높음', medium: '보통', low: '낮음', info: '정보' };

  function ensureOverlay() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial; position:fixed; inset:0; z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(host);
  }

  function removeOverlay() {
    host?.remove();
    host = null; shadow = null;
  }

  function renderBlur(report) {
    ensureOverlay();
    const sigRows = report.signals.map((s) => `
      <li style="display:flex;gap:8px;align-items:flex-start;background:rgba(255,255,255,.06);
                 border:1px solid ${SEV_COLOR[s.severity]}44;border-radius:9px;padding:8px 11px;">
        <span style="flex:none;font:650 10px/1 ui-monospace,monospace;color:${SEV_COLOR[s.severity]};
                     border:1px solid ${SEV_COLOR[s.severity]}66;border-radius:5px;padding:3px 5px;min-width:30px;text-align:center;">
          ${SEV_TEXT[s.severity]}</span>
        <span style="flex:1;font:400 12.5px/1.4 system-ui,sans-serif;color:#e8f0f3;">${s.label}</span>
        <span style="flex:none;font:600 11px/1 ui-monospace,monospace;color:#5e7884;margin-top:2px;">+${s.points}</span>
      </li>`).join('');

    shadow.innerHTML = `
      <div style="position:fixed;inset:0;backdrop-filter:blur(26px) saturate(.7);
                  -webkit-backdrop-filter:blur(26px) saturate(.7);
                  background:rgba(10,16,20,.55);display:flex;align-items:center;justify-content:center;">
        <div style="max-width:400px;width:calc(100% - 40px);background:#0f1b22;border:1px solid #214050;
                    border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.5);
                    font-family:system-ui,-apple-system,'Malgun Gothic',sans-serif;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <span style="width:10px;height:10px;border-radius:50%;background:#ff6f6f;
                         box-shadow:0 0 12px #ff6f6f;"></span>
            <b style="color:#e8f0f3;font-size:16px;">화면 보호 중 — 제3자 응시 감지</b>
          </div>
          <div style="color:#90a7b3;font-size:12.5px;margin-bottom:14px;">
            위험 점수 <b style="color:#ff6f6f;font-family:ui-monospace,monospace;">${report.score}</b>/100 · 판정 근거:
          </div>
          <ul style="list-style:none;margin:0 0 16px;padding:0;display:flex;flex-direction:column;gap:6px;">
            ${sigRows}
          </ul>
          <div style="display:flex;gap:8px;">
            <button id="pg-peek" style="flex:1;cursor:pointer;border:1px solid #27d3b6;background:#27d3b6;
                    color:#04201b;font:650 13px/1 system-ui;border-radius:10px;padding:11px;">
              누르는 동안 보기</button>
            <button id="pg-pause" style="flex:1;cursor:pointer;border:1px solid #214050;background:#142530;
                    color:#e8f0f3;font:600 13px/1 system-ui;border-radius:10px;padding:11px;">
              5분 일시정지</button>
          </div>
          <div style="margin-top:12px;color:#5e7884;font-size:11px;line-height:1.5;">
            영상은 기기 밖으로 나가지 않으며 저장되지 않습니다. 위협이 사라지면 약 2초 뒤 자동 해제됩니다.
          </div>
        </div>
      </div>`;

    // 누르는 동안만 오버레이 투명화(임시 열람)
    const overlay = shadow.firstElementChild;
    const peekBtn = shadow.getElementById('pg-peek');
    peekBtn.addEventListener('pointerdown', () => { overlay.style.opacity = '0.04'; });
    const restore = () => { overlay.style.opacity = '1'; };
    peekBtn.addEventListener('pointerup', restore);
    peekBtn.addEventListener('pointerleave', restore);

    shadow.getElementById('pg-pause').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PG_PAUSE_FROM_OVERLAY' }).catch(() => {});
      removeOverlay();
    });
  }

  function renderDecoy() {
    ensureOverlay();
    // 디코이: 평범한 문서 화면처럼 보이게(눈에 띄는 보안 UI 없음). Esc 2회로 해제 대신
    // 위협 해제 시 자동 제거. 하단에 아주 옅은 상태점만 표시.
    shadow.innerHTML = `
      <div style="position:fixed;inset:0;background:#ffffff;color:#202124;
                  font-family:system-ui,-apple-system,'Malgun Gothic',sans-serif;overflow:hidden;">
        <div style="max-width:760px;margin:0 auto;padding:56px 32px;">
          <div style="height:28px;width:46%;background:#e8eaed;border-radius:6px;margin-bottom:26px;"></div>
          ${Array.from({ length: 14 }, (_, i) =>
            `<div style="height:13px;width:${[92, 88, 95, 72, 90, 85, 94, 60, 91, 87, 93, 78, 89, 52][i]}%;
                         background:#f1f3f4;border-radius:4px;margin-bottom:12px;"></div>`).join('')}
        </div>
        <div title="PeekGuard" style="position:fixed;right:10px;bottom:10px;width:8px;height:8px;
                    border-radius:50%;background:#dadce0;"></div>
      </div>`;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PG_THREAT') {
      if (msg.report.blur) {
        const key = `${msg.mode}|${msg.report.score}|${msg.report.signals.map((s) => s.id).join(',')}`;
        if (key !== lastKey || !host) {
          lastKey = key;
          msg.mode === 'decoy' ? renderDecoy() : renderBlur(msg.report);
        }
      } else {
        lastKey = '';
        removeOverlay();
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'PG_CLEAR') {
      removeOverlay();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
