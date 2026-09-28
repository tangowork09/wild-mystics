// Paginated grid/list sized from its container: nothing ever scrolls. It measures the box it is
// given, fits as many fixed-height cells as the box holds, and pages the rest (arrows, dots,
// swipe, mouse wheel, `[` `]` / PageUp PageDown keys, and ← → ↑ ↓ to move the selection).
import { topLayer, reducedMotion } from './dom';
import { glyph } from './icons';

export interface PagerOpts<T> {
  items: T[];
  /** Minimum cell width and exact cell height in px. */
  cell: { w: number; h: number };
  gap?: number;
  render(item: T, index: number): string;
  /** Tap / Enter on a cell (cells become buttons). */
  onPick?(item: T, index: number): void;
  selected?(item: T, index: number): boolean;
  /** HTML shown when there are no items. */
  empty?: string | (() => string);
  /** Page with [ ] / PageUp PageDown and move the selection with arrow keys (default true). */
  keys?: boolean;
  /** Wins the keyboard over other pagers in the same layer. */
  primary?: boolean;
  maxCols?: number;
  maxRows?: number;
  /** Stretch rows to fill the available height instead of top-aligning them. */
  stretch?: boolean;
  cellClass?: string;
  label?: string;
  onPage?(page: number, pages: number): void;
}

const live = new Set<Pager<unknown>>();

export class Pager<T> {
  readonly el: HTMLElement;
  private view: HTMLElement;
  private grid: HTMLElement;
  private barEl: HTMLElement;
  private dots: HTMLElement;
  private ro: ResizeObserver;
  page = 0;
  cols = 1;
  rows = 1;
  per = 1;
  private measured = false;
  private swipe: { x: number; y: number; id: number } | null = null;
  private swiped = false;
  private wheelAcc = 0;
  private wheelAt = 0;

  constructor(host: HTMLElement, private o: PagerOpts<T>) {
    this.el = document.createElement('div');
    this.el.className = 'pager';
    if (o.label) this.el.setAttribute('aria-label', o.label);
    this.el.innerHTML = `<div class="pg-view"><div class="pg-grid" role="list"></div></div>
      <div class="pg-bar" hidden><button class="pg-btn" data-pg="-1" aria-label="Previous page" title="Previous page ( [ )">${glyph('chevL')}</button><div class="pg-dots"></div><button class="pg-btn" data-pg="1" aria-label="Next page" title="Next page ( ] )">${glyph('chevR')}</button></div>`;
    host.appendChild(this.el);
    this.view = this.el.querySelector('.pg-view')!;
    this.grid = this.el.querySelector('.pg-grid')!;
    this.barEl = this.el.querySelector('.pg-bar')!;
    this.dots = this.el.querySelector('.pg-dots')!;
    this.barEl.querySelectorAll<HTMLElement>('[data-pg]').forEach((b) => b.addEventListener('click', () => this.go(this.page + Number(b.dataset.pg), Number(b.dataset.pg) as 1 | -1)));
    this.dots.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
      if (b) this.go(Number(b.dataset.p));
    });
    this.grid.addEventListener('click', (e) => {
      if (this.swiped) { e.stopPropagation(); e.preventDefault(); this.swiped = false; return; }
      const t = e.target as HTMLElement;
      if (!this.o.onPick || t.closest('[data-nopick]')) return;
      const c = t.closest<HTMLElement>('.pg-cell');
      if (!c) return;
      const i = Number(c.dataset.i);
      this.o.onPick(this.o.items[i], i);
    }, true);
    this.view.addEventListener('pointerdown', (e) => { if (this.pages > 1) this.swipe = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    this.view.addEventListener('pointerup', (e) => {
      const s = this.swipe;
      this.swipe = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        this.swiped = true;
        setTimeout(() => (this.swiped = false), 60);
        this.go(this.page + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      }
    });
    this.view.addEventListener('wheel', (e) => {
      if (this.pages <= 1) return;
      const now = performance.now();
      if (now - this.wheelAt > 400) this.wheelAcc = 0;
      this.wheelAt = now;
      this.wheelAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(this.wheelAcc) > 70) {
        const d = this.wheelAcc > 0 ? 1 : -1;
        this.wheelAcc = -d * 200; // cooldown: one page per flick
        this.go(this.page + d, d);
      }
    }, { passive: true });
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.el);
    live.add(this as Pager<unknown>);
    this.layout();
  }

  get items() { return this.o.items; }
  get pages() { return Math.max(1, Math.ceil(this.o.items.length / this.per)); }

  /** Replace the items; keeps the current page when possible, or jumps to `focus`. */
  setItems(items: T[], focus?: number) {
    this.o.items = items;
    if (focus !== undefined && focus >= 0) this.page = Math.floor(focus / this.per);
    this.layout(true);
  }

  /** Re-render the visible page (after a selection change). */
  refresh() { this.render(0); }

  showIndex(i: number) {
    if (i < 0) return;
    const p = Math.floor(i / this.per);
    if (p !== this.page) this.go(p, p > this.page ? 1 : -1);
  }

  go(p: number, dir: 1 | -1 | 0 = 0) {
    const n = Math.max(0, Math.min(this.pages - 1, p));
    if (n === this.page) return;
    const d = dir || (n > this.page ? 1 : -1);
    this.page = n;
    this.render(d);
    this.o.onPage?.(this.page, this.pages);
  }

  destroy() {
    this.ro.disconnect();
    live.delete(this as Pager<unknown>);
    this.el.remove();
  }

  get isLive() { return this.el.isConnected && this.el.getClientRects().length > 0; }
  get wantsKeys() { return this.o.keys !== false; }
  get isPrimary() { return !!this.o.primary; }

  private layout(force = false) {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;
    const gap = this.o.gap ?? 8;
    const { w, h } = this.o.cell;
    const cols = Math.max(1, Math.min(this.o.maxCols ?? 99, Math.floor((W + gap) / (w + gap))));
    const fullRows = Math.max(1, Math.min(this.o.maxRows ?? 99, Math.floor((H + gap) / (h + gap))));
    let rows = fullRows;
    const needBar = this.o.items.length > cols * fullRows;
    if (needBar) {
      this.barEl.hidden = false;
      const barH = this.barEl.offsetHeight + 6;
      rows = Math.max(1, Math.min(this.o.maxRows ?? 99, Math.floor((H - barH + gap) / (h + gap))));
    } else this.barEl.hidden = true;
    const per = cols * rows;
    const first = this.page * this.per;
    const changed = !this.measured || cols !== this.cols || rows !== this.rows;
    this.cols = cols;
    this.rows = rows;
    this.per = per;
    this.measured = true;
    if (changed) this.page = Math.floor(first / per);
    this.page = Math.max(0, Math.min(this.pages - 1, this.page));
    this.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    this.grid.style.gridAutoRows = this.o.stretch ? `calc((100% - ${(rows - 1) * gap}px) / ${rows})` : `${h}px`;
    this.grid.style.gap = `${gap}px`;
    if (changed || force) this.render(0);
  }

  private render(dir: number) {
    if (!this.measured) return;
    const items = this.o.items;
    const start = this.page * this.per;
    const slice = items.slice(start, start + this.per);
    const tag = this.o.onPick ? 'button' : 'div';
    if (!items.length) {
      this.grid.innerHTML = '';
      this.view.querySelector('.pg-empty')?.remove();
      const empty = typeof this.o.empty === 'function' ? this.o.empty() : this.o.empty;
      if (empty) this.view.insertAdjacentHTML('beforeend', `<div class="pg-empty">${empty}</div>`);
    } else {
      this.view.querySelector('.pg-empty')?.remove();
      this.grid.innerHTML = slice.map((it, k) => {
        const i = start + k;
        const sel = this.o.selected?.(it, i) ? ' sel' : '';
        return `<${tag} class="pg-cell ${this.o.cellClass ?? ''}${sel}" role="listitem" data-i="${i}"${tag === 'button' ? ' type="button"' : ''}${sel ? ' aria-current="true"' : ''}>${this.o.render(it, i)}</${tag}>`;
      }).join('');
    }
    if (dir && !reducedMotion()) {
      this.grid.classList.remove('slide-l', 'slide-r');
      void this.grid.offsetWidth;
      this.grid.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
    }
    const pages = this.pages;
    (this.barEl.querySelector('[data-pg="-1"]') as HTMLButtonElement).disabled = this.page <= 0;
    (this.barEl.querySelector('[data-pg="1"]') as HTMLButtonElement).disabled = this.page >= pages - 1;
    this.dots.innerHTML = pages <= 8
      ? Array.from({ length: pages }, (_, p) => `<button data-p="${p}" class="${p === this.page ? 'on' : ''}" aria-label="Page ${p + 1}"><i></i></button>`).join('')
      : `<span class="pg-count">${this.page + 1} / ${pages}</span>`;
  }

  /** Move the selection by d cells (arrow keys). Returns true when handled. */
  moveSelection(dx: number, dy: number) {
    if (!this.o.selected || !this.o.onPick) return false;
    const items = this.o.items;
    let cur = items.findIndex((it, i) => this.o.selected!(it, i));
    if (cur < 0) cur = this.page * this.per;
    const next = Math.max(0, Math.min(items.length - 1, cur + dx + dy * this.cols));
    if (next === cur) return true;
    this.showIndex(next);
    this.o.onPick(items[next], next);
    return true;
  }
}

function activePager(): Pager<unknown> | null {
  const layer = topLayer();
  let best: Pager<unknown> | null = null;
  for (const p of live) {
    if (!p.isLive || !p.wantsKeys || !layer.contains(p.el)) continue;
    if (p.isPrimary || !best || !best.isPrimary) best = p;
  }
  return best;
}

addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  const pageKey = k === '[' || k === ']' || k === 'PageUp' || k === 'PageDown';
  const arrow = k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown';
  if (!pageKey && !arrow) return;
  if (document.querySelector('.dialog-box, .b-results, .summon-fx, .cine')) return;
  const p = activePager();
  if (!p) return;
  let handled = false;
  if (pageKey) {
    const d = k === ']' || k === 'PageDown' ? 1 : -1;
    p.go(p.page + d, d);
    handled = true;
  } else {
    handled = p.moveSelection(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0);
  }
  if (handled) { e.preventDefault(); e.stopPropagation(); }
});
