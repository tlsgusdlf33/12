// 기기 간 동기화 병합. 섹션(내 정보 / 월별 / 작년 점검) 단위로 updatedAt 이 최신인 쪽을 채택한다.
// 같은 달을 두 기기에서 동시에 고치는 경우가 아니면 데이터가 사라지지 않는다.

import { emptyYear } from './fields.js';

const newer = (a, b) => ((b?.updatedAt || 0) > (a?.updatedAt || 0) ? b : a);

export function mergeYear(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  const year = local.year ?? remote.year;
  const base = emptyYear(year);
  const months = {};
  const keys = new Set([...Object.keys(local.months || {}), ...Object.keys(remote.months || {})]);
  for (const k of keys) {
    const picked = newer(local.months?.[k], remote.months?.[k]);
    if (picked) months[k] = picked;
  }
  return {
    year,
    profile: { ...base.profile, ...newer(local.profile, remote.profile) },
    months,
    review: { ...base.review, ...newer(local.review, remote.review) },
    plan: { ...base.plan, ...newer(local.plan, remote.plan) },
  };
}

export function lastUpdated(yearData) {
  if (!yearData) return 0;
  return Math.max(
    yearData.profile?.updatedAt || 0,
    yearData.review?.updatedAt || 0,
    yearData.plan?.updatedAt || 0,
    ...Object.values(yearData.months || {}).map((m) => m.updatedAt || 0),
  );
}

// 키 순서와 무관하게 비교 (Firestore 는 맵 키 순서를 보장하지 않는다)
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .filter((k) => v[k] !== undefined && k !== 'syncedAt')
        .sort()
        .map((k) => [k, stable(v[k])]),
    );
  }
  return v;
}

export function sameData(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
