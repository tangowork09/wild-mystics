import * as THREE from 'three';
import { envModel, makeCreatureRig } from '../assets/manifest';
import type { Rig } from '../assets/placeholders';
import { STRUCTURES, structureDef } from '../data/structures';
import { HOMESTEAD, ZONES } from '../data/zones';
import { state } from '../game/state';
import { pending, residents, placementValid } from '../game/base';
import type { TerrainData } from './terrain';
import type { Props } from './props';
import type { Interactable } from './towns';

// Renders the player's homestead from save state, plus the build-mode ghost and resident Mystics.

const M = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });

function fallbackModel(type: string): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, x = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  switch (type) {
    case 'base_crystal': {
      add(new THREE.CylinderGeometry(1.2, 1.5, 0.6, 8), M('#8a8494', { flatShading: true }), 0.3);
      add(new THREE.OctahedronGeometry(0.8, 0).scale(0.7, 3, 0.7), new THREE.MeshStandardMaterial({ color: '#c8a8ff', emissive: '#8a4aff', emissiveIntensity: 1.4, roughness: 0.1 }), 3.2);
      break;
    }
    case 'base_garden': {
      add(new THREE.BoxGeometry(4, 0.5, 2.6), M('#6b4a32'), 0.25);
      add(new THREE.BoxGeometry(3.7, 0.2, 2.3), M('#4a3222'), 0.52);
      for (let i = 0; i < 12; i++) add(new THREE.IcosahedronGeometry(0.22, 0), M(i % 3 ? '#6ab83a' : '#ffd06a', { flatShading: true }), 0.8, -1.5 + (i % 6) * 0.6, i < 6 ? -0.6 : 0.6);
      break;
    }
    case 'lamp': {
      add(new THREE.CylinderGeometry(0.08, 0.12, 3.2, 8), M('#4a3222'), 1.6);
      add(new THREE.OctahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: '#ffd58a', emissive: '#ffb04a', emissiveIntensity: 2.4 }), 3.35);
      break;
    }
    case 'statue': {
      add(new THREE.BoxGeometry(1.6, 0.8, 1.6), M('#9a9088', { flatShading: true }), 0.4);
      add(new THREE.IcosahedronGeometry(0.9, 1), M('#c8c0b4', { flatShading: true }), 1.8);
      break;
    }
    default: {
      const def = STRUCTURES.find((s) => s.model === type);
      const h = def?.height ?? 4;
      add(new THREE.BoxGeometry(5, h * 0.6, 4), M('#e2d6bc'), h * 0.3);
      add(new THREE.ConeGeometry(3.8, h * 0.45, 4), M('#8a3a2a', { flatShading: true }), h * 0.6 + h * 0.2).rotation.y = Math.PI / 4;
    }
  }
  return g;
}

function modelFor(type: string): THREE.Object3D {
  const def = structureDef(type);
  return envModel('buildings', def.model) ?? envModel('decor', def.model) ?? fallbackModel(def.model);
}

export class Homestead {
  group = new THREE.Group();
  interactables: Interactable[] = [];
  private objs = new Map<string, THREE.Object3D>();
  private labels = new Map<string, THREE.Sprite>();
  private residents = new Map<string, { rig: Rig; home: THREE.Vector3; target: THREE.Vector3; wait: number }>();
  ghost: THREE.Group | null = null;
  private ghostType = '';
  private ghostOk = true;
  private plot: THREE.Mesh;

  constructor(private data: TerrainData, readonly props: Props) {
    // plot boundary ring
    const ringGeo = new THREE.RingGeometry(HOMESTEAD.radius - 0.35, HOMESTEAD.radius, 96).rotateX(-Math.PI / 2);
    this.plot = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffe8a8', transparent: true, opacity: 0.35, depthWrite: false }));
    const [x, z] = HOMESTEAD.center;
    this.plot.position.set(x, this.data.heightAt(x, z) + 0.08, z);
    this.group.add(this.plot);
    this.interactables.push({ pos: new THREE.Vector3(x, this.data.heightAt(x, z), z), radius: HOMESTEAD.radius - 2, label: 'Homestead — Build', kind: 'homestead', zone: ZONES[0], id: 'homestead', enabled: () => true });
  }

  /** Rebuild meshes from save state (cheap; called after any base change). */
  sync() {
    const live = new Set(state.base.structures.map((s) => s.uid));
    for (const [uid, o] of this.objs) if (!live.has(uid)) { this.group.remove(o); this.objs.delete(uid); const l = this.labels.get(uid); if (l) { this.group.remove(l); this.labels.delete(uid); } }
    for (const s of state.base.structures) {
      let o = this.objs.get(s.uid);
      if (!o || (o.userData.level !== s.level)) {
        if (o) this.group.remove(o);
        o = modelFor(s.type);
        o.userData.level = s.level;
        const lvl = 1 + (s.level - 1) * 0.12;
        o.scale.multiplyScalar(lvl);
        this.group.add(o);
        this.objs.set(s.uid, o);
      }
      o.position.set(s.x, this.data.heightAt(s.x, s.z), s.z);
      o.rotation.y = s.rot;
    }
    // interactables per structure
    this.interactables = this.interactables.filter((i) => i.id === 'homestead');
    for (const s of state.base.structures) {
      const def = structureDef(s.type);
      if (def.category === 'decor') continue;
      this.interactables.push({ pos: new THREE.Vector3(s.x, this.data.heightAt(s.x, s.z), s.z), radius: def.radius + 2.2, label: def.name, kind: 'homestead', zone: ZONES[0], id: s.uid, data: s.uid, enabled: () => true });
    }
    // colliders are rebuilt by the world (props grid) — only large structures block
    this.syncResidents();
  }

  colliders() {
    return state.base.structures.filter((s) => structureDef(s.type).radius > 1.5).map((s) => ({ x: s.x, z: s.z, r: structureDef(s.type).radius * 0.8 }));
  }

  private syncResidents() {
    const want = new Map<string, string>();
    for (const s of state.base.structures) if (s.type === 'habitat') for (const c of residents(s)) want.set(c.uid, c.species + (c.shiny ? '*' : ''));
    for (const [uid, r] of this.residents) if (!want.has(uid)) { this.group.remove(r.rig.root); this.residents.delete(uid); }
    for (const [uid, key] of want) {
      if (this.residents.has(uid)) continue;
      const rig = makeCreatureRig(key.replace('*', ''), key.endsWith('*'));
      const [cx, cz] = HOMESTEAD.center;
      const home = new THREE.Vector3(cx + (Math.random() - 0.5) * 20, 0, cz + (Math.random() - 0.5) * 20);
      home.y = this.data.heightAt(home.x, home.z);
      rig.root.position.copy(home);
      this.group.add(rig.root);
      this.residents.set(uid, { rig, home, target: home.clone(), wait: Math.random() * 3 });
    }
  }

  // ── build-mode ghost ────────────────────────────────────────────────────
  startGhost(type: string) {
    this.endGhost();
    this.ghostType = type;
    this.ghost = new THREE.Group();
    const m = modelFor(type);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.material = new THREE.MeshStandardMaterial({ color: '#9fe8b0', transparent: true, opacity: 0.55, emissive: '#3a8a4a', emissiveIntensity: 0.4, depthWrite: false });
    });
    this.ghost.add(m);
    const def = structureDef(type);
    const foot = new THREE.Mesh(new THREE.CircleGeometry(def.radius, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#9fe8b0', transparent: true, opacity: 0.25, depthWrite: false }));
    foot.position.y = 0.1;
    foot.name = 'foot';
    this.ghost.add(foot);
    this.group.add(this.ghost);
  }
  moveGhost(x: number, z: number, rot: number, ignoreUid?: string) {
    if (!this.ghost) return null;
    const snap = (v: number) => Math.round(v * 2) / 2;
    x = snap(x); z = snap(z);
    this.ghost.position.set(x, this.data.heightAt(x, z), z);
    this.ghost.rotation.y = rot;
    const reason = placementValid(this.ghostType, x, z, ignoreUid);
    this.ghostOk = !reason;
    const col = this.ghostOk ? '#9fe8b0' : '#ff8a7a';
    this.ghost.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { const mt = mesh.material as THREE.MeshStandardMaterial; mt.color.set(col); if ('emissive' in mt && mt.emissive) mt.emissive.set(this.ghostOk ? '#3a8a4a' : '#8a2a2a'); }
    });
    return { x, z, reason };
  }
  endGhost() { if (this.ghost) { this.group.remove(this.ghost); this.ghost = null; } }

  update(dt: number, t: number, player: THREE.Vector3) {
    const [cx, cz] = HOMESTEAD.center;
    const near = Math.hypot(player.x - cx, player.z - cz) < 140;
    this.group.visible = near || !!this.ghost;
    if (!near) return;
    (this.plot.material as THREE.MeshBasicMaterial).opacity = this.ghost ? 0.6 + Math.sin(t * 3) * 0.2 : 0.22;
    for (const r of this.residents.values()) {
      let moving = 0;
      r.wait -= dt;
      if (r.wait <= 0) {
        const dx = r.target.x - r.rig.root.position.x, dz = r.target.z - r.rig.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) {
          r.wait = 2 + Math.random() * 5;
          const a = Math.random() * Math.PI * 2, rr = Math.random() * (HOMESTEAD.radius - 4);
          r.target.set(cx + Math.cos(a) * rr, 0, cz + Math.sin(a) * rr);
        } else {
          const sp = 1.5 * dt;
          r.rig.root.position.x += (dx / d) * sp;
          r.rig.root.position.z += (dz / d) * sp;
          r.rig.root.position.y = this.data.heightAt(r.rig.root.position.x, r.rig.root.position.z);
          r.rig.root.rotation.y = Math.atan2(dx, dz);
          moving = 0.4;
        }
      }
      r.rig.update(dt, moving);
    }
    // bob production-ready structures
    for (const s of state.base.structures) {
      const o = this.objs.get(s.uid);
      if (!o) continue;
      const ready = Object.values(pending(s)).some((v) => (v ?? 0) > 0);
      o.userData.ready = ready;
    }
  }
}
