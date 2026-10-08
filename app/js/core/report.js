// 월간 요약 리포트. 텔레그램 발송(scripts/monthly-report.mjs)과 통합 재정 리포트(JSON)에 쓴다.

import { analyze, enteredMonths } from './tax-engine.js';

const won = (n) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const man = (n) => `${Math.round((n || 0) / 10_000).toLocaleString('ko-KR')}만 원`;

export function buildMonthlyReport(yearData, { today = new Date() } = {}) {
  const r = analyze(yearData, { project: true, today });
  const { tax, rules } = r;
  const lastMonth = today.getFullYear() === yearData.year ? today.getMonth() : 12; // 0 이면 1월
  const entered = enteredMonths(yearData);
  const items = r.recommendations.filter((x) => x.level !== 'done');

  const data = {
    year: yearData.year,
    generatedAt: today.toISOString(),
    enteredMonths: entered.length,
    lastMonthEntered: lastMonth >= 1 ? entered.includes(lastMonth) : null,
    estimatedTax: tax.totalTax,
    refund: tax.refund,
    totalSaved: r.totalSaved,
    remaining: {
      pensionRoom: tax.pension.room,
      pensionRecommended: r.pension.recommended,
      pensionGain: r.pension.gain,
      cardThreshold: tax.card.threshold,
      cardToThreshold: tax.card.toThreshold,
      cardDeduction: tax.card.deduction,
      cardBaseLimit: tax.card.baseLimit,
      medicalToThreshold: tax.medical.total > 0 ? tax.medical.toThreshold : null,
      housingRoom: tax.housing.eligible ? tax.housing.room : null,
    },
    todo: items.map(({ level, id, title, amount }) => ({ level, id, title, amount: amount ?? null })),
    yearEndPlan: today.getMonth() >= 10 ? { totalGain: r.plan.totalGain, items: r.plan.items.map(({ id, title, gain }) => ({ id, title, gain })) } : null,
    rulesStatus: rules.meta?.status ?? 'draft',
  };

  if (!r.profile.salary) {
    return { data, text: `📋 ${yearData.year}년 연말정산 월간 점검\n\n총급여가 입력되지 않았습니다. 앱의 설정 → 내 정보에서 먼저 입력하세요.` };
  }

  const lines = [];
  lines.push(`📋 ${yearData.year}년 연말정산 월간 점검 (${today.getMonth() + 1}월 ${today.getDate()}일)`);
  lines.push(`입력 ${entered.length}/12개월${lastMonth >= 1 ? ` · 지난달(${lastMonth}월) ${data.lastMonthEntered ? '입력 완료 ✅' : '미입력 ❌'}` : ''}`);
  lines.push(
    tax.refund == null
      ? `예상 결정세액 ${won(tax.totalTax)} (지방세 포함, 연간 예상)`
      : `${tax.refund >= 0 ? '예상 환급' : '예상 추가 납부'} ${won(Math.abs(tax.refund))}`,
  );
  lines.push(`공제로 줄인 세금 ${won(r.totalSaved)}`);
  lines.push('');
  lines.push('▶ 남은 공제 여력');
  if (tax.pension.room > 0) {
    lines.push(`· 연금저축+IRP ${man(tax.pension.room)} 남음${r.pension.gain > 0 ? ` → ${man(r.pension.recommended)} 더 넣으면 약 ${won(r.pension.gain)} 절세` : ''}`);
  } else lines.push('· 연금저축+IRP 한도 달성 ✅');
  lines.push(
    tax.card.thresholdReached
      ? `· 카드 문턱 통과 · 공제 ${man(tax.card.deduction)} / 한도 ${man(tax.card.baseLimit)}${tax.card.baseMaxed ? ' ✅' : ' → 체크카드 사용 권장'}`
      : `· 카드 문턱까지 ${man(tax.card.toThreshold)} (문턱 ${man(tax.card.threshold)}) → 문턱 전엔 혜택 좋은 신용카드`,
  );
  if (data.remaining.medicalToThreshold) lines.push(`· 의료비 문턱까지 ${man(data.remaining.medicalToThreshold)}`);
  if (data.remaining.housingRoom) lines.push(`· 주택청약 ${man(data.remaining.housingRoom)} 남음`);
  if (items.length) {
    lines.push('');
    lines.push('▶ 이번 달 할 일');
    items.slice(0, 6).forEach((x, i) => lines.push(`${i + 1}. ${x.level === 'check' ? '[확인 필요] ' : ''}${x.title.replace(/^확인 필요: /, '')}`));
  }
  if (data.yearEndPlan) {
    lines.push('');
    lines.push(`▶ 12월 31일 전에 할 일 (모두 하면 약 ${won(r.plan.totalGain)} 절세)`);
    r.plan.items.forEach((x) => lines.push(`· ${x.title}${x.gain > 0 ? ` (약 ${won(x.gain)})` : ''}`));
  }
  if (data.rulesStatus !== 'verified') {
    lines.push('');
    lines.push(`※ ${yearData.year}년 세법 설정은 아직 국세청 자료와 대조 전입니다.`);
  }
  return { data, text: lines.join('\n') };
}
