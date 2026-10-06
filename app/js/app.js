import { store } from './store.js';
import { analyze, enteredMonths, EFFECT_LABELS, estimateSocialInsurance } from './core/tax-engine.js';
import { MONTH_GROUPS, MONTH_KEYS } from './core/fields.js';
import { SUPPORTED_YEARS, getRules } from './core/rules.js';
import { APP_VERSION } from './version.js';
import * as sync from './sync.js';
import { initUpdater, checkForUpdate, applyUpdate, fetchRemoteVersion } from './updater.js';
import { downloadICS, requestNotificationPermission, notifyIfNeeded } from './reminders.js';

// ───────────────────────── 유틸 ─────────────────────────

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const won = (n) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const man = (n) => {
  n = Math.round(n || 0);
  if (Math.abs(n) < 10_000) return won(n);
  const v = Math.abs(n) >= 10_000_000 ? Math.round(n / 10_000) : Math.round(n / 1_000) / 10;
  return `${v.toLocaleString('ko-KR')}만 원`;
};
const comma = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR'));
const digits = (s) => String(s).replace(/[^\d]/g, '');
const pctOf = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

const today = () => new Date();
const isCurrentYear = () => store.year === today().getFullYear();

function defaultMonth() {
  if (!isCurrentYear()) return store.year < today().getFullYear() ? 12 : 1;
  const m = today().getMonth() + 1;
  const entered = enteredMonths(store.getYear());
  // 지난달을 아직 안 적었으면 지난달부터
  return m > 1 && !entered.includes(m - 1) ? m - 1 : m;
}

const ui = {
  tab: 'home',
  month: null,
  openGroups: new Set(['card', 'pension']),
  installPrompt: null,
  syncState: { status: 'disabled' },
  updateInfo: null,
  authMode: 'login',
};

// ───────────────────────── 라우팅 · 렌더 ─────────────────────────

const VIEWS = { home: renderHome, input: renderInput, status: renderStatus, review: renderReview, settings: renderSettings };

function route() {
  const [tab, arg] = location.hash.replace('#', '').split('/');
  const next = VIEWS[tab] ? tab : 'home';
  if (next === 'input' && arg) ui.month = Math.min(12, Math.max(1, Number(arg) || 1));
  const changed = next !== ui.tab;
  ui.tab = next;
  render();
  if (changed) window.scrollTo(0, 0);
  if (arg && next === 'settings') document.getElementById(arg)?.scrollIntoView({ block: 'start' });
}

function render() {
  if (ui.month == null) ui.month = defaultMonth();
  VIEWS[ui.tab]();
  for (const a of document.querySelectorAll('.tabbar a')) a.classList.toggle('active', a.dataset.tab === ui.tab);
  renderYearSelect();
}

// 입력 중에 다른 기기에서 데이터가 들어오면 포커스를 잃지 않도록 입력이 끝난 뒤 다시 그린다
let pendingRender = false;
function scheduleRender() {
  const a = document.activeElement;
  if (a && view.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) {
    if (!pendingRender) {
      pendingRender = true;
      a.addEventListener('blur', () => {
        pendingRender = false;
        setTimeout(render, 0);
      }, { once: true });
    }
    return;
  }
  render();
}

function renderYearSelect() {
  const sel = $('#year-select');
  const years = new Set([...SUPPORTED_YEARS, today().getFullYear(), store.year]);
  const list = [...years].sort((a, b) => b - a);
  const html = list.map((y) => `<option value="${y}" ${y === store.year ? 'selected' : ''}>${y}년 귀속</option>`).join('');
  if (sel.innerHTML !== html) sel.innerHTML = html;
}

function result() {
  return analyze(store.getYear(), { project: store.settings.project, today: today() });
}

// ───────────────────────── 홈 ─────────────────────────

const REC_ICON = { urgent: '!', tip: '↗', info: 'i', done: '✓' };

function recCard(r) {
  const action =
    r.action === 'input'
      ? `<div class="rec-action"><a class="btn btn-sm btn-primary" href="#input/${r.month || ''}">입력하러 가기</a></div>`
      : r.action === 'settings'
        ? `<div class="rec-action"><a class="btn btn-sm btn-primary" href="#settings/profile">내 정보 입력</a></div>`
        : '';
  return `<div class="rec ${r.level}"><div class="dot">${REC_ICON[r.level]}</div><div><h3>${esc(r.title)}</h3><p>${esc(r.body)}</p>${action}</div></div>`;
}

function meter({ title, value, max, right, foot, done, pre }) {
  return `<div class="meter">
    <div class="meter-head"><b>${esc(title)}</b><span class="num muted small">${right}</span></div>
    <div class="bar ${done ? 'done' : ''}"><span class="${pre ? 'pre' : ''}" style="width:${pctOf(value, max)}%"></span></div>
    ${foot ? `<div class="meter-foot">${foot}</div>` : ''}
  </div>`;
}

function monthChips(selected = null, link = true) {
  const entered = new Set(enteredMonths(store.getYear()));
  const now = today();
  let html = '<div class="months">';
  for (let m = 1; m <= 12; m++) {
    const cls = ['month-chip'];
    if (entered.has(m)) cls.push('filled');
    if (isCurrentYear() && m === now.getMonth() + 1) cls.push('current');
    if (isCurrentYear() && m > now.getMonth() + 1) cls.push('future');
    if (m === selected) cls.push('selected');
    html += link
      ? `<a class="${cls.join(' ')}" href="#input/${m}">${m}월</a>`
      : `<button type="button" class="${cls.join(' ')}" data-month="${m}" aria-pressed="${m === selected}">${m}월</button>`;
  }
  return html + '</div>';
}

function renderHome() {
  const r = result();
  const { tax, rules } = r;
  const salary = r.profile.salary;

  if (!salary) {
    view.innerHTML = `<div class="stack">
      <div class="card hero">
        <div class="label">연말정산은 12월에 챙기면 이미 늦습니다</div>
        <div class="big" style="font-size:24px">매달 5분, 올해 돌려받을 세금 챙기기</div>
        <div class="sub">카드 사용액과 연금 납입액을 매달 기록하면, 공제 한도까지 얼마 남았는지와 무엇을 더 하면 되는지 알려드려요.</div>
      </div>
      <div class="card">
        <h2>시작하기</h2>
        <ol class="steps">
          <li><b>작년 결과 확인</b> — 홈택스에서 작년 연말정산 결과를 보고 못 받은 공제를 체크하세요. <a href="#review">작년 점검 →</a></li>
          <li><b>내 정보 입력</b> — 총급여와 부양가족을 입력하면 공제 문턱과 공제율이 정해집니다. <a href="#settings/profile">내 정보 →</a></li>
          <li><b>매달 입력</b> — 지난달 카드 사용액과 연금 납입액을 적으세요. <a href="#input">월별 입력 →</a></li>
        </ol>
        <div class="btn-row"><a class="btn btn-primary" href="#settings/profile">총급여 입력하고 시작</a></div>
      </div>
      ${disclaimer(rules)}
    </div>`;
    return;
  }

  const heroLabel = tax.refund == null ? '올해 예상 결정세액 (지방세 포함)' : tax.refund >= 0 ? '예상 환급액' : '예상 추가 납부액';
  const heroValue = tax.refund == null ? tax.totalTax : Math.abs(tax.refund);
  const heroSub =
    tax.refund == null
      ? '설정에서 올해 이미 낸 소득세(기납부세액)를 입력하면 환급액을 알려드려요.'
      : `기납부 ${man(tax.prepaidTotal)} − 결정세액 ${man(tax.totalTax)}`;
  const urgent = r.recommendations.filter((x) => x.level !== 'done');
  const done = r.recommendations.filter((x) => x.level === 'done');

  const c = tax.card;
  const cardMeter = c.thresholdReached
    ? meter({
        title: '신용카드 등 소득공제',
        value: c.deduction,
        max: c.baseLimit,
        right: `${man(c.deduction)} / ${man(c.baseLimit)}`,
        foot: c.baseMaxed ? '기본 한도 도달 — 이후엔 전통시장·대중교통 추가 한도만 남았어요' : `문턱 통과 · 체크카드로 약 ${man(c.debitToFillBase)} 더 쓰면 기본 한도 도달`,
        done: c.baseMaxed,
      })
    : meter({
        title: '신용카드 공제 문턱 (총급여 25%)',
        value: c.totalSpend,
        max: c.threshold,
        right: `${man(c.totalSpend)} / ${man(c.threshold)}`,
        foot: `문턱까지 ${man(c.toThreshold)} — 넘기 전까지는 공제 0원`,
        pre: true,
      });
  const p = tax.pension;
  const pensionMeter = meter({
    title: '연금저축 + IRP 세액공제',
    value: p.eligible,
    max: rules.pension.totalLimit,
    right: `${man(p.eligible)} / ${man(rules.pension.totalLimit)}`,
    foot:
      p.room === 0
        ? '한도 달성!'
        : r.pension.gain > 0
          ? `${man(r.pension.recommended)} 더 납입하면 약 ${man(r.pension.gain)} 추가 절세`
          : '낼 세금이 없어 추가 납입의 세액공제 효과는 없어요',
    done: p.room === 0,
  });
  const m = tax.medical;
  const medicalMeter =
    m.total > 0
      ? meter({
          title: '의료비 공제 문턱 (총급여 3%)',
          value: m.total,
          max: m.threshold,
          right: `${man(m.total)} / ${man(m.threshold)}`,
          foot: m.toThreshold > 0 ? `${man(m.toThreshold)} 더 쓰면 공제 시작` : `공제 중 · 세액공제 ${man(m.credit)}`,
          done: m.toThreshold === 0,
          pre: m.toThreshold > 0,
        })
      : '';
  const housingMeter = tax.housing.eligible
    ? meter({
        title: '주택청약 소득공제',
        value: r.totals.housingSubscription,
        max: rules.housingSubscription.limit,
        right: `${man(r.totals.housingSubscription)} / ${man(rules.housingSubscription.limit)}`,
        done: tax.housing.room === 0,
      })
    : '';
  const rentMeter = tax.rent.eligible
    ? meter({
        title: '월세 세액공제',
        value: r.totals.rent,
        max: rules.rent.limit,
        right: `${man(r.totals.rent)} / ${man(rules.rent.limit)}`,
        foot: `세액공제 ${man(tax.rent.credit * (1 + rules.localTaxRate))}`,
      })
    : '';

  view.innerHTML = `<div class="stack">
    <div class="card hero">
      <div class="label">${heroLabel}${r.projected ? ' · 연간 예상' : ''}</div>
      <div class="big num">${won(heroValue)}</div>
      <div class="sub">${esc(heroSub)}</div>
      <div class="hero-stats">
        <div><span class="small">공제로 줄인 세금</span><strong class="num">${won(r.totalSaved)}</strong></div>
        <div><span class="small">입력한 달</span><strong class="num">${r.enteredCount} / 12개월</strong></div>
      </div>
    </div>

    <div class="section-title"><span>이번 달 할 일</span><a class="small" href="#status">자세히 →</a></div>
    <div>${urgent.length ? urgent.map(recCard).join('') : '<div class="card empty">지금은 할 일이 없어요. 다음 달에 만나요!</div>'}</div>

    <div class="section-title"><span>공제 한도 진행률${r.projected ? ' (연간 예상)' : ''}</span></div>
    <div class="card">${cardMeter}${pensionMeter}${medicalMeter}${rentMeter}${housingMeter}</div>

    ${done.length ? `<div class="section-title"><span>잘 챙긴 항목</span></div><div>${done.map(recCard).join('')}</div>` : ''}

    <div class="section-title"><span>${store.year}년 월별 입력 현황</span><a class="small" href="#input">입력 →</a></div>
    <div class="card">${monthChips()}</div>
    ${disclaimer(rules)}
  </div>`;

  notifyIfNeeded(r.recommendations, store.settings, (patch) => store.setSettings(patch));
}

function disclaimer(rules) {
  return `<p class="disclaimer">${esc(rules.verifiedNote)}${rules.fallbackFrom ? ` (${rules.year}년 규칙이 아직 없어 ${rules.fallbackFrom}년 기준으로 계산)` : ''}<br>근로소득만 있는 직장인 기준의 추정치입니다.</p>`;
}

// ───────────────────────── 월별 입력 ─────────────────────────

const RECURRING_KEYS = ['pensionSavings', 'irp', 'rent', 'housingSubscription', 'insurance', 'insuranceDisabled'];

function moneyField({ key, label, help, value, scope = 'month', placeholder = '0' }) {
  return `<label class="field">
    <span class="label">${esc(label)}${help ? ` <small>${esc(help)}</small>` : ''}</span>
    <span class="input-wrap"><input type="text" inputmode="numeric" autocomplete="off" data-money data-scope="${scope}" data-key="${key}" value="${value ? comma(value) : ''}" placeholder="${esc(placeholder)}" /><span class="unit">원</span></span>
    <span class="hint" data-hint>${value ? '= ' + man(value) : ''}</span>
  </label>`;
}

function groupSum(row, group) {
  return group.fields.reduce((s, f) => s + (Number(row?.[f.key]) || 0), 0);
}

function renderInput() {
  const y = store.getYear();
  const month = ui.month;
  const row = y.months[month];
  const isEntered = enteredMonths(y).includes(month);
  const prevMonth = enteredMonths(y).filter((m) => m < month).at(-1);

  view.innerHTML = `<div class="stack">
    <div class="card">
      <div class="row between" style="margin-bottom:12px">
        <h2 style="margin:0">${store.year}년 ${month}월</h2>
        <span class="pill ${isEntered ? 'good' : ''}">${isEntered ? '입력됨 · 자동 저장' : '아직 입력 안 함'}</span>
      </div>
      ${monthChips(month, false)}
      <div class="btn-row">
        ${prevMonth ? `<button class="btn btn-sm" type="button" data-action="copy-prev">${prevMonth}월 정기 납입 복사</button>` : ''}
        ${!isEntered ? `<button class="btn btn-sm" type="button" data-action="mark-entered">변동 없음 (입력 완료)</button>` : ''}
      </div>
      <p class="tiny" style="margin:10px 0 0">금액을 입력하면 바로 저장되고, 로그인한 다른 기기에도 반영됩니다.</p>
    </div>

    ${MONTH_GROUPS.map(
      (g) => `<details class="group" data-group="${g.id}" ${ui.openGroups.has(g.id) ? 'open' : ''}>
        <summary><span>${esc(g.title)}</span><span class="group-sum num" data-group-sum="${g.id}">${groupSum(row, g) ? man(groupSum(row, g)) : ''}</span></summary>
        <div class="group-body">
          ${g.hint ? `<p class="tiny" style="margin:0 0 12px">${esc(g.hint)}</p>` : ''}
          ${g.fields.map((f) => moneyField({ ...f, value: row?.[f.key] })).join('')}
        </div>
      </details>`,
    ).join('')}
  </div>`;
}

function refreshInputChrome() {
  const y = store.getYear();
  const row = y.months[ui.month];
  for (const g of MONTH_GROUPS) {
    const el = view.querySelector(`[data-group-sum="${g.id}"]`);
    if (el) {
      const s = groupSum(row, g);
      el.textContent = s ? man(s) : '';
    }
  }
  const pill = view.querySelector('.pill');
  if (pill && enteredMonths(y).includes(ui.month)) {
    pill.textContent = '입력됨 · 자동 저장';
    pill.classList.add('good');
    view.querySelector('[data-action="mark-entered"]')?.remove();
    const chip = view.querySelector(`.month-chip[data-month="${ui.month}"]`);
    chip?.classList.add('filled');
  }
}

// ───────────────────────── 공제 현황 ─────────────────────────

function renderStatus() {
  const r = result();
  const { tax, rules, effects } = r;
  if (!r.profile.salary) {
    view.innerHTML = `<div class="card empty">총급여를 입력하면 계산 결과를 볼 수 있어요.<div class="btn-row" style="justify-content:center"><a class="btn btn-primary" href="#settings/profile">내 정보 입력</a></div></div>`;
    return;
  }
  const L = 1 + rules.localTaxRate;
  const maxEffect = Math.max(1, ...Object.values(effects));
  const sortedEffects = Object.entries(effects).sort((a, b) => b[1] - a[1]);
  const c = tax.card;
  const catLabel = { credit: '신용카드', debit: '체크·현금영수증', culture: '도서·공연 등', market: '전통시장', transit: '대중교통' };

  view.innerHTML = `<div class="stack">
    <div class="row between">
      <div class="segmented" role="group" aria-label="계산 기준">
        <button type="button" data-action="project" data-value="1" aria-pressed="${store.settings.project}">연간 예상</button>
        <button type="button" data-action="project" data-value="0" aria-pressed="${!store.settings.project}">입력한 금액만</button>
      </div>
      <span class="tiny">${r.enteredCount}개월 입력</span>
    </div>
    <p class="tiny" style="margin:6px 2px 0">연간 예상: 입력하지 않은 달의 카드 사용액·월세를 입력한 달의 평균으로 채워 계산합니다. 연금·의료비 등은 입력한 금액만 반영합니다.</p>

    <div class="card">
      <h2>항목별 절세 효과</h2>
      <p class="tiny" style="margin:-4px 0 10px">이 항목이 없었다면 세금이 얼마나 더 나왔을지 (지방세 포함)</p>
      <table class="table">
        ${sortedEffects
          .map(
            ([id, v]) => `<tr><td>${EFFECT_LABELS[id]}<div class="effect-bar" style="width:${pctOf(v, maxEffect)}%;${v ? '' : 'opacity:.2'}"></div></td><td>${won(v)}</td></tr>`,
          )
          .join('')}
        <tr class="total"><td>합계</td><td>${won(r.totalSaved)}</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>예상 세금 계산</h2>
      <table class="table">
        <tr><td>총급여</td><td>${won(tax.salary)}</td></tr>
        <tr class="minus"><td>− 근로소득공제</td><td>${won(tax.earnedIncomeDeduction)}</td></tr>
        <tr class="minus"><td>− 인적공제</td><td>${won(tax.personalDeduction)}</td></tr>
        <tr class="minus"><td>− 국민연금${tax.socialEstimated.pension ? '<span class="pill warn">추정</span>' : ''}</td><td>${won(tax.nationalPension)}</td></tr>
        <tr class="minus"><td>− 건강·고용보험${tax.socialEstimated.health ? '<span class="pill warn">추정</span>' : ''}${tax.method === 'standard' ? '<span class="pill">표준공제 선택으로 미적용</span>' : ''}</td><td>${won(tax.method === 'standard' ? 0 : tax.healthInsurance)}</td></tr>
        <tr class="minus"><td>− 주택청약 소득공제</td><td>${won(tax.housing.deduction)}</td></tr>
        <tr class="minus"><td>− 신용카드 등 소득공제</td><td>${won(c.deduction)}</td></tr>
        <tr><td><b>과세표준</b> <span class="pill">세율 ${Math.round(tax.marginalRate * 100)}% 구간</span></td><td><b>${won(tax.taxBase)}</b></td></tr>
        <tr><td>산출세액</td><td>${won(tax.calculatedTax)}</td></tr>
        <tr class="minus"><td>− 근로소득세액공제</td><td>${won(tax.earnedIncomeCredit)}</td></tr>
        <tr class="minus"><td>− 연금계좌 세액공제</td><td>${won(tax.pension.credit)}</td></tr>
        <tr class="minus"><td>− 자녀·출산 세액공제</td><td>${won(tax.child.credit)}</td></tr>
        ${tax.marriage ? `<tr class="minus"><td>− 혼인 세액공제</td><td>${won(tax.marriage)}</td></tr>` : ''}
        ${
          tax.method === 'standard'
            ? `<tr class="minus"><td>− 표준세액공제 <span class="pill">더 유리해서 자동 선택</span></td><td>${won(rules.standardCredit)}</td></tr>`
            : `<tr class="minus"><td>− 의료비 세액공제</td><td>${won(tax.medical.credit)}</td></tr>
               <tr class="minus"><td>− 교육비 세액공제</td><td>${won(tax.education.credit)}</td></tr>
               <tr class="minus"><td>− 보험료 세액공제</td><td>${won(tax.insurance.credit)}</td></tr>
               <tr class="minus"><td>− 월세 세액공제</td><td>${won(tax.rent.credit)}</td></tr>`
        }
        <tr class="minus"><td>− 기부금 세액공제</td><td>${won(tax.donation.nonSpecial + (tax.method === 'standard' ? 0 : tax.donation.special))}</td></tr>
        <tr><td>결정세액</td><td>${won(tax.determined)}</td></tr>
        <tr><td>지방소득세 (10%)</td><td>${won(tax.localTax)}</td></tr>
        <tr class="total"><td>총 부담 세액</td><td>${won(tax.totalTax)}</td></tr>
        ${
          tax.refund == null
            ? `<tr><td colspan="2" class="tiny" style="text-align:left">기납부세액을 <a href="#settings/profile">내 정보</a>에 입력하면 환급액도 계산해요.</td></tr>`
            : `<tr><td>기납부세액 (지방세 포함)</td><td>${won(tax.prepaidTotal)}</td></tr>
               <tr class="total"><td>${tax.refund >= 0 ? '예상 환급액' : '예상 추가 납부액'}</td><td style="color:var(${tax.refund >= 0 ? '--good' : '--bad'})">${won(Math.abs(tax.refund))}</td></tr>`
        }
      </table>
    </div>

    <div class="card">
      <h2>신용카드 등 소득공제 상세</h2>
      <table class="table">
        <tr><td>공제 문턱 (총급여 25%)</td><td>${won(c.threshold)}</td></tr>
        <tr><td>총 사용액</td><td>${won(c.totalSpend)}</td></tr>
        ${Object.entries(c.byCategory)
          .filter(([, v]) => v.amount > 0)
          .map(([k, v]) => `<tr class="minus"><td>${catLabel[k]} ${won(v.amount)} <span class="pill">${Math.round(rules.card.rates[k] * 100)}%</span>${v.appliedToThreshold ? `<div class="tiny">문턱 채우기에 ${man(v.appliedToThreshold)} 사용</div>` : ''}</td><td>${won(v.deduction)}</td></tr>`)
          .join('')}
        <tr><td>공제 가능액</td><td>${won(c.gross)}</td></tr>
        <tr><td>기본 한도 / 추가 한도</td><td>${man(c.baseLimit)} / ${man(c.extraLimit)}</td></tr>
        <tr class="total"><td>소득공제액</td><td>${won(c.deduction)}</td></tr>
        <tr><td colspan="2" class="tiny" style="text-align:left">소득공제는 과세표준을 줄이므로 실제 절세액은 공제액 × 세율(${Math.round(tax.marginalRate * 100 * L * 10) / 10}%, 지방세 포함) 정도입니다.</td></tr>
      </table>
    </div>
    ${disclaimer(rules)}
  </div>`;
}

// ───────────────────────── 작년 점검 ─────────────────────────

const REVIEW_ITEMS = [
  { id: 'pension', title: '연금저축·IRP 세액공제', missed: '연금저축·IRP는 연 900만 원까지 13.2~16.5%를 돌려받는 가장 확실한 절세입니다. 올해는 매달 자동이체로 나눠 넣으세요.' },
  { id: 'card', title: '신용카드 등 소득공제', missed: '총급여 25% 문턱을 못 넘었다면, 맞벌이는 한 사람 카드로 몰아 쓰는 것이 유리할 수 있습니다. 문턱 이후엔 체크카드를 쓰세요.' },
  { id: 'rent', title: '월세 세액공제', missed: '무주택 세대주이고 총급여 8천만 원 이하라면 월세의 15~17%를 돌려받습니다. 간소화 자료에 안 나와서 많이 놓치며, 5년 이내 경정청구로 돌려받을 수 있습니다.' },
  { id: 'medical', title: '의료비 세액공제', missed: '총급여 3%를 넘는 의료비부터 공제됩니다. 안경·렌즈 구입비, 산후조리원, 보청기는 간소화 자료에 빠지기 쉬우니 영수증을 챙기세요.' },
  { id: 'education', title: '교육비 세액공제', missed: '본인 대학원·직업훈련비, 자녀 교복·체험학습비(초중고), 취학 전 학원비도 공제 대상입니다.' },
  { id: 'insurance', title: '보장성 보험료 세액공제', missed: '자동차·실손·종신보험 등 연 100만 원까지 12%. 계약자와 피보험자가 기본공제 대상자인지 확인하세요.' },
  { id: 'housing', title: '주택청약 소득공제', missed: '무주택 세대주이고 총급여 7천만 원 이하라면 연 300만 원 납입분의 40%가 소득공제됩니다. 은행에 무주택 확인서를 꼭 내야 합니다.' },
  { id: 'hometown', title: '고향사랑기부금', missed: '10만 원까지 전액 세액공제 + 30% 답례품. 사실상 무료로 지역 특산품을 받는 셈입니다.' },
  { id: 'dependents', title: '부양가족 기본공제', missed: '소득 없는 부모님(만 60세 이상, 따로 살아도 가능), 형제자매, 장애인 가족을 빠뜨리지 않았는지 확인하세요. 1인당 150만 원 소득공제입니다.' },
];

function renderReview() {
  const y = store.getYear();
  const items = y.review.items || {};
  const missed = REVIEW_ITEMS.filter((i) => items[i.id] === 'missed');
  const checked = REVIEW_ITEMS.filter((i) => items[i.id]).length;
  const seg = (id, val, label) => `<button type="button" data-review="${id}" data-value="${val}" aria-pressed="${items[id] === val}">${label}</button>`;

  view.innerHTML = `<div class="stack">
    <div class="card">
      <h2>첫 단계: 작년 연말정산 결과 확인하기</h2>
      <ol class="steps small">
        <li>홈택스(PC) 또는 손택스(모바일 앱)에 로그인합니다.</li>
        <li>검색창에 <b>"지급명세서"</b>를 검색해 <b>근로소득 지급명세서</b>(작년 귀속)를 엽니다.</li>
        <li>공제 항목별 금액을 보고, 0원이거나 비어 있는 항목을 아래에서 <b>못 받음</b>으로 체크하세요.</li>
        <li>맨 아래 <b>차감징수세액</b>이 음수(−)면 환급, 양수면 추가 납부였습니다.</li>
      </ol>
      <p class="tiny" style="margin:10px 0 0">놓친 공제는 5년 이내라면 홈택스 <b>경정청구</b>로 돌려받을 수 있습니다.</p>
    </div>

    <div class="card">
      <div class="row between" style="margin-bottom:6px"><h2 style="margin:0">작년에 받은 공제</h2><span class="tiny">${checked} / ${REVIEW_ITEMS.length} 확인</span></div>
      ${REVIEW_ITEMS.map(
        (i) => `<div class="review-item">
          <div class="row between"><h3>${esc(i.title)}</h3></div>
          ${items[i.id] === 'missed' ? `<p>${esc(i.missed)}</p>` : '<div style="height:8px"></div>'}
          <div class="segmented" role="group" aria-label="${esc(i.title)}">${seg(i.id, 'got', '받았음')}${seg(i.id, 'missed', '못 받음')}${seg(i.id, 'na', '해당 없음')}</div>
        </div>`,
      ).join('')}
    </div>

    <div class="card">
      <h2>작년 결과</h2>
      <div class="grid-2">
        <label class="field" style="margin:0"><span class="label">결과</span>
          <select class="input" data-review-field="lastYearType">
            <option value="refund" ${y.review.lastYearType !== 'pay' ? 'selected' : ''}>환급받음</option>
            <option value="pay" ${y.review.lastYearType === 'pay' ? 'selected' : ''}>추가 납부함</option>
          </select>
        </label>
        ${moneyField({ key: 'lastYearRefund', label: '금액', value: y.review.lastYearRefund, scope: 'review' })}
      </div>
    </div>

    ${
      missed.length
        ? `<div class="card"><h2>올해 집중할 항목 (${missed.length})</h2><p class="small muted" style="margin:0">${missed.map((m) => esc(m.title)).join(' · ')}</p><div class="btn-row"><a class="btn btn-primary" href="#input">월별 입력 시작</a></div></div>`
        : ''
    }
  </div>`;
}

// ───────────────────────── 설정 ─────────────────────────

function numField(key, label, value, help = '') {
  return `<label class="field"><span class="label">${esc(label)}${help ? ` <small>${esc(help)}</small>` : ''}</span>
    <span class="input-wrap"><input type="number" min="0" max="20" inputmode="numeric" data-profile-num="${key}" value="${value || 0}" /><span class="unit">명</span></span></label>`;
}

function checkField(key, label, value, help = '') {
  return `<label class="check"><input type="checkbox" data-profile-check="${key}" ${value ? 'checked' : ''} /><span>${esc(label)}${help ? `<br><span class="tiny">${esc(help)}</span>` : ''}</span></label>`;
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function renderAccountCard() {
  const s = ui.syncState;
  if (!sync.syncEnabled) {
    return `<div class="card" id="account"><h2>계정 · 기기 동기화</h2>
      <p class="small muted" style="margin:0">지금은 <b>이 기기에만 저장</b>됩니다. 앱 관리자가 Firebase 설정(<code>js/firebase-config.js</code>)을 넣으면 같은 계정으로 PC와 휴대폰이 자동 동기화됩니다. 그 전까지는 아래 <b>백업 내보내기/가져오기</b>로 옮길 수 있어요.</p></div>`;
  }
  const user = sync.currentUser();
  if (user) {
    const label = { synced: '동기화됨', syncing: '동기화 중…', error: '오류', offline: '오프라인 (연결되면 자동 동기화)' }[s.status] || s.status;
    return `<div class="card" id="account"><h2>계정 · 기기 동기화</h2>
      <p class="small" style="margin:0 0 4px"><b>${esc(user.email || user.displayName || '로그인됨')}</b></p>
      <p class="small muted" style="margin:0">상태: ${esc(label)}${s.detail ? ` — ${esc(s.detail)}` : ''}</p>
      <p class="tiny" style="margin:8px 0 0">휴대폰과 PC에서 같은 계정으로 로그인하면 입력 내용이 실시간으로 맞춰집니다.</p>
      <div class="btn-row"><button class="btn btn-sm" type="button" data-action="sync-now">지금 동기화</button><button class="btn btn-sm btn-danger" type="button" data-action="sign-out">로그아웃</button><button class="btn btn-sm btn-danger" type="button" data-action="delete-account">계정 삭제</button></div></div>`;
  }
  const create = ui.authMode === 'signup';
  return `<div class="card" id="account"><h2>계정 · 기기 동기화</h2>
    <p class="small muted" style="margin:0 0 12px">로그인하면 PC와 휴대폰이 같은 데이터를 봅니다. 이 기기에 입력해 둔 내용도 계정에 합쳐집니다.</p>
    <button class="btn btn-block" type="button" data-action="google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Google 계정으로 계속</button>
    <form data-form="email" style="margin-top:14px">
      <label class="field"><span class="label">이메일</span><input type="email" name="email" autocomplete="email" required /></label>
      <label class="field"><span class="label">비밀번호 <small>6자 이상</small></span><input type="password" name="password" autocomplete="${create ? 'new-password' : 'current-password'}" minlength="6" required /></label>
      <div class="btn-row"><button class="btn btn-primary" type="submit">${create ? '가입하기' : '이메일로 로그인'}</button>
      <button class="btn btn-sm" type="button" data-action="auth-mode">${create ? '이미 계정이 있어요' : '처음이에요 (가입)'}</button>
      ${create ? '' : '<button class="btn btn-sm" type="button" data-action="reset-pw">비밀번호 재설정</button>'}</div>
    </form>
    ${s.status === 'error' && s.detail ? `<p class="small" style="color:var(--bad)">${esc(s.detail)}</p>` : ''}
  </div>`;
}

function renderInstallCard() {
  if (isStandalone()) {
    return `<div class="card"><h2>앱 설치</h2><p class="small muted" style="margin:0">설치된 앱으로 실행 중입니다. 바탕화면·홈 화면 아이콘으로 바로 열 수 있어요.</p></div>`;
  }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return `<div class="card"><h2>앱 설치 (아이콘으로 실행)</h2>
    ${ui.installPrompt ? `<button class="btn btn-primary btn-block" type="button" data-action="install">이 기기에 설치하기</button>` : ''}
    <ul class="small muted" style="margin:${ui.installPrompt ? '12px' : '0'} 0 0;padding-left:18px">
      ${ios ? '<li><b>iPhone/iPad</b>: Safari 하단 <b>공유</b> 버튼 → <b>홈 화면에 추가</b></li>' : ''}
      <li><b>Android</b>: Chrome 메뉴(⋮) → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b></li>
      <li><b>Windows/Mac PC</b>: Chrome·Edge 주소창 오른쪽 <b>설치</b> 아이콘 → 바탕화면에 생긴 아이콘을 <b>두 번 클릭</b>해 실행</li>
    </ul>
    <p class="tiny" style="margin:8px 0 0">설치 후에도 새 버전이 나오면 앱 안에서 바로 업데이트됩니다. 다시 설치할 필요가 없어요.</p></div>`;
}

function renderSettings() {
  const y = store.getYear();
  const p = y.profile;
  const rules = getRules(store.year);
  const est = estimateSocialInsurance(p.salary || 0, rules);
  const notif = 'Notification' in window ? Notification.permission : 'unsupported';
  const info = ui.updateInfo;

  view.innerHTML = `<div class="stack">
    <div class="card" id="profile">
      <h2>내 정보 (${store.year}년)</h2>
      <p class="tiny" style="margin:-4px 0 12px">입력하면 바로 저장됩니다. 연도마다 따로 저장돼요.</p>
      ${moneyField({ key: 'salary', label: '총급여', help: '비과세 제외 연간 급여 (상여 포함)', value: p.salary, scope: 'profile' })}
      ${moneyField({ key: 'prepaidTax', label: '올해 낸 소득세 (기납부세액)', help: '선택 · 급여명세서 소득세 합계', value: p.prepaidTax, scope: 'profile', placeholder: '모르면 비워두세요' })}
      <div class="grid-2">
        ${numField('dependents', '부양가족 (본인 제외)', p.dependents, '배우자·자녀·부모 등')}
        ${numField('seniors', '그중 만 70세 이상', p.seniors)}
        ${numField('children', '기본공제 자녀 (만 20세 이하)', p.children)}
        ${numField('childrenOver8', '그중 만 8세 이상', p.childrenOver8)}
        ${numField('schoolChildren', '취학 전·초중고 자녀', p.schoolChildren, '교육비')}
        ${numField('univStudents', '대학생 (본인 제외)', p.univStudents, '교육비')}
        ${numField('disabled', '장애인 (본인 포함)', p.disabled)}
        <label class="field"><span class="label">올해 출생·입양</span>
          <select class="input" data-profile-select="newbornOrder">
            ${['없음', '첫째', '둘째', '셋째 이상'].map((t, i) => `<option value="${i}" ${Number(p.newbornOrder) === i ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
      </div>
      ${checkField('homelessHead', '무주택 세대주', p.homelessHead, '월세 세액공제·주택청약 소득공제 대상 여부')}
      ${checkField('married', '올해 혼인신고 (2024~2026년)', p.married, '생애 1회 50만 원 세액공제')}
      ${checkField('woman', '부녀자 공제 대상', p.woman)}
      ${checkField('singleParent', '한부모 공제 대상', p.singleParent)}
      <details style="margin-top:14px"><summary class="small" style="cursor:pointer">4대보험 직접 입력 (선택)</summary>
        ${moneyField({ key: 'nationalPension', label: '연간 국민연금 본인부담', value: p.nationalPension, scope: 'profile', placeholder: `자동 추정 ${comma(est.nationalPension)}` })}
        ${moneyField({ key: 'healthInsurance', label: '연간 건강·장기요양·고용보험 본인부담', value: p.healthInsurance, scope: 'profile', placeholder: `자동 추정 ${comma(est.healthInsurance)}` })}
      </details>
    </div>

    ${renderAccountCard()}
    ${renderInstallCard()}

    <div class="card">
      <h2>월간 점검 알림</h2>
      <p class="small muted" style="margin:0 0 10px">달력에 매달 반복 일정을 등록하면 앱을 열지 않아도 알림이 옵니다. (휴대폰·PC 달력 모두 지원)</p>
      <div class="row">
        <select class="input" style="max-width:140px" data-setting="reminderDay">
          ${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${store.settings.reminderDay === d ? 'selected' : ''}>매달 ${d}일</option>`).join('')}
        </select>
        <button class="btn" type="button" data-action="ics">달력에 등록</button>
      </div>
      ${notif !== 'unsupported' ? `<div class="btn-row"><button class="btn btn-sm" type="button" data-action="notify" ${notif !== 'default' ? 'disabled' : ''}>${notif === 'granted' ? '앱 알림 허용됨' : notif === 'denied' ? '앱 알림 차단됨 (브라우저 설정에서 변경)' : '앱 알림 허용'}</button></div>` : ''}
    </div>

    <div class="card" id="update">
      <h2>업데이트</h2>
      <p class="small" style="margin:0">현재 버전 <b>v${APP_VERSION}</b>${info && info.version !== APP_VERSION ? ` · 최신 <b>v${esc(info.version)}</b>` : ''}</p>
      <div class="btn-row"><button class="btn btn-sm" type="button" data-action="check-update">업데이트 확인</button></div>
      <p class="tiny" data-update-result style="margin:8px 0 0"></p>
      ${
        info?.notes?.length
          ? `<details style="margin-top:8px"><summary class="small" style="cursor:pointer">변경 내역</summary>${info.notes
              .slice(0, 5)
              .map((n) => `<p class="small" style="margin:10px 0 4px"><b>v${esc(n.version)}</b> <span class="tiny">${esc(n.date)}</span></p><ul class="small muted" style="margin:0;padding-left:18px">${n.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`)
              .join('')}</details>`
          : ''
      }
    </div>

    <div class="card">
      <h2>데이터</h2>
      <div class="btn-row" style="margin-top:0">
        <button class="btn btn-sm" type="button" data-action="export">백업 내보내기</button>
        <label class="btn btn-sm">백업 가져오기<input type="file" accept="application/json,.json" data-action="import" hidden /></label>
        <button class="btn btn-sm btn-danger" type="button" data-action="reset">${store.year}년 데이터 초기화</button>
      </div>
    </div>

    <div class="card">
      <h2>안내</h2>
      <p class="small muted" style="margin:0">${esc(rules.verifiedNote)} 이 앱은 근로소득만 있는 직장인을 기준으로 한 <b>추정 계산</b>이며 세무 자문이 아닙니다. 맞벌이 부부의 공제 배분, 종합소득·사업소득이 있는 경우 등은 결과가 다를 수 있습니다.</p>
    </div>
  </div>`;
}

// ───────────────────────── 이벤트 ─────────────────────────

view.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches('[data-money]')) {
    const d = digits(el.value);
    el.value = d ? Number(d).toLocaleString('ko-KR') : '';
    const hint = el.closest('.field')?.querySelector('[data-hint]');
    if (hint) hint.textContent = d ? `= ${man(Number(d))}` : '';
  }
});

let savedToastAt = 0;
function savedToast() {
  if (Date.now() - savedToastAt > 4000) toast('저장됨');
  savedToastAt = Date.now();
}

view.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('[data-money]')) {
    const d = digits(el.value);
    const { scope, key } = el.dataset;
    if (scope === 'month') {
      store.updateMonth(ui.month, { [key]: d ? Number(d) : 0 });
      refreshInputChrome();
    } else if (scope === 'profile') {
      const optional = ['prepaidTax', 'nationalPension', 'healthInsurance'].includes(key);
      store.updateProfile({ [key]: d ? Number(d) : optional ? null : 0 });
    } else if (scope === 'review') {
      store.updateReview({ [key]: d ? Number(d) : null });
    }
    savedToast();
  } else if (el.matches('[data-profile-num]')) {
    store.updateProfile({ [el.dataset.profileNum]: Math.max(0, Math.min(20, Number(el.value) || 0)) });
    savedToast();
  } else if (el.matches('[data-profile-check]')) {
    store.updateProfile({ [el.dataset.profileCheck]: el.checked });
    savedToast();
  } else if (el.matches('[data-profile-select]')) {
    store.updateProfile({ [el.dataset.profileSelect]: Number(el.value) });
    savedToast();
  } else if (el.matches('[data-review-field]')) {
    store.updateReview({ [el.dataset.reviewField]: el.value });
  } else if (el.matches('[data-setting="reminderDay"]')) {
    store.setSettings({ reminderDay: Number(el.value) });
  } else if (el.matches('[data-action="import"]')) {
    const file = el.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        store.importJSON(text);
        toast('백업을 가져왔어요');
        render();
      } catch (err) {
        alert(err.message);
      }
    });
  }
});

view.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.matches?.('details.group')) {
    if (d.open) ui.openGroups.add(d.dataset.group);
    else ui.openGroups.delete(d.dataset.group);
  }
}, true);

view.addEventListener('submit', async (e) => {
  if (!e.target.matches('[data-form="email"]')) return;
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await sync.signInWithEmail(String(f.get('email')), String(f.get('password')), { create: ui.authMode === 'signup' });
    toast('로그인했어요');
  } catch (err) {
    alert(err.message);
  }
});

view.addEventListener('click', async (e) => {
  const el = e.target.closest('button, [data-action]');
  if (!el) return;

  if (el.dataset.month) {
    ui.month = Number(el.dataset.month);
    history.replaceState(null, '', `#input/${ui.month}`);
    render();
    return;
  }
  if (el.dataset.review) {
    const items = { ...store.getYear().review.items };
    items[el.dataset.review] = items[el.dataset.review] === el.dataset.value ? undefined : el.dataset.value;
    store.updateReview({ items: JSON.parse(JSON.stringify(items)) });
    return;
  }

  switch (el.dataset.action) {
    case 'project':
      store.setSettings({ project: el.dataset.value === '1' });
      break;
    case 'copy-prev': {
      const y = store.getYear();
      const prev = enteredMonths(y).filter((m) => m < ui.month).at(-1);
      if (!prev) return;
      const patch = Object.fromEntries(RECURRING_KEYS.map((k) => [k, y.months[prev][k] || 0]));
      store.updateMonth(ui.month, patch);
      render();
      toast(`${prev}월 정기 납입(연금·월세·청약·보험)을 복사했어요`);
      break;
    }
    case 'mark-entered':
      store.updateMonth(ui.month, {});
      refreshInputChrome();
      toast(`${ui.month}월 입력 완료`);
      break;
    case 'google':
      try {
        await sync.signInWithGoogle();
      } catch (err) {
        alert(err.message);
      }
      break;
    case 'auth-mode':
      ui.authMode = ui.authMode === 'signup' ? 'login' : 'signup';
      render();
      break;
    case 'reset-pw': {
      const email = view.querySelector('[data-form="email"] [name="email"]').value;
      if (!email) return alert('이메일을 먼저 입력하세요.');
      try {
        await sync.resetPassword(email);
        toast('재설정 메일을 보냈어요');
      } catch (err) {
        alert(err.message);
      }
      break;
    }
    case 'sign-out':
      if (confirm('로그아웃할까요? 이 기기에 저장된 데이터는 그대로 남습니다.')) await sync.signOut();
      break;
    case 'delete-account':
      if (!confirm('계정과 클라우드에 저장된 모든 데이터를 삭제할까요? 되돌릴 수 없습니다. (이 기기의 데이터는 남습니다)')) return;
      try {
        await sync.deleteAccount();
        toast('계정을 삭제했어요');
      } catch (err) {
        alert(err.message);
      }
      break;
    case 'sync-now':
      await sync.syncNow();
      toast('동기화했어요');
      break;
    case 'install':
      if (ui.installPrompt) {
        ui.installPrompt.prompt();
        await ui.installPrompt.userChoice;
        ui.installPrompt = null;
        render();
      }
      break;
    case 'ics':
      downloadICS({ day: store.settings.reminderDay, url: location.href.split('#')[0] + '#input', year: store.year });
      toast('파일을 열어 달력에 추가하세요');
      break;
    case 'notify': {
      const r = await requestNotificationPermission();
      if (r === 'granted') toast('알림을 허용했어요');
      render();
      break;
    }
    case 'check-update': {
      const out = view.querySelector('[data-update-result]');
      out.textContent = '확인 중…';
      try {
        const res = await checkForUpdate();
        ui.updateInfo = res.info;
        out.textContent =
          res.status === 'latest' ? `최신 버전입니다 (v${APP_VERSION}).` : res.status === 'available' ? '새 버전이 준비됐어요. 위쪽 배너의 "지금 업데이트"를 누르세요.' : '새 버전을 내려받는 중이에요. 잠시 후 배너가 나타납니다.';
      } catch (err) {
        out.textContent = navigator.onLine ? err.message : '오프라인이라 확인할 수 없어요.';
      }
      break;
    }
    case 'export': {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `절세점검-백업-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'reset':
      if (confirm(`${store.year}년 데이터를 모두 지울까요? 로그인 중이면 다른 기기에서도 지워집니다.`)) {
        store.resetYear();
        render();
        toast('초기화했어요');
      }
      break;
  }
});

$('#year-select').addEventListener('change', (e) => {
  ui.month = null;
  store.setSettings({ year: Number(e.target.value) });
});

$('#sync-badge').addEventListener('click', () => {
  location.hash = '#settings/account';
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  ui.installPrompt = e;
  if (ui.tab === 'settings') scheduleRender();
});

window.addEventListener('appinstalled', () => {
  ui.installPrompt = null;
  toast('설치됐어요! 아이콘으로 실행하세요');
});

// ───────────────────────── 상태 변화 ─────────────────────────

store.subscribe(({ source }) => {
  if (source === 'local') {
    // 입력 화면은 직접 갱신하므로 다시 그리지 않음 (포커스 유지)
    if (ui.tab === 'review') render();
    return;
  }
  scheduleRender();
});

const BADGE = { disabled: '이 기기', 'signed-out': '로그인 안 됨', syncing: '동기화 중', synced: '동기화됨', offline: '오프라인', error: '동기화 오류' };
sync.onSyncStatus((s) => {
  const prevUser = ui.syncState.user?.uid;
  ui.syncState = s;
  const b = $('#sync-badge');
  b.textContent = BADGE[s.status] || s.status;
  b.dataset.status = s.status;
  if (ui.tab === 'settings' && (prevUser !== s.user?.uid || s.status === 'error' || s.status === 'signed-out')) scheduleRender();
});

function showUpdateBanner(info) {
  ui.updateInfo = info || ui.updateInfo;
  const banner = $('#update-banner');
  $('#update-title').textContent = info?.version ? `새 버전 v${info.version}이 있어요` : '새 버전이 있어요';
  $('#update-notes').textContent = info?.notes?.[0]?.changes?.slice(0, 2).join(' · ') || '업데이트하면 최신 세법과 기능이 반영됩니다.';
  banner.hidden = false;
}

$('#update-apply').addEventListener('click', () => {
  $('#update-apply').disabled = true;
  $('#update-apply').textContent = '적용 중…';
  applyUpdate();
});

// ───────────────────────── 시작 ─────────────────────────

window.addEventListener('hashchange', route);
route();
initUpdater({ onUpdateAvailable: showUpdateBanner });
sync.initSync();
fetchRemoteVersion()
  .then((info) => {
    ui.updateInfo = info;
  })
  .catch(() => {});
