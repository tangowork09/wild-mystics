#!/usr/bin/env node
// Headless screenshot harness for visual verification.
//   node tools/shot.mjs <outName> "<query>" [waitMs=6000] [WxH=1440x900] [--mobile]
// Writes PNG to $SHOT_DIR (default ./.shots) and prints console errors.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [name = 'shot', query = '', waitArg = '6000', size = '1440x900', ...flags] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const dir = process.env.SHOT_DIR ?? path.resolve('.shots');
fs.mkdirSync(dir, { recursive: true });
const mobile = flags.includes('--mobile');

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.type() === 'warn') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const url = `http://localhost:5180/?shot=1${query ? '&' + query : ''}`;
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('loading') || document.getElementById('loading').classList.contains('out') || !!document.querySelector('.auth-screen.in'), { timeout: 120000 }).catch(() => errors.push('loading timeout'));
const loadMs = Date.now() - t0;
// optional scripted steps: STEPS env = JSON [{wait: ms} | {key: 'e'} | {eval: 'js'} | {shot: 'suffix'}]
const steps = process.env.STEPS ? JSON.parse(process.env.STEPS) : [];
await new Promise((r) => setTimeout(r, Number(waitArg)));
for (const s of steps) {
  if (s.wait) await new Promise((r) => setTimeout(r, s.wait));
  if (s.key) await page.keyboard.press(s.key);
  if (s.down) await page.keyboard.down(s.down);
  if (s.up) await page.keyboard.up(s.up);
  if (s.click) await page.mouse.click(s.click[0], s.click[1]);
  if (s.eval) await page.evaluate(s.eval);
  if (s.shot) await page.screenshot({ path: path.join(dir, `${name}-${s.shot}.png`) });
}
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
await page.screenshot({ path: path.join(dir, `${name}.png`) });
console.log(JSON.stringify({ name, loadMs, fps, errors: errors.slice(0, 20) }, null, 1));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 4000))]);
process.exit(0);
