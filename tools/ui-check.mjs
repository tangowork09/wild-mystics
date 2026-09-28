#!/usr/bin/env node
// UI no-scroll + fit checker (v3:ui). Loads the game once per viewport and opens every UI surface,
// then fails if ANY element has overflow auto/scroll with scrollHeight > clientHeight + 2 (or the
// same horizontally), or if an interactive control of the open surface sits outside the viewport.
// Also screenshots each surface into $SHOT_DIR/<size>/<surface>.png.
//
//   SHOT_PORT=5183 node tools/ui-check.mjs [--sizes=1440x900,1280x720,844x390m,740x360m] [--only=team,dex] [--no-shots]
//   (a trailing "m" on a size emulates a touch phone)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=')[1];
const SIZES = arg('sizes', '1440x900,1280x720,844x390m,740x360m').split(',');
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const SHOTS = !process.argv.includes('--no-shots');
const PORT = process.env.SHOT_PORT ?? 5183;
const OUT = process.env.SHOT_DIR ?? path.resolve('.shots/ui/check');
const BASE = `http://localhost:${PORT}/?shot=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── in-page probes ─────────────────────────────────────────────────────────
function probe(scopeSel) {
  const scroll = [], off = [], clip = [];
  const desc = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`;
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01; };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const sy = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    const sx = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    if ((sy && el.scrollHeight > el.clientHeight + 2) || (sx && el.scrollWidth > el.clientWidth + 2)) {
      if (el.matches('input, textarea, select')) continue; // typed free text is the only exception
      scroll.push(`${desc(el)} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
    }
  }
  const scope = scopeSel ? [...document.querySelectorAll(scopeSel)] : [document.body];
  const W = innerWidth, H = innerHeight;
  for (const root of scope) {
    for (const el of root.querySelectorAll('button, [role=button], input, select, a[href], .btn')) {
      if (!visible(el) || el.closest('.pg-view .pg-grid.slide-l, .pg-view .pg-grid.slide-r')) continue;
      if (el.closest('[aria-hidden=true], .hud-touch .hide, .hide')) continue;
      const r = el.getBoundingClientRect();
      if (r.right < 1 || r.bottom < 1 || r.left > W - 1 || r.top > H - 1 || r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2) off.push(`${desc(el)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28)}" @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      // clipped by an overflow:hidden ancestor (unreachable)
      let p = el.parentElement;
      while (p && p !== root.parentElement) {
        const pcs = getComputedStyle(p);
        if ((pcs.overflowY === 'hidden' || pcs.overflowX === 'hidden' || pcs.overflow === 'clip') && !p.matches('.pg-cell, .pg-view, .ell, .cap, .sf-card')) {
          const pr = p.getBoundingClientRect();
          if (r.bottom > pr.bottom + 3 || r.top < pr.top - 3 || r.right > pr.right + 3 || r.left < pr.left - 3) { clip.push(`${desc(el)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" clipped by ${desc(p)}`); break; }
        }
        p = p.parentElement;
      }
    }
  }
  return { scroll, off: [...new Set(off)].slice(0, 12), clip: [...new Set(clip)].slice(0, 12) };
}

// ── surfaces ───────────────────────────────────────────────────────────────
const J = (tab) => ({ name: tab, open: `__ui.journal('${tab}')`, scope: '.journal', close: 'Escape' });
const WORLD = [
  { name: 'hud', open: '', scope: '.hud', close: '' },
  ...['team', 'dex', 'bag', 'relics', 'quests', 'achievements', 'map', 'summon', 'profile', 'settings'].map(J),
  { name: 'svc-healer', open: `__ui.service('healer')`, scope: '.modal', close: 'Escape' },
  { name: 'svc-shop', open: `__ui.service('shop')`, scope: '.modal', close: 'Escape' },
  { name: 'shop-merchant', open: `__ui.openShop('merchant', { zone: __ui.zone() })`, scope: '.modal', close: 'Escape' },
  { name: 'svc-hatchery', open: `__ui.service('hatchery')`, scope: '.modal', close: 'Escape' },
  { name: 'svc-shrine', open: `__ui.service('shrine')`, scope: '.modal', close: 'Escape' },
  { name: 'svc-tutor', open: `__ui.service('tutor')`, scope: '.modal', close: 'Escape' },
  { name: 'svc-board', open: `__ui.service('quests')`, scope: '.modal', close: 'Escape' },
  { name: 'starter', open: `__ui.screens.chooseStarter({ host: 'Elder Maple' })`, scope: '.starter-screen', close: 'remove:.starter-screen' },
  { name: 'dialog', open: `__ui.screens.dialog({ name: 'Warden Brisa', title: 'Hearthwick Guard', face: 'warden_brisa', lines: ['No Mystic? The wilds will eat you alive. Come on, Elder Maple will know what to do with you.'], choices: ['Lead the way', 'I can manage on my own'] })`, scope: '.dialog-box', close: 'Escape', wait: 1600 },
  { name: 'daily', open: `__ui.screens.dailyLogin()`, scope: '.modal', close: 'Escape' },
  { name: 'guide', open: `__ui.screens.guide(document.documentElement.classList.contains('touch'))`, scope: '.modal', close: 'Escape' },
  { name: 'pause', open: `__ui.screens.pause({ name: 'Wayfarer', rank: 3, day: 4, sync: 'Saved on this device' })`, scope: '.modal', close: 'Escape' },
  { name: 'levelup', open: `__ui.screens.levelUp({ kind: 'rank', level: 4, title: 'Trail Scout', sub: 'New title unlocked. Shops now stock Radiant Orbs.' })`, scope: '.cine', close: 'Escape' },
  { name: 'rewards', open: `__ui.screens.rewards({ title: 'Quest complete', sub: 'Herbs for the Healer', reward: { gold: 150, aether: 20, items: { mega_tonic: 1 }, orbs: { radiant: 2 } } })`, scope: '.cine', close: 'Escape' },
  { name: 'fishing', open: `__ui.screens.fishing()`, scope: '.fishing', close: 'Escape' },
  { name: 'evolution', open: `__ui.screens.evolution(__state.team[1], 'gloop', 'spikegloop')`, scope: '.cine', close: 'remove:.cine', wait: 4800 },
  { name: 'hatch', open: `__ui.screens.hatch(__state.team[2])`, scope: '.cine', close: 'remove:.cine', wait: 3400 },
  { name: 'build', open: `__ui.builder.enter()`, scope: '.build-ui', close: 'eval:__ui.builder.exit()' },
  { name: 'homestead', open: `__ui.builder.openOverview()`, scope: '.modal', close: 'Escape' },
  { name: 'loading', open: `__ui.screens.loading('Gathering supplies…', 0.42)`, scope: '#loading', close: 'remove:#loading' },
];

// A lived-in save so lists have something to page through.
const SEED = `(() => {
  const s = __state, C = __creature;
  const ids = ['sporelet','finnik','emberling','gloop','chirpling','pecklet','zapbee','glub','croakus','thornet','dustclaw','impling','clacker','whirlie','gloomling','cogling','shadekin','grunt','spikegloop','glenhart'];
  for (let i = 0; i < 26; i++) { const id = ids[i % ids.length]; try { const c = C.createCreature(id, 3 + (i % 9), { shiny: i === 5 }); s.box.push(c); s.dex[id] = { seen: true, caught: 1, shiny: i === 5, zones: ['vale'] }; } catch {} }
  for (const id of ['sandgloop','abyssal_tyrant','deepcaller','ember_totem']) s.dex[id] = { seen: true, caught: 0, shiny: false, zones: [] };
  s.inv.orbs.mystic = 12; s.inv.orbs.radiant = 3; s.inv.orbs.dusk = 2;
  Object.assign(s.inv.items, { tonic: 6, mega_tonic: 2, elixir: 1, ether: 3, cleanse: 2, lure_incense: 1, wisdom_scroll: 1, leaf_stone: 1 });
  Object.assign(s.inv.materials, { wood: 34, stone: 21, ore: 6, crystal: 2, fiber: 17 });
  s.inv.aether = 1240; s.inv.tickets = 3; s.inv.essence = 45;
  const rel = ['warrior_band','iron_carapace','heart_of_oak','swift_boots','scholar_lens','binders_knot','ember_charm'];
  rel.forEach((id, i) => s.relics.push({ uid: 'r' + i, id, level: 1 + (i % 3) }));
  s.eggs.push({ uid: 'e1', species: 'gloop', genes: { hp: 9, atk: 8, def: 7, spd: 10 }, parents: ['?','?'], stepsLeft: 140, stepsTotal: 220 });
  s.base.structures.push({ uid: 's1', type: 'lumber_mill', x: 120, z: 604, rot: 0, level: 2, lastCollect: Date.now() - 3.6e6, assigned: [] }, { uid: 's2', type: 'quarry', x: 128, z: 616, rot: 0, level: 1, lastCollect: Date.now() - 1.8e6, assigned: [] });
  s.waypoints.push('vale-town', 'vale-camp');
  s.stats.catches = 27; s.stats.wins = 41; s.stats.perfects = 88; s.stats.parries = 36;
})()`;

async function runSize(browser, spec) {
  const mobile = spec.endsWith('m');
  const [W, H] = spec.replace('m', '').split('x').map(Number);
  const dir = path.join(OUT, spec);
  if (SHOTS) fs.mkdirSync(dir, { recursive: true });
  const report = {};
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  const load = async (q, ready) => {
    await page.goto(`${BASE}&${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(ready, { timeout: 120000 }).catch(() => errors.push(`timeout waiting for ${q}`));
  };
  const check = async (name, scope) => {
    if (ONLY && !ONLY.has(name)) return;
    const r = await page.evaluate(probe, scope);
    report[name] = r;
    if (SHOTS) await page.screenshot({ path: path.join(dir, `${name}.png`) });
  };

  // world surfaces
  await load('auto=world&fresh&mock=all', () => window.__ready === true);
  await page.evaluate(SEED);
  await sleep(2500);
  for (const s of WORLD) {
    if (ONLY && !ONLY.has(s.name)) continue;
    if (s.open) await page.evaluate(`void (${s.open})`);
    await sleep(s.wait ?? 900);
    await check(s.name, s.scope);
    if (s.close === 'Escape') { await page.keyboard.press('Escape'); await sleep(120); await page.keyboard.press('Escape'); }
    else if (s.close.startsWith('remove:')) await page.evaluate((sel) => document.querySelectorAll(sel).forEach((e) => e.remove()), s.close.slice(7));
    else if (s.close.startsWith('eval:')) await page.evaluate(s.close.slice(5));
    await sleep(350);
    await page.evaluate(() => document.querySelectorAll('#ui > .modal, #ui > .cine, #ui > .fishing, #ui > .pop').forEach((e) => e.remove()));
  }

  // battle
  if (!ONLY || ONLY.has('battle') || ONLY.has('battle-skills') || ONLY.has('battle-results')) {
    await load('auto=battle&sp=gloop,sporelet&lv=4&mock=all', () => !!document.querySelector('.b-actions.open'));
    await sleep(600);
    await check('battle', '.battle-ui');
    await page.keyboard.press('2');
    await sleep(500);
    await check('battle-skills', '.battle-ui');
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.evaluate(() => { const g = window.__game; const st = window.__state; void g.battle.ui.results({ title: 'Victory', sub: 'Wild Gloop defeated', xp: 128, gold: 64, shards: [['water', 3], ['nature', 2]], team: st.team.slice(0, 3).map((c, i) => ({ c, beforeLv: c.level - (i === 0 ? 1 : 0), beforeXp: 5, newSkills: i === 0 ? ['Bubble Burst'] : [] })), captured: [st.team[1]], drops: ['tonic'] }); });
    await sleep(900);
    await check('battle-results', '.b-results');
  }

  // auth + title (no auto → sign-in; ?guest → title)
  if (!ONLY || ONLY.has('auth') || ONLY.has('auth-signup')) {
    const ctx = await browser.createBrowserContext();
    const p2 = await ctx.newPage();
    await p2.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p2.waitForFunction(() => !!document.querySelector('.auth-screen.in'), { timeout: 120000 }).catch(() => errors.push('auth timeout'));
    await sleep(700);
    const pageBak = page;
    report.auth = await p2.evaluate(probe, '.auth-screen');
    if (SHOTS) await p2.screenshot({ path: path.join(dir, 'auth.png') });
    await p2.evaluate(() => (document.querySelector('[data-mode=signin]') ?? document.querySelector('[data-mode=signup]'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await p2.evaluate(() => { const b = [...document.querySelectorAll('[data-mode]')].find((x) => !x.classList.contains('on')); b?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await sleep(500);
    report['auth-alt'] = await p2.evaluate(probe, '.auth-screen');
    if (SHOTS) await p2.screenshot({ path: path.join(dir, 'auth-alt.png') });
    await ctx.close();
    void pageBak;
  }
  if (!ONLY || ONLY.has('title')) {
    const ctx = await browser.createBrowserContext();
    const p3 = await ctx.newPage();
    await p3.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await p3.goto(`${BASE}&guest`, { waitUntil: 'domcontentloaded' });
    await p3.waitForFunction(() => !!document.querySelector('.main-menu.in'), { timeout: 120000 }).catch(() => errors.push('title timeout'));
    await sleep(1800);
    report.title = await p3.evaluate(probe, '.main-menu');
    if (SHOTS) await p3.screenshot({ path: path.join(dir, 'title.png') });
    await ctx.close();
  }
  await page.close();
  return { report, errors: [...new Set(errors)].slice(0, 20) };
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
let failed = false;
const summary = {};
for (const spec of SIZES) {
  const t0 = Date.now();
  const { report, errors } = await runSize(browser, spec);
  const rows = Object.entries(report);
  const bad = rows.filter(([, r]) => r.scroll.length || r.off.length);
  summary[spec] = { surfaces: rows.length, scrollFailures: rows.filter(([, r]) => r.scroll.length).length, offscreen: rows.filter(([, r]) => r.off.length).length, clipped: rows.filter(([, r]) => r.clip.length).length, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log(`\n== ${spec}: ${rows.length} surfaces, ${bad.length} failing (${summary[spec].seconds}s)`);
  for (const [name, r] of rows) {
    const flag = r.scroll.length ? 'SCROLL' : r.off.length ? 'OFFSCREEN' : r.clip.length ? 'clip' : 'ok';
    if (flag === 'ok') continue;
    console.log(`  ${flag.padEnd(9)} ${name}`);
    for (const x of r.scroll) console.log(`      scroll: ${x}`);
    for (const x of r.off) console.log(`      offscreen: ${x}`);
    for (const x of r.clip) console.log(`      clipped: ${x}`);
  }
  if (errors.length) console.log(`  console errors:\n    ${errors.join('\n    ')}`);
  if (bad.length) failed = true;
}
console.log(`\n${JSON.stringify(summary)}`);
await Promise.race([browser.close(), sleep(4000)]);
console.log(failed ? 'UI CHECK FAILED' : 'UI CHECK PASSED');
process.exit(failed ? 1 : 0);
