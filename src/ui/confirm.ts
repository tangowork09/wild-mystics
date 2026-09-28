// Ornate confirm ("are you sure?") modal: gilded frame, compass crest, painted art, ruby/gold buttons.
// Every serious choice in the game goes through here so they all look and behave the same:
// new journey, delete/overwrite save, release, reset settings, sign out, demolish, Guardian challenge.
// Art: src/assets/confirm/<key>.webp (painted, transparent); a species id shows that Mystic instead.
import { SPECIES } from '../data/species';
import { ELEMENTS } from '../data/elements';
import { portrait } from '../assets/manifest';
import { modal } from './dom';
import { esc } from './kit';
import { ensureOrnamentDefs, STAR, CREST, CORNERS, MARK, WARN, SPARK } from './ornaments';

export type ConfirmArt = 'journey' | 'erase' | 'abandon' | 'settings' | 'logout' | 'overwrite' | 'demolish' | 'challenge';
export interface ConfirmOpts {
  /** Plain part of the title ("Start a new"). */
  title: string;
  /** Gold part of the title ("journey?"). */
  accent?: string;
  /** Body copy (HTML allowed; escape user text). */
  body: string;
  yes: string;
  no?: string;
  /** ruby = destructive (default), gold = serious but not destructive. */
  tone?: 'ruby' | 'gold';
  /** Red warning pill. Defaults to "This action cannot be undone." for ruby; false hides it. */
  warn?: string | false;
  art?: ConfirmArt;
  /** Species id: paint this Mystic as the art (release, Guardian challenge). */
  face?: string;
  shiny?: boolean;
}

const ART = import.meta.glob<string>('../assets/confirm/*.webp', { eager: true, query: '?url', import: 'default' });
const artUrl = (k: ConfirmArt) => ART[`../assets/confirm/${k}.webp`];

// Painted art stand-in until the illustration exists: the compass star on a glow.
const FALLBACK = `<svg class="rt-fallback" viewBox="96 0 108 124" aria-hidden="true">${STAR}<polygon points="150,46 161,62 150,78 139,62" fill="url(#rt-gem)"/></svg>`;

function artHTML(o: ConfirmOpts) {
  if (o.face && SPECIES[o.face]) {
    const col = ELEMENTS[SPECIES[o.face].element].color;
    return `<div class="rt-art rt-face" style="--el:${col}"><img src="${portrait(o.face, o.shiny)}" alt=""></div>`;
  }
  const url = o.art ? artUrl(o.art) : undefined;
  return `<div class="rt-art">${url ? `<img src="${url}" alt="">` : FALLBACK}</div>`;
}

/** Ask a yes/no question in the ornate modal. Resolves true only on the confirm button. */
export function confirmModal(o: ConfirmOpts): Promise<boolean> {
  ensureOrnamentDefs();
  const tone = o.tone ?? 'ruby';
  const warn = o.warn === undefined ? (tone === 'ruby' ? 'This action cannot be undone.' : false) : o.warn;
  return new Promise((resolve) => {
    let answered = false;
    void modal(`rite ${tone}`, (b, close) => {
      const panel = b.parentElement!;
      panel.setAttribute('role', 'alertdialog');
      panel.setAttribute('aria-labelledby', 'rt-title');
      panel.setAttribute('aria-describedby', 'rt-desc');
      panel.insertAdjacentHTML('afterbegin', `${MARK}${CORNERS}${CREST}`);
      b.innerHTML = `${artHTML(o)}
        <div class="rt-main">
          <h2 class="rt-t" id="rt-title">${o.title}${o.accent ? ` <em>${o.accent}</em>` : ''}</h2>
          <div class="rt-rule">${SPARK}</div>
          <p class="rt-body" id="rt-desc">${o.body}</p>
          ${warn ? `<p class="rt-warn">${WARN}<span>${warn}</span></p>` : ''}
        </div>
        <div class="rt-btns">
          <button class="rt-btn rt-no" data-a="no">${esc(o.no ?? 'Cancel')}</button>
          <button class="rt-btn rt-yes" data-a="yes"><i class="rt-gem l"></i>${esc(o.yes)}<i class="rt-gem r"></i></button>
        </div>`;
      b.querySelector('[data-a=yes]')!.addEventListener('click', () => { answered = true; resolve(true); close(); });
      b.querySelector('[data-a=no]')!.addEventListener('click', () => close());
      // destructive: the safe answer has focus, so a stray Enter never erases anything
      requestAnimationFrame(() => (b.querySelector(tone === 'ruby' ? '[data-a=no]' : '[data-a=yes]') as HTMLElement | null)?.focus({ preventScroll: true }));
    }, () => { if (!answered) resolve(false); });
  });
}

// ── The game's confirms, worded once ────────────────────────────────────────
export const confirmNewJourney = () => confirmModal({
  art: 'journey', title: 'Start a new', accent: 'journey?', body: 'Your current journey will be permanently erased.', yes: 'Start over',
});
export const confirmDeleteSave = () => confirmModal({
  art: 'erase', title: 'Delete this', accent: 'save?', body: 'This account’s journey on this device will be permanently erased.', yes: 'Delete save',
});
export const confirmOverwriteSave = (source = 'The backup file') => confirmModal({
  art: 'overwrite', title: 'Overwrite your', accent: 'save?', body: `${source} will replace the journey on this device.`, yes: 'Overwrite',
});
export const confirmAbandon = (where: string) => confirmModal({
  art: 'abandon', title: 'Abandon this', accent: 'expedition?', body: `You’ll leave ${where}. Anything found since your last rest is lost.`, yes: 'Abandon',
});
export const confirmRelease = (name: string, species: string, shiny = false) => confirmModal({
  face: species, shiny, title: 'Release', accent: `${esc(name)}?`, body: `${esc(name)} will return to the wild. You’ll receive 5 Mystic Essence.`, yes: 'Release',
});
export const confirmResetSettings = () => confirmModal({
  art: 'settings', title: 'Reset all', accent: 'settings?', body: 'Graphics, sound, controls and gameplay go back to their defaults.', warn: 'Your custom settings will be lost.', yes: 'Reset',
});
export const confirmLogout = (guest: boolean) => confirmModal({
  art: 'logout', title: 'Sign', accent: 'out?', yes: 'Sign out',
  body: guest ? 'Guest progress stays on this device. Sign in as guest again to continue it.' : 'Your journey is saved to your account. Sign in on any device to continue.',
  warn: guest ? 'Guest progress is not backed up online.' : false,
});
export const confirmDemolish = (name: string) => confirmModal({
  art: 'demolish', title: 'Demolish', accent: `${esc(name)}?`, body: 'You get back half of the build cost. Residents return to storage.', yes: 'Demolish',
});
export const confirmChallenge = (o: { species: string; name: string; zone: string; level: number; underLevelled: boolean }) => confirmModal({
  face: o.species, tone: 'gold', title: 'Challenge', accent: `${esc(o.name)}?`, yes: 'Challenge', no: 'Not yet',
  body: `Guardian of ${esc(o.zone)} · Lv ${o.level}. Guardian battles can’t be fled.`,
  warn: o.underLevelled ? 'Your team may be under-levelled.' : false,
});

/** Test hook for the screenshot harness. */
export const CONFIRM_DEMOS: Record<string, () => Promise<boolean>> = {
  journey: confirmNewJourney, erase: confirmDeleteSave, overwrite: () => confirmOverwriteSave(), abandon: () => confirmAbandon('the Sunken Vault'),
  release: () => confirmRelease('Fawnlet', 'fawnlet'), settings: confirmResetSettings, logout: () => confirmLogout(true),
  demolish: () => confirmDemolish('Ember Forge'), challenge: () => confirmChallenge({ species: 'reefwarden', name: 'Reefwarden', zone: 'Mirror Lakes', level: 18, underLevelled: true }),
};
