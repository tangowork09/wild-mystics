import { ZONES, WORLD_SIZE, WATER_LEVEL, HOMESTEAD } from '../data/zones';
import { ELEMENTS } from '../data/elements';
import { SPECIES } from '../data/species';
import { state } from '../game/state';
import type { Overworld } from '../world/world';
import { icon } from './icons';

// Pre-rendered relief map (colour map + water + hillshade), then markers drawn per frame.

export interface TravelPoint { id: string; label: string; kind: 'town' | 'camp' | 'waystone' | 'homestead'; x: number; z: number; zone: string }

export class Minimap {
  private base: HTMLCanvasElement;
  private mini: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private S = 512;

  constructor(readonly world: Overworld, host: HTMLElement) {
    const S = this.S;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = S;
    const g = this.base.getContext('2d')!;
    g.drawImage(world.data.colorMap, 0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    const H = WORLD_SIZE / 2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const wx = -H + (x / (S - 1)) * WORLD_SIZE, wz = -H + (y / (S - 1)) * WORLD_SIZE;
        const h = world.data.heightAt(wx, wz);
        const hx = world.data.heightAt(wx + 1.5, wz) - h;
        const hz = world.data.heightAt(wx, wz + 1.5) - h;
        const shade = Math.max(0.55, Math.min(1.35, 1 - (hx * 0.7 + hz * 0.7) * 0.35));
        const o = (y * S + x) * 4;
        let r = img.data[o] * shade, gg = img.data[o + 1] * shade, b = img.data[o + 2] * shade;
        if (h < WATER_LEVEL) {
          const lava = world.data.lavaAt(wx, wz) > 0.5;
          const d = Math.min(1, (WATER_LEVEL - h) / 4);
          if (lava) { r = 240 - d * 60; gg = 100 - d * 50; b = 30; }
          else { r = 70 - d * 40; gg = 150 - d * 60; b = 190 - d * 40; }
        }
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b;
      }
    }
    g.putImageData(img, 0, 0);
    this.mini = document.createElement('canvas');
    this.mini.width = this.mini.height = 200;
    this.mini.className = 'minimap-canvas';
    host.appendChild(this.mini);
    this.ctx = this.mini.getContext('2d')!;
  }

  travelPoints(): TravelPoint[] {
    const out: TravelPoint[] = [];
    for (const z of ZONES) {
      if (state.waypoints.includes(`${z.id}-town`)) out.push({ id: `${z.id}-town`, label: z.town.name, kind: 'town', x: z.town.pos[0], z: z.town.pos[1], zone: z.id });
      if (state.waypoints.includes(`${z.id}-camp`)) out.push({ id: `${z.id}-camp`, label: `${z.name} Flag`, kind: 'camp', x: z.camp[0], z: z.camp[1], zone: z.id });
    }
    for (const w of this.world.landmarks.waystones) {
      if (state.waypoints.includes(w.id)) out.push({ id: w.id, label: `Waystone · ${w.zone.name}`, kind: 'waystone', x: w.pos.x, z: w.pos.z, zone: w.zone.id });
    }
    out.push({ id: 'homestead', label: 'Your Homestead', kind: 'homestead', x: HOMESTEAD.center[0] - HOMESTEAD.radius - 3, z: HOMESTEAD.center[1], zone: 'vale' });
    return out;
  }

  draw() {
    const c = this.ctx, W = 200;
    const tower = state.base.structures.some((s) => s.type === 'watchtower');
    const view = tower ? 190 : 150;
    const p = this.world.playerPos;
    const scale = this.S / WORLD_SIZE;
    const sx = (p.x + WORLD_SIZE / 2) * scale - (view * scale) / 2;
    const sy = (p.z + WORLD_SIZE / 2) * scale - (view * scale) / 2;
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath();
    c.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#1a1620';
    c.fillRect(0, 0, W, W);
    c.drawImage(this.base, sx, sy, view * scale, view * scale, 0, 0, W, W);
    if (this.world.atmo.night > 0.3) { c.fillStyle = `rgba(10,14,40,${this.world.atmo.night * 0.35})`; c.fillRect(0, 0, W, W); }
    const k = W / view;
    const P = (x: number, z: number) => [(x - p.x) * k + W / 2, (z - p.z) * k + W / 2];
    for (const w of this.world.wilds.list) {
      if (w.fade < 0.5) continue;
      const [x, y] = P(w.pos.x, w.pos.z);
      if (x < -5 || y < -5 || x > W + 5 || y > W + 5) continue;
      const sp = SPECIES[w.species];
      c.fillStyle = ELEMENTS[sp.element].color;
      c.beginPath(); c.arc(x, y, sp.rarity === 'common' ? 2.6 : 3.6, 0, Math.PI * 2); c.fill();
      if (w.shiny) { c.strokeStyle = '#dff8ff'; c.lineWidth = 1.5; c.stroke(); }
    }
    for (const z of ZONES) {
      this.icon(c, P(z.town.pos[0], z.town.pos[1]), '⌂', '#ffe8a8', 16);
      this.icon(c, P(z.camp[0], z.camp[1]), '⚑', '#ffd0a0', 13);
      if (!state.bosses.includes(z.id)) this.icon(c, P(z.boss.pos[0], z.boss.pos[1]), '♛', '#ff8ad8', 16);
    }
    for (const w of this.world.landmarks.waystones) this.icon(c, P(w.pos.x, w.pos.z), '◆', state.waypoints.includes(w.id) ? '#9fe8ff' : '#6a6478', 12);
    for (const t of this.world.landmarks.tamers) if (state.tamers[t.id] !== new Date().toISOString().slice(0, 10)) this.icon(c, P(t.pos.x, t.pos.z), '!', '#ffd76a', 13);
    this.icon(c, P(HOMESTEAD.center[0], HOMESTEAD.center[1]), '✦', '#9fe8b0', 14);
    c.restore();
    const yaw = this.world.player.root.rotation.y;
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(-yaw + Math.PI);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#000000aa';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath();
    c.stroke(); c.fill();
    c.restore();
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(-this.world.camYaw);
    const grad = c.createRadialGradient(0, 0, 0, 0, 0, 60);
    grad.addColorStop(0, 'rgba(255,240,200,0.25)');
    grad.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = grad;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 60, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); c.closePath(); c.fill();
    c.restore();
  }

  private icon(c: CanvasRenderingContext2D, [x, y]: number[], ch: string, color: string, size: number) {
    if (x < -10 || y < -10 || x > 210 || y > 210) return;
    c.font = `${size}px serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    c.strokeText(ch, x, y);
    c.fillStyle = color;
    c.fillText(ch, x, y);
  }

  /** Full world map with clickable fast-travel points. */
  fullMap(host: HTMLElement, onTravel?: (p: TravelPoint) => void) {
    const S = 760;
    const wrap = document.createElement('div');
    wrap.className = 'fullmap';
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d')!;
    c.drawImage(this.base, 0, 0, S, S);
    const k = S / WORLD_SIZE;
    const P = (x: number, z: number) => [(x + WORLD_SIZE / 2) * k, (z + WORLD_SIZE / 2) * k];
    c.textAlign = 'center';
    for (const z of ZONES) {
      const [zx, zy] = P(z.center[0], z.center[1]);
      c.font = '600 24px Cinzel, serif';
      c.lineWidth = 5; c.strokeStyle = 'rgba(10,8,14,0.75)'; c.fillStyle = '#f4e6c4';
      c.strokeText(z.name, zx, zy - 46); c.fillText(z.name, zx, zy - 46);
      c.font = 'italic 16px "Cormorant Garamond", serif';
      c.strokeText(`Lv ${z.levels[0]}–${z.levels[1]}`, zx, zy - 24); c.fillText(`Lv ${z.levels[0]}–${z.levels[1]}`, zx, zy - 24);
      this.icon(c, P(z.boss.pos[0], z.boss.pos[1]), state.bosses.includes(z.id) ? '✓' : '♛', state.bosses.includes(z.id) ? '#9aff9a' : '#ff8ad8', 26);
    }
    wrap.appendChild(cv);
    const pts = this.travelPoints();
    const pct = (v: number) => `${((v + WORLD_SIZE / 2) / WORLD_SIZE) * 100}%`;
    for (const t of pts) {
      const b = document.createElement('button');
      b.className = `tp tp-${t.kind}`;
      b.style.left = pct(t.x);
      b.style.top = pct(t.z);
      b.innerHTML = `${icon(t.kind === 'town' ? 'house_base' : t.kind === 'camp' ? 'flag' : t.kind === 'homestead' ? 'hammer_build' : 'waypoint_obelisk')}<span>${t.label}</span>`;
      b.title = onTravel ? `Travel to ${t.label}` : t.label;
      if (onTravel) b.addEventListener('click', () => onTravel(t));
      wrap.appendChild(b);
    }
    const me = document.createElement('div');
    me.className = 'tp-me';
    me.style.left = pct(this.world.playerPos.x);
    me.style.top = pct(this.world.playerPos.z);
    wrap.appendChild(me);
    host.appendChild(wrap);
  }
}
