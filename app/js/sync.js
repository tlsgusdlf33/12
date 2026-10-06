// 계정 동기화 (Firebase Auth + Cloud Firestore).
// 문서 경로: users/{uid}/years/{year}  —  본인만 읽고 쓸 수 있다 (firestore.rules).
// 동작 방식: 로컬에 먼저 저장 → 로그인 상태면 원격과 섹션별로 병합 → 양쪽에 반영.
// 다른 기기에서 수정하면 onSnapshot 으로 실시간 반영된다.

import { firebaseConfig } from './firebase-config.js';
import { store } from './store.js';
import { mergeYear, sameData } from './core/merge.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';

let fb = null; // { auth, db, authApi, fsApi }
let user = null;
let unsubscribeDoc = null;
let lastRemote = null;
let pushTimer = null;
let status = 'disabled';
const statusListeners = new Set();

export const syncEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

function setStatus(s, detail = '') {
  status = s;
  for (const fn of statusListeners) fn({ status: s, detail, user });
}

export function onSyncStatus(fn) {
  statusListeners.add(fn);
  fn({ status, user });
  return () => statusListeners.delete(fn);
}

export function currentUser() {
  return user;
}

const clean = (obj) => JSON.parse(JSON.stringify(obj)); // undefined 제거 (Firestore 는 undefined 를 거부)

export async function initSync() {
  if (!syncEnabled) {
    setStatus('disabled');
    return;
  }
  try {
    const [appApi, authApi, fsApi] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = appApi.initializeApp(firebaseConfig);
    const auth = authApi.getAuth(app);
    await authApi.setPersistence(auth, authApi.browserLocalPersistence);
    const db = fsApi.getFirestore(app);
    fb = { auth, db, authApi, fsApi };

    authApi.getRedirectResult(auth).catch((e) => setStatus('error', friendlyError(e)));
    authApi.onAuthStateChanged(auth, (u) => {
      user = u;
      if (u) watchYear(store.year);
      else {
        stopWatching();
        setStatus('signed-out');
      }
    });

    store.subscribe(({ source, year }) => {
      if (!user) return;
      if (source === 'settings' && year !== lastRemote?.year) watchYear(year);
      if (source === 'local') schedulePush();
    });
    window.addEventListener('online', () => user && schedulePush());
  } catch (e) {
    console.warn('동기화 초기화 실패', e);
    setStatus('offline', '네트워크에 연결되면 다시 시도합니다.');
  }
}

function docRef(year) {
  return fb.fsApi.doc(fb.db, 'users', user.uid, 'years', String(year));
}

function stopWatching() {
  if (unsubscribeDoc) unsubscribeDoc();
  unsubscribeDoc = null;
  lastRemote = null;
}

function watchYear(year) {
  stopWatching();
  setStatus('syncing');
  unsubscribeDoc = fb.fsApi.onSnapshot(
    docRef(year),
    { includeMetadataChanges: false },
    (snap) => {
      const remote = snap.exists() ? snap.data() : null;
      lastRemote = remote ?? { year };
      const local = store.getYear(year);
      const merged = mergeYear(local, remote);
      if (!sameData(merged, local)) store.replaceYear(merged, 'remote');
      if (!remote || !sameData(merged, remote)) schedulePush(0);
      else setStatus('synced');
    },
    (e) => setStatus('error', friendlyError(e)),
  );
}

function schedulePush(delay = 800) {
  clearTimeout(pushTimer);
  setStatus('syncing');
  pushTimer = setTimeout(push, delay);
}

async function push() {
  if (!user || !fb) return;
  const year = store.year;
  const merged = mergeYear(store.getYear(year), lastRemote?.year === year ? lastRemote : null);
  try {
    await fb.fsApi.setDoc(docRef(year), clean({ ...merged, syncedAt: Date.now() }));
    setStatus('synced');
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline', friendlyError(e));
  }
}

export async function syncNow() {
  if (user) await push();
}

// ───────── 로그인 ─────────

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

export async function signInWithGoogle() {
  const { auth, authApi } = fb;
  const provider = new authApi.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    // 홈 화면에 설치한 앱(특히 iOS)은 팝업이 막히는 경우가 많아 리디렉션 사용
    if (isStandalone() && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      await authApi.signInWithRedirect(auth, provider);
    } else {
      await authApi.signInWithPopup(auth, provider);
    }
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      await authApi.signInWithRedirect(auth, provider);
    } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      throw new Error(friendlyError(e));
    }
  }
}

export async function signInWithEmail(email, password, { create = false } = {}) {
  const { auth, authApi } = fb;
  try {
    if (create) await authApi.createUserWithEmailAndPassword(auth, email, password);
    else await authApi.signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

export async function resetPassword(email) {
  try {
    await fb.authApi.sendPasswordResetEmail(fb.auth, email);
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

// 계정 삭제: 클라우드 데이터 전부 + 로그인 계정 (스토어 정책상 필수). 이 기기의 로컬 데이터는 남는다.
export async function deleteAccount() {
  const { fsApi, db, authApi, auth } = fb;
  try {
    stopWatching();
    const snap = await fsApi.getDocs(fsApi.collection(db, 'users', user.uid, 'years'));
    await Promise.all(snap.docs.map((d) => fsApi.deleteDoc(d.ref)));
    await authApi.deleteUser(auth.currentUser);
  } catch (e) {
    if (user) watchYear(store.year);
    throw new Error(friendlyError(e));
  }
}

export async function signOut() {
  stopWatching();
  await fb.authApi.signOut(fb.auth);
}

function friendlyError(e) {
  const map = {
    'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않습니다.',
    'auth/wrong-password': '이메일 또는 비밀번호가 맞지 않습니다.',
    'auth/user-not-found': '가입되지 않은 이메일입니다.',
    'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인해 주세요.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
    'auth/requires-recent-login': '보안을 위해 로그아웃 후 다시 로그인한 뒤 삭제해 주세요.',
    'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
    'auth/network-request-failed': '네트워크 연결을 확인하세요.',
    'auth/unauthorized-domain': '이 주소는 Firebase 인증 허용 도메인에 등록되지 않았습니다. (README 참고)',
    'permission-denied': '클라우드 접근 권한이 없습니다. firestore.rules 배포를 확인하세요.',
    unavailable: '오프라인 상태입니다. 연결되면 자동으로 동기화합니다.',
  };
  return map[e?.code] || e?.message || '알 수 없는 오류';
}
