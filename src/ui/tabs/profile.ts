// Profile (Wayfarer card, account, daily capsules, journey stats) and Settings (categories on the
// left, paged rows on the right: nothing scrolls, even the nine graphics options on a phone).
import { LOGIN_REWARDS, rankXpToNext } from '../../data/progression';
import { ZONES } from '../../data/zones';
import { state, save, exportSave, importSave } from '../../game/state';
import { pendingLogin, claimLogin } from '../../game/progress';
import { settings, setSettings, RESTART_KEYS, type Settings } from '../../core/settings';
import { setMusicVolume, sfx } from '../../core/audio';
import { tier, governor } from '../../core/renderer';
import { toast, confirmBox } from '../dom';
import { bar, esc } from '../kit';
import { icon, glyph } from '../icons';
import { npcAvatar } from '../portraits';
import { Pager } from '../pager';
import type { JournalHooks, TabCleanup } from '../journal';

export function dailyCapsules(claimableIdx: number | null) {
  const cur = ((state.daily.streak || 1) - 1) % LOGIN_REWARDS.length;
  const claimedToday = state.daily.claimed === new Date().toISOString().slice(0, 10);
  return `<div class="cal">${LOGIN_REWARDS.map((r, i) => {
    const today = claimableIdx !== null ? i === claimableIdx : i === cur && !claimedToday;
    const got = claimableIdx !== null ? i < claimableIdx : i < cur || (i === cur && claimedToday);
    return `<div class="cal-d ${got ? 'got' : ''} ${today ? 'today' : ''} ${i === LOGIN_REWARDS.length - 1 ? 'big' : ''}"><small>Day ${i + 1}</small><span class="cal-cap">${got ? glyph('check') : icon(i === LOGIN_REWARDS.length - 1 ? 'chest' : 'gift')}</span><b class="ell">${r.label}</b></div>`;
  }).join('')}</div>`;
}

export function renderProfile(root: HTMLElement, hooks: JournalHooks): TabCleanup {
  let cleanup: (() => void) | undefined;
  const draw = () => {
    cleanup?.();
    const s = state.stats;
    const pend = pendingLogin();
    const acct = hooks.account();
    const stats: [string, string | number, string][] = [
      ['Mystics caught', s.catches ?? 0, 'orb'], ['Shinies', s.shinies ?? 0, 'sparkles'], ['Battles won', s.wins ?? 0, 'sword'], ['Perfect hits', s.perfects ?? 0, 'star'],
      ['Parries', s.parries ?? 0, 'shield'], ['Guardians', `${state.bosses.length}/${ZONES.length}`, 'skull'], ['Tamers beaten', s.tamers ?? 0, 'crown'], ['Distance', `${(state.steps / 1000).toFixed(1)} km`, 'footprint'],
      ['Wishes', state.gacha.pulls, 'crystal_ball'], ['Eggs hatched', s.hatches ?? 0, 'egg'], ['Evolutions', s.evolves ?? 0, 'sparkles'], ['Days', state.day, 'sun'],
    ];
    root.innerHTML = `<div class="profile">
      <div class="pf-card">
        <div class="pf-id">${npcAvatar('player', state.profile.name, 84, 'pf-av')}
          <div class="pf-name"><label class="fld"><input class="pf-in" maxlength="18" value="${esc(state.profile.name)}" aria-label="Wayfarer name"></label><small>${state.profile.title}</small></div></div>
        <div class="pf-rank"><b class="tnum">Rank ${state.rank.level}</b>${bar(state.rank.xp / rankXpToNext(state.rank.level), 'xp')}<small class="tnum">${state.rank.xp}/${rankXpToNext(state.rank.level)} XP</small></div>
        <div class="pf-acct"><span class="pf-mode">${icon(acct.mode === 'cloud' ? 'cloud' : acct.mode === 'local' ? 'lock' : 'user_profile')}<span><b>${esc(acct.name)}</b><small>${acct.mode === 'cloud' ? 'Cloud account' : acct.mode === 'local' ? 'Device account' : 'Guest'} · ${acct.sync}</small></span></span>
          <span class="row">${acct.mode === 'guest' ? `<button class="btn small primary" data-a="upgrade">${icon('cloud')} Create account</button>` : ''}<button class="btn small ghost" data-a="logout">${icon('logout_door')} Sign out</button></span></div>
      </div>
      <div class="pf-right">
        <section class="sec"><header class="sec-h"><b>Daily capsules</b><span class="sec-n">Day ${state.daily.streak || 1}</span>${pend !== null ? `<button class="btn small gold" data-a="claim">${icon('gift')} Claim ${LOGIN_REWARDS[pend].label}</button>` : '<small>Come back tomorrow</small>'}</header>${dailyCapsules(pend)}</section>
        <section class="sec grow"><header class="sec-h"><b>Journey</b></header><div class="pf-stats"></div></section>
      </div></div>`;
    const sp = new Pager<(typeof stats)[number]>(root.querySelector('.pf-stats') as HTMLElement, {
      items: stats, cell: { w: 128, h: 50 }, gap: 6, keys: false, label: 'Journey stats',
      render: ([label, v, ic]) => `<span class="pstat">${icon(ic)}<span><b class="tnum">${v}</b><small>${label}</small></span></span>`,
    });
    cleanup = () => sp.destroy();
    const name = root.querySelector<HTMLInputElement>('.pf-in')!;
    name.addEventListener('change', () => { state.profile.name = name.value.trim().slice(0, 18) || 'Wayfarer'; save(); toast('Name updated.'); });
    root.querySelector('[data-a=claim]')?.addEventListener('click', () => { const r = claimLogin(); if (r) { sfx('captured'); toast(`Daily reward: <b>${r.label}</b>`, 'loot'); } draw(); });
    root.querySelector('[data-a=logout]')?.addEventListener('click', () => void hooks.logout());
    root.querySelector('[data-a=upgrade]')?.addEventListener('click', () => void hooks.upgradeAccount());
  };
  draw();
  return () => cleanup?.();
}

type Row = { key: keyof Settings; label: string; type: 'toggle' | 'range' | 'select'; min?: number; max?: number; step?: number; fmt?: (v: number) => string; options?: [string | number, string][]; hint?: string };
type DataRow = { key: 'export' | 'import' | 'install' | 'reset'; label: string; hint: string };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const SECTIONS: { id: string; title: string; ic: string; rows: Row[] }[] = [
  { id: 'graphics', title: 'Graphics', ic: 'eye', rows: [
    { key: 'quality', label: 'Quality preset', type: 'select', options: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High'], ['ultra', 'Ultra']], hint: 'Applies on restart' },
    { key: 'renderScale', label: 'Render scale', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: pct },
    { key: 'adaptiveResolution', label: 'Adaptive resolution', type: 'toggle', hint: 'Keeps the frame rate smooth' },
    { key: 'fpsCap', label: 'Frame rate cap', type: 'select', options: [[30, '30'], [60, '60'], [0, 'Max']] },
    { key: 'shadows', label: 'Shadows', type: 'select', options: [['off', 'Off'], ['low', 'Low'], ['high', 'High']], hint: 'Applies on restart' },
    { key: 'ambientOcclusion', label: 'Ambient occlusion', type: 'toggle', hint: 'Applies on restart' },
    { key: 'bloom', label: 'Bloom glow', type: 'toggle', hint: 'Applies on restart' },
    { key: 'grassDensity', label: 'Grass & foliage', type: 'range', min: 0.25, max: 1.5, step: 0.05, fmt: pct, hint: 'Applies on restart' },
    { key: 'drawDistance', label: 'Draw distance', type: 'range', min: 0.5, max: 1.5, step: 0.05, fmt: pct, hint: 'Applies on restart' },
  ] },
  { id: 'audio', title: 'Audio', ic: 'speaker', rows: [
    { key: 'masterVolume', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'musicVolume', label: 'Music', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'sfxVolume', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  ] },
  { id: 'gameplay', title: 'Gameplay', ic: 'sword', rows: [
    { key: 'battleSpeed', label: 'Battle speed', type: 'select', options: [[1, '1×'], [1.5, '1.5×'], [2, '2×']] },
    { key: 'damageNumbers', label: 'Damage numbers', type: 'toggle' },
    { key: 'screenShake', label: 'Screen shake', type: 'range', min: 0, max: 1, step: 0.1, fmt: pct },
    { key: 'dayLength', label: 'Day length (minutes)', type: 'select', options: [[12, '12'], [24, '24'], [48, '48'], [96, '96']] },
    { key: 'hints', label: 'Hints & breadcrumbs', type: 'toggle', hint: 'Tips and the trail to your objective' },
  ] },
  { id: 'access', title: 'Accessibility', ic: 'heart', rows: [
    { key: 'qteAssist', label: 'Timing assist', type: 'toggle', hint: '50% wider Perfect and parry windows' },
    { key: 'autoParry', label: 'Auto-defend', type: 'toggle', hint: 'Defence happens for you (no counters)' },
    { key: 'haptics', label: 'Vibration', type: 'toggle' },
  ] },
  { id: 'controls', title: 'Controls', ic: 'compass', rows: [
    { key: 'cameraSensitivity', label: 'Camera sensitivity', type: 'range', min: 0.3, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'invertY', label: 'Invert camera Y', type: 'toggle' },
    { key: 'cameraDistance', label: 'Camera distance', type: 'range', min: 5, max: 18, step: 0.5, fmt: (v) => `${v} m` },
    { key: 'touchScale', label: 'Touch button size', type: 'range', min: 0.8, max: 1.3, step: 0.05, fmt: pct },
    { key: 'touchOpacity', label: 'Touch button opacity', type: 'range', min: 0.4, max: 1, step: 0.05, fmt: pct },
    { key: 'leftHanded', label: 'Left-handed layout', type: 'toggle' },
  ] },
];
let section = 'graphics';

export function renderSettings(root: HTMLElement, hooks: JournalHooks): TabCleanup {
  const secs = [...SECTIONS.map((s) => ({ id: s.id, title: s.title, ic: s.ic })), { id: 'data', title: 'Data', ic: 'chest' }];
  root.classList.add('settings-host');
  root.innerHTML = `<div class="settings">
    <nav class="set-cats" role="tablist" aria-label="Settings categories">${secs.map((s) => `<button role="tab" data-sec="${s.id}"><span class="sc-ic">${icon(s.ic)}</span><span class="sc-l">${s.title}</span></button>`).join('')}</nav>
    <div class="set-main"><header class="set-h"><b class="set-title"></b><small class="set-sub"></small></header><div class="set-rows"></div></div></div>`;
  let pager: Pager<Row | DataRow> | null = null;
  const rowsHost = root.querySelector('.set-rows') as HTMLElement;
  const draw = () => {
    root.querySelectorAll<HTMLElement>('[data-sec]').forEach((b) => { b.classList.toggle('on', b.dataset.sec === section); b.setAttribute('aria-selected', String(b.dataset.sec === section)); });
    const sec = SECTIONS.find((s) => s.id === section);
    (root.querySelector('.set-title') as HTMLElement).textContent = sec?.title ?? 'Data';
    (root.querySelector('.set-sub') as HTMLElement).textContent = section === 'graphics' ? `Detected tier: ${tier} · resolution ${Math.round(governor.current * 100)}%` : section === 'data' ? 'Backups and your save on this device' : '';
    const rows: (Row | DataRow)[] = sec ? sec.rows : [
      { key: 'export', label: 'Export save', hint: 'Download a backup of your journey' },
      { key: 'import', label: 'Import save', hint: 'Restore from a backup file' },
      ...(hooks.canInstall() ? [{ key: 'install' as const, label: 'Install app', hint: 'Play full-screen and offline' }] : []),
      { key: 'reset', label: 'Start over', hint: 'Erase this account’s save on this device' },
    ];
    pager?.destroy();
    pager = new Pager<Row | DataRow>(rowsHost, {
      items: rows, cell: { w: 300, h: 56 }, gap: 6, maxCols: 2, primary: true, label: 'Settings',
      render: (r) => rowHTML(r),
    });
  };
  const rowHTML = (r: Row | DataRow) => {
    if (!('type' in r)) {
      const ctl = r.key === 'export' ? `<button class="btn small" data-d="export">${glyph('chevD')} Export</button>`
        : r.key === 'import' ? `<label class="btn small">${glyph('chevU')} Import<input type="file" accept="application/json" hidden data-d="import"></label>`
        : r.key === 'install' ? '<button class="btn small primary" data-d="install">Install</button>'
        : '<button class="btn small danger" data-d="reset">Erase</button>';
      return `<div class="set-row"><div class="sr-t"><b>${r.label}</b><small>${r.hint}</small></div><div class="set-ctl">${ctl}</div></div>`;
    }
    const v = settings[r.key];
    let ctl = '';
    if (r.type === 'toggle') ctl = `<button class="switch ${v ? 'on' : ''}" data-k="${r.key}" role="switch" aria-checked="${!!v}" aria-label="${r.label}"><i></i></button>`;
    if (r.type === 'range') ctl = `<input type="range" data-k="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" aria-label="${r.label}" style="--f:${(((v as number) - r.min!) / (r.max! - r.min!)).toFixed(3)}"><output class="tnum">${r.fmt ? r.fmt(v as number) : v}</output>`;
    if (r.type === 'select') ctl = `<div class="opts" role="radiogroup" aria-label="${r.label}">${r.options!.map(([ov, ol]) => `<button role="radio" data-k="${r.key}" data-v="${ov}" class="${String(ov) === String(v) ? 'on' : ''}" aria-checked="${String(ov) === String(v)}">${ol}</button>`).join('')}</div>`;
    return `<div class="set-row ${r.type}"><div class="sr-t"><b>${r.label}</b>${r.hint ? `<small>${r.hint}</small>` : ''}</div><div class="set-ctl">${ctl}</div></div>`;
  };
  const apply = (k: keyof Settings, raw: string | boolean) => {
    const cur = settings[k];
    const val = typeof cur === 'number' ? Number(raw) : typeof cur === 'boolean' ? !!raw : raw;
    setSettings({ [k]: val } as Partial<Settings>);
    if (k === 'musicVolume' || k === 'masterVolume') setMusicVolume(settings.musicVolume * settings.masterVolume);
    if (RESTART_KEYS.includes(k) || k === 'shadows' || k === 'ambientOcclusion' || k === 'bloom') toast('Saved. This applies after you restart the game.');
  };
  rowsHost.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const sw = t.closest<HTMLElement>('.switch');
    if (sw) { apply(sw.dataset.k as keyof Settings, !settings[sw.dataset.k as keyof Settings]); sfx('select'); pager?.refresh(); return; }
    const opt = t.closest<HTMLElement>('.opts [data-v]');
    if (opt) { apply(opt.dataset.k as keyof Settings, opt.dataset.v!); sfx('select'); pager?.refresh(); return; }
    const d = t.closest<HTMLElement>('[data-d]')?.dataset.d;
    if (d === 'export') {
      const blob = new Blob([exportSave()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wild-mystics-${state.profile.name}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      toast('Save exported.');
    }
    if (d === 'install') void hooks.install();
    if (d === 'reset' && (await confirmBox('Start over?', 'This permanently erases this account’s save on this device.', 'Erase save', true))) hooks.reset();
  });
  rowsHost.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.type !== 'range') return;
    const r = SECTIONS.flatMap((s) => s.rows).find((x) => x.key === inp.dataset.k)!;
    apply(r.key, inp.value);
    inp.style.setProperty('--f', ((Number(inp.value) - r.min!) / (r.max! - r.min!)).toFixed(3));
    (inp.nextElementSibling as HTMLElement).textContent = r.fmt ? r.fmt(Number(inp.value)) : inp.value;
  });
  rowsHost.addEventListener('change', async (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.dataset.d !== 'import') return;
    const f = inp.files?.[0];
    if (!f) return;
    try { importSave(await f.text()); toast('Save imported. Restarting…', 'good'); setTimeout(() => location.reload(), 900); } catch { toast('That file is not a valid save.', 'bad'); }
  });
  root.querySelectorAll<HTMLElement>('[data-sec]').forEach((b) => b.addEventListener('click', () => { section = b.dataset.sec!; sfx('select'); draw(); }));
  draw();
  return () => pager?.destroy();
}
