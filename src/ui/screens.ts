// Full-screen flows: loading, sign-in, title, starter choice, dialog, cinematics (evolve / hatch),
// fishing, daily capsules, field guide, pause, rewards and level-up. All fit every target size.
import { portrait } from '../assets/manifest';
import logoUrl from '../assets/brand/logo.webp';
import { sfx } from '../core/audio';
import { haptic } from '../core/haptics';
import { settings } from '../core/settings';
import { isTouch } from '../core/device';
import { ELEMENTS } from '../data/elements';
import { LOGIN_REWARDS, type Reward } from '../data/progression';
import { SPECIES, STARTERS } from '../data/species';
import { ABILITIES } from '../data/traits';
import { displayName, geneGrade, statsOf, type Creature } from '../game/creature';
import type { DialogSpec } from '../game/contracts';
import { state } from '../game/state';
import { claimLogin, pendingLogin } from '../game/progress';
import { AuthError, login, playAsGuest, signup, type Account } from '../net/auth';
import { el, modal, uiRoot, reducedMotion } from './dom';
import { elementBadge, esc, mysticFace, rarityTag } from './kit';
import { icon, glyph } from './icons';
import { faceHTML } from './portraits';
import { dailyCapsules } from './tabs/profile';
import { rewardChips } from './tabs/quests';

const TIPS = [
  'Strike a wild Mystic first and the battle starts with it staggered.',
  'Parry every hit of an attack to trigger a counter.',
  'Gold strikes must be jumped. Red strikes can only be dodged.',
  'Some Mystics only appear at night. Rest at an inn to pass the time.',
  'Shiny Mystics sparkle in the wild: about 1 in 300.',
  'Attune Waystones to fast travel from the map.',
  'Tall grass hides Mystics you will never see roaming.',
  'Follow the magenta diamond: it always points at your tracked quest.',
  'Awaken duplicates with Mystic Essence for extra stars.',
  'Double jump by jumping again in mid-air.',
];

export const logoHTML = (cls = '') => `<div class="logo ${cls}" role="img" aria-label="Wild Mystics"><img src="${logoUrl}" alt="" decoding="async" draggable="false"></div>`;

// ── Loading ─────────────────────────────────────────────────────────────────
export function loading(msg: string, frac?: number) {
  let l = document.getElementById('loading');
  if (!l) {
    l = el('div', 'screen loading-screen', `<div class="ls-bg"></div>
      <div class="ls-mark">${logoHTML('big')}<p class="ls-tag">A creature-collecting expedition</p></div>
      <div class="ls-foot"><div class="ls-bar" role="progressbar" aria-label="Loading"><i></i><span class="ls-pct tnum">0%</span></div><div class="ls-msg"></div><div class="ls-tip"></div></div>`);
    l.id = 'loading';
    document.body.appendChild(l);
    const tip = l.querySelector('.ls-tip') as HTMLElement;
    let i = Math.floor(Math.random() * TIPS.length);
    const next = () => { tip.innerHTML = `<span class="ls-tip-ic">${icon('compass')}</span><span>${TIPS[i++ % TIPS.length]}</span>`; tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in'); };
    next();
    const t = setInterval(() => { if (!document.getElementById('loading')) clearInterval(t); else next(); }, 4200);
  }
  (l.querySelector('.ls-msg') as HTMLElement).textContent = msg;
  if (frac !== undefined) {
    const f = Math.max(0, Math.min(1, frac));
    (l.querySelector('.ls-bar i') as HTMLElement).style.setProperty('--p', String(f));
    (l.querySelector('.ls-pct') as HTMLElement).textContent = `${Math.round(f * 100)}%`;
    l.querySelector('.ls-bar')!.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  }
}
export function hideLoading() {
  const l = document.getElementById('loading');
  if (!l) return;
  l.classList.add('out');
  setTimeout(() => l.remove(), 700);
}

// ── Sign in / sign up / guest ───────────────────────────────────────────────
export function authScreen(opts: { cloud: boolean; profiles: Account[]; mode?: 'signin' | 'signup'; cancellable?: boolean }): Promise<Account | null> {
  return new Promise((resolve) => {
    let mode: 'signin' | 'signup' = opts.mode ?? (opts.profiles.some((p) => p.mode !== 'guest') ? 'signin' : 'signup');
    const s = el('div', 'screen auth-screen');
    document.body.appendChild(s); // above #loading (the #ui layer sits below it)
    const draw = (prefill: { login?: string } = {}) => {
      const locals = opts.profiles.filter((p) => p.mode !== 'guest');
      s.innerHTML = `<div class="ls-bg"></div>
        <div class="auth-side">${logoHTML('big')}<p class="ls-tag">A creature-collecting expedition</p>
          <div class="auth-trio">${STARTERS.map((id) => mysticFace(id, false, 76)).join('')}</div></div>
        <form class="auth-card" novalidate>
          <div class="seg auth-tabs" role="tablist"><button type="button" role="tab" class="${mode === 'signin' ? 'on' : ''}" data-mode="signin">Sign in</button><button type="button" role="tab" class="${mode === 'signup' ? 'on' : ''}" data-mode="signup">Create account</button></div>
          <p class="auth-status ${opts.cloud ? 'online' : 'offline'}">${icon(opts.cloud ? 'cloud' : 'lock')}<span>${opts.cloud ? 'Cloud saves are online: play on any device.' : 'Offline: accounts are kept on this device.'}</span></p>
          <div class="auth-fields ${mode}">${mode === 'signin' ? `
            <label class="fld"><span>Username or email</span><input name="login" autocomplete="username" required value="${esc(prefill.login ?? '')}"><em data-err="login"></em></label>
            <label class="fld"><span>Password</span><span class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" class="pw-eye" aria-label="Show password">${icon('eye')}</button></span><em data-err="password"></em></label>`
            : `
            <label class="fld"><span>Wayfarer name</span><input name="username" autocomplete="username" maxlength="20" required placeholder="3–20 letters, numbers or _"><em data-err="username"></em></label>
            <label class="fld"><span>Email <small>(optional)</small></span><input name="email" type="email" autocomplete="email" placeholder="For account recovery"><em data-err="email"></em></label>
            <label class="fld wide"><span>Password</span><span class="pw"><input name="password" type="password" autocomplete="new-password" required placeholder="At least 8 characters"><button type="button" class="pw-eye" aria-label="Show password">${icon('eye')}</button></span><em data-err="password"></em></label>`}</div>
          <p class="auth-err" role="alert"></p>
          <div class="auth-go"><button class="btn primary big" type="submit">${mode === 'signin' ? 'Sign in' : 'Create account'}</button>
            ${opts.cancellable ? '<button type="button" class="btn ghost" data-cancel>Not now</button>' : `<button type="button" class="btn ghost" data-guest>${icon('user_profile')} Play as guest</button>`}</div>
          ${locals.length ? `<div class="auth-profiles"><small>On this device</small>${locals.slice(0, 4).map((p) => `<button type="button" class="chip" data-prof="${esc(p.username)}">${icon(p.mode === 'cloud' ? 'cloud' : 'lock')} ${esc(p.username)}</button>`).join('')}</div>` : ''}
          <p class="auth-fine">Guests can create an account later from Profile. Passwords are hashed, never stored in plain text.</p>
        </form>`;
      const form = s.querySelector('form') as HTMLFormElement;
      const errBox = s.querySelector('.auth-err') as HTMLElement;
      const submit = form.querySelector('[type=submit]') as HTMLButtonElement;
      s.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode as typeof mode; sfx('select'); draw(); }));
      s.querySelectorAll<HTMLElement>('.pw-eye').forEach((b) => b.addEventListener('click', () => {
        const inp = b.previousElementSibling as HTMLInputElement;
        inp.type = inp.type === 'password' ? 'text' : 'password';
        b.classList.toggle('on', inp.type === 'text');
        b.setAttribute('aria-label', inp.type === 'text' ? 'Hide password' : 'Show password');
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
        setTimeout(() => s.remove(), 500);
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
        setTimeout(() => s.remove(), 500);
        resolve(null);
      });
      // desktop only: on phones an autofocus pops the soft keyboard over the whole screen
      if (!isTouch) (form.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
    };
    draw();
    requestAnimationFrame(() => s.classList.add('in'));
  });
}

// ── Title / main menu (over the live world) ─────────────────────────────────
export type MenuChoice = 'continue' | 'new' | 'guide' | 'settings' | 'switch';
export function mainMenu(info: { account: Account; hasSave: boolean }): Promise<MenuChoice> {
  return new Promise((resolve) => {
    const caught = Object.values(state.dex).filter((d) => d.caught > 0).length;
    const lead = state.team[0];
    const chev = '<svg class="mm-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const swap = '<svg class="mm-swap" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-4-4M20 16H7l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const m = el('div', 'main-menu screen', `
      <div class="mm-bg"></div>
      <div class="mm-scrim"></div>
      <div class="mm-col">
        ${logoHTML('big')}
        <div class="mm-menu">
          ${info.hasSave ? `<button class="mm-btn mm-ruby" data-a="continue"><i class="mm-gem l"></i><span class="mm-medal">${lead ? mysticFace(lead.species, lead.shiny, 64) : icon('compass')}</span><span class="mm-txt"><b>Continue Journey</b><small>${esc(state.profile.name)} · Rank ${state.rank.level} · ${caught} Mystics · Day ${state.day}</small></span>${chev}<i class="mm-gem r"></i></button>` : ''}
          <button class="mm-btn ${info.hasSave ? 'mm-parch' : 'mm-ruby'}" data-a="new">${info.hasSave ? '' : '<i class="mm-gem l"></i>'}<span class="mm-medal mm-rose">${icon('compass')}</span><span class="mm-txt"><b>${info.hasSave ? 'New Journey' : 'Begin Your Journey'}</b>${info.hasSave ? '' : '<small>A new Wayfarer arrives in Hearthwick</small>'}</span>${chev}${info.hasSave ? '' : '<i class="mm-gem r"></i>'}</button>
          <div class="mm-row"><button class="mm-btn mm-slate" data-a="guide">${icon('book')}<span>Field Guide</span></button><button class="mm-btn mm-slate" data-a="settings">${icon('gear_settings')}<span>Settings</span></button></div>
          <button class="mm-acct" data-a="switch"><span class="mm-av">${icon(info.account.mode === 'cloud' ? 'cloud' : 'user_profile')}</span><span class="mm-txt"><b>${esc(info.account.username)}</b><small>Switch account</small></span>${swap}</button>
        </div>
      </div>
      <div class="mm-foot"><span class="mm-credits">v3 · Art: Quaternius, KayKit, Kenney, Poly Haven · Icons: game-icons.net</span></div>`);
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
      if (remove) { m.classList.remove('in'); setTimeout(() => m.remove(), 500); } else m.remove();
    }
    addEventListener('keydown', key);
    m.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => go(b.dataset.a as MenuChoice)));
  });
}

// ── Starter choice: three capsules on the shelf, one pops open ──────────────
export interface StarterOpts {
  /** Species to offer (default: Emberling, Finnik, Sporelet). */
  starters?: string[];
  /** Ask for the Wayfarer's name too (default true). */
  askName?: boolean;
  /** Who is offering (shown in the subtitle), e.g. "Elder Maple". */
  host?: string;
}
const ROLES: Record<string, [string, string]> = { emberling: ['Striker', 'Relentless attacker'], finnik: ['Support', 'Heals and shields allies'], sporelet: ['Guardian', 'Sturdy, breaks guards'] };

export function chooseStarter(opts: StarterOpts = {}): Promise<{ starter: string; name: string }> {
  return new Promise((resolve) => {
    const list = (opts.starters ?? STARTERS).filter((id) => SPECIES[id]);
    const askName = opts.askName ?? true;
    const max = { hp: 80, atk: 22, def: 22, spd: 22 };
    let sel = -1;
    const s = el('div', 'starter-screen screen', `<div class="st-bg"></div>
      <header class="st-head"><h2 class="display">Choose your first companion</h2><p>${opts.host ? `${esc(opts.host)} sets three capsules on the table. ` : ''}Whoever you choose will walk every road beside you.</p></header>
      <div class="st-shelf">${list.map((id, i) => {
        const sp = SPECIES[id];
        const e = ELEMENTS[sp.element];
        const [role, blurb] = ROLES[id] ?? ['Companion', ''];
        return `<button class="st-pod" data-i="${i}" style="--el:${e.color}" aria-label="${sp.name}, ${e.name} ${role}">
          <span class="st-num">${i + 1}</span>
          <span class="st-capsule"><span class="st-dome"></span><img src="${portrait(id)}" alt=""><span class="st-base"></span></span>
          <span class="st-name display">${sp.name}</span>
          <span class="st-tags">${elementBadge(sp.element, true)}<span class="tag">${role}</span></span>
          <span class="st-blurb">${blurb}</span>
          <span class="st-stats">${(['hp', 'atk', 'def', 'spd'] as const).map((k) => `<span class="st-stat"><small>${k.toUpperCase()}</small><i style="--w:${Math.min(1, sp.base[k] / max[k]).toFixed(3)}"></i></span>`).join('')}</span>
          <span class="st-ab">${icon('star')} ${sp.abilities.map((a) => ABILITIES[a].name).join(' / ')}</span>
        </button>`;
      }).join('')}</div>
      <footer class="st-foot">${askName ? `<label class="fld st-name-in"><span>Your name, Wayfarer</span><input maxlength="18" value="${esc(state.profile.name && state.profile.name !== 'Wayfarer' ? state.profile.name : '')}" placeholder="Wayfarer"></label>` : '<span></span>'}
        <button class="btn primary big st-go" disabled>Pick a capsule</button></footer>`);
    uiRoot().appendChild(s);
    requestAnimationFrame(() => s.classList.add('in'));
    const nameIn = s.querySelector('.st-name-in input') as HTMLInputElement | null;
    const goBtn = s.querySelector('.st-go') as HTMLButtonElement;
    const pods = Array.from(s.querySelectorAll<HTMLElement>('.st-pod'));
    const focus = (i: number) => {
      if (i < 0 || i >= list.length) return;
      if (i !== sel) { sfx('select'); haptic('light'); }
      sel = i;
      pods.forEach((p, k) => { p.classList.toggle('sel', k === i); p.setAttribute('aria-pressed', String(k === i)); });
      s.classList.add('has-sel');
      goBtn.disabled = false;
      goBtn.innerHTML = `Choose ${SPECIES[list[i]].name} <kbd>Enter</kbd>`;
    };
    let picked = false;
    const pick = () => {
      if (picked || sel < 0) return;
      picked = true;
      removeEventListener('keydown', key, true);
      sfx('captured');
      haptic('success');
      s.classList.add('chosen');
      pods[sel].classList.add('open');
      goBtn.disabled = true;
      setTimeout(() => { s.classList.remove('in'); setTimeout(() => s.remove(), 500); resolve({ starter: list[sel], name: nameIn?.value.trim().slice(0, 18) || state.profile.name || 'Wayfarer' }); }, reducedMotion() ? 200 : 1300);
    };
    const key = (e: KeyboardEvent) => {
      if (nameIn && document.activeElement === nameIn) { if (e.key === 'Enter') { nameIn.blur(); if (sel >= 0) pick(); } return; }
      const n = Number(e.key);
      if (n >= 1 && n <= list.length) { focus(n - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { focus(Math.min(list.length - 1, sel + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { focus(Math.max(0, sel < 0 ? 0 : sel - 1)); e.preventDefault(); }
      else if (e.key === 'Enter' && sel >= 0) { pick(); e.preventDefault(); }
    };
    addEventListener('keydown', key, true);
    pods.forEach((p, i) => p.addEventListener('click', () => { if (sel === i) pick(); else focus(i); }));
    goBtn.addEventListener('click', pick);
  });
}

// ── Cinematics ──────────────────────────────────────────────────────────────
function cinematicClose(o: HTMLElement, resolve: () => void) {
  const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  const close = () => { removeEventListener('keydown', key, true); o.classList.remove('in'); setTimeout(() => o.remove(), 400); resolve(); };
  addEventListener('keydown', key, true);
  const go = o.querySelector('.cine-go') as HTMLElement | null;
  go?.addEventListener('click', close);
  go?.focus({ preventScroll: true });
}

export function evolution(c: Creature, fromId: string, toId: string): Promise<void> {
  return new Promise((resolve) => {
    const e = ELEMENTS[SPECIES[toId].element];
    const src = (id: string) => portrait(id, c.shiny);
    const o = el('div', 'cine evo', `<div class="cine-rays" style="--el:${e.color}"></div>
      <p class="cine-text">Oh? <b>${esc(c.nickname ?? SPECIES[fromId].name)}</b> is evolving!</p>
      <div class="cine-stage" style="--el:${e.color}"><span class="cine-cap"><span class="cc-dome"></span><img class="from" src="${src(fromId)}" alt=""><img class="to" src="${src(toId)}" alt=""><span class="cc-base"></span></span></div>
      <div class="cine-sub"></div>`);
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in'));
    sfx('capture');
    haptic('medium');
    const t = reducedMotion() ? 0.2 : 1;
    setTimeout(() => o.classList.add('morph'), 900 * t);
    setTimeout(() => {
      o.classList.add('done');
      sfx('evolve'); haptic('success');
      (o.querySelector('.cine-text') as HTMLElement).innerHTML = `<b>${esc(c.nickname ?? SPECIES[fromId].name)}</b> became <b class="hl">${SPECIES[toId].name}</b>!`;
      (o.querySelector('.cine-sub') as HTMLElement).innerHTML = `<div class="cine-info">${elementBadge(SPECIES[toId].element, true)}${rarityTag(toId)}<span class="tag tnum">${statsOf(c).maxHp} HP</span></div><button class="btn primary big cine-go">Continue <kbd>Enter</kbd></button>`;
      cinematicClose(o, resolve);
    }, 4000 * t);
  });
}

export function hatch(c: Creature): Promise<void> {
  return new Promise((resolve) => {
    const sp = SPECIES[c.species];
    const e = ELEMENTS[sp.element];
    const src = portrait(c.species, c.shiny);
    const o = el('div', `cine hatch ${c.shiny ? 'shiny' : ''}`, `<div class="cine-rays" style="--el:${e.color}"></div>
      <p class="cine-text">Your egg is hatching!</p>
      <div class="cine-stage" style="--el:${e.color}"><div class="egg"><i></i><i></i><i></i></div><img class="born" src="${src}" alt=""></div>
      <div class="cine-sub"></div>`);
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in'));
    const t = reducedMotion() ? 0.2 : 1;
    setTimeout(() => { o.classList.add('crack'); sfx('orb'); haptic('light'); }, 1300 * t);
    setTimeout(() => { sfx('orb'); haptic('light'); }, 1900 * t);
    setTimeout(() => {
      o.classList.add('done');
      sfx('captured'); haptic('success');
      (o.querySelector('.cine-text') as HTMLElement).innerHTML = `${c.shiny ? `<span class="holo-t">${icon('sparkles')} A shimmering</span> ` : ''}<b class="hl">${esc(displayName(c))}</b> hatched!`;
      (o.querySelector('.cine-sub') as HTMLElement).innerHTML = `<div class="cine-info">${elementBadge(sp.element, true)}${rarityTag(c.species)}<span class="tag">Genes ${geneGrade(c.genes)}</span><span class="tag tnum">${statsOf(c).maxHp} HP</span></div><button class="btn primary big cine-go">Welcome! <kbd>Enter</kbd></button>`;
      cinematicClose(o, resolve);
    }, 2800 * t);
  });
}

/** Reward reveal (quest turn-ins, chests): capsules pop open one by one. */
export function rewards(opts: { title: string; sub?: string; reward: Reward }): Promise<void> {
  return new Promise((resolve) => {
    const o = el('div', 'cine rewards', `<div class="cine-rays" style="--el:var(--coin)"></div>
      <h2 class="cine-title display">${esc(opts.title)}</h2>${opts.sub ? `<p class="cine-text">${esc(opts.sub)}</p>` : ''}
      <div class="rw-drop">${rewardChips(opts.reward) || '<span class="muted">Gratitude</span>'}</div>
      <div class="cine-sub"><button class="btn gold big cine-go">Collect <kbd>Enter</kbd></button></div>`);
    uiRoot().appendChild(o);
    o.querySelectorAll<HTMLElement>('.rw').forEach((r, i) => r.style.setProperty('--d', `${0.25 + i * 0.12}s`));
    requestAnimationFrame(() => o.classList.add('in', 'done'));
    sfx('captured');
    haptic('success');
    cinematicClose(o, resolve);
  });
}

/** Level-up stamp: player rank or a Mystic's level. */
export function levelUp(opts: { kind: 'rank' | 'mystic'; level: number; title?: string; sub?: string; species?: string; shiny?: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const art = opts.kind === 'mystic' && opts.species ? mysticFace(opts.species, !!opts.shiny, 110) : `<span class="lv-medal">${icon('crown')}</span>`;
    const o = el('div', `cine levelup ${opts.kind}`, `<div class="cine-rays" style="--el:var(--magenta)"></div>
      <div class="lv-stamp">${art}<span class="lv-word display">${opts.kind === 'rank' ? 'Rank up' : 'Level up'}</span><span class="lv-num display tnum">${opts.level}</span></div>
      ${opts.title ? `<p class="cine-text"><b class="hl">${esc(opts.title)}</b></p>` : ''}${opts.sub ? `<p class="lv-sub">${esc(opts.sub)}</p>` : ''}
      <div class="cine-sub"><button class="btn primary big cine-go">Continue <kbd>Enter</kbd></button></div>`);
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in', 'done'));
    sfx('levelup');
    haptic('success');
    cinematicClose(o, resolve);
  });
}

// ── Dialog: portrait, typewriter text, choices, skip ─────────────────────────
export function dialog(opts: DialogSpec): Promise<number> {
  return new Promise((resolve) => {
    const d = el('div', 'dialog-box', `<div class="dg-panel stk">
        <div class="dg-face">${faceHTML(opts.face, opts.name, 92)}</div>
        <div class="dg-plate"><b>${esc(opts.name)}</b>${opts.title ? `<small>${esc(opts.title)}</small>` : ''}</div>
        <button class="dg-skip" aria-label="Skip to the end">${glyph('skip')}<span>Skip</span></button>
        <p class="dg-text" aria-live="polite"></p>
        <div class="dg-foot"><span class="dg-count tnum"></span><div class="dg-choices"></div><span class="dg-next" aria-hidden="true">${glyph('chevD')}</span></div>
      </div>`);
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', `${opts.name} is talking`);
    uiRoot().appendChild(d);
    requestAnimationFrame(() => d.classList.add('in'));
    const text = d.querySelector('.dg-text') as HTMLElement;
    const choices = d.querySelector('.dg-choices') as HTMLElement;
    const count = d.querySelector('.dg-count') as HTMLElement;
    const lines = opts.lines.length ? opts.lines : [''];
    let line = 0, typing = 0, full = '';
    const speed = reducedMotion() ? 999 : 2;
    const type = () => {
      full = lines[line];
      let i = 0;
      clearInterval(typing);
      text.textContent = '';
      count.textContent = lines.length > 1 ? `${line + 1}/${lines.length}` : '';
      d.classList.remove('more', 'ask');
      typing = window.setInterval(() => { i += speed; text.textContent = full.slice(0, i); if (i >= full.length) { clearInterval(typing); typing = 0; showChoices(); } }, 18);
    };
    const showChoices = () => {
      if (line < lines.length - 1) { d.classList.add('more'); return; }
      d.classList.add('ask');
      const list = opts.choices?.length ? opts.choices : ['Continue'];
      choices.innerHTML = list.map((c, i) => `<button class="btn ${i === 0 ? 'primary' : 'ghost'} small" data-c="${i}">${list.length > 1 ? `<kbd>${i + 1}</kbd>` : ''}${esc(c)}${i === 0 && list.length === 1 ? ' <kbd>Enter</kbd>' : ''}</button>`).join('');
      choices.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); finish(Number(b.dataset.c)); }));
      (choices.querySelector('[data-c]') as HTMLElement | null)?.focus({ preventScroll: true });
    };
    const advance = () => {
      if (typing) { clearInterval(typing); typing = 0; text.textContent = full; showChoices(); return; }
      if (line < lines.length - 1) { line++; sfx('select'); type(); }
    };
    const skip = () => { clearInterval(typing); typing = 0; line = lines.length - 1; full = lines[line]; text.textContent = full; count.textContent = lines.length > 1 ? `${line + 1}/${lines.length}` : ''; d.classList.remove('more'); showChoices(); };
    const key = (e: KeyboardEvent) => {
      const k = e.key;
      const n = Number(k);
      if (d.classList.contains('ask') && n >= 1 && n <= (opts.choices?.length ?? 1)) { e.preventDefault(); e.stopImmediatePropagation(); finish(n - 1); return; }
      if (k === 'Enter' || k === ' ' || k === 'e' || k === 'E') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!typing && line >= lines.length - 1) {
          const f = document.activeElement as HTMLElement | null;
          finish(f?.dataset.c ? Number(f.dataset.c) : 0);
        } else advance();
      } else if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (line < lines.length - 1 || typing) skip(); else finish((opts.choices?.length ?? 1) - 1); }
    };
    const finish = (i: number) => {
      removeEventListener('keydown', key, true);
      clearInterval(typing);
      sfx(i === 0 ? 'select' : 'back');
      d.classList.remove('in');
      setTimeout(() => d.remove(), 260);
      resolve(i);
    };
    d.querySelector('.dg-skip')!.addEventListener('click', (e) => { e.stopPropagation(); skip(); });
    d.addEventListener('click', advance);
    addEventListener('keydown', key, true);
    type();
  });
}

// ── Fishing minigame: wait for the bite, then keep the fish inside your reel zone ──
export function fishing(): Promise<boolean> {
  return new Promise((resolve) => {
    const o = el('div', 'fishing', `<div class="fs-panel stk">
      <div class="fs-title">${icon('fish')}<b>Fishing</b><small>Wait for the bite…</small></div>
      <div class="fs-play"><div class="fs-water"><div class="fs-ring"></div><div class="fs-bobber"></div><div class="fs-bang">${glyph('bang')}</div></div>
        <div class="fs-reel"><div class="fs-track"><div class="fs-zone"></div><div class="fs-fish">${icon('fish')}</div></div><div class="fs-prog"><i></i></div></div></div>
      <p class="fs-hint">${isTouch ? 'Tap when the bobber dips!' : 'Press <kbd>Space</kbd> when the bobber dips!'}</p>
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
    let zPos = 0.35, zVel = 0, fPos = 0.5, fTarget = 0.5, progress = 0.3, last = 0;
    const zSize = 0.26 * (settings.qteAssist ? 1.35 : 1);
    const startReel = () => {
      phase = 'reel';
      o.classList.remove('bite');
      o.classList.add('reel');
      sub.textContent = 'Keep the fish in the glow!';
      hint.innerHTML = isTouch ? 'Hold to raise the reel zone.' : 'Hold <kbd>Space</kbd> or the mouse to raise the reel zone.';
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
      zone.style.transform = `translateY(${(-zPos * 100 / zSize).toFixed(2)}%)`;
      zone.style.height = `${zSize * 100}%`;
      zone.classList.toggle('on', inside);
      fishEl.style.bottom = `calc(${(fPos * 100).toFixed(2)}% - 12px)`;
      prog.style.setProperty('--p', String(progress));
      if (progress >= 1) return end(true, 'Caught!');
      if (progress <= 0) return end(false, 'The line went slack…');
      raf = requestAnimationFrame(tick);
    };
    const press = (down: boolean) => {
      if (phase === 'wait' && down) { end(false, 'Too early. The fish swam off.'); return; }
      if (phase === 'bite' && down) { if (performance.now() - biteAt <= biteWindow) startReel(); return; }
      if (phase === 'reel') holding = down;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'e' || e.key === 'E') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) press(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(false, 'You reel in your line.'); }
    };
    const keyUp = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'e' || e.key === 'E') press(false); };
    const panel = o.querySelector('.fs-panel') as HTMLElement;
    const pd = (e: PointerEvent) => { if ((e.target as HTMLElement).closest('.fs-quit')) return; e.preventDefault(); press(true); };
    const pu = () => press(false);
    panel.addEventListener('pointerdown', pd);
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

// ── Daily capsules ─────────────────────────────────────────────────────────
export function dailyLogin(): Promise<void> {
  const idx = pendingLogin();
  if (idx === null) return Promise.resolve();
  return modal('daily', (b, close) => {
    b.innerHTML = `<h2>${icon('gift')} Daily capsules</h2><p class="lead">Come back each day to climb the week. Day 7 is a big one.</p>
      ${dailyCapsules(idx)}
      <div class="row-center"><button class="btn gold big" data-claim>${icon('gift')} Claim ${LOGIN_REWARDS[idx].label}</button></div>`;
    b.querySelector('[data-claim]')!.addEventListener('click', () => {
      const r = claimLogin();
      if (r) { sfx('captured'); haptic('success'); }
      close();
    });
    requestAnimationFrame(() => (b.querySelector('[data-claim]') as HTMLElement).focus({ preventScroll: true }));
  });
}

// ── Field guide: sections on the left, one page at a time ───────────────────
export function guide(touch: boolean): Promise<void> {
  let key: ((e: KeyboardEvent) => void) | null = null;
  const K = (k: string) => `<kbd>${k}</kbd>`;
  const pages: { id: string; title: string; ic: string; html: string }[] = [
    { id: 'go', title: 'Where to go', ic: 'compass', html: `<p>Your <b>tracked quest</b> sits under your party. The <b class="mag">magenta diamond</b> marks its objective everywhere: on the compass at the top, on the minimap, on the map, and floating over the world with its distance.</p><p>When the objective is behind you, an arrow on the edge of the screen points the way, and chevrons on the ground lead you there.</p><p>Change which quest you follow in the Quest log${touch ? '' : ` (${K('Q')})`}.</p>` },
    { id: 'explore', title: 'Exploring', ic: 'footprint', html: touch ? '<p><b>Left thumb</b> moves, <b>right thumb</b> looks, <b>pinch</b> zooms.</p><p>Tap <b>Jump</b>, then again mid-air to double jump. <b>Strike</b> a wild Mystic to start with the advantage. <b>Ride</b> appears once you own a rideable Mystic.</p><p>Walk through <b>tall grass</b>, search <b>glimmering nests</b> and <b>fish</b> at ripples to find Mystics that never roam.</p>' : `<p>${K('W A S D')} move · ${K('Shift')} sprint · drag to look · wheel to zoom.</p><p>${K('Space')} jump, again mid-air to double jump. ${K('F')} strike a wild Mystic so it starts staggered. ${K('R')} ride · ${K('E')} interact.</p><p>Walk through <b>tall grass</b>, search <b>glimmering nests</b> and <b>fish</b> at ripples to find Mystics that never roam.</p>` },
    { id: 'battle', title: 'Battle', ic: 'sword', html: `<p>Turns follow <b>speed</b>. Attacks earn <b>AP</b>; skills spend it. ${touch ? 'Tap' : `Press ${K('Space')}`} as the ring closes for a <b>Perfect</b> hit.</p><p>Enemy strikes: ${touch ? '<b>Parry</b>, <b>Dodge</b> and <b>Jump</b> buttons' : `${K('E')} parry · ${K('Q')} dodge · ${K('W')} jump`}. Parry every hit to <b>counter</b>. <b class="bad">Red</b> strikes can only be dodged; <b class="gold">gold</b> ones must be jumped.</p><p>Fill the <b>Break</b> bar to stun. A full <b>Burst</b> gauge unleashes an ultimate. Weaken a wild Mystic, then <b>Capture</b> it with the right orb.</p>` },
    { id: 'towns', title: 'Towns', ic: 'house_base', html: '<p><b>Sanctuary</b> heals and lets you rest until day or night. <b>Outfitter</b> and specialty shops buy and sell. <b>Hatchery</b> breeds eggs. <b>Elementum Shrine</b> infuses power. <b>Move Master</b> sharpens moves. <b>Quest boards</b> post requests. The <b>Wishing Spire</b> summons.</p>' },
    { id: 'travel', title: 'Travel', ic: 'map', html: `<p>Touch a <b>Waystone</b> to attune it, then fast travel from the Map${touch ? '' : ` (${K('M')})`}. Each land has its own Mystics, weather and Guardian.</p><p>Sealed <b>Warden Gates</b> open when you answer the neighbouring land’s Guardian. Unexplored land stays under cloud on the map until you walk it.</p>` },
    { id: 'home', title: 'Homestead', ic: 'hammer_build', html: `<p>East of Hearthwick. Build mills, quarries, habitats and a forge${touch ? '' : ` (${K('H')} when you are there)`}. Production piles up while you explore; collect it any time.</p>` },
  ];
  let cur = pages[0].id;
  return modal('guide', (b, close) => {
    const draw = () => {
      const p = pages.find((x) => x.id === cur)!;
      b.innerHTML = `<h2>${icon('book')} Field guide</h2>
        <div class="guide-md"><nav class="set-cats" role="tablist">${pages.map((x) => `<button role="tab" data-p="${x.id}" class="${x.id === cur ? 'on' : ''}" aria-selected="${x.id === cur}"><span class="sc-ic">${icon(x.ic)}</span><span class="sc-l">${x.title}</span></button>`).join('')}</nav>
        <article class="guide-page"><h3>${p.title}</h3>${p.html}</article></div>
        <div class="row-end"><button class="btn primary" data-go>Let’s go <kbd>Enter</kbd></button></div>`;
      b.querySelectorAll<HTMLElement>('[data-p]').forEach((x) => x.addEventListener('click', () => { cur = x.dataset.p!; sfx('select'); draw(); }));
      b.querySelector('[data-go]')!.addEventListener('click', close);
    };
    draw();
    key = (e: KeyboardEvent) => {
      if (e.key === 'Enter') close();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const i = pages.findIndex((x) => x.id === cur); cur = pages[(i + (e.key === 'ArrowDown' ? 1 : pages.length - 1)) % pages.length].id; draw(); e.preventDefault(); }
    };
    addEventListener('keydown', key);
  }, () => { if (key) removeEventListener('keydown', key); });
}

// ── Pause ───────────────────────────────────────────────────────────────────
export type PauseChoice = 'resume' | 'journal' | 'settings' | 'guide' | 'profile' | 'title';
export function pause(info: { name: string; rank: number; day: number; sync: string }): Promise<PauseChoice> {
  return new Promise((resolve) => {
    let choice: PauseChoice = 'resume';
    void modal('pause', (b, close) => {
      b.innerHTML = `<h2 class="display pz-t">Paused</h2><p class="pz-info">${esc(info.name)} · Rank ${info.rank} · Day ${info.day}<br><span class="muted">${esc(info.sync)}</span></p>
        <div class="pz-grid">
          <button class="btn primary big pz-resume" data-a="resume">${glyph('play')} Resume <kbd>Esc</kbd></button>
          <button class="btn" data-a="journal">${icon('book')} Journal</button>
          <button class="btn" data-a="settings">${icon('gear_settings')} Settings</button>
          <button class="btn" data-a="guide">${icon('compass')} Field guide</button>
          <button class="btn" data-a="profile">${icon('user_profile')} Profile</button>
          <button class="btn ghost pz-quit" data-a="title">${icon('logout_door')} Save &amp; quit to title</button>
        </div>`;
      b.querySelectorAll<HTMLElement>('[data-a]').forEach((x) => x.addEventListener('click', () => { choice = x.dataset.a as PauseChoice; close(); }));
      requestAnimationFrame(() => (b.querySelector('.pz-resume') as HTMLElement).focus({ preventScroll: true }));
    }, () => resolve(choice));
  });
}
