// 2.5D Mystics: painted creature art drawn as camera-facing sprites in the 3D world
// (think Cassette Beasts / Octopath). A sprite rig honours the same Rig contract as a 3D model,
// so the overworld, battles and mounts use it unchanged. Art comes from tools/add-sprite.py.
//
// The billboard is built in the vertex shader (cylindrical: always upright, turns to face the
// camera), so it works for the overworld and battle cameras alike. Motion is procedural:
// breathing, hop-walks, lunges, knockback, a paper-flip when the Mystic turns around.
import * as THREE from 'three';
import type { Species } from '../data/species';
import type { AnimName, Rig } from './placeholders';
import { LOOK, type Look } from './stylize';

export interface SpriteEntry {
  src: string;
  portrait?: string;
  w: number;
  h: number;
  /** Transparent padding around the art (pixels). */
  pad: number;
  /** Which way the painted Mystic looks. */
  facing: 'left' | 'right';
}

const textures = new Map<string, THREE.Texture>();
const pending = new Map<string, Promise<THREE.Texture | null>>();
const loader = new THREE.TextureLoader();

export function loadSprite(src: string): Promise<THREE.Texture | null> {
  const hit = textures.get(src);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(src);
  if (!p) {
    p = loader.loadAsync(`assets/${src}`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      textures.set(src, t);
      return t;
    }).catch((e) => { console.warn(`[sprites] ${src} failed`, e); return null; });
    pending.set(src, p);
  }
  return p;
}
export const spriteReady = (src: string) => textures.has(src);

// ── blob shadow (one shared texture) ──────────────────────────────────────
let blobTex: THREE.Texture | null = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(10,6,20,0.55)');
  grd.addColorStop(0.55, 'rgba(10,6,20,0.3)');
  grd.addColorStop(1, 'rgba(10,6,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

// ── scene light probe: tint unlit sprites like the world around them ──────
const _c = new THREE.Color();
const lightCache = new WeakMap<THREE.Object3D, { sun: THREE.DirectionalLight | null; hemi: THREE.HemisphereLight | null }>();
/** v3: painted 2D battles light sprites flat (their painted shading is the lighting). */
export const SPRITE_FLAT = { on: false };

function sceneLight(scene: THREE.Scene, out: THREE.Color, rimOut: THREE.Color): number {
  if (SPRITE_FLAT.on) { out.setRGB(1, 1, 1); rimOut.setRGB(0.4, 0.38, 0.34); return 1; }
  let l = lightCache.get(scene);
  if (!l || (l.sun && !l.sun.parent) || (l.hemi && !l.hemi.parent)) {
    let sun: THREE.DirectionalLight | null = null, hemi: THREE.HemisphereLight | null = null;
    scene.traverse((o) => {
      const d = o as THREE.DirectionalLight;
      if (d.isDirectionalLight && !d.userData.wmStage && (!sun || d.intensity > sun.intensity)) sun = d;
      const h = o as THREE.HemisphereLight;
      if (h.isHemisphereLight && !hemi) hemi = h;
    });
    l = { sun, hemi };
    lightCache.set(scene, l);
  }
  out.setRGB(0, 0, 0);
  let sunDir = 0;
  if (l.hemi) out.add(_c.copy(l.hemi.color).multiplyScalar(l.hemi.intensity * 0.42));
  if (l.sun) {
    out.add(_c.copy(l.sun.color).multiplyScalar(Math.min(4, l.sun.intensity) * 0.2));
    rimOut.copy(l.sun.color).multiplyScalar(0.35 + Math.min(1.2, l.sun.intensity * 0.3));
    sunDir = l.sun.position.x - l.sun.target.position.x;
  } else rimOut.setRGB(0.6, 0.6, 0.7);
  // keep the painted colours near their authored value by day, readable at night
  const lum = out.r * 0.3 + out.g * 0.59 + out.b * 0.11;
  const target = THREE.MathUtils.clamp(lum, 0.34, 1.08);
  if (lum > 0.001) out.multiplyScalar(target / lum); else out.setRGB(0.34, 0.36, 0.5);
  return sunDir;
}

// ── material ──────────────────────────────────────────────────────────────
function spriteMaterial(tex: THREE.Texture, U: Look['U'], S: Record<string, THREE.IUniform>) {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.2, depthWrite: true, side: THREE.DoubleSide, fog: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, S, { uFlash: U.uFlash, uFlashColor: U.uFlashColor, uDissolve: U.uDissolve, uDissolveColor: U.uDissolveColor, uFade: U.uFade, uHueShift: U.uHueShift, uShiny: U.uShiny, uTime: LOOK.uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uH, uSwayAmp, uTilt, uFlip, uLift;
        uniform vec2 uScale, uOffset;`)
      .replace('#include <project_vertex>', `
        vec3 anchor = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float sx = length(modelMatrix[0].xyz);
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 right = normalize(vec3(camRight.x, 0.0, camRight.z) + vec3(1e-5, 0.0, 0.0));
        vec2 p = position.xy;
        float k = clamp(p.y / uH, 0.0, 1.0);
        p.x += sin(uTime * 1.7 + p.y * 2.3) * uSwayAmp * k * k * uH;
        p *= uScale;
        float c = cos(uTilt), s = sin(uTilt);
        p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
        p += uOffset;
        p.x *= uFlip;
        vec3 world = anchor + (right * p.x + vec3(0.0, p.y + uLift, 0.0)) * sx;
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        mvPosition.z += 0.04 * sx;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uLight, uRim, uInk, uFlashColor, uDissolveColor;
        uniform vec2 uTexel;
        uniform float uRimSide, uOutline, uFlash, uDissolve, uFade, uHueShift, uShiny, uSat, uTime, uFlip;
        vec3 hueRot(vec3 c, float a) {
          const vec3 k = vec3(0.57735);
          float ca = cos(a);
          return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
        }
        float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
      .replace('#include <map_fragment>', `
        vec4 texel = texture2D(map, vMapUv);
        float a0 = texel.a;
        vec2 px = uTexel * uOutline;
        float ring = 0.0;
        ring = max(ring, texture2D(map, vMapUv + vec2(px.x, 0.0)).a);
        ring = max(ring, texture2D(map, vMapUv - vec2(px.x, 0.0)).a);
        ring = max(ring, texture2D(map, vMapUv + vec2(0.0, px.y)).a);
        ring = max(ring, texture2D(map, vMapUv - vec2(0.0, px.y)).a);
        ring = max(ring, texture2D(map, vMapUv + px * 0.7).a);
        ring = max(ring, texture2D(map, vMapUv - px * 0.7).a);
        ring = max(ring, texture2D(map, vMapUv + vec2(px.x, -px.y) * 0.7).a);
        ring = max(ring, texture2D(map, vMapUv + vec2(-px.x, px.y) * 0.7).a);
        float edge = clamp(ring - a0, 0.0, 1.0);
        vec3 col = texel.rgb;
        // painted colours survive the filmic tone map: lift saturation a touch
        float g = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(g), col, uSat);
        if (uShiny > 0.5) col = hueRot(col, uHueShift * 6.2832 + sin(uTime * 1.3) * 0.08);
        col *= uLight;
        // rim: the silhouette edge that faces the key light catches it
        float aL = texture2D(map, vMapUv - vec2(uTexel.x * 6.0, 0.0)).a;
        float aR = texture2D(map, vMapUv + vec2(uTexel.x * 6.0, 0.0)).a;
        float side = (aL - aR) * uRimSide * uFlip;
        col += uRim * clamp(side, 0.0, 1.0) * 0.45 * a0;
        col = mix(col, uFlashColor, uFlash);
        float alpha = max(a0, edge * 0.92);
        col = mix(uInk, col, a0 / max(alpha, 1e-3));
        if (uDissolve > 0.0) {
          float n = hash12(floor(vMapUv * 90.0));
          if (n < uDissolve) discard;
          col = mix(col, uDissolveColor * 2.0, smoothstep(uDissolve + 0.08, uDissolve, n));
        }
        diffuseColor = vec4(col, alpha * uFade * opacity);`);
  };
  mat.customProgramCacheKey = () => 'wm-sprite-v1';
  return mat;
}

// ── rig ───────────────────────────────────────────────────────────────────
interface Shot { name: AnimName; t: number; dur: number }
const ONE_SHOT: Partial<Record<AnimName, number>> = { attack: 0.62, hit: 0.42, cast: 0.9, victory: 1.3, interact: 0.6, jump: 0.5, land: 0.28, gather: 0.8, graze: 1.6 };
const _q = new THREE.Quaternion(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

export function makeSpriteRig(sp: Species, entry: SpriteEntry, tex: THREE.Texture, look: Look, mul = 1): Rig {
  const H = sp.height * mul;
  const aspect = entry.w / entry.h;
  const W = H * aspect;
  const padY = (entry.pad / entry.h) * H; // art sits pad pixels above the quad bottom
  const geo = new THREE.PlaneGeometry(W, H, 6, 10);
  geo.translate(0, H / 2 - padY, 0);
  const flier = sp.look?.body === 'bird' || (sp as Species & { behavior?: string }).behavior === 'flyer';
  const swimmer = !!sp.swim;
  const S: Record<string, THREE.IUniform> = {
    uH: { value: H }, uSwayAmp: { value: 0.012 }, uTilt: { value: 0 }, uFlip: { value: 1 }, uLift: { value: 0 },
    uScale: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2(0, 0) },
    uLight: { value: new THREE.Color(1, 1, 1) }, uRim: { value: new THREE.Color(1, 0.95, 0.85) }, uRimSide: { value: 1 },
    uInk: { value: new THREE.Color('#1a1024') }, uTexel: { value: new THREE.Vector2(1 / entry.w, 1 / entry.h) },
    uOutline: { value: 3.2 }, uSat: { value: 1.12 },
  };
  const mat = spriteMaterial(tex, look.U, S);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // the billboard moves vertices in the shader
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  mesh.userData.wmSprite = true;

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  const sw = Math.max(0.6, W * 0.62);
  shadow.scale.set(sw, sw * 0.55, 1);
  shadow.renderOrder = 1;
  shadow.userData.wmFx = true;

  const root = new THREE.Group();
  root.add(shadow, mesh);

  let flipTarget = 1, flip = 1;
  const facingSign = entry.facing === 'right' ? 1 : -1;
  mesh.onBeforeRender = (_r0, scene, camera) => {
    const rim = S.uRim.value as THREE.Color;
    const sunX = sceneLight(scene as THREE.Scene, S.uLight.value as THREE.Color, rim);
    // which way is "forward" for the rig, seen from this camera → paper-flip to face it
    root.getWorldQuaternion(_q);
    _f.set(0, 0, 1).applyQuaternion(_q); _f.y = 0;
    _r.setFromMatrixColumn(camera.matrixWorld, 0); _r.y = 0;
    if (_f.lengthSq() > 1e-4 && _r.lengthSq() > 1e-4) {
      const d = _f.normalize().dot(_r.normalize());
      if (Math.abs(d) > 0.18) flipTarget = Math.sign(d) * facingSign;
    }
    S.uRimSide.value = Math.sign(_r.x * sunX + 1e-4) || 1;
  };

  let t = 0, phase = 0, shot: Shot | null = null, fainted = false, faintK = 0, moveK = 0;
  const rig: Rig = {
    root, height: H, look,
    has: () => true,
    play(name) {
      if (name === 'faint') { fainted = true; shot = null; return; }
      if (name === 'idle' || name === 'walk' || name === 'run') { fainted = false; if (shot && shot.name !== 'jump') shot = null; return; }
      const dur = ONE_SHOT[name];
      if (dur) shot = { name, t: 0, dur };
    },
    update(dt, moving) {
      t += dt;
      look.update(dt);
      // paper flip: squash through zero width when turning around
      flip += (flipTarget - flip) * Math.min(1, dt * 14);
      if (Math.abs(flip - flipTarget) < 0.01) flip = flipTarget;
      S.uFlip.value = flip;
      moveK += (Math.min(1, moving) - moveK) * Math.min(1, dt * 8);
      const breathe = Math.sin(t * 2.2);
      let sx = 1 - 0.012 * breathe, sy = 1 + 0.024 * breathe, tilt = 0, ox = 0, oy = 0;
      // locomotion: hop-walk on land, glide-bob for fliers and swimmers
      if (moveK > 0.02) {
        phase += dt * (7 + 7 * moveK);
        const hop = Math.abs(Math.sin(phase));
        if (flier || swimmer) { oy += Math.sin(phase * 0.5) * 0.06 * H; tilt -= 0.08 * moveK; }
        else {
          oy += hop * 0.09 * H * moveK;
          sy *= 1 - 0.07 * (1 - hop) * moveK;
          sx *= 1 + 0.05 * (1 - hop) * moveK;
          tilt += Math.sin(phase) * 0.05 * moveK - 0.04 * moveK;
        }
      }
      if (flier) oy += 0.25 * H + Math.sin(t * 2.4) * 0.05 * H;
      if (swimmer && !flier) oy += Math.sin(t * 1.6) * 0.04 * H;
      if (shot) {
        shot.t += dt;
        const u = Math.min(1, shot.t / shot.dur);
        switch (shot.name) {
          case 'attack': {
            const back = u < 0.3 ? u / 0.3 : 0;
            const lunge = u >= 0.3 && u < 0.55 ? (u - 0.3) / 0.25 : u >= 0.55 ? 1 - (u - 0.55) / 0.45 : 0;
            ox += (-0.12 * back + 0.5 * Math.sin(lunge * Math.PI * 0.5)) * H;
            sx *= 1 + 0.12 * lunge; sy *= 1 - 0.06 * lunge;
            tilt -= 0.14 * lunge - 0.05 * back;
            break;
          }
          case 'hit': {
            const k = 1 - u;
            ox -= 0.16 * H * Math.sin(u * Math.PI) ;
            tilt += 0.12 * k * Math.sin(u * 40);
            sy *= 1 - 0.08 * k;
            break;
          }
          case 'cast': { const k = Math.sin(u * Math.PI); oy += 0.14 * H * k; sy *= 1 + 0.08 * k; sx *= 1 - 0.04 * k; break; }
          case 'victory': { const hops = Math.abs(Math.sin(u * Math.PI * 3)); oy += hops * 0.22 * H * (1 - u * 0.5); if (u > 0.35 && u < 0.65) S.uFlip.value = flip * Math.cos((u - 0.35) / 0.3 * Math.PI * 2); break; }
          case 'jump': { oy += Math.sin(u * Math.PI) * 0.35 * H; sy *= 1 + 0.08 * Math.sin(u * Math.PI); break; }
          case 'land': { const k = Math.sin(u * Math.PI); sy *= 1 - 0.12 * k; sx *= 1 + 0.08 * k; break; }
          case 'interact': case 'gather': case 'graze': { const k = Math.sin(u * Math.PI); tilt -= 0.18 * k; oy -= 0.03 * H * k; break; }
          default: break;
        }
        if (shot.t >= shot.dur) shot = null;
      }
      faintK += ((fainted ? 1 : 0) - faintK) * Math.min(1, dt * 6);
      if (faintK > 0.001) { tilt -= 1.35 * faintK; oy -= 0.08 * H * faintK; sy *= 1 - 0.1 * faintK; }
      S.uScale.value.set(sx, sy);
      S.uTilt.value = tilt;
      S.uOffset.value.set(ox, oy);
      S.uSwayAmp.value = 0.012 + 0.01 * moveK;
      const lift = Math.max(0, oy);
      const sScale = 1 - Math.min(0.5, lift / (H * 1.5));
      shadow.scale.set(sw * sScale, sw * 0.55 * sScale, 1);
      (shadow.material as THREE.MeshBasicMaterial).opacity = look.U.uFade.value * (1 - 0.5 * faintK) * sScale;
    },
  };
  return rig;
}
export const getSprite = (src: string) => textures.get(src) ?? null;
