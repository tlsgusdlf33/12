import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getRules } from '../app/js/core/rules.js';
import { emptyYear, emptyMonth } from '../app/js/core/fields.js';
import {
  earnedIncomeDeduction,
  progressiveTax,
  earnedIncomeCredit,
  cardDeduction,
  pensionCredit,
  medicalCredit,
  donationCredit,
  childCredit,
  calculateTax,
  sumMonths,
  analyze,
} from '../app/js/core/tax-engine.js';
import { mergeYear } from '../app/js/core/merge.js';

const R = getRules(2026);

test('근로소득공제 구간', () => {
  assert.equal(earnedIncomeDeduction(5_000_000, R), 3_500_000);
  assert.equal(earnedIncomeDeduction(15_000_000, R), 7_500_000);
  assert.equal(earnedIncomeDeduction(45_000_000, R), 12_000_000);
  assert.equal(earnedIncomeDeduction(50_000_000, R), 12_250_000);
  assert.equal(earnedIncomeDeduction(100_000_000, R), 14_750_000);
  assert.equal(earnedIncomeDeduction(1_000_000_000, R), 20_000_000); // 한도 2천만
});

test('누진세율', () => {
  assert.equal(progressiveTax(0, R), 0);
  assert.equal(progressiveTax(14_000_000, R), 840_000);
  assert.equal(progressiveTax(50_000_000, R), 6_240_000);
  assert.equal(progressiveTax(88_000_000, R), 15_360_000);
  assert.equal(progressiveTax(100_000_000, R), 19_560_000);
});

test('근로소득세액공제와 한도', () => {
  assert.equal(earnedIncomeCredit(1_000_000, 30_000_000, R), 550_000);
  assert.equal(earnedIncomeCredit(3_000_000, 30_000_000, R), 740_000); // 한도 74만
  assert.equal(earnedIncomeCredit(3_000_000, 50_000_000, R), 660_000); // 74만 - 13.6만 → 하한 66만
  assert.equal(earnedIncomeCredit(5_000_000, 130_000_000, R), 200_000);
});

test('카드 공제: 문턱 미달이면 0', () => {
  const c = cardDeduction(40_000_000, { credit: 9_000_000 }, R);
  assert.equal(c.threshold, 10_000_000);
  assert.equal(c.deduction, 0);
  assert.equal(c.toThreshold, 1_000_000);
});

test('카드 공제: 신용카드부터 문턱을 채움', () => {
  // 문턱 1천만: 신용 1천만으로 채우고 체크 500만 × 30% = 150만
  const c = cardDeduction(40_000_000, { credit: 10_000_000, debit: 5_000_000 }, R);
  assert.equal(c.deduction, 1_500_000);
  // 같은 1,500만을 신용으로만 쓰면 500만 × 15% = 75만
  const c2 = cardDeduction(40_000_000, { credit: 15_000_000 }, R);
  assert.equal(c2.deduction, 750_000);
});

test('카드 공제: 기본한도 + 전통시장·대중교통 추가한도', () => {
  const c = cardDeduction(
    40_000_000,
    { credit: 10_000_000, debit: 15_000_000, market: 2_000_000, transit: 1_000_000 },
    R,
  );
  // 체크 1500만×30%=450만, 시장 80만, 교통 40만 → 총 570만
  assert.equal(c.gross, 5_700_000);
  assert.equal(c.baseLimit, 3_000_000);
  // 초과 270만 중 특별분(120만)까지만 추가
  assert.equal(c.deduction, 4_200_000);
});

test('카드 공제: 자녀 수에 따른 한도 상향 (최대 2명)', () => {
  const spend = { credit: 10_000_000, debit: 20_000_000 };
  assert.equal(cardDeduction(40_000_000, spend, R, 0).deduction, 3_000_000);
  assert.equal(cardDeduction(40_000_000, spend, R, 1).deduction, 3_500_000);
  assert.equal(cardDeduction(40_000_000, spend, R, 3).deduction, 4_000_000);
});

test('카드 공제: 총급여 7천 초과면 문화비는 신용카드로 취급', () => {
  const c = cardDeduction(80_000_000, { credit: 20_000_000, culture: 1_000_000 }, R);
  assert.equal(c.cultureEligible, false);
  assert.equal(c.deduction, 150_000);
});

test('연금계좌 세액공제', () => {
  const low = pensionCredit(50_000_000, { pensionSavings: 7_000_000, irp: 1_000_000 }, R);
  assert.equal(low.eligible, 7_000_000); // 연금저축은 600만까지만
  assert.equal(low.credit, 1_050_000);
  assert.equal(low.room, 2_000_000);
  const high = pensionCredit(80_000_000, { pensionSavings: 6_000_000, irp: 3_000_000, isaTransfer: 30_000_000 }, R);
  assert.equal(high.credit, Math.floor((9_000_000 + 3_000_000) * 0.12));
});

test('의료비: 총급여 3% 문턱은 일반 부양가족부터 차감', () => {
  const m = medicalCredit(50_000_000, { medicalGeneral: 1_000_000, medicalSpecial: 2_000_000 }, R);
  assert.equal(m.threshold, 1_500_000);
  assert.equal(m.credit, 225_000); // (3백만 - 150만) × 15%
  const none = medicalCredit(50_000_000, { medicalSpecial: 1_000_000 }, R);
  assert.equal(none.credit, 0);
  assert.equal(none.toThreshold, 500_000);
});

test('기부금: 고향사랑 10만 원까지 100/110', () => {
  const d = donationCredit({ donationHometown: 100_000 }, R);
  assert.equal(d.nonSpecial, 90_909);
  assert.equal(donationCredit({ donationGeneral: 12_000_000 }, R).special, 2_100_000);
});

test('자녀세액공제', () => {
  assert.equal(childCredit({ childrenOver8: 1 }, R).credit, 250_000);
  assert.equal(childCredit({ childrenOver8: 2 }, R).credit, 550_000);
  assert.equal(childCredit({ childrenOver8: 3, newbornOrder: 3 }, R).credit, 950_000 + 700_000);
});

test('전체 계산: 결정세액은 음수가 되지 않고 연금 납입으로 줄어든다', () => {
  const profile = { salary: 50_000_000 };
  const zero = calculateTax(profile, {}, R);
  assert.ok(zero.determined > 0);
  const withPension = calculateTax(profile, { pensionSavings: 6_000_000, irp: 3_000_000 }, R);
  const saved = zero.totalTax - withPension.totalTax;
  assert.equal(saved, Math.floor(9_000_000 * 0.15) + Math.floor(Math.floor(9_000_000 * 0.15) * 0.1));
  const low = calculateTax({ salary: 15_000_000 }, { pensionSavings: 6_000_000 }, R);
  assert.equal(low.determined, 0);
});

test('전체 계산: 기납부세액이 있으면 환급액 계산', () => {
  const t = calculateTax({ salary: 50_000_000, prepaidTax: 3_000_000 }, {}, R);
  assert.equal(t.prepaidTotal, 3_300_000);
  assert.equal(t.refund, 3_300_000 - t.totalTax);
});

test('표준세액공제가 더 유리하면 자동 선택', () => {
  const t = calculateTax({ salary: 30_000_000, healthInsurance: 0 }, {}, R);
  assert.equal(t.method, 'standard');
  const t2 = calculateTax({ salary: 60_000_000 }, { insurance: 1_000_000, medicalSpecial: 5_000_000 }, R);
  assert.equal(t2.method, 'itemized');
});

test('연간 예상: 입력 안 한 달은 평균으로 채움 (카드·월세만)', () => {
  const y = emptyYear(2026);
  y.months[1] = { ...emptyMonth(), credit: 1_000_000, irp: 500_000, updatedAt: 1 };
  y.months[2] = { ...emptyMonth(), credit: 2_000_000, irp: 500_000, updatedAt: 1 };
  const a = sumMonths(y, { project: false });
  assert.equal(a.totals.credit, 3_000_000);
  const p = sumMonths(y, { project: true });
  assert.equal(p.totals.credit, 3_000_000 + 1_500_000 * 10);
  assert.equal(p.totals.irp, 1_000_000); // 납입은 추정하지 않음
});

test('분석: 총급여가 없으면 내 정보 입력을 먼저 안내', () => {
  const r = analyze(emptyYear(2026), { today: new Date(2026, 5, 1) });
  assert.equal(r.recommendations[0].id, 'profile');
});

test('분석: 연금 한도 남은 금액과 월 권장액', () => {
  const y = emptyYear(2026);
  y.profile.salary = 50_000_000;
  y.months[4] = { ...emptyMonth(), credit: 1_000_000, pensionSavings: 1_000_000, updatedAt: 1 };
  const r = analyze(y, { today: new Date(2026, 5, 15) });
  const rec = r.recommendations.find((x) => x.id === 'pension');
  assert.ok(rec);
  assert.match(rec.title, /800만 원/);
  assert.ok(rec.amount > 1_000_000);
  assert.ok(r.recommendations.some((x) => x.id === 'missing-month'));
});

test('동기화 병합: 섹션별 최신 값 채택', () => {
  const a = emptyYear(2026);
  const b = emptyYear(2026);
  a.profile = { ...a.profile, salary: 1, updatedAt: 10 };
  b.profile = { ...b.profile, salary: 2, updatedAt: 20 };
  a.months[1] = { ...emptyMonth(), credit: 100, updatedAt: 30 };
  b.months[1] = { ...emptyMonth(), credit: 200, updatedAt: 5 };
  b.months[2] = { ...emptyMonth(), credit: 300, updatedAt: 5 };
  const m = mergeYear(a, b);
  assert.equal(m.profile.salary, 2);
  assert.equal(m.months[1].credit, 100);
  assert.equal(m.months[2].credit, 300);
  assert.deepEqual(mergeYear(a, b), mergeYear(b, a));
});

test('동기화 비교: 키 순서와 syncedAt 은 무시', async () => {
  const { sameData } = await import('../app/js/core/merge.js');
  assert.ok(sameData({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1, syncedAt: 5 }));
  assert.ok(!sameData({ a: 1 }, { a: 2 }));
});

test('연금 권장액: 세금이 0원이 되는 지점까지만 권장', async () => {
  const { pensionGain } = await import('../app/js/core/tax-engine.js');
  const profile = { salary: 35_000_000, dependents: 2 };
  const base = calculateTax(profile, {}, R);
  const pg = pensionGain(profile, {}, R);
  assert.ok(pg.recommended < 9_000_000, `권장액 ${pg.recommended}`);
  assert.equal(pg.gain, base.totalTax);
  assert.equal(calculateTax(profile, { irp: pg.recommended }, R).determined, 0);
  assert.ok(calculateTax(profile, { irp: pg.recommended - 10_000 }, R).determined > 0);
});

test('버전 번호가 모든 파일에서 일치 (업데이터 동작 조건)', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8');
  const v = JSON.parse(await read('app/version.json')).version;
  assert.match(await read('app/js/version.js'), new RegExp(`APP_VERSION = '${v}'`));
  assert.match(await read('app/sw.js'), new RegExp(`const VERSION = '${v}'`));
  assert.equal(JSON.parse(await read('package.json')).version, v);
});

test('서비스 워커 사전 캐시 목록의 파일이 모두 존재', async () => {
  const { readFile, access } = await import('node:fs/promises');
  const sw = await readFile(new URL('../app/sw.js', import.meta.url), 'utf8');
  const list = JSON.parse(sw.match(/const ASSETS = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const f of list.filter((x) => x !== './')) await access(new URL(`../app/${f}`, import.meta.url));
});
