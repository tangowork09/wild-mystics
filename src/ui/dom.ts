import { icon } from './icons';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as T[];

export function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const uiRoot = () => document.getElementById('ui')!;

export function toast(text: string, cls = '', ms = 2600) {
  const box = document.getElementById('toasts')!;
  const ic = cls === 'good' ? 'sparkles' : cls === 'bad' ? 'skull' : cls === 'quest' ? 'quest_scroll' : cls === 'rank' ? 'crown' : cls === 'loot' ? 'gift' : 'compass';
  const t = el('div', `toast ${cls}`, `<span class="t-ic">${icon(ic)}</span><span class="t-tx">${text}</span>`);
  box.appendChild(t);
  while (box.children.length > 4) box.firstElementChild?.remove();
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => t.classList.remove('in'), ms);
  setTimeout(() => t.remove(), ms + 500);
}

/** Big E33-style location / event title card. */
export function titleCard(title: string, sub = '', ms = 2800) {
  const box = document.getElementById('titlecard')!;
  box.innerHTML = `<div class="tc-line"></div><div class="tc-title">${title}</div>${sub ? `<div class="tc-sub">${sub}</div>` : ''}<div class="tc-line"></div>`;
  box.classList.remove('in');
  void box.offsetWidth;
  box.classList.add('in');
  clearTimeout((box as HTMLElement & { _t?: number })._t);
  (box as HTMLElement & { _t?: number })._t = window.setTimeout(() => box.classList.remove('in'), ms);
}
export function hideTitleCard() { document.getElementById('titlecard')?.classList.remove('in'); }

export function flash(kind: 'white' | 'shatter' | 'fade' = 'white', ms = 600): Promise<void> {
  const f = document.getElementById('flash')!;
  f.className = '';
  void f.offsetWidth;
  f.className = `on ${kind}`;
  return new Promise((r) => setTimeout(() => { r(); }, ms));
}
export function clearFlash() { document.getElementById('flash')!.className = ''; }

// Modal stack: only the top-most modal reacts to Escape (nested pickers inside services, journal, etc.).
const modalStack: (() => void)[] = [];
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !modalStack.length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  modalStack[modalStack.length - 1]();
}, true);
export const modalOpen = () => modalStack.length > 0;

/** Modal panel. Resolves when closed. */
export function modal(cls: string, build: (body: HTMLElement, close: () => void) => void, onClose?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const wrap = el('div', `modal ${cls}`);
    const panel = el('div', 'panel');
    const x = el('button', 'x', '✕');
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
      setTimeout(() => wrap.remove(), 250);
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
      b.innerHTML = `<h2>${title}</h2><p class="confirm-body">${body}</p><div class="row-end"><button class="btn ghost" data-a="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${yes}</button></div>`;
      b.querySelector('[data-a=yes]')!.addEventListener('click', () => { answered = true; resolve(true); close(); });
      b.querySelector('[data-a=no]')!.addEventListener('click', () => close());
    }, () => { if (!answered) resolve(false); });
  });
}

export function bar(frac: number, cls = '') {
  return `<div class="bar ${cls}"><i style="--p:${Math.max(0, Math.min(1, frac)).toFixed(4)}"></i></div>`;
}
