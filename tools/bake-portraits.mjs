#!/usr/bin/env node
// Renders every species portrait (normal + shiny) from the real 3D rigs and saves them as WebP,
// so menus, the dex and gacha never need to load 3D models. Needs the dev server on :5180.
//   node tools/bake-portraits.mjs
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/assets/portraits');
const MANIFEST = path.join(ROOT, 'public/assets/manifest.json');
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto('http://localhost:5180/?view=portraits&noportrait=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, { timeout: 240000 });
const shots = await page.evaluate(() => window.__portraits);
await browser.close();

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let n = 0;
for (const [key, url] of Object.entries(shots)) {
  if (!url) continue;
  const shiny = key.endsWith('*');
  const id = key.replace('*', '');
  const file = `${id}${shiny ? '_shiny' : ''}.webp`;
  await sharp(Buffer.from(url.split(',')[1], 'base64')).resize(192, 192).webp({ quality: 86, alphaQuality: 90 }).toFile(path.join(OUT, file));
  manifest.creatures[id] ??= {};
  manifest.creatures[id][shiny ? 'portraitShiny' : 'portrait'] = `portraits/${file}`;
  n++;
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`✓ baked ${n} portraits → public/assets/portraits`);
