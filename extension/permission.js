/** permission.js — 확장 오리진에 카메라 권한을 1회 부여받는다.
 *  (offscreen 문서는 권한 프롬프트를 띄울 수 없어, 보이는 페이지에서 먼저 허용 필요) */

document.getElementById('grant').addEventListener('click', async () => {
  const btn = document.getElementById('grant');
  const ok = document.getElementById('ok');
  const fail = document.getElementById('fail');
  btn.disabled = true;
  fail.style.display = 'none';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    // 권한만 필요하므로 즉시 해제 — 카메라 표시등이 계속 켜지지 않게 한다.
    stream.getTracks().forEach((t) => t.stop());
    ok.style.display = 'block';
  } catch (err) {
    btn.disabled = false;
    fail.style.display = 'block';
    fail.textContent = err.name === 'NotAllowedError'
      ? '권한이 거부되었습니다. 주소창의 카메라 아이콘 또는 chrome://settings/content/camera 에서 허용해 주세요.'
      : `실패: ${err.message}`;
  }
});
