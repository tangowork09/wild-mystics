// Full-screen flows: loading, sign-in, main menu, starter pick, cinematics (evolve / hatch),
// NPC dialog, fishing minigame, daily login and the field guide.
import { portrait } from '../assets/manifest';
import { sfx } from '../core/audio';
import { haptic } from '../core/haptics';
import { settings } from '../core/settings';
import { ELEMENTS } from '../data/elements';
import { LOGIN_REWARDS } from '../data/progression';
import { SPECIES, STARTERS } from '../data/species';
import { ABILITIES } from '../data/traits';
import { displayName, geneGrade, statsOf, type Creature } from '../game/creature';
import { state } from '../game/state';
import { claimLogin, pendingLogin } from '../game/progress';
import { AuthError, login, playAsGuest, signup, type Account } from '../net/auth';
import { el, modal, uiRoot } from './dom';
import { elementBadge, esc, mysticFace, rarityTag } from './kit';
import { icon } from './icons';

const TIPS = [
  'Strike a wild Mystic first (F) and the battle starts with it staggered.',
  'Parry every hit of an attack to trigger a counter.',
  'Gold strikes must be jumped. Red strikes can only be dodged.',
  'Some Mystics only appear at night. Rest at an inn to pass the time.',
  'Shiny Mystics sparkle in the wild — about 1 in 300.',
  'Waystones let you fast travel once attuned. Look for glowing obelisks.',
  'Tall grass hides Mystics you will never see roaming.',
  'Your Homestead produces materials while you explore.',
  'Awaken duplicates with Mystic Essence for extra stars.',
  'Double jump by pressing Space again in mid-air.',
];

export function loading(msg: string, frac?: number) {
  let l = document.getElementById('loading');
  if (!l) {
    l = el('div', '', `<div class="ld-sky"></div><div class="ld-mark"><div class="ld-kicker">A creature-collecting expedition</div><div class="ld-title">Wild <em>Mystics</em></div></div>
      <div class="ld-foot"><div class="ld-bar"><i></i></div><div class="ld-msg"></div><div class="ld-tip"></div></div>`);
    l.id = 'loading';
    document.body.appendChild(l);
    const tip = l.querySelector('.ld-tip') as HTMLElement;
    let i = Math.floor(Math.random() * TIPS.length);
    const next = () => { tip.innerHTML = `${icon('compass')} ${TIPS[i++ % TIPS.length]}`; };
    next();
    const t = setInterval(() => { if (!document.getElementById('loading')) clearInterval(t); else next(); }, 4200);
  }
  (l.querySelector('.ld-msg') as HTMLElement).textContent = msg;
  if (frac !== undefined) (l.querySelector('.ld-bar i') as HTMLElement).style.setProperty('--p', String(Math.max(0, Math.min(1, frac))));
}
export function hideLoading() {
  const l = document.getElementById('loading');
  if (!l) return;
  l.classList.add('out');
  setTimeout(() => l.remove(), 900);
}

// ── Sign in / sign up / guest ───────────────────────────────────────────────
export function authScreen(opts: { cloud: boolean; profiles: Account[]; mode?: 'signin' | 'signup'; cancellable?: boolean }): Promise<Account | null> {
  return new Promise((resolve) => {
    let mode: 'signin' | 'signup' = opts.mode ?? (opts.profiles.some((p) => p.mode !== 'guest') ? 'signin' : 'signup');
    const s = el('div', 'auth-screen');
    document.body.appendChild(s); // above #loading (the #ui layer sits below it)
    const draw = (prefill: { login?: string } = {}) => {
      const locals = opts.profiles.filter((p) => p.mode !== 'guest');
      s.innerHTML = `<div class="auth-sky"></div>
        <div class="auth-mark"><div class="ld-kicker">A creature-collecting expedition</div><h1>Wild <em>Mystics</em></h1></div>
        <form class="auth-card" novalidate>
          <div class="auth-tabs" role="tablist"><button type="button" class="${mode === 'signin' ? 'on' : ''}" data-mode="signin">Sign in</button><button type="button" class="${mode === 'signup' ? 'on' : ''}" data-mode="signup">Create account</button></div>
          <p class="auth-status ${opts.cloud ? 'online' : 'offline'}">${icon(opts.cloud ? 'cloud' : 'lock')} ${opts.cloud ? 'Cloud saves online — play on any device.' : 'Offline mode — accounts are kept on this device.'}</p>
          ${mode === 'signin' ? `
            <label class="fld"><span>Username or email</span><input name="login" autocomplete="username" required value="${esc(prefill.login ?? '')}"><em data-err="login"></em></label>
            <label class="fld"><span>Password</span><div class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" class="pw-eye" aria-label="Show password">${icon('eye')}</button></div><em data-err="password"></em></label>`
          : `
            <label class="fld"><span>Wayfarer name</span><input name="username" autocomplete="username" maxlength="20" required placeholder="3–20 letters, numbers or _"><em data-err="username"></em></label>
            <label class="fld"><span>Email <small>(optional, for recovery)</small></span><input name="email" type="email" autocomplete="email"><em data-err="email"></em></label>
            <label class="fld"><span>Password</span><div class="pw"><input name="password" type="password" autocomplete="new-password" required placeholder="At least 8 characters"><button type="button" class="pw-eye" aria-label="Show password">${icon('eye')}</button></div><em data-err="password"></em></label>`}
          <p class="auth-err" role="alert"></p>
          <button class="btn primary big wide" type="submit">${mode === 'signin' ? 'Sign in' : 'Create account'}</button>
          <div class="auth-or"><span>or</span></div>
          ${opts.cancellable ? '<button type="button" class="btn ghost wide" data-cancel>Not now</button>' : `<button type="button" class="btn ghost wide" data-guest>${icon('user_profile')} Play as guest</button>`}
          ${locals.length ? `<div class="auth-profiles"><small>On this device</small>${locals.map((p) => `<button type="button" class="chip" data-prof="${esc(p.username)}">${icon(p.mode === 'cloud' ? 'cloud' : 'lock')} ${esc(p.username)}</button>`).join('')}</div>` : ''}
          <p class="auth-fine">Guests can create an account later from Profile. Passwords are hashed and never stored in plain text.</p>
        </form>`;
      const form = s.querySelector('form') as HTMLFormElement;
      const errBox = s.querySelector('.auth-err') as HTMLElement;
      const submit = form.querySelector('[type=submit]') as HTMLButtonElement;
      s.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode as typeof mode; sfx('select'); draw(); }));
      s.querySelectorAll<HTMLElement>('.pw-eye').forEach((b) => b.addEventListener('click', () => {
        const inp = b.previousElementSibling as HTMLInputElement;
        inp.type = inp.type === 'password' ? 'text' : 'password';
        b.classList.toggle('on', inp.type === 'text');
      }));
      s.querySelectorAll<HTMLElement>('[data-prof]').forEach((b) => b.addEventListener('click', () => { mode = 'signin'; draw({ login: b.dataset.prof }); (s.querySelector('[name=password]') as HTMLInputElement)?.focus(); }));
      const busy = (on: boolean) => { submit.disabled = on; submit.classList.toggle('loading', on); s.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { if (b !== submit) b.disabled = on; }); };
      const fail = (e: unknown) => {
        busy(false);
        sfx('error');
        s.querySelectorAll('[data-err]').forEach((x) => (x.textContent = ''));
        const msg = e instanceof AuthError ? e.message : 'Something went wrong. Please try again.';
        const fieldEl = e instanceof AuthError && e.field ? s.querySelector(`[data-err=${e.field}]`) : null;
        if (fieldEl) fieldEl.textContent = msg; else errBox.textContent = msg;
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      };
      const done = (a: Account): void => {
        sfx('captured');
        s.classList.add('out');
        setTimeout(() => s.remove(), 600);
        resolve(a);
      };
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.textContent = '';
        busy(true);
        const f = new FormData(form);
        try {
          done(mode === 'signin'
            ? await login(String(f.get('login') ?? ''), String(f.get('password') ?? ''))
            : await signup(String(f.get('username') ?? ''), String(f.get('email') ?? ''), String(f.get('password') ?? '')));
        } catch (err) { fail(err); }
      });
      s.querySelector('[data-guest]')?.addEventListener('click', async () => {
        busy(true);
        try { done(await playAsGuest()); } catch (err) { fail(err); }
      });
      s.querySelector('[data-cancel]')?.addEventListener('click', () => {
        sfx('back');
        s.classList.add('out');
        setTimeout(() => s.remove(), 600);
        resolve(null);
      });
      (form.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
    };
    draw();
    requestAnimationFrame(() => s.classList.add('in'));
  });
}

// ── Main menu (over the live world) ─────────────────────────────────────────
export type MenuChoice = 'continue' | 'new' | 'guide' | 'settings' | 'switch';
export function mainMenu(info: { account: Account; hasSave: boolean }): Promise<MenuChoice> {
  return new Promise((resolve) => {
    const caught = Object.values(state.dex).filter((d) => d.caught > 0).length;
    const lead = state.team[0];
    const m = el('div', 'main-menu', `
      <div class="mm-mark"><div class="ld-kicker">A creature-collecting expedition</div><h1>Wild <em>Mystics</em></h1><div class="ts-rule"><span></span>${icon('sparkles')}<span></span></div></div>
      <div class="mm-menu">
        ${info.hasSave ? `<button class="mm-continue" data-a="continue">${lead ? mysticFace(lead.species, lead.shiny, 58) : ''}<span><b>Continue journey</b><small>${esc(state.profile.name)} · Rank ${state.rank.level} · ${caught} Mystics · Day ${state.day}</small></span><kbd>Enter</kbd></button>` : ''}
        <button class="btn ${info.hasSave ? '' : 'primary'} big" data-a="new">${icon('compass')} ${info.hasSave ? 'New journey' : 'Begin your journey'}</button>
        <div class="mm-row"><button class="btn ghost" data-a="guide">${icon('book')} Field guide</button><button class="btn ghost" data-a="settings">${icon('gear_settings')} Settings</button></div>
      </div>
      <div class="mm-foot"><span class="mm-acct">${icon(info.account.mode === 'cloud' ? 'cloud' : info.account.mode === 'local' ? 'lock' : 'user_profile')} ${esc(info.account.username)} <button class="linkish" data-a="switch">Switch account</button></span><span>v2 · CC0 art: Quaternius · KayKit · Kenney · Poly Haven · icons game-icons.net</span></div>`);
    uiRoot().appendChild(m);
    requestAnimationFrame(() => m.classList.add('in'));
    let closed = false;
    const go = (a: MenuChoice) => {
      if (closed) return;
      if (a === 'guide' || a === 'settings') { sfx('open'); resolve(a); cleanup(false); return; }
      closed = true;
      sfx('select');
      cleanup(true);
      resolve(a);
    };
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.modal.in')) return;
      if (e.key === 'Enter') go(info.hasSave ? 'continue' : 'new');
    };
    function cleanup(remove: boolean) {
      removeEventListener('keydown', key);
      if (remove) { m.classList.remove('in'); setTimeout(() => m.remove(), 600); } else m.remove();
    }
    addEventListener('keydown', key);
    m.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => go(b.dataset.a as MenuChoice)));
  });
}

// ── Starter pick (with Wayfarer name) ───────────────────────────────────────
export function chooseStarter(): Promise<{ starter: string; name: string }> {
  return new Promise((resolve) => {
    const roles: Record<string, string> = { emberling: 'Striker · relentless attacker', finnik: 'Support · heals & shields allies', sporelet: 'Guardian · sturdy, breaks guards' };
    const max = { hp: 80, atk: 22, def: 22, spd: 22 };
    const s = el('div', 'starter-screen', `<div class="st-head"><div class="st-kicker">Chapter I · First Bond</div><h2>Choose your first companion</h2><p>They will walk every road beside you.</p>
      <label class="st-name-in"><span>Your name, Wayfarer</span><input maxlength="18" value="${esc(state.profile.name && state.profile.name !== 'Wayfarer' ? state.profile.name : '')}" placeholder="Wayfarer"></label></div>
      <div class="st-cards">${STARTERS.map((id, i) => {
        const sp = SPECIES[id];
        const e = ELEMENTS[sp.element];
        return `<button class="st-card" data-id="${id}" style="--el:${e.color}">
          <div class="st-glow"></div>${mysticFace(id, false, 150)}
          <div class="st-tags">${elementBadge(sp.element, true)}${rarityTag(id)}</div>
          <div class="st-name">${sp.name}</div><div class="st-role">${roles[id] ?? ''}</div>
          <div class="st-stats">${(['hp', 'atk', 'def', 'spd'] as const).map((k) => `<div><span>${k.toUpperCase()}</span><i style="--w:${Math.min(100, (sp.base[k] / max[k]) * 100)}%"></i></div>`).join('')}</div>
          <p class="st-ab">${icon('star')} ${sp.abilities.map((a) => ABILITIES[a].name).join(' / ')}</p>
          <p class="st-lore">${sp.lore}</p><kbd class="st-key">${i + 1}</kbd></button>`;
      }).join('')}</div>`);
    uiRoot().appendChild(s);
    requestAnimationFrame(() => s.classList.add('in'));
    const nameIn = s.querySelector('input') as HTMLInputElement;
    const key = (e: KeyboardEvent) => {
      if (document.activeElement === nameIn) { if (e.key === 'Enter') nameIn.blur(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= STARTERS.length) pick(STARTERS[n - 1]);
    };
    addEventListener('keydown', key);
    s.querySelectorAll<HTMLElement>('.st-card').forEach((c) => c.addEventListener('click', () => pick(c.dataset.id!)));
    let picked = false;
    const pick = (id: string) => {
      if (picked) return;
      picked = true;
      removeEventListener('keydown', key);
      sfx('captured');
      haptic('success');
      s.classList.add('chosen');
      s.querySelectorAll<HTMLElement>('.st-card').forEach((c) => c.classList.toggle('picked', c.dataset.id === id));
      setTimeout(() => { s.classList.remove('in'); setTimeout(() => s.remove(), 600); resolve({ starter: id, name: nameIn.value.trim().slice(0, 18) || 'Wayfarer' }); }, 1000);
    };
  });
}

// ── Cinematics ──────────────────────────────────────────────────────────────
function cinematicClose(o: HTMLElement, resolve: () => void) {
  const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); close(); } };
  const close = () => { removeEventListener('keydown', key, true); o.classList.remove('in'); setTimeout(() => o.remove(), 500); resolve(); };
  addEventListener('keydown', key, true);
  o.querySelector('.cine-go')?.addEventListener('click', close);
}

export function evolution(c: Creature, fromId: string, toId: string): Promise<void> {
  return new Promise((resolve) => {
    const e = ELEMENTS[SPECIES[toId].element];
    const o = el('div', 'cine evo', `<div class="cine-rays" style="--el:${e.color}"></div>
      <div class="cine-text">What? <b>${SPECIES[fromId].name}</b> is evolving!</div>
      <div class="evo-stage" style="--el:${e.color}"><img class="from" src="${portrait(fromId, c.shiny)}" alt=""><img class="to" src="${portrait(toId, c.shiny)}" alt=""></div>
      <div class="cine-sub"></div>`);
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in'));
    sfx('capture');
    haptic('medium');
    setTimeout(() => o.classList.add('morph'), 900);
    setTimeout(() => {
      o.classList.add('done');
      sfx('evolve'); haptic('success');
      (o.querySelector('.cine-text') as HTMLElement).innerHTML = `Congratulations! ${esc(c.nickname ?? SPECIES[fromId].name)} became <b>${SPECIES[toId].name}</b>!`;
      (o.querySelector('.cine-sub') as HTMLElement).innerHTML = `<div class="hatch-info">${elementBadge(SPECIES[toId].element, true)} ${rarityTag(toId)} · ${statsOf(c).maxHp} HP</div><button class="btn primary cine-go">Continue</button>`;
      cinematicClose(o, resolve);
    }, 4200);
  });
}

export function hatch(c: Creature): Promise<void> {
  return new Promise((resolve) => {
    const sp = SPECIES[c.species];
    const e = ELEMENTS[sp.element];
    const o = el('div', `cine hatch ${c.shiny ? 'shiny' : ''}`, `<div class="cine-rays" style="--el:${e.color}"></div>
      <div class="cine-text">Oh? Your egg is hatching!</div>
      <div class="egg-stage"><div class="egg" style="--el:${e.color}"><i></i><i></i><i></i></div><img class="born" src="${portrait(c.species, c.shiny)}" alt=""></div>
      <div class="cine-sub"></div>`);
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in'));
    setTimeout(() => { o.classList.add('crack'); sfx('orb'); haptic('light'); }, 1400);
    setTimeout(() => { sfx('orb'); haptic('light'); }, 2000);
    setTimeout(() => {
      o.classList.add('done');
      sfx('captured'); haptic('success');
      (o.querySelector('.cine-text') as HTMLElement).innerHTML = `${c.shiny ? `${icon('sparkle')} A shimmering ` : ''}<b>${esc(displayName(c))}</b> hatched!`;
      (o.querySelector('.cine-sub') as HTMLElement).innerHTML = `<div class="hatch-info">${elementBadge(sp.element, true)} ${rarityTag(c.species)} · Genes <b>${geneGrade(c.genes)}</b> · ${statsOf(c).maxHp} HP</div><button class="btn primary cine-go">Welcome!</button>`;
      cinematicClose(o, resolve);
    }, 2900);
  });
}

// ── NPC dialog (tamers, townsfolk) ──────────────────────────────────────────
export function dialog(opts: { name: string; title?: string; face?: string; lines: string[]; choices?: string[] }): Promise<number> {
  return new Promise((resolve) => {
    const d = el('div', 'dialog-box', `<div class="dg-face">${opts.face && SPECIES[opts.face] ? mysticFace(opts.face, false, 84) : `<span class="dg-ic">${icon('user_profile')}</span>`}</div>
      <div class="dg-body"><div class="dg-name"><b>${esc(opts.name)}</b>${opts.title ? `<small>${esc(opts.title)}</small>` : ''}</div><p class="dg-text"></p><div class="dg-choices"></div><span class="dg-next">${icon('sparkle')}</span></div>`);
    uiRoot().appendChild(d);
    requestAnimationFrame(() => d.classList.add('in'));
    const text = d.querySelector('.dg-text') as HTMLElement;
    const choices = d.querySelector('.dg-choices') as HTMLElement;
    let line = 0, typing = 0, full = '';
    const type = () => {
      full = opts.lines[line];
      let i = 0;
      clearInterval(typing);
      text.textContent = '';
      typing = window.setInterval(() => { i += 2; text.textContent = full.slice(0, i); if (i >= full.length) { clearInterval(typing); typing = 0; showChoices(); } }, 18);
    };
    const showChoices = () => {
      if (line < opts.lines.length - 1) { d.classList.add('more'); return; }
      d.classList.remove('more');
      const list = opts.choices ?? ['Continue'];
      choices.innerHTML = list.map((c, i) => `<button class="btn ${i === 0 ? 'primary' : 'ghost'}" data-c="${i}">${c}${i === 0 ? ' <kbd>Enter</kbd>' : ''}</button>`).join('');
      choices.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); finish(Number(b.dataset.c)); }));
    };
    const advance = () => {
      if (typing) { clearInterval(typing); typing = 0; text.textContent = full; showChoices(); return; }
      if (line < opts.lines.length - 1) { line++; d.classList.remove('more'); sfx('select'); type(); }
    };
    const key = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'Enter' || k === ' ' || k === 'e' || k === 'E') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!typing && line >= opts.lines.length - 1) finish(0); else advance();
      } else if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish((opts.choices?.length ?? 1) - 1); }
    };
    const finish = (i: number) => {
      removeEventListener('keydown', key, true);
      clearInterval(typing);
      sfx(i === 0 ? 'select' : 'back');
      d.classList.remove('in');
      setTimeout(() => d.remove(), 300);
      resolve(i);
    };
    d.addEventListener('click', advance);
    addEventListener('keydown', key, true);
    type();
  });
}

// ── Fishing minigame: wait for the bite, then keep the fish inside your reel zone ──
export function fishing(): Promise<boolean> {
  return new Promise((resolve) => {
    const o = el('div', 'fishing', `<div class="fs-panel"><div class="fs-title">${icon('fish')} <b>Fishing</b><small>Wait for the bite…</small></div>
      <div class="fs-water"><div class="fs-bobber"></div><div class="fs-bang">!</div></div>
      <div class="fs-reel"><div class="fs-track"><div class="fs-zone"></div><div class="fs-fish">${icon('fish')}</div></div><div class="fs-prog"><i></i></div></div>
      <p class="fs-hint">${matchMedia('(pointer: coarse)').matches ? 'Tap when the bobber dips!' : 'Press <kbd>Space</kbd> when the bobber dips!'}</p>
      <button class="btn ghost small fs-quit">Reel in</button></div>`);
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in'));
    const sub = o.querySelector('.fs-title small') as HTMLElement;
    const hint = o.querySelector('.fs-hint') as HTMLElement;
    const zone = o.querySelector('.fs-zone') as HTMLElement;
    const fishEl = o.querySelector('.fs-fish') as HTMLElement;
    const prog = o.querySelector('.fs-prog i') as HTMLElement;
    let phase: 'wait' | 'bite' | 'reel' | 'done' = 'wait';
    let holding = false;
    const assist = settings.qteAssist ? 1.5 : 1;
    const biteWindow = 650 * assist;
    let biteAt = 0, raf = 0;
    const waitT = setTimeout(() => {
      if (phase !== 'wait') return;
      phase = 'bite';
      biteAt = performance.now();
      o.classList.add('bite');
      sub.textContent = 'Something bites!';
      sfx('encounter');
      haptic('medium');
      setTimeout(() => { if (phase === 'bite') end(false, 'It got away…'); }, biteWindow);
    }, 1400 + Math.random() * 2600);
    // reel state (0..1 along the track)
    let zPos = 0.35, zVel = 0, fPos = 0.5, fTarget = 0.5, progress = 0.3, last = 0;
    const zSize = 0.26 * (settings.qteAssist ? 1.35 : 1);
    const startReel = () => {
      phase = 'reel';
      o.classList.remove('bite');
      o.classList.add('reel');
      sub.textContent = 'Keep the fish in the glow!';
      hint.innerHTML = matchMedia('(pointer: coarse)').matches ? 'Hold to raise the reel zone.' : 'Hold <kbd>Space</kbd> (or the mouse) to raise the reel zone.';
      sfx('orb');
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      zVel += (holding ? 2.4 : -1.9) * dt;
      zVel *= 0.9;
      zPos = Math.max(0, Math.min(1 - zSize, zPos + zVel * dt * 2.2));
      if (Math.abs(fPos - fTarget) < 0.03 || Math.random() < 0.012) fTarget = 0.05 + Math.random() * 0.9;
      fPos += (fTarget - fPos) * Math.min(1, dt * 2.6);
      const inside = fPos >= zPos && fPos <= zPos + zSize;
      progress = Math.max(0, Math.min(1, progress + (inside ? 0.32 : -0.22) * dt));
      zone.style.bottom = `${zPos * 100}%`;
      zone.style.height = `${zSize * 100}%`;
      zone.classList.toggle('on', inside);
      fishEl.style.bottom = `calc(${fPos * 100}% - 12px)`;
      prog.style.setProperty('--p', String(progress));
      if (progress >= 1) return end(true, 'Caught!');
      if (progress <= 0) return end(false, 'The line went slack…');
      raf = requestAnimationFrame(tick);
    };
    const press = (down: boolean) => {
      if (phase === 'wait' && down) { end(false, 'Too early — the fish swam off.'); return; }
      if (phase === 'bite' && down) { if (performance.now() - biteAt <= biteWindow) startReel(); return; }
      if (phase === 'reel') holding = down;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'e' || e.key === 'E') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) press(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(false, 'You reel in your line.'); }
    };
    const keyUp = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'e' || e.key === 'E') press(false); };
    const water = o.querySelector('.fs-panel') as HTMLElement;
    const pd = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('.fs-quit')) return; e.preventDefault(); press(true); };
    const pu = () => press(false);
    water.addEventListener('pointerdown', pd);
    addEventListener('pointerup', pu);
    addEventListener('keydown', key, true);
    addEventListener('keyup', keyUp, true);
    o.querySelector('.fs-quit')!.addEventListener('click', () => end(false, 'You reel in your line.'));
    function end(ok: boolean, msg: string) {
      if (phase === 'done') return;
      phase = 'done';
      clearTimeout(waitT);
      cancelAnimationFrame(raf);
      removeEventListener('keydown', key, true);
      removeEventListener('keyup', keyUp, true);
      removeEventListener('pointerup', pu);
      sub.textContent = msg;
      o.classList.add(ok ? 'win' : 'lose');
      sfx(ok ? 'captured' : 'miss');
      if (ok) haptic('success');
      setTimeout(() => { o.classList.remove('in'); setTimeout(() => o.remove(), 300); resolve(ok); }, ok ? 700 : 1000);
    }
  });
}

// ── Daily login calendar ────────────────────────────────────────────────────
export function dailyLogin(): Promise<void> {
  const idx = pendingLogin();
  if (idx === null) return Promise.resolve();
  return modal('daily', (b, close) => {
    b.innerHTML = `<h2>${icon('gift')} Daily Reward</h2><p class="muted">Log in every day to climb the calendar. Day 7 is a big one.</p>
      <div class="login-cal">${LOGIN_REWARDS.map((r, i) => `<div class="lc ${i < idx ? 'got' : i === idx ? 'today' : ''}"><small>Day ${i + 1}</small>${icon(i === 6 ? 'chest' : 'gift')}<b>${r.label}</b></div>`).join('')}</div>
      <div class="row-center"><button class="btn gold big" data-claim>Claim ${LOGIN_REWARDS[idx].label}</button></div>`;
    b.querySelector('[data-claim]')!.addEventListener('click', () => {
      const r = claimLogin();
      if (r) { sfx('captured'); haptic('success'); }
      close();
    });
  });
}

// ── Field guide ─────────────────────────────────────────────────────────────
export function guide(touch: boolean): Promise<void> {
  let key: ((e: KeyboardEvent) => void) | null = null;
  return modal('guide', (b, close) => {
    const K = (k: string) => `<kbd>${k}</kbd>`;
    b.innerHTML = `<h2>Field Guide</h2>
      <div class="guide-grid">
        <section><h3>${icon('compass')} Exploring</h3>
          ${touch ? '<p><b>Left thumb</b> move · <b>right thumb</b> look · <b>pinch</b> zoom</p><p><b>Jump</b> button — tap again mid-air to <b>double jump</b></p><p><b>Strike</b> near a wild Mystic to start with the advantage · <b>Ride</b> a rideable Mystic</p>'
          : `<p>${K('W A S D')} move · ${K('Shift')} sprint · <b>drag</b> look · <b>wheel</b> zoom</p><p>${K('Space')} jump · again mid-air to <b>double jump</b></p><p>${K('F')} strike a wild Mystic first — it starts <b>staggered</b> · ${K('R')} ride · ${K('E')} interact</p>`}
          <p>Walk through <b>tall grass</b>, search <b>glimmering nests</b> and <b>fish</b> at ripples to find Mystics that never roam. Some only appear <b>at night</b>. ${icon('sparkle')} <b>Shiny</b> Mystics sparkle — about 1 in 300.</p></section>
        <section><h3>${icon('sword')} Battle</h3>
          <p>Turn order follows <b>speed</b>. Attacks earn <b>AP</b>; skills spend it. Hit ${touch ? '<b>tap</b>' : K('Space')} as the ring closes for <b>Perfect</b> damage.</p>
          <p>Enemy strikes: ${touch ? '<b>PARRY</b> / <b>DODGE</b> / <b>JUMP</b> buttons' : `${K('E')} parry · ${K('Q')} dodge · ${K('W')} jump`}. Parry every hit to <b>counter</b>. <span class="red">Red</span> can only be dodged; <span class="gold">gold</span> must be jumped.</p>
          <p>Fill the <b>Break</b> bar to stun. Full <b>Burst</b> gauge unleashes an element ultimate. Weaken, then <b>Capture</b> with the right orb. ${touch ? '' : `${K('A')} auto · ${K('X')} speed`}</p></section>
        <section><h3>${icon('house_base')} Towns</h3>
          <p><b>Sanctuary</b> heals & rests · <b>Outfitter</b> sells orbs, items & stones · <b>Hatchery</b> breeds eggs · <b>Shrine</b> infuses Elementum & swaps abilities · <b>Move Master</b> enhances moves · <b>Quest Board</b> posts side quests · <b>Wishing Spire</b> summons.</p></section>
        <section><h3>${icon('map')} Travel</h3>
          <p>Touch ${icon('waypoint_obelisk')} <b>Waystones</b> to attune them, then fast travel from the Map${touch ? '' : ` (${K('M')})`}. Each land has its own Mystics, weather and Guardian.</p></section>
        <section><h3>${icon('hammer_build')} Homestead</h3>
          <p>East of Hearthwick. Build mills, quarries, habitats and a forge. Production accrues while you explore — collect it any time.</p></section>
        <section><h3>${icon('book')} Journal</h3>
          <p>${touch ? 'Tap the menu buttons' : `${K('J')} journal · ${K('T')} team · ${K('C')} dex · ${K('B')} bag · ${K('Q')} quests · ${K('G')} summon · ${K('M')} map · ${K('Esc')} menu`}.</p></section>
      </div>
      <div class="row-center"><button class="btn primary big" data-go>Let’s go <kbd>Enter</kbd></button></div>`;
    b.querySelector('[data-go]')!.addEventListener('click', close);
    key = (e: KeyboardEvent) => { if (e.key === 'Enter') close(); };
    addEventListener('keydown', key);
  }, () => { if (key) removeEventListener('keydown', key); });
}

