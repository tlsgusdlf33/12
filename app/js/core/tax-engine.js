// 연말정산 계산 엔진. DOM 에 의존하지 않아 브라우저와 Node(테스트) 양쪽에서 동작한다.
// 근로소득만 있는 직장인 기준의 "추정" 계산이며, 실제 결정세액과 차이가 날 수 있다.

import { getRules } from './rules.js';
import { DEFAULT_PROFILE, MONTH_KEYS, PROJECTED_KEYS } from './fields.js';

const floor = Math.floor;
const clamp0 = (n) => Math.max(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

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
  if (!profile.homelessHead || salary > r.salaryCap) return { credit: 0, eligible: false };
  const rate = salary <= r.highRateSalaryCap ? r.highRate : r.lowRate;
  return { credit: floor(Math.min(num(t.rent), r.limit) * rate), eligible: true, rate };
}

export function housingSubscriptionDeduction(salary, t, profile, rules) {
  const h = rules.housingSubscription;
  if (!profile.homelessHead || salary > h.salaryCap) return { deduction: 0, eligible: false };
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
  return { rules, profile, totals, actualTotals: actual.totals, enteredCount: actual.enteredCount, tax, effects, totalSaved, pension, recommendations, projected: project && projected.projected };
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

  // 월세·청약
  if (profile.homelessHead) {
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

  // 12월 마감 알림
  if (today.getFullYear() === year && today.getMonth() >= 10) {
    recs.push({
      level: 'urgent',
      id: 'year-end',
      title: '올해 공제는 12월 31일 결제·납입분까지',
      body: '연금저축·IRP 추가 납입, 의료비·교육비 결제, 기부금은 연말 전에 마쳐야 올해 공제에 반영됩니다.',
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

  const order = { urgent: 0, tip: 1, info: 2, done: 3 };
  return recs.sort((a, b) => order[a.level] - order[b.level] || (b.amount || 0) - (a.amount || 0));
}
