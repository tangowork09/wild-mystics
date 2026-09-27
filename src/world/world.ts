import * as THREE from 'three';
import { makePipeline, Q, type Pipeline } from '../core/renderer';
import { input } from '../core/input';
import { makePlayerRig, makeCreatureRig, manifestTexture } from '../assets/manifest';
import type { Rig } from '../assets/placeholders';
import { ZONES, WATER_LEVEL, WORLD_SIZE, zoneAt, zoneWeights, type Zone } from '../data/zones';
import { randInt, randRange, weighted } from '../core/noise';
import { state } from '../game/state';
import { TerrainData, buildTerrainMesh, FEATURES } from './terrain';
import { Grass } from './grass';
import { Water } from './water';
import { Atmosphere } from './atmosphere';
import { Props } from './props';
import { Structures, type Interactable } from './towns';
import { Wilds, type Wild } from './wilds';

export type WorldEvent =
  | { type: 'wild'; wild: Wild; advantage: boolean }
  | { type: 'grass'; species: string; level: number; shiny: boolean; zone: Zone }
  | { type: 'interact'; target: Interactable };

interface SearchSpot { pos: THREE.Vector3; readyAt: number; group: THREE.Group; zone: Zone }

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
  wilds!: Wilds;
  player!: Rig;
  playerPos = new THREE.Vector3();
  private heading = 0;
  camYaw = Math.PI;
  camPitch = 0.38;
  camDist = 10;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  zone: Zone = ZONES[0];
  onZoneEnter?: (z: Zone) => void;
  nearInteract: Interactable | null = null;
  searchSpots: SearchSpot[] = [];
  bossRigs = new Map<string, Rig>();
  private grassMeter = 0;
  private grassGrace = 3;
  private stepAcc = 0;
  titleMode = true;
  /** While true the battle owns the camera and the explorer; exploration logic is suspended. */
  battleMode = false;
  private sparkMat!: THREE.PointsMaterial;

  async build(progress: (m: string) => void) {
    progress('Shaping the land…');
    await tick();
    this.data.bake();
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
    this.scene.add(this.structures.group);
    progress('Releasing wild creatures…');
    await tick();
    this.wilds = new Wilds(this.data, this.props);
    this.wilds.populate();
    this.scene.add(this.wilds.group);
    this.buildBosses();
    this.buildSearchSpots();

    this.player = makePlayerRig();
    this.scene.add(this.player.root);
    this.teleport(state.pos[0], state.pos[1]);
    this.pipeline = makePipeline(this.scene, this.camera);
    this.atmo.update(0.016, 0, this.playerPos, this.playerPos.y);
    this.atmo.refreshEnv();
  }

  private buildBosses() {
    for (const z of ZONES) {
      const rig = makeCreatureRig(z.boss.species);
      const [x, zz] = z.boss.pos;
      rig.root.position.set(x, this.data.heightAt(x, zz), zz);
      rig.root.rotation.y = Math.atan2(z.camp[0] - x, z.camp[1] - zz);
      this.scene.add(rig.root);
      this.bossRigs.set(z.id, rig);
      this.structures.interactables.push({
        pos: rig.root.position.clone(), radius: 11, label: `Challenge ${z.boss.species.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`,
        kind: 'boss', zone: z, id: `${z.id}-boss`, enabled: () => !state.bosses.includes(z.id),
      });
    }
    this.refreshBosses();
  }

  refreshBosses() {
    for (const z of ZONES) {
      const dead = state.bosses.includes(z.id);
      const rig = this.bossRigs.get(z.id);
      if (rig) rig.root.visible = !dead;
      this.structures.setBossDefeated(z.id, dead);
    }
  }

  private buildSearchSpots() {
    this.sparkMat = new THREE.PointsMaterial({ color: '#fff2a8', size: 0.28, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const bushMat = new THREE.MeshStandardMaterial({ color: '#8ac43a', emissive: '#6a8a1a', emissiveIntensity: 0.35, flatShading: true, roughness: 0.7 });
    for (const zone of ZONES) {
      let n = 0, tries = 0;
      while (n < 9 && tries++ < 400) {
        const x = zone.center[0] + randRange(-130, 130), z = zone.center[1] + randRange(-130, 130);
        if (zoneWeights(x, z)[ZONES.indexOf(zone)] < 0.7) continue;
        const h = this.data.heightAt(x, z);
        if (h < WATER_LEVEL + 0.5 || this.data.slopeAt(x, z) > 0.6 || this.data.pathAt(x, z) > 0.1) continue;
        if (FEATURES.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + 10)) continue;
        const g = new THREE.Group();
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), bushMat);
        bush.scale.set(1.2, 0.8, 1.1); bush.position.y = 0.45; bush.castShadow = true;
        g.add(bush);
        const pts = new Float32Array(10 * 3);
        for (let i = 0; i < 10; i++) { pts[i * 3] = (Math.random() - 0.5) * 1.6; pts[i * 3 + 1] = 0.5 + Math.random() * 1.2; pts[i * 3 + 2] = (Math.random() - 0.5) * 1.6; }
        const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const sp = new THREE.Points(pg, this.sparkMat); sp.name = 'spark';
        g.add(sp);
        g.position.set(x, h, z);
        this.scene.add(g);
        const spot: SearchSpot = { pos: g.position.clone(), readyAt: 0, group: g, zone };
        this.searchSpots.push(spot);
        this.structures.interactables.push({ pos: spot.pos, radius: 2.8, label: 'Search the glimmering bush', kind: 'search', zone, id: `search-${this.searchSpots.length}`, enabled: () => performance.now() > spot.readyAt });
        n++;
      }
    }
  }

  searchSpotAt(p: THREE.Vector3) { return this.searchSpots.find((s) => s.pos.distanceTo(p) < 0.1); }
  consumeSearch(p: THREE.Vector3) {
    const s = this.searchSpotAt(p);
    if (s) { s.readyAt = performance.now() + 150000; s.group.getObjectByName('spark')!.visible = false; }
  }

  teleport(x: number, z: number) {
    this.playerPos.set(x, this.data.heightAt(x, z), z);
    this.player.root.position.copy(this.playerPos);
    this.camTarget.copy(this.playerPos);
    this.zone = zoneAt(x, z);
    this.atmo?.setZoneWeights(zoneWeights(x, z));
    this.snapCamera();
  }

  snapCamera() {
    this.camTarget.set(this.playerPos.x, this.playerPos.y + 1.6, this.playerPos.z);
    this.camPos.copy(this.desiredCam());
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  private desiredCam() {
    const d = this.camDist;
    const p = new THREE.Vector3(
      this.camTarget.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * d,
      this.camTarget.y + Math.sin(this.camPitch) * d,
      this.camTarget.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * d,
    );
    // pull the camera in when a building or boulder sits between it and the player
    const tx = this.camTarget.x, tz = this.camTarget.z;
    const dx = p.x - tx, dz = p.z - tz;
    if (this.props && dx * dx + dz * dz > 0.01) {
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
    for (const c of this.props.nearby(x, z)) {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.45;
      if (d < min && d > 0.0001) { x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; }
    }
    return [x, z];
  }

  update(dt: number, t: number, paused: boolean): WorldEvent | null {
    let event: WorldEvent | null = null;
    // ── camera input
    const look = input.consumeLook();
    const zoom = input.consumeZoom();
    if (!paused && !this.titleMode && !this.battleMode) {
      this.camYaw -= look.x * 0.005;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + look.y * 0.004, 0.08, 1.2);
      this.camDist = THREE.MathUtils.clamp(this.camDist + zoom * 0.8, 5, 18);
    }

    // ── player movement
    let moving = 0;
    if (!paused && !this.titleMode && !this.battleMode) {
      const mx = input.move.x, my = input.move.y;
      const mag = Math.hypot(mx, my);
      if (mag > 0.05) {
        const fwd = new THREE.Vector2(-Math.sin(this.camYaw), -Math.cos(this.camYaw));
        const right = new THREE.Vector2(-fwd.y, fwd.x);
        const dir = new THREE.Vector2().addScaledVector(fwd, my).addScaledVector(right, mx);
        dir.normalize();
        const speed = (input.sprint || (input.isTouch && mag > 0.92) ? 11 : 6.5) * Math.min(1, mag);
        let nx = this.playerPos.x + dir.x * speed * dt;
        let nz = this.playerPos.z + dir.y * speed * dt;
        [nx, nz] = this.collide(nx, nz);
        const lim = WORLD_SIZE / 2 - 12;
        nx = THREE.MathUtils.clamp(nx, -lim, lim);
        nz = THREE.MathUtils.clamp(nz, -lim, lim);
        const nh = this.data.heightAt(nx, nz);
        const deep = nh < WATER_LEVEL - 0.7;
        const steep = this.data.slopeAt(nx, nz) > 1.35 && nh > this.playerPos.y;
        if (!deep && !steep) {
          const moved = Math.hypot(nx - this.playerPos.x, nz - this.playerPos.z);
          this.playerPos.set(nx, nh, nz);
          this.stepAcc += moved;
          if (this.data.tallAt(nx, nz) > 0.32) this.grassMeter += moved;
        }
        this.heading = Math.atan2(dir.x, dir.y);
        moving = Math.min(1, speed / 7);
      }
    }
    if (this.stepAcc >= 1) { state.steps += Math.floor(this.stepAcc); this.stepAcc -= Math.floor(this.stepAcc); }
    const r = this.player.root;
    if (!this.battleMode) {
      r.position.lerp(this.playerPos, 1 - Math.exp(-dt * 30));
      const diff = Math.atan2(Math.sin(this.heading - r.rotation.y), Math.cos(this.heading - r.rotation.y));
      r.rotation.y += diff * Math.min(1, dt * 12);
      this.player.update(dt, moving);
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
      this.camTarget.lerp(new THREE.Vector3(this.playerPos.x, this.playerPos.y + 1.6, this.playerPos.z), 1 - Math.exp(-dt * 10));
      this.camPos.lerp(this.desiredCam(), 1 - Math.exp(-dt * 8));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camTarget);
    }

    // ── zone
    const zNow = zoneAt(this.playerPos.x, this.playerPos.z);
    if (zNow !== this.zone) { this.zone = zNow; if (!this.titleMode) this.onZoneEnter?.(zNow); }
    this.atmo.setZoneWeights(zoneWeights(this.playerPos.x, this.playerPos.z));

    // ── systems
    const focus = this.titleMode ? new THREE.Vector3(ZONES[0].town.pos[0], this.playerPos.y, ZONES[0].town.pos[1]) : this.playerPos;
    this.atmo.update(dt, t, focus, this.playerPos.y);
    this.grass.update(t, this.titleMode ? focus : this.playerPos);
    this.water.update(t);
    this.props.update(t);
    this.structures.update(dt, t);
    for (const [zid, rig] of this.bossRigs) {
      if (!rig.root.visible) continue;
      const z = ZONES.find((zz) => zz.id === zid)!;
      if (Math.hypot(z.boss.pos[0] - this.playerPos.x, z.boss.pos[1] - this.playerPos.z) < 140) rig.update(dt, 0);
    }
    for (const s of this.searchSpots) {
      const sp = s.group.getObjectByName('spark')!;
      if (performance.now() > s.readyAt) sp.visible = true;
      sp.rotation.y = t * 0.8;
    }
    this.sparkMat.size = 0.22 + Math.sin(t * 4) * 0.06;

    const touched = this.battleMode ? null : this.wilds.update(dt, this.playerPos, this.camera, paused || this.titleMode);
    if (paused || this.titleMode || this.battleMode) return null;

    // ── interactions
    this.nearInteract = null;
    let best = Infinity;
    for (const it of this.structures.interactables) {
      if (!it.enabled()) continue;
      const d = Math.hypot(it.pos.x - this.playerPos.x, it.pos.z - this.playerPos.z);
      if (d < it.radius && d < best) { best = d; this.nearInteract = it; }
    }
    if (this.nearInteract && input.hit('e', 'enter')) event = { type: 'interact', target: this.nearInteract };

    // ── strike first
    if (!event && input.hit('f')) {
      const w = this.wilds.nearestTo(this.playerPos, 3.2);
      if (w && w.cooldown <= 0) { this.player.play('attack'); event = { type: 'wild', wild: w, advantage: true }; }
    }
    if (!event && touched) event = { type: 'wild', wild: touched, advantage: false };

    // ── tall grass
    this.grassGrace = Math.max(0, this.grassGrace - dt);
    if (!event && this.grassMeter >= 1) {
      this.grassMeter -= 1;
      if (this.grassGrace <= 0 && Math.random() < 0.075) {
        const zone = this.zone;
        event = { type: 'grass', species: weighted(zone.spawns).species, level: randInt(zone.levels[0], zone.levels[1]), shiny: Math.random() < 1 / 100, zone };
      }
    }
    if (event) this.grassGrace = 4;
    return event;
  }

  inTallGrass() { return this.data.tallAt(this.playerPos.x, this.playerPos.z) > 0.32; }

  render(dt: number) { this.pipeline.render(dt); }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(w, h);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
