// Minimap: a capsule window onto the painted map (north up), fogged where you have not been, with
// quest/POI markers, roaming Mystics, your heading and camera cone, and a rim arrow that keeps
// pointing at the tracked objective when it is outside the window.
import { ZONES, WORLD_SIZE, HOMESTEAD } from '../data/zones';
import { ELEMENTS } from '../data/elements';
import { SPECIES } from '../data/species';
import { state } from '../game/state';
import type { Overworld } from '../world/world';
import { canvasIcon } from './icons';
import { allMarkers, trackedTarget, MARKER_STYLE } from './guidance';
import { worldBase, fogLayer } from './worldbase';

export interface TravelPoint { id: string; label: string; kind: 'town' | 'camp' | 'waystone' | 'homestead'; x: number; z: number; zone: string }

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private css = 0;
  private dpr = 1;
  private t = 0;

  constructor(readonly world: Overworld, host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    this.canvas.setAttribute('aria-label', 'Minimap');
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    worldBase(world);
  }

  /** Fast-travel destinations the player has attuned (towns, camps, waystones) plus home. */
  travelPoints(): TravelPoint[] {
    const out: TravelPoint[] = [];
    for (const z of ZONES) {
      if (state.waypoints.includes(`${z.id}-town`)) out.push({ id: `${z.id}-town`, label: z.town.name, kind: 'town', x: z.town.pos[0], z: z.town.pos[1], zone: z.id });
      if (state.waypoints.includes(`${z.id}-camp`)) out.push({ id: `${z.id}-camp`, label: `${z.name} camp`, kind: 'camp', x: z.camp[0], z: z.camp[1], zone: z.id });
    }
    for (const w of this.world.landmarks.waystones) {
      if (state.waypoints.includes(w.id)) out.push({ id: w.id, label: `${w.zone.name} Waystone`, kind: 'waystone', x: w.pos.x, z: w.pos.z, zone: w.zone.id });
    }
    out.push({ id: 'homestead', label: 'Your Homestead', kind: 'homestead', x: HOMESTEAD.center[0] - HOMESTEAD.radius - 3, z: HOMESTEAD.center[1], zone: 'vale' });
    return out;
  }

  private fit() {
    const css = Math.round(this.canvas.clientWidth);
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (css && (css !== this.css || dpr !== this.dpr)) {
      this.css = css;
      this.dpr = dpr;
      this.canvas.width = this.canvas.height = Math.round(css * dpr);
    }
  }

  draw(dt = 0.016) {
    this.fit();
    const S = this.css;
    if (!S) return;
    this.t += dt;
    const c = this.ctx;
    const w = this.world;
    const tower = state.base.structures.some((s) => s.type === 'watchtower');
    const view = tower ? 260 : 190;
    const p = w.playerPos;
    const k = S / view;
    const P = (x: number, z: number): [number, number] => [(x - p.x) * k + S / 2, (z - p.z) * k + S / 2];
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, S, S);
    c.save();
    roundRect(c, 0, 0, S, S, S * 0.22);
    c.clip();
    c.fillStyle = '#10151d';
    c.fillRect(0, 0, S, S);
    const base = worldBase(w);
    const bs = base.width / WORLD_SIZE;
    const sx = (p.x + WORLD_SIZE / 2 - view / 2) * bs, sy = (p.z + WORLD_SIZE / 2 - view / 2) * bs;
    c.imageSmoothingEnabled = true;
    c.drawImage(base, sx, sy, view * bs, view * bs, 0, 0, S, S);
    const fog = fogLayer();
    if (fog) {
      const fs = fog.width / WORLD_SIZE;
      c.globalAlpha = 0.94;
      c.drawImage(fog, (p.x + WORLD_SIZE / 2 - view / 2) * fs, (p.z + WORLD_SIZE / 2 - view / 2) * fs, view * fs, view * fs, 0, 0, S, S);
      c.globalAlpha = 1;
    }
    if (w.atmo.night > 0.3) { c.fillStyle = `rgba(8,12,34,${w.atmo.night * 0.32})`; c.fillRect(0, 0, S, S); }

    // roaming Mystics
    for (const m of w.wilds.list) {
      if (m.fade < 0.5) continue;
      const [x, y] = P(m.pos.x, m.pos.z);
      if (x < -4 || y < -4 || x > S + 4 || y > S + 4) continue;
      const sp = SPECIES[m.species];
      c.beginPath();
      c.arc(x, y, sp.rarity === 'common' ? 2.6 : 3.6, 0, Math.PI * 2);
      c.fillStyle = ELEMENTS[sp.element].color;
      c.fill();
      c.lineWidth = 1.2;
      c.strokeStyle = m.shiny ? '#ffffff' : 'rgba(6,8,12,0.8)';
      c.stroke();
    }

    // markers (tracked objective drawn last, on top)
    const tracked = trackedTarget();
    const r = Math.max(6.5, S * 0.045);
    for (const m of allMarkers()) {
      if (tracked && m.id === tracked.marker.id && m.kind === tracked.marker.kind) continue;
      const [x, y] = P(m.x, m.z);
      if (x < -r || y < -r || x > S + r || y > S + r) continue;
      const st = MARKER_STYLE[m.kind];
      pin(c, x, y, r * (st.prio >= 8 ? 1.1 : 0.92), st.color, st.icon);
    }
    if (tracked) {
      const m = tracked.marker;
      let [x, y] = P(m.x, m.z);
      const inset = r + 5;
      const inside = x > inset && y > inset && x < S - inset && y < S - inset;
      const pulse = 1 + Math.sin(this.t * 4) * 0.08;
      if (inside) {
        c.beginPath();
        c.arc(x, y, r * 2.1 * pulse, 0, Math.PI * 2);
        c.fillStyle = 'rgba(255,61,139,0.22)';
        c.fill();
        pin(c, x, y, r * 1.25, MARKER_STYLE[m.kind].color, MARKER_STYLE[m.kind].icon);
      } else {
        // clamp to the rim and point outwards
        const ang = Math.atan2(y - S / 2, x - S / 2);
        const t = Math.min((S / 2 - inset) / Math.abs(Math.cos(ang) || 1e-6), (S / 2 - inset) / Math.abs(Math.sin(ang) || 1e-6));
        x = S / 2 + Math.cos(ang) * t;
        y = S / 2 + Math.sin(ang) * t;
        c.save();
        c.translate(x, y);
        c.rotate(ang);
        c.beginPath();
        c.moveTo(r * 1.5, 0); c.lineTo(-r * 0.7, -r * 1.05); c.lineTo(-r * 0.25, 0); c.lineTo(-r * 0.7, r * 1.05); c.closePath();
        c.fillStyle = MARKER_STYLE[m.kind].color;
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = '#06080c';
        c.stroke();
        c.restore();
      }
    }

    // camera cone + player arrow
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(-w.camYaw);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, S * 0.36);
    g.addColorStop(0, 'rgba(247,243,234,0.32)');
    g.addColorStop(1, 'rgba(247,243,234,0)');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, S * 0.36, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); c.closePath(); c.fill();
    c.restore();
    c.save();
    c.translate(S / 2, S / 2);
    c.rotate(-w.player.root.rotation.y + Math.PI);
    const a = Math.max(7, S * 0.05);
    c.beginPath(); c.moveTo(0, -a * 1.3); c.lineTo(a, a); c.lineTo(0, a * 0.45); c.lineTo(-a, a); c.closePath();
    c.fillStyle = '#ffffff';
    c.fill();
    c.lineWidth = 2.2;
    c.strokeStyle = '#06080c';
    c.stroke();
    c.restore();
    c.restore();
  }
}

/** Marker pin: coloured capsule dot with an ink keyline and an ink icon. */
export function pin(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, iconName: string) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
  c.lineWidth = 1.8;
  c.strokeStyle = '#06080c';
  c.stroke();
  canvasIcon(c, iconName, x, y, r * 1.25, '#06080c');
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
