import * as THREE from 'three';
import { Q } from '../core/renderer';
import { WORLD_SIZE, ZONES } from '../data/zones';
import type { TerrainData } from './terrain';

// World-anchored GPU grass. A fixed pool of clumps wraps around the player (mod trick), every
// clump samples height / density / tall-grass mask from the baked field texture in the vertex shader.

export class Grass {
  mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(data: TerrainData) {
    const R = Q.grassRadius;
    const count = Q.grass;

    // one clump = 3 tapered blades
    const blade = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
    const SEG = 3;
    for (let b = 0; b < 3; b++) {
      const base = blade.pos.length / 3;
      const ang = (b / 3) * Math.PI * 2 + 0.4;
      const ox = Math.cos(ang) * 0.14, oz = Math.sin(ang) * 0.14;
      const rot = ang + 1.2;
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG;
        const w = 0.085 * (1 - t * 0.85);
        for (const side of [-1, 1]) {
          const lx = side * w;
          blade.pos.push(ox + Math.cos(rot) * lx, t, oz + Math.sin(rot) * lx);
          blade.uv.push(side < 0 ? 0 : 1, t);
        }
      }
      for (let s = 0; s < SEG; s++) {
        const a = base + s * 2;
        blade.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      // pointed tip
      const top = base + SEG * 2;
      blade.pos.push(ox, 1.12, oz); blade.uv.push(0.5, 1.12);
      blade.idx.push(top, top + 1, top + 2);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(blade.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(blade.uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(blade.pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(blade.idx);
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

    const zoneGrass = ZONES.map((z) => new THREE.Color(z.grass));
    this.uniforms = {
      uField: { value: data.fieldTex },
      uZone: { value: data.zoneTex },
      uCenter: { value: new THREE.Vector2() },
      uPlayer: { value: new THREE.Vector2() },
      uRadius: { value: R },
      uHalf: { value: WORLD_SIZE / 2 },
      uTime: { value: 0 },
      uWind: { value: 0.35 },
      uZoneGrass: { value: zoneGrass },
      uClear: { value: new THREE.Vector3(0, 0, 0) },
    };
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aOffset;
          attribute vec4 aRand;
          uniform sampler2D uField;
          uniform vec2 uCenter; uniform vec2 uPlayer;
          uniform float uRadius; uniform float uHalf; uniform float uTime; uniform float uWind; uniform vec3 uClear;
          varying float vT; varying float vTall; varying vec2 vFUV; varying float vFlower; varying float vVar;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
          vec2 rel = mod(aOffset - uCenter + uRadius, 2.0 * uRadius) - uRadius;
          vec2 wxz = uCenter + rel;
          vec2 fuv = (wxz + uHalf) / (uHalf * 2.0);
          vec4 field = texture2D(uField, fuv);
          float dens = field.g;
          float tall = field.b;
          float fade = 1.0 - smoothstep(uRadius * 0.72, uRadius * 0.98, length(rel));
          float clr0 = uClear.z > 0.0 ? smoothstep(uClear.z * 0.7, uClear.z, distance(uCenter + rel, uClear.xy)) : 1.0;
          float keep = step(aRand.w, dens * 1.25 * mix(0.45, 1.0, clr0));
          float isTall = smoothstep(0.25, 0.45, tall);
          float cleared = uClear.z > 0.0 ? smoothstep(uClear.z * 0.7, uClear.z, distance(wxz, uClear.xy)) : 1.0;
          isTall *= cleared;
          float h = mix(0.28, 0.62, aRand.y) * mix(1.0, 2.7, isTall) * keep * fade * mix(0.32, 1.0, cleared);
          float wdt = mix(1.0, 1.7, isTall) * mix(0.8, 1.2, aRand.x) * keep * fade;
          float ang = aRand.x * 6.2831853;
          float t = position.y;
          vec3 p = vec3(position.x * wdt, position.y * h, position.z * wdt);
          p = vec3(p.x * cos(ang) - p.z * sin(ang), p.y, p.x * sin(ang) + p.z * cos(ang));
          float ph = uTime * 1.6 + wxz.x * 0.09 + wxz.y * 0.07;
          float gust = sin(uTime * 0.35 + wxz.x * 0.013) * 0.5 + 0.5;
          float wind = (sin(ph) * 0.55 + sin(ph * 2.7 + 1.3) * 0.2 + 0.45) * uWind * (0.6 + gust);
          vec2 toP = wxz - uPlayer;
          float pd = length(toP);
          float push = 1.0 - smoothstep(0.2, 1.4 + isTall * 0.6, pd);
          vec2 bend = normalize(vec2(1.0, 0.35)) * wind + (toP / max(pd, 0.001)) * push * 1.3 + vec2(aRand.z * 0.25, aRand.z * 0.12);
          float k = t * t;
          p.xz += bend * k * h * 0.75;
          p.y -= length(bend) * k * h * 0.22;
          vec3 transformed = vec3(wxz.x, field.r - 0.03, wxz.y) + p;
          vT = t; vTall = isTall; vFUV = fuv; vVar = aRand.z;
          vFlower = step(0.985, fract(aRand.x * 37.13)) * (1.0 - isTall);
        `);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uZone; uniform vec3 uZoneGrass[4];
          varying float vT; varying float vTall; varying vec2 vFUV; varying float vFlower; varying float vVar;`)
        .replace('#include <color_fragment>', `
          vec4 zw = texture2D(uZone, vFUV);
          vec3 g = uZoneGrass[0] * zw.r + uZoneGrass[1] * zw.g + uZoneGrass[2] * zw.b + uZoneGrass[3] * zw.a;
          g /= max(zw.r + zw.g + zw.b + zw.a, 0.001);
          vec3 base = g * mix(0.32, 0.5, vTall);
          vec3 tip = mix(g * 1.25, vec3(0.95, 0.92, 0.55), 0.18 + vVar * 0.08);
          tip = mix(tip, g * vec3(0.8, 1.05, 0.7), vTall * 0.55);
          vec3 col = mix(base, tip, smoothstep(0.0, 1.0, vT));
          if (vFlower > 0.5 && vT > 0.82) {
            float h = fract(vVar * 7.31 + 0.5);
            col = h < 0.25 ? vec3(1.0, 0.55, 0.75) : h < 0.5 ? vec3(1.0, 0.9, 0.35) : h < 0.75 ? vec3(0.95, 0.95, 1.0) : vec3(0.7, 0.55, 1.0);
          }
          diffuseColor.rgb = col;
        `)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  setClear(x: number, z: number, r: number) { (this.uniforms.uClear.value as THREE.Vector3).set(x, z, r); }

  update(t: number, player: THREE.Vector3) {
    this.uniforms.uTime.value = t;
    (this.uniforms.uCenter.value as THREE.Vector2).set(player.x, player.z);
    (this.uniforms.uPlayer.value as THREE.Vector2).set(player.x, player.z);
  }
}
