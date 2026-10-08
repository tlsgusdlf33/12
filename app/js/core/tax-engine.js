// 연말정산 계산 엔진. DOM 에 의존하지 않아 브라우저와 Node(테스트) 양쪽에서 동작한다.
// 근로소득만 있는 직장인 기준의 "추정" 계산이며, 실제 결정세액과 차이가 날 수 있다.

import { getRules } from './rules.js';
import { DEFAULT_PROFILE, MONTH_KEYS, PROJECTED_KEYS } from './fields.js';

const floor = Math.floor;
const clamp0 = (n) => Math.max(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// 요건 판정: 'yes' | 'no' | 'unknown'. 예전 데이터의 true/false 도 받는다 (false 는 '모름'으로 취급).
export const isYes = (v) => v === true || v === 'yes';
export const isUnknown = (v) => v !== true && v !== 'yes' && v !== 'no';

// ───────────────────────── 월별 합계 ─────────────────────────

export function enteredMonths(yearData) {
  return Object.keys(yearData.months || {})
    .map(Number)
    .filter((m) => m >= 1 && m <= 12 && yearData.months[m]?.updatedAt && !yearData.months[m].cleared)
    .sort((a, b) => a - b);
}

// project=true 이면 입력하지 않은 달의 사용액(카드·월세)을 입력한 달의 평균으로 채운다.
export function sumMonths(yearData, { project = false } = {}) {
  const totals = Object.fromEntries(MONTH_KEYS.map((k) => [k, 0]));
  const entered = enteredMonths(yearData);
  for (const m of entered) {
    const row = yearData.months[m];
    for (const k of MONTH_KEYS) totals[k] += num(row[k]);
  }
  const missing = 12 - entered.length;
  if (project && entered.length > 0 && missing > 0) {
    for (const k of PROJECTED_KEYS) {
      totals[k] += floor((totals[k] / entered.length) * missing);
    }
  }
  return { totals, enteredCount: entered.length, projected: project && missing > 0 && entered.length > 0 };
}

// ───────────────────────── 개별 공제 계산 ─────────────────────────

export function earnedIncomeDeduction(salary, rules) {
  const { brackets, max } = rules.earnedIncomeDeduction;
  let prev = 0;
  let ded = 0;
  for (const [upper, rate] of brackets) {
    if (salary <= prev) break;
    ded += (Math.min(salary, upper) - prev) * rate;
    prev = upper;
  }
  return floor(Math.min(ded, max));
}

export function progressiveTax(taxBase, rules) {
  if (taxBase <= 0) return 0;
  for (const [upper, rate, deduction] of rules.taxBrackets) {
    if (taxBase <= upper) return floor(taxBase * rate - deduction);
  }
  return 0;
}

export function marginalRate(taxBase, rules) {
  for (const [upper, rate] of rules.taxBrackets) {
    if (taxBase <= upper) return rate;
  }
  return rules.taxBrackets.at(-1)[1];
}

export function earnedIncomeCredit(calculatedTax, salary, rules) {
  const r = rules.earnedIncomeCredit;
  const raw =
    calculatedTax <= r.lowTaxCap
      ? calculatedTax * r.lowRate
      : r.lowTaxCap * r.lowRate + (calculatedTax - r.lowTaxCap) * r.highRate;
  const tier = r.limits.find((t) => salary <= t.maxSalary);
  const limit = Math.max(tier.floor, tier.start - (salary - tier.from) * tier.reduceRate);
  return floor(Math.min(raw, limit));
}

export function estimateSocialInsurance(salary, rules) {
  const s = rules.socialInsurance;
  const monthly = salary / 12;
  const pensionBase = Math.min(Math.max(monthly, s.pensionMonthlyMin), s.pensionMonthlyMax);
  const nationalPension = salary > 0 ? floor(pensionBase * s.pensionRate * 12) : 0;
  const health = salary * s.healthRate;
  const healthInsurance = floor(health + health * s.longTermCareRatio + salary * s.employmentRate);
  return { nationalPension, healthInsurance };
}

// 신용카드 등 소득공제. 공제율이 낮은 결제수단부터 문턱(총급여 25%)을 채운다.
export function cardDeduction(salary, spend, rules, children = 0) {
  const c = rules.card;
  const cultureEligible = salary <= c.cultureSalaryCap;
  const amounts = {
    credit: num(spend.credit) + (cultureEligible ? 0 : num(spend.culture)),
    debit: num(spend.debit),
    culture: cultureEligible ? num(spend.culture) : 0,
    market: num(spend.market),
    transit: num(spend.transit),
  };
  const order = ['credit', 'debit', 'culture', 'market', 'transit'];
  const threshold = floor(salary * c.thresholdRate);
  const totalSpend = order.reduce((s, k) => s + amounts[k], 0);

  let remaining = threshold;
  const byCategory = {};
  let gross = 0;
  let special = 0;
  for (const k of order) {
    const used = Math.min(amounts[k], remaining);
    remaining -= used;
    const ded = (amounts[k] - used) * c.rates[k];
    byCategory[k] = { amount: amounts[k], appliedToThreshold: used, deduction: floor(ded) };
    gross += ded;
    if (k !== 'credit' && k !== 'debit') special += ded;
  }
  gross = floor(gross);
  special = floor(special);

  const tier = c.limits.find((t) => salary <= t.maxSalary);
  const bonus = Math.min(children, c.childBonusMaxChildren) * c.childBonusPerChild;
  const baseLimit = tier.base + bonus;
  const base = Math.min(gross, baseLimit);
  const extra = Math.min(clamp0(gross - baseLimit), special, tier.extra);
  const deduction = salary > 0 ? base + extra : 0;

  return {
    threshold,
    totalSpend,
    thresholdReached: totalSpend >= threshold,
    toThreshold: clamp0(threshold - totalSpend),
    gross,
    baseLimit,
    extraLimit: tier.extra,
    deduction,
    baseMaxed: gross >= baseLimit,
    // 일반 한도를 다 채우려면 체크카드로 더 써야 하는 금액
    debitToFillBase: gross >= baseLimit ? 0 : Math.ceil((baseLimit - gross) / c.rates.debit) + clamp0(threshold - totalSpend),
    byCategory,
    cultureEligible,
  };
}

export function pensionCredit(salary, t, rules) {
  const p = rules.pension;
  const savings = Math.min(num(t.pensionSavings), p.savingsLimit);
  const eligible = Math.min(savings + num(t.irp), p.totalLimit);
  const isaExtra = Math.min(num(t.isaTransfer) * p.isaTransferRate, p.isaTransferLimit);
  const rate = salary <= p.highRateSalaryCap ? p.highRate : p.lowRate;
  return {
    eligible,
    isaExtra: floor(isaExtra),
    rate,
    room: p.totalLimit - eligible,
    savingsRoom: p.savingsLimit - savings,
    credit: floor((eligible + isaExtra) * rate),
  };
}

export function medicalCredit(salary, t, rules) {
  const m = rules.medical;
  let threshold = floor(salary * m.thresholdRate);
  // 문턱은 일반 → 특정(본인 등) → 미숙아 → 난임 순으로 차감
  const take = (amount) => {
    const used = Math.min(amount, threshold);
    threshold -= used;
    return amount - used;
  };
  const general = Math.min(take(num(t.medicalGeneral)), m.generalLimit);
  const special = take(num(t.medicalSpecial));
  const premature = take(num(t.medicalPremature));
  const infertility = take(num(t.medicalInfertility));
  const total = num(t.medicalGeneral) + num(t.medicalSpecial) + num(t.medicalPremature) + num(t.medicalInfertility);
  const thresholdAmount = floor(salary * m.thresholdRate);
  return {
    threshold: thresholdAmount,
    total,
    toThreshold: clamp0(thresholdAmount - total),
    credit: floor((general + special) * m.rate + premature * m.prematureRate + infertility * m.infertilityRate),
  };
}

export function educationCredit(t, profile, rules) {
  const e = rules.education;
  const school = Math.min(num(t.eduSchool), e.schoolLimitPerChild * Math.max(1, num(profile.schoolChildren)));
  const univ = Math.min(num(t.eduUniv), e.universityLimitPerPerson * Math.max(1, num(profile.univStudents)));
  return { credit: floor((num(t.eduSelf) + school + univ) * e.rate) };
}

export function insuranceCredit(t, rules) {
  const i = rules.insurance;
  return {
    credit: floor(
      Math.min(num(t.insurance), i.limit) * i.rate + Math.min(num(t.insuranceDisabled), i.disabledLimit) * i.disabledRate,
    ),
  };
}

// 정치자금·고향사랑(표준세액공제와 중복 가능) / 일반 기부금(특별세액공제)
export function donationCredit(t, rules) {
  const d = rules.donation;
  const fullPart = (amt) => (Math.min(amt, d.fullCreditLimit) * 100) / 110;
  const hometown = num(t.donationHometown);
  const political = num(t.donationPolitical);
  const general = num(t.donationGeneral);
  const hometownCredit =
    fullPart(hometown) + clamp0(Math.min(hometown, d.hometownLimit) - d.fullCreditLimit) * d.hometownRate;
  const politicalCredit =
    fullPart(political) +
    clamp0(Math.min(political, d.politicalHighThreshold) - d.fullCreditLimit) * d.politicalRate +
    clamp0(political - d.politicalHighThreshold) * d.politicalHighRate;
  const generalCredit =
    Math.min(general, d.generalHighThreshold) * d.generalRate +
    clamp0(general - d.generalHighThreshold) * d.generalHighRate;
  return { nonSpecial: floor(hometownCredit + politicalCredit), special: floor(generalCredit) };
}

export function rentCredit(salary, t, profile, rules) {
  const r = rules.rent;
  if (!isYes(profile.homelessHead) || salary > r.salaryCap) return { credit: 0, eligible: false };
  const rate = salary <= r.highRateSalaryCap ? r.highRate : r.lowRate;
  return { credit: floor(Math.min(num(t.rent), r.limit) * rate), eligible: true, rate };
}

export function housingSubscriptionDeduction(salary, t, profile, rules) {
  const h = rules.housingSubscription;
  if (!isYes(profile.homelessHead) || salary > h.salaryCap) return { deduction: 0, eligible: false };
  return {
    deduction: floor(Math.min(num(t.housingSubscription), h.limit) * h.rate),
    eligible: true,
    room: clamp0(h.limit - num(t.housingSubscription)),
  };
}

export function childCredit(profile, rules) {
  const c = rules.childCredit;
  const n = num(profile.childrenOver8);
  let credit = 0;
  if (n === 1) credit = c.one;
  else if (n === 2) credit = c.two;
  else if (n > 2) credit = c.two + (n - 2) * c.extraPerChild;
  credit += c.birth[Math.min(num(profile.newbornOrder), 3)] || 0;
  return { credit };
}

// ───────────────────────── 전체 세액 계산 ─────────────────────────

export function calculateTax(profileIn, totals, rules) {
  const profile = { ...DEFAULT_PROFILE, ...profileIn };
  const salary = num(profile.salary);
  const est = estimateSocialInsurance(salary, rules);
  const nationalPension = profile.nationalPension == null ? est.nationalPension : num(profile.nationalPension);
  const healthInsurance = profile.healthInsurance == null ? est.healthInsurance : num(profile.healthInsurance);

  const earnedDed = earnedIncomeDeduction(salary, rules);
  const earnedIncome = clamp0(salary - earnedDed);
  const pd = rules.personalDeduction;
  const personal =
    pd.base * (1 + num(profile.dependents)) +
    pd.senior * num(profile.seniors) +
    pd.disabled * num(profile.disabled) +
    (profile.woman ? pd.woman : 0) +
    (profile.singleParent ? pd.singleParent : 0);

  const card = cardDeduction(salary, totals, rules, num(profile.children));
  const housing = housingSubscriptionDeduction(salary, totals, profile, rules);
  const pension = pensionCredit(salary, totals, rules);
  const medical = medicalCredit(salary, totals, rules);
  const education = educationCredit(totals, profile, rules);
  const insurance = insuranceCredit(totals, rules);
  const donation = donationCredit(totals, rules);
  const rent = rentCredit(salary, totals, profile, rules);
  const child = childCredit(profile, rules);
  const marriage = profile.married ? rules.marriageCredit : 0;

  const commonDeductions = personal + nationalPension + housing.deduction + card.deduction;
  const commonCredits = pension.credit + child.credit + donation.nonSpecial + marriage;
  const specialCredits = medical.credit + education.credit + insurance.credit + donation.special + rent.credit;

  const run = (useItemized) => {
    const taxBase = clamp0(earnedIncome - commonDeductions - (useItemized ? healthInsurance : 0));
    const calculatedTax = progressiveTax(taxBase, rules);
    const eic = earnedIncomeCredit(calculatedTax, salary, rules);
    const credits = eic + commonCredits + (useItemized ? specialCredits : rules.standardCredit);
    const determined = clamp0(calculatedTax - credits);
    return { taxBase, calculatedTax, earnedIncomeCredit: eic, credits, determined };
  };
  const itemized = run(true);
  const standard = run(false);
  const best = standard.determined < itemized.determined ? { ...standard, method: 'standard' } : { ...itemized, method: 'itemized' };

  const localTax = floor(best.determined * rules.localTaxRate);
  const totalTax = best.determined + localTax;
  const prepaid = profile.prepaidTax == null ? null : num(profile.prepaidTax);
  const prepaidTotal = prepaid == null ? null : prepaid + floor(prepaid * rules.localTaxRate);

  return {
    salary,
    earnedIncomeDeduction: earnedDed,
    earnedIncome,
    personalDeduction: personal,
    nationalPension,
    healthInsurance,
    socialEstimated: { pension: profile.nationalPension == null, health: profile.healthInsurance == null },
    card,
    housing,
    pension,
    medical,
    education,
    insurance,
    donation,
    rent,
    child,
    marriage,
    ...best,
    marginalRate: marginalRate(best.taxBase, rules),
    localTax,
    totalTax,
    prepaidTotal,
    refund: prepaidTotal == null ? null : prepaidTotal - totalTax,
  };
}

// ───────────────────────── 분석 · 추천 ─────────────────────────

const ZERO_KEYS = {
  card: ['credit', 'debit', 'culture', 'market', 'transit'],
  pension: ['pensionSavings', 'irp', 'isaTransfer'],
  housing: ['housingSubscription'],
  rent: ['rent'],
  medical: ['medicalSpecial', 'medicalGeneral', 'medicalInfertility', 'medicalPremature'],
  education: ['eduSelf', 'eduSchool', 'eduUniv'],
  insurance: ['insurance', 'insuranceDisabled'],
  donation: ['donationHometown', 'donationPolitical', 'donationGeneral'],
};

export const EFFECT_LABELS = {
  card: '신용카드 등 소득공제',
  pension: '연금저축·IRP 세액공제',
  housing: '주택청약 소득공제',
  rent: '월세 세액공제',
  medical: '의료비 세액공제',
  education: '교육비 세액공제',
  insurance: '보험료 세액공제',
  donation: '기부금 세액공제',
};

// 항목별 절세 효과 = 그 항목이 없을 때의 세금 - 현재 세금 (지방세 포함)
export function savingsEffects(profile, totals, rules, baseTax) {
  const base = baseTax ?? calculateTax(profile, totals, rules).totalTax;
  const effects = {};
  for (const [id, keys] of Object.entries(ZERO_KEYS)) {
    const without = { ...totals };
    for (const k of keys) without[k] = 0;
    effects[id] = calculateTax(profile, without, rules).totalTax - base;
  }
  return effects;
}

const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const manwon = (n) => {
  const v = Math.round(n / 10_000);
  return `${v.toLocaleString('ko-KR')}만 원`;
};

export function analyze(yearData, { project = true, today = new Date() } = {}) {
  const rules = getRules(yearData.year);
  const profile = { ...DEFAULT_PROFILE, ...yearData.profile };
  const actual = sumMonths(yearData, { project: false });
  const projected = sumMonths(yearData, { project: true });
  const totals = project ? projected.totals : actual.totals;
  const tax = calculateTax(profile, totals, rules);
  const effects = savingsEffects(profile, totals, rules, tax.totalTax);
  const totalSaved = Object.values(effects).reduce((a, b) => a + b, 0);
  const pension = pensionGain(profile, totals, rules, tax);
  const recommendations = buildRecommendations({ yearData, profile, totals, actualTotals: actual.totals, tax, rules, today });
  const plan = buildYearEndPlan({ profile, totals, tax, rules, pension });
  return { rules, profile, totals, actualTotals: actual.totals, enteredCount: actual.enteredCount, tax, effects, totalSaved, pension, plan, recommendations, projected: project && projected.projected };
}

function monthsLeft(year, today) {
  if (today.getFullYear() < year) return 12;
  if (today.getFullYear() > year) return 0;
  return 12 - today.getMonth(); // 이번 달 포함
}

// 연금 추가 납입 효과. 결정세액이 0원이 되면 그 이상은 효과가 없으므로 권장액을 거기까지로 줄인다.
export function pensionGain(profile, totals, rules, tax = calculateTax(profile, totals, rules)) {
  const p = tax.pension;
  if (p.room <= 0 || tax.determined === 0) return { recommended: 0, gain: 0 };
  const withIrp = (extra) => calculateTax(profile, { ...totals, irp: num(totals.irp) + extra }, rules);
  const full = withIrp(p.room);
  let recommended = p.room;
  if (full.determined === 0) {
    // 세금이 0원이 되는 최소 납입액 (만 원 단위 이분 탐색)
    let lo = 0;
    let hi = Math.ceil(p.room / 10_000);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (withIrp(mid * 10_000).determined === 0) hi = mid;
      else lo = mid + 1;
    }
    recommended = Math.min(p.room, lo * 10_000);
  }
  return { recommended, gain: tax.totalTax - full.totalTax };
}

// ───────────────────────── 12월 31일 전에 할 일 (11월 집중 모드) ─────────────────────────

export function buildYearEndPlan({ profile, totals, tax, rules, pension = pensionGain(profile, totals, rules, tax) }) {
  const items = [];
  const combined = { ...totals };
  const gainOf = (patch) => tax.totalTax - calculateTax(profile, { ...totals, ...patch }, rules).totalTax;

  if (pension.recommended > 0) {
    const patch = { irp: num(totals.irp) + pension.recommended };
    Object.assign(combined, patch);
    items.push({
      id: 'pension',
      title: `연금저축·IRP ${manwon(pension.recommended)} 추가 납입`,
      detail: tax.pension.savingsRoom > 0 ? `연금저축 여유 ${manwon(tax.pension.savingsRoom)}, 나머지는 IRP. 12월 31일 입금분까지 인정 (증권사 마감 시간 확인).` : 'IRP로 납입. 12월 31일 입금분까지 인정.',
      gain: gainOf(patch),
      deadline: '12월 31일',
    });
  }
  if (tax.housing.eligible && tax.housing.room > 0) {
    const patch = { housingSubscription: num(totals.housingSubscription) + tax.housing.room };
    Object.assign(combined, patch);
    items.push({ id: 'housing', title: `주택청약 ${manwon(tax.housing.room)} 추가 납입`, detail: '연 300만 원까지 40% 소득공제. 은행에 무주택 확인서 제출(다음 해 2월).', gain: gainOf(patch), deadline: '12월 31일' });
  }
  const c = tax.card;
  if (c.thresholdReached) {
    const general = num(totals.credit) + num(totals.debit);
    const patch = { credit: Math.min(general, c.threshold), debit: general - Math.min(general, c.threshold) };
    const gain = gainOf(patch);
    if (gain > 0) Object.assign(combined, patch);
    items.push({
      id: 'card',
      title: c.baseMaxed ? '카드: 기본 한도 도달 — 혜택 좋은 카드 사용' : '카드: 남은 기간은 체크카드·현금영수증으로',
      detail: c.baseMaxed ? '추가 공제는 전통시장·대중교통 사용분만 남았습니다.' : `문턱(${manwon(c.threshold)})을 넘었으니 공제율 30%인 체크카드가 유리합니다. 전통시장·대중교통은 40%.`,
      gain,
      deadline: '12월 31일',
    });
  } else {
    items.push({ id: 'card', title: `카드: 문턱까지 ${manwon(c.toThreshold)} 부족 (연간 예상)`, detail: '올해 문턱을 못 넘으면 카드 공제는 0원입니다. 남은 기간은 공제보다 혜택(할인·포인트)이 큰 카드를 쓰세요. 맞벌이라면 내년엔 한 사람에게 몰아 쓰기를 검토하세요.', gain: 0, deadline: '12월 31일' });
  }
  if (num(totals.donationHometown) < rules.donation.fullCreditLimit && tax.determined > 0) {
    const patch = { donationHometown: rules.donation.fullCreditLimit };
    Object.assign(combined, patch);
    items.push({ id: 'hometown', title: '고향사랑기부금 10만 원', detail: '10만 원 전액 세액공제(지방세 포함) + 30% 답례품. 고향사랑e음에서 기부.', gain: gainOf(patch), deadline: '12월 31일' });
  }
  const m = tax.medical;
  if (m.total > 0) {
    items.push({
      id: 'medical',
      title: m.toThreshold > 0 ? `의료비: 문턱까지 ${manwon(m.toThreshold)}` : '의료비: 문턱 통과 — 예정된 진료는 연내에',
      detail: m.toThreshold > 0 ? '예정된 치료·안경 구입을 앞당기면 문턱을 넘을 수 있습니다. 맞벌이는 총급여가 낮은 쪽으로 몰아주세요.' : '추가 의료비는 15% 세액공제됩니다. 안경·렌즈 영수증(1인 50만 원)을 챙기세요.',
      gain: 0,
      deadline: '12월 31일',
    });
  }
  if (tax.rent.eligible && num(totals.rent) > 0) {
    items.push({ id: 'rent-docs', title: '월세 증빙 준비', detail: '임대차계약서 사본, 월세 이체 내역, 주민등록등본(전입 확인). 간소화 자료에 안 나오므로 회사에 직접 제출.', gain: 0, deadline: '1월 회사 제출' });
  }
  items.push({ id: 'preview', title: '홈택스 연말정산 미리보기와 대조', detail: '1~9월 카드 사용액이 이 앱 입력값과 맞는지 확인하고, 다르면 월별 입력을 고치세요.', gain: 0, deadline: '11월 말' });

  const totalGain = tax.totalTax - calculateTax(profile, combined, rules).totalTax;
  return { items, totalGain };
}

// ───────────────────────── 시뮬레이터 검증 (작년 원천징수영수증) ─────────────────────────

export const VALIDATION_FIELDS = [
  { key: 'salary', label: '총급여', src: '⑯ 계' },
  { key: 'actualTax', label: '결정세액 (소득세)', src: '㉒ 결정세액 소득세' },
  { key: 'nationalPension', label: '국민연금보험료', src: '㉛ 국민연금' },
  { key: 'healthInsurance', label: '건강·고용보험료', src: '㉝ 보험료 (건강+고용)' },
  { key: 'credit', label: '신용카드 사용액', src: '신용카드 등 소득공제 명세' },
  { key: 'debit', label: '체크카드·현금영수증 사용액' },
  { key: 'market', label: '전통시장 사용액' },
  { key: 'transit', label: '대중교통 사용액' },
  { key: 'culture', label: '도서·공연 등 사용액' },
  { key: 'pensionSavings', label: '연금저축 납입액' },
  { key: 'irp', label: 'IRP 납입액' },
  { key: 'insurance', label: '보장성 보험료' },
  { key: 'medicalSpecial', label: '의료비 (본인·65세 이상 등)' },
  { key: 'medicalGeneral', label: '의료비 (그 외 부양가족)' },
  { key: 'eduSelf', label: '교육비 (본인)' },
  { key: 'eduSchool', label: '교육비 (자녀)' },
  { key: 'donationGeneral', label: '기부금 (일반)' },
  { key: 'donationHometown', label: '고향사랑기부금' },
  { key: 'rent', label: '월세 (세액공제 받은 경우)' },
  { key: 'housingSubscription', label: '주택청약 납입액 (공제받은 경우)' },
];

export function validateSimulator(input, profileBase, rules) {
  const v = Object.fromEntries(VALIDATION_FIELDS.map((f) => [f.key, num(input[f.key])]));
  const profile = {
    ...profileBase,
    salary: v.salary,
    nationalPension: v.nationalPension || null,
    healthInsurance: v.healthInsurance || null,
    homelessHead: v.rent > 0 || v.housingSubscription > 0 ? 'yes' : 'no',
    prepaidTax: null,
  };
  const t = calculateTax(profile, v, rules);
  const actual = v.actualTax;
  const diff = t.determined - actual;
  const errorRate = actual > 0 ? Math.abs(diff) / actual : t.determined === 0 ? 0 : 1;
  return { computed: t.determined, actual, diff, errorRate, pass: errorRate <= 0.05, tax: t, rulesYear: rules.year, fallbackFrom: rules.fallbackFrom };
}

export function buildRecommendations({ yearData, profile, totals, actualTotals, tax, rules, today }) {
  const recs = [];
  const salary = num(profile.salary);
  const year = yearData.year;
  const left = monthsLeft(year, today);
  const entered = enteredMonths(yearData);
  const pct = (r) => `${Math.round(r * 1000) / 10}%`;

  if (!salary) {
    recs.push({
      level: 'urgent',
      id: 'profile',
      title: '총급여를 먼저 입력하세요',
      body: '카드 공제 문턱(총급여 25%), 의료비 문턱(3%), 연금 공제율이 모두 총급여로 정해집니다. 설정 → 내 정보에서 입력하세요.',
      action: 'settings',
    });
    return recs;
  }

  // 입력 누락 알림
  if (today.getFullYear() === year) {
    const lastMonth = today.getMonth(); // 지난달 (1~12, 0 이면 1월이라 지난달 없음)
    if (lastMonth >= 1 && !entered.includes(lastMonth)) {
      recs.push({
        level: 'urgent',
        id: 'missing-month',
        title: `${lastMonth}월 내역을 아직 입력하지 않았어요`,
        body: '카드 사용액과 연금 납입액을 입력해야 남은 공제 한도를 정확히 계산할 수 있습니다.',
        action: 'input',
        month: lastMonth,
      });
    }
  }

  // 결정세액이 이미 0 이면 세액공제를 더 챙겨도 효과 없음
  const taxIsZero = tax.determined === 0;
  if (taxIsZero) {
    recs.push({
      level: 'info',
      id: 'zero-tax',
      title: '예상 결정세액이 0원입니다',
      body: '이미 낼 세금이 없어 추가 세액공제(연금·의료비 등)는 환급을 늘리지 못합니다. 연금저축은 세액공제보다 노후 대비 목적으로 판단하세요.',
    });
  }

  // 연금저축·IRP
  const p = tax.pension;
  const pg = pensionGain(profile, totals, rules, tax);
  if (p.room > 0 && !taxIsZero) {
    const target = pg.recommended;
    const monthly = left > 0 ? Math.ceil(target / left / 10_000) * 10_000 : target;
    const december = today.getFullYear() === year && today.getMonth() === 11;
    const capped = target < p.room;
    recs.push({
      level: december ? 'urgent' : 'tip',
      id: 'pension',
      title: capped
        ? `연금저축·IRP ${manwon(target)} 더 넣으면 세금이 0원`
        : `연금저축·IRP 공제 한도까지 ${manwon(p.room)} 남았어요`,
      body:
        `${manwon(target)}을 더 넣으면 세금이 약 ${won(pg.gain)} 줄어듭니다 (공제율 ${pct(p.rate * (1 + rules.localTaxRate))}). ` +
        (capped ? `그 이상 넣어도 낼 세금이 없어 올해 공제 효과는 없습니다. ` : '') +
        (left > 0 ? `남은 ${left}개월 동안 매달 약 ${manwon(monthly)}씩 납입하면 됩니다. ` : '') +
        (p.savingsRoom > 0 ? `연금저축은 ${manwon(p.savingsRoom)}까지, 나머지는 IRP로 채우세요.` : '연금저축 한도(600만 원)는 다 찼으니 나머지는 IRP로 채우세요.') +
        (december ? ' 12월 31일 납입분까지만 올해 공제됩니다!' : ''),
      amount: pg.gain,
    });
  } else if (p.room === 0) {
    recs.push({ level: 'done', id: 'pension-done', title: '연금저축·IRP 공제 한도를 모두 채웠어요', body: `세액공제 약 ${won(p.credit * (1 + rules.localTaxRate))}.` });
  }

  // 신용카드
  const c = tax.card;
  if (!c.thresholdReached) {
    recs.push({
      level: 'tip',
      id: 'card-threshold',
      title: `카드 공제 문턱까지 ${manwon(c.toThreshold)} 남았어요 (연간 예상 기준)`,
      body: `총급여의 25%(${manwon(c.threshold)})를 넘게 써야 공제가 시작됩니다. 문턱 전까지는 공제율보다 혜택(포인트·할인)이 큰 신용카드를 쓰는 편이 유리합니다.`,
    });
  } else if (!c.baseMaxed) {
    recs.push({
      level: 'tip',
      id: 'card-debit',
      title: '문턱을 넘었어요 — 이제부터는 체크카드·현금영수증',
      body: `문턱 초과분은 체크카드·현금영수증이 공제율 30%로 신용카드(15%)의 2배입니다. 기본 한도(${manwon(c.baseLimit)})를 채우려면 체크카드로 약 ${manwon(c.debitToFillBase)} 더 쓰면 됩니다. 전통시장·대중교통(40%)은 별도 추가 한도가 있습니다.`,
    });
  } else {
    recs.push({
      level: 'done',
      id: 'card-done',
      title: '카드 소득공제 기본 한도를 채웠어요',
      body: '이후 사용분은 전통시장·대중교통' + (c.cultureEligible ? '·문화' : '') + ' 추가 한도에만 반영됩니다. 그 외에는 혜택이 좋은 카드를 쓰세요.',
    });
  }
  // 같은 금액을 결제수단만 바꿨을 때 얼마나 이득인지
  if (c.thresholdReached) {
    const generalSpend = num(totals.credit) + num(totals.debit);
    const optimalCredit = Math.min(generalSpend, c.threshold);
    const optimal = { ...totals, credit: optimalCredit, debit: generalSpend - optimalCredit };
    const better = calculateTax(profile, optimal, rules);
    const gain = tax.totalTax - better.totalTax;
    if (gain >= 10_000) {
      recs.push({
        level: 'tip',
        id: 'card-mix',
        title: `결제수단만 바꿔도 약 ${won(gain)} 절세`,
        body: `같은 금액을 쓰더라도 신용카드는 문턱(${manwon(c.threshold)})까지만, 그 이후는 체크카드로 쓰면 소득공제가 늘어납니다.`,
        amount: gain,
      });
    }
  }

  // 의료비
  const m = tax.medical;
  if (m.total > 0 && m.toThreshold > 0) {
    recs.push({
      level: 'info',
      id: 'medical',
      title: `의료비는 ${manwon(m.toThreshold)} 더 써야 공제가 시작돼요`,
      body: `총급여의 3%(${manwon(m.threshold)})를 넘는 금액부터 15% 공제됩니다. 맞벌이라면 소득이 낮은 배우자에게 몰아주는 것이 유리할 수 있습니다. 안경·콘택트렌즈(1인 50만 원)와 산후조리원도 포함됩니다.`,
    });
  }

  // 확인 필요: 요건 판정이 애매하면 계산에서 빼고, 충족 시 효과를 함께 보여준다
  if (isUnknown(profile.homelessHead) && (num(totals.rent) > 0 || num(totals.housingSubscription) > 0)) {
    const ifYes = calculateTax({ ...profile, homelessHead: 'yes' }, totals, rules);
    const gain = tax.totalTax - ifYes.totalTax;
    recs.push({
      level: 'check',
      id: 'check-homeless',
      title: '확인 필요: 무주택 세대주인가요?',
      body: `월세·주택청약 공제는 과세기간 종료일(12월 31일) 기준 무주택 세대주만 받을 수 있어 지금은 계산에서 뺐습니다. 해당된다면 세금이 약 ${won(gain)} 줄어듭니다. 주민등록등본의 세대주 여부와 세대원 전원의 주택 소유 여부를 확인한 뒤 내 정보에서 선택하세요.`,
      action: 'settings',
      amount: gain,
    });
  }
  if (num(profile.dependents) > 0 && !profile.dependentsVerified) {
    recs.push({
      level: 'check',
      id: 'check-dependents',
      title: '확인 필요: 부양가족 소득·나이 요건',
      body: '부양가족은 연 소득 100만 원 이하(근로소득만 있으면 총급여 500만 원 이하)이고, 직계존속 만 60세 이상·자녀 만 20세 이하여야 합니다(장애인은 나이 무관). 형제자매와 중복 공제도 안 됩니다. 확인했으면 내 정보에서 체크하세요.',
      action: 'settings',
    });
  }

  // 월세·청약
  if (isYes(profile.homelessHead)) {
    if (salary <= rules.rent.salaryCap && num(totals.rent) === 0) {
      recs.push({
        level: 'tip',
        id: 'rent',
        title: '월세 세액공제를 놓치지 마세요',
        body: `무주택 세대주이고 총급여 ${manwon(rules.rent.salaryCap)} 이하라면 월세(연 ${manwon(rules.rent.limit)} 한도)의 ${pct(tax.rent.rate ?? rules.rent.lowRate)}(지방세 별도)를 돌려받습니다. 전입신고와 임대차계약서가 필요하고, 간소화 자료에 안 나오니 직접 제출해야 합니다.`,
      });
    }
    if (tax.housing.eligible && tax.housing.room > 0) {
      recs.push({
        level: 'info',
        id: 'housing',
        title: `주택청약 소득공제 한도까지 ${manwon(tax.housing.room)} 남았어요`,
        body: `연 ${manwon(rules.housingSubscription.limit)} 납입분까지 40% 소득공제됩니다. 은행에 '무주택 확인서'를 다음 해 2월 말까지 제출해야 합니다.`,
      });
    }
  }

  // 11월 집중 모드 → 12월 마감
  if (today.getFullYear() === year && today.getMonth() === 10) {
    recs.push({
      level: 'urgent',
      id: 'focus-mode',
      title: '11월 집중 모드: 12월 31일 전에 할 일을 확정하세요',
      body: '홈택스 「연말정산 미리보기」에서 1~9월 카드 사용액을 확인해 이 앱의 입력값과 맞춰 보고, 연말 할 일 목록(연금 추가 납입액·카드 사용 전략)을 이달 안에 정하세요.',
      action: 'plan',
    });
  } else if (today.getFullYear() === year && today.getMonth() === 11) {
    recs.push({
      level: 'urgent',
      id: 'year-end',
      title: '올해 공제는 12월 31일 결제·납입분까지',
      body: '연금저축·IRP 추가 납입, 의료비·교육비 결제, 기부금은 연말 전에 마쳐야 올해 공제에 반영됩니다.',
      action: 'plan',
    });
  }

  // 고향사랑기부금
  if (num(actualTotals.donationHometown) < rules.donation.fullCreditLimit && !taxIsZero) {
    recs.push({
      level: 'info',
      id: 'hometown',
      title: '고향사랑기부금 10만 원은 사실상 무료',
      body: '10만 원까지는 전액 세액공제(지방세 포함)되고, 기부액의 30%를 답례품으로 받습니다.',
    });
  }

  const order = { urgent: 0, check: 1, tip: 2, info: 3, done: 4 };
  return recs.sort((a, b) => order[a.level] - order[b.level] || (b.amount || 0) - (a.amount || 0));
}
