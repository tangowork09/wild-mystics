import * as THREE from 'three';
import { Q } from '../core/renderer';
import { makeNoise2D, fbm, randRange } from '../core/noise';
import { ZONES, WORLD_SIZE, WATER_LEVEL, zoneWeights, type FloraKey } from '../data/zones';
import { envVariants } from '../assets/manifest';
import { FEATURES, type TerrainData } from './terrain';

// Instanced environment props. Each kind has 1..n prototype variants (GLB from the manifest,
// otherwise a stylised procedural stand-in); every mesh of a variant becomes one InstancedMesh.

export type PropKey = FloraKey | 'pathstone';

interface Def {
  key: PropKey;
  /** Counts per zone come from each Zone's `flora` table (pathstones use a fixed road density). */
  perZone?: number;
  scale: [number, number];
  maxSlope: number;
  collider: number; // collider radius per unit scale (0 = walk-through)
  clump: number;    // 0 = uniform, 1 = strongly clumped into forests
  sway: number;
  /** Only on roads / town plazas instead of avoiding them. */
  onPath?: boolean;
  /** Only along shorelines (reeds). */
  nearWater?: boolean;
}

const DEFS: Def[] = [
  { key: 'tree_round', scale: [0.8, 1.35], maxSlope: 0.7, collider: 0.5, clump: 0.8, sway: 1 },
  { key: 'tree_pine', scale: [0.75, 1.4], maxSlope: 0.9, collider: 0.45, clump: 0.8, sway: 0.5 },
  { key: 'tree_dead', scale: [0.8, 1.35], maxSlope: 0.9, collider: 0.45, clump: 0.4, sway: 0 },
  { key: 'tree_twisted', scale: [0.8, 1.3], maxSlope: 0.8, collider: 0.5, clump: 0.5, sway: 0.7 },
  { key: 'tree_crystal', scale: [0.7, 1.6], maxSlope: 1.2, collider: 0.6, clump: 0.5, sway: 0 },
  { key: 'cactus', scale: [0.7, 1.5], maxSlope: 0.7, collider: 0.4, clump: 0.3, sway: 0 },
  { key: 'rock', scale: [0.6, 1.8], maxSlope: 2, collider: 0.6, clump: 0.2, sway: 0 },
  { key: 'boulder', scale: [0.8, 1.6], maxSlope: 2, collider: 1.0, clump: 0.1, sway: 0 },
  { key: 'bush', scale: [0.7, 1.4], maxSlope: 0.8, collider: 0, clump: 0.5, sway: 1 },
  { key: 'fern', scale: [0.7, 1.3], maxSlope: 0.8, collider: 0, clump: 0.7, sway: 1.2 },
  { key: 'reeds', scale: [0.8, 1.5], maxSlope: 0.6, collider: 0, clump: 0.8, sway: 1.6, nearWater: true },
  { key: 'mushroom', scale: [0.7, 1.4], maxSlope: 0.7, collider: 0, clump: 0.9, sway: 0 },
  { key: 'flowers', scale: [0.8, 1.4], maxSlope: 0.6, collider: 0, clump: 0.8, sway: 1.4 },
  { key: 'pebbles', scale: [0.8, 1.6], maxSlope: 1.5, collider: 0, clump: 0.3, sway: 0 },
  { key: 'log', scale: [0.8, 1.3], maxSlope: 0.5, collider: 0.6, clump: 0.3, sway: 0 },
  { key: 'pathstone', perZone: 700, scale: [0.7, 1.6], maxSlope: 2, collider: 0, clump: 0, sway: 0, onPath: true },
];

const CHUNK = 130;
const NO_SHADOW: PropKey[] = ['fern', 'mushroom', 'flowers', 'pebbles', 'pathstone', 'reeds'];

export interface Collider { x: number; z: number; r: number }

// ── Placeholder prototypes ───────────────────────────────────────────────
const stdMat = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });

function lumpy(radius: number, detail: number, amp: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const n = makeNoise2D(seed);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + n(v.x * 1.7 + v.y, v.z * 1.7 - v.y) * amp;
    v.multiplyScalar(d);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function tagFoliage(m: THREE.Material) { (m as THREE.Material & { userData: { foliage?: boolean } }).userData.foliage = true; return m; }

function placeholder(key: PropKey, variant: number): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scl: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos); m.scale.set(...scl); m.rotation.set(...rot);
    g.add(m);
    return m;
  };
  const bark = stdMat(variant % 2 ? '#6b4a32' : '#5a3d2a');
  switch (key) {
    case 'tree_round': {
      const leafCols = ['#5aa83a', '#7cbc3a', '#3f8f3a', '#9ac43a'];
      const leaf = tagFoliage(stdMat(leafCols[variant % 4], { roughness: 0.8, flatShading: true }));
      add(new THREE.CylinderGeometry(0.22, 0.38, 3.4, 8).translate(0, 1.7, 0), bark, [0, 0, 0]);
      const blobs = [[0, 4.2, 0, 1.9], [1.1, 3.5, 0.3, 1.3], [-1.0, 3.6, -0.4, 1.35], [0.2, 3.3, 1.0, 1.2], [-0.2, 5.1, 0.1, 1.2]];
      blobs.forEach(([x, y, z, r], i) => add(lumpy(r, 1, 0.12, variant * 10 + i), leaf, [x, y, z]));
      break;
    }
    case 'tree_pine': {
      const leaf = tagFoliage(stdMat(['#2f6b4a', '#3a7a55', '#2a5a48'][variant % 3], { roughness: 0.85, flatShading: true }));
      add(new THREE.CylinderGeometry(0.15, 0.3, 2.2, 7).translate(0, 1.1, 0), bark, [0, 0, 0]);
      for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(1.9 - i * 0.38, 2.2, 8).translate(0, 1.1, 0), leaf, [0, 1.6 + i * 1.15, 0], [1, 1, 1], [0, i * 0.4, 0]);
      if (variant === 2) {
        const snow = stdMat('#f0f4ff', { roughness: 0.6 });
        add(new THREE.ConeGeometry(0.7, 0.9, 8).translate(0, 0.45, 0), snow, [0, 5.45, 0]);
      }
      break;
    }
    case 'tree_dead': {
      const char = stdMat('#2a2220', { roughness: 0.95 });
      add(new THREE.CylinderGeometry(0.12, 0.35, 4, 6).translate(0, 2, 0), char, [0, 0, 0], [1, 1, 1], [0, 0, 0.06]);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + variant;
        add(new THREE.CylinderGeometry(0.04, 0.1, 1.6, 5).translate(0, 0.8, 0), char, [0, 2.2 + i * 0.4, 0], [1, 1, 1], [Math.cos(a) * 0.9, a, Math.sin(a) * 0.9]);
      }
      const ember = new THREE.MeshStandardMaterial({ color: '#ff5a1a', emissive: '#ff4a0a', emissiveIntensity: 2.5 });
      add(new THREE.IcosahedronGeometry(0.1, 0), ember, [0.2, 1.1, 0.25]);
      add(new THREE.IcosahedronGeometry(0.08, 0), ember, [-0.25, 2.1, -0.1]);
      break;
    }
    case 'tree_crystal': {
      const cols = ['#b36bff', '#6fd6ff', '#ff7ad8'];
      const c = new THREE.MeshPhysicalMaterial({ color: cols[variant % 3], emissive: cols[variant % 3], emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1, clearcoat: 1, flatShading: true });
      const base = stdMat('#4a4a5a', { flatShading: true });
      add(lumpy(0.9, 0, 0.2, variant + 50), base, [0, 0.3, 0], [1.2, 0.6, 1.2]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const h = 1.4 + ((i * 37 + variant * 13) % 10) / 4;
        add(new THREE.OctahedronGeometry(0.35, 0).scale(1, h * 1.8, 1), c, [Math.cos(a) * 0.45, h * 0.55, Math.sin(a) * 0.45], [1, 1, 1], [Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35]);
      }
      add(new THREE.OctahedronGeometry(0.45, 0).scale(1, 4.5, 1), c, [0, 2, 0]);
      break;
    }
    case 'rock': {
      const col = ['#8a8580', '#7a746e', '#9a948a'][variant % 3];
      add(lumpy(1, 1, 0.28, variant + 20), stdMat(col, { flatShading: true, roughness: 0.9 }), [0, 0.35, 0], [1, 0.7, 0.9]);
      break;
    }
    case 'boulder': {
      const m = stdMat('#7a7470', { flatShading: true, roughness: 0.9 });
      add(lumpy(1, 1, 0.3, variant + 30), m, [0, 0.6, 0], [1.2, 1, 1]);
      add(lumpy(0.6, 1, 0.3, variant + 31), m, [0.9, 0.3, 0.4]);
      const moss = stdMat('#6a9a3a', { flatShading: true });
      add(lumpy(0.9, 1, 0.2, variant + 32), moss, [0, 1.1, 0], [1.1, 0.25, 0.95]);
      break;
    }
    case 'bush': {
      const leaf = tagFoliage(stdMat(['#4f9a38', '#6aab3a', '#3d7a3a'][variant % 3], { flatShading: true }));
      add(lumpy(0.8, 1, 0.15, variant + 40), leaf, [0, 0.45, 0], [1.2, 0.8, 1.1]);
      add(lumpy(0.55, 1, 0.15, variant + 41), leaf, [0.7, 0.35, 0.2]);
      add(lumpy(0.5, 1, 0.15, variant + 42), leaf, [-0.6, 0.3, -0.2]);
      if (variant === 1) {
        const berry = new THREE.MeshStandardMaterial({ color: '#e0304a', roughness: 0.3 });
        for (let i = 0; i < 6; i++) add(new THREE.SphereGeometry(0.07, 8, 6), berry, [Math.cos(i) * 0.8, 0.6 + (i % 2) * 0.2, Math.sin(i) * 0.7]);
      }
      break;
    }
    case 'fern': {
      const leaf = tagFoliage(stdMat('#5a9a3a', { side: THREE.DoubleSide, roughness: 0.8 }));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        add(new THREE.PlaneGeometry(0.28, 1.1).translate(0, 0.55, 0), leaf, [0, 0, 0], [1, 1, 1], [0.9, a, 0]);
      }
      break;
    }
    case 'mushroom': {
      const stem = stdMat('#f0e6d0');
      const caps = ['#e0402a', '#b36bff', '#f0a030'];
      const cap = new THREE.MeshStandardMaterial({ color: caps[variant % 3], roughness: 0.4, emissive: variant === 1 ? '#8a3aff' : '#000000', emissiveIntensity: variant === 1 ? 0.8 : 0 });
      for (let i = 0; i < 3; i++) {
        const s = 1 - i * 0.25;
        add(new THREE.CylinderGeometry(0.06 * s, 0.09 * s, 0.4 * s, 8).translate(0, 0.2 * s, 0), stem, [i * 0.25, 0, i * 0.15]);
        add(new THREE.SphereGeometry(0.22 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap, [i * 0.25, 0.38 * s, i * 0.15], [1, 0.7, 1]);
      }
      break;
    }
    case 'tree_twisted': {
      const leaf = tagFoliage(stdMat(['#c86a8a', '#e0a040', '#8ab83a'][variant % 3], { flatShading: true }));
      add(new THREE.CylinderGeometry(0.2, 0.35, 3.2, 7).translate(0, 1.6, 0), bark, [0, 0, 0], [1, 1, 1], [0.15, 0, -0.1]);
      add(lumpy(1.6, 1, 0.15, variant + 70), leaf, [0.4, 3.8, 0], [1.2, 0.7, 1.1]);
      break;
    }
    case 'flowers': {
      const cols = ['#ff7aa8', '#ffd84a', '#ffffff', '#b58aff'];
      const stem = stdMat('#4a8a2a');
      for (let i = 0; i < 6; i++) {
        const a = i * 2.4, r = 0.2 + (i % 3) * 0.12;
        add(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 4).translate(0, 0.175, 0), stem, [Math.cos(a) * r, 0, Math.sin(a) * r]);
        add(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: cols[(i + variant) % 4], roughness: 0.5 }), [Math.cos(a) * r, 0.36, Math.sin(a) * r]);
      }
      break;
    }
    case 'pebbles': {
      const m = stdMat('#8a8580', { flatShading: true });
      for (let i = 0; i < 4; i++) add(lumpy(0.12 + i * 0.03, 0, 0.2, variant * 5 + i), m, [Math.cos(i * 1.7) * 0.3, 0.05, Math.sin(i * 1.7) * 0.3]);
      break;
    }
    case 'cactus': {
      const skin = stdMat(['#5a8a3a', '#4f7a34', '#6a9a44'][variant % 3], { roughness: 0.7 });
      const trunkH = 2.2 + variant * 0.5;
      add(new THREE.CapsuleGeometry(0.32, trunkH, 6, 12).translate(0, trunkH / 2 + 0.3, 0), skin, [0, 0, 0]);
      for (const [side, hgt] of [[-1, 1.2], [1, 1.7]] as [number, number][]) {
        if (variant === 2 && side > 0) continue;
        add(new THREE.CapsuleGeometry(0.2, 0.6, 5, 10).rotateZ(Math.PI / 2).translate(side * 0.55, hgt, 0), skin, [0, 0, 0]);
        add(new THREE.CapsuleGeometry(0.2, 0.9, 5, 10).translate(side * 0.95, hgt + 0.55, 0), skin, [0, 0, 0]);
      }
      if (variant === 1) add(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff6a8a', roughness: 0.5 }), [0, trunkH + 0.65, 0]);
      break;
    }
    case 'reeds': {
      const leaf = tagFoliage(stdMat(['#6a8a3a', '#7a9a4a', '#5a7a3a'][variant % 3], { side: THREE.DoubleSide, roughness: 0.8 }));
      const tip = stdMat('#6a4a2a');
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, r = 0.15 + (i % 3) * 0.12, hgt = 1.2 + (i % 4) * 0.25;
        add(new THREE.CylinderGeometry(0.015, 0.025, hgt, 4).translate(0, hgt / 2, 0), leaf, [Math.cos(a) * r, 0, Math.sin(a) * r], [1, 1, 1], [Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12]);
        if (i % 3 === 0) add(new THREE.CapsuleGeometry(0.04, 0.22, 4, 6).translate(0, hgt, 0), tip, [Math.cos(a) * r, 0, Math.sin(a) * r]);
      }
      break;
    }
    case 'log': {
      add(new THREE.CylinderGeometry(0.35, 0.4, 3, 10).rotateZ(Math.PI / 2), bark, [0, 0.35, 0]);
      add(new THREE.CircleGeometry(0.34, 10).rotateY(Math.PI / 2), stdMat('#c8a070'), [1.51, 0.35, 0]);
      break;
    }
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ── Scatter ──────────────────────────────────────────────────────────────
export class Props {
  group = new THREE.Group();
  colliders: Collider[] = [];
  private grid = new Map<string, Collider[]>();
  private swayUniform = { value: 0 };
  private clearUniform = { value: new THREE.Vector3(0, 0, 0) };

  constructor(private data: TerrainData) {}

  build() {
    const clumpNoise = makeNoise2D(777);
    const HALF = WORLD_SIZE / 2;
    const occupied = new Map<string, number>();
    const cellKey = (x: number, z: number, s: number) => `${Math.floor(x / s)},${Math.floor(z / s)}`;

    for (const def of DEFS) {
      const protos = envVariants(def.key) ?? (def.onPath ? null : [0, 1, 2].map((v) => placeholder(def.key, v)));
      if (!protos) continue;
      const buckets: THREE.Matrix4[][] = protos.map(() => []);
      ZONES.forEach((zone, zi) => {
        const base = def.perZone ?? zone.flora[def.key as FloraKey] ?? 0;
        const want = Math.round(base * (def.onPath ? 1 : Q.trees));
        if (want <= 0) return;
        let placed = 0, tries = 0;
        while (placed < want && tries < want * 25) {
          tries++;
          const x = zone.center[0] + randRange(-175, 175);
          const z = zone.center[1] + randRange(-175, 175);
          if (Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6) continue;
          const w = zoneWeights(x, z);
          if (w[zi] < 0.55) continue;
          const h = this.data.heightAt(x, z);
          if (def.nearWater) { if (h < WATER_LEVEL - 0.3 || h > WATER_LEVEL + 1.2) continue; }
          else if (h < WATER_LEVEL + 0.5) continue;
          if (this.data.slopeAt(x, z) > def.maxSlope) continue;
          if (def.onPath) {
            const onRoad = this.data.pathAt(x, z) > 0.55;
            const onPlaza = FEATURES.some((f) => f.kind === 'town' && Math.hypot(x - f.x, z - f.z) < f.r - 12 && Math.hypot(x - f.x, z - f.z) > 4.5);
            if (!onRoad && !onPlaza) continue;
          } else {
            if (this.data.pathAt(x, z) > 0.05) continue;
            if (FEATURES.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + (f.kind === 'town' ? 4 : 2))) continue;
          }
          if (def.clump > 0) {
            const c = fbm(clumpNoise, x * 0.018 + def.key.length * 13, z * 0.018, 3);
            if (Math.random() > Math.pow(THREE.MathUtils.clamp(c * 1.6 + 0.5, 0, 1), 1 + def.clump * 3)) continue;
          }
          const s = randRange(def.scale[0], def.scale[1]);
          const spacing = def.collider > 0 ? 2.4 * s : 0.9;
          const key = cellKey(x, z, spacing);
          if (def.collider > 0 && occupied.has(key)) continue;
          occupied.set(key, 1);
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(x, h - 0.05, z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * Math.PI * 2, 0)),
            new THREE.Vector3(s, s * randRange(0.9, 1.15), s),
          );
          buckets[Math.floor(Math.random() * protos.length)].push(m);
          if (def.collider > 0) this.addCollider({ x, z, r: def.collider * s });
          placed++;
        }
      });

      protos.forEach((proto, vi) => {
        const mats = buckets[vi];
        if (!mats.length) return;
        // split instances into spatial chunks so camera + shadow frustum culling can skip them
        const chunks = new Map<string, THREE.Matrix4[]>();
        const p = new THREE.Vector3();
        for (const m of mats) {
          p.setFromMatrixPosition(m);
          const k = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
          let c = chunks.get(k);
          if (!c) { c = []; chunks.set(k, c); }
          c.push(m);
        }
        proto.updateMatrixWorld(true);
        proto.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const local = mesh.matrixWorld.clone();
          const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
          const foliage = material.userData.foliage || /leaf|leav|foliage|bush|fern|needle|flower|petal|grass|plant|clover/i.test(material.name);
          this.hook(material, def.sway > 0 && foliage ? def.sway : 0);
          if (material.transparent && material.alphaTest === 0) { material.alphaTest = 0.5; material.transparent = false; }
          for (const list of chunks.values()) {
            const inst = new THREE.InstancedMesh(mesh.geometry, material, list.length);
            const tmp = new THREE.Matrix4();
            list.forEach((m, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(m, local)));
            inst.castShadow = !NO_SHADOW.includes(def.key);
            inst.receiveShadow = true;
            inst.computeBoundingSphere();
            this.group.add(inst);
          }
        });
      });
    }
  }

  /** Battle clearing: instances within `r` of (x, z) are collapsed so they don't block the camera. */
  setClear(x: number, z: number, r: number) { this.clearUniform.value.set(x, z, r); }

  private hook(mat: THREE.Material, sway: number) {
    if (mat.userData.hooked) return;
    mat.userData.hooked = true;
    const u = this.swayUniform, c = this.clearUniform;
    const key = `prop-${sway.toFixed(2)}`;
    mat.customProgramCacheKey = () => key;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSway = u;
      sh.uniforms.uClear = c;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uSway;\nuniform vec3 uClear;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
          #else
            vec3 ip = vec3(0.0);
          #endif
          ${sway > 0 ? `float sw = sin(uSway * 1.3 + ip.x * 0.2 + ip.z * 0.15) * 0.5 + sin(uSway * 2.1 + ip.z * 0.3) * 0.25;
          transformed.x += sw * ${(0.03 * sway).toFixed(3)} * max(transformed.y, 0.0);
          transformed.z += sw * ${(0.02 * sway).toFixed(3)} * max(transformed.y, 0.0);` : ''}
          if (uClear.z > 0.0 && distance(ip.xz, uClear.xy) < uClear.z) transformed *= 0.0;`);
    };
    mat.needsUpdate = true;
  }

  addCollider(c: Collider) {
    this.colliders.push(c);
    const k = `${Math.floor(c.x / 8)},${Math.floor(c.z / 8)}`;
    let list = this.grid.get(k);
    if (!list) { list = []; this.grid.set(k, list); }
    list.push(c);
  }

  nearby(x: number, z: number): Collider[] {
    const out: Collider[] = [];
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.grid.get(`${cx + i},${cz + j}`);
      if (l) out.push(...l);
    }
    return out;
  }

  update(t: number) { this.swayUniform.value = t; }
}
