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
  const t = el('div', `toast ${cls}`, text);
  box.appendChild(t);
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

export function flash(kind: 'white' | 'shatter' | 'fade' = 'white', ms = 600): Promise<void> {
  const f = document.getElementById('flash')!;
  f.className = '';
  void f.offsetWidth;
  f.className = `on ${kind}`;
  return new Promise((r) => setTimeout(() => { r(); }, ms));
}
export function clearFlash() { document.getElementById('flash')!.className = ''; }

/** Modal panel. Resolves when closed. */
export function modal(cls: string, build: (body: HTMLElement, close: () => void) => void, onClose?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const wrap = el('div', `modal ${cls}`);
    const panel = el('div', 'panel');
    const x = el('button', 'x', '✕');
    const body = el('div', 'body');
    panel.append(x, body);
    wrap.appendChild(panel);
    uiRoot().appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => {
      removeEventListener('keydown', key, true);
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 250);
      onClose?.();
      resolve();
    };
    x.addEventListener('click', close);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    addEventListener('keydown', key, true);
    build(body, close);
  });
}

export function bar(frac: number, cls = '') {
  return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></i></div>`;
}
