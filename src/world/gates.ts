// Warden Gate barriers: a glowing rune curtain between two obelisks at every GATES position, a
// Knight warden on the near side, and colliders that block the pass until the gate opens. When a
// gate opens (its Guardian answered) the curtain plays its breaking moment the next time you're
// close, then the barrier is gone for good. A soft region lock backs up the terrain's spurs.
import * as THREE from 'three';
import { GATES, ISLAND, type GateDef } from '../data/layout';
import { ZONES, zoneAt, zoneById } from '../data/zones';
import { sfx } from '../core/audio';
import { gateOpen, gateSeen, lockHint, markGateSeen, regionUnlocked } from '../game/gates';
import { notify } from '../game/rewards';
import { save } from '../game/state';
import type { Collider } from './props';
import type { Interactable } from './towns';
import type { Overworld } from './world';
import { rigFor } from './npcs';
import type { Rig } from '../assets/placeholders';

const CURTAIN_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform float uOpen; varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  // rune columns drifting upward
  vec2 g = vec2(uv.x * 26.0, uv.y * 7.0 - uTime * 0.35);
  vec2 id = floor(g); vec2 f = fract(g);
  float h = hash(id);
  float glyph = step(0.55, h) * smoothstep(0.42, 0.0, abs(f.x - 0.5)) * smoothstep(0.46, 0.2, abs(f.y - 0.5));
  float bars = smoothstep(0.02, 0.0, abs(fract(uv.x * 26.0) - 0.5) - 0.46) * 0.35;
  float shimmer = 0.55 + 0.45 * sin(uTime * 2.3 + uv.x * 18.0 + uv.y * 6.0);
  float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x);
  float top = smoothstep(1.0, 0.55, uv.y);
  float base = 0.26 + 0.18 * smoothstep(0.35, 0.0, uv.y);
  float a = (base + glyph * 0.9 + bars) * (0.75 + 0.25 * shimmer) * edge * top;
  // opening: dissolve from the ground up with a bright rim
  float cut = uOpen * 1.25 - uv.y;
  float rim = smoothstep(0.0, 0.06, cut) * smoothstep(0.16, 0.06, cut) * step(0.001, uOpen);
  a *= 1.0 - smoothstep(0.0, 0.05, cut);
  vec3 col = uColor * (1.35 + glyph * 2.2) + vec3(1.0) * rim * 2.5;
  gl_FragColor = vec4(col, clamp(a + rim, 0.0, 1.0));
}`;

interface GateVis {
  def: GateDef;
  root: THREE.Group;
  curtain: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  runes: THREE.Mesh;
  crystals: THREE.Mesh[];
  colliders: Collider[];
  warden: Rig | null;
  wardenPos: THREE.Vector3;
  wardenYaw: number;
  sparks: THREE.Points;
  state: 'sealed' | 'opening' | 'open';
  t: number;
}

const stoneMat = new THREE.MeshStandardMaterial({ color: '#8d8698', roughness: 0.85, flatShading: true });
const capMat = new THREE.MeshStandardMaterial({ color: '#6a6478', roughness: 0.7, flatShading: true });

export class GateBarriers {
  group = new THREE.Group();
  interactables: Interactable[] = [];
  private gates: GateVis[] = [];
  private lastPos = new THREE.Vector3(NaN, 0, NaN);
  private lastOpenZone = 'vale';
  private teleportedIn = false;
  private toastAt = 0;

  constructor(private world: Overworld) {}

  build() {
    for (const g of GATES) this.gates.push(this.buildGate(g));
  }

  /** Home side: the land you usually arrive from (lower tier; the Vale for the Crown Gate). */
  private homeSide(g: GateDef) {
    const [a, b] = g.joins.map((j) => zoneById(j)!);
    return a.tier <= b.tier ? a : b;
  }

  private buildGate(g: GateDef): GateVis {
    const w = this.world;
    const [gx, gz] = g.pos;
    const [mx, mz] = ISLAND.mountain.center;
    // ring gates span the pass radially (the ring road crosses them); the Crown Gate spans east–west
    let ax = gx - mx, az = gz - mz;
    if (g.id === 'g_crown') { ax = 1; az = 0; }
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    const width = g.id === 'g_crown' ? 22 : 26;
    const home = this.homeSide(g);
    // normal pointing to the home land
    let nx = -az, nz = ax;
    if ((home.center[0] - gx) * nx + (home.center[1] - gz) * nz < 0) { nx = -nx; nz = -nz; }
    const y = w.data.heightAt(gx, gz);
    const root = new THREE.Group();
    root.position.set(gx, y, gz);
    root.rotation.y = Math.atan2(ax, az) - Math.PI / 2;
    this.group.add(root);

    const color = new THREE.Color(zoneById(g.joins[1])?.particles ?? '#bfe8ff').lerp(new THREE.Color('#9d8bff'), 0.45);
    // obelisks
    const crystals: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const px = gx + ax * side * (width / 2 + 0.8), pz = gz + az * side * (width / 2 + 0.8);
      const py = w.data.heightAt(px, pz) - y;
      const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.15, 8.5, 6), stoneMat);
      ob.position.set(side * (width / 2 + 0.8), py + 4.25, 0);
      ob.castShadow = ob.receiveShadow = true;
      root.add(ob);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.8, 0.8, 6), capMat);
      cap.position.set(side * (width / 2 + 0.8), py + 8.8, 0);
      root.add(cap);
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0).scale(0.8, 1.7, 0.8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2, roughness: 0.2 }));
      cr.position.set(side * (width / 2 + 0.8), py + 10.3, 0);
      root.add(cr);
      crystals.push(cr);
    }
    // the rune curtain
    const mat = new THREE.ShaderMaterial({
      vertexShader: CURTAIN_VERT, fragmentShader: CURTAIN_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 }, uOpen: { value: 0 } },
    });
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(width, 9, 1, 1), mat);
    curtain.position.y = 4.2;
    curtain.renderOrder = 4;
    root.add(curtain);
    // glowing rune line on the ground
    const runes = new THREE.Mesh(new THREE.PlaneGeometry(width + 2, 1.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    runes.position.y = 0.12;
    root.add(runes);
    // drifting motes
    const n = 70;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * width; pos[i * 3 + 1] = Math.random() * 8.5; pos[i * 3 + 2] = (Math.random() - 0.5) * 1.4; }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(pg, new THREE.PointsMaterial({ color, size: 0.22, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    root.add(sparks);
    // colliders across the pass
    const colliders: Collider[] = [];
    for (let s = -width / 2; s <= width / 2 + 0.01; s += 2.2) {
      const c = { x: gx + ax * s, z: gz + az * s, r: 1.5 };
      w.props.addCollider(c);
      colliders.push(c);
    }
    // the warden stands on the home side, facing the pass
    const off = g.id === 'g_crown' ? 12 : 5;
    const wx = gx + nx * off + ax * (width / 2 - 3), wz = gz + nz * off + az * (width / 2 - 3);
    const wardenPos = new THREE.Vector3(wx, w.data.heightAt(wx, wz), wz);
    const wardenYaw = Math.atan2(-nx, -nz);
    const it: Interactable = {
      pos: wardenPos.clone(), radius: 3.4, label: `Gate Warden — ${g.name}`, kind: 'npc', zone: home, id: `gate:${g.id}`, data: `gate:${g.id}`, enabled: () => true,
    };
    this.interactables.push(it);
    const vis: GateVis = { def: g, root, curtain, mat, runes, crystals, colliders, warden: null, wardenPos, wardenYaw, sparks, state: 'sealed', t: 0 };
    if (gateOpen(g.id) && gateSeen(g.id)) this.setOpen(vis);
    return vis;
  }

  private setOpen(v: GateVis) {
    v.state = 'open';
    v.curtain.visible = false;
    v.sparks.visible = false;
    (v.runes.material as THREE.MeshBasicMaterial).opacity = 0.18;
    for (const c of v.colliders) c.r = -10; // Props has no removal API: a negative radius never blocks
    for (const cr of v.crystals) (cr.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7;
  }

  private playOpening(v: GateVis) {
    v.state = 'opening';
    v.t = 0;
    sfx('evolve');
    for (const c of v.colliders) c.r = -10;
    notify(`<b>${v.def.name}</b> — the Warden seal breaks.`, 'good');
  }

  update(dt: number, t: number, player: THREE.Vector3, live: boolean) {
    for (const v of this.gates) {
      const d = Math.hypot(v.def.pos[0] - player.x, v.def.pos[1] - player.z);
      const near = d < 260;
      v.root.visible = near || v.state !== 'open';
      if (!near) continue;
      v.mat.uniforms.uTime.value = t;
      const sp = v.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < sp.count; i++) { let yy = sp.getY(i) + dt * (v.state === 'opening' ? 6 : 0.6); if (yy > 8.5) yy = 0; sp.setY(i, yy); }
      sp.needsUpdate = true;
      for (const cr of v.crystals) { cr.rotation.y = t * 0.8; }
      // the warden (streams with distance)
      if (d < 150 && !v.warden) {
        v.warden = rigFor('knight');
        if (v.warden) { v.warden.root.position.copy(v.wardenPos); v.warden.root.rotation.y = v.wardenYaw; this.group.add(v.warden.root); }
      } else if (d > 200 && v.warden) { this.group.remove(v.warden.root); v.warden = null; }
      if (v.warden) {
        const face = d < 7 ? Math.atan2(player.x - v.wardenPos.x, player.z - v.wardenPos.z) : v.wardenYaw;
        const r = v.warden.root;
        r.rotation.y += Math.atan2(Math.sin(face - r.rotation.y), Math.cos(face - r.rotation.y)) * Math.min(1, dt * 5);
        if (d < 70) v.warden.update(dt, 0);
      }
      // opening
      if (v.state === 'sealed' && live && gateOpen(v.def.id) && d < 90) {
        if (gateSeen(v.def.id)) this.setOpen(v); else this.playOpening(v);
      }
      if (v.state === 'opening') {
        v.t += dt;
        v.mat.uniforms.uOpen.value = Math.min(1, v.t / 2.6);
        for (const cr of v.crystals) (cr.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.2 + Math.sin(v.t * 12) * 1.5 + v.t;
        if (v.t > 2.8) { this.setOpen(v); markGateSeen(v.def.id); save(); }
      }
    }
    if (live) this.regionLock(player);
    else this.lastPos.set(NaN, 0, NaN);
  }

  /**
   * Backstop for the terrain's spurs: walking (not teleporting) more than ~10 m into a land whose
   * gate is still sealed turns you back with the hint for opening it.
   */
  private regionLock(p: THREE.Vector3) {
    const here = zoneAt(p.x, p.z);
    const prev = this.lastPos;
    if (regionUnlocked(here.id)) { this.lastOpenZone = here.id; this.teleportedIn = false; prev.copy(p); return; }
    const walked = Number.isFinite(prev.x) && Math.hypot(p.x - prev.x, p.z - prev.z) < 15;
    // Teleported into a sealed land (debug `pos=`, respawn, fast travel)? Roam freely until you leave.
    if (!walked) this.teleportedIn = true;
    if (this.teleportedIn) { prev.copy(p); return; }
    const from = ZONES.find((z) => z.id === this.lastOpenZone);
    if (from && regionUnlocked(from.id)) {
      const depth = (Math.hypot(p.x - from.center[0], p.z - from.center[1]) - Math.hypot(p.x - here.center[0], p.z - here.center[1])) / 2;
      if (depth > 10) {
        p.set(prev.x, this.world.data.heightAt(prev.x, prev.z), prev.z);
        if (performance.now() - this.toastAt > 4500) {
          this.toastAt = performance.now();
          notify(`A Warden seal turns you back. ${lockHint(here.id) ?? ''}`, 'info');
        }
        return;
      }
    }
    prev.copy(p);
  }
}
