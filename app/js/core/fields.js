// 월별 입력 항목 정의. UI 폼 생성과 계산 엔진이 함께 사용한다.
// project: true 인 항목은 "연간 예상" 모드에서 아직 입력하지 않은 달을 평균으로 채운다.

export const MONTH_GROUPS = [
  {
    id: 'card',
    title: '카드·현금영수증 사용액',
    hint: '카드사 앱의 월 이용금액을 결제수단·사용처별로 나눠 적어주세요.',
    fields: [
      { key: 'credit', label: '신용카드', help: '전통시장·대중교통·문화 사용분 제외', project: true },
      { key: 'debit', label: '체크카드·현금영수증', help: '전통시장·대중교통·문화 사용분 제외', project: true },
      { key: 'market', label: '전통시장', project: true },
      { key: 'transit', label: '대중교통', project: true },
      { key: 'culture', label: '도서·공연·영화·박물관·체육시설', help: '총급여 7천만 원 이하만 별도 공제율', project: true },
    ],
  },
  {
    id: 'pension',
    title: '연금저축·IRP 납입액',
    hint: '증권사·은행 앱에서 이번 달 납입액을 확인하세요.',
    fields: [
      { key: 'pensionSavings', label: '연금저축' },
      { key: 'irp', label: 'IRP (개인형 퇴직연금)' },
      { key: 'isaTransfer', label: 'ISA 만기 → 연금계좌 전환액' },
    ],
  },
  {
    id: 'housing',
    title: '주거',
    hint: '무주택 세대주 요건을 충족해야 공제됩니다. (설정 → 내 정보)',
    fields: [
      { key: 'rent', label: '월세', project: true },
      { key: 'housingSubscription', label: '주택청약종합저축 납입' },
    ],
  },
  {
    id: 'medical',
    title: '의료비',
    hint: '실손보험으로 돌려받은 금액은 빼고 입력하세요.',
    fields: [
      { key: 'medicalSpecial', label: '본인·65세 이상·장애인·6세 이하', help: '한도 없음' },
      { key: 'medicalGeneral', label: '그 외 부양가족', help: '연 700만 원 한도' },
      { key: 'medicalInfertility', label: '난임 시술비' },
      { key: 'medicalPremature', label: '미숙아·선천성이상아' },
    ],
  },
  {
    id: 'education',
    title: '교육비',
    hint: '자녀 수는 설정 → 내 정보에서 입력합니다.',
    fields: [
      { key: 'eduSelf', label: '본인 (대학원·직업훈련 포함)' },
      { key: 'eduSchool', label: '취학 전·초·중·고 자녀' },
      { key: 'eduUniv', label: '대학생 (본인 제외)' },
    ],
  },
  {
    id: 'insurance',
    title: '보장성 보험료',
    hint: '자동차·실손·종신 등 보장성 보험. 저축성은 제외.',
    fields: [
      { key: 'insurance', label: '일반 보장성 보험' },
      { key: 'insuranceDisabled', label: '장애인 전용 보장성 보험' },
    ],
  },
  {
    id: 'donation',
    title: '기부금',
    fields: [
      { key: 'donationHometown', label: '고향사랑기부금' },
      { key: 'donationPolitical', label: '정치자금기부금' },
      { key: 'donationGeneral', label: '일반·특례 기부금 (종교단체 포함)' },
    ],
  },
];

export const MONTH_FIELDS = MONTH_GROUPS.flatMap((g) => g.fields);
export const MONTH_KEYS = MONTH_FIELDS.map((f) => f.key);
export const PROJECTED_KEYS = MONTH_FIELDS.filter((f) => f.project).map((f) => f.key);

export const DEFAULT_PROFILE = {
  salary: 0, // 총급여(비과세 제외 연봉)
  dependents: 0, // 본인 제외 기본공제 대상자 수 (배우자·자녀·부모 등)
  seniors: 0, // 그중 만 70세 이상
  disabled: 0, // 장애인 (본인 포함)
  children: 0, // 기본공제 대상 자녀 수 (만 20세 이하)
  childrenOver8: 0, // 그중 만 8세 이상
  newbornOrder: 0, // 올해 출생·입양: 0 없음, 1 첫째, 2 둘째, 3 셋째 이상
  schoolChildren: 0, // 취학 전·초중고 교육비 대상 자녀 수
  univStudents: 0, // 대학생 교육비 대상 수 (본인 제외)
  woman: false, // 부녀자 공제
  singleParent: false, // 한부모 공제
  married: false, // 올해 혼인신고 (혼인세액공제)
  homelessHead: 'unknown', // 무주택 세대주: 'yes' | 'no' | 'unknown'(확인 필요)
  dependentsVerified: false, // 부양가족 소득·나이 요건 확인함
  nationalPension: null, // 연간 국민연금 본인부담 (null 이면 자동 추정)
  healthInsurance: null, // 연간 건강·장기요양·고용보험 본인부담 (null 이면 자동 추정)
  prepaidTax: null, // 올해 이미 원천징수된 소득세 (지방세 제외)
};

export function emptyMonth() {
  const m = { updatedAt: 0 };
  for (const k of MONTH_KEYS) m[k] = 0;
  return m;
}

export function emptyYear(year) {
  return {
    year: Number(year),
    profile: { ...DEFAULT_PROFILE, updatedAt: 0 },
    months: {},
    review: { items: {}, janItems: {}, validation: {}, lastYearRefund: null, updatedAt: 0 },
    plan: { done: {}, updatedAt: 0 }, // 12월 31일 전에 할 일 체크
  };
}
