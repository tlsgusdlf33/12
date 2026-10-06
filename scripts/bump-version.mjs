// 새 버전 배포 준비: 버전 번호를 한 번에 올린다.
// 사용: npm run bump -- 1.1.0 "변경 내용 1" "변경 내용 2"
//      npm run bump -- patch "세법 수치 수정"      (major | minor | patch 도 가능)
// 갱신 파일: app/version.json, app/js/version.js, app/sw.js, package.json
// 이후 커밋·푸시하면 배포되고, 사용자 앱에 "새 버전" 배너가 뜬다.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const p = (f) => path.join(root, f);

const [arg, ...changes] = process.argv.slice(2);
if (!arg) {
  console.error('사용법: npm run bump -- <버전|major|minor|patch> "변경 내용" ...');
  process.exit(1);
}

const info = JSON.parse(await readFile(p('app/version.json'), 'utf8'));
const [ma, mi, pa] = info.version.split('.').map(Number);
const next =
  arg === 'major' ? `${ma + 1}.0.0` : arg === 'minor' ? `${ma}.${mi + 1}.0` : arg === 'patch' ? `${ma}.${mi}.${pa + 1}` : arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`버전 형식이 올바르지 않습니다: ${next}`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
info.version = next;
info.date = date;
info.notes = [{ version: next, date, changes: changes.length ? changes : ['개선 및 버그 수정'] }, ...(info.notes || [])].slice(0, 30);
await writeFile(p('app/version.json'), JSON.stringify(info, null, 2) + '\n');

async function replace(file, re, value) {
  const src = await readFile(p(file), 'utf8');
  if (!re.test(src)) throw new Error(`${file} 에서 버전 문자열을 찾지 못했습니다.`);
  await writeFile(p(file), src.replace(re, value));
}

await replace('app/js/version.js', /APP_VERSION = '[^']*'/, `APP_VERSION = '${next}'`);
await replace('app/sw.js', /const VERSION = '[^']*'/, `const VERSION = '${next}'`);
await replace('package.json', /"version": "[^"]*"/, `"version": "${next}"`);

console.log(`v${next} 준비 완료. 커밋 후 푸시하면 배포됩니다.`);
