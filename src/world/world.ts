import * as THREE from 'three';
import { makePipeline, Q, type Pipeline } from '../core/renderer';
import { input } from '../core/input';
import { settings } from '../core/settings';
import { makePlayerRig, makeCreatureRig, manifestTexture, ensureCreatures } from '../assets/manifest';
import type { Rig } from '../assets/placeholders';
import { ZONES, WATER_LEVEL, WORLD_SIZE, HOMESTEAD, zoneAt, zoneWeights, spawnsBy, type Zone } from '../data/zones';
import { SPECIES } from '../data/species';
import { randInt, weighted } from '../core/noise';
import { state } from '../game/state';
import { emit } from '../game/events';
import { TerrainData, buildTerrainMesh } from './terrain';
import { Grass } from './grass';
import { Water } from './water';
import { Atmosphere } from './atmosphere';
import { Props } from './props';
import { Structures, inTown, type Interactable } from './towns';
import { Wilds, shinyRoll, type Wild } from './wilds';
import { Landmarks } from './landmarks';
import { Homestead } from './homestead';

export type WorldEvent =
  | { type: 'wild'; wild: Wild; advantage: boolean }
  | { type: 'grass'; species: string; level: number; shiny: boolean; zone: Zone }
  | { type: 'interact'; target: Interactable };

const GRAVITY = 26;
const JUMP_V = 9.2;
const DOUBLE_V = 8.2;

export class Overworld {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, Q.far);
  pipeline!: Pipeline;
  data = new TerrainData();
  grass!: Grass;
  water!: Water;
  atmo!: Atmosphere;
  props!: Props;
  structures!: Structures;
  landmarks!: Landmarks;
  homestead!: Homestead;
  wilds!: Wilds;
  player!: Rig;
  playerPos = new THREE.Vector3();
  private heading = 0;
  camYaw = Math.PI;
  camPitch = 0.38;
  camDist = settings.cameraDistance;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  zone: Zone = ZONES[0];
  onZoneEnter?: (z: Zone) => void;
  onDiscover?: (label: string) => void;
  nearInteract: Interactable | null = null;
  bossRigs = new Map<string, Rig>();
  private bossLoading = new Set<string>();
  private grassMeter = 0;
  private grassGrace = 3;
  private stepAcc = 0;
  titleMode = true;
  /** While true the battle owns the camera and the explorer; exploration logic is suspended. */
  battleMode = false;
  /** Build mode: camera goes overhead, movement drives the placement ghost. */
  buildMode = false;
  // jump physics
  private vy = 0;
  private airborne = false;
  private jumps = 0;
  private spin = 0;
  // riding
  mount: { rig: Rig; species: string } | null = null;
  timeScale = 1;

  async build(progress: (m: string, f?: number) => void) {
    progress('Shaping the land…', 0);
    await this.data.load((f) => progress(this.data.cached ? 'Unrolling the map…' : 'Shaping the land…', f));
    progress('Painting terrain…');
    await tick();
    this.scene.add(buildTerrainMesh(this.data, { grass: manifestTexture('textures', 'ground_detail') ?? undefined, rock: manifestTexture('textures', 'rock_detail') ?? undefined }));
    this.atmo = new Atmosphere(this.scene);
    this.water = new Water(this.data);
    this.scene.add(this.water.mesh);
    progress('Growing meadows…');
    await tick();
    this.grass = new Grass(this.data);
    this.scene.add(this.grass.mesh);
    this.props = new Props(this.data);
    this.props.build();
    this.scene.add(this.props.group);
    progress('Raising towns…');
    await tick();
    this.structures = new Structures(this.data, this.props);
    this.structures.build();
    this.structures.lastCam = this.camera.position; // v3:towns — animation/villager culling
    this.scene.add(this.structures.group);
    this.landmarks = new Landmarks(this.data, this.props);
    this.landmarks.build();
    this.scene.add(this.landmarks.group);
    this.homestead = new Homestead(this.data, this.props);
    this.homestead.sync();
    this.scene.add(this.homestead.group);
    progress('Waking the wild Mystics…');
    await tick();
    this.wilds = new Wilds(this.data, this.props);
    this.scene.add(this.wilds.group);
    this.player = makePlayerRig();
    this.scene.add(this.player.root);
    this.teleport(state.pos[0], state.pos[1]);
    await this.wilds.populateZone(this.zone);
    // v3:towns — every town/camp lantern becomes a candidate night light (look's Atmosphere.addLamp)
    const atmoLamps = this.atmo as unknown as { addLamp?: (p: THREE.Vector3) => void };
    for (const p of this.structures.lampSpots) atmoLamps.addLamp?.(p);
    this.pipeline = makePipeline(this.scene, this.camera);
    this.atmo.update(0.016, 0, this.playerPos, this.playerPos.y, state.time);
    this.atmo.refreshEnv();
  }

  /** Every interactable in the world, merged from towns, landmarks and the homestead. */
  get interactables(): Interactable[] {
    return [...this.structures.interactables, ...this.landmarks.interactables, ...this.homestead.interactables, ...this.bossInteractables];
  }
  private bossInteractables: Interactable[] = ZONES.map((z) => ({
    pos: new THREE.Vector3(z.boss.pos[0], 0, z.boss.pos[1]), radius: 11,
    label: `Challenge ${SPECIES[z.boss.species]?.name ?? 'Guardian'}`, kind: 'boss' as const, zone: z, id: `${z.id}-boss`,
    enabled: () => !state.bosses.includes(z.id),
  }));

  /** Guardian rigs stream in when you get close to an arena. */
  private updateBosses(dt: number) {
    for (const z of ZONES) {
      const d = Math.hypot(z.boss.pos[0] - this.playerPos.x, z.boss.pos[1] - this.playerPos.z);
      const dead = state.bosses.includes(z.id);
      let rig = this.bossRigs.get(z.id);
      if (!rig && !dead && d < 240 && !this.bossLoading.has(z.id)) {
        this.bossLoading.add(z.id);
        void ensureCreatures([z.boss.species]).then(() => {
          const r = makeCreatureRig(z.boss.species);
          const [x, zz] = z.boss.pos;
          r.root.position.set(x, this.data.heightAt(x, zz), zz);
          r.root.rotation.y = Math.atan2(z.camp[0] - x, z.camp[1] - zz);
          this.scene.add(r.root);
          this.bossRigs.set(z.id, r);
          this.refreshBosses();
        });
      }
      if (rig && rig.root.visible && d < 160) rig.update(dt, 0);
      if (rig && d > 300) { this.scene.remove(rig.root); this.bossRigs.delete(z.id); this.bossLoading.delete(z.id); rig = undefined; }
    }
  }

  refreshBosses() {
    for (const z of ZONES) {
      const dead = state.bosses.includes(z.id);
      const rig = this.bossRigs.get(z.id);
      if (rig) rig.root.visible = !dead;
      this.structures.setBossDefeated(z.id, dead);
    }
    for (const b of this.bossInteractables) b.pos.y = this.data.heightAt(b.pos.x, b.pos.z);
  }

  teleport(x: number, z: number) {
    this.playerPos.set(x, this.data.heightAt(x, z), z);
    this.player.root.position.copy(this.playerPos);
    this.camTarget.copy(this.playerPos);
    this.zone = zoneAt(x, z);
    this.vy = 0; this.airborne = false;
    this.atmo?.setZoneWeights(zoneWeights(x, z));
    void this.wilds?.populateZone(this.zone);
    this.snapCamera();
  }

  snapCamera() {
    this.camTarget.set(this.playerPos.x, this.playerPos.y + 1.6, this.playerPos.z);
    this.camPos.copy(this.desiredCam());
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  private desiredCam() {
    const d = this.buildMode ? 34 : this.camDist + (this.mount ? 2.5 : 0);
    const pitch = this.buildMode ? 1.05 : this.camPitch;
    const p = new THREE.Vector3(
      this.camTarget.x + Math.sin(this.camYaw) * Math.cos(pitch) * d,
      this.camTarget.y + Math.sin(pitch) * d,
      this.camTarget.z + Math.cos(this.camYaw) * Math.cos(pitch) * d,
    );
    // pull the camera in when a building or boulder sits between it and the player
    const tx = this.camTarget.x, tz = this.camTarget.z;
    const dx = p.x - tx, dz = p.z - tz;
    if (!this.buildMode && this.props && dx * dx + dz * dz > 0.01) {
      let tMin = 1;
      const seen = new Set<object>();
      for (const c of [...this.props.nearby(tx, tz), ...this.props.nearby(p.x, p.z)]) {
        if (c.r < 1.2 || seen.has(c)) continue;
        seen.add(c);
        const fx = tx - c.x, fz = tz - c.z, R = c.r + 0.5;
        const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - R * R;
        const disc = b * b - 4 * a * cc;
        if (disc < 0 || cc < 0) continue;
        const t1 = (-b - Math.sqrt(disc)) / (2 * a);
        if (t1 > 0 && t1 < tMin) tMin = t1;
      }
      if (tMin < 1) {
        const k = Math.max(0.22, tMin - 0.04);
        p.set(tx + dx * k, this.camTarget.y + (p.y - this.camTarget.y) * k, tz + dz * k);
      }
    }
    const ground = this.data.heightAt(p.x, p.z) + 0.8;
    if (p.y < ground) p.y = ground;
    return p;
  }

  private collide(x: number, z: number): [number, number] {
    const list = this.props.nearby(x, z);
    if (Math.hypot(x - HOMESTEAD.center[0], z - HOMESTEAD.center[1]) < HOMESTEAD.radius + 6) list.push(...this.homestead.colliders());
    for (const c of list) {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + (this.mount ? 0.9 : 0.45);
      if (d < min && d > 0.0001) { x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; }
    }
    return [x, z];
  }

  // ── riding ─────────────────────────────────────────────────────────────
  mountUp(species: string, shiny = false) {
    this.dismount();
    const rig = makeCreatureRig(species, shiny);
    rig.root.position.copy(this.playerPos);
    this.scene.add(rig.root);
    this.mount = { rig, species };
  }
  dismount() {
    if (!this.mount) return;
    this.scene.remove(this.mount.rig.root);
    this.mount = null;
    this.player.root.position.copy(this.playerPos);
  }

  update(dt: number, t: number, paused: boolean): WorldEvent | null {
    let event: WorldEvent | null = null;
    // ── day/night clock
    if (!paused && !this.titleMode && !this.battleMode) {
      state.time += dt / (settings.dayLength * 60) * this.timeScale;
      if (state.time >= 1) { state.time -= 1; state.day++; }
    }
    // ── camera input
    const look = input.consumeLook();
    const zoom = input.consumeZoom();
    if (!paused && !this.titleMode && !this.battleMode) {
      const sens = settings.cameraSensitivity;
      this.camYaw -= look.x * 0.005 * sens;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + look.y * 0.004 * sens * (settings.invertY ? -1 : 1), 0.08, 1.2);
      this.camDist = THREE.MathUtils.clamp(this.camDist + zoom * 0.8, 4, 20);
    }

    // ── player movement + jumping
    let moving = 0;
    const r = this.player.root;
    if (!paused && !this.titleMode && !this.battleMode) {
      if (input.hit(' ', 'jump') && !this.buildMode) {
        if (!this.airborne) { this.vy = JUMP_V * (this.mount ? 1.1 : 1); this.airborne = true; this.jumps = 1; this.player.play('jump'); }
        else if (this.jumps < 2) { this.vy = DOUBLE_V; this.jumps = 2; this.spin = 1; this.player.play('jump'); this.onDoubleJump?.(this.playerPos.clone()); }
      }
      const mx = input.move.x, my = input.move.y;
      const mag = Math.hypot(mx, my);
      if (mag > 0.05) {
        const fwd = new THREE.Vector2(-Math.sin(this.camYaw), -Math.cos(this.camYaw));
        const right = new THREE.Vector2(-fwd.y, fwd.x);
        const dir = new THREE.Vector2().addScaledVector(fwd, my).addScaledVector(right, mx);
        dir.normalize();
        const sprint = input.sprint || (input.isTouch && mag > 0.92);
        const base = this.mount ? (sprint ? 19 : 13) : sprint ? 11 : 6.5;
        const speed = base * Math.min(1, mag) * (this.airborne ? 0.92 : 1);
        let nx = this.playerPos.x + dir.x * speed * dt;
        let nz = this.playerPos.z + dir.y * speed * dt;
        [nx, nz] = this.collide(nx, nz);
        const lim = WORLD_SIZE / 2 - 14;
        nx = THREE.MathUtils.clamp(nx, -lim, lim);
        nz = THREE.MathUtils.clamp(nz, -lim, lim);
        const deck = this.structures.deckAt(nx, nz); // v3:towns — piers & boardwalks are walkable
        const nh = deck ?? this.data.heightAt(nx, nz);
        const deep = deck === null && nh < WATER_LEVEL - 0.7;
        const lava = deck === null && this.data.lavaAt(nx, nz) > 0.5 && nh < WATER_LEVEL + 0.1;
        const steep = deck === null && this.data.slopeAt(nx, nz) > 1.35 && nh > this.playerPos.y + 0.3 && !this.airborne;
        if (!deep && !steep && !lava) {
          const moved = Math.hypot(nx - this.playerPos.x, nz - this.playerPos.z);
          this.playerPos.x = nx; this.playerPos.z = nz;
          if (!this.airborne) this.playerPos.y = nh;
          this.stepAcc += moved;
          if (!this.airborne && this.data.tallAt(nx, nz) > 0.32) this.grassMeter += moved;
        }
        this.heading = Math.atan2(dir.x, dir.y);
        moving = Math.min(1, speed / 7);
      }
      // vertical
      const ground = this.structures.deckAt(this.playerPos.x, this.playerPos.z) ?? this.data.heightAt(this.playerPos.x, this.playerPos.z); // v3:towns
      if (this.airborne) {
        this.vy -= GRAVITY * dt;
        this.playerPos.y += this.vy * dt;
        if (this.playerPos.y <= ground) { this.playerPos.y = ground; this.airborne = false; this.vy = 0; this.jumps = 0; this.player.play('land'); this.onLand?.(this.playerPos.clone()); }
      } else this.playerPos.y = ground;
    }
    if (this.stepAcc >= 1) {
      const m = Math.floor(this.stepAcc);
      state.steps += m;
      this.stepAcc -= m;
      emit('step', { meters: m });
    }
    if (!this.battleMode) {
      r.position.x += (this.playerPos.x - r.position.x) * (1 - Math.exp(-dt * 30));
      r.position.z += (this.playerPos.z - r.position.z) * (1 - Math.exp(-dt * 30));
      r.position.y = this.playerPos.y + (this.mount ? this.mount.rig.height * 0.62 : 0);
      const diff = Math.atan2(Math.sin(this.heading - r.rotation.y), Math.cos(this.heading - r.rotation.y));
      r.rotation.y += diff * Math.min(1, dt * 12);
      if (this.spin > 0) { this.spin = Math.max(0, this.spin - dt * 2.4); r.rotation.y += dt * Math.PI * 2 * 2.4; }
      if (this.mount) {
        const m = this.mount.rig.root;
        m.position.set(r.position.x, this.playerPos.y, r.position.z);
        m.rotation.y = r.rotation.y;
        this.mount.rig.update(dt, moving);
        this.player.update(dt, 0);
      } else this.player.update(dt, this.airborne ? 0 : moving);
    }

    // ── camera
    if (this.battleMode) {
      // camera driven by Battle
    } else if (this.titleMode) {
      const [cx, cz] = ZONES[0].town.pos;
      const a = t * 0.05;
      this.camera.position.set(cx + Math.cos(a) * 46, this.data.heightAt(cx, cz) + 20, cz + Math.sin(a) * 46);
      this.camera.lookAt(cx, this.data.heightAt(cx, cz) + 3, cz);
    } else {
      const ty = (this.airborne ? this.playerPos.y * 0.45 + this.data.heightAt(this.playerPos.x, this.playerPos.z) * 0.55 : this.playerPos.y) + 1.6 + (this.mount ? 1.2 : 0);
      this.camTarget.lerp(new THREE.Vector3(this.playerPos.x, ty, this.playerPos.z), 1 - Math.exp(-dt * 10));
      this.camPos.lerp(this.desiredCam(), 1 - Math.exp(-dt * (this.buildMode ? 5 : 8)));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camTarget);
    }

    // ── zone
    const zNow = zoneAt(this.playerPos.x, this.playerPos.z);
    if (zNow !== this.zone) { this.zone = zNow; if (!this.titleMode) this.onZoneEnter?.(zNow); }
    this.atmo.setZoneWeights(zoneWeights(this.playerPos.x, this.playerPos.z));

    // ── systems
    const focus = this.titleMode ? new THREE.Vector3(ZONES[0].town.pos[0], this.playerPos.y, ZONES[0].town.pos[1]) : this.playerPos;
    this.atmo.update(dt, t, focus, this.playerPos.y, state.time);
    this.structures.setNight(this.atmo.night);
    this.grass.update(t, this.titleMode ? focus : this.playerPos);
    this.water.update(t);
    this.props.update(t);
    this.structures.update(dt, t);
    this.landmarks.update(dt, t, this.playerPos, this.atmo.night);
    this.homestead.update(dt, t, this.playerPos);
    this.updateBosses(dt);

    const touched = this.battleMode ? null : this.wilds.update(dt, t, this.playerPos, this.camera, paused || this.titleMode || this.buildMode, this.atmo.night);
    if (paused || this.titleMode || this.battleMode || this.buildMode) return null;

    // ── discovery: waystones attune on approach; towns & camps become travel points
    for (const w of this.landmarks.waystones) {
      if (!state.waypoints.includes(w.id) && Math.hypot(w.pos.x - this.playerPos.x, w.pos.z - this.playerPos.z) < 7) {
        state.waypoints.push(w.id);
        emit('discover', { id: w.id });
        this.onDiscover?.(`Waystone attuned — ${w.zone.name}`);
      }
    }
    for (const z of ZONES) {
      const tid = `${z.id}-town`;
      if (!state.waypoints.includes(tid) && Math.hypot(z.town.pos[0] - this.playerPos.x, z.town.pos[1] - this.playerPos.z) < 30) {
        state.waypoints.push(tid);
        this.onDiscover?.(`${z.town.name} added to your map`);
      }
    }

    // ── interactions
    this.nearInteract = null;
    let best = Infinity;
    for (const it of this.interactables) {
      if (!it.enabled()) continue;
      const d = Math.hypot(it.pos.x - this.playerPos.x, it.pos.z - this.playerPos.z);
      if (d < it.radius && d < best) { best = d; this.nearInteract = it; }
    }
    if (this.nearInteract && input.hit('e', 'enter')) event = { type: 'interact', target: this.nearInteract };

    // v3:towns — no wild battles inside (or right at the edge of) a town
    const safe = inTown(this.playerPos.x, this.playerPos.z, 6);
    // ── strike first
    if (!event && !safe && input.hit('f')) {
      const w = this.wilds.nearestTo(this.playerPos, 3.4);
      if (w && w.cooldown <= 0) { this.player.play('attack'); event = { type: 'wild', wild: w, advantage: true }; }
    }
    if (!event && touched && !this.mount && !safe) event = { type: 'wild', wild: touched, advantage: false };

    // ── tall grass (per-land table; night adds night-only Mystics)
    this.grassGrace = Math.max(0, this.grassGrace - dt);
    if (!event && this.grassMeter >= 1 && !this.mount && !safe) {
      this.grassMeter -= 1;
      const lure = (state.buffs.lure ?? 0) > Date.now() ? 2 : 1;
      if (this.grassGrace <= 0 && Math.random() < 0.07 * lure) {
        const zone = this.zone;
        const pool = spawnsBy(zone, this.atmo.night > 0.5 ? ['grass', 'night'] : ['grass']);
        if (pool.length) {
          event = { type: 'grass', species: weighted(pool).species, level: randInt(zone.levels[0], zone.levels[1]), shiny: shinyRoll(), zone };
          emit('grass', { zone: zone.id });
        }
      }
    }
    if (event) this.grassGrace = 4;
    return event;
  }

  onDoubleJump?: (p: THREE.Vector3) => void;
  onLand?: (p: THREE.Vector3) => void;

  inTallGrass() { return this.data.tallAt(this.playerPos.x, this.playerPos.z) > 0.32; }
  get isNight() { return this.atmo.night > 0.5; }

  render(dt: number) { this.pipeline.render(dt); }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(w, h);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
