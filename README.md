# PeekGuard — 숄더서핑 감지

공공장소에서 **화면을 응시하는 제3자**를 웹캠으로 감지해 화면을 즉시 가리고,
**"왜 가렸는지"를 신호·점수·밴드로 투명하게** 보여주는 온디바이스 보안 프로젝트.

| 구성 | 경로 | 설명 |
|------|------|------|
| 🧩 크롬 확장 | [`extension/`](extension/) | 브라우저 탭 보호. 상세 문서는 [extension/README.md](extension/README.md) |
| 🖥 데스크톱 앱 | [`desktop/`](desktop/) | **OS 화면 전체** 보호(모든 앱). Electron 트레이 앱 — [desktop/README.md](desktop/README.md) |
| 🌐 라이브 데모 · 📱 모바일 PWA (Vercel) | [`web/`](web/) | 설치 없이 브라우저에서 체험. 모바일에서는 홈 화면에 설치해 앱처럼 사용 |

## 핵심 특징

- **투명한 결정엔진** — 감지기는 사실만 수집, 판정은 신호+가중치+밴드의 결정론적
  엔진([`extension/engine.js`](extension/engine.js))이 소유. 블러가 뜨면 근거가 그대로 표시됨.
- **오탐 억제 1급 설계** — 스쳐가는 행인(35점)은 화면을 가리지 않고, 0.5초+ 지속 응시(65점)만
  발동. 해제도 2초 히스테리시스.
- **초경량 온디바이스** — 감지기 전체 245KB(pico.js, MIT). TF.js/wasm 불필요, 네트워크 요청 0.
- **검증** — 결정엔진 시나리오 테스트 12종 + 실제 인물 사진 감지 검증 (`extension/test_*.mjs`).

## Vercel 배포 (라이브 데모)

정적 사이트라 빌드가 없다. `vercel.json` 이 `web/` 을 출력 디렉터리로 지정한다.

1. 이 레포를 GitHub 에 push
2. [vercel.com/new](https://vercel.com/new) → 레포 Import → Framework **Other** → 그대로 **Deploy**
3. 배포 URL(HTTPS)에서 카메라 데모가 바로 동작

로컬 미리보기: `cd web && python3 -m http.server 8000` → http://localhost:8000

## 모바일 (PWA)

배포 URL을 모바일 브라우저로 열고 **홈 화면에 추가**(Android Chrome 메뉴 ⋮ /
iPhone Safari 공유 ↑)하면 앱처럼 실행된다. 전면 카메라로 감지하고, 감지 중에는
화면이 자동으로 꺼지지 않으며(Wake Lock), 위험 감지 시 진동으로 알린다.
한 번 설치하면 오프라인에서도 동작한다(서비스 워커가 모델 245KB 포함 전체를 캐시).
모바일 OS 제약상 브라우저 백그라운드 카메라는 불가 — **앱이 화면에 떠 있는 동안만** 감지한다.

## 데스크톱 앱 (브라우저 밖 전체 화면 보호)

```bash
cd desktop && npm install && npm start
```

트레이에 상주하며 백그라운드 감시. 위협 시 **모든 모니터**에 최상위
오버레이(블러/디코이)를 덮는다. 자세한 내용은 [desktop/README.md](desktop/README.md).

## 확장 설치

`web/peekguard-extension.zip` 다운로드 → 압축 해제 → `chrome://extensions` →
개발자 모드 → 압축해제된 확장 로드. 자세한 내용은 [extension/README.md](extension/README.md).

## 정직한 한계

전면 카메라 화각 밖(정후방)은 감지 불가. 유사 상용품(EyesOff)·관련 특허 존재 —
본 프로젝트는 **판정 근거의 완전한 투명화**에 초점을 둔 학습·포트폴리오 프로젝트다.
