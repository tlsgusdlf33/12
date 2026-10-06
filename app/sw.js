// 서비스 워커: 오프라인 실행 + 업데이트 배포.
// VERSION 이 바뀌면 브라우저가 새 워커를 내려받고, 앱이 "업데이트" 배너를 띄운다.
// scripts/bump-version.mjs 가 VERSION 을 자동으로 갱신한다.
const VERSION = '1.0.0';
const CACHE = `taxcheck-${VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/store.js',
  'js/sync.js',
  'js/updater.js',
  'js/reminders.js',
  'js/version.js',
  'js/firebase-config.js',
  'js/core/rules.js',
  'js/core/fields.js',
  'js/core/tax-engine.js',
  'js/core/merge.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

// 호스팅이 index.html → / 로 리디렉션하는 경우, 리디렉션된 응답은 화면 탐색에 쓸 수 없으므로 새 응답으로 감싼다
async function cleanResponse(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  // 새 파일을 모두 받아둔 뒤 대기한다. 적용 시점은 사용자가 고른다.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        ASSETS.map(async (url) => {
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (!res.ok) throw new Error(`${url} ${res.status}`);
          await cache.put(url, await cleanResponse(res));
        }),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('taxcheck-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase 등 외부 요청은 그대로
  if (url.pathname.endsWith('/version.json')) return; // 항상 네트워크에서 최신 확인

  if (req.mode === 'navigate') {
    event.respondWith(
      caches
        .open(CACHE)
        .then((c) => c.match('index.html'))
        .then((r) => r || fetch(req)),
    );
    return;
  }
  event.respondWith(
    caches
      .open(CACHE)
      .then((c) => c.match(req, { ignoreSearch: true }))
      .then((r) => r || fetch(req)),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow('./');
    }),
  );
});
