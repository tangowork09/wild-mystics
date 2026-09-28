import * as THREE from 'three';
import { Q } from '../core/renderer';
import { ZONES, WORLD_SIZE, WATER_LEVEL } from '../data/zones';
import { clamp } from '../core/noise';
import type { TerrainData } from './terrain';
import { Ecology } from './flora/ecology';
import { LOOK, WIND_GLSL } from './flora/shared';

// World-anchored GPU grass in three pools that wrap around the player (mod trick), so the meadow
// streams with the camera without any CPU work per frame:
//   • near: dense clumps of curved blades        • far: sparse wide tufts out to the draw distance
//   • flowers: stems + procedural petals, clustered in patches, each land with its own palette
// Heights / density / tall-grass / flower patches come from a field texture baked once from the
// TerrainData sampling API (heightAt, grassAt, tallAt, pathAt, plazaAt), colours from the lands.
// Wind uses the same rolling gusts as the trees; blades bend away from the player.

const FIELD = 1024;
const LAND = 256;
const HALF = WORLD_SIZE / 2;

// per-land flower palettes (4 colours) and night glow
const FLOWERS: Record<string, [string, string, string, string, number]> = {
  vale: ['#ffffff', '#fff4d0', '#8fb2ff', '#ffd84a', 0], // v3:look — daisies, bluebells, buttercups
  lakes: ['#6fa8ff', '#f0f8ff', '#c8b8ff', '#ffe680', 0],
  coast: ['#ffffff', '#ffe066', '#ff9ec0', '#8ab8ff', 0],
  marsh: ['#c8a8ff', '#e8ffe8', '#d8f070', '#7fc8ff', 0.7],
  scar: ['#ff5a3a', '#ff9a3a', '#ffd040', '#d02a3a', 0.5],
  elder: ['#ffffff', '#ffd060', '#a8d0ff', '#ffb0d0', 0.35],
  dunes: ['#ffd24a', '#ff9a4a', '#e060b0', '#fff4e0', 0],
  peaks: ['#f4f8ff', '#4a70ff', '#9a7aff', '#fff0a0', 0],
  hollows: ['#7ff0ff', '#b08cff', '#ff9ae0', '#e8f4ff', 0.9],
  summit: ['#c8e0ff', '#ffffff', '#c8b8ff', '#9ff0ff', 0.4],
};

/** Blade clump geometry: `blades` blades of `seg` segments + tip, width `w`, spread `r`. */
function bladeGeometry(blades: number, seg: number, w: number, r: number): THREE.InstancedBufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let b = 0; b < blades; b++) {
    const base = pos.length / 3;
    const ang = (b / blades) * Math.PI * 2 + 0.4;
    const ox = blades > 1 ? Math.cos(ang) * r : 0, oz = blades > 1 ? Math.sin(ang) * r : 0;
    const rot = ang + 1.2 + b * 0.7;
    const cx = Math.cos(rot), cz = Math.sin(rot);
    for (let s = 0; s <= seg; s++) {
      const t = s / (seg + 1);
      const ww = w * (1 - t * 0.7);
      for (const side of [-1, 1]) {
        pos.push(ox + cx * side * ww, t, oz + cz * side * ww);
        nrm.push(-cz, 0.4, cx);
        uv.push(side < 0 ? 0 : 1, t);
      }
    }
    for (let s = 0; s < seg; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const top = base + (seg + 1) * 2;
    pos.push(ox, 1, oz); nrm.push(-cz, 0.4, cx); uv.push(0.5, 1);
    const l = base + seg * 2;
    idx.push(l, l + 1, top);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Flower: a stem (uv.x < 0.5 side) and a petal card on top (flagged with uv.y = 2). */
function flowerGeometry(): THREE.InstancedBufferGeometry {
  const pos = [
    -0.012, 0, 0, 0.012, 0, 0, -0.008, 1, 0, 0.008, 1, 0,
    -0.5, 1, -0.5, 0.5, 1, -0.5, -0.5, 1, 0.5, 0.5, 1, 0.5,
  ];
  const nrm = [0, 0.5, 1, 0, 0.5, 1, 0, 0.5, 1, 0, 0.5, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const uv = [0, 0, 1, 0, 0, 1, 1, 1, 0, 2, 1, 2, 0, 3, 1, 3];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7]);
  return g;
}

export class Grass {
  mesh = new THREE.Group();
  private clear = { value: new THREE.Vector3(0, 0, 0) };
  private center = { value: new THREE.Vector2() };
  private shared: Record<string, THREE.IUniform>;

  constructor(data: TerrainData) {
    const eco = new Ecology(data);
    const field = this.bakeField(data, eco);
    const land = this.bakeLand(eco);
    const pal: THREE.Vector4[] = [];
    ZONES.forEach((z) => {
      const f = FLOWERS[z.id] ?? FLOWERS.vale;
      for (let k = 0; k < 4; k++) { const c = new THREE.Color(f[k]); pal.push(new THREE.Vector4(c.r, c.g, c.b, f[4])); }
    });
    this.shared = {
      uField: { value: field }, uLand: { value: land }, uHalf: { value: HALF }, uCenter: this.center, uClear: this.clear,
      uPlayer: LOOK.uPlayer, uWind: LOOK.uWind, uTime: LOOK.uTime, uNoise: LOOK.uNoise,
      uSunDirG: LOOK.uSunDir, uSunColG: LOOK.uSunCol, uEnvAmbG: LOOK.uEnvAmb, uNightG: LOOK.uNight,
      uPal: { value: pal },
    };
    // v3:look — finer, denser blades (a soft meadow, not spikes)
    const near = this.pool('near', bladeGeometry(5, 2, 0.03, 0.15), Q.grassNear, Q.grassNearR, 0, 1);
    const far = this.pool('far', bladeGeometry(3, 1, 0.065, 0.1), Q.grassFar, Q.grassFarR, Q.grassNearR, 1);
    const flowers = this.pool('flower', flowerGeometry(), Q.flowers, Math.max(Q.grassNearR * 1.6, Q.grassFarR * 0.62), 0, 1);
    this.mesh.add(near, far, flowers);
  }

  /** Height / density / tall grass / flower patches, sampled once from the terrain API. */
  private bakeField(d: TerrainData, eco: Ecology) {
    const N = FIELD;
    const cell = WORLD_SIZE / N;
    const data = new Uint16Array(N * N * 4);
    const toH = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < N; j++) {
      const z = -HALF + (j + 0.5) * cell;
      for (let i = 0; i < N; i++) {
        const x = -HALF + (i + 0.5) * cell;
        const h = d.heightAt(x, z);
        let g = 0, tall = 0, fl = 0;
        if (h > WATER_LEVEL + 0.12) {
          g = d.grassAt(x, z);
          if (g > 0.01) {
            const road = Math.max(d.pathAt(x, z), d.plazaAt(x, z));
            g *= clamp(1 - road * 1.6, 0, 1) * clamp((h - WATER_LEVEL - 0.12) / 0.5, 0, 1);
            tall = d.tallAt(x, z) * clamp(1 - road * 3, 0, 1);
            fl = eco.patch(x, z, 0.022, 7);
          }
        }
        const o = (j * N + i) * 4;
        data[o] = toH(h); data[o + 1] = toH(g); data[o + 2] = toH(tall); data[o + 3] = toH(fl);
      }
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /** Grass colour per land (smoothly blended, with dry / lush macro patches) + land index in alpha. */
  private bakeLand(eco: Ecology) {
    const N = LAND;
    const data = new Uint8Array(N * N * 4);
    const w = new Float32Array(ZONES.length);
    const cols = ZONES.map((z) => new THREE.Color(z.grass));
    const c = new THREE.Color();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -HALF + ((i + 0.5) / N) * WORLD_SIZE, z = -HALF + ((j + 0.5) / N) * WORLD_SIZE;
        eco.weights(x, z, w, 40);
        c.setRGB(0, 0, 0);
        for (let k = 0; k < w.length; k++) if (w[k] > 1e-3) { c.r += cols[k].r * w[k]; c.g += cols[k].g * w[k]; c.b += cols[k].b * w[k]; }
        const o = (j * N + i) * 4;
        data[o] = Math.round(clamp(Math.pow(c.r, 1 / 2.2), 0, 1) * 255);
        data[o + 1] = Math.round(clamp(Math.pow(c.g, 1 / 2.2), 0, 1) * 255);
        data[o + 2] = Math.round(clamp(Math.pow(c.b, 1 / 2.2), 0, 1) * 255);
        data[o + 3] = eco.land(x, z);
      }
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  private pool(kind: 'near' | 'far' | 'flower', geo: THREE.InstancedBufferGeometry, count: number, R: number, inner: number, dens: number) {
    count = Math.max(1, count);
    const off = new Float32Array(count * 2);
    const rnd = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      off[i * 2] = (Math.random() * 2 - 1) * R;
      off[i * 2 + 1] = (Math.random() * 2 - 1) * R;
      rnd[i * 4] = Math.random();
      rnd[i * 4 + 1] = Math.random();
      rnd[i * 4 + 2] = Math.random() * 2 - 1;
      rnd[i * 4 + 3] = Math.random();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 2));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const local = { uRadius: { value: R }, uInner: { value: inner }, uDens: { value: dens } };
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    const flower = kind === 'flower';
    mat.customProgramCacheKey = () => `grass-${kind}`;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.shared, local);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          ${WIND_GLSL}
          attribute vec2 aOffset;
          attribute vec4 aRand;
          uniform sampler2D uField; uniform sampler2D uLand;
          uniform vec2 uCenter; uniform vec3 uPlayer; uniform vec3 uClear;
          uniform float uRadius; uniform float uInner; uniform float uDens; uniform float uHalf;
          uniform vec4 uPal[${ZONES.length * 4}];
          varying float vT; varying float vTall; varying vec3 vBase; varying vec3 vTip; varying vec4 vFlower; varying vec2 vPetal;`)
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normal, ${flower ? '0.2' : '0.35'}));`)
        .replace('#include <begin_vertex>', `
          vec2 rel = mod(aOffset - uCenter + uRadius, 2.0 * uRadius) - uRadius;
          vec2 wxz = uCenter + rel;
          vec2 fuv = (wxz + uHalf) / (2.0 * uHalf);
          vec4 F = textureLod(uField, fuv, 0.0);
          float dist = length(wxz - uPlayer.xz);
          float edge = length(rel);
          float fade = 1.0 - smoothstep(uRadius * 0.72, uRadius * 0.97, edge);
          ${kind === 'near' ? 'fade *= 1.0;' : ''}
          ${kind === 'far' ? 'fade *= smoothstep(uInner * 0.55, uInner * 0.95, edge);' : ''}
          float cleared = uClear.z > 0.0 ? smoothstep(uClear.z * 0.7, uClear.z, distance(wxz, uClear.xy)) : 1.0;
          float tall = smoothstep(0.25, 0.45, F.b) * cleared;
          ${flower
            ? 'float keep = step(aRand.w, F.g * max(smoothstep(0.28, 0.7, F.a), 0.3) * 1.1) * (1.0 - tall * 0.7);'
            : 'float keep = step(aRand.w, F.g * uDens * 1.3 * mix(0.5, 1.0, cleared) * (1.0 + tall * 0.4));'}
          float t = position.y;
          ${flower
            ? 'float h = mix(0.32, 0.6, aRand.y) * keep * fade;'
            : `float h = mix(0.26, 0.62, aRand.y) * mix(1.0, 2.5, tall) * keep * fade * mix(0.35, 1.0, cleared) ${kind === 'far' ? '* 1.25' : ''};`}
          float wdt = ${flower ? 'mix(0.08, 0.13, aRand.x) * keep * fade' : 'mix(1.0, 1.6, tall) * mix(0.8, 1.25, aRand.x) * keep * fade'};
          float ang = aRand.x * 6.2831853 + aRand.z;
          vec3 p;
          ${flower ? `
          bool head = uv.y > 1.5;
          vPetal = vec2(uv.x, uv.y - 2.0);
          // petal card tilted ~35° so it faces up and out
          p = head ? vec3(position.x * wdt, h + position.z * wdt * 0.57, position.z * wdt * 0.82) : vec3(position.x, position.y * h, position.z);
          ` : 'p = vec3(position.x * wdt, position.y * h, position.z * wdt);'}
          p = vec3(p.x * cos(ang) - p.z * sin(ang), p.y, p.x * sin(ang) + p.z * cos(ang));
          // wind: rolling gusts + flutter, blades bend (quadratic along the blade) and shorten
          float g = windGust(wxz);
          float ph = uTime * 1.9 + wxz.x * 0.11 + wxz.y * 0.07 + aRand.x * 3.0;
          float flutter = sin(ph) * 0.35 + sin(ph * 2.7 + 1.3) * 0.15;
          vec2 bend = uWind.xy * uWind.z * (g * 1.25 + flutter * (0.35 + g)) + vec2(aRand.z * 0.18, aRand.z * 0.1);
          vec2 toP = wxz - uPlayer.xz;
          float pd = length(toP);
          float push = 1.0 - smoothstep(0.3, 1.25 + tall * 0.7, pd);
          bend += (toP / max(pd, 0.001)) * push * 1.4;
          float k = ${flower ? '(head ? 1.0 : t * t)' : 't * t'};
          p.xz += bend * k * h * 0.7;
          p.y -= length(bend) * k * h * 0.22;
          vec3 transformed = vec3(wxz.x, F.r - 0.07, wxz.y) + p;
          vT = t; vTall = tall;
          vec4 L = texture(uLand, fuv);
          int land = int(texelFetch(uLand, ivec2(fuv * ${LAND}.0), 0).a * 255.0 + 0.5);
          // colour: land green, macro lush / dry patches, per-clump variation; tall grass deeper & richer
          float n = textureLod(uNoise, wxz * 0.011, 0.0).r;
          float n2 = textureLod(uNoise, wxz * 0.047 + 0.3, 0.0).g;
          vec3 base = L.rgb * mix(0.85, 1.15, n) * (1.0 + aRand.z * 0.08);
          base = mix(base, base * vec3(1.18, 1.08, 0.62), smoothstep(0.55, 0.85, n2) * 0.55);
          base = mix(base, base * vec3(0.72, 0.95, 0.78), tall * 0.8);
          vBase = base * mix(0.34, 0.5, tall);
          vTip = mix(base * 1.26, base * vec3(1.38, 1.3, 0.76), 0.3 + aRand.y * 0.3);
          ${flower ? `
          int pk = land * 4 + int(aRand.y * 3.99);
          vFlower = uPal[pk];
          ` : 'vFlower = vec4(0.0);'}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uSunDirG; uniform vec3 uSunColG; uniform vec3 uEnvAmbG; uniform float uNightG;
          varying float vT; varying float vTall; varying vec3 vBase; varying vec3 vTip; varying vec4 vFlower; varying vec2 vPetal;`)
        .replace('#include <color_fragment>', `
          vec3 col = mix(vBase, vTip, smoothstep(0.0, 1.0, vT));
          float flowerHead = 0.0;
          ${flower ? `
          if (vPetal.y >= 0.0) {
            vec2 q = vPetal - 0.5;
            float r = length(q) * 2.0;
            float a = atan(q.y, q.x);
            float petals = 0.55 + 0.45 * cos(a * 5.0);
            if (r > petals) discard;
            col = mix(vFlower.rgb, vec3(1.0, 0.86, 0.3), smoothstep(0.28, 0.12, r));
            flowerHead = 1.0;
          } else {
            col = vBase * 1.3;
          }` : ''}
          diffuseColor.rgb = col;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // sky fill (the env-map term Lambert doesn't get) + light through back-lit blades
            totalEmissiveRadiance += diffuseColor.rgb * uEnvAmbG;
            vec3 vd = normalize(vViewPosition);
            vec3 sunV = normalize((viewMatrix * vec4(uSunDirG, 0.0)).xyz);
            float back = pow(max(dot(vd, sunV), 0.0), 4.0);
            totalEmissiveRadiance += diffuseColor.rgb * uSunColG * back * 0.2 * vT;
            ${flower ? 'totalEmissiveRadiance += vFlower.rgb * vFlower.a * flowerHead * uNightG * 1.4;' : ''}
          }`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.name = `grass-${kind}`;
    return mesh;
  }

  setClear(x: number, z: number, r: number) { this.clear.value.set(x, z, r); }

  update(_t: number, player: THREE.Vector3) {
    this.center.value.set(player.x, player.z);
  }
}
