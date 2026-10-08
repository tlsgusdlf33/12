// 세법 설정 로더. 수치는 app/rules/{연도}.yaml 에만 있고, 이 파일은 읽고 합치기만 한다.
// 브라우저는 fetch, Node(테스트·월간 리포트)는 파일 읽기 함수를 넘겨 같은 코드로 불러온다.

import { load as parseYaml } from '../../vendor/js-yaml.mjs';

const raw = {}; // 연도 → YAML 원본 객체
const resolved = {}; // 연도 → extends 를 반영한 최종 규칙

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

function resolve(year, seen = new Set()) {
  if (resolved[year]) return resolved[year];
  const r = raw[year];
  if (!r) throw new Error(`${year}년 세법 설정이 없습니다.`);
  if (seen.has(year)) throw new Error(`세법 설정 extends 가 순환합니다: ${[...seen, year].join(' → ')}`);
  seen.add(year);
  const { extends: parent, ...rest } = r;
  const merged = parent ? deepMerge(resolve(parent, seen), rest) : rest;
  // 상속받은 연도의 검토 상태는 물려받지 않는다
  merged.meta = { ...merged.meta, status: r.meta?.status ?? 'draft', reviewedAt: r.meta?.reviewedAt ?? null, uncertain: r.meta?.uncertain ?? [] };
  merged.year = Number(year);
  merged.verifiedNote = merged.meta.note;
  resolved[year] = merged;
  return merged;
}

export function registerRulesYaml(text) {
  const obj = parseYaml(text);
  if (!obj?.year) throw new Error('세법 설정 파일에 year 가 없습니다.');
  raw[obj.year] = obj;
  for (const k of Object.keys(resolved)) delete resolved[k];
  return obj.year;
}

// readText(경로) → 문자열. 기본은 브라우저 fetch (오프라인이면 서비스 워커 캐시에서).
export async function loadRules(readText = (p) => fetch(p).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${p} ${r.status}`)))), base = 'rules/') {
  const index = JSON.parse(await readText(`${base}index.json`));
  const texts = await Promise.all(index.years.map((y) => readText(`${base}${y}.yaml`)));
  texts.forEach(registerRulesYaml);
  for (const y of Object.keys(raw)) resolve(y); // 잘못된 설정은 시작할 때 바로 드러나게
  return supportedYears();
}

export function supportedYears() {
  return Object.keys(raw)
    .map(Number)
    .sort((a, b) => b - a);
}

export function getRules(year) {
  if (raw[year]) return resolve(year);
  const latest = supportedYears()[0];
  if (latest == null) throw new Error('세법 설정을 아직 불러오지 않았습니다 (loadRules 필요).');
  return { ...resolve(latest), year: Number(year), fallbackFrom: latest };
}
