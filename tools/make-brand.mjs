#!/usr/bin/env node
// Brand art → every shipped size: favicons, PWA + Capacitor icons, splash, logo and key art.
//   node tools/make-brand.mjs
// Sources live in resources/brand/*-src.png (the original generated art). logo.png there is the
// transparent cut-out of logo-src.png (its "transparent" background was a baked-in checkerboard).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = (f) => path.join(ROOT, 'resources/brand', f);
const out = (p, b) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, b); console.log('wrote', path.relative(ROOT, p), `${Math.round(b.length / 1024)} KB`); };

// The two icon sources are rounded squares on black corners. Cut them to a clean rounded square,
// or fill the corners with the icon's own violet for full-bleed platforms (iOS, maskable, Android).
const S = 1024;
const RADIUS = Math.round(S * 0.205);
const roundMask = (inset = 6) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect x="${inset}" y="${inset}" width="${S - inset * 2}" height="${S - inset * 2}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`);

async function rounded(file) {
  const base = await sharp(SRC(file)).resize(S, S).png().toBuffer();
  return sharp(base).composite([{ input: roundMask(), blend: 'dest-in' }]).png().toBuffer();
}
async function edgeColour(roundBuf) {
  // average of a ring just inside the rounded edge = the icon's background violet
  const { data, info } = await sharp(roundBuf).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < info.height; y += 4) for (let x = 0; x < info.width; x += 4) {
    const d = Math.min(x, y, info.width - 1 - x, info.height - 1 - y);
    if (d < 18 || d > 34) continue;
    const o = (y * info.width + x) * 4;
    if (data[o + 3] < 250) continue;
    r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), alpha: 1 };
}
async function fullBleed(roundBuf, bg, scale = 1.06) {
  const z = Math.round(S * scale), off = Math.round((z - S) / 2);
  const zoomed = await sharp(roundBuf).resize(z, z).extract({ left: off, top: off, width: S, height: S }).png().toBuffer();
  return sharp({ create: { width: S, height: S, channels: 4, background: bg } }).composite([{ input: zoomed }]).png().toBuffer();
}
async function padded(roundBuf, bg, frac) { // art inside a safe zone (maskable / adaptive foreground)
  const a = Math.round(S * frac);
  const art = await sharp(roundBuf).resize(a, a).png().toBuffer();
  return sharp({ create: { width: S, height: S, channels: 4, background: bg } }).composite([{ input: art, gravity: 'center' }]).png().toBuffer();
}
const png = (buf, size) => sharp(buf).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
const clear = { r: 0, g: 0, b: 0, alpha: 0 };

// ── favicon: the paw-in-orb mark (reads at 16 px) ───────────────────────────
const paw = await rounded('favicon-src.png');
out(path.join(ROOT, 'public/icons/favicon-16.png'), await png(paw, 16));
out(path.join(ROOT, 'public/icons/favicon-32.png'), await png(paw, 32));
out(path.join(ROOT, 'public/icons/favicon-48.png'), await png(paw, 48));

// ── app icon: the dragon hugging the orb ────────────────────────────────────
const dragon = await rounded('appicon-src.png');
const violet = await edgeColour(dragon);
const dragonFull = await fullBleed(dragon, violet);
out(path.join(ROOT, 'public/icons/icon-192.png'), await png(dragon, 192));
out(path.join(ROOT, 'public/icons/icon-512.png'), await png(dragon, 512));
out(path.join(ROOT, 'public/icons/icon-maskable-512.png'), await png(await padded(dragon, violet, 0.84), 512));
out(path.join(ROOT, 'public/icons/apple-touch-icon.png'), await png(dragonFull, 180));

// Capacitor sources (npx @capacitor/assets generate): full-bleed icon + adaptive layers + splash
out(path.join(ROOT, 'resources/icon-only.png'), await png(dragonFull, 1024));
out(path.join(ROOT, 'resources/icon-foreground.png'), await png(await padded(dragon, clear, 0.64), 1024));
out(path.join(ROOT, 'resources/icon-background.png'), await sharp({ create: { width: S, height: S, channels: 4, background: violet } }).png().toBuffer());

const logo = SRC('logo.png');
async function splash(w, h) {
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><radialGradient id="g" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="#3a1d6e"/><stop offset="0.55" stop-color="#1a0f33"/><stop offset="1" stop-color="#0b0716"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`);
  const lw = Math.round(Math.min(w, h) * 0.5);
  const lg = await sharp(logo).resize({ width: lw }).png().toBuffer();
  return sharp(bg).composite([{ input: lg, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer();
}
out(path.join(ROOT, 'resources/splash.png'), await splash(2732, 2732));
out(path.join(ROOT, 'resources/splash-dark.png'), await splash(2732, 2732));

// ── in-game brand art (bundled by Vite from src/assets/brand) ───────────────
const B = (f) => path.join(ROOT, 'src/assets/brand', f);
out(B('logo.webp'), await sharp(logo).resize({ width: 1100 }).webp({ quality: 90, alphaQuality: 90 }).toBuffer());
out(B('keyart.webp'), await sharp(SRC('keyart-src.png')).resize({ width: 1672 }).webp({ quality: 82 }).toBuffer());
out(B('keyart-portrait.webp'), await sharp(SRC('loading-portrait-src.png')).resize({ width: 1024 }).webp({ quality: 80 }).toBuffer());
out(B('banner.webp'), await sharp(SRC('banner-src.png')).resize({ width: 2048 }).webp({ quality: 82 }).toBuffer());

// Store / README art (not shipped in the app)
out(path.join(ROOT, 'docs/brand/feature-graphic-1024x500.png'), await sharp(SRC('banner-src.png')).resize(1024, 500, { fit: 'cover', position: 'right' }).png().toBuffer());
out(path.join(ROOT, 'docs/brand/keyart-1920x1080.jpg'), await sharp(SRC('keyart-src.png')).resize(1920, 1080, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer());
out(path.join(ROOT, 'docs/brand/logo-transparent.png'), await sharp(logo).png({ compressionLevel: 9 }).toBuffer());
console.log('icon violet', violet);
