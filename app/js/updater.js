// 업데이터: 서비스 워커로 새 버전을 감지하고, 사용자가 버튼 한 번으로 적용한다.
// 앱을 다시 설치할 필요가 없다. 개발자는 scripts/bump-version.mjs 로 버전을 올려 배포만 하면 된다.

import { APP_VERSION } from './version.js';

let registration = null;
let onAvailable = () => {};
let reloading = false;
let userRequested = false; // 첫 설치 때의 controllerchange 로 새로고침되지 않도록

export async function fetchRemoteVersion() {
  const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('버전 정보를 가져오지 못했습니다.');
  return res.json();
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

function watchInstalling(worker) {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) announce();
  });
}

async function announce() {
  let info = null;
  try {
    info = await fetchRemoteVersion();
  } catch {
    /* 버전 파일을 못 받아도 업데이트 자체는 가능 */
  }
  onAvailable(info);
}

export async function initUpdater({ onUpdateAvailable }) {
  onAvailable = onUpdateAvailable;
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !userRequested) return;
    reloading = true;
    window.location.reload();
  });

  try {
    registration = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  } catch (e) {
    console.warn('서비스 워커 등록 실패', e);
    return;
  }
  if (!registration) return; // 서비스 워커를 쓸 수 없는 환경 (사생활 보호 모드 등)

  if (registration.waiting && navigator.serviceWorker.controller) announce();
  if (registration.installing) watchInstalling(registration.installing);
  registration.addEventListener('updatefound', () => watchInstalling(registration.installing));

  // 앱을 켤 때, 화면으로 돌아올 때, 1시간마다 새 버전 확인
  const check = () => registration.update().catch(() => {});
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  setInterval(check, 60 * 60 * 1000);
}

// 설정 화면의 "업데이트 확인" 버튼
export async function checkForUpdate() {
  const info = await fetchRemoteVersion();
  const newer = compareVersions(info.version, APP_VERSION) > 0;
  if (registration) {
    await registration.update();
    if (registration.waiting) {
      onAvailable(info);
      return { status: 'available', info };
    }
    if (registration.installing) return { status: 'downloading', info };
  }
  return { status: newer ? 'downloading' : 'latest', info };
}

export function applyUpdate() {
  const waiting = registration?.waiting;
  userRequested = true;
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  else window.location.reload();
}
