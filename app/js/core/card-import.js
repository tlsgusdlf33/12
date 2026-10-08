// 카드 사용 내역 CSV → 월별·공제 구분별 합계.
// 6번(고정비) 파이프라인의 정규화 CSV(date,amount,merchant,method,deduction)를 그대로 받고,
// 카드사에서 내려받은 엑셀을 CSV로 저장한 파일도 머리글을 보고 열을 찾는다. 형식: docs/CARD-CSV.md

const COLS = {
  date: ['date', '날짜', '이용일', '이용일자', '거래일', '거래일자', '승인일', '승인일자', '사용일', '결제일'],
  amount: ['amount', '금액', '이용금액', '거래금액', '승인금액', '결제금액', '사용금액', '결제예정금액'],
  merchant: ['merchant', '가맹점', '가맹점명', '이용가맹점', '이용하신곳', '사용처', '상호', '내용', '적요'],
  method: ['method', '결제수단', '카드구분', '카드종류', '구분', '이용구분'],
  deduction: ['deduction', '공제구분', '공제유형', '소득공제구분'],
};

// 머리글 정규화: 공백·괄호 설명 제거
const norm = (s) => String(s ?? '').replace(/\(.*?\)/g, '').replace(/\s/g, '').toLowerCase();

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export function findHeader(rows) {
  // 카드사 파일은 위쪽에 안내 문구가 있는 경우가 많아 처음 15줄에서 머리글을 찾는다
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map(norm);
    const idx = {};
    for (const [key, names] of Object.entries(COLS)) {
      const i = cells.findIndex((c) => names.some((n) => c === norm(n)));
      if (i >= 0) idx[key] = i;
    }
    if (idx.date != null && idx.amount != null) return { row: r, idx };
  }
  return null;
}

export function parseAmount(v) {
  let s = String(v ?? '').trim();
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-') || s.startsWith('−');
  s = s.replace(/[^\d.]/g, '');
  if (!s) return null;
  const n = Math.round(Number(s));
  return negative ? -n : n;
}

export function parseDate(v, fallbackYear) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  m = s.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (m) return { year: 2000 + Number(m[1]), month: Number(m[2]) };
  m = s.match(/^(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (m && fallbackYear) return { year: fallbackYear, month: Number(m[1]) };
  return null;
}

export function normalizeMethod(v) {
  const s = norm(v);
  if (!s) return null;
  if (/credit|신용/.test(s)) return 'credit';
  if (/debit|check|cash|체크|직불|현금|선불|cash_receipt/.test(s)) return 'debit';
  return null;
}

export function normalizeDeduction(v) {
  const s = norm(v);
  if (!s) return null;
  if (/market|전통시장/.test(s)) return 'market';
  if (/transit|대중교통/.test(s)) return 'transit';
  if (/culture|도서|공연|문화|박물관|미술관|영화|체육/.test(s)) return 'culture';
  if (/excluded|제외|공제불가|해당없음/.test(s)) return 'excluded';
  if (/general|일반/.test(s)) return 'general';
  return null;
}

// 가맹점 이름으로 공제 구분 추정 (정규화 데이터에 deduction 열이 없을 때만 사용)
const RULES = [
  ['excluded', /국세|지방세|세무서|공과금|관리비|보험료|생명보험|화재보험|손해보험|상품권|통행료|하이패스|면세점|해외|현금서비스|카드론/],
  ['transit', /버스|지하철|도시철도|메트로|코레일|철도공사|KTX|SRT|에스알|티머니|T-?money|캐시비|레일플러스|고속버스|시외버스|교통카드|공항철도/i],
  ['market', /전통시장|재래시장|시장상인|상점가|[가-힣]+시장(?!조사)/],
  ['culture', /서점|문고|교보|영풍|예스24|YES24|알라딘|인터파크\s*(티켓|도서)|CGV|메가박스|롯데시네마|씨네|영화관|극장|공연|뮤지컬|박물관|미술관|수영장|헬스|체육관|피트니스/i],
];

export function classifyMerchant(name) {
  const s = String(name ?? '');
  for (const [cat, re] of RULES) if (re.test(s)) return cat;
  return 'general';
}

const EMPTY = () => ({ credit: 0, debit: 0, market: 0, transit: 0, culture: 0 });

// defaultMethod: 'credit' | 'debit' — 파일에 결제수단 열이 없을 때 전체에 적용
export function importTransactions(text, { year, defaultMethod = 'credit' } = {}) {
  const rows = parseCSV(text);
  const header = findHeader(rows);
  if (!header) throw new Error('날짜·금액 열을 찾지 못했습니다. 첫 줄에 "날짜, 금액, 가맹점" 같은 머리글이 있는지 확인하세요.');
  const { idx } = header;
  const months = {};
  const summary = { rows: 0, used: 0, otherYear: 0, invalid: 0, excluded: [], cancelled: 0, byCategory: { general: 0, market: 0, transit: 0, culture: 0 } };
  const examples = { market: new Set(), transit: new Set(), culture: new Set(), excluded: new Set() };

  for (const r of rows.slice(header.row + 1)) {
    summary.rows++;
    const date = parseDate(r[idx.date], year);
    const amount = parseAmount(r[idx.amount]);
    if (!date || amount == null || date.month < 1 || date.month > 12) {
      summary.invalid++;
      continue;
    }
    if (year && date.year !== year) {
      summary.otherYear++;
      continue;
    }
    const merchant = idx.merchant != null ? r[idx.merchant]?.trim() : '';
    const method = (idx.method != null && normalizeMethod(r[idx.method])) || defaultMethod;
    const cat = (idx.deduction != null && normalizeDeduction(r[idx.deduction])) || classifyMerchant(merchant);
    if (cat === 'excluded') {
      summary.excluded.push({ month: date.month, merchant, amount });
      examples.excluded.add(merchant);
      continue;
    }
    if (amount < 0) summary.cancelled++;
    const field = cat === 'general' ? method : cat;
    months[date.month] ??= EMPTY();
    months[date.month][field] += amount;
    summary.byCategory[cat] += amount;
    summary.used++;
    if (examples[cat] && merchant) examples[cat].add(merchant);
  }
  // 취소가 더 많아 음수가 된 달은 0으로
  for (const m of Object.values(months)) for (const k of Object.keys(m)) m[k] = Math.max(0, m[k]);
  summary.examples = Object.fromEntries(Object.entries(examples).map(([k, set]) => [k, [...set].slice(0, 5)]));
  return { months, summary, columns: Object.keys(idx) };
}

// 바이트 → 문자열. 카드사 파일은 EUC-KR 인 경우가 많다.
export function decodeBytes(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}
