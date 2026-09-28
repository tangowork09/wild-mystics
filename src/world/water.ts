import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL } from '../data/zones';
import type { TerrainData } from './terrain';

// One water sheet for the whole world. Colour, foam and lava are resolved per-pixel from
// the baked depth (water level − terrain height) and zone-weight textures.

export class Water {
  mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(data: TerrainData) {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 1, 1).rotateX(-Math.PI / 2);
    this.uniforms = {
      uField: { value: data.fieldTex },
      uShallowTex: { value: data.shallowTex },
      uDeepTex: { value: data.deepTex },
      uHalf: { value: WORLD_SIZE / 2 },
      uTime: { value: 0 },
      uLevel: { value: WATER_LEVEL },
    };
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.06, metalness: 0.0, transparent: true, depthWrite: false, envMapIntensity: 1.3 });
    const noise = `
      float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(wh(i), wh(i+vec2(1,0)), u.x), mix(wh(i+vec2(0,1)), wh(i+vec2(1,1)), u.x), u.y); }
      float wf(vec2 p){ return wn(p)*0.5 + wn(p*2.1+3.1)*0.3 + wn(p*4.3+7.7)*0.2; }
    `;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uField; uniform sampler2D uShallowTex; uniform sampler2D uDeepTex;
          uniform float uHalf; uniform float uTime; uniform float uLevel;
          varying vec3 vWPos;
          float gDepth; float gLava; float gFoam;
          ${noise}`)
        .replace('#include <color_fragment>', `
          vec2 fuv = (vWPos.xz + uHalf) / (uHalf * 2.0);
          float terrainH = texture2D(uField, fuv).r;
          gDepth = uLevel - terrainH;
          if (gDepth < -0.05) discard;
          vec4 shA = texture2D(uShallowTex, fuv);
          vec3 sh = shA.rgb;
          vec3 dp = texture2D(uDeepTex, fuv).rgb;
          gLava = smoothstep(0.35, 0.8, shA.a);
          float dk = smoothstep(0.0, 3.5, gDepth);
          vec3 col = mix(sh, dp, dk);
          float fn = wf(vWPos.xz * 0.9 + vec2(uTime * 0.25, -uTime * 0.18));
          gFoam = (1.0 - smoothstep(0.0, 0.28 + fn * 0.25, gDepth)) * (1.0 - gLava);
          col = mix(col, vec3(0.95, 0.98, 1.0), gFoam * 0.85);
          // lava crust
          float crust = smoothstep(0.45, 0.62, wf(vWPos.xz * 0.35 + vec2(uTime * 0.03, uTime * 0.02)));
          col = mix(col, mix(vec3(0.9, 0.25, 0.05), vec3(0.08, 0.04, 0.03), crust), gLava);
          diffuseColor.rgb = col;
          diffuseColor.a = mix(mix(0.62, 0.94, dk), 1.0, max(gLava, gFoam * 0.6));
        `)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.07, 0.85, gLava);')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec2 p = vWPos.xz;
            float e = 0.15;
            vec2 s1 = vec2(uTime * 0.32, uTime * 0.21), s2 = vec2(-uTime * 0.23, uTime * 0.29);
            float h0 = wf(p * 0.55 + s1) + wf(p * 1.3 + s2) * 0.5;
            float hx = wf((p + vec2(e, 0.0)) * 0.55 + s1) + wf((p + vec2(e, 0.0)) * 1.3 + s2) * 0.5;
            float hz = wf((p + vec2(0.0, e)) * 0.55 + s1) + wf((p + vec2(0.0, e)) * 1.3 + s2) * 0.5;
            float amp = mix(0.55, 0.15, gLava);
            vec3 nW = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float crust2 = smoothstep(0.45, 0.62, wf(vWPos.xz * 0.35 + vec2(uTime * 0.03, uTime * 0.02)));
            float pulse = 0.75 + 0.25 * sin(uTime * 1.5 + vWPos.x * 0.2);
            totalEmissiveRadiance += vec3(1.0, 0.36, 0.06) * gLava * (1.0 - crust2) * 3.2 * pulse;
          }`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 2;
  }

  update(t: number) { this.uniforms.uTime.value = t; }
}
