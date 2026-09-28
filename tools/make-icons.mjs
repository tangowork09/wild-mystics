#!/usr/bin/env node
// App icons (PWA + Capacitor sources) composed from a baked portrait: dark arcane disc, gold ring, Mystic.
//   node tools/make-icons.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/manifest.json'), 'utf8'));
const hero = path.join(ROOT, 'public/assets', manifest.creatures.emberling.portrait);

async function icon(size, { maskable = false, bg = true } = {}) {
  const S = 1024;
  const inset = maskable ? 0.2 : 0.06;           // maskable icons keep art inside the 80% safe zone
  const r = S / 2 - S * inset;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
    <defs>
      <radialGradient id="g" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#3a2a52"/><stop offset="0.55" stop-color="#1c1528"/><stop offset="1" stop-color="#0d0b12"/></radialGradient>
      <radialGradient id="glow" cx="50%" cy="48%" r="50%"><stop offset="0" stop-color="#ff9a4a" stop-opacity="0.55"/><stop offset="1" stop-color="#ff9a4a" stop-opacity="0"/></radialGradient>
      <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0c0"/><stop offset="0.5" stop-color="#d9b56d"/><stop offset="1" stop-color="#8a6a2a"/></linearGradient>
    </defs>
    ${bg ? `<rect width="${S}" height="${S}" rx="${maskable ? 0 : S * 0.22}" fill="url(#g)"/>` : ''}
    <circle cx="${S / 2}" cy="${S / 2}" r="${r * 0.86}" fill="url(#glow)"/>
    <circle cx="${S / 2}" cy="${S / 2}" r="${r * 0.9}" fill="none" stroke="url(#ring)" stroke-width="${S * 0.022}"/>
    <circle cx="${S / 2}" cy="${S / 2}" r="${r * 0.8}" fill="none" stroke="#d9b56d" stroke-opacity="0.35" stroke-width="${S * 0.006}"/>
    ${[0, 90, 180, 270].map((a) => `<rect x="${-S * 0.022}" y="${-S * 0.022}" width="${S * 0.044}" height="${S * 0.044}" fill="#f4dc9c" transform="rotate(${a} ${S / 2} ${S / 2}) translate(${S / 2} ${S / 2 - r * 0.9}) rotate(45)"/>`).join('')}
  </svg>`;
  const art = await sharp(hero).resize(Math.round(r * 1.5), Math.round(r * 1.5)).png().toBuffer();
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const full = await sharp(base).composite([{ input: art, gravity: 'center' }]).png().toBuffer(); // sharp resizes before compositing, so do it in two passes
  return sharp(full).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

const out = (p, b) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, b); console.log('wrote', path.relative(ROOT, p)); };
out(path.join(ROOT, 'public/icons/icon-192.png'), await icon(192));
out(path.join(ROOT, 'public/icons/icon-512.png'), await icon(512));
out(path.join(ROOT, 'public/icons/icon-maskable-512.png'), await icon(512, { maskable: true }));
out(path.join(ROOT, 'public/icons/apple-touch-icon.png'), await icon(180, { maskable: true }));
out(path.join(ROOT, 'public/icons/favicon-32.png'), await icon(32));
// Capacitor asset sources (npx @capacitor/assets generate)
out(path.join(ROOT, 'resources/icon-only.png'), await icon(1024, { maskable: true }));
out(path.join(ROOT, 'resources/icon-foreground.png'), await icon(1024, { maskable: true, bg: false }));
const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><radialGradient id="g" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#3a2a52"/><stop offset="0.55" stop-color="#1c1528"/><stop offset="1" stop-color="#0d0b12"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#g)"/></svg>`;
out(path.join(ROOT, 'resources/icon-background.png'), await sharp(Buffer.from(bgSvg)).png().toBuffer());
const splash = async (w, h) => {
  const logo = await icon(Math.round(Math.min(w, h) * 0.34), { maskable: true, bg: false });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2a2036"/><stop offset="0.6" stop-color="#120e18"/><stop offset="1" stop-color="#0d0b12"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
};
out(path.join(ROOT, 'resources/splash.png'), await splash(2732, 2732));
out(path.join(ROOT, 'resources/splash-dark.png'), await splash(2732, 2732));
