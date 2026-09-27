import * as THREE from 'three';
import type { Look } from '../data/species';

// Procedural stand-in models. Every creature is built from its `Look` so the roster reads
// distinctly until real GLBs are dropped into public/assets and listed in manifest.json.

export type AnimName = 'idle' | 'run' | 'walk' | 'attack' | 'hit' | 'faint' | 'cast' | 'victory' | 'interact';

export interface Rig {
  root: THREE.Group;
  height: number;
  /** `moving` is 0..1 (0 idle, ~0.5 walk, 1 run). */
  update(dt: number, moving: number): void;
  play(anim: AnimName): void;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const sphere = () => geo('sphere', () => new THREE.SphereGeometry(1, 32, 24));
const cone = () => geo('cone', () => new THREE.ConeGeometry(1, 1, 16).translate(0, 0.5, 0));
const capsule = () => geo('capsule', () => new THREE.CapsuleGeometry(1, 1.2, 8, 16));
const wingGeo = () => geo('wing', () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.6, 0.5, 1.4, 0.7, 2, 0.35);
  s.bezierCurveTo(1.6, 0.1, 1.7, -0.2, 1.3, -0.25);
  s.bezierCurveTo(1.0, -0.1, 0.6, -0.3, 0, -0.15);
  return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
});
const leafGeo = () => geo('leaf', () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.35, 0.5, 0, 1.1);
  s.quadraticCurveTo(-0.35, 0.5, 0, 0);
  return new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
});

function mat(color: string, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, metalness: 0.02, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffffff'), ...opts });
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
  const o = new THREE.Mesh(g, m);
  o.position.set(...pos);
  o.scale.set(...scale);
  o.rotation.set(...rot);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

function eyes(head: THREE.Object3D, spread: number, fwd: number, y: number, size: number, glow?: string) {
  const white = new THREE.MeshStandardMaterial({ color: glow ? glow : '#ffffff', emissive: glow ? glow : '#000000', emissiveIntensity: glow ? 2.2 : 0, roughness: 0.2 });
  const pupil = new THREE.MeshStandardMaterial({ color: '#0d0d14', roughness: 0.1 });
  const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const s of [-1, 1]) {
    const e = mesh(sphere(), white, head, [s * spread, y, fwd], [size, size * 1.15, size * 0.7]);
    e.castShadow = false;
    if (!glow) {
      const p = mesh(sphere(), pupil, e, [0, -0.05, 0.62], [0.55, 0.6, 0.5]);
      p.castShadow = false;
      const h = mesh(sphere(), shine, e, [0.25, 0.3, 0.9], [0.2, 0.2, 0.1]);
      h.castShadow = false;
    }
  }
}

export function buildCreature(look: Look, shiny = false): Rig {
  const root = new THREE.Group();
  const pivot = new THREE.Group(); // animated squash/stretch container
  root.add(pivot);
  let color = new THREE.Color(look.color);
  let accentC = new THREE.Color(look.accent);
  if (shiny) {
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl); color = new THREE.Color().setHSL((hsl.h + 0.45) % 1, Math.min(1, hsl.s + 0.2), hsl.l);
    accentC.getHSL(hsl); accentC = new THREE.Color().setHSL((hsl.h + 0.45) % 1, hsl.s, hsl.l);
  }
  const bodyM = mat('#' + color.getHexString());
  const accentM = mat('#' + accentC.getHexString(), { roughness: 0.4 });
  const glowM = look.glow ? new THREE.MeshStandardMaterial({ color: look.glow, emissive: look.glow, emissiveIntensity: 2.5 }) : accentM;
  const hornM = mat('#' + accentC.clone().multiplyScalar(0.8).getHexString(), { roughness: 0.3, sheen: 0 });

  const legs: THREE.Object3D[] = [];
  const wings: THREE.Object3D[] = [];
  let tail: THREE.Object3D | null = null;
  let head: THREE.Object3D;
  let height = 1;

  switch (look.body) {
    case 'quad': {
      const body = mesh(sphere(), bodyM, pivot, [0, 0.75, 0], [0.55, 0.45, 0.8]);
      mesh(sphere(), accentM, body, [0, -0.35, 0.1], [0.8, 0.6, 0.85]);
      head = mesh(sphere(), bodyM, pivot, [0, 1.15, 0.7], [0.45, 0.42, 0.42]);
      mesh(sphere(), accentM, head, [0, -0.25, 0.75], [0.55, 0.4, 0.45]);
      for (const s of [-1, 1]) mesh(cone(), bodyM, head, [s * 0.55, 0.6, -0.1], [0.25, 0.6, 0.18], [0, 0, s * -0.35]);
      eyes(head, 0.42, 0.72, 0.15, 0.24);
      for (const [x, z] of [[-0.3, 0.45], [0.3, 0.45], [-0.3, -0.45], [0.3, -0.45]]) {
        const hip = new THREE.Group(); hip.position.set(x, 0.55, z); pivot.add(hip);
        mesh(capsule(), bodyM, hip, [0, -0.3, 0], [0.13, 0.2, 0.13]);
        legs.push(hip);
      }
      height = 1.6;
      break;
    }
    case 'blob': {
      const body = mesh(sphere(), bodyM, pivot, [0, 0.62, 0], [0.62, 0.6, 0.6]);
      (bodyM as THREE.MeshPhysicalMaterial).clearcoat = 0.8;
      (bodyM as THREE.MeshPhysicalMaterial).clearcoatRoughness = 0.15;
      mesh(sphere(), accentM, body, [0, -0.3, 0.45], [0.6, 0.5, 0.5]);
      head = body;
      eyes(head, 0.35, 0.82, 0.2, 0.22);
      for (const s of [-1, 1]) {
        const foot = new THREE.Group(); foot.position.set(s * 0.3, 0.12, 0.1); pivot.add(foot);
        mesh(sphere(), accentM, foot, [0, 0, 0.05], [0.18, 0.1, 0.24]);
        legs.push(foot);
      }
      height = 1.3;
      break;
    }
    case 'bird': {
      const body = mesh(sphere(), bodyM, pivot, [0, 0.9, 0], [0.42, 0.5, 0.55], [0.35, 0, 0]);
      mesh(sphere(), accentM, body, [0, -0.1, 0.5], [0.7, 0.75, 0.5]);
      head = mesh(sphere(), bodyM, pivot, [0, 1.45, 0.35], [0.32, 0.32, 0.32]);
      mesh(cone(), glowM, head, [0, -0.1, 0.8], [0.22, 0.7, 0.22], [Math.PI / 2, 0, 0]);
      eyes(head, 0.5, 0.65, 0.25, 0.25, look.glow && look.size > 2 ? look.glow : undefined);
      for (const s of [-1, 1]) {
        const w = new THREE.Group(); w.position.set(s * 0.35, 1.05, -0.05); pivot.add(w);
        const wm = mesh(wingGeo(), accentM, w, [0, 0, 0], [s * 0.75, 0.75, 0.75], [0, s * 0.2, 0]);
        wm.rotation.y = 0;
        wings.push(w);
      }
      for (const s of [-1, 1]) {
        const hip = new THREE.Group(); hip.position.set(s * 0.18, 0.5, 0); pivot.add(hip);
        mesh(capsule(), hornM, hip, [0, -0.25, 0], [0.05, 0.16, 0.05]);
        legs.push(hip);
      }
      height = 1.8;
      break;
    }
    case 'serpent': {
      const segs = 6;
      let prev: THREE.Object3D = pivot;
      head = pivot;
      const chain: THREE.Object3D[] = [];
      for (let i = 0; i < segs; i++) {
        const g = new THREE.Group();
        g.position.set(0, i === 0 ? 0.4 : 0.02, i === 0 ? -0.9 : 0.36);
        prev.add(g);
        const r = 0.22 + Math.sin((i / segs) * Math.PI) * 0.18;
        mesh(sphere(), i % 2 ? accentM : bodyM, g, [0, 0.1, 0], [r, r, r * 1.2]);
        chain.push(g);
        prev = g;
      }
      head = new THREE.Group(); head.position.set(0, 0.35, 0.35); prev.add(head);
      mesh(sphere(), bodyM, head, [0, 0, 0], [0.42, 0.34, 0.5]);
      mesh(sphere(), accentM, head, [0, -0.16, 0.25], [0.3, 0.14, 0.35]);
      eyes(head, 0.24, 0.3, 0.14, 0.14, look.glow);
      if (look.wings) for (const s of [-1, 1]) {
        const w = new THREE.Group(); w.position.set(s * 0.25, 0.2, 0); chain[2].add(w);
        mesh(wingGeo(), accentM, w, [0, 0, 0], [s * 0.5, 0.5, 0.5]);
        wings.push(w);
      }
      tail = chain[0];
      (root.userData as { chain: THREE.Object3D[] }).chain = chain;
      height = 1.4;
      break;
    }
    case 'golem':
    default: {
      const body = mesh(sphere(), bodyM, pivot, [0, 1.0, 0], [0.7, 0.72, 0.6]);
      (bodyM as THREE.MeshPhysicalMaterial).flatShading = true;
      (bodyM as THREE.MeshPhysicalMaterial).sheen = 0;
      mesh(sphere(), accentM, body, [0, -0.1, 0.55], [0.6, 0.55, 0.5]);
      head = mesh(sphere(), bodyM, pivot, [0, 1.75, 0.2], [0.38, 0.34, 0.36]);
      eyes(head, 0.35, 0.8, 0.05, 0.2, look.glow);
      for (const s of [-1, 1]) {
        const arm = new THREE.Group(); arm.position.set(s * 0.72, 1.35, 0.05); pivot.add(arm);
        mesh(sphere(), bodyM, arm, [s * 0.1, -0.35, 0.05], [0.26, 0.45, 0.26]);
        mesh(sphere(), accentM, arm, [s * 0.12, -0.8, 0.1], [0.3, 0.26, 0.3]);
        legs.push(arm);
        const leg = new THREE.Group(); leg.position.set(s * 0.33, 0.45, 0); pivot.add(leg);
        mesh(capsule(), bodyM, leg, [0, -0.15, 0], [0.2, 0.18, 0.2]);
        legs.push(leg);
      }
      height = 2.1;
      break;
    }
  }

  if (look.horns) {
    const n = look.horns;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.4;
      mesh(cone(), look.glow && n >= 3 ? glowM : hornM, head, [Math.sin(a) * 0.55, 0.75, -0.1], [0.12, 0.55, 0.12], [-0.3, 0, -a * 0.6]);
    }
  }
  if (look.spikes) {
    for (let i = 0; i < 5; i++) {
      const z = 0.5 - i * 0.25;
      const y = look.body === 'golem' ? 1.55 : look.body === 'serpent' ? 1.0 : 1.12;
      mesh(cone(), glowM, pivot, [0, y - Math.abs(z) * 0.3, z - (look.body === 'golem' ? 0.35 : 0)], [0.1, 0.35, 0.1], [-0.5, 0, 0]);
    }
  }
  if (look.leaves) {
    const leafM = mat('#6fcf4a', { side: THREE.DoubleSide, sheen: 0, roughness: 0.7 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      mesh(leafGeo(), leafM, head, [Math.cos(a) * 0.15, 0.85, Math.sin(a) * 0.15], [0.5, 0.6, 0.5], [Math.sin(a) * 0.7, a, Math.cos(a) * 0.7]);
    }
  }
  if (look.tail && look.body !== 'serpent') {
    tail = new THREE.Group();
    tail.position.set(0, look.body === 'bird' ? 0.85 : 0.8, look.body === 'bird' ? -0.5 : -0.75);
    pivot.add(tail);
    mesh(cone(), look.glow ? glowM : accentM, tail, [0, 0, 0], [0.14, 0.9, 0.14], [-2.1, 0, 0]);
  }
  if (look.glow && look.body !== 'bird') {
    mesh(sphere(), glowM, pivot, [0, height * 0.52, look.body === 'golem' ? 0.55 : 0.42], [0.1, 0.1, 0.05]);
  }

  const s = look.size;
  root.scale.setScalar(s);
  height *= s;

  // ── procedural animation ──────────────────────────────
  let t = Math.random() * 10;
  let action: { name: string; time: number; dur: number } | null = null;
  const chain = (root.userData as { chain?: THREE.Object3D[] }).chain;
  const baseHeadY = head.position.y;

  return {
    root,
    height,
    play(name) {
      if (name === 'idle' || name === 'run' || name === 'walk') { if (action?.name === 'faint') action = null; return; }
      const n = name === 'victory' || name === 'interact' ? 'cast' : name;
      action = { name: n, time: 0, dur: n === 'faint' ? 0.8 : n === 'attack' ? 0.45 : n === 'cast' ? 0.6 : 0.35 };
    },
    update(dt, moving) {
      t += dt * (1 + moving * 2.5);
      const bob = Math.sin(t * 3) * 0.03 + Math.abs(Math.sin(t * 6)) * moving * 0.08;
      pivot.position.y = bob;
      pivot.scale.set(1 + Math.sin(t * 3) * 0.015, 1 - Math.sin(t * 3) * 0.015, 1);
      legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 7 + (i % 2) * Math.PI + (i > 1 ? Math.PI : 0)) * 0.6 * moving; });
      wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (Math.sin(t * (moving ? 14 : 4)) * (moving ? 0.6 : 0.2) + 0.15); });
      if (tail && !chain) tail.rotation.y = Math.sin(t * 4) * 0.4;
      if (chain) chain.forEach((c, i) => { c.rotation.y = Math.sin(t * 3 - i * 0.7) * 0.25; c.rotation.x = Math.sin(t * 2 - i * 0.5) * 0.05; });
      if (head !== pivot && !chain) head.position.y = baseHeadY + Math.sin(t * 3 + 1) * 0.02;
      pivot.rotation.set(0, 0, 0);
      if (action) {
        action.time += dt;
        const p = Math.min(1, action.time / action.dur);
        const k = Math.sin(p * Math.PI);
        if (action.name === 'attack') { pivot.position.z = k * 0.6; pivot.rotation.x = k * 0.25; pivot.scale.set(1 - k * 0.1, 1 + k * 0.1, 1 + k * 0.15); }
        if (action.name === 'cast') { pivot.position.y += k * 0.4; pivot.scale.setScalar(1 + k * 0.12); }
        if (action.name === 'hit') { pivot.position.z = -k * 0.3; pivot.rotation.x = -k * 0.3; pivot.scale.set(1 + k * 0.12, 1 - k * 0.12, 1); }
        if (action.name === 'faint') { pivot.rotation.z = p * 1.5; pivot.position.y = -p * 0.3; }
        if (p >= 1 && action.name !== 'faint') action = null;
      }
    },
  };
}

// ── Player explorer ──────────────────────────────────────
export function buildPlayer(): Rig {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const coat = mat('#2d3a5a', { sheen: 0.8 });
  const skin = mat('#f0c9a0');
  const leather = mat('#6b4428');
  const scarf = mat('#d64a3a');
  const gold = new THREE.MeshStandardMaterial({ color: '#e8b04a', metalness: 0.8, roughness: 0.3 });

  const torso = mesh(capsule(), coat, pivot, [0, 1.15, 0], [0.28, 0.28, 0.2]);
  mesh(sphere(), scarf, pivot, [0, 1.55, 0.02], [0.26, 0.1, 0.22]);
  const scarfTail = mesh(capsule(), scarf, pivot, [0.1, 1.35, -0.2], [0.06, 0.18, 0.03], [0.4, 0, 0.2]);
  const head = mesh(sphere(), skin, pivot, [0, 1.8, 0], [0.22, 0.24, 0.22]);
  eyes(head, 0.35, 0.85, 0.1, 0.13);
  const hair = mat('#3a2418');
  mesh(sphere(), hair, head, [0, 0.35, -0.15], [1.02, 0.75, 1.0]);
  // explorer hat
  mesh(new THREE.CylinderGeometry(1, 1, 0.08, 32), leather, head, [0, 0.6, 0], [1.6, 1, 1.6]);
  mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.6, 32), leather, head, [0, 0.9, 0], [1, 1, 1]);
  mesh(new THREE.CylinderGeometry(0.87, 0.87, 0.12, 32), gold, head, [0, 0.72, 0], [1, 1, 1]);
  // backpack
  const pack = mesh(new THREE.BoxGeometry(0.5, 0.55, 0.28), leather, torso, [0, 0.15, -1.2], [2.6, 2, 2.8]);
  mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 12), mat('#8a9a5a'), pack, [0, 0.33, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
  const limbs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.33, 1.45, 0); pivot.add(arm);
    mesh(capsule(), coat, arm, [0, -0.3, 0], [0.08, 0.22, 0.08]);
    mesh(sphere(), skin, arm, [0, -0.62, 0], [0.08, 0.08, 0.08]);
    limbs.push(arm);
    const leg = new THREE.Group(); leg.position.set(s * 0.13, 0.78, 0); pivot.add(leg);
    mesh(capsule(), mat('#3a3a40'), leg, [0, -0.35, 0], [0.1, 0.25, 0.1]);
    mesh(sphere(), leather, leg, [0, -0.72, 0.06], [0.11, 0.08, 0.16]);
    limbs.push(leg);
  }
  let t = 0;
  return {
    root, height: 2.1,
    play() {},
    update(dt, moving) {
      t += dt * (4 + moving * 8);
      limbs.forEach((l, i) => { l.rotation.x = Math.sin(t + (i % 2 === 0 ? 0 : Math.PI) + (i > 1 ? Math.PI : 0)) * 0.7 * moving; });
      pivot.position.y = Math.abs(Math.sin(t)) * 0.06 * moving + Math.sin(t * 0.5) * 0.01;
      pivot.rotation.x = moving * 0.12;
      scarfTail.rotation.x = 0.4 + moving * 0.6 + Math.sin(t * 1.3) * 0.15;
    },
  };
}
