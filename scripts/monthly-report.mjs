// 월간 점검 리포트 — 매달 1일 자동 실행해 텔레그램으로 요약을 보낸다.
//
// 데이터 가져오기 (둘 중 하나)
//   --backup <파일>       앱의 설정 → 백업 내보내기로 받은 JSON (로컬 실행용, data/ 폴더는 git 에 올라가지 않음)
//   --firestore --uid <UID>  Firebase 에 동기화된 데이터를 직접 읽기 (자동 실행용)
//                           인증: FIREBASE_SERVICE_ACCOUNT(서비스 계정 JSON 문자열) 또는 GOOGLE_APPLICATION_CREDENTIALS(파일 경로)
//                           필요 패키지: npm i --no-save firebase-admin
// 옵션
//   --year <연도>   기본: 올해
//   --send          텔레그램으로 보내기 (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 필요). 없으면 화면에만 출력
//   --json          통합 재정 리포트(6번·17번)용 JSON 출력
//
// 예: node scripts/monthly-report.mjs --backup data/backup.json
//     node scripts/monthly-report.mjs --firestore --uid abc123 --send

import { readFile } from 'node:fs/promises';
import { loadRules } from '../app/js/core/rules.js';
import { buildMonthlyReport } from '../app/js/core/report.js';
import { mergeYear } from '../app/js/core/merge.js';
import { emptyYear } from '../app/js/core/fields.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const year = Number(opt('year') || new Date().getFullYear());
await loadRules((p) => readFile(new URL(`../app/${p}`, import.meta.url), 'utf8'));

async function fromBackup(path) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (data.app !== 'taxcheck') throw new Error('이 앱의 백업 파일이 아닙니다.');
  return data.years?.[year];
}

async function fromFirestore(uid) {
  if (!uid) throw new Error('--uid 가 필요합니다 (앱 설정 → 계정에서 확인하거나 Firebase 콘솔 Authentication 에서 복사).');
  let appApi, fsApi;
  try {
    appApi = await import('firebase-admin/app');
    fsApi = await import('firebase-admin/firestore');
  } catch {
    throw new Error('firebase-admin 이 없습니다. 먼저 `npm i --no-save firebase-admin` 을 실행하세요.');
  }
  const { initializeApp, cert, applicationDefault } = appApi;
  const { getFirestore } = fsApi;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  initializeApp({ credential: sa ? cert(JSON.parse(sa)) : applicationDefault() });
  const snap = await getFirestore().doc(`users/${uid}/years/${year}`).get();
  return snap.exists ? snap.data() : null;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN 과 TELEGRAM_CHAT_ID 환경변수가 필요합니다.');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(`텔레그램 발송 실패: ${body.description || res.status}`);
}

try {
  const raw = flag('firestore') ? await fromFirestore(opt('uid')) : opt('backup') ? await fromBackup(opt('backup')) : null;
  if (raw === null && !flag('firestore') && !opt('backup')) throw new Error('--backup <파일> 또는 --firestore --uid <UID> 를 지정하세요.');
  const yearData = mergeYear(emptyYear(year), raw || null) || emptyYear(year);
  const { text, data } = buildMonthlyReport(yearData);
  console.log(flag('json') ? JSON.stringify(data, null, 2) : text);
  if (flag('send')) {
    await sendTelegram(text);
    console.error('텔레그램으로 보냈습니다.');
  }
} catch (e) {
  console.error(`오류: ${e.message}`);
  process.exit(1);
}
