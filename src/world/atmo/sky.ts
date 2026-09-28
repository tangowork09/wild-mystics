import * as THREE from 'three';
import { FOG_GLSL, FOG_PARAMS } from './fog';
import { noiseTexture } from './noise';
import type { SkyState } from './palette';

// Painted sky dome: zenith→horizon gradient that meets the fog's haze colour exactly at the horizon,
// sun disc + glow, moon, twinkling stars, a faint Milky Way, aurora curtains, and an animated layer of
// soft, sun-lit fbm clouds (plus a band of cumulus sitting on the horizon on higher tiers).
// It follows the camera and is drawn first with depth test off, so it never clips.

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w * 0.99999;
  }
`;

const FRAG = /* glsl */ `
  #define CLOUD_Q __CQ__
  uniform vec4 wmFog[6];
  uniform vec3 uZenith, uHorizon, uGround, uSunDir, uMoonDir, uDisc, uSunGlow, uMoonCol;
  uniform vec3 uCloudLit, uCloudShade;
  uniform float uGlow, uGlowPow, uNight, uStars, uAurora, uTime, uCloud, uEnv, uMilky;
  uniform vec2 uCloudOff;
  uniform sampler2D uNoise;
  varying vec3 vDir;
  ${FOG_GLSL}

  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }

  float cloudDensity(vec2 uv) {
    float n = texture2D(uNoise, uv).r * 0.52;
    n += texture2D(uNoise, uv * 2.07 + 0.31).g * 0.26;
    #if CLOUD_Q > 1
      n += texture2D(uNoise, uv * 4.3 + 0.67).r * 0.12;
    #endif
    float w = texture2D(uNoise, uv * 0.61 + 0.17).b;
    return n * 0.8 + w * 0.42;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float y = dir.y;
    float h = max(y, 0.0);
    float sd = max(dot(dir, uSunDir), 0.0);

    // gradient: horizon band widens near the ground, zenith deepens overhead
    vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, h), 0.55));
    vec3 haze = wmHaze(dir);
    sky = mix(haze, sky, smoothstep(0.0, 0.2, h));
    // below the horizon: haze fading into the ground tone (the world edge is never seen as a line)
    sky = y < 0.0 ? mix(haze, uGround, smoothstep(0.0, -0.35, y)) : sky;

    // sun glow (warm scatter around the disc; wide at dawn/dusk)
    float glow = pow(sd, uGlowPow) * uGlow + pow(sd, 48.0) * 0.55 * uGlow;
    sky += uSunGlow * glow * smoothstep(-0.25, 0.05, y);

    float vis = smoothstep(-0.02, 0.03, y); // everything celestial sits above the horizon

    // night sky
    if (uStars > 0.001) {
      vec3 sp = dir * 260.0;
      vec3 id = floor(sp);
      float hs = hash13(id);
      float star = 0.0;
      if (hs > 0.975) {
        vec3 off = hash33(id) - 0.5;
        float r = length(fract(sp) - 0.5 - off * 0.55);
        float tw = 0.55 + 0.45 * sin(uTime * (1.3 + hs * 5.0) + hs * 91.0);
        star = smoothstep(0.34, 0.0, r) * tw * (hs - 0.975) * 40.0;
      }
      // Milky Way: a tilted band with dust lanes
      vec3 mwN = normalize(vec3(0.42, 0.62, -0.66));
      float band = dot(dir, mwN);
      vec3 b1 = normalize(cross(mwN, vec3(0.0, 1.0, 0.0)));
      vec3 b2 = cross(mwN, b1);
      vec2 muv = vec2(atan(dot(dir, b1), dot(dir, b2)) * 0.6, band * 2.2);
      float dust = texture2D(uNoise, muv * vec2(1.0, 1.6) + 0.13).r;
      float lane = texture2D(uNoise, muv * 2.5 + 0.61).g;
      float mw = exp(-band * band * 26.0) * (0.35 + dust * 0.9) * (0.55 + 0.45 * smoothstep(0.35, 0.7, lane));
      star *= 1.0 + mw * 2.5;
      vec3 night = vec3(0.75, 0.85, 1.0) * star * 2.4 + vec3(0.32, 0.30, 0.55) * mw * 0.16 * uMilky;
      sky += night * uStars * vis * (1.0 - uEnv * 0.8);
    }

    // moon
    float md = dot(dir, uMoonDir);
    float mr = 0.0165;
    float moonDisk = smoothstep(cos(mr), cos(mr * 0.86), md);
    if (moonDisk > 0.0) {
      vec3 mright = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 mup = cross(mright, uMoonDir);
      vec2 mp = vec2(dot(dir, mright), dot(dir, mup)) / mr;
      float maria = texture2D(uNoise, mp * 0.18 + 0.4).r;
      float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
      sky = mix(sky, sky * 0.6 + uMoonCol * (0.55 + 0.45 * limb) * (0.72 + 0.4 * maria) * mix(0.9, 5.0, uNight), moonDisk * vis * mix(0.35, 1.0, uNight));
    }
    sky += uMoonCol * (pow(max(md, 0.0), 900.0) * 0.8 + pow(max(md, 0.0), 30.0) * 0.06) * uNight * vis;

    // aurora (Peaks, Hollows, Crown at night): curtains of light rippling along the northern sky
    #if CLOUD_Q > 0
    if (uAurora > 0.01 && y > 0.0) {
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float layer = 1.0 + fi * 0.16;
        vec2 p = dir.xz / (y + 0.05) * layer;
        float n = texture2D(uNoise, vec2(p.x * 0.05 + uTime * 0.004, p.y * 0.02 + fi * 0.07)).r;
        float wave = sin(p.x * 0.9 + n * 7.0 + uTime * 0.12 + fi * 0.4);
        float curtain = smoothstep(0.55, 1.0, wave) * smoothstep(-2.4, -0.4, p.y) * smoothstep(1.6, -0.2, p.y);
        float streak = texture2D(uNoise, vec2(p.x * 0.35 + fi * 0.1, uTime * 0.01)).a;
        vec3 c = mix(vec3(0.1, 1.0, 0.55), vec3(0.55, 0.3, 1.0), fi / 6.0);
        acc += c * curtain * (0.35 + streak * 0.8) * (1.0 - fi / 7.0);
      }
      float el = smoothstep(0.02, 0.2, y) * smoothstep(0.85, 0.3, y);
      sky += acc * el * uAurora * 0.22 * (1.0 - uEnv * 0.5);
    }
    #endif

    // clouds: a sun-lit fbm layer on a virtual plane overhead
    #if CLOUD_Q > 0
    if (y > 0.0 && uCloud > 0.01) {
      vec2 p = dir.xz / (y + 0.06);
      vec2 uv = p * 0.33 + uCloudOff;
      float base = cloudDensity(uv);
      float thr = mix(0.98, 0.42, uCloud);
      float dens = smoothstep(thr, thr + 0.2, base);
      if (dens > 0.0) {
        vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.045;
        float ahead = cloudDensity(uv + toSun);
        float lit = clamp(0.6 + (base - ahead) * 5.5, 0.0, 1.0);
        float thick = smoothstep(thr, thr + 0.5, base);
        vec3 cc = mix(uCloudLit, uCloudShade, clamp(thick * 0.55 + (1.0 - lit) * 0.6, 0.0, 1.0));
        cc += uSunGlow * pow(sd, 8.0) * (1.0 - thick) * 1.6 * uGlow;
        // distant clouds sink into the haze (aerial perspective in the sky too)
        cc = mix(cc, haze, (1.0 - smoothstep(0.0, 0.32, y)) * 0.65);
        float a = dens * smoothstep(0.0, 0.1, y) * 0.96;
        sky = mix(sky, cc, a);
      }
    }
    #endif
    #if CLOUD_Q > 1
    // cumulus band resting on the horizon
    if (y > -0.02 && y < 0.3 && uCloud > 0.01) {
      float az = atan(dir.z, dir.x) / 6.2831853;
      vec2 hp = vec2(az * 6.0 + uCloudOff.x * 0.05, y * 5.5);
      float n = textureLod(uNoise, hp * vec2(1.0, 0.8) + vec2(0.0, 0.31), 0.0).b * 0.65 + textureLod(uNoise, hp * 2.1, 0.0).r * 0.45;
      float top = n * mix(0.1, 0.24, uCloud) - y;
      float dens = smoothstep(0.0, 0.035, top) * smoothstep(-0.02, 0.02, y);
      if (dens > 0.0) {
        float facing = pow(max(dot(normalize(dir.xz), normalize(uSunDir.xz + vec2(1e-4))), 0.0), 2.0);
        vec3 cc = mix(uCloudShade, uCloudLit, clamp(0.35 + top * 6.0 + facing * 0.3, 0.0, 1.0));
        cc = mix(cc, haze, 0.55);
        sky = mix(sky, cc, dens * 0.9 * smoothstep(0.1, 0.35, uCloud + 0.15));
      }
    }
    #endif

    // sun disc last, over thin cloud
    float disc = smoothstep(0.99994, 0.99998, sd);
    sky += uDisc * disc * vis * mix(1.0, 0.08, uEnv);

    gl_FragColor = vec4(max(sky, 0.0), 1.0);
  }
`;

export class SkyDome {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  u: Record<string, THREE.IUniform>;

  constructor(quality: 0 | 1 | 2) {
    this.u = {
      wmFog: { value: FOG_PARAMS },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uDisc: { value: new THREE.Color() }, uSunGlow: { value: new THREE.Color() }, uMoonCol: { value: new THREE.Color('#dfe6ff') },
      uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
      uGlow: { value: 1 }, uGlowPow: { value: 5 }, uNight: { value: 0 }, uStars: { value: 0 }, uAurora: { value: 0 }, uTime: { value: 0 },
      uCloud: { value: 0.4 }, uEnv: { value: 0 }, uMilky: { value: 1 },
      uCloudOff: { value: new THREE.Vector2() },
      uNoise: { value: noiseTexture() },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: VERT,
      fragmentShader: FRAG.replace('__CQ__', String(quality)),
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
    this.mesh.onBeforeRender = (_r, _s, cam) => { this.mesh.position.copy(cam.position); this.mesh.updateMatrixWorld(); };
  }

  update(s: SkyState, sunDir: THREE.Vector3, moonDir: THREE.Vector3, night: number, t: number, cloudOff: THREE.Vector2) {
    const u = this.u;
    (u.uZenith.value as THREE.Color).copy(s.zenith);
    (u.uHorizon.value as THREE.Color).copy(s.horizon);
    (u.uGround.value as THREE.Color).copy(s.ground);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(moonDir);
    (u.uDisc.value as THREE.Color).copy(s.disc);
    (u.uSunGlow.value as THREE.Color).copy(s.hazeSun);
    (u.uCloudLit.value as THREE.Color).copy(s.cloudLit);
    (u.uCloudShade.value as THREE.Color).copy(s.cloudShade);
    u.uGlow.value = s.glow;
    u.uGlowPow.value = s.glowPow;
    u.uNight.value = night;
    u.uStars.value = s.stars;
    u.uAurora.value = s.aurora;
    u.uTime.value = t;
    u.uCloud.value = s.cloudCover;
    (u.uCloudOff.value as THREE.Vector2).copy(cloudOff);
  }
}
