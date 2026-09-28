import * as THREE from 'three';
import { noiseTexture } from '../atmo/noise';

// Uniforms shared by every vegetation shader (grass, props, impostors, weather). Atmosphere writes them
// once per frame; materials reference the same objects, so nothing has to be pushed per material.

export const LOOK = {
  uTime: { value: 0 },
  /** Key light (sun by day, moon by night): direction toward the light, colour × intensity (linear). */
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.4).normalize() },
  uSunCol: { value: new THREE.Color(3, 2.9, 2.7) },
  /** Hemisphere ambient (sky / ground) × intensity, and an estimate of the env-map diffuse term. */
  uAmbTop: { value: new THREE.Color(0.5, 0.6, 0.8) },
  uAmbBottom: { value: new THREE.Color(0.3, 0.25, 0.2) },
  uEnvAmb: { value: new THREE.Color(0.2, 0.25, 0.35) },
  uNight: { value: 0 },
  /** Wind: xy = direction, z = strength, w = gust scroll. */
  uWind: { value: new THREE.Vector4(0.94, 0.34, 0.5, 0) },
  uNoise: { value: noiseTexture() },
  /** Battle clearing: xy = centre, z = radius (0 = off). */
  uClear: { value: new THREE.Vector3(0, 0, 0) },
  /** Player position (xz) for bending grass / foliage. */
  uPlayer: { value: new THREE.Vector3() },
};

/** GLSL helpers for wind that match between grass, props and impostors. */
export const WIND_GLSL = /* glsl */ `
  uniform vec4 uWind;
  uniform float uTime;
  uniform sampler2D uNoise;
  // rolling gusts: a large noise field scrolling downwind, 0..1
  float windGust(vec2 xz) {
    vec2 uv = xz * 0.0065 - uWind.xy * uWind.w;
    return textureLod(uNoise, uv, 0.0).r * 0.75 + textureLod(uNoise, uv * 2.7 + 0.3, 0.0).g * 0.35;
  }
`;

/** Ordered 4x4 Bayer threshold (0..1) for dithered LOD fades. */
export const DITHER_GLSL = /* glsl */ `
  float bayer4(vec2 p) {
    ivec2 i = ivec2(mod(p, 4.0));
    int idx = i.x + i.y * 4;
    float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return (m[idx] + 0.5) / 16.0;
  }
`;
