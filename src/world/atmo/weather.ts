import * as THREE from 'three';
import { ZONES, type Weather } from '../../data/zones';
import { lerp } from '../../core/noise';
import { renderer } from '../../core/renderer';
import type { MoodMix, SkyState } from './palette';
import { LOOK } from '../flora/shared';

// Per-land weather particles around the camera: motes (pollen, spores, fireflies, embers, snow, sand,
// sea spray, glimmer, aether) and a second layer of tumbling falling leaves (Elderwood, forest edges).

export interface WeatherParams {
  vx: number; vy: number; vz: number; size: number; alpha: number; flicker: number; spread: number; height: number;
  /** Brightness by day / by night (HDR; > 1 blooms). */
  day: number; night: number;
}

export const WEATHER: Record<Weather, WeatherParams> = {
  pollen: { vx: 0.3, vy: 0.25, vz: 0.1, size: 3.2, alpha: 0.75, flicker: 1, spread: 2, height: 9, day: 1.4, night: 0.35 },
  mist: { vx: 0.25, vy: 0.02, vz: 0.1, size: 26, alpha: 0.08, flicker: 0.2, spread: 3, height: 3, day: 1, night: 0.5 },
  embers: { vx: 0.25, vy: 1.7, vz: 0.1, size: 2.4, alpha: 1, flicker: 3, spread: 1.5, height: 12, day: 3.2, night: 5 },
  snow: { vx: 0.6, vy: -1.4, vz: 0.3, size: 4, alpha: 0.9, flicker: 0.3, spread: 1.5, height: 14, day: 1.1, night: 0.55 },
  spores: { vx: 0.1, vy: 0.35, vz: 0.15, size: 4, alpha: 0.9, flicker: 1.5, spread: 2.5, height: 7, day: 1, night: 2.6 },
  sand: { vx: 5.5, vy: 0.1, vz: 1.2, size: 3, alpha: 0.5, flicker: 0.4, spread: 0.6, height: 5, day: 1.1, night: 0.4 },
  spray: { vx: 1.2, vy: 0.2, vz: 0.6, size: 3, alpha: 0.45, flicker: 0.6, spread: 2, height: 6, day: 1.3, night: 0.5 },
  fireflies: { vx: 0.15, vy: 0.2, vz: 0.15, size: 3.4, alpha: 1, flicker: 3, spread: 2.5, height: 6, day: 0.45, night: 3.4 },
  glimmer: { vx: 0.1, vy: 0.3, vz: 0.1, size: 3, alpha: 0.9, flicker: 2.5, spread: 2, height: 8, day: 1.4, night: 2.8 },
  aether: { vx: 0.4, vy: 0.5, vz: 0.2, size: 3.4, alpha: 0.9, flicker: 1.5, spread: 2, height: 12, day: 1.4, night: 2.4 },
};

const KEYS = Object.keys(WEATHER.pollen) as (keyof WeatherParams)[];
const BOX = 60;

export class Weathers {
  group = new THREE.Group();
  private moteMat: THREE.ShaderMaterial;
  private leafMat: THREE.ShaderMaterial;
  private cur: WeatherParams = { ...WEATHER.pollen };
  private tgt: WeatherParams = { ...WEATHER.pollen };
  private col = new THREE.Color(ZONES[0].particles);
  private tgtCol = new THREE.Color(ZONES[0].particles);

  constructor(count: number) {
    const mk = (n: number) => {
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * BOX;
        pos[i * 3 + 1] = Math.random();
        pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
        seed[i] = Math.random();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      return g;
    };
    const common = {
      uTime: LOOK.uTime, uCenter: { value: new THREE.Vector3() }, uGround: { value: 0 }, uScale: { value: 1 },
    };
    this.moteMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        ...common, uColor: { value: this.col.clone() }, uVel: { value: new THREE.Vector3() }, uSize: { value: 4 }, uAlpha: { value: 1 },
        uFlicker: { value: 1 }, uSpread: { value: 2 }, uHeight: { value: 9 }, uGlow: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform vec3 uCenter; uniform float uGround; uniform float uScale;
        uniform vec3 uVel; uniform float uSize; uniform float uFlicker; uniform float uSpread; uniform float uHeight;
        varying float vA;
        void main(){
          vec3 p = position;
          float t = uTime * (0.6 + aSeed * 0.8);
          p.x += uVel.x * t + sin(uTime * 0.3 + aSeed * 40.0) * uSpread;
          p.z += uVel.z * t + cos(uTime * 0.25 + aSeed * 30.0) * uSpread;
          float y = mod(p.y * uHeight + uVel.y * t, uHeight);
          vec3 rel = mod(vec3(p.x, 0.0, p.z) - uCenter + ${BOX / 2}.0, ${BOX}.0) - ${BOX / 2}.0;
          vec3 w = vec3(uCenter.x + rel.x, uGround + y, uCenter.z + rel.z);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((1.0 + aSeed) * uSize * (22.0 / -mv.z), uSize * 3.0) * uScale;
          float fl = mix(1.0, 0.5 + 0.5 * sin(uTime * 2.0 * uFlicker + aSeed * 60.0), min(uFlicker, 1.0));
          // fade in / out at the top and bottom of the column and at the box edge
          float edge = smoothstep(0.0, 1.0, y) * smoothstep(uHeight, uHeight - 1.5, y);
          vA = fl * edge * (1.0 - smoothstep(20.0, 30.0, length(rel.xz))) * smoothstep(2.5, 7.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; uniform float uGlow; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a *= a;
          gl_FragColor = vec4(uColor * uGlow, a * vA * uAlpha);
        }`,
    });
    const motes = new THREE.Points(mk(count), this.moteMat);
    motes.frustumCulled = false;
    motes.renderOrder = 5;

    this.leafMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { ...common, uAmount: { value: 0 }, uSun: LOOK.uSunCol, uAmb: LOOK.uAmbTop, uWind: LOOK.uWind },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform vec3 uCenter; uniform float uGround; uniform float uScale; uniform float uAmount; uniform vec4 uWind;
        varying float vA; varying float vSeed; varying float vRot; varying float vFlip;
        void main(){
          vec3 p = position;
          float t = uTime * (0.7 + aSeed * 0.6);
          float H = 11.0;
          float y = mod(p.y * H - t * 0.75, H);
          p.x += uWind.x * t * 0.9 + sin(t * 1.3 + aSeed * 50.0) * 1.2;
          p.z += uWind.y * t * 0.9 + cos(t * 1.1 + aSeed * 20.0) * 1.2;
          vec3 rel = mod(vec3(p.x, 0.0, p.z) - uCenter + ${BOX / 2}.0, ${BOX}.0) - ${BOX / 2}.0;
          vec3 w = vec3(uCenter.x + rel.x, uGround + y, uCenter.z + rel.z);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((0.8 + aSeed * 0.6) * 5.5 * (26.0 / -mv.z), 26.0) * uScale;
          vA = step(aSeed, uAmount) * smoothstep(0.0, 1.0, y) * smoothstep(H, H - 2.0, y) * (1.0 - smoothstep(18.0, 28.0, length(rel.xz))) * smoothstep(1.5, 4.0, -mv.z);
          vSeed = aSeed;
          vRot = t * (1.5 + aSeed * 2.0) + aSeed * 6.28;
          vFlip = cos(t * (2.0 + aSeed * 2.5));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform vec3 uAmb;
        varying float vA; varying float vSeed; varying float vRot; varying float vFlip;
        void main(){
          if (vA < 0.01) discard;
          vec2 q = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
          q.x /= max(abs(vFlip), 0.2);
          // leaf: pointed ellipse with a midrib
          float leaf = length(vec2(q.x * 2.3, q.y * 1.15 + q.x * q.x * 1.6));
          if (leaf > 0.5) discard;
          vec3 base = vSeed < 0.33 ? vec3(0.42, 0.62, 0.12) : vSeed < 0.66 ? vec3(0.85, 0.62, 0.12) : vec3(0.8, 0.32, 0.08);
          float rib = smoothstep(0.03, 0.0, abs(q.x)) * 0.25;
          vec3 col = base * (uSun * 0.22 * (0.6 + 0.4 * abs(vFlip)) + uAmb * 0.42) * (1.0 - rib);
          gl_FragColor = vec4(col, vA * smoothstep(0.5, 0.42, leaf));
        }`,
    });
    const leaves = new THREE.Points(mk(Math.round(count * 0.45)), this.leafMat);
    leaves.frustumCulled = false;
    leaves.renderOrder = 4;
    this.group.add(motes, leaves);
  }

  setWeights(w: number[]) {
    for (const k of KEYS) this.tgt[k] = 0;
    this.tgtCol.setRGB(0, 0, 0);
    ZONES.forEach((z, i) => {
      if (w[i] < 0.001) return;
      const wp = WEATHER[z.weather];
      for (const k of KEYS) this.tgt[k] += wp[k] * w[i];
      this.tgtCol.add(new THREE.Color(z.particles).multiplyScalar(w[i]));
    });
  }

  update(dt: number, _t: number, focus: THREE.Vector3, groundY: number, _target: MoodMix, mood: MoodMix, _s: SkyState, night: number) {
    const k = 1 - Math.exp(-dt * 0.8);
    for (const key of KEYS) this.cur[key] = lerp(this.cur[key], this.tgt[key], k);
    this.col.lerp(this.tgtCol, k);
    const scale = renderer.getDrawingBufferSize(new THREE.Vector2()).y / 900;
    const u = this.moteMat.uniforms;
    (u.uCenter.value as THREE.Vector3).copy(focus);
    u.uGround.value = groundY;
    u.uScale.value = scale;
    (u.uColor.value as THREE.Color).copy(this.col);
    (u.uVel.value as THREE.Vector3).set(this.cur.vx, this.cur.vy, this.cur.vz);
    u.uSize.value = this.cur.size;
    u.uAlpha.value = this.cur.alpha;
    u.uFlicker.value = this.cur.flicker;
    u.uSpread.value = this.cur.spread;
    u.uHeight.value = this.cur.height;
    u.uGlow.value = lerp(this.cur.day, this.cur.night, night);
    const l = this.leafMat.uniforms;
    (l.uCenter.value as THREE.Vector3).copy(focus);
    l.uGround.value = groundY;
    l.uScale.value = scale;
    l.uAmount.value = mood.leaves;
  }
}
