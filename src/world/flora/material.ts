import * as THREE from 'three';
import { DITHER_GLSL, LOOK, WIND_GLSL } from './shared';

// One shader hook for every instanced vegetation material (bark, leaves, rocks, flowers, crystals…):
//  • per-instance `aVeg` = (snow, glow, wind amount, seed) + instanceColor tint
//  • wind sway that follows the same rolling gusts as the grass
//  • dithered distance fade (mesh ↔ impostor hand-over, prop draw distance) and battle clearing
//  • snow on up-facing surfaces, ember / crystal glow at night, soft back-lit leaf translucency

export type GlowMode = 'none' | 'ember' | 'tint';

export interface VegMaterialOptions {
  /** Distance band (m) over which instances dither out: [start, end]. */
  fade: THREE.Vector2;
  /** Sway amount for this material (0 = rigid). */
  sway: number;
  foliage: boolean;
  glow: GlowMode;
}

export function hookVegMaterial(mat: THREE.MeshStandardMaterial, o: VegMaterialOptions) {
  const key = `veg-${o.sway.toFixed(2)}-${o.foliage ? 1 : 0}-${o.glow}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = LOOK.uWind;
    sh.uniforms.uTime = LOOK.uTime;
    sh.uniforms.uNoise = LOOK.uNoise;
    sh.uniforms.uClear = LOOK.uClear;
    sh.uniforms.uSunDirV = LOOK.uSunDir;
    sh.uniforms.uSunColV = LOOK.uSunCol;
    sh.uniforms.uNight = LOOK.uNight;
    sh.uniforms.uFade = { value: o.fade };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${WIND_GLSL}
        uniform vec3 uClear;
        uniform vec2 uFade;
        attribute vec4 aVeg;
        varying vec4 vVeg;
        varying float vVegFade;
        varying vec3 vVegN;
        varying vec3 vVegW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float iscale = length(instanceMatrix[0].xyz);
        #else
          vec3 ip = vec3(0.0);
          float iscale = 1.0;
        #endif
        vVeg = aVeg;
        ${o.sway > 0 ? `
        {
          float hgt = max(transformed.y, 0.0) * iscale;
          float g = windGust(ip.xz);
          float ph = uTime * (1.1 + aVeg.w * 0.4) + aVeg.w * 30.0;
          float sw = (sin(ph) * 0.45 + sin(ph * 2.3 + 1.7) * 0.2) * (0.35 + g) + g * 0.8;
          float amt = ${(0.012 * o.sway).toFixed(4)} * aVeg.z * uWind.z * hgt * hgt / max(iscale, 0.2);
          transformed.xz += uWind.xy * sw * amt;
          ${o.foliage ? 'transformed += normal * sin(uTime * 3.1 + position.x * 3.0 + position.z * 2.0 + aVeg.w * 9.0) * 0.03 * (0.3 + g) * uWind.z;' : ''}
        }` : ''}
        float camD = distance(ip, cameraPosition);
        vVegFade = smoothstep(uFade.x, uFade.y, camD);
        bool gone = camD > uFade.y + 1.0 || (uClear.z > 0.0 && distance(ip.xz, uClear.xy) < uClear.z);
        if (gone) transformed *= 0.0;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          #ifdef USE_INSTANCING
            mat3 im = mat3(modelMatrix) * mat3(instanceMatrix);
            vVegW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            mat3 im = mat3(modelMatrix);
            vVegW = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif
          vVegN = normalize(im * objectNormal);
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${DITHER_GLSL}
        uniform vec3 uSunDirV;
        uniform vec3 uSunColV;
        uniform float uNight;
        uniform sampler2D uNoise;
        varying vec4 vVeg;
        varying float vVegFade;
        varying vec3 vVegN;
        varying vec3 vVegW;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vVegFade > 0.0 && vVegFade >= bayer4(gl_FragCoord.xy)) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // snow settles on surfaces that face the sky
          float snow = vVeg.x * smoothstep(0.15, 0.6, normalize(vVegN).y + (texture2D(uNoise, vVegW.xz * 0.35).r - 0.5) * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), clamp(snow, 0.0, 1.0));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${o.glow === 'ember' ? `
        {
          float n = texture2D(uNoise, vVegW.xz * 0.21 + vVegW.y * 0.13).r;
          float crack = smoothstep(0.6, 0.78, n);
          float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + n * 12.0);
          totalEmissiveRadiance += vec3(1.0, 0.33, 0.06) * crack * vVeg.y * pulse * (0.6 + 2.2 * uNight);
        }` : ''}
        ${o.glow === 'tint' ? `
        totalEmissiveRadiance += diffuseColor.rgb * vVeg.y * (0.25 + 1.6 * uNight);` : ''}
        ${o.foliage ? `
        {
          // light through the leaves when the sun is behind them
          vec3 vd = normalize(cameraPosition - vVegW);
          float back = pow(max(dot(-vd, uSunDirV), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunColV * back * 0.12;
        }` : ''}`);
  };
  mat.needsUpdate = true;
  return mat;
}

/** Shadow-caster twin of a hooked material: same sway, clearing and alpha-tested leaves. */
export function vegDepthMaterial(src: THREE.MeshStandardMaterial, o: VegMaterialOptions) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: src.map, alphaTest: src.alphaTest, side: src.side });
  const key = `vegd-${o.sway.toFixed(2)}-${src.alphaTest > 0 ? 1 : 0}`;
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = LOOK.uWind;
    sh.uniforms.uTime = LOOK.uTime;
    sh.uniforms.uNoise = LOOK.uNoise;
    sh.uniforms.uClear = LOOK.uClear;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${WIND_GLSL}
        uniform vec3 uClear;
        attribute vec4 aVeg;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float iscale = length(instanceMatrix[0].xyz);
        #else
          vec3 ip = vec3(0.0);
          float iscale = 1.0;
        #endif
        ${o.sway > 0 ? `
        {
          float hgt = max(transformed.y, 0.0) * iscale;
          float g = windGust(ip.xz);
          float ph = uTime * (1.1 + aVeg.w * 0.4) + aVeg.w * 30.0;
          float sw = (sin(ph) * 0.45 + sin(ph * 2.3 + 1.7) * 0.2) * (0.35 + g) + g * 0.8;
          transformed.xz += uWind.xy * sw * ${(0.012 * o.sway).toFixed(4)} * aVeg.z * uWind.z * hgt * hgt / max(iscale, 0.2);
        }` : ''}
        if (uClear.z > 0.0 && distance(ip.xz, uClear.xy) < uClear.z) transformed *= 0.0;`);
  };
  return m;
}
