import * as THREE from 'three';
import { makeCreatureRig } from '../assets/manifest';
import type { Rig } from '../assets/placeholders';
import { SPECIES } from '../data/species';
import { ELEMENTS } from '../data/elements';
import { ZONES, WATER_LEVEL, type Zone, zoneWeights } from '../data/zones';
import { randInt, randRange, weighted } from '../core/noise';
import { FEATURES, type TerrainData } from './terrain';
import type { Props } from './props';

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
}

let nextId = 1;
const VIEW_DIST = 75;

export class Wilds {
  group = new THREE.Group();
  list: Wild[] = [];
  private respawnQueue: { zone: Zone; at: number }[] = [];
  private labelsEl: HTMLElement;

  constructor(private data: TerrainData, private props: Props) {
    this.labelsEl = document.getElementById('labels')!;
  }

  populate() {
    for (const z of ZONES) for (let i = 0; i < z.wildCount; i++) this.spawn(z, null);
  }

  private findSpot(zone: Zone, avoid: THREE.Vector3 | null): THREE.Vector3 | null {
    for (let t = 0; t < 60; t++) {
      const x = zone.center[0] + randRange(-140, 140);
      const z = zone.center[1] + randRange(-140, 140);
      if (Math.abs(x) > 235 || Math.abs(z) > 235) continue;
      const zi = ZONES.indexOf(zone);
      if (zoneWeights(x, z)[zi] < 0.7) continue;
      const h = this.data.heightAt(x, z);
      if (h < WATER_LEVEL + 0.4 || this.data.slopeAt(x, z) > 0.8) continue;
      if (FEATURES.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + (f.kind === 'town' ? 22 : 8))) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 35) continue;
      return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  spawn(zone: Zone, avoid: THREE.Vector3 | null) {
    const pos = this.findSpot(zone, avoid);
    if (!pos) return;
    const sp = weighted(zone.spawns).species;
    const level = randInt(zone.levels[0], zone.levels[1]);
    const shiny = Math.random() < 1 / 120;
    const rig = makeCreatureRig(sp, shiny);
    rig.root.position.copy(pos);
    rig.root.visible = false;
    this.group.add(rig.root);
    const label = document.createElement('div');
    label.className = 'wild-label';
    const el = ELEMENTS[SPECIES[sp].element];
    label.innerHTML = `<span class="el" style="color:${el.color}">${el.glyph}</span>${shiny ? '<span class="shiny">✧</span>' : ''}${SPECIES[sp].name} <b>Lv ${level}</b>`;
    label.style.display = 'none';
    this.labelsEl.appendChild(label);
    const aggressive = Math.random() < 0.35;
    this.list.push({
      id: nextId++, species: sp, level, shiny, zone, rig, pos, heading: Math.random() * Math.PI * 2,
      state: 'idle', timer: Math.random() * 3, target: pos.clone(), aggressive, cooldown: 0, label,
      radius: Math.max(0.8, rig.height * 0.35),
    });
  }

  remove(id: number, respawn = true) {
    const i = this.list.findIndex((w) => w.id === id);
    if (i < 0) return;
    const w = this.list[i];
    this.group.remove(w.rig.root);
    w.label.remove();
    this.list.splice(i, 1);
    if (respawn) this.respawnQueue.push({ zone: w.zone, at: performance.now() + 25000 });
  }

  get(id: number) { return this.list.find((w) => w.id === id); }

  /** Returns a wild that touched the player this frame (encounter), if any. */
  update(dt: number, player: THREE.Vector3, camera: THREE.Camera, paused: boolean): Wild | null {
    const now = performance.now();
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      if (this.respawnQueue[i].at < now) { this.spawn(this.respawnQueue[i].zone, player); this.respawnQueue.splice(i, 1); }
    }
    let touched: Wild | null = null;
    const v = new THREE.Vector3();
    for (const w of this.list) {
      const dx = player.x - w.pos.x, dz = player.z - w.pos.z;
      const dist = Math.hypot(dx, dz);
      const near = dist < VIEW_DIST;
      w.rig.root.visible = near;
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
          const blocked = h < WATER_LEVEL + 0.2 || this.data.slopeAt(nx, nz) > 1.0 || FEATURES.some((f) => f.kind === 'town' && Math.hypot(nx - f.x, nz - f.z) < f.r + 6)
            || this.props.nearby(nx, nz).some((c) => Math.hypot(nx - c.x, nz - c.z) < c.r + w.radius * 0.6);
          if (blocked) { w.heading += Math.PI * (0.5 + Math.random()); w.state = 'idle'; w.timer = 0.5; }
          else { w.pos.x = nx; w.pos.z = nz; }
        }
        if (w.cooldown <= 0 && dist < w.radius + 0.9) touched = w;
      }
      w.pos.y = this.data.heightAt(w.pos.x, w.pos.z);
      w.rig.root.position.copy(w.pos);
      const cur = w.rig.root.rotation.y;
      const diff = Math.atan2(Math.sin(w.heading - cur), Math.cos(w.heading - cur));
      w.rig.root.rotation.y = cur + diff * Math.min(1, dt * 6);
      w.rig.update(dt, speed > 0 ? Math.min(1, speed / 4) : 0);

      // label
      if (dist < 24) {
        v.copy(w.pos); v.y += w.rig.height + 0.5;
        v.project(camera);
        if (v.z < 1) {
          w.label.style.display = 'block';
          w.label.style.transform = `translate(-50%,-100%) translate(${(v.x * 0.5 + 0.5) * innerWidth}px,${(-v.y * 0.5 + 0.5) * innerHeight}px)`;
          w.label.style.opacity = String(Math.min(1, (24 - dist) / 6));
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
      const d = Math.hypot(p.x - w.pos.x, p.z - w.pos.z) - w.radius;
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
}
