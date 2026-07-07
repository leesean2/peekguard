/**
 * sw.js — PWA 서비스 워커.
 * 앱 셸(HTML/JS/모델 245KB)을 캐시해 오프라인·지하철에서도 감지가 동작하게 한다.
 * 전략: stale-while-revalidate — 캐시를 즉시 응답하고 뒤에서 최신본으로 갱신.
 * (감지 파이프라인 자체는 네트워크 요청 0 — 여기서 다루는 건 정적 자산뿐)
 */

const CACHE = 'peekguard-v1';
const PRECACHE = [
  './',
  'demo.js',
  'lib/engine.js',
  'lib/pico.js',
  'models/facefinder',
  'manifest.webmanifest',
  'icons/icon192.png',
  'icons/icon512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 확장 zip(260KB)은 다운로드 전용이라 캐시하지 않는다
  if (e.request.method !== 'GET' || url.origin !== self.location.origin
      || url.pathname.endsWith('.zip')) return;

  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        })
        .catch(() => hit); // 오프라인: 캐시로 폴백
      return hit || net;
    }),
  );
});
