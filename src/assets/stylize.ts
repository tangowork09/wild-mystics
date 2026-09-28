import * as THREE from 'three';
import { ELEMENTS, type Element } from '../data/elements';

// ─────────────────────────────────────────────────────────────────────────────
// Wild Mystics v3 creature look (creatures workstream).
//
// Every creature, the player and every NPC share one stylised material:
//   • a soft three-band toon ramp + a tight stylised highlight,
//   • a key-light rim and an element-tinted fresnel,
//   • procedural emissive details for fire / storm / void (and glowing parts: eyes, lures),
//   • shiny: iridescent hue shift + surface glitter,
//   • hit flash, dissolve (KO / capture) and a dithered fade (spawn / despawn), all per rig,
// plus a cheap inverted-hull outline whose width follows camera distance.
//
// GLB packs arrive with 3–10 flat materials per creature (one draw call each). `prepareModel` bakes
// them into vertex colours (palette normalised across packs) and merges every primitive that shares a
// skeleton into ONE skinned mesh, so a creature costs one draw call + one outline + one shadow.
// ─────────────────────────────────────────────────────────────────────────────

/** Uniforms shared by every stylised material (updated once per frame from the key light + camera). */
export const LOOK = {
  uTime: { value: 0 },
  /** View-space direction towards the key light (rim side). */
  uRimDir: { value: new THREE.Vector3(0.5, 0.6, 0.3) },
  uRimColor: { value: new THREE.Color(1, 0.95, 0.85) },
  /** Global rim multiplier — battles raise it for a stage-lit look. */
  uRimBoost: { value: 1 },
  /** Ambient (hemisphere) multiplier: keeps the shadow side of the toon ramp readable. */
  uAmbient: { value: 1.35 },
  /** Outline width per metre of camera distance (≈ constant screen width), clamped. */
  uOutlineK: { value: 0.0021 },
  uOutlineMin: { value: 0.012 },
  uOutlineMax: { value: 0.11 },
  uOutlineFar: { value: 52 },
};

/** Set by the battle stage to force a rim direction (view space); null = follow the scene's key light. */
export const rimOverride: { dir: THREE.Vector3 | null; color: THREE.Color | null } = { dir: null, color: null };

export interface RigUniforms {
  uElem: { value: THREE.Color };
  uElemAmt: { value: number };
  uRimAmt: { value: number };
  uGlowColor: { value: THREE.Color };
  /** 0 none · 1 fire embers · 2 storm crackle · 3 void pulse · 4 soft breathing glow */
  uGlowMode: { value: number };
  uGlowAmt: { value: number };
  /** Emissive strength of baked glow parts (eyes, lures, crystals). */
  uPartGlow: { value: number };
  uTintHSL: { value: THREE.Vector3 };
  uTintAmt: { value: number };
  uHueShift: { value: number };
  uShiny: { value: number };
  uFlash: { value: number };
  uFlashColor: { value: THREE.Color };
  uDissolve: { value: number };
  uDissolveColor: { value: THREE.Color };
  uFade: { value: number };
  uGloss: { value: number };
  uOutlineDark: { value: number };
}

export function makeRigUniforms(): RigUniforms {
  return {
    uElem: { value: new THREE.Color(0, 0, 0) },
    uElemAmt: { value: 0 },
    uRimAmt: { value: 0.9 },
    uGlowColor: { value: new THREE.Color(0, 0, 0) },
    uGlowMode: { value: 0 },
    uGlowAmt: { value: 1 },
    uPartGlow: { value: 1.6 },
    uTintHSL: { value: new THREE.Vector3() },
    uTintAmt: { value: 0 },
    uHueShift: { value: 0 },
    uShiny: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uDissolve: { value: 0 },
    uDissolveColor: { value: new THREE.Color(1, 0.9, 0.6) },
    uFade: { value: 1 },
    uGloss: { value: 0.45 },
    uOutlineDark: { value: 0.2 },
  };
}

// ── GLSL ─────────────────────────────────────────────────────────────────────
const GLSL_COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uTintHSL;
uniform float uTintAmt;
uniform float uHueShift;
vec3 wmRgb2Hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  if (mx - mn < 1e-5) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
float wmHue(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 wmHsl2Rgb(vec3 hsl) {
  if (hsl.y <= 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(wmHue(p, q, hsl.x + 1.0 / 3.0), wmHue(p, q, hsl.x), wmHue(p, q, hsl.x - 1.0 / 3.0));
}
// Regional tint (pulls saturated body colours to a hue, keeps eyes/teeth) and the shiny hue shift.
// Linear-space HSL, matching the v2 CPU recolour so existing variant tints read the same.
vec3 wmStyle(vec3 c) {
  if (uTintAmt < 0.5 && abs(uHueShift) < 0.001) return c;
  vec3 hsl = wmRgb2Hsl(c);
  if (uTintAmt > 0.5 && hsl.y > 0.12 && hsl.z > 0.08 && hsl.z < 0.92) {
    hsl = vec3(uTintHSL.x, min(1.0, (hsl.y + uTintHSL.y) * 0.5 + 0.05), hsl.z * 0.85 + uTintHSL.z * 0.15);
  }
  if (abs(uHueShift) > 0.001 && hsl.y > 0.08) { hsl.x = fract(hsl.x + uHueShift); hsl.y = min(1.0, hsl.y + 0.1); hsl.z = min(1.0, hsl.z * 1.06 + 0.01); }
  return wmHsl2Rgb(hsl);
}
float wmHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float wmNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = wmHash(i), b = wmHash(i + vec3(1, 0, 0)), c = wmHash(i + vec3(0, 1, 0)), d = wmHash(i + vec3(1, 1, 0));
  float e = wmHash(i + vec3(0, 0, 1)), g = wmHash(i + vec3(1, 0, 1)), h = wmHash(i + vec3(0, 1, 1)), k = wmHash(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float wmIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const TOON_LIGHTS = /* glsl */`
varying vec3 vViewPosition;
uniform float uGloss;
struct ToonMaterial { vec3 diffuseColor; };
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float NdL = dot( geometryNormal, directLight.direction );
  // soft three-band ramp: core shadow · half tone · lit
  float ramp = smoothstep( -0.06, 0.12, NdL ) * 0.58 + smoothstep( 0.34, 0.56, NdL ) * 0.42;
  reflectedLight.directDiffuse += ramp * directLight.color * BRDF_Lambert( material.diffuseColor );
  vec3 H = normalize( directLight.direction + geometryViewDir );
  float sp = smoothstep( 0.988, 0.997, dot( geometryNormal, H ) ) * step( 0.25, NdL );
  reflectedLight.directSpecular += sp * uGloss * 0.12 * directLight.color;
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  // painterly shadows: the unlit side leans cool
  reflectedLight.indirectDiffuse += irradiance * vec3( 0.9, 0.93, 1.08 ) * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

const FRAG_PARS = /* glsl */`
uniform vec3 uRimDir;
uniform vec3 uRimColor;
uniform float uRimBoost;
uniform float uRimAmt;
uniform float uAmbient;
uniform vec3 uElem;
uniform float uElemAmt;
uniform vec3 uGlowColor;
uniform float uGlowMode;
uniform float uGlowAmt;
uniform float uPartGlow;
uniform float uShiny;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uFade;
varying vec3 vObjPos;
varying float vGlow;
vec3 wmGlow(vec3 p, float fres) {
  if (uGlowMode < 0.5) return vec3(0.0);
  if (uGlowMode < 1.5) { // fire: embers drifting up through the body
    float n = wmNoise(p * 3.2 + vec3(0.0, -uTime * 0.9, uTime * 0.2));
    float g = smoothstep(0.64, 0.9, n) * (0.65 + 0.35 * sin(uTime * 7.0 + p.x * 9.0));
    return uGlowColor * g * 1.7;
  }
  if (uGlowMode < 2.5) { // storm: crawling filaments that flicker on and off
    float n = wmNoise(p * 4.2 + uTime * vec3(1.3, 0.5, 0.9));
    float line = 1.0 - smoothstep(0.0, 0.035, abs(n - 0.5));
    float fl = step(0.42, fract(sin(floor(uTime * 8.0) * 12.9898) * 43758.5453));
    return uGlowColor * line * fl * 2.4;
  }
  if (uGlowMode < 3.5) { // void: slow breathing blotches
    float n = wmNoise(p * 2.3 + vec3(0.0, uTime * 0.25, 0.0));
    float g = smoothstep(0.56, 0.8, n) * (0.55 + 0.45 * sin(uTime * 1.7 + p.y * 3.0));
    return uGlowColor * g * 1.5 + uGlowColor * pow(fres, 3.0) * 0.4;
  }
  return uGlowColor * (0.1 + 0.05 * sin(uTime * 2.0));
}
`;

const FRAG_TAIL = /* glsl */`
vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse * uAmbient + reflectedLight.directSpecular + totalEmissiveRadiance;
{
  vec3 wmV = normalize( vViewPosition );
  float wmNdV = saturate( dot( normal, wmV ) );
  float wmFres = 1.0 - wmNdV;
  vec2 wmRd = uRimDir.xy;
  float wmSide = dot( wmRd, wmRd ) > 0.0004 ? saturate( dot( normalize( normal.xy + vec2( 1e-4 ) ), normalize( wmRd ) ) * 0.5 + 0.5 ) : 0.7;
  float wmRim = smoothstep( 0.6, 0.93, wmFres ) * mix( 0.2, 1.0, wmSide * wmSide );
  outgoingLight += uRimColor * wmRim * uRimAmt * uRimBoost;
  outgoingLight += uElem * pow( wmFres, 2.6 ) * uElemAmt;
  outgoingLight += diffuseColor.rgb * vGlow * uPartGlow;
  outgoingLight += wmGlow( vObjPos, wmFres ) * uGlowAmt;
  if ( uShiny > 0.5 ) {
    float hue = fract( wmFres * 0.9 + vObjPos.y * 0.35 + uTime * 0.07 );
    vec3 irid = clamp( abs( mod( hue * 6.0 + vec3( 0.0, 4.0, 2.0 ), 6.0 ) - 3.0 ) - 1.0, 0.0, 1.0 );
    outgoingLight += irid * ( 0.06 + 0.5 * pow( wmFres, 2.0 ) );
    vec3 cell = floor( vObjPos * 34.0 );
    float r = wmHash( cell );
    float tw = 0.5 + 0.5 * sin( uTime * 5.0 + r * 40.0 );
    outgoingLight += vec3( 1.0, 0.97, 0.92 ) * step( 0.972, r ) * pow( tw, 8.0 ) * 3.5;
  }
  if ( uDissolve > 0.001 ) {
    float wmD = wmNoise( vObjPos * 5.0 ) - uDissolve;
    outgoingLight += uDissolveColor * ( 1.0 - smoothstep( 0.0, 0.09, wmD ) ) * 4.0;
  }
  outgoingLight = mix( outgoingLight, uFlashColor, uFlash );
}
`;

const FRAG_DISCARD = /* glsl */`
if ( uFade < 0.999 && wmIGN( gl_FragCoord.xy ) >= uFade ) discard;
if ( uDissolve > 0.001 && wmNoise( vObjPos * 5.0 ) < uDissolve ) discard;
`;

function patchToon(sh: THREE.WebGLProgramParametersWithUniforms, U: RigUniforms) {
  Object.assign(sh.uniforms, LOOK, U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\nattribute vec4 aSmooth;\nvarying vec3 vObjPos;\nvarying float vGlow;\n${GLSL_COMMON}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvGlow = max( aSmooth.w, 0.0 );')
    .replace('#include <color_vertex>', '#include <color_vertex>\n#if defined( USE_COLOR ) && !defined( USE_MAP )\nvColor.rgb = wmStyle( vColor.rgb );\n#endif');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${FRAG_PARS}`)
    .replace('#include <lights_toon_pars_fragment>', TOON_LIGHTS)
    .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_DISCARD}`)
    .replace('#include <color_fragment>', '#include <color_fragment>\n#if defined( USE_MAP ) || !defined( USE_COLOR )\ndiffuseColor.rgb = wmStyle( diffuseColor.rgb );\n#endif')
    .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', FRAG_TAIL);
}

/** One stylised material for a rig part; `U` is shared by every material of the same rig. */
export function toonMaterial(U: RigUniforms, o: { map?: THREE.Texture | null; vertexColors?: boolean; color?: THREE.ColorRepresentation; side?: THREE.Side } = {}) {
  const m = new THREE.MeshToonMaterial({ color: o.color ?? '#ffffff', map: o.map ?? null, vertexColors: !!o.vertexColors, side: o.side ?? THREE.FrontSide });
  m.onBeforeCompile = (sh) => patchToon(sh, U);
  m.customProgramCacheKey = () => 'wm-toon-3';
  m.userData.wmToon = true;
  return m;
}

// ── Outline (inverted hull) ─────────────────────────────────────────────────
const OUTLINE_VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
attribute vec4 aSmooth;
uniform float uOutlineK;
uniform float uOutlineMin;
uniform float uOutlineMax;
uniform float uOutlineFar;
uniform float uOutlineDark;
uniform vec3 uInk;
varying vec3 vCol;
varying vec3 vObjPos;
${GLSL_COMMON}
void main() {
  vec3 objectNormal = aSmooth.xyz;
  if ( dot( objectNormal, objectNormal ) < 0.01 ) objectNormal = normal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = vec3( position );
  vObjPos = position;
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
  vec3 n = normalize( normalMatrix * objectNormal );
  float dist = -mvPosition.z;
  float w = clamp( dist * uOutlineK, uOutlineMin, uOutlineMax ) * ( 1.0 - smoothstep( uOutlineFar * 0.7, uOutlineFar, dist ) );
  mvPosition.xyz += n * w;
  mvPosition.z -= w * 0.6;
  gl_Position = projectionMatrix * mvPosition;
  #ifdef USE_COLOR
    vCol = mix( uInk, wmStyle( color.rgb ) * uOutlineDark, 0.55 );
  #else
    vCol = uInk;
  #endif
  #include <fog_vertex>
}
`;
const OUTLINE_FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform float uFade;
uniform float uDissolve;
varying vec3 vCol;
varying vec3 vObjPos;
${GLSL_COMMON}
void main() {
  if ( uFade < 0.999 && wmIGN( gl_FragCoord.xy ) >= uFade ) discard;
  if ( uDissolve > 0.001 && wmNoise( vObjPos * 5.0 ) < uDissolve + 0.03 ) discard;
  gl_FragColor = vec4( vCol, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function outlineMaterial(U: RigUniforms, ink: THREE.Color, vertexColors: boolean) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...LOOK, uTintHSL: U.uTintHSL, uTintAmt: U.uTintAmt, uHueShift: U.uHueShift, uFade: U.uFade, uDissolve: U.uDissolve, uOutlineDark: U.uOutlineDark, uInk: { value: ink } },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
    fog: true,
    vertexColors,
  });
  m.userData.wmOutline = true;
  return m;
}

// ── Geometry preparation ────────────────────────────────────────────────────
/** Smooth (position-welded) normals for the hull, packed with the glow mask: aSmooth = (nx, ny, nz, glow). */
function addSmooth(g: THREE.BufferGeometry, glow?: Float32Array) {
  if (g.getAttribute('aSmooth')) return;
  const pos = g.getAttribute('position');
  let nrm = g.getAttribute('normal');
  if (!nrm) { g.computeVertexNormals(); nrm = g.getAttribute('normal'); }
  const n = pos.count;
  const key = new Map<string, number>();
  const acc: number[] = [];
  const slot = new Int32Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const q = 2000 / Math.max(1e-6, maxX - minX, maxY - minY, maxZ - minZ);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
    let s = key.get(k);
    if (s === undefined) { s = acc.length / 3; key.set(k, s); acc.push(0, 0, 0); }
    slot[i] = s;
    acc[s * 3] += nrm.getX(i); acc[s * 3 + 1] += nrm.getY(i); acc[s * 3 + 2] += nrm.getZ(i);
  }
  const out = new THREE.BufferAttribute(new Int8Array(n * 4), 4, true);
  for (let i = 0; i < n; i++) {
    const s = slot[i];
    let x = acc[s * 3], y = acc[s * 3 + 1], z = acc[s * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    out.setXYZW(i, x, y, z, glow ? glow[i] : 0);
  }
  g.setAttribute('aSmooth', out);
}

/** Material palette normalisation across packs (sRGB HSL): lift muddy darks, tame neon, add a little life. */
const _hsl = { h: 0, s: 0, l: 0 };
export function normalizeColor(c: THREE.Color) {
  c.getHSL(_hsl, THREE.SRGBColorSpace);
  let { s, l } = _hsl;
  if (l < 0.045 || (l > 0.93 && s < 0.15)) return c; // pupils, eye whites, teeth
  s = s < 0.55 ? Math.min(1, s * 1.14 + 0.04) : 0.55 + (s - 0.55) * 0.82;
  l = 0.07 + l * 0.9;
  if (l > 0.86) l = 0.86 + (l - 0.86) * 0.5;
  c.setHSL(_hsl.h, s, l, THREE.SRGBColorSpace);
  return c;
}

const GLOW_NAME = /^(glow|light|eye|lightgreen|emission|emissive|lava|crystal_glow)$|anglerfish_light/i;

function matColor(m: THREE.Material): { color: THREE.Color; glow: number; map: THREE.Texture | null } {
  const sm = m as THREE.MeshStandardMaterial;
  const color = sm.color ? sm.color.clone() : new THREE.Color(1, 1, 1);
  let glow = 0;
  if (sm.emissive && sm.emissive.r + sm.emissive.g + sm.emissive.b > 0.02 && (sm.emissiveIntensity ?? 1) > 0) {
    glow = 1;
    if (color.r + color.g + color.b < 0.05) color.copy(sm.emissive);
  }
  if (GLOW_NAME.test(m.name) && color.r + color.g + color.b > 0.12) glow = 1;
  return { color, glow, map: sm.map ?? null };
}

interface Part { mesh: THREE.Mesh; mat: THREE.Material; }

function sameSkeleton(a: THREE.SkinnedMesh, b: THREE.SkinnedMesh) {
  if (a.skeleton === b.skeleton) return a.bindMatrix.equals(b.bindMatrix);
  const A = a.skeleton, B = b.skeleton;
  if (A.bones.length !== B.bones.length) return false;
  for (let i = 0; i < A.bones.length; i++) {
    if (A.bones[i] !== B.bones[i]) return false;
    if (!A.boneInverses[i].equals(B.boneInverses[i])) return false;
  }
  return a.bindMatrix.equals(b.bindMatrix);
}

/** Merge parts that share skeleton + texture + side into one geometry with baked, normalised vertex colours. */
function mergeParts(parts: Part[], normalize: boolean, textured: boolean): { geo: THREE.BufferGeometry; glowCount: number } {
  let vCount = 0, iCount = 0;
  const skinned = (parts[0].mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
  for (const p of parts) {
    const g = p.mesh.geometry;
    vCount += g.getAttribute('position').count;
    iCount += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const pos = new THREE.BufferAttribute(new Float32Array(vCount * 3), 3);
  const nrm = new THREE.BufferAttribute(new Float32Array(vCount * 3), 3);
  const col = new THREE.BufferAttribute(new Uint16Array(vCount * 3), 3, true);
  const uv = textured ? new THREE.BufferAttribute(new Float32Array(vCount * 2), 2) : null;
  const si = skinned ? new THREE.BufferAttribute(new Uint16Array(vCount * 4), 4) : null;
  const sw = skinned ? new THREE.BufferAttribute(new Float32Array(vCount * 4), 4) : null;
  const glow = new Float32Array(vCount);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0, glowCount = 0;
  const tmp = new THREE.Color();
  for (const p of parts) {
    const g = p.mesh.geometry;
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), C = g.getAttribute('color'), T = g.getAttribute('uv');
    const SI = g.getAttribute('skinIndex'), SW = g.getAttribute('skinWeight');
    const { color, glow: gl, map } = matColor(p.mat);
    const base = color.clone();
    if (normalize && !map && !gl) normalizeColor(base);
    if (gl) glowCount += P.count;
    for (let i = 0; i < P.count; i++) {
      const o = vo + i;
      pos.setXYZ(o, P.getX(i), P.getY(i), P.getZ(i));
      if (N) nrm.setXYZ(o, N.getX(i), N.getY(i), N.getZ(i));
      tmp.copy(base);
      if (C) tmp.multiply(new THREE.Color(C.getX(i), C.getY(i), C.getZ(i)));
      if (map) tmp.setRGB(1, 1, 1);
      col.setXYZ(o, Math.min(1, tmp.r), Math.min(1, tmp.g), Math.min(1, tmp.b));
      if (uv) { if (T) uv.setXY(o, T.getX(i), T.getY(i)); else uv.setXY(o, 0, 0); }
      if (si && sw && SI && SW) { si.setXYZW(o, SI.getX(i), SI.getY(i), SI.getZ(i), SI.getW(i)); sw.setXYZW(o, SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)); }
      glow[o] = gl;
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[io + k] = g.index.getX(k) + vo;
    else for (let k = 0; k < P.count; k++) idx[io + k] = vo + k;
    vo += P.count;
    io += g.index ? g.index.count : P.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', pos);
  geo.setAttribute('normal', nrm);
  geo.setAttribute('color', col);
  if (uv) geo.setAttribute('uv', uv);
  if (si && sw) { geo.setAttribute('skinIndex', si); geo.setAttribute('skinWeight', sw); }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  addSmooth(geo, glow);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geo, glowCount };
}

export interface PreparedInfo {
  /** Meshes after merging (one per skeleton/texture/side group). */
  meshes: number;
  textured: boolean;
  glow: boolean;
  gloss: number;
}

/**
 * One-time conversion of a loaded GLB scene (mutates it). Every later SkeletonUtils.clone() of the
 * scene shares the merged geometry, so clones are cheap.
 */
export function prepareModel(scene: THREE.Object3D, opts: { normalize?: boolean } = {}): PreparedInfo {
  const normalize = opts.normalize ?? true;
  const meshes: THREE.Mesh[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.wmPrepared) meshes.push(m); });
  let rough = 0, roughN = 0, anyTex = false, anyGlow = false;
  // groups: skinned by skeleton equivalence + map + side; rigid meshes stay per object
  const groups: { lead: THREE.Mesh; parts: Part[]; map: THREE.Texture | null; side: THREE.Side; skinned: boolean }[] = [];
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (Array.isArray(m.material) && m.geometry.groups.length && m.geometry.index) {
      // multi-material single geometry: split by group
      for (const gr of m.geometry.groups) {
        const sub = m.geometry.clone();
        sub.clearGroups();
        const index = m.geometry.index;
        if (index) sub.setIndex(new THREE.BufferAttribute((index.array as Uint16Array).slice(gr.start, gr.start + gr.count), 1));
        const clone = m.clone() as THREE.Mesh;
        clone.geometry = sub;
        clone.material = mats[gr.materialIndex ?? 0];
        pushPart(clone, mats[gr.materialIndex ?? 0]);
      }
      continue;
    }
    pushPart(m, mats[0]);
  }
  function pushPart(m: THREE.Mesh, mat: THREE.Material) {
    const sm = mat as THREE.MeshStandardMaterial;
    if (sm.roughness !== undefined) { rough += sm.roughness; roughN++; }
    const map = sm.map ?? null;
    if (map) anyTex = true;
    const skinned = (m as THREE.SkinnedMesh).isSkinnedMesh === true;
    const side = mat.side ?? THREE.FrontSide;
    let g = skinned ? groups.find((x) => x.skinned && x.map === map && x.side === side && sameSkeleton(x.lead as THREE.SkinnedMesh, m as THREE.SkinnedMesh)) : undefined;
    if (!g) { g = { lead: m, parts: [], map, side, skinned }; groups.push(g); }
    g.parts.push({ mesh: m, mat });
  }
  let count = 0;
  for (const g of groups) {
    const { geo, glowCount } = mergeParts(g.parts, normalize, !!g.map);
    if (glowCount) anyGlow = true;
    const lead = g.lead;
    const parent = lead.parent ?? scene;
    let out: THREE.Mesh;
    if (g.skinned) {
      const sl = lead as THREE.SkinnedMesh;
      const s = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ map: g.map, vertexColors: true, side: g.side }));
      s.name = `${lead.name}_wm`;
      s.position.copy(lead.position); s.quaternion.copy(lead.quaternion); s.scale.copy(lead.scale);
      parent.add(s);
      s.bind(sl.skeleton, sl.bindMatrix);
      out = s;
    } else {
      out = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: g.map, vertexColors: true, side: g.side }));
      out.name = `${lead.name}_wm`;
      out.position.copy(lead.position); out.quaternion.copy(lead.quaternion); out.scale.copy(lead.scale);
      parent.add(out);
    }
    out.castShadow = true;
    out.receiveShadow = true;
    out.userData.wmPrepared = true;
    out.userData.wmDouble = g.side === THREE.DoubleSide;
    for (const p of g.parts) p.mesh.removeFromParent();
    count++;
  }
  const gloss = roughN ? THREE.MathUtils.clamp(1.0 - (rough / roughN) * 1.4, 0.15, 0.7) : 0.35;
  return { meshes: count, textured: anyTex, glow: anyGlow, gloss };
}

/** Stand-in geometry (placeholders, accessories): add the hull normals once per shared geometry. */
export function ensureSmooth(g: THREE.BufferGeometry, glow = 0) {
  if (g.getAttribute('aSmooth')) return;
  const n = g.getAttribute('position').count;
  addSmooth(g, glow ? new Float32Array(n).fill(glow) : undefined);
}

// ── Look handle ─────────────────────────────────────────────────────────────
export interface LookOptions {
  kind?: 'creature' | 'human';
  element?: Element;
  element2?: Element;
  tint?: string;
  tintGlow?: string;
  shiny?: boolean;
  /** Draw inverted-hull outlines (off on the low tier). */
  outline?: boolean;
  gloss?: number;
  /** Colour of the outline ink (mixed with the local body colour). */
  ink?: THREE.ColorRepresentation;
}

export class Look {
  U = makeRigUniforms();
  bodies: THREE.Mesh[] = [];
  outlines: THREE.Mesh[] = [];
  private detail = 2;
  private flashT = 0;
  private flashDur = 0.14;
  private flashPeak = 0;
  private outlineOn: boolean;

  constructor(root: THREE.Object3D, opts: LookOptions) {
    this.outlineOn = opts.outline !== false;
    const U = this.U;
    const el = opts.element ? ELEMENTS[opts.element].color : null;
    if (opts.kind !== 'human' && el) {
      U.uElem.value.set(el).multiplyScalar(0.55);
      U.uElemAmt.value = 0.55;
      const mode = opts.element === 'fire' ? 1 : opts.element === 'storm' ? 2 : opts.element === 'void' ? 3 : 0;
      U.uGlowMode.value = mode;
      U.uGlowColor.value.set(opts.tintGlow ?? el);
      if (!mode && opts.tintGlow) U.uGlowMode.value = 4;
      if (opts.element2 && !mode) {
        const m2 = opts.element2 === 'fire' ? 1 : opts.element2 === 'storm' ? 2 : opts.element2 === 'void' ? 3 : 0;
        if (m2) { U.uGlowMode.value = m2; U.uGlowColor.value.set(ELEMENTS[opts.element2].color); }
      }
    } else {
      U.uElemAmt.value = 0;
      U.uRimAmt.value = 0.7;
    }
    if (opts.tint) {
      const t = new THREE.Color(opts.tint);
      const h = { h: 0, s: 0, l: 0 };
      t.getHSL(h);
      U.uTintHSL.value.set(h.h, h.s, h.l);
      U.uTintAmt.value = 1;
    }
    if (opts.shiny) { U.uShiny.value = 1; U.uHueShift.value = 0.42; U.uRimAmt.value = 1.15; }
    if (opts.gloss !== undefined) U.uGloss.value = opts.gloss;
    const ink = new THREE.Color(opts.ink ?? '#1a1024');
    this.apply(root, ink);
  }

  private apply(root: THREE.Object3D, ink: THREE.Color) {
    const list: THREE.Mesh[] = [];
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.wmFx && !m.userData.wmOutline) list.push(m); });
    for (const m of list) this.adopt(m, ink);
  }

  /** Convert one mesh (body part or accessory) to the stylised material and give it a hull. */
  adopt(m: THREE.Mesh, ink = new THREE.Color('#1a1024')) {
    const src = m.material as THREE.MeshStandardMaterial;
    const vertexColors = !!m.geometry.getAttribute('color') && (src.vertexColors ?? true);
    ensureSmooth(m.geometry);
    const mat = toonMaterial(this.U, { map: src.map ?? null, vertexColors, color: vertexColors ? '#ffffff' : src.color ?? '#ffffff', side: src.side });
    if (!vertexColors && src.color && !m.userData.wmPrepared && !m.userData.wmKeepColor) normalizeColor(mat.color);
    if (!vertexColors && (src.emissiveIntensity ?? 0) > 0.5 && src.emissive && src.emissive.getHex() !== 0) { mat.emissive.copy(src.emissive).multiplyScalar(Math.min(2.5, src.emissiveIntensity)); }
    m.material = mat;
    m.onBeforeRender = updateGlobals;
    this.bodies.push(m);
    const skinned = (m as THREE.SkinnedMesh).isSkinnedMesh === true;
    if (m.userData.wmDouble || src.side === THREE.DoubleSide || m.userData.wmNoOutline) return;
    ensureSmooth(m.geometry);
    const om = outlineMaterial(this.U, ink, vertexColors);
    let o: THREE.Mesh;
    if (skinned) {
      const sm = m as THREE.SkinnedMesh;
      const so = new THREE.SkinnedMesh(m.geometry, om);
      so.bind(sm.skeleton, sm.bindMatrix);
      o = so;
    } else o = new THREE.Mesh(m.geometry, om);
    o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale);
    o.castShadow = false; o.receiveShadow = false;
    o.userData.wmOutline = true;
    o.frustumCulled = m.frustumCulled;
    const bs = (m as THREE.SkinnedMesh).boundingSphere;
    if (skinned && bs) (o as THREE.SkinnedMesh).boundingSphere = bs.clone();
    o.visible = this.outlineOn && this.detail >= 2;
    m.parent?.add(o);
    this.outlines.push(o);
  }

  /** 2 full · 1 no outline · 0 no outline, no shadow (far away). */
  setDetail(level: 0 | 1 | 2) {
    if (level === this.detail) return;
    this.detail = level;
    for (const o of this.outlines) o.visible = this.outlineOn && level >= 2;
    for (const b of this.bodies) b.castShadow = level >= 1 && this.U.uFade.value > 0.99 && this.U.uDissolve.value <= 0;
  }
  setOutline(on: boolean) { this.outlineOn = on; for (const o of this.outlines) o.visible = on && this.detail >= 2; }

  flash(color: THREE.ColorRepresentation = '#ffffff', amount = 0.85, dur = 0.14) {
    this.U.uFlashColor.value.set(color);
    this.flashPeak = amount;
    this.flashDur = dur;
    this.flashT = dur;
    this.U.uFlash.value = amount;
  }
  setDissolve(v: number, color?: THREE.ColorRepresentation) {
    this.U.uDissolve.value = v;
    if (color) this.U.uDissolveColor.value.set(color);
    const cast = v <= 0 && this.U.uFade.value > 0.99 && this.detail >= 1;
    for (const b of this.bodies) b.castShadow = cast;
  }
  setFade(v: number) {
    this.U.uFade.value = v;
    const cast = v > 0.99 && this.U.uDissolve.value <= 0 && this.detail >= 1;
    for (const b of this.bodies) b.castShadow = cast;
  }
  get fade() { return this.U.uFade.value; }

  update(dt: number) {
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.U.uFlash.value = this.flashPeak * (this.flashT / this.flashDur);
    }
  }
}

// ── Per-frame globals (called from any stylised mesh's onBeforeRender) ──────
let lastFrame = -1;
let lastCam: THREE.Camera | null = null;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const keyLights = new WeakMap<THREE.Object3D, THREE.DirectionalLight | null>();
const t0 = performance.now();

function findKeyLight(scene: THREE.Object3D): THREE.DirectionalLight | null {
  if (keyLights.has(scene)) {
    const l = keyLights.get(scene)!;
    if (!l || l.parent) return l;
  }
  let best: THREE.DirectionalLight | null = null;
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight && !l.userData.wmStage && (!best || (l.castShadow && !best.castShadow) || l.intensity > best.intensity)) best = l;
  });
  keyLights.set(scene, best);
  return best;
}

export function updateGlobals(this: THREE.Object3D, renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const f = renderer.info.render.frame;
  if (f === lastFrame && camera === lastCam) return;
  lastFrame = f;
  lastCam = camera;
  LOOK.uTime.value = (performance.now() - t0) / 1000;
  if (rimOverride.dir) {
    LOOK.uRimDir.value.copy(rimOverride.dir);
  } else {
    const light = findKeyLight(scene);
    if (light) {
      _a.setFromMatrixPosition(light.matrixWorld).sub(_b.setFromMatrixPosition(light.target.matrixWorld)).normalize();
      _a.transformDirection(camera.matrixWorldInverse);
      LOOK.uRimDir.value.copy(_a);
      if (!rimOverride.color) {
        // rim follows the key light's hue (warm sun, cool moon) but never falls to nothing
        LOOK.uRimColor.value.copy(light.color).multiplyScalar(0.55 + Math.min(1.2, light.intensity) * 0.35);
      }
    }
  }
  if (rimOverride.color) LOOK.uRimColor.value.copy(rimOverride.color);
}

/** Force a refresh of the per-frame globals (portrait renderer uses its own scene). */
export function resetGlobals() { lastFrame = -1; lastCam = null; }
