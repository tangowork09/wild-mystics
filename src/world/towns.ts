import * as THREE from 'three';
import { ZONES, type Zone } from '../data/zones';
import { envModel, makeNpcRig } from '../assets/manifest';
import { buildPlayer, type Rig } from '../assets/placeholders';
import { PATHS, type TerrainData } from './terrain';
import type { Props } from './props';

export type Service = 'healer' | 'shop' | 'hatchery' | 'shrine' | 'tutor' | 'storage' | 'summon' | 'quests';

export const SERVICES: Record<Service, { name: string; icon: string; roof: string; desc: string }> = {
  healer: { name: 'Healer', icon: '✚', roof: '#d0506a', desc: 'Restore your whole team' },
  shop: { name: 'Outfitter', icon: '◈', roof: '#3a6ac0', desc: 'Capture orbs & tonics' },
  hatchery: { name: 'Hatchery', icon: '◉', roof: '#e0a830', desc: 'Breed creatures, hatch eggs' },
  shrine: { name: 'Elementum Shrine', icon: '✦', roof: '#8a4ad0', desc: 'Infuse elemental power' },
  tutor: { name: 'Move Master', icon: '⚔', roof: '#c03a2a', desc: 'Enhance skills' },
  storage: { name: 'Keeper', icon: '▣', roof: '#6a5a3a', desc: 'Swap team & storage' },
  summon: { name: 'Wishing Spire', icon: '✧', roof: '#5a4ad0', desc: 'Summon Mystics & relics with Aether' },
  quests: { name: 'Quest Board', icon: '❖', roof: '#a0702a', desc: 'Requests from the townsfolk' },
};

/** Safe arrival point per town: on a road gap facing the fountain, camera behind along the road. */
export const TOWN_SPAWN: Record<string, { x: number; z: number; yaw: number }> = {};

export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  label: string;
  kind: 'service' | 'camp' | 'boss' | 'search' | 'waystone' | 'gather' | 'tamer' | 'homestead' | 'npc';
  service?: Service;
  zone: Zone;
  id: string;
  enabled: () => boolean;
  /** Extra payload for the handler (e.g. tamer id, node type). */
  data?: string;
}

const M = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
const plaster = M('#e2d6bc');
const timber = M('#4a3222');
const stone = M('#9a9088', { flatShading: true });
const glowWarm = new THREE.MeshStandardMaterial({ color: '#ffd58a', emissive: '#ffb04a', emissiveIntensity: 2.2 });

function signTexture(icon: string, text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a1e16'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#d8b46a'; g.lineWidth = 8; g.strokeRect(8, 8, 496, 144);
  g.fillStyle = color; g.beginPath(); g.arc(80, 80, 50, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 64px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(icon, 80, 84);
  g.fillStyle = '#f4e4c0'; g.font = '600 46px Cinzel, Georgia, serif'; g.textAlign = 'left'; g.fillText(text, 150, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function box(w: number, h: number, d: number, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

function roofPrism(w: number, d: number, h: number, mat: THREE.Material) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 - 0.5, 0); s.lineTo(0, h); s.lineTo(w / 2 + 0.5, 0); s.lineTo(-w / 2 - 0.5, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: d + 0.8, bevelEnabled: false });
  g.translate(0, 0, -(d + 0.8) / 2);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function house(roofColor: string, w: number, d: number, h: number, withChimney = true): THREE.Group {
  const g = new THREE.Group();
  box(w + 0.5, 0.5, d + 0.5, stone, g, 0, 0.25, 0);
  box(w, h, d, plaster, g, 0, 0.5 + h / 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.25, h, 0.25, timber, g, (sx * w) / 2, 0.5 + h / 2, (sz * d) / 2);
  box(w + 0.1, 0.22, d + 0.1, timber, g, 0, 0.5 + h * 0.55, 0);
  const roof = roofPrism(w, d, h * 0.75, M(roofColor, { roughness: 0.7, flatShading: true }));
  roof.position.y = 0.5 + h;
  roof.rotation.y = Math.PI / 2;
  g.add(roof);
  // door + windows face +Z
  box(1.3, 2.1, 0.2, timber, g, 0, 0.5 + 1.05, d / 2 + 0.05);
  box(0.3, 0.3, 0.3, glowWarm, g, 0, 0.5 + 2.45, d / 2 + 0.25);
  for (const sx of [-1, 1]) box(0.9, 0.9, 0.12, glowWarm, g, sx * w * 0.3, 0.5 + h * 0.55 + (h > 3.5 ? 0.8 : 0), d / 2 + 0.03);
  if (withChimney) box(0.7, 2.2, 0.7, stone, g, w * 0.28, 0.5 + h + 0.8, -d * 0.2);
  return g;
}

function serviceBuilding(svc: Service): THREE.Group {
  const info = SERVICES[svc];
  const custom = envModel('buildings', svc);
  let g: THREE.Group;
  if (custom) { g = new THREE.Group(); g.add(custom); }
  else if (svc === 'shrine') {
    g = new THREE.Group();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 0.8, 24), stone);
    cyl.position.y = 0.4; cyl.castShadow = cyl.receiveShadow = true; g.add(cyl);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 4.2, 10), plaster);
      col.position.set(Math.cos(a) * 3.3, 2.9, Math.sin(a) * 3.3);
      col.castShadow = true; g.add(col);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M(info.roof, { roughness: 0.4, metalness: 0.3 }));
    dome.position.y = 5; dome.castShadow = true; g.add(dome);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0).scale(1, 1.8, 1), new THREE.MeshPhysicalMaterial({ color: '#c68bff', emissive: '#9a4aff', emissiveIntensity: 1.3, roughness: 0.1, clearcoat: 1 }));
    crystal.position.y = 2.6;
    crystal.name = 'spin';
    g.add(crystal);
  } else if (svc === 'tutor') {
    g = house(info.roof, 7, 6, 3.2, false);
    const roof2 = roofPrism(4.5, 4, 2, M(info.roof, { flatShading: true }));
    roof2.position.y = 6.3; roof2.rotation.y = Math.PI / 2; g.add(roof2);
    box(3.6, 1.6, 3.2, plaster, g, 0, 5.5, 0);
  } else if (svc === 'hatchery') {
    g = house(info.roof, 8, 6.5, 3.4, false);
    const egg = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), new THREE.MeshPhysicalMaterial({ color: '#fff4dc', roughness: 0.3, clearcoat: 0.8, sheen: 1, sheenColor: new THREE.Color('#ffd58a') }));
    egg.scale.set(0.9, 1.2, 0.9);
    egg.position.set(0, 7.3, 0); egg.castShadow = true; egg.name = 'bob'; g.add(egg);
  } else if (svc === 'shop') {
    g = house(info.roof, 7, 6, 3.4);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.12, 2), M('#f0f0f0'));
    awning.position.set(0, 3.1, 3.8); awning.rotation.x = 0.3; awning.castShadow = true; g.add(awning);
    for (let i = 0; i < 4; i++) box(1.5, 0.13, 2.02, M(info.roof), g, -2.25 + i * 1.5, 3.12, 3.8).rotation.x = 0.3;
    box(4, 1, 1, timber, g, 0, 1, 4.2);
  } else if (svc === 'storage') {
    g = house(info.roof, 8, 6, 3.6, false);
    for (let i = 0; i < 4; i++) box(0.9, 0.9, 0.9, M('#a07a4a'), g, 4.6 + (i % 2) * 0.2, 0.45 + Math.floor(i / 2) * 0.9, -1 + (i % 2) * 1.1);
  } else {
    g = house(info.roof, 7, 6, 3.4);
  }
  return g;
}

function signpost(svc: Service): THREE.Group {
  const info = SERVICES[svc];
  const g = new THREE.Group();
  for (const sx of [-1.35, 1.35]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.1, 8), timber);
    post.position.set(sx, 1.55, 0); post.castShadow = true; g.add(post);
  }
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 0.1), timber);
  board.position.y = 2.55; board.castShadow = true; g.add(board);
  const tex = signTexture(info.icon, info.name, info.roof);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.95), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.8 }));
  face.position.set(0, 2.55, 0.06); g.add(face);
  const back = face.clone(); back.rotation.y = Math.PI; back.position.z = -0.06; g.add(back);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), new THREE.MeshStandardMaterial({ color: info.roof, emissive: info.roof, emissiveIntensity: 2.2 }));
  gem.position.y = 3.3; gem.name = 'spin2'; g.add(gem);
  return g;
}

function wishingSpire(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 0.6, 8), stone);
  base.position.y = 0.3; base.castShadow = base.receiveShadow = true; g.add(base);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 5.5, 8), M('#e8e0f4', { roughness: 0.4, metalness: 0.3 }));
  col.position.y = 3.2; col.castShadow = true; g.add(col);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0).scale(0.8, 1.9, 0.8), new THREE.MeshPhysicalMaterial({ color: '#8a7aff', emissive: '#6a4aff', emissiveIntensity: 1.6, roughness: 0.08, clearcoat: 1, transmission: 0 }));
  crystal.position.y = 7.2; crystal.name = 'spin3'; g.add(crystal);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3 + i * 0.35, 0.04, 6, 48), new THREE.MeshStandardMaterial({ color: '#ffe8a8', emissive: '#ffd76a', emissiveIntensity: 1.4 }));
    ring.position.y = 7.2; ring.rotation.x = Math.PI / 2 + i * 0.6; ring.name = 'orbit'; g.add(ring);
  }
  return g;
}

function questBoard(): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.6, 8), timber);
    post.position.set(sx * 1.05, 1.3, 0); post.castShadow = true; g.add(post);
  }
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.12), M('#8a6a44'));
  board.position.y = 1.85; board.castShadow = true; g.add(board);
  const roof = roofPrism(2.2, 0.5, 0.45, M('#a0702a', { flatShading: true }));
  roof.position.y = 2.6; roof.rotation.y = Math.PI / 2; g.add(roof);
  const papers = ['#f4ead2', '#efe0c0', '#f8f0dc', '#e8d8b8'];
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.52), M(papers[i % 4], { side: THREE.DoubleSide }));
    p.position.set(-0.8 + i * 0.4, 1.8 + (i % 2) * 0.18, 0.07); p.rotation.z = (i - 2) * 0.06; g.add(p);
  }
  const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color: '#ffd76a', emissive: '#ffb03a', emissiveIntensity: 2 }));
  mark.position.y = 3.25; mark.name = 'spin2'; g.add(mark);
  return g;
}

function lamp(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.4, 8), timber);
  post.position.y = 1.7; post.castShadow = true; g.add(post);
  const l = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glowWarm);
  l.position.y = 3.5; g.add(l);
  return g;
}

function fountain(zone: Zone): THREE.Group {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.4, 10, 40), stone);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.5; rim.castShadow = rim.receiveShadow = true; g.add(rim);
  const water = new THREE.Mesh(new THREE.CircleGeometry(3.1, 40), new THREE.MeshStandardMaterial({ color: zone.water.lava ? '#ff6a1a' : '#4ac8e0', emissive: zone.water.lava ? '#ff4a0a' : '#1a6a8a', emissiveIntensity: zone.water.lava ? 1.8 : 0.4, roughness: 0.05 }));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.55; g.add(water);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 2.6, 12), stone);
  pillar.position.y = 1.3; pillar.castShadow = true; g.add(pillar);
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 2), new THREE.MeshStandardMaterial({ color: new THREE.Color(zone.particles), emissive: new THREE.Color(zone.particles), emissiveIntensity: 0.45, roughness: 0.2 }));
  orb.position.y = 3.2; orb.name = 'bob'; g.add(orb);
  return g;
}

function tent(color: string): THREE.Group {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.6, 4, 1, true), M(color, { side: THREE.DoubleSide, flatShading: true }));
  t.position.y = 1.3; t.rotation.y = Math.PI / 4; t.castShadow = true; g.add(t);
  return g;
}

function campfire(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.2, 6), timber);
    log.rotation.set(Math.PI / 2 - 0.4, (i / 5) * Math.PI * 2, 0);
    log.position.y = 0.25; g.add(log);
  }
  const flameM = new THREE.MeshStandardMaterial({ color: '#ffb03a', emissive: '#ff7a1a', emissiveIntensity: 4, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.3 - i * 0.07, 1 - i * 0.2, 7), flameM);
    f.position.set(Math.cos(i * 2) * 0.12, 0.6, Math.sin(i * 2) * 0.12);
    f.name = 'flicker';
    g.add(f);
  }
  return g;
}

function flag(color: string): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 8), M('#d8c8a0', { metalness: 0.6, roughness: 0.3 }));
  pole.position.y = 2.5; pole.castShadow = true; g.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1, 8, 4).translate(0.9, 0, 0), M(color, { side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.25 }));
  cloth.position.y = 4.3; cloth.name = 'cloth'; cloth.castShadow = true; g.add(cloth);
  return g;
}

function beam(color: string): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(2.2, 3.2, 160, 24, 1, true).translate(0, 80, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uFade: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uFade; varying vec2 vUv;
      void main(){ float edge = pow(sin(vUv.x * 3.14159), 2.0); float a = (1.0 - vUv.y) * 0.55 * (0.7 + 0.3 * sin(uTime * 2.0 + vUv.y * 20.0));
      gl_FragColor = vec4(uColor * 1.6, a * (0.35 + edge * 0.4) * uFade); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

function runeRing(color: string): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
      float ring = smoothstep(0.012, 0.0, abs(r - 0.93)) + smoothstep(0.008, 0.0, abs(r - 0.8)) * 0.7;
      float seg = step(0.55, fract(a * 12.0 / 3.14159 + uTime * 0.04));
      float runes = seg * smoothstep(0.03, 0.0, abs(r - 0.865)) * 0.55;
      float glow = smoothstep(1.0, 0.0, r) * 0.05;
      gl_FragColor = vec4(uColor * 1.4, (ring + runes + glow) * step(r, 1.0) * 0.75); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(36, 36).rotateX(-Math.PI / 2), mat);
  m.renderOrder = 3;
  return m;
}

export interface Villager { rig: Rig; home: THREE.Vector3; target: THREE.Vector3; wait: number }

export class Structures {
  group = new THREE.Group();
  interactables: Interactable[] = [];
  animated: THREE.Object3D[] = [];
  beams = new Map<string, THREE.Mesh>();
  rings: THREE.Mesh[] = [];
  villagers: Villager[] = [];

  constructor(private data: TerrainData, private props: Props) {}

  build() {
    for (const zone of ZONES) {
      this.buildTown(zone);
      this.buildCamp(zone);
      this.buildArena(zone);
    }
    this.group.traverse((o) => { if (['spin', 'spin2', 'spin3', 'orbit', 'bob', 'flicker', 'cloth'].includes(o.name)) this.animated.push(o); });
  }

  private place(obj: THREE.Object3D, x: number, z: number, faceX: number, faceZ: number) {
    obj.position.set(x, this.data.heightAt(x, z), z);
    obj.rotation.y = Math.atan2(faceX - x, faceZ - z);
    this.group.add(obj);
  }

  private buildTown(zone: Zone) {
    const [cx, cz] = zone.town.pos;
    const f = fountain(zone);
    this.place(f, cx, cz, cx, cz + 1);
    this.props.addCollider({ x: cx, z: cz, r: 3.6 });
    const services: Service[] = zone.town.kind === 'town' ? ['healer', 'shop', 'hatchery', 'shrine', 'tutor', 'storage'] : ['healer', 'shop', 'storage'];
    const isHub = zone.id === 'vale';
    // leave gaps where roads enter the plaza
    const roadAngles = this.roadAnglesAt(cx, cz);
    const slots: number[] = [];
    const R0 = zone.town.kind === 'town' ? 19 : 14;
    for (let i = 0; i < 16 && slots.length < services.length; i++) {
      const a = (i / 16) * Math.PI * 2;
      if (roadAngles.some((ra) => Math.abs(Math.atan2(Math.sin(a - ra), Math.cos(a - ra))) < 0.42)) continue;
      if (slots.some((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s))) < (services.length > 3 ? 0.8 : 1.4))) continue;
      slots.push(a);
    }
    {
      // arrival point: middle of the widest gap between plaza buildings/landmarks, facing the fountain
      const used = services.map((_, i) => slots[i % slots.length] + (i >= slots.length ? 0.4 : 0));
      if (isHub) used.push(-Math.PI / 4, -2.3); else used.push(2.4);
      const angs = used.map((a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((p, q) => p - q);
      let best = -Math.PI / 2, gap = 0;
      angs.forEach((a, i) => {
        const next = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
        if (next - a > gap) { gap = next - a; best = a + (next - a) / 2; }
      });
      const R = zone.town.kind === 'town' ? 6.5 : 5;
      TOWN_SPAWN[zone.id] = { x: cx + Math.cos(best) * R, z: cz + Math.sin(best) * R, yaw: Math.atan2(Math.cos(best), Math.sin(best)) };
    }
    services.forEach((svc, i) => {
      const a = slots[i % slots.length] + (i >= slots.length ? 0.4 : 0);
      const R = R0;
      const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
      const b = serviceBuilding(svc);
      this.place(b, x, z, cx, cz);
      this.props.addCollider({ x, z, r: 4.3 });
      const door = new THREE.Vector3(cx + Math.cos(a) * (R - 5.6), 0, cz + Math.sin(a) * (R - 5.6));
      door.y = this.data.heightAt(door.x, door.z);
      this.interactables.push({ pos: door, radius: 3.2, label: `${SERVICES[svc].name}`, kind: 'service', service: svc, zone, id: `${zone.id}-${svc}`, enabled: () => true });
      // signpost beside the door, facing the plaza
      const side = a + 0.19;
      const sp = signpost(svc);
      this.place(sp, cx + Math.cos(side) * (R - 5.2), cz + Math.sin(side) * (R - 5.2), cx, cz);
      // keeper stands on the other side of the door
      const npc = makeNpcRig(i) ?? buildPlayer();
      const npcPos = new THREE.Vector3(cx + Math.cos(a - 0.17) * (R - 5.4), 0, cz + Math.sin(a - 0.17) * (R - 5.4));
      npcPos.y = this.data.heightAt(npcPos.x, npcPos.z);
      npc.root.position.copy(npcPos);
      npc.root.rotation.y = Math.atan2(cx - npcPos.x, cz - npcPos.z);
      this.recolor(npc.root, i);
      this.group.add(npc.root);
      this.villagers.push({ rig: npc, home: npcPos.clone(), target: npcPos.clone(), wait: 1e9 });
      // crates & barrels against the building flank
      const decoKeys = ['barrel', 'crate', 'sack', 'barrel'];
      for (let k = 0; k < 3; k++) {
        const d = envModel('decor', decoKeys[(i + k) % 4]);
        if (!d) break;
        const da = a + (k % 2 ? 0.3 : -0.3) + (k - 1) * 0.04;
        const dr = R - 3.8 + k * 0.6;
        this.place(d, cx + Math.cos(da) * dr, cz + Math.sin(da) * dr, cx, cz);
        d.rotation.y += k * 1.3;
      }
    });
    // hub landmarks: Wishing Spire (gacha) and the quest board sit on the plaza
    if (isHub) {
      const spire = wishingSpire();
      const sx = cx + 7.5, sz = cz - 7.5;
      this.place(spire, sx, sz, cx, cz);
      this.props.addCollider({ x: sx, z: sz, r: 1.8 });
      this.interactables.push({ pos: new THREE.Vector3(sx, this.data.heightAt(sx, sz), sz), radius: 4, label: 'Wishing Spire — Summon', kind: 'service', service: 'summon', zone, id: `${zone.id}-summon`, enabled: () => true });
    }
    {
      const qa = isHub ? -2.3 : 2.4;
      const qx = cx + Math.cos(qa) * 8.5, qz = cz + Math.sin(qa) * 8.5;
      const board = questBoard();
      this.place(board, qx, qz, cx, cz);
      this.interactables.push({ pos: new THREE.Vector3(qx, this.data.heightAt(qx, qz), qz), radius: 3, label: 'Quest Board', kind: 'service', service: 'quests', zone, id: `${zone.id}-quests`, enabled: () => true });
    }
    // decorative houses on the outer ring
    const houses = zone.town.kind === 'town' ? 7 : 4;
    for (let i = 0; i < houses; i++) {
      const a = (i / houses) * Math.PI * 2 + 0.25;
      if (roadAngles.some((ra) => Math.abs(Math.atan2(Math.sin(a - ra), Math.cos(a - ra))) < 0.35)) continue;
      const R = (zone.town.kind === 'town' ? 31 : 21) + (i % 2) * 3;
      const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
      const custom = envModel('buildings', 'house', i);
      const h = custom ?? house(['#8a3a2a', '#3a5a8a', '#5a7a3a', '#7a5a8a'][i % 4], 5 + (i % 3), 4.5, 2.8 + (i % 2));
      this.place(h, x, z, cx, cz);
      this.props.addCollider({ x, z, r: 3.6 });
    }
    // lamps around plaza
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const x = cx + Math.cos(a) * 9, z = cz + Math.sin(a) * 9;
      this.place(lamp(), x, z, cx, cz);
    }
    // wandering villagers
    for (let i = 0; i < (zone.town.kind === 'town' ? 5 : 2); i++) {
      const v = makeNpcRig(i + 2) ?? buildPlayer();
      const p = new THREE.Vector3(cx + (Math.random() - 0.5) * 16, 0, cz + (Math.random() - 0.5) * 16);
      p.y = this.data.heightAt(p.x, p.z);
      v.root.position.copy(p);
      v.root.scale.setScalar(0.85 + Math.random() * 0.1);
      this.recolor(v.root, i + 3);
      this.group.add(v.root);
      this.villagers.push({ rig: v, home: new THREE.Vector3(cx, p.y, cz), target: p.clone(), wait: Math.random() * 3 });
    }
  }

  private recolor(root: THREE.Object3D, seed: number) {
    const coats = ['#7a3a5a', '#3a6a5a', '#8a6a2a', '#4a4a7a', '#6a2a2a', '#2a5a7a', '#5a6a3a', '#7a4a8a'];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshPhysicalMaterial;
      if (mat.color && mat.color.getHexString() === '2d3a5a') { m.material = mat.clone(); (m.material as THREE.MeshPhysicalMaterial).color.set(coats[seed % coats.length]); }
    });
  }

  /** Angles (from plaza centre) where roads cross the building ring, measured on the real curved paths. */
  private roadAnglesAt(cx: number, cz: number): number[] {
    const out: number[] = [];
    for (const path of PATHS) {
      for (const pts of [path, [...path].reverse()]) {
        if (Math.hypot(pts[0][0] - cx, pts[0][1] - cz) > 1) continue;
        const hit = pts.find(([x, z]) => Math.hypot(x - cx, z - cz) >= 19) ?? pts[pts.length - 1];
        out.push(Math.atan2(hit[1] - cz, hit[0] - cx));
      }
    }
    return out;
  }

  private buildCamp(zone: Zone) {
    const [x, z] = zone.camp;
    const col = zone.particles;
    this.place(envModel('decor', 'camp') ?? tent(zone.ground[2]), x - 3, z - 2, x, z);
    const fire = campfire();
    this.place(fire, x, z, x, z + 1);
    const fl = flag(col === '#fff3b0' ? '#d64a3a' : col);
    this.place(fl, x + 2.5, z + 1.5, x, z);
    this.props.addCollider({ x: x - 3, z: z - 2, r: 1.8 });
    const p = new THREE.Vector3(x, this.data.heightAt(x, z), z);
    this.interactables.push({ pos: p, radius: 4, label: 'Rest at Expedition Flag', kind: 'camp', zone, id: `${zone.id}-camp`, enabled: () => true });
  }

  private buildArena(zone: Zone) {
    const [x, z] = zone.boss.pos;
    const y = this.data.heightAt(x, z);
    const color = new THREE.Color(zone.particles).lerp(new THREE.Color('#b36bff'), 0.4).getStyle();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const sx = x + Math.cos(a) * 18, sz = z + Math.sin(a) * 18;
      const h = 4 + (i % 3) * 1.2;
      const custom = envModel('decor', 'standing_stone', i);
      if (custom) {
        custom.position.set(sx, this.data.heightAt(sx, sz) - 0.2, sz);
        custom.rotation.y = a + Math.PI / 2;
        this.group.add(custom);
      } else {
        const st = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1), stone);
        st.position.set(sx, this.data.heightAt(sx, sz) + h / 2 - 0.3, sz);
        st.rotation.set((Math.random() - 0.5) * 0.12, a, (Math.random() - 0.5) * 0.12);
        st.castShadow = st.receiveShadow = true;
        this.group.add(st);
      }
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      rune.position.set(sx - Math.cos(a) * 0.52, this.data.heightAt(sx, sz) + h * 0.55, sz - Math.sin(a) * 0.52);
      rune.lookAt(x, rune.position.y, z);
      this.group.add(rune);
      this.props.addCollider({ x: sx, z: sz, r: 0.9 });
    }
    const ring = runeRing(color);
    ring.position.set(x, y + 0.08, z);
    this.group.add(ring);
    this.rings.push(ring);
    const b = beam(color);
    b.position.set(x, y, z);
    this.group.add(b);
    this.beams.set(zone.id, b);
  }

  /** Windows and lamps brighten at night. */
  setNight(n: number) { glowWarm.emissiveIntensity = 1.0 + n * 3.2; }

  update(dt: number, t: number) {
    for (const o of this.animated) {
      if (o.name === 'spin') { o.rotation.y = t * 0.8; o.position.y = 2.6 + Math.sin(t * 1.5) * 0.25; }
      if (o.name === 'bob') o.position.y += Math.sin(t * 2) * 0.004;
      if (o.name === 'spin2') o.rotation.y = t * 1.5;
      if (o.name === 'spin3') { o.rotation.y = t * 0.6; o.position.y = 7.2 + Math.sin(t * 1.2) * 0.25; }
      if (o.name === 'orbit') { o.rotation.z = t * (0.4 + (o.id % 3) * 0.2); }
      if (o.name === 'flicker') { o.scale.set(1 + Math.sin(t * 17 + o.id) * 0.12, 1 + Math.sin(t * 13 + o.id) * 0.25, 1 + Math.sin(t * 11 + o.id) * 0.12); }
      if (o.name === 'cloth') o.rotation.y = Math.sin(t * 1.7) * 0.3;
    }
    for (const r of this.rings) (r.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    for (const b of this.beams.values()) (b.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    for (const v of this.villagers) {
      let moving = 0;
      if (v.wait < 1e8) {
        v.wait -= dt;
        if (v.wait <= 0) {
          const dx = v.target.x - v.rig.root.position.x, dz = v.target.z - v.rig.root.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.3) {
            v.wait = 2 + Math.random() * 4;
            const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 7;
            v.target.set(v.home.x + Math.cos(a) * r, 0, v.home.z + Math.sin(a) * r);
          } else {
            const sp = 1.6 * dt;
            v.rig.root.position.x += (dx / d) * sp;
            v.rig.root.position.z += (dz / d) * sp;
            v.rig.root.position.y = this.data.heightAt(v.rig.root.position.x, v.rig.root.position.z);
            v.rig.root.rotation.y = Math.atan2(dx, dz);
            moving = 0.5;
          }
        }
      }
      v.rig.update(dt, moving);
    }
  }

  setBossDefeated(zoneId: string, defeated: boolean) {
    const b = this.beams.get(zoneId);
    if (b) (b.material as THREE.ShaderMaterial).uniforms.uFade.value = defeated ? 0.12 : 1;
  }

  /** Hide the guardian beacon while fighting inside its arena. */
  setBeamVisible(zoneId: string, on: boolean) {
    const b = this.beams.get(zoneId);
    if (b) b.visible = on;
  }
}
