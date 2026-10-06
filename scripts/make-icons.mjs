// app/icons/icon.svg 로 PNG 아이콘(192, 512, maskable)을 만든다.
// 사용: npm run icons   (Playwright 의 Chromium 필요)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = await readFile(path.join(root, 'app/icons/icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable ? Math.round(size * 0.8) : size;
  const bg = maskable ? '#3b6ff5' : 'transparent';
  await page.setContent(
    `<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: path.join(root, 'app/icons', file), omitBackground: !maskable });
}

await shot(192, 'icon-192.png');
await shot(512, 'icon-512.png');
await shot(512, 'maskable-512.png', { maskable: true });
await browser.close();
console.log('아이콘 생성 완료');
