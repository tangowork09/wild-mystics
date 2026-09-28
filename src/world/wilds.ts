import * as THREE from 'three';
import { makeCreatureRig, ensureCreatures } from '../assets/manifest';
import type { Rig } from '../assets/placeholders';
import { SPECIES } from '../data/species';
import { ELEMENTS } from '../data/elements';
import { RARITY } from '../data/traits';
import { ZONES, WATER_LEVEL, type Zone, zoneWeights, spawnsBy } from '../data/zones';
import { Q } from '../core/renderer';
import { randInt, randRange, weighted } from '../core/noise';
import { state } from '../game/state';
import { icon } from '../ui/icons';
import { FEATURES, type TerrainData } from './terrain';
import type { Props } from './props';
import { tickStageLights } from '../battle/stage';

export interface Wild {
  id: number;
  species: string;
  level: number;
  shiny: boolean;
  zone: Zone;
  rig: Rig;
  pos: THREE.Vector3;
  heading: number;
  state: 'idle' | 'wander' | 'chase' | 'flee';
  timer: number;
  target: THREE.Vector3;
  aggressive: boolean;
  cooldown: number;
  label: HTMLDivElement;
  radius: number;
  nightOnly: boolean;
  aura?: THREE.Object3D;
  fade: number;
}

let nextId = 1;
export const SHINY_ODDS = 1 / 300;

export function shinyRoll(bonus = 1) {
  const incense = (state.buffs.shimmer ?? 0) > Date.now() ? 3 : 1;
  return Math.random() < SHINY_ODDS * incense * bonus;
}

export class Wilds {
  group = new THREE.Group();
  list: Wild[] = [];
  private populated = new Set<string>();
  private loading = new Set<string>();
  private respawnQueue: { zone: Zone; at: number; night: boolean }[] = [];
  private labelsEl: HTMLElement;
  private sparkTex: THREE.Texture;

  constructor(private data: TerrainData, private props: Props) {
    this.labelsEl = document.getElementById('labels')!;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.sparkTex = new THREE.CanvasTexture(c);
  }

  /** Stream a land's roaming Mystics in (models load first so nothing pops from placeholder). */
  async populateZone(zone: Zone) {
    if (this.populated.has(zone.id) || this.loading.has(zone.id)) return;
    this.loading.add(zone.id);
    const species = spawnsBy(zone, ['roam', 'night']).map((s) => s.species);
    await ensureCreatures([...new Set(species)]);
    this.loading.delete(zone.id);
    this.populated.add(zone.id);
    for (let i = 0; i < zone.wildCount; i++) this.spawn(zone, null, false);
  }

  zoneReady(zone: Zone) { return this.populated.has(zone.id); }

  private findSpot(zone: Zone, avoid: THREE.Vector3 | null): THREE.Vector3 | null {
    const zi = ZONES.indexOf(zone);
    for (let t = 0; t < 60; t++) {
      const x = zone.center[0] + randRange(-160, 160);
      const z = zone.center[1] + randRange(-160, 160);
      if (Math.abs(x) > 345 || Math.abs(z) > 345) continue;
      if (zoneWeights(x, z)[zi] < 0.7) continue;
      const h = this.data.heightAt(x, z);
      if (h < WATER_LEVEL + 0.4 || this.data.slopeAt(x, z) > 0.8) continue;
      if (FEATURES.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + (f.kind === 'town' || f.kind === 'outpost' || f.kind === 'homestead' ? 22 : 8))) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 35) continue;
      return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  spawn(zone: Zone, avoid: THREE.Vector3 | null, night: boolean) {
    const pool = spawnsBy(zone, night ? ['night'] : ['roam']);
    if (!pool.length) return;
    const pos = this.findSpot(zone, avoid);
    if (!pos) return;
    const sp = weighted(pool).species;
    const spec = SPECIES[sp];
    if (!spec) return;
    const level = randInt(zone.levels[0], zone.levels[1]);
    const shiny = shinyRoll();
    const rig = makeCreatureRig(sp, shiny);
    rig.root.position.copy(pos);
    rig.root.visible = false;
    this.group.add(rig.root);
    const label = document.createElement('div');
    label.className = 'wild-label';
    const el = ELEMENTS[spec.element];
    const rar = RARITY[spec.rarity];
    label.style.setProperty('--rar', rar.color);
    label.innerHTML = `<span class="wl-el" style="color:${el.color}">${icon(spec.element)}</span>${shiny ? `<span class="shiny">${icon('sparkle')}</span>` : ''}<span class="wl-nm">${spec.name}</span><b>Lv ${level}</b>${spec.rarity !== 'common' ? `<i class="wl-rar">${rar.name}</i>` : ''}`;
    label.style.display = 'none';
    this.labelsEl.appendChild(label);
    let aura: THREE.Object3D | undefined;
    if (shiny || spec.rarity === 'epic' || spec.rarity === 'exotic' || spec.rarity === 'legendary') {
      aura = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: shiny ? '#bff4ff' : rar.color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.y = 0.06;
      ring.scale.setScalar(Math.max(1, rig.height * 0.8));
      aura.add(ring);
      if (shiny) {
        const N = 14;
        const p = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) { p[i * 3] = (Math.random() - 0.5) * 1.6; p[i * 3 + 1] = Math.random() * rig.height * 1.2; p[i * 3 + 2] = (Math.random() - 0.5) * 1.6; }
        const pts = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(p, 3)), new THREE.PointsMaterial({ map: this.sparkTex, color: '#dff8ff', size: 0.45, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        pts.name = 'shinyspark';
        aura.add(pts);
      }
      this.group.add(aura);
    }
    this.list.push({
      id: nextId++, species: sp, level, shiny, zone, rig, pos, heading: Math.random() * Math.PI * 2,
      state: 'idle', timer: Math.random() * 3, target: pos.clone(), aggressive: Math.random() < 0.3, cooldown: 0, label,
      radius: Math.max(0.8, rig.height * 0.35), nightOnly: night, aura, fade: night ? 0 : 1,
    });
  }

  remove(id: number, respawn = true) {
    const i = this.list.findIndex((w) => w.id === id);
    if (i < 0) return;
    const w = this.list[i];
    this.group.remove(w.rig.root);
    if (w.aura) this.group.remove(w.aura);
    w.label.remove();
    this.list.splice(i, 1);
    if (respawn) this.respawnQueue.push({ zone: w.zone, at: performance.now() + 25000, night: w.nightOnly });
  }

  get(id: number) { return this.list.find((w) => w.id === id); }

  /** Returns a wild that touched the player this frame (encounter), if any. */
  update(dt: number, t: number, player: THREE.Vector3, camera: THREE.Camera, paused: boolean, night: number): Wild | null {
    tickStageLights(false);
    const now = performance.now();
    // stream nearby lands in
    for (const z of ZONES) {
      if (!this.populated.has(z.id) && Math.hypot(player.x - z.center[0], player.z - z.center[1]) < 330) void this.populateZone(z);
    }
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      if (r.at < now) { if (!r.night || night > 0.6) this.spawn(r.zone, player, r.night); this.respawnQueue.splice(i, 1); }
    }
    // night shift: night-only Mystics appear at dusk and leave at dawn
    if (night > 0.6) {
      for (const z of ZONES) {
        if (!this.populated.has(z.id)) continue;
        const have = this.list.filter((w) => w.nightOnly && w.zone === z).length;
        if (have < 4 && Math.random() < dt * 0.5) this.spawn(z, player, true);
      }
    }
    let touched: Wild | null = null;
    const v = new THREE.Vector3();
    const VIEW = Q.wildView;
    for (let wi = this.list.length - 1; wi >= 0; wi--) {
      const w = this.list[wi];
      if (w.nightOnly) {
        w.fade = THREE.MathUtils.clamp(w.fade + (night > 0.45 ? dt : -dt) * 0.8, 0, 1);
        if (w.fade <= 0 && night < 0.45) { this.remove(w.id, false); continue; }
      }
      const dx = player.x - w.pos.x, dz = player.z - w.pos.z;
      const dist = Math.hypot(dx, dz);
      const near = dist < VIEW;
      w.rig.root.visible = near && w.fade > 0.02;
      if (w.aura) w.aura.visible = w.rig.root.visible;
      if (!near) { w.label.style.display = 'none'; continue; }
      w.cooldown = Math.max(0, w.cooldown - dt);
      let speed = 0;
      if (!paused) {
        w.timer -= dt;
        if (w.cooldown <= 0) {
          if (w.aggressive && dist < 13 && w.state !== 'chase') { w.state = 'chase'; w.timer = 6; }
          if (!w.aggressive && dist < 7 && w.state !== 'flee' && Math.random() < 0.02) { w.state = 'flee'; w.timer = 2.5; }
        }
        switch (w.state) {
          case 'idle':
            if (w.timer <= 0) {
              w.state = 'wander';
              w.timer = randRange(3, 7);
              const a = Math.random() * Math.PI * 2;
              w.target.set(w.pos.x + Math.cos(a) * 10, 0, w.pos.z + Math.sin(a) * 10);
            }
            break;
          case 'wander': {
            const tx = w.target.x - w.pos.x, tz = w.target.z - w.pos.z;
            if (Math.hypot(tx, tz) < 0.6 || w.timer <= 0) { w.state = 'idle'; w.timer = randRange(1.5, 5); break; }
            w.heading = Math.atan2(tx, tz);
            speed = 1.8;
            break;
          }
          case 'chase':
            w.heading = Math.atan2(dx, dz);
            speed = 5.2;
            if (w.timer <= 0 || dist > 22) { w.state = 'idle'; w.timer = 2; w.cooldown = 4; }
            break;
          case 'flee':
            w.heading = Math.atan2(-dx, -dz);
            speed = 5.5;
            if (w.timer <= 0) { w.state = 'idle'; w.timer = 3; }
            break;
        }
        if (speed > 0) {
          const nx = w.pos.x + Math.sin(w.heading) * speed * dt;
          const nz = w.pos.z + Math.cos(w.heading) * speed * dt;
          const h = this.data.heightAt(nx, nz);
          const blocked = h < WATER_LEVEL + 0.2 || this.data.slopeAt(nx, nz) > 1.0 || FEATURES.some((f) => (f.kind === 'town' || f.kind === 'outpost' || f.kind === 'homestead') && Math.hypot(nx - f.x, nz - f.z) < f.r + 6)
            || this.props.nearby(nx, nz).some((c) => Math.hypot(nx - c.x, nz - c.z) < c.r + w.radius * 0.6);
          if (blocked) { w.heading += Math.PI * (0.5 + Math.random()); w.state = 'idle'; w.timer = 0.5; }
          else { w.pos.x = nx; w.pos.z = nz; }
        }
        if (w.cooldown <= 0 && dist < w.radius + 0.9) touched = w;
      }
      w.pos.y = this.data.heightAt(w.pos.x, w.pos.z);
      w.rig.root.position.copy(w.pos);
      w.rig.root.scale.setScalar(Math.max(0.001, w.fade));
      const cur = w.rig.root.rotation.y;
      const diff = Math.atan2(Math.sin(w.heading - cur), Math.cos(w.heading - cur));
      w.rig.root.rotation.y = cur + diff * Math.min(1, dt * 6);
      if (dist < 55) w.rig.update(dt, speed > 0 ? Math.min(1, speed / 4) : 0);
      if (w.aura) {
        w.aura.position.copy(w.pos);
        const sp = w.aura.getObjectByName('shinyspark');
        if (sp) { sp.rotation.y = t * 1.5; (sp as THREE.Points).material instanceof THREE.PointsMaterial && (((sp as THREE.Points).material as THREE.PointsMaterial).opacity = 0.6 + Math.sin(t * 6 + w.id) * 0.4); }
      }
      // label
      if (dist < 26) {
        v.copy(w.pos); v.y += w.rig.height + 0.5;
        v.project(camera);
        if (v.z < 1) {
          w.label.style.display = 'flex';
          w.label.style.transform = `translate(-50%,-100%) translate(${(v.x * 0.5 + 0.5) * innerWidth}px,${(-v.y * 0.5 + 0.5) * innerHeight}px)`;
          w.label.style.opacity = String(Math.min(1, (26 - dist) / 6) * w.fade);
          w.label.classList.toggle('hostile', w.state === 'chase');
        } else w.label.style.display = 'none';
      } else w.label.style.display = 'none';
    }
    return touched;
  }

  hideLabels() { for (const w of this.list) w.label.style.display = 'none'; }

  nearestTo(p: THREE.Vector3, maxDist: number): Wild | null {
    let best: Wild | null = null, bd = maxDist;
    for (const w of this.list) {
      if (w.fade < 0.5) continue;
      const d = Math.hypot(p.x - w.pos.x, p.z - w.pos.z) - w.radius;
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
}
