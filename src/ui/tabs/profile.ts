import { LOGIN_REWARDS, rankXpToNext } from '../../data/progression';
import { state, save, exportSave, importSave } from '../../game/state';
import { pendingLogin, claimLogin, rewardText } from '../../game/progress';
import { settings, setSettings, RESTART_KEYS, type Settings } from '../../core/settings';
import { setMusicVolume } from '../../core/audio';
import { tier, governor } from '../../core/renderer';
import { sfx } from '../../core/audio';
import { toast, confirmBox } from '../dom';
import { bar, esc, mysticFace } from '../kit';
import { icon } from '../icons';
import type { JournalHooks } from '../journal';

export function renderProfile(root: HTMLElement, hooks: JournalHooks) {
  const draw = () => {
    const s = state.stats;
    const lead = state.team[0];
    const pend = pendingLogin();
    const acct = hooks.account();
    const stat = (label: string, v: number | string, ic: string) => `<div class="pstat">${icon(ic)}<b>${v}</b><small>${label}</small></div>`;
    root.innerHTML = `<div class="profile-top">
        <div class="pf-av">${lead ? mysticFace(lead.species, lead.shiny, 110) : icon('user_profile')}</div>
        <div class="pf-id"><input class="pf-name" maxlength="18" value="${esc(state.profile.name)}" aria-label="Wayfarer name"><small>${state.profile.title}</small>
          <div class="pf-rank"><b>Rank ${state.rank.level}</b>${bar(state.rank.xp / rankXpToNext(state.rank.level), 'xp')}<small>${state.rank.xp} / ${rankXpToNext(state.rank.level)}</small></div></div>
        <div class="pf-acct"><small>${acct.mode === 'cloud' ? `${icon('cloud')} Cloud account` : acct.mode === 'local' ? `${icon('lock')} Device account` : `${icon('user_profile')} Guest`}</small><b>${esc(acct.name)}</b>
          <span class="muted small">${acct.sync}</span>
          <div class="row">${acct.mode === 'guest' ? '<button class="btn primary small" data-a="upgrade">Create account</button>' : ''}<button class="btn ghost small" data-a="logout">${icon('logout_door')} Sign out</button></div></div>
      </div>
      <div class="sec-h">${icon('gift')}<span>Daily login</span><small>Day ${state.daily.streak || 1} streak</small></div>
      <div class="login-cal">${LOGIN_REWARDS.map((r, i) => {
        const cur = ((state.daily.streak || 1) - 1) % LOGIN_REWARDS.length;
        const claimedToday = state.daily.claimed === new Date().toISOString().slice(0, 10);
        const cls = i < cur || (i === cur && claimedToday) ? 'got' : i === cur ? 'today' : '';
        return `<div class="lc ${cls}"><small>Day ${i + 1}</small>${icon(i === 6 ? 'chest' : 'gift')}<b>${r.label}</b></div>`;
      }).join('')}</div>
      ${pend !== null ? `<button class="btn gold wide" data-a="claim">Claim today's reward — ${rewardText(LOGIN_REWARDS[pend].reward)}</button>` : ''}
      <div class="sec-h">${icon('trophy')}<span>Journey stats</span></div>
      <div class="pstats">
        ${stat('Mystics caught', s.catches ?? 0, 'orb')}${stat('Shinies', s.shinies ?? 0, 'sparkle')}${stat('Battles won', s.wins ?? 0, 'sword')}${stat('Perfect hits', s.perfects ?? 0, 'star')}
        ${stat('Parries', s.parries ?? 0, 'shield')}${stat('Guardians', state.bosses.length + '/6', 'skull')}${stat('Tamers beaten', s.tamers ?? 0, 'crown')}${stat('Distance', (state.steps / 1000).toFixed(1) + ' km', 'footprint')}
        ${stat('Wishes', state.gacha.pulls, 'crystal_ball')}${stat('Eggs hatched', s.hatches ?? 0, 'egg')}${stat('Evolutions', s.evolves ?? 0, 'sparkles')}${stat('Days', state.day, 'sun')}
      </div>`;
    const name = root.querySelector<HTMLInputElement>('.pf-name')!;
    name.addEventListener('change', () => { state.profile.name = name.value.trim().slice(0, 18) || 'Wayfarer'; save(); toast('Name updated.'); });
    root.querySelector('[data-a=claim]')?.addEventListener('click', () => { const r = claimLogin(); if (r) { sfx('captured'); toast(`Daily reward: <b>${r.label}</b>`, 'loot'); } draw(); });
    root.querySelector('[data-a=logout]')?.addEventListener('click', () => void hooks.logout());
    root.querySelector('[data-a=upgrade]')?.addEventListener('click', () => void hooks.upgradeAccount());
  };
  draw();
}

type Row = { key: keyof Settings; label: string; type: 'toggle' | 'range' | 'select'; min?: number; max?: number; step?: number; fmt?: (v: number) => string; options?: [string | number, string][]; hint?: string };

const SECTIONS: { title: string; ic: string; rows: Row[] }[] = [
  { title: 'Graphics', ic: 'eye', rows: [
    { key: 'quality', label: 'Quality preset', type: 'select', options: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], hint: 'Applies on restart' },
    { key: 'renderScale', label: 'Render scale', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'adaptiveResolution', label: 'Adaptive resolution', type: 'toggle', hint: 'Lowers resolution briefly to keep frame rate smooth' },
    { key: 'fpsCap', label: 'Frame rate cap', type: 'select', options: [[30, '30 fps (battery)'], [60, '60 fps'], [0, 'Uncapped']] },
    { key: 'shadows', label: 'Shadows', type: 'select', options: [['off', 'Off'], ['low', 'Low'], ['high', 'High']], hint: 'Applies on restart' },
    { key: 'ambientOcclusion', label: 'Ambient occlusion', type: 'toggle', hint: 'Applies on restart' },
    { key: 'bloom', label: 'Bloom glow', type: 'toggle', hint: 'Applies on restart' },
    { key: 'grassDensity', label: 'Grass & foliage density', type: 'range', min: 0.25, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, hint: 'Applies on restart' },
    { key: 'drawDistance', label: 'Draw distance', type: 'range', min: 0.5, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, hint: 'Applies on restart' },
  ] },
  { title: 'Audio', ic: 'speaker', rows: [
    { key: 'masterVolume', label: 'Master', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'musicVolume', label: 'Music', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'sfxVolume', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  ] },
  { title: 'Gameplay', ic: 'sword', rows: [
    { key: 'battleSpeed', label: 'Default battle speed', type: 'select', options: [[1, '1×'], [1.5, '1.5×'], [2, '2×']] },
    { key: 'damageNumbers', label: 'Damage numbers', type: 'toggle' },
    { key: 'screenShake', label: 'Screen shake', type: 'range', min: 0, max: 1, step: 0.1, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'dayLength', label: 'Day length', type: 'select', options: [[12, '12 min'], [24, '24 min'], [48, '48 min'], [96, '96 min']] },
    { key: 'hints', label: 'Tutorial hints', type: 'toggle' },
  ] },
  { title: 'Accessibility', ic: 'heart', rows: [
    { key: 'qteAssist', label: 'Timing assist', type: 'toggle', hint: '50% wider Perfect / parry windows' },
    { key: 'autoParry', label: 'Auto-defend', type: 'toggle', hint: 'Defence happens for you (no counters)' },
    { key: 'haptics', label: 'Vibration', type: 'toggle' },
  ] },
  { title: 'Controls', ic: 'compass', rows: [
    { key: 'cameraSensitivity', label: 'Camera sensitivity', type: 'range', min: 0.3, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'invertY', label: 'Invert camera Y', type: 'toggle' },
    { key: 'cameraDistance', label: 'Camera distance', type: 'range', min: 5, max: 18, step: 0.5, fmt: (v) => `${v} m` },
    { key: 'touchScale', label: 'Touch button size', type: 'range', min: 0.8, max: 1.3, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'touchOpacity', label: 'Touch button opacity', type: 'range', min: 0.4, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'leftHanded', label: 'Left-handed layout', type: 'toggle' },
  ] },
];

export function renderSettings(root: HTMLElement, hooks: JournalHooks) {
  const draw = () => {
    root.innerHTML = SECTIONS.map((sec) => `<div class="sec-h">${icon(sec.ic)}<span>${sec.title}</span>${sec.title === 'Graphics' ? `<small>Detected tier: ${tier} · resolution ${Math.round(governor.current * 100)}%</small>` : ''}</div>
      <div class="set-list">${sec.rows.map((r) => {
        const v = settings[r.key];
        let ctl = '';
        if (r.type === 'toggle') ctl = `<button class="switch ${v ? 'on' : ''}" data-k="${r.key}" role="switch" aria-checked="${!!v}"><i></i></button>`;
        if (r.type === 'range') ctl = `<input type="range" data-k="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"><output>${r.fmt ? r.fmt(v as number) : v}</output>`;
        if (r.type === 'select') ctl = `<select data-k="${r.key}">${r.options!.map(([ov, ol]) => `<option value="${ov}" ${String(ov) === String(v) ? 'selected' : ''}>${ol}</option>`).join('')}</select>`;
        return `<div class="set-row"><div><b>${r.label}</b>${r.hint ? `<small>${r.hint}</small>` : ''}</div><div class="set-ctl">${ctl}</div></div>`;
      }).join('')}</div>`).join('') + `
      <div class="sec-h">${icon('chest')}<span>Data</span></div>
      <div class="set-list"><div class="set-row"><div><b>Export save</b><small>Download a backup of your journey</small></div><div class="set-ctl"><button class="btn small" data-d="export">Export</button></div></div>
        <div class="set-row"><div><b>Import save</b><small>Restore from a backup file</small></div><div class="set-ctl"><label class="btn small">Import<input type="file" accept="application/json" hidden data-d="import"></label></div></div>
        ${hooks.canInstall() ? '<div class="set-row"><div><b>Install app</b><small>Play full-screen and offline</small></div><div class="set-ctl"><button class="btn primary small" data-d="install">Install</button></div></div>' : ''}
        <div class="set-row"><div><b>Start over</b><small>Erase this account’s save on this device</small></div><div class="set-ctl"><button class="btn danger small" data-d="reset">Reset</button></div></div></div>
      <p class="muted small credits-line">Wild Mystics · CC0 art by Quaternius, KayKit, Kenney, Poly Haven · icons by game-icons.net (CC BY 3.0) · see CREDITS.md</p>`;
    const apply = (k: keyof Settings, raw: string | boolean) => {
      const cur = settings[k];
      const val = typeof cur === 'number' ? Number(raw) : typeof cur === 'boolean' ? !!raw : raw;
      setSettings({ [k]: val } as Partial<Settings>);
      if (k === 'musicVolume' || k === 'masterVolume') setMusicVolume(settings.musicVolume * settings.masterVolume);
      if (RESTART_KEYS.includes(k) || k === 'shadows' || k === 'ambientOcclusion' || k === 'bloom') toast('Saved — this change applies after restarting the game.');
    };
    root.querySelectorAll<HTMLElement>('.switch').forEach((b) => b.addEventListener('click', () => { apply(b.dataset.k as keyof Settings, !settings[b.dataset.k as keyof Settings]); sfx('select'); draw(); }));
    root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => inp.addEventListener('input', () => { apply(inp.dataset.k as keyof Settings, inp.value); (inp.nextElementSibling as HTMLElement).textContent = inp.value; }));
    root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => inp.addEventListener('change', () => draw()));
    root.querySelectorAll<HTMLSelectElement>('select').forEach((sel) => sel.addEventListener('change', () => { apply(sel.dataset.k as keyof Settings, sel.value); sfx('select'); }));
    root.querySelector('[data-d=export]')?.addEventListener('click', () => {
      const blob = new Blob([exportSave()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wild-mystics-${state.profile.name}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      toast('Save exported.');
    });
    root.querySelector<HTMLInputElement>('[data-d=import]')?.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try { importSave(await f.text()); toast('Save imported — restarting…', 'good'); setTimeout(() => location.reload(), 900); } catch { toast('That file is not a valid save.', 'bad'); }
    });
    root.querySelector('[data-d=install]')?.addEventListener('click', () => void hooks.install());
    root.querySelector('[data-d=reset]')?.addEventListener('click', async () => {
      if (await confirmBox('Start over?', 'This permanently erases this account’s save on this device.', 'Erase save', true)) hooks.reset();
    });
  };
  draw();
}
