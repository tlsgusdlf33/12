// 로컬 저장소. 모든 데이터는 먼저 이 기기(localStorage)에 저장되고,
// 로그인한 경우 sync.js 가 클라우드와 병합한다. (오프라인에서도 동작)

import { emptyYear, emptyMonth } from './core/fields.js';

const KEY = 'taxcheck:v1';
const listeners = new Set();

function defaultState() {
  return {
    years: {},
    settings: { year: new Date().getFullYear(), project: true, reminderDay: 5, lastNotified: '' },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...parsed.settings } };
  } catch {
    return defaultState();
  }
}

let state = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('로컬 저장 실패', e);
  }
}

function emit(source, year) {
  for (const fn of listeners) fn({ source, year });
}

export const store = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  get settings() {
    return state.settings;
  },

  get year() {
    return Number(state.settings.year);
  },

  getYear(year = this.year) {
    if (!state.years[year]) state.years[year] = emptyYear(year);
    return state.years[year];
  },

  hasYear(year) {
    return Boolean(state.years[year]);
  },

  setSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    persist();
    emit('settings', this.year);
  },

  updateProfile(patch) {
    const y = this.getYear();
    y.profile = { ...y.profile, ...patch, updatedAt: Date.now() };
    persist();
    emit('local', y.year);
  },

  updateMonth(month, patch) {
    const y = this.getYear();
    y.months[month] = { ...emptyMonth(), ...y.months[month], ...patch, cleared: false, updatedAt: Date.now() };
    persist();
    emit('local', y.year);
  },

  updateReview(patch) {
    const y = this.getYear();
    y.review = { ...y.review, ...patch, updatedAt: Date.now() };
    persist();
    emit('local', y.year);
  },

  updatePlan(patch) {
    const y = this.getYear();
    y.plan = { done: {}, ...y.plan, ...patch, updatedAt: Date.now() };
    persist();
    emit('local', y.year);
  },

  // 동기화로 받은 데이터 반영 (sync.js 전용)
  replaceYear(yearData, source = 'remote') {
    state.years[yearData.year] = yearData;
    persist();
    emit(source, yearData.year);
  },

  exportJSON() {
    return JSON.stringify({ app: 'taxcheck', exportedAt: new Date().toISOString(), years: state.years }, null, 2);
  },

  importJSON(text) {
    const data = JSON.parse(text);
    if (data.app !== 'taxcheck' || typeof data.years !== 'object') throw new Error('이 앱의 백업 파일이 아닙니다.');
    const now = Date.now();
    // 가져온 데이터가 클라우드 데이터보다 우선하도록 시각을 갱신
    for (const y of Object.values(data.years)) {
      if (y.profile) y.profile.updatedAt = now;
      if (y.review) y.review.updatedAt = now;
      for (const m of Object.values(y.months || {})) if (m.updatedAt) m.updatedAt = now;
      state.years[y.year] = y;
    }
    persist();
    emit('local', this.year);
  },

  resetYear() {
    const year = this.year;
    const fresh = emptyYear(year);
    const now = Date.now();
    // 빈 값에도 최신 시각을 찍어야 다른 기기에도 초기화가 전파된다
    fresh.profile.updatedAt = now;
    fresh.review.updatedAt = now;
    fresh.plan.updatedAt = now;
    for (const m of Object.keys(this.getYear().months)) fresh.months[m] = { ...emptyMonth(), updatedAt: now, cleared: true };
    state.years[year] = fresh;
    persist();
    emit('local', year);
  },
};
