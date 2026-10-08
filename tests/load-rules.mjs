// 테스트·스크립트에서 app/rules/*.yaml 을 파일로 읽어 등록한다.
import { readFile } from 'node:fs/promises';
import { loadRules } from '../app/js/core/rules.js';

export const rulesReady = loadRules((p) => readFile(new URL(`../app/${p}`, import.meta.url), 'utf8'));
