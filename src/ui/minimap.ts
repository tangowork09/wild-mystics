import { ZONES, WORLD_SIZE, WATER_LEVEL } from '../data/zones';
import { ELEMENTS } from '../data/elements';
import { SPECIES } from '../data/species';
import { state } from '../game/state';
import type { Overworld } from '../world/world';

// Pre-rendered relief map (colour map + water + hillshade), then markers drawn per frame.

export class Minimap {
  private base: HTMLCanvasElement;
  private mini: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private S = 512;

  constructor(private world: Overworld, host: HTMLElement) {
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
          const lava = world.data.zoneW[((Math.round((y / (S - 1)) * 511)) * 512 + Math.round((x / (S - 1)) * 511)) * 4 + 1] > 0.5;
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

  draw() {
    const c = this.ctx, W = 200, view = 150; // metres across
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
    const k = W / view;
    const P = (x: number, z: number) => [(x - p.x) * k + W / 2, (z - p.z) * k + W / 2];
    // wilds
    for (const w of this.world.wilds.list) {
      const [x, y] = P(w.pos.x, w.pos.z);
      if (x < -5 || y < -5 || x > W + 5 || y > W + 5) continue;
      c.fillStyle = ELEMENTS[SPECIES[w.species].element].color;
      c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill();
    }
    for (const z of ZONES) {
      this.icon(c, P(z.town.pos[0], z.town.pos[1]), '⌂', '#ffe8a8', 16);
      this.icon(c, P(z.camp[0], z.camp[1]), '⚑', '#ffd0a0', 13);
      if (!state.bosses.includes(z.id)) this.icon(c, P(z.boss.pos[0], z.boss.pos[1]), '♛', '#ff8ad8', 16);
    }
    c.restore();
    // player arrow (camera-relative heading)
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
    // view cone
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

  /** Full world map image for the Map screen. */
  fullMap(host: HTMLElement) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 720;
    const c = cv.getContext('2d')!;
    c.drawImage(this.base, 0, 0, 720, 720);
    const k = 720 / WORLD_SIZE;
    const P = (x: number, z: number) => [(x + WORLD_SIZE / 2) * k, (z + WORLD_SIZE / 2) * k];
    c.textAlign = 'center';
    for (const z of ZONES) {
      const [zx, zy] = P(z.center[0], z.center[1]);
      c.font = '600 22px Cinzel, serif';
      c.lineWidth = 5; c.strokeStyle = 'rgba(10,8,14,0.75)'; c.fillStyle = '#f4e6c4';
      c.strokeText(z.name, zx, zy - 40); c.fillText(z.name, zx, zy - 40);
      c.font = 'italic 15px "Cormorant Garamond", serif';
      c.strokeText(`Lv ${z.levels[0]}–${z.levels[1]}`, zx, zy - 18); c.fillText(`Lv ${z.levels[0]}–${z.levels[1]}`, zx, zy - 18);
      this.icon(c, P(z.town.pos[0], z.town.pos[1]), '⌂', '#ffe8a8', 26);
      const [tx, ty] = P(z.town.pos[0], z.town.pos[1]);
      c.font = '600 14px Cinzel, serif'; c.lineWidth = 4;
      c.strokeText(z.town.name, tx, ty + 22); c.fillStyle = '#ffe8a8'; c.fillText(z.town.name, tx, ty + 22);
      this.icon(c, P(z.camp[0], z.camp[1]), '⚑', '#ffd0a0', 20);
      this.icon(c, P(z.boss.pos[0], z.boss.pos[1]), state.bosses.includes(z.id) ? '✓' : '♛', state.bosses.includes(z.id) ? '#9aff9a' : '#ff8ad8', 26);
    }
    const [px, py] = P(this.world.playerPos.x, this.world.playerPos.z);
    c.fillStyle = '#ffffff'; c.strokeStyle = '#000'; c.lineWidth = 3;
    c.beginPath(); c.arc(px, py, 7, 0, Math.PI * 2); c.stroke(); c.fill();
    host.appendChild(cv);
  }
}
