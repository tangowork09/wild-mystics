// Compass tape (top-centre): the heading scrolls under a fixed caret; quest, town and POI markers
// ride the tape by bearing, and the tracked objective clamps to the tape's edge with a chevron when
// it is behind you, so there is always an arrow to follow.
import type { Overworld } from '../world/world';
import type { Marker } from '../game/contracts';
import { glyph, icon } from './icons';
import { allMarkers, trackedTarget, bearingTo, headingOf, wrap180, distText, MARKER_STYLE } from './guidance';

const LABELS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

export class Compass {
  readonly el: HTMLElement;
  private strip: HTMLElement;
  private marks: HTMLElement;
  private pool = new Map<string, HTMLElement>();
  private width = 0;
  private ppd = 1;
  private fov = 150;
  private lastHeading = -1;
  private goalKey = '';

  constructor(private world: Overworld) {
    this.el = document.createElement('div');
    this.el.className = 'hud-compass';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `<div class="cp-tape"><div class="cp-strip"></div></div><div class="cp-marks"></div><div class="cp-caret">${glyph('caret')}</div>`;
    this.strip = this.el.querySelector('.cp-strip')!;
    this.marks = this.el.querySelector('.cp-marks')!;
  }

  private build() {
    const w = this.el.querySelector<HTMLElement>('.cp-tape')!.clientWidth;
    if (!w || w === this.width) return;
    this.width = w;
    this.fov = w < 340 ? 130 : 150;
    this.ppd = w / this.fov;
    const parts: string[] = [];
    for (let d = -360; d <= 720; d += 15) {
      const n = ((d % 360) + 360) % 360;
      const x = (d + 360) * this.ppd;
      const lab = LABELS[n];
      if (lab) parts.push(`<span class="cp-lab ${lab.length === 1 ? 'card' : 'inter'}" style="left:${x}px">${lab}</span>`);
      else parts.push(`<i class="cp-tick ${n % 45 === 0 ? 'big' : ''}" style="left:${x}px"></i>`);
    }
    this.strip.innerHTML = parts.join('');
    this.lastHeading = -1;
  }

  update() {
    this.build();
    if (!this.width) return;
    const w = this.world;
    const heading = headingOf(w.camYaw);
    if (Math.abs(heading - this.lastHeading) > 0.05) {
      this.lastHeading = heading;
      this.strip.style.transform = `translate3d(${this.width / 2 - (heading + 360) * this.ppd}px,0,0)`;
    }
    const px = w.playerPos.x, pz = w.playerPos.z;
    const tracked = trackedTarget();
    const half = this.fov / 2;
    const used = new Set<string>();
    const place = (m: Marker, key: string, isGoal: boolean) => {
      const d = Math.hypot(m.x - px, m.z - pz);
      const st = MARKER_STYLE[m.kind];
      if (!isGoal && (d > st.compass || d < 6)) return;
      let rel = wrap180(bearingTo(px, pz, m.x, m.z) - heading);
      const off = Math.abs(rel) > half - 4;
      if (off && !isGoal) return;
      if (off) rel = Math.sign(rel) * (half - 4);
      let e = this.pool.get(key);
      if (!e) {
        e = document.createElement('span');
        e.className = `cp-m k-${m.kind}${isGoal ? ' goal' : ''}`;
        e.style.setProperty('--c', st.color);
        e.innerHTML = `<span class="cp-dot">${st.glyph ? glyph(st.icon) : icon(st.icon)}</span>${isGoal ? '<span class="cp-dist"></span>' : ''}`;
        this.marks.appendChild(e);
        this.pool.set(key, e);
      }
      e.classList.toggle('off', off);
      e.classList.toggle('left', off && rel < 0);
      e.style.transform = `translate3d(${this.width / 2 + rel * this.ppd}px,0,0)`;
      if (isGoal) {
        const t = distText(d);
        if (t !== this.goalKey) { this.goalKey = t; (e.querySelector('.cp-dist') as HTMLElement).textContent = t; }
      }
      used.add(key);
    };
    for (const m of allMarkers()) {
      if (tracked && m.id === tracked.marker.id && m.kind === tracked.marker.kind) continue;
      place(m, `${m.kind}:${m.id}`, false);
    }
    if (tracked) place(tracked.marker, `goal:${tracked.marker.kind}:${tracked.marker.id}`, true);
    for (const [k, e] of this.pool) if (!used.has(k)) { e.remove(); this.pool.delete(k); if (k.startsWith('goal:')) this.goalKey = ''; }
  }
}
