// 3D objective beacon: a DOM overlay projected with world.camera. On screen it is a magenta diamond
// with its distance and corner brackets that snap onto the target; off screen it becomes an arrow
// on the screen edge pointing the way. Breadcrumb chevrons on the ground lead from your feet toward it.
import * as THREE from 'three';
import type { Overworld } from '../world/world';
import { settings } from '../core/settings';
import { glyph } from './icons';
import { trackedTarget, distText, MARKER_STYLE } from './guidance';

const CRUMBS = 6;

export class Beacon {
  readonly el: HTMLElement;
  private mark: HTMLElement;
  private dist: HTMLElement;
  private label: HTMLElement;
  private edge: HTMLElement;
  private crumbs: HTMLElement[] = [];
  private v = new THREE.Vector3();
  private lastDist = '';
  private lastLabel = '';
  private t = 0;
  private W = innerWidth;
  private H = innerHeight;

  constructor(private world: Overworld) {
    this.el = document.createElement('div');
    this.el.className = 'beacon-layer';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `${Array.from({ length: CRUMBS }, () => `<i class="crumb">${glyph('chevU')}</i>`).join('')}
      <div class="bc"><span class="bc-br tl"></span><span class="bc-br tr"></span><span class="bc-br bl"></span><span class="bc-br br"></span>
        <span class="bc-gem">${glyph('diamond')}</span><span class="bc-tag"><b class="bc-dist"></b><span class="bc-label"></span></span></div>
      <div class="bc-edge"><span class="bc-arrow">${glyph('arrow')}</span><b class="bc-edist"></b></div>`;
    this.mark = this.el.querySelector('.bc')!;
    this.dist = this.el.querySelector('.bc-dist')!;
    this.label = this.el.querySelector('.bc-label')!;
    this.edge = this.el.querySelector('.bc-edge')!;
    this.crumbs = Array.from(this.el.querySelectorAll<HTMLElement>('.crumb'));
    addEventListener('resize', () => { this.W = innerWidth; this.H = innerHeight; });
  }

  private hide() {
    this.mark.classList.remove('on');
    this.edge.classList.remove('on');
    for (const c of this.crumbs) c.style.opacity = '0';
  }

  update(dt: number) {
    this.t += dt;
    const tt = trackedTarget();
    const w = this.world;
    if (!tt || w.battleMode || w.buildMode) { this.hide(); return; }
    const m = tt.marker;
    const cam = w.camera;
    const px = w.playerPos.x, pz = w.playerPos.z;
    const d = Math.hypot(m.x - px, m.z - pz);
    const y = m.y ?? w.data.heightAt(m.x, m.z) + 3.4;
    const color = MARKER_STYLE[m.kind]?.color ?? '#ff3d8b';
    this.el.style.setProperty('--bc', color);
    const dt2 = distText(d);
    if (dt2 !== this.lastDist) {
      this.lastDist = dt2;
      this.dist.textContent = dt2;
      (this.edge.querySelector('.bc-edist') as HTMLElement).textContent = dt2;
    }
    if (m.label !== this.lastLabel) { this.lastLabel = m.label; this.label.textContent = m.label; }

    const W = this.W, H = this.H;
    const small = H < 520;
    const top = small ? 60 : 96, side = small ? 48 : 64, bottom = small ? 64 : 88;
    this.v.set(m.x, y, m.z).project(cam);
    const behind = this.v.z > 1;
    let sx = (this.v.x * 0.5 + 0.5) * W, sy = (-this.v.y * 0.5 + 0.5) * H;
    const onScreen = !behind && sx > side && sx < W - side && sy > top && sy < H - bottom;
    const here = d < 7;
    if (onScreen && !here) {
      this.mark.classList.add('on');
      this.edge.classList.remove('on');
      const centred = Math.abs(sx - W / 2) < W * 0.22 && Math.abs(sy - H / 2) < H * 0.3;
      this.mark.classList.toggle('lock', centred);
      this.mark.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
    } else if (!here) {
      this.mark.classList.remove('on');
      this.edge.classList.add('on');
      // direction in camera space (works for points behind the camera too)
      this.v.set(m.x, y, m.z).applyMatrix4(cam.matrixWorldInverse);
      let dx = this.v.x, dy = -this.v.y;
      if (this.v.z > 0) { dy = Math.abs(dy) + H * 0.001; }
      if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) dy = 1;
      const ang = Math.atan2(dy, dx);
      const cx = W / 2, cy = (top + H - bottom) / 2;
      const hw = W / 2 - side, hh = (H - bottom - top) / 2;
      const k = Math.min(hw / Math.abs(Math.cos(ang) || 1e-6), hh / Math.abs(Math.sin(ang) || 1e-6));
      sx = cx + Math.cos(ang) * k;
      sy = cy + Math.sin(ang) * k;
      this.edge.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
      (this.edge.querySelector('.bc-arrow') as HTMLElement).style.transform = `rotate(${(ang * 180) / Math.PI + 90}deg)`;
    } else {
      this.mark.classList.remove('on');
      this.edge.classList.remove('on');
    }

    // breadcrumbs: chevrons on the ground from your feet toward the objective
    const show = settings.hints && d > 16 && !w.mount;
    if (!show) { for (const c of this.crumbs) c.style.opacity = '0'; return; }
    const ux = (m.x - px) / d, uz = (m.z - pz) / d;
    const pts: { x: number; y: number; depth: number; ok: boolean }[] = [];
    for (let i = 0; i <= CRUMBS; i++) {
      const s = 3 + i * 2.6;
      const cx = px + ux * s, cz = pz + uz * s, cy = w.data.heightAt(cx, cz) + 0.12;
      const depth = cam.position.distanceTo(this.v.set(cx, cy, cz));
      this.v.project(cam);
      pts.push({ x: (this.v.x * 0.5 + 0.5) * W, y: (-this.v.y * 0.5 + 0.5) * H, depth, ok: this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1 });
    }
    for (let i = 0; i < CRUMBS; i++) {
      const a = pts[i], b = pts[i + 1];
      const c = this.crumbs[i];
      if (!a.ok || !b.ok) { c.style.opacity = '0'; continue; }
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
      const wave = 0.35 + 0.65 * Math.max(0, Math.sin(this.t * 4 - i * 0.9));
      const fade = 1 - i / (CRUMBS + 1);
      const size = Math.max(0.4, Math.min(1.25, 11 / Math.max(1, a.depth)));
      c.style.opacity = (wave * fade * 0.9).toFixed(2);
      c.style.transform = `translate3d(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px,0) rotate(${ang.toFixed(0)}deg) scale(${size.toFixed(2)}, ${(size * 0.55).toFixed(2)})`;
    }
  }
}
