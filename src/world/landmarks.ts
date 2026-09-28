import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { ZONES, WATER_LEVEL, zoneWeights, type Zone } from '../data/zones';
import { ELEMENTS } from '../data/elements';
import { TAMERS } from '../data/tamers';
import { MATERIALS, type MaterialId } from '../data/items';
import { makeNpcRig } from '../assets/manifest';
import { buildPlayer, type Rig } from '../assets/placeholders';
import { state } from '../game/state';
import { FEATURES, PATHS, type TerrainData } from './terrain';
import type { Props } from './props';
import type { Interactable } from './towns';

// Waystones (fast travel), gathering nodes, glimmer nests (search) and wandering Tamers.
// Placement is seeded per land, so every device builds the same world.

export interface Waystone { id: string; zone: Zone; pos: THREE.Vector3; group: THREE.Group; crystal: THREE.Mesh; ring: THREE.Mesh }
export interface GatherNode { id: string; zone: Zone; type: MaterialId; pos: THREE.Vector3; group: THREE.Group }
export interface SearchSpot { id: string; zone: Zone; pos: THREE.Vector3; group: THREE.Group; readyAt: number }
export interface TamerNpc { id: string; zone: Zone; rig: Rig; pos: THREE.Vector3; mark: THREE.Sprite }
export interface FishingSpot { id: string; zone: Zone; pos: THREE.Vector3; ripple: THREE.Mesh; readyAt: number }

const NODE_TYPES: Record<string, MaterialId[]> = {
  vale: ['wood', 'wood', 'fiber', 'stone'],
  lakes: ['wood', 'fiber', 'fiber', 'stone'],
  scar: ['ore', 'ore', 'stone', 'crystal'],
  marsh: ['fiber', 'wood', 'crystal', 'fiber'],
  dunes: ['ore', 'stone', 'crystal', 'stone'],
  peaks: ['crystal', 'crystal', 'ore', 'stone'],
};

const seedOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function markTexture(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color; g.beginPath(); g.moveTo(64, 8); g.lineTo(120, 64); g.lineTo(64, 120); g.lineTo(8, 64); g.closePath(); g.fill();
  g.strokeStyle = '#1a1420'; g.lineWidth = 8; g.stroke();
  g.fillStyle = '#1a1420'; g.font = 'bold 64px Cinzel, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Landmarks {
  group = new THREE.Group();
  interactables: Interactable[] = [];
  waystones: Waystone[] = [];
  nodes: GatherNode[] = [];
  searches: SearchSpot[] = [];
  tamers: TamerNpc[] = [];
  fishing: FishingSpot[] = [];
  private sparkMat = new THREE.PointsMaterial({ color: '#fff2a8', size: 0.28, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

  constructor(private data: TerrainData, private props: Props) {}

  private spot(zone: Zone, rnd: () => number, minTownDist: number, avoid: THREE.Vector3[], minSep: number, tries = 400): THREE.Vector3 | null {
    const zi = ZONES.indexOf(zone);
    for (let t = 0; t < tries; t++) {
      const x = zone.center[0] + (rnd() * 2 - 1) * 165;
      const z = zone.center[1] + (rnd() * 2 - 1) * 165;
      if (Math.abs(x) > 345 || Math.abs(z) > 345) continue;
      if (zoneWeights(x, z)[zi] < 0.75) continue;
      const h = this.data.heightAt(x, z);
      if (h < WATER_LEVEL + 0.6 || this.data.slopeAt(x, z) > 0.6) continue;
      if (FEATURES.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + minTownDist)) continue;
      if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < minSep)) continue;
      if (this.props.nearby(x, z).some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1.5)) continue;
      return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  build() {
    const all: THREE.Vector3[] = [];
    for (const zone of ZONES) {
      const rnd = mulberry32(seedOf(zone.id + ':landmarks'));
      // waystones: 3 per land, spread out
      for (let i = 0; i < 3; i++) {
        const p = this.spot(zone, rnd, 30, all, 70);
        if (!p) continue;
        all.push(p);
        this.addWaystone(`${zone.id}-ws${i}`, zone, p);
      }
      // gather nodes
      const types = NODE_TYPES[zone.id] ?? ['wood', 'stone'];
      for (let i = 0; i < 16; i++) {
        const p = this.spot(zone, rnd, 12, all, 14);
        if (!p) continue;
        all.push(p);
        this.addNode(`${zone.id}-n${i}`, zone, types[i % types.length], p);
      }
      // fishing spots along shores (only in lands with fish)
      if (zone.spawns.some((sp) => sp.method === 'fish')) {
        let made = 0;
        for (let t = 0; t < 900 && made < 5; t++) {
          const x = zone.center[0] + (rnd() * 2 - 1) * 170, z = zone.center[1] + (rnd() * 2 - 1) * 170;
          if (zoneWeights(x, z)[ZONES.indexOf(zone)] < 0.7) continue;
          const h = this.data.heightAt(x, z);
          if (h < WATER_LEVEL + 0.15 || h > WATER_LEVEL + 1.1) continue;
          // needs open water a few metres away
          let deep: [number, number] | null = null;
          for (let a = 0; a < 8 && !deep; a++) {
            const ang = (a / 8) * Math.PI * 2;
            const wx = x + Math.cos(ang) * 5, wz = z + Math.sin(ang) * 5;
            if (this.data.heightAt(wx, wz) < WATER_LEVEL - 0.8 && !(this.data.lavaAt(wx, wz) > 0.5)) deep = [wx, wz];
          }
          if (!deep || all.some((p) => Math.hypot(p.x - x, p.z - z) < 30)) continue;
          const pos = new THREE.Vector3(x, h, z);
          all.push(pos);
          this.addFishing(`${zone.id}-f${made}`, zone, pos, deep);
          made++;
        }
      }
      // glimmer nests (search)
      for (let i = 0; i < 10; i++) {
        const p = this.spot(zone, rnd, 12, all, 16);
        if (!p) continue;
        all.push(p);
        this.addSearch(`${zone.id}-s${i}`, zone, p);
      }
    }
    // tamers stand beside roads inside their land
    const roadPts = PATHS.flatMap((p) => p.slice(2, -2));
    TAMERS.forEach((t, idx) => {
      const zone = ZONES.find((z) => z.id === t.zone)!;
      const zi = ZONES.indexOf(zone);
      const rnd = mulberry32(seedOf(t.id));
      const cands = roadPts.filter(([x, z]) => zoneWeights(x, z)[zi] > 0.8 && !FEATURES.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + 18));
      if (!cands.length) return;
      const [rx, rz] = cands[Math.floor(rnd() * cands.length)];
      const side = rnd() < 0.5 ? -1 : 1;
      const x = rx + side * 4.5, z = rz + side * 1.5;
      const pos = new THREE.Vector3(x, this.data.heightAt(x, z), z);
      const rig = makeNpcRig(idx + 1) ?? buildPlayer();
      rig.root.position.copy(pos);
      rig.root.rotation.y = Math.atan2(rx - x, rz - z);
      this.group.add(rig.root);
      const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTexture('!', '#ffd76a'), depthWrite: false, transparent: true }));
      mark.scale.setScalar(0.9);
      mark.position.copy(pos).add(new THREE.Vector3(0, 2.6, 0));
      this.group.add(mark);
      this.tamers.push({ id: t.id, zone, rig, pos, mark });
      this.props.addCollider({ x, z, r: 0.6 });
      this.interactables.push({ pos, radius: 3.5, label: `${t.title} ${t.name} — Battle`, kind: 'tamer', zone, id: t.id, data: t.id, enabled: () => true });
    });
  }

  private addWaystone(id: string, zone: Zone, pos: THREE.Vector3) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: '#8a8494', roughness: 0.85, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 0.5, 8), stone);
    base.position.y = 0.25; base.castShadow = base.receiveShadow = true; g.add(base);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 3.4, 6), stone);
    pillar.position.y = 2.1; pillar.castShadow = true; g.add(pillar);
    const col = ELEMENTS[zoneElement(zone)].color;
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0).scale(0.8, 1.6, 0.8), new THREE.MeshStandardMaterial({ color: '#8a8494', emissive: col, emissiveIntensity: 0.1, roughness: 0.15 }));
    crystal.position.y = 4.5; g.add(crystal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.035, 6, 40), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.2 }));
    ring.position.y = 4.5; ring.rotation.x = Math.PI / 2; g.add(ring);
    g.position.copy(pos);
    this.group.add(g);
    this.props.addCollider({ x: pos.x, z: pos.z, r: 1.4 });
    this.waystones.push({ id, zone, pos, group: g, crystal, ring });
    this.interactables.push({ pos, radius: 4, label: 'Waystone — Fast Travel', kind: 'waystone', zone, id, data: id, enabled: () => true });
  }

  private addNode(id: string, zone: Zone, type: MaterialId, pos: THREE.Vector3) {
    const g = new THREE.Group();
    const M = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true, ...o });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh;
    };
    if (type === 'wood') {
      const bark = M('#6b4a32'), cut = M('#d8b080');
      for (let i = 0; i < 3; i++) { add(new THREE.CylinderGeometry(0.28, 0.3, 2.4, 8), bark, 0, 0.3 + (i === 2 ? 0.45 : 0), (i === 2 ? 0 : i - 0.5) * 0.6, Math.PI / 2, 0, 0); add(new THREE.CircleGeometry(0.27, 8), cut, 1.21, 0.3 + (i === 2 ? 0.45 : 0), (i === 2 ? 0 : i - 0.5) * 0.6, 0, Math.PI / 2, 0); }
    } else if (type === 'stone' || type === 'ore') {
      const rock = M(type === 'ore' ? '#6a5a50' : '#9a948a');
      add(new THREE.DodecahedronGeometry(0.7, 0), rock, 0, 0.45, 0);
      add(new THREE.DodecahedronGeometry(0.45, 0), rock, 0.6, 0.3, 0.3);
      add(new THREE.DodecahedronGeometry(0.35, 0), rock, -0.5, 0.25, -0.3);
      if (type === 'ore') for (let i = 0; i < 6; i++) add(new THREE.OctahedronGeometry(0.1, 0), M('#ffb04a', { emissive: '#ff8a1a', emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.3 }), Math.cos(i) * 0.55, 0.5 + (i % 2) * 0.25, Math.sin(i) * 0.45);
    } else if (type === 'crystal') {
      const cm = M('#b57aff', { emissive: '#8a4aff', emissiveIntensity: 1.1, roughness: 0.15 });
      for (let i = 0; i < 5; i++) add(new THREE.OctahedronGeometry(0.22, 0).scale(1, 2.4, 1), cm, Math.cos(i * 1.3) * 0.35, 0.45, Math.sin(i * 1.3) * 0.35, Math.cos(i) * 0.35, 0, Math.sin(i) * 0.35);
      add(new THREE.DodecahedronGeometry(0.4, 0), M('#6a6470'), 0, 0.15, 0);
    } else {
      const leaf = M('#6aa83a');
      add(new THREE.IcosahedronGeometry(0.6, 1), leaf, 0, 0.45, 0);
      for (let i = 0; i < 6; i++) add(new THREE.IcosahedronGeometry(0.09, 0), M(['#ff7aa8', '#ffe06a', '#ffffff'][i % 3]), Math.cos(i) * 0.5, 0.75, Math.sin(i) * 0.45);
    }
    const spark = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 1.3, 0, 0.4, 1.0, 0.2, -0.3, 1.1, -0.2], 3)), new THREE.PointsMaterial({ color: MATERIALS[type].color, size: 0.3, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    spark.name = 'spark';
    g.add(spark);
    g.position.copy(pos);
    g.rotation.y = pos.x * 1.7;
    this.group.add(g);
    this.nodes.push({ id, zone, type, pos, group: g });
    this.interactables.push({ pos, radius: 2.6, label: `Gather ${MATERIALS[type].name}`, kind: 'gather', zone, id, data: type, enabled: () => (state.gathered[id] ?? 0) < Date.now() });
  }

  private addSearch(id: string, zone: Zone, pos: THREE.Vector3) {
    const g = new THREE.Group();
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), new THREE.MeshStandardMaterial({ color: '#8ac43a', emissive: '#6a8a1a', emissiveIntensity: 0.35, flatShading: true, roughness: 0.7 }));
    bush.scale.set(1.2, 0.8, 1.1); bush.position.y = 0.45; bush.castShadow = true;
    g.add(bush);
    const pts = new Float32Array(12 * 3);
    for (let i = 0; i < 12; i++) { pts[i * 3] = (Math.random() - 0.5) * 1.6; pts[i * 3 + 1] = 0.5 + Math.random() * 1.2; pts[i * 3 + 2] = (Math.random() - 0.5) * 1.6; }
    const sp = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pts, 3)), this.sparkMat);
    sp.name = 'spark';
    g.add(sp);
    g.position.copy(pos);
    this.group.add(g);
    const spot: SearchSpot = { id, zone, pos, group: g, readyAt: 0 };
    this.searches.push(spot);
    this.interactables.push({ pos, radius: 2.8, label: 'Search the glimmering nest', kind: 'search', zone, id, enabled: () => performance.now() > spot.readyAt });
  }

  private addFishing(id: string, zone: Zone, pos: THREE.Vector3, water: [number, number]) {
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#dff8ff', transparent: true, opacity: 0.8, depthWrite: false }));
    ripple.position.set(water[0], WATER_LEVEL + 0.04, water[1]);
    ripple.renderOrder = 4;
    this.group.add(ripple);
    const spot: FishingSpot = { id, zone, pos, ripple, readyAt: 0 };
    this.fishing.push(spot);
    this.interactables.push({ pos, radius: 3.2, label: 'Fishing Spot — Cast a line', kind: 'gather', zone, id, data: 'fish', enabled: () => performance.now() > spot.readyAt });
  }

  consumeFishing(id: string) {
    const f = this.fishing.find((x) => x.id === id);
    if (f) f.readyAt = performance.now() + 45000;
  }

  consumeSearch(id: string) {
    const s = this.searches.find((x) => x.id === id);
    if (s) s.readyAt = performance.now() + 150000;
  }

  update(dt: number, t: number, player: THREE.Vector3, night: number) {
    const now = Date.now();
    for (const w of this.waystones) {
      const attuned = state.waypoints.includes(w.id);
      (w.crystal.material as THREE.MeshStandardMaterial).emissiveIntensity = attuned ? 1.8 + Math.sin(t * 2) * 0.3 : 0.12;
      (w.crystal.material as THREE.MeshStandardMaterial).color.set(attuned ? '#ffffff' : '#8a8494');
      (w.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = attuned ? 1.5 : 0.2;
      w.crystal.position.y = 4.5 + Math.sin(t * 1.4 + w.pos.x) * 0.15;
      w.crystal.rotation.y = t * (attuned ? 1.2 : 0.3);
      w.ring.rotation.z = t * 0.6;
    }
    for (const n of this.nodes) {
      const ready = (state.gathered[n.id] ?? 0) < now;
      const sp = n.group.getObjectByName('spark')!;
      sp.visible = ready;
      const target = ready ? 1 : 0.55;
      n.group.scale.setScalar(THREE.MathUtils.lerp(n.group.scale.x, target, 1 - Math.exp(-dt * 4)));
    }
    this.sparkMat.size = 0.22 + Math.sin(t * 4) * 0.06 + night * 0.08;
    for (const s of this.searches) {
      const sp = s.group.getObjectByName('spark')!;
      sp.visible = performance.now() > s.readyAt;
      sp.rotation.y = t * 0.8;
    }
    for (const f of this.fishing) {
      const ready = performance.now() > f.readyAt;
      f.ripple.visible = ready;
      const k = (t * 0.6 + f.pos.x) % 1;
      f.ripple.scale.setScalar(0.6 + k * 1.6);
      (f.ripple.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
    }
    for (const tm of this.tamers) {
      const d = Math.hypot(player.x - tm.pos.x, player.z - tm.pos.z);
      if (d < 90) tm.rig.update(dt, 0);
      tm.rig.root.visible = d < 110;
      const beatenToday = state.tamers[tm.id] === new Date().toISOString().slice(0, 10);
      tm.mark.visible = d < 110 && !beatenToday;
      tm.mark.position.y = tm.pos.y + 2.6 + Math.sin(t * 3) * 0.12;
      if (d < 14) tm.rig.root.rotation.y = Math.atan2(player.x - tm.pos.x, player.z - tm.pos.z);
    }
  }
}

function zoneElement(z: Zone) {
  const m: Record<string, keyof typeof ELEMENTS> = { vale: 'nature', lakes: 'water', scar: 'fire', marsh: 'void', dunes: 'earth', peaks: 'storm' };
  return m[z.id] ?? 'nature';
}
