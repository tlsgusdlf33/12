// 귀속연도별 연말정산 세법 규칙.
// 세법은 매년 바뀌므로 숫자는 모두 여기에만 둔다. 개정 시 이 파일만 고치고
// 버전을 올려 배포하면 업데이터를 통해 모든 기기에 반영된다.
// 금액 단위: 원. 세율은 지방소득세(10%)를 제외한 국세 기준.

const BASE_2026 = {
  year: 2026,
  verifiedNote:
    '2026년 귀속 기준으로 정리한 값입니다. 세법은 매년 바뀌므로 최종 판단은 국세청(홈택스) 안내로 확인하세요.',

  localTaxRate: 0.1,

  // 근로소득공제: [구간 상한, 해당 구간 공제율]
  earnedIncomeDeduction: {
    brackets: [
      [5_000_000, 0.7],
      [15_000_000, 0.4],
      [45_000_000, 0.15],
      [100_000_000, 0.05],
      [Infinity, 0.02],
    ],
    max: 20_000_000,
  },

  personalDeduction: {
    base: 1_500_000, // 본인·부양가족 1인당
    senior: 1_000_000, // 경로우대(만 70세 이상)
    disabled: 2_000_000,
    woman: 500_000, // 부녀자
    singleParent: 1_000_000, // 한부모
  },

  // 종합소득세율: [과세표준 상한, 세율, 누진공제]
  taxBrackets: [
    [14_000_000, 0.06, 0],
    [50_000_000, 0.15, 1_260_000],
    [88_000_000, 0.24, 5_760_000],
    [150_000_000, 0.35, 15_440_000],
    [300_000_000, 0.38, 19_940_000],
    [500_000_000, 0.4, 25_940_000],
    [1_000_000_000, 0.42, 35_940_000],
    [Infinity, 0.45, 65_940_000],
  ],

  earnedIncomeCredit: {
    lowTaxCap: 1_300_000,
    lowRate: 0.55,
    highRate: 0.3,
    // 총급여 구간별 한도
    limits: [
      { maxSalary: 33_000_000, start: 740_000, reduceRate: 0, floor: 740_000, from: 0 },
      { maxSalary: 70_000_000, start: 740_000, reduceRate: 0.008, floor: 660_000, from: 33_000_000 },
      { maxSalary: 120_000_000, start: 660_000, reduceRate: 0.5, floor: 500_000, from: 70_000_000 },
      { maxSalary: Infinity, start: 500_000, reduceRate: 0.5, floor: 200_000, from: 120_000_000 },
    ],
  },

  // 신용카드 등 소득공제
  card: {
    thresholdRate: 0.25, // 총급여의 25% 초과 사용분부터 공제
    rates: { credit: 0.15, debit: 0.3, culture: 0.3, market: 0.4, transit: 0.4 },
    cultureSalaryCap: 70_000_000, // 도서·공연·박물관·영화·체육시설은 총급여 7천만 원 이하만
    limits: [
      { maxSalary: 70_000_000, base: 3_000_000, extra: 3_000_000 },
      { maxSalary: Infinity, base: 2_500_000, extra: 2_000_000 },
    ],
    // 자녀 수에 따른 기본한도 상향(2025년 귀속~)
    childBonusPerChild: 500_000,
    childBonusMaxChildren: 2,
  },

  // 연금계좌 세액공제
  pension: {
    savingsLimit: 6_000_000, // 연금저축 단독 한도
    totalLimit: 9_000_000, // 연금저축 + IRP 합산 한도
    isaTransferRate: 0.1, // ISA 만기 전환액의 10% 추가 (최대 300만 원)
    isaTransferLimit: 3_000_000,
    highRate: 0.15,
    lowRate: 0.12,
    highRateSalaryCap: 55_000_000,
  },

  medical: {
    thresholdRate: 0.03, // 총급여 3% 초과분부터
    rate: 0.15,
    generalLimit: 7_000_000, // 일반 부양가족 한도
    prematureRate: 0.2,
    infertilityRate: 0.3,
  },

  education: {
    rate: 0.15,
    schoolLimitPerChild: 3_000_000, // 취학 전·초중고 1인당
    universityLimitPerPerson: 9_000_000, // 대학생 1인당
  },

  insurance: {
    rate: 0.12,
    limit: 1_000_000,
    disabledRate: 0.15,
    disabledLimit: 1_000_000,
  },

  donation: {
    fullCreditLimit: 100_000, // 정치자금·고향사랑 10만 원까지 100/110
    hometownLimit: 20_000_000,
    hometownRate: 0.15,
    politicalRate: 0.15,
    politicalHighThreshold: 30_000_000,
    politicalHighRate: 0.25,
    generalRate: 0.15,
    generalHighThreshold: 10_000_000,
    generalHighRate: 0.3,
  },

  rent: {
    salaryCap: 80_000_000,
    limit: 10_000_000,
    highRate: 0.17,
    lowRate: 0.15,
    highRateSalaryCap: 55_000_000,
  },

  housingSubscription: {
    salaryCap: 70_000_000,
    limit: 3_000_000,
    rate: 0.4,
  },

  childCredit: {
    // 만 8세 이상 자녀: 1명 25만, 2명 55만, 3명 이상은 2명 초과 1인당 40만 추가
    one: 250_000,
    two: 550_000,
    extraPerChild: 400_000,
    // 출생·입양 (첫째/둘째/셋째 이상)
    birth: [0, 300_000, 500_000, 700_000],
  },

  marriageCredit: 500_000, // 2024~2026년 혼인신고, 생애 1회
  standardCredit: 130_000,

  // 4대보험 근로자 부담분 자동 추정 (실제 원천징수영수증 값 입력을 권장)
  socialInsurance: {
    pensionRate: 0.0475,
    pensionMonthlyMin: 400_000,
    pensionMonthlyMax: 6_370_000,
    healthRate: 0.03595,
    longTermCareRatio: 0.1314, // 건강보험료 대비
    employmentRate: 0.009,
  },
};

const RULES = {
  2026: BASE_2026,
  2025: {
    ...BASE_2026,
    year: 2025,
    verifiedNote:
      '2025년 귀속 기준입니다. 최종 판단은 국세청(홈택스) 안내로 확인하세요.',
    socialInsurance: {
      ...BASE_2026.socialInsurance,
      pensionRate: 0.045,
      pensionMonthlyMax: 6_170_000,
      healthRate: 0.03545,
      longTermCareRatio: 0.1295,
    },
  },
};

export const SUPPORTED_YEARS = Object.keys(RULES)
  .map(Number)
  .sort((a, b) => b - a);

export function getRules(year) {
  if (RULES[year]) return RULES[year];
  // 아직 규칙이 없는 연도는 가장 최근 규칙을 사용
  const latest = SUPPORTED_YEARS[0];
  return { ...RULES[latest], year: Number(year), fallbackFrom: latest };
}
