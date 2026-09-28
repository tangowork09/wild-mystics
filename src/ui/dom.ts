import { ZONES } from '../data/zones';
import { state } from '../game/state';
import { icon, glyph } from './icons';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as T[];

export function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const uiRoot = () => document.getElementById('ui')!;
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Toasts ──────────────────────────────────────────────────────────────────
const TOAST_IC: Record<string, string> = { good: icon('sparkles'), bad: glyph('bang'), quest: icon('quest_scroll'), rank: icon('crown'), loot: icon('gift'), '': icon('compass') };

export function toast(text: string, cls = '', ms = 2600) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = el('div', `toast ${cls}`, `<span class="t-ic">${TOAST_IC[cls] ?? TOAST_IC['']}</span><span class="t-tx">${text}</span>`);
  t.setAttribute('role', 'status');
  box.appendChild(t);
  const max = innerHeight < 520 ? 2 : 3;
  while (box.children.length > max) box.firstElementChild?.remove();
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => t.classList.remove('in'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** Region / event title card: a die-cut sticker slapped onto the view. Region names gain their level chip. */
export function titleCard(title: string, sub = '', ms = 2800) {
  const box = document.getElementById('titlecard');
  if (!box) return;
  const z = ZONES.find((x) => x.name === title);
  const chips = z
    ? `<div class="tc-chips"><span class="tag">Lv ${z.levels[0]}–${z.levels[1]}</span>${state.bosses.includes(z.id) ? `<span class="tag good">${icon('trophy')} Guardian answered</span>` : ''}</div>`
    : '';
  box.innerHTML = `<div class="tc-plate"><div class="tc-title">${title}</div>${sub ? `<div class="tc-sub">${sub}</div>` : ''}</div>${chips}`;
  box.classList.remove('in', 'out');
  void box.offsetWidth;
  box.classList.add('in');
  const b = box as HTMLElement & { _t?: number; _t2?: number };
  clearTimeout(b._t);
  clearTimeout(b._t2);
  b._t = window.setTimeout(() => box.classList.add('out'), ms);
  b._t2 = window.setTimeout(() => box.classList.remove('in', 'out'), ms + 520);
}
export function hideTitleCard() { document.getElementById('titlecard')?.classList.remove('in', 'out'); }

/** Screen transition. `shatter` snaps the capsule shut over the screen (battle start); clearFlash() opens it. */
export function flash(kind: 'white' | 'shatter' | 'fade' = 'white', ms = 600): Promise<void> {
  const f = document.getElementById('flash')!;
  f.className = '';
  void f.offsetWidth;
  f.className = `on ${kind}`;
  return new Promise((r) => setTimeout(r, ms));
}
export function clearFlash() { document.getElementById('flash')!.className = ''; }

// ── Modal stack: only the top-most modal reacts to Escape ───────────────────
const modalStack: (() => void)[] = [];
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !modalStack.length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  modalStack[modalStack.length - 1]();
}, true);
export const modalOpen = () => modalStack.length > 0;

/** Modal panel. Resolves when closed. `cls` names the panel family (e.g. "service svc-healer"). */
export function modal(cls: string, build: (body: HTMLElement, close: () => void) => void, onClose?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const wrap = el('div', `modal ${cls}`);
    const panel = el('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const x = el('button', 'x', glyph('close'));
    x.setAttribute('aria-label', 'Close');
    const body = el('div', 'body');
    panel.append(x, body);
    wrap.appendChild(panel);
    uiRoot().appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      const i = modalStack.indexOf(close);
      if (i >= 0) modalStack.splice(i, 1);
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 240);
      onClose?.();
      resolve();
    };
    modalStack.push(close);
    x.addEventListener('click', close);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    build(body, close);
  });
}

/** Confirm dialog. */
export function confirmBox(title: string, body: string, yes = 'Confirm', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    void modal('confirm', (b, close) => {
      b.innerHTML = `<h2>${title}</h2><p class="confirm-body">${body}</p>
        <div class="row-end"><button class="btn ghost" data-a="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${yes}</button></div>`;
      b.querySelector('[data-a=yes]')!.addEventListener('click', () => { answered = true; resolve(true); close(); });
      b.querySelector('[data-a=no]')!.addEventListener('click', () => close());
      requestAnimationFrame(() => (b.querySelector('[data-a=yes]') as HTMLElement | null)?.focus({ preventScroll: true }));
    }, () => { if (!answered) resolve(false); });
  });
}

export function bar(frac: number, cls = '') {
  return `<div class="bar ${cls}"><i style="--p:${Math.max(0, Math.min(1, frac)).toFixed(4)}"></i></div>`;
}

/** The layer that currently owns keyboard focus (top modal, else the journal, else the page). */
export function topLayer(): HTMLElement {
  const layers = $$('#ui > .modal, #ui > .journal, #ui > .screen, body > .screen');
  return layers[layers.length - 1] ?? document.body;
}

// ── Popover menu (filters, "More" actions): anchored, fits the viewport, never scrolls ─────────
export interface PopItem<T extends string> { value: T; label: string; icon?: string; on?: boolean; danger?: boolean; disabled?: boolean; color?: string }
export function popover<T extends string>(anchor: HTMLElement, items: PopItem<T>[], opts: { title?: string; cols?: number } = {}): Promise<T | null> {
  document.querySelector('.pop')?.dispatchEvent(new Event('pop-close'));
  return new Promise((resolve) => {
    const pop = el('div', 'pop');
    pop.setAttribute('role', 'menu');
    const cols = opts.cols ?? (items.length > 8 ? 2 : 1);
    pop.style.setProperty('--cols', String(cols));
    pop.innerHTML = `${opts.title ? `<div class="pop-t">${opts.title}</div>` : ''}<div class="pop-list">${items.map((it, i) => `<button role="menuitemradio" aria-checked="${!!it.on}" class="pop-i ${it.on ? 'on' : ''} ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''} ${it.color ? `style="--c:${it.color}"` : ''}>${it.icon ?? ''}<span>${it.label}</span></button>`).join('')}</div>`;
    uiRoot().appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const below = r.bottom + 8 + ph < innerHeight - 8;
    const x = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
    const y = below ? r.bottom + 8 : Math.max(8, r.top - 8 - ph);
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    pop.classList.add(below ? 'down' : 'up');
    requestAnimationFrame(() => pop.classList.add('in'));
    let done = false;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      removeEventListener('pointerdown', outside, true);
      removeEventListener('keydown', key, true);
      pop.classList.remove('in');
      setTimeout(() => pop.remove(), 160);
      resolve(v);
    };
    const outside = (e: Event) => { if (!pop.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) finish(null); };
    const btns = () => Array.from(pop.querySelectorAll<HTMLButtonElement>('.pop-i:not(:disabled)'));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(null); return; }
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const list = btns();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const d = e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : e.key === 'ArrowRight' ? 1 : -1;
        list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i + d)))]?.focus();
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', key, true);
    pop.addEventListener('pop-close', () => finish(null));
    pop.querySelectorAll<HTMLElement>('.pop-i').forEach((b) => b.addEventListener('click', () => finish(items[Number(b.dataset.i)].value)));
    requestAnimationFrame(() => (pop.querySelector<HTMLButtonElement>('.pop-i.on:not(:disabled)') ?? btns()[0])?.focus({ preventScroll: true }));
  });
}
