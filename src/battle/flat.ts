// 2D side-view battles (Miscrits-style): a painted backdrop per land, each Mystic on its own stump
// (a stone plinth for Guardians), a fixed side camera. The sprites are only ever seen from the side, so
// the painted art reads exactly as drawn. The stage is a flat diorama built high above the island in the
// world scene, so the battle logic, sprite animations, VFX, damage numbers and the post pipeline all
// work unchanged; the island itself is hidden while it's up.
import * as THREE from 'three';
import type { Zone } from '../data/zones';

export const ARENA_Y = 1600;
/** Side-view lens and layout (metres). */
export const FLAT = { fov: 30, back: 9, stumpTop: 0.62, camH: 1.5, lookH: 1.22 };

const ART = import.meta.glob<string>('../assets/battle/*.webp', { eager: true, query: '?url', import: 'default' });
const artUrl = (k: string) => ART[`../assets/battle/${k}.webp`];
const loader = new THREE.TextureLoader();

export interface FlatFrame { pos: THREE.Vector3; look: THREE.Vector3; spread: number; dist: number; aspect: number }

/** Base framing: both stumps on screen with room for the Mystics at this aspect ratio. */
export function flatFrame(C: THREE.Vector3, aspect: number): FlatFrame {
  const tan = Math.tan(THREE.MathUtils.degToRad(FLAT.fov / 2));
  const spread = aspect >= 1.2 ? 2.55 : aspect >= 0.9 ? 2.1 : 1.6;
  const dist = Math.max(8.8, (spread + 1.6) / (tan * aspect));
  // short screens: the ability bar takes the bottom third, so aim lower and the stage rides higher
  const short = innerHeight < 560 ? 0.55 : 0;
  return {
    pos: new THREE.Vector3(C.x, C.y + FLAT.camH - short, C.z + dist),
    look: new THREE.Vector3(C.x, C.y + FLAT.lookH - short, C.z),
    spread, dist, aspect,
  };
}

/** Painted stand-in until a land has its backdrop art: sky, hazy hills, a grassy stage. */
function fallbackBackdrop(zone: Zone): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 576;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 330);
  sky.addColorStop(0, '#7fb2ec'); sky.addColorStop(1, '#d9ecf7');
  g.fillStyle = sky; g.fillRect(0, 0, 1024, 576);
  const hill = (y: number, amp: number, col: string, seed: number) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, 576);
    for (let x = 0; x <= 1024; x += 16) g.lineTo(x, y + Math.sin(x * 0.006 + seed) * amp + Math.sin(x * 0.017 + seed * 2) * amp * 0.4);
    g.lineTo(1024, 576); g.fill();
  };
  const grass = new THREE.Color(zone.grass);
  const tone = (k: number, l: number) => `#${grass.clone().offsetHSL(0, -0.08 * k, l).getHexString()}`;
  hill(270, 26, tone(2, 0.12), 1.3);
  hill(305, 20, tone(1, 0.05), 4.1);
  const ground = g.createLinearGradient(0, 330, 0, 576);
  ground.addColorStop(0, tone(0, 0.02)); ground.addColorStop(1, tone(0, -0.12));
  g.fillStyle = ground; g.fillRect(0, 335, 1024, 241);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Cover-fit a texture on a plane of the given aspect (keeps the lower, grassy part of the painting). */
function cover(t: THREE.Texture, planeAspect: number) {
  const img = t.image as { width: number; height: number } | undefined;
  if (!img?.width) return;
  const ia = img.width / img.height;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (planeAspect > ia) { t.repeat.set(1, ia / planeAspect); t.offset.set(0, (1 - t.repeat.y) * 0.3); }
  else { t.repeat.set(planeAspect / ia, 1); t.offset.set((1 - t.repeat.x) / 2, 0); }
  t.needsUpdate = true;
}

interface Glow { s: THREE.Sprite; t: number; life: number; k: number }

export class FlatStage {
  readonly radius = 6;
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private glows: Glow[] = [];
  private glowTex: THREE.CanvasTexture;

  constructor(private scene: THREE.Scene, zone: Zone, C: THREE.Vector3, frame: FlatFrame) {
    this.group.name = 'flat-stage';
    scene.add(this.group);
    // backdrop: fills the view (plus a margin for camera moves) at FLAT.back behind the stage
    const tan = Math.tan(THREE.MathUtils.degToRad(FLAT.fov / 2));
    const d = frame.dist + FLAT.back;
    const H = 2 * d * tan * 1.16, W = H * frame.aspect * 1.04;
    const url = artUrl(zone.id) ?? artUrl('vale');
    const tex = url ? loader.load(url, (t) => cover(t, W / H)) : fallbackBackdrop(zone);
    if (!url) cover(tex, W / H);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: true });
    const geo = new THREE.PlaneGeometry(W, H);
    const back = new THREE.Mesh(geo, mat);
    // centred on the camera's line of sight at that depth
    back.position.set(C.x, frame.pos.y + (frame.look.y - frame.pos.y) * (d / frame.dist), C.z - FLAT.back);
    back.renderOrder = -10;
    this.group.add(back);
    this.disposables.push(geo, mat, tex);
    // additive glow sprite for flashes
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    this.glowTex = new THREE.CanvasTexture(c);
    this.disposables.push(this.glowTex);
  }

  /** A stump (plinth for Guardians) under a Mystic standing at `feet`. */
  addPedestal(feet: THREE.Vector3, size: number, boss = false) {
    const key = boss ? 'plinth' : 'stump';
    const url = artUrl(key) ?? artUrl('stump');
    const w = (boss ? 2.6 : 1.8) * size;
    if (url) {
      const tex = loader.load(url, (t) => {
        const img = t.image as { width: number; height: number };
        const h = w * (img.height / img.width);
        mesh.scale.set(w, h, 1);
        // the painted top surface sits ~22% down the image: stand the Mystic on it
        mesh.position.set(feet.x, feet.y - h * (0.5 - 0.22), feet.z - 0.35);
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.25, fog: false, depthWrite: false });
      const geo = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.set(w, w * 0.8, 1);
      mesh.position.set(feet.x, feet.y - w * 0.8 * 0.28, feet.z - 0.35);
      mesh.renderOrder = -5;
      this.group.add(mesh);
      this.disposables.push(geo, mat, tex);
      return;
    }
    // no art yet: a simple bark stump with a pale ring top
    const hgt = FLAT.stumpTop + 0.9;
    const geo = new THREE.CylinderGeometry(w * 0.34, w * 0.4, hgt, 20);
    const mat = new THREE.MeshStandardMaterial({ color: boss ? '#9a9486' : '#7a5236', roughness: 0.9 });
    const top = new THREE.Mesh(new THREE.CircleGeometry(w * 0.34, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: boss ? '#bdb6a6' : '#c9a172', roughness: 0.9 }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(feet.x, feet.y - hgt / 2, feet.z);
    top.position.set(feet.x, feet.y + 0.005, feet.z);
    this.group.add(mesh, top);
    this.disposables.push(geo, mat, top.geometry, top.material as THREE.Material);
  }

  async reveal(_dur = 0.9) { /* the battle transition already covers the cut */ }

  flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, k = 1) {
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.renderOrder = 5;
    this.group.add(s);
    this.glows.push({ s, t: 0, life: 0.45, k });
  }

  update(dt: number, _camera: THREE.Camera) {
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const g = this.glows[i];
      g.t += dt;
      const u = g.t / g.life;
      if (u >= 1) { this.group.remove(g.s); g.s.material.dispose(); this.glows.splice(i, 1); continue; }
      const sz = (1.6 + u * 2.4) * g.k;
      g.s.scale.set(sz, sz, 1);
      g.s.material.opacity = (1 - u) * 0.9;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const g of this.glows) g.s.material.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
