import * as THREE from 'three';
import { makeNoise2D, fbm, clamp, lerp } from '../core/noise';
import { Q } from '../core/renderer';
import { idbGet, idbSet, idbDeletePrefix } from '../core/idb';
import { WORLD_SIZE } from '../data/zones';
import { RES, CRES, bakeFields, bakeKey, type Fields } from './terrainBake';

export { FEATURES, PATHS, RES, analyticHeight, type Feature } from './terrainBake';

const HALF = WORLD_SIZE / 2;
const CELL = WORLD_SIZE / (RES - 1);

/** Baked world fields + GPU textures. Every overworld system samples these so they agree. */
export class TerrainData {
  height!: Float32Array;
  grass!: Float32Array;
  tall!: Float32Array;
  path!: Float32Array;
  slope!: Float32Array;
  plaza!: Float32Array;
  zoneIdx!: Uint8Array;
  private waterShallow!: Uint8Array;

  fieldTex!: THREE.DataTexture;
  grassTex!: THREE.DataTexture;
  tallTex!: THREE.DataTexture;
  shallowTex!: THREE.DataTexture;
  deepTex!: THREE.DataTexture;
  colorMap!: HTMLCanvasElement;
  bakeMs = 0;
  cached = false;

  async load(progress?: (f: number) => void) {
    const cm = Q.colorMap;
    const key = bakeKey(cm);
    const t0 = performance.now();
    let f = new URLSearchParams(location.search).has('rebake') ? undefined : await idbGet<Fields>(key);
    this.cached = !!f;
    if (!f) {
      f = await this.bakeInWorker(cm, progress).catch(() => bakeFields(cm, progress));
      void idbSet(key, f).then(() => idbDeletePrefix('world-', key));
    }
    this.bakeMs = performance.now() - t0;
    this.apply(f);
  }

  private bakeInWorker(cmSize: number, progress?: (f: number) => void): Promise<Fields> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        if (e.data.progress !== undefined) progress?.(e.data.progress);
        if (e.data.fields) { resolve(e.data.fields); w.terminate(); }
      };
      w.onerror = (e) => { w.terminate(); reject(e); };
      w.postMessage({ cmSize });
    });
  }

  private apply(f: Fields) {
    this.height = f.height; this.grass = f.grass; this.tall = f.tall; this.path = f.path; this.slope = f.slope; this.plaza = f.plaza; this.zoneIdx = f.zoneIdx;
    this.waterShallow = f.waterShallow;
    const N = RES * RES;
    const half = new Uint16Array(N * 4);
    for (let k = 0; k < N; k++) {
      half[k * 4] = THREE.DataUtils.toHalfFloat(f.height[k]);
      half[k * 4 + 1] = THREE.DataUtils.toHalfFloat(f.grass[k]);
      half[k * 4 + 2] = THREE.DataUtils.toHalfFloat(f.tall[k]);
      half[k * 4 + 3] = THREE.DataUtils.toHalfFloat(Math.max(f.path[k], f.plaza[k]));
    }
    this.fieldTex = new THREE.DataTexture(half, RES, RES, THREE.RGBAFormat, THREE.HalfFloatType);
    this.fieldTex.magFilter = this.fieldTex.minFilter = THREE.LinearFilter;
    this.fieldTex.needsUpdate = true;
    const colTex = (d: Uint8Array) => {
      const t = new THREE.DataTexture(d, CRES, CRES, THREE.RGBAFormat);
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    };
    this.grassTex = colTex(f.grassCol);
    this.tallTex = colTex(f.tallCol);
    this.shallowTex = colTex(f.waterShallow);
    this.deepTex = colTex(f.waterDeep);
    const cv = document.createElement('canvas');
    cv.width = cv.height = f.cmSize;
    cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(f.colorMap), f.cmSize, f.cmSize), 0, 0);
    this.colorMap = cv;
  }

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
  plazaAt(x: number, z: number) { return this.sample(this.plaza, x, z); }
  lavaAt(x: number, z: number) {
    const i = clamp(Math.round(((x + HALF) / WORLD_SIZE) * (CRES - 1)), 0, CRES - 1);
    const j = clamp(Math.round(((z + HALF) / WORLD_SIZE) * (CRES - 1)), 0, CRES - 1);
    return this.waterShallow[(j * CRES + i) * 4 + 3] / 255;
  }
}

export function buildTerrainMesh(data: TerrainData, detail?: { grass?: THREE.Texture; rock?: THREE.Texture }) {
  const SEG = Q.terrainSeg;
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
    sh.uniforms.uField = { value: data.fieldTex };
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
        vec3 grav = texture2D(uRock, vWPos.xz * 0.09 + 0.5).rgb;
        float pathDetail = dot(gv, vec3(0.333)) * 0.65 + dot(grav, vec3(0.333)) * 0.35;
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
