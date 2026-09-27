import * as THREE from 'three';
import { makeNoise2D, fbm, clamp, lerp } from '../core/noise';
import { ZONES, WORLD_SIZE, WATER_LEVEL, zoneWeights } from '../data/zones';

// Baked world fields. Everything in the overworld (mesh, grass shader, water shader, spawns,
// minimap, collisions) samples from these grids so they always agree with each other.

export const RES = 512;
const HALF = WORLD_SIZE / 2;
const CELL = WORLD_SIZE / (RES - 1);

const n1 = makeNoise2D(1337);
const n2 = makeNoise2D(4242);
const n3 = makeNoise2D(99);

export interface Feature { x: number; z: number; r: number; kind: 'town' | 'camp' | 'arena' }

export const FEATURES: Feature[] = ZONES.flatMap((z) => [
  { x: z.town.pos[0], z: z.town.pos[1], r: 34, kind: 'town' as const },
  { x: z.camp[0], z: z.camp[1], r: 9, kind: 'camp' as const },
  { x: z.boss.pos[0], z: z.boss.pos[1], r: 22, kind: 'arena' as const },
]);

/** Road network: hub town → other towns, each town → its camp → arena. Gently curved. */
export const PATHS: [number, number][][] = (() => {
  const hub = ZONES[0].town.pos;
  const out: [number, number][][] = [];
  const curve = (a: [number, number], b: [number, number], bend: number): [number, number][] => {
    const pts: [number, number][] = [];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const nx = -dz, nz = dx;
    const len = Math.hypot(dx, dz);
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const off = Math.sin(t * Math.PI) * bend + n3(t * 3 + a[0] * 0.01, a[1] * 0.01) * 6 * Math.sin(t * Math.PI);
      pts.push([a[0] + dx * t + (nx / len) * off, a[1] + dz * t + (nz / len) * off]);
    }
    return pts;
  };
  for (const z of ZONES.slice(1)) out.push(curve(hub, z.town.pos, 22));
  for (const z of ZONES) {
    out.push(curve(z.town.pos, z.camp, 10));
    out.push(curve(z.camp, z.boss.pos, 3));
  }
  return out;
})();

const SEGS: number[] = [];
for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) SEGS.push(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);

function distToPaths(x: number, z: number): number {
  let best = 1e9;
  for (let s = 0; s < SEGS.length; s += 4) {
    const ax = SEGS[s], az = SEGS[s + 1], bx = SEGS[s + 2], bz = SEGS[s + 3];
    // cheap reject: segment bbox farther than current best
    if (x < Math.min(ax, bx) - best || x > Math.max(ax, bx) + best || z < Math.min(az, bz) - best || z > Math.max(az, bz) + best) continue;
    const vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
    if (d < best) best = d;
  }
  return best;
}

const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** Raw analytic height before feature flattening. */
function rawHeight(x: number, z: number, w: number[], oct = 5): number {
  const hs = w.reduce((s, wi, i) => s + wi * ZONES[i].heightScale, 0);
  let h = fbm(n1, x * 0.0085, z * 0.0085, oct) * 11 * hs + 2.5;
  // ridged peaks in Stormreach
  const ridge = 1 - Math.abs(fbm(n2, x * 0.012, z * 0.012, Math.min(4, oct)));
  h += Math.pow(ridge, 3) * 26 * w[3];
  // cracked mesas in Ember Scar
  const mesa = smooth(0.1, 0.25, fbm(n2, x * 0.02 + 40, z * 0.02, 3));
  h += mesa * 7 * w[1];
  // lakes: Mirror Lakes gets many, Vale a few ponds, Scar lava pools
  const lakeN = fbm(n3, x * 0.018, z * 0.018, 3);
  h -= smooth(0.05, 0.3, lakeN) * (9 * w[2] + 5 * w[0] + 7 * w[1]);
  // world border mountains
  const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
  h += Math.pow(smooth(0.8, 1.0, edge), 1.5) * 55 + smooth(0.86, 1, edge) * fbm(n1, x * 0.05, z * 0.05, 3) * 12;
  return h;
}

const featureHeights = FEATURES.map((f) => Math.max(rawHeight(f.x, f.z, zoneWeights(f.x, f.z)), WATER_LEVEL + 1.6));

export function analyticHeight(x: number, z: number, pathDist?: number): number {
  const w = zoneWeights(x, z);
  let h = rawHeight(x, z, w);
  FEATURES.forEach((f, i) => {
    const d = Math.hypot(x - f.x, z - f.z);
    const k = smooth(f.r + 22, f.r, d);
    if (k > 0) h = lerp(h, featureHeights[i], k);
  });
  // roads follow a low-frequency version of the land (no ridges) and stay above water
  const pd = pathDist ?? distToPaths(x, z);
  const pk = smooth(8, 2.5, pd);
  if (pk > 0) {
    let hs = rawHeight(x, z, w, 2);
    FEATURES.forEach((f, i) => { const k = smooth(f.r + 22, f.r, Math.hypot(x - f.x, z - f.z)); if (k > 0) hs = lerp(hs, featureHeights[i], k); });
    h = lerp(h, Math.max(hs, WATER_LEVEL + 0.9), pk * 0.85);
  }
  return h;
}

export class TerrainData {
  height = new Float32Array(RES * RES);
  zoneW = new Float32Array(RES * RES * 4);
  path = new Float32Array(RES * RES);
  grass = new Float32Array(RES * RES);
  tall = new Float32Array(RES * RES);
  slope = new Float32Array(RES * RES);
  plaza = new Float32Array(RES * RES);

  fieldTex!: THREE.DataTexture;
  zoneTex!: THREE.DataTexture;
  colorMap!: HTMLCanvasElement;

  bake() {
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        const k = j * RES + i;
        const pd = distToPaths(x, z);
        this.height[k] = analyticHeight(x, z, pd);
        const w = zoneWeights(x, z);
        for (let c = 0; c < 4; c++) this.zoneW[k * 4 + c] = w[c];
        this.path[k] = smooth(4.2, 1.6, pd);
      }
    }
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const k = j * RES + i;
        const hx = this.height[j * RES + Math.min(RES - 1, i + 1)] - this.height[j * RES + Math.max(0, i - 1)];
        const hz = this.height[Math.min(RES - 1, j + 1) * RES + i] - this.height[Math.max(0, j - 1) * RES + i];
        const slope = Math.hypot(hx, hz) / (2 * CELL);
        this.slope[k] = slope;
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        const h = this.height[k];
        let town = 0;
        for (const f of FEATURES) town = Math.max(town, smooth(f.r + 4, f.r - 6, Math.hypot(x - f.x, z - f.z)));
        const wet = smooth(WATER_LEVEL + 0.2, WATER_LEVEL + 1.0, h);
        const flat = smooth(0.9, 0.45, slope);
        const lushness = this.zoneW[k * 4] * 1 + this.zoneW[k * 4 + 1] * 0.35 + this.zoneW[k * 4 + 2] * 0.9 + this.zoneW[k * 4 + 3] * 0.55;
        let plaza = 0;
        for (const f of FEATURES) if (f.kind === 'town') plaza = Math.max(plaza, smooth(f.r - 6, f.r - 12, Math.hypot(x - f.x, z - f.z)));
        this.plaza[k] = plaza;
        const g = wet * flat * (1 - this.path[k]) * (1 - town * 0.6) * (1 - plaza) * clamp(lushness + fbm(n2, x * 0.05, z * 0.05, 2) * 0.4, 0, 1);
        this.grass[k] = g;
        // tall-grass encounter patches
        const patch = fbm(n3, x * 0.03 + 11, z * 0.03 - 7, 3);
        this.tall[k] = smooth(0.2, 0.3, patch) * g * (1 - town) * (1 - this.path[k]);
      }
    }
    this.buildTextures();
    this.buildColorMap();
  }

  private buildTextures() {
    const f = new Uint16Array(RES * RES * 4);
    const zw = new Uint8Array(RES * RES * 4);
    for (let k = 0; k < RES * RES; k++) {
      f[k * 4] = THREE.DataUtils.toHalfFloat(this.height[k]);
      f[k * 4 + 1] = THREE.DataUtils.toHalfFloat(this.grass[k]);
      f[k * 4 + 2] = THREE.DataUtils.toHalfFloat(this.tall[k]);
      f[k * 4 + 3] = THREE.DataUtils.toHalfFloat(Math.max(this.path[k], this.plaza[k]));
      for (let c = 0; c < 4; c++) zw[k * 4 + c] = Math.round(this.zoneW[k * 4 + c] * 255);
    }
    this.fieldTex = new THREE.DataTexture(f, RES, RES, THREE.RGBAFormat, THREE.HalfFloatType);
    this.fieldTex.magFilter = this.fieldTex.minFilter = THREE.LinearFilter;
    this.fieldTex.needsUpdate = true;
    this.zoneTex = new THREE.DataTexture(zw, RES, RES, THREE.RGBAFormat);
    this.zoneTex.magFilter = this.zoneTex.minFilter = THREE.LinearFilter;
    this.zoneTex.needsUpdate = true;
  }

  private buildColorMap() {
    const S = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    const cols = ZONES.map((z) => z.ground.map((c) => new THREE.Color(c)));
    const dirt = new THREE.Color('#c9a06a');
    const cobble = new THREE.Color('#d6c7ae');
    const sand = new THREE.Color('#d8c89a');
    const rock = new THREE.Color('#6a6470');
    const snow = new THREE.Color('#f4f6ff');
    const tmp = new THREE.Color();
    const acc = new THREE.Color();
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = -HALF + (px / (S - 1)) * WORLD_SIZE;
        const z = -HALF + (py / (S - 1)) * WORLD_SIZE;
        const h = this.sample(this.height, x, z);
        const slope = this.sample(this.slope, x, z);
        const path = this.sample(this.path, x, z);
        const tall = this.sample(this.tall, x, z);
        const i = Math.round(((x + HALF) / WORLD_SIZE) * (RES - 1));
        const j = Math.round(((z + HALF) / WORLD_SIZE) * (RES - 1));
        const k = clamp(j, 0, RES - 1) * RES + clamp(i, 0, RES - 1);
        acc.setRGB(0, 0, 0);
        const nA = fbm(n2, x * 0.04, z * 0.04, 3);
        const nB = fbm(n1, x * 0.15, z * 0.15, 2);
        for (let zi = 0; zi < 4; zi++) {
          const w = this.zoneW[k * 4 + zi];
          if (w < 0.01) continue;
          const [low, high, accent] = cols[zi];
          tmp.copy(low).lerp(high, clamp((h - 1) / 14 + nA * 0.5, 0, 1));
          tmp.lerp(accent, smooth(0.35, 0.6, nB) * 0.35);
          acc.r += tmp.r * w; acc.g += tmp.g * w; acc.b += tmp.b * w;
        }
        // peaks: snow caps
        acc.lerp(snow, smooth(24, 34, h + nA * 6) * this.zoneW[k * 4 + 3]);
        acc.lerp(rock, smooth(0.7, 1.4, slope) * 0.85);
        acc.lerp(sand, smooth(WATER_LEVEL + 1.4, WATER_LEVEL + 0.3, h) * 0.8);
        acc.multiplyScalar(1 - tall * 0.22);
        let town = 0;
        for (const f of FEATURES) if (f.kind === 'town') town = Math.max(town, smooth(f.r - 10, f.r - 16, Math.hypot(x - f.x, z - f.z)));
        acc.lerp(dirt.clone().multiplyScalar(0.9 + nB * 0.2), path * 0.92);
        acc.lerp(cobble.clone().multiplyScalar(0.85 + nB * 0.3), town * 0.9);
        const o = (py * S + px) * 4;
        img.data[o] = clamp(acc.r * 255, 0, 255);
        img.data[o + 1] = clamp(acc.g * 255, 0, 255);
        img.data[o + 2] = clamp(acc.b * 255, 0, 255);
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.colorMap = cv;
  }

  /** Bilinear sample of any baked field at world XZ. */
  sample(arr: Float32Array, x: number, z: number): number {
    const fx = clamp((x + HALF) / CELL, 0, RES - 1.001);
    const fz = clamp((z + HALF) / CELL, 0, RES - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = arr[j * RES + i], b = arr[j * RES + i + 1];
    const c = arr[(j + 1) * RES + i], d = arr[(j + 1) * RES + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  heightAt(x: number, z: number) { return this.sample(this.height, x, z); }
  tallAt(x: number, z: number) { return this.sample(this.tall, x, z); }
  slopeAt(x: number, z: number) { return this.sample(this.slope, x, z); }
  pathAt(x: number, z: number) { return this.sample(this.path, x, z); }
  grassAt(x: number, z: number) { return this.sample(this.grass, x, z); }
}

export function buildTerrainMesh(data: TerrainData, detail?: { grass?: THREE.Texture; rock?: THREE.Texture; normal?: THREE.Texture }) {
  const fieldTex = data.fieldTex;
  const SEG = 320;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), z = pos.getZ(v);
    pos.setY(v, data.heightAt(x, z));
    uv.setXY(v, (x + HALF) / WORLD_SIZE, (z + HALF) / WORLD_SIZE);
  }
  geo.computeVertexNormals();
  const map = new THREE.CanvasTexture(data.colorMap);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.flipY = false;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
  const detailTex = detail?.grass ?? makeDetailTexture();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: detailTex };
    sh.uniforms.uRock = { value: detail?.rock ?? detailTex };
    sh.uniforms.uField = { value: fieldTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform sampler2D uRock;\nuniform sampler2D uField;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        vec3 dA = texture2D(uDetail, vWPos.xz * 0.21).rgb;
        vec3 dB = texture2D(uDetail, vWPos.xz * 0.047 + 0.3).rgb;
        float lum = dot(dA, vec3(0.333)) * 0.6 + dot(dB, vec3(0.333)) * 0.4;
        float steep = smoothstep(0.55, 0.85, 1.0 - vWNormal.y);
        vec3 rk = texture2D(uRock, vec2(vWPos.x + vWPos.z, vWPos.y) * 0.12).rgb;
        float rlum = dot(rk, vec3(0.333));
        float detail = mix(lum, rlum, steep);
        float pth = texture2D(uField, vMapUv).a;
        vec3 gv = texture2D(uRock, vWPos.xz * 0.33).rgb;
        float glum = dot(gv, vec3(0.333));
        vec3 grav = texture2D(uRock, vWPos.xz * 0.09 + 0.5).rgb;
        float g2 = dot(grav, vec3(0.333));
        float pathDetail = glum * 0.65 + g2 * 0.35;
        diffuseColor.rgb *= mix(mix(0.8, 1.22, detail), mix(0.62, 1.38, pathDetail), smoothstep(0.15, 0.75, pth));
      `);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/** Procedural tiling detail (stand-in for a real ground texture). */
export function makeDetailTexture(): THREE.DataTexture {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const nz = makeNoise2D(7);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // tileable via 4D torus trick approximated with sum of wrapped samples
      const u = x / S, v = y / S;
      const a = u * Math.PI * 2, b = v * Math.PI * 2;
      const n = fbm(nz, Math.cos(a) * 2 + Math.cos(b) * 0.7 + 5, Math.sin(a) * 2 + Math.sin(b) * 2.3, 5, 2.2, 0.55);
      const val = clamp(128 + n * 110, 0, 255);
      const o = (y * S + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = val;
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
