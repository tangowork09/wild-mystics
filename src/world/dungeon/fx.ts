import * as THREE from 'three';
import type { MoteKind } from '../../data/dungeons';

// Dungeon effects (v3:dungeons): one draw call per effect family. Flames and glows are GPU
// billboards (instanced quads animated in the vertex/fragment shader), motes drift around the
// player, light shafts fall from the dark, portals swirl. All additive and HDR so bloom lifts them.

const BILLBOARD_VS = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iColor;   // rgb, intensity
  attribute vec3 iParams;  // size, kind (0 flame, 1 halo, 2 spark, 3 orb), seed
  uniform float uTime;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vKind;
  varying float vSeed;
  varying float vDepth;
  void main() {
    vUv = uv;
    vColor = iColor;
    vKind = iParams.y;
    vSeed = iParams.z;
    float size = iParams.x;
    float flick = 1.0;
    if (vKind < 0.5) flick = 0.85 + 0.15 * sin(uTime * 13.0 + vSeed * 40.0) * sin(uTime * 7.3 + vSeed * 17.0);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vKind < 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec2 q = (uv - vec2(0.5, vKind < 0.5 ? 0.18 : 0.5)) * size * vec2(1.0, vKind < 0.5 ? 1.6 * flick : 1.0);
    vec3 wp = iPos + right * q.x + up * q.y;
    if (vKind > 2.5) wp.y += sin(uTime * 1.6 + vSeed * 9.0) * 0.12;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const BILLBOARD_FS = /* glsl */ `
  uniform float uTime;
  uniform float uFog;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vKind;
  varying float vSeed;
  varying float vDepth;
  void main() {
    vec2 p = vUv - 0.5;
    float a;
    vec3 col = vColor.rgb;
    if (vKind < 0.5) {
      // flame: teardrop with a flickering hot core
      float y = vUv.y;
      float w = mix(0.36, 0.02, pow(y, 1.4)) * (0.9 + 0.1 * sin(uTime * 17.0 + vSeed * 31.0 + y * 9.0));
      float xo = sin(uTime * 9.0 + vSeed * 13.0 + y * 6.0) * 0.06 * y;
      float d = abs(p.x - xo) / max(w, 0.001);
      a = smoothstep(1.0, 0.2, d) * smoothstep(0.0, 0.12, y) * smoothstep(1.0, 0.55, y);
      float core = smoothstep(0.6, 0.0, d) * smoothstep(0.75, 0.1, y);
      col = mix(col, vec3(1.0, 0.95, 0.8), core * 0.75);
    } else if (vKind < 1.5) {
      float r = length(p) * 2.0;
      a = pow(max(0.0, 1.0 - r), 2.2) * (0.85 + 0.15 * sin(uTime * 3.0 + vSeed * 20.0));
    } else if (vKind < 2.5) {
      float r = length(p) * 2.0;
      a = pow(max(0.0, 1.0 - r), 4.0);
    } else {
      float r = length(p) * 2.0;
      a = smoothstep(1.0, 0.0, r) * (0.7 + 0.3 * sin(uTime * 2.2 + vSeed * 11.0));
      col = mix(col, vec3(1.0), smoothstep(0.35, 0.0, r) * 0.6);
    }
    if (a < 0.003) discard;
    // additive: fade the contribution into the fog instead of tinting it
    float fogF = exp(-uFog * uFog * vDepth * vDepth);
    gl_FragColor = vec4(col * vColor.a * a * fogF, 1.0);
  }`;

export type GlowKind = 'flame' | 'halo' | 'spark' | 'orb';
const KIND: Record<GlowKind, number> = { flame: 0, halo: 1, spark: 2, orb: 3 };

/** Instanced additive billboards (flames, halos, orbs). Build once, then toggle per index. */
export class Glows {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private par: Float32Array;
  private n = 0;
  private uniforms = { uTime: { value: 0 }, uFog: { value: 0 } };

  constructor(private max = 512) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.par = new Float32Array(max * 3);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.col, 4));
    g.setAttribute('iParams', new THREE.InstancedBufferAttribute(this.par, 3));
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      vertexShader: BILLBOARD_VS, fragmentShader: BILLBOARD_FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  add(p: THREE.Vector3, color: THREE.ColorRepresentation, size: number, kind: GlowKind, intensity = 1): number {
    if (this.n >= this.max) return -1;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    const c = new THREE.Color(color);
    this.col.set([c.r, c.g, c.b, intensity], i * 4);
    this.par.set([size, KIND[kind], (i * 0.618) % 1], i * 3);
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = this.n;
    for (const k of ['iPos', 'iColor', 'iParams']) (g.getAttribute(k) as THREE.InstancedBufferAttribute).needsUpdate = true;
    return i;
  }

  setIntensity(i: number, v: number) {
    if (i < 0) return;
    this.col[i * 4 + 3] = v;
    ((this.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute('iColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
  setColor(i: number, color: THREE.ColorRepresentation) {
    if (i < 0) return;
    const c = new THREE.Color(color);
    this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b;
    ((this.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute('iColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
  setPos(i: number, p: THREE.Vector3) {
    if (i < 0) return;
    this.pos.set([p.x, p.y, p.z], i * 3);
    ((this.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute('iPos') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  update(t: number, fogDensity: number) {
    this.uniforms.uTime.value = t;
    this.uniforms.uFog.value = fogDensity;
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ── Motes: theme particles that drift around the player ─────────────────────────────────────
const MOTE: Record<MoteKind, { vx: number; vy: number; size: number; flicker: number; spread: number }> = {
  dust: { vx: 0.1, vy: -0.05, size: 3.2, flicker: 0.3, spread: 1.2 },
  embers: { vx: 0.15, vy: 1.1, size: 3.4, flicker: 2.4, spread: 0.8 },
  snow: { vx: 0.25, vy: -0.9, size: 3.6, flicker: 0.2, spread: 1.0 },
  spores: { vx: 0.1, vy: 0.25, size: 3.8, flicker: 1.4, spread: 1.6 },
  sparkle: { vx: 0.05, vy: 0.15, size: 3.0, flicker: 3.2, spread: 1.4 },
  bubbles: { vx: 0.05, vy: 0.45, size: 3.4, flicker: 0.6, spread: 0.8 },
  fireflies: { vx: 0.2, vy: 0.1, size: 3.6, flicker: 2.2, spread: 2.2 },
};

export class Motes {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  constructor(kind: MoteKind, color: string, count = 320) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 36;
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = (Math.random() - 0.5) * 36;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = MOTE[kind];
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(color) }, uVel: { value: new THREE.Vector2(m.vx, m.vy) }, uSize: { value: m.size }, uFlicker: { value: m.flicker }, uSpread: { value: m.spread }, uFloor: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform vec3 uCenter; uniform vec2 uVel; uniform float uSize; uniform float uFlicker; uniform float uSpread; uniform float uFloor;
        varying float vA;
        void main() {
          vec3 p = position;
          float t = uTime * (0.6 + aSeed * 0.8);
          p.x += uVel.x * t + sin(uTime * 0.35 + aSeed * 40.0) * uSpread;
          p.z += cos(uTime * 0.3 + aSeed * 30.0) * uSpread;
          float y = mod(p.y * 9.0 + uVel.y * t, 9.0);
          vec2 rel = mod(p.xz - uCenter.xz + 18.0, 36.0) - 18.0;
          vec3 w = vec3(uCenter.x + rel.x, uFloor + 0.2 + y, uCenter.z + rel.y);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((1.0 + aSeed) * uSize * (22.0 / -mv.z), uSize * 3.0);
          float fl = mix(1.0, 0.5 + 0.5 * sin(uTime * 2.0 * uFlicker + aSeed * 60.0), min(uFlicker, 1.0));
          vA = fl * (1.0 - smoothstep(12.0, 18.0, length(rel))) * smoothstep(1.5, 5.0, -mv.z) * smoothstep(0.0, 1.0, y) * smoothstep(9.0, 7.0, y);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * 2.2, a * vA); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }
  update(t: number, center: THREE.Vector3, floor: number) {
    this.mat.uniforms.uTime.value = t;
    (this.mat.uniforms.uCenter.value as THREE.Vector3).copy(center);
    this.mat.uniforms.uFloor.value = floor;
  }
  dispose() { this.points.geometry.dispose(); this.mat.dispose(); }
}

// ── Light shafts: tall additive cones with a soft vertical falloff ────────────────────────────
export class Shafts {
  mesh: THREE.InstancedMesh;
  private uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color() } };
  constructor(color: string, list: { pos: THREE.Vector3; radius: number; height: number }[]) {
    this.uniforms.uColor.value.set(color);
    const geo = new THREE.CylinderGeometry(0.55, 1, 1, 24, 1, true).translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying float vY; varying vec3 vN; varying vec3 vV; varying float vSeed;
        void main() {
          vY = uv.y;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor;
        varying float vY; varying vec3 vN; varying vec3 vV; varying float vSeed;
        void main() {
          float edge = pow(1.0 - abs(dot(vN, vV)), 1.6);
          float fall = smoothstep(0.0, 0.25, vY) * smoothstep(1.0, 0.55, vY);
          float flick = 0.8 + 0.2 * sin(uTime * 0.7 + vSeed * 13.0);
          float a = (1.0 - edge) * fall * 0.16 * flick;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const m4 = new THREE.Matrix4();
    list.forEach((s, i) => this.mesh.setMatrixAt(i, m4.compose(s.pos, new THREE.Quaternion(), new THREE.Vector3(s.radius, s.height, s.radius))));
    this.mesh.count = list.length;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }
  update(t: number) { this.uniforms.uTime.value = t; }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ── Portal: swirling disc + ring ────────────────────────────────────────────────────────────
export class Portal {
  group = new THREE.Group();
  private uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uOpen: { value: 0 } };
  open = 0;
  target = 0;
  constructor(color: string, radius = 1.5) {
    this.uniforms.uColor.value.set(color);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uOpen; varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
          float swirl = sin(a * 5.0 + r * 12.0 - uTime * 3.0) * 0.5 + 0.5;
          float swirl2 = sin(a * 3.0 - r * 7.0 + uTime * 2.1) * 0.5 + 0.5;
          float body = smoothstep(1.0, 0.75, r) * (0.35 + 0.65 * swirl * swirl2);
          float rim = smoothstep(0.78, 0.95, r) * smoothstep(1.0, 0.95, r);
          float core = smoothstep(0.45, 0.0, r);
          vec3 c = uColor * (body * 1.6 + rim * 3.2) + vec3(1.0) * core * 1.4;
          gl_FragColor = vec4(c * uOpen, 1.0);
        }`,
    }));
    disc.renderOrder = 5;
    this.group.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, 0.09, 8, 64), new THREE.MeshStandardMaterial({ color: '#2a2630', emissive: color, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.6 }));
    ring.castShadow = true;
    this.group.add(ring);
  }
  update(dt: number, t: number) {
    this.open += (this.target - this.open) * Math.min(1, dt * 2.2);
    this.uniforms.uTime.value = t;
    this.uniforms.uOpen.value = this.open;
    this.group.children[0].visible = this.open > 0.01;
    const ring = this.group.children[1] as THREE.Mesh;
    (ring.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + this.open * 2.4;
  }
  dispose() { this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }); }
}

// ── Water & lava surfaces (merged planes, one material each) ────────────────────────────────
export function surfaceMaterial(kind: 'water' | 'lava', color: string, deep: string) {
  const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uDeep: { value: new THREE.Color(deep) }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0 } };
  const lava = kind === 'lava';
  return new THREE.ShaderMaterial({
    uniforms, transparent: !lava, depthWrite: lava, fog: true,
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vV;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz; vV = normalize(cameraPosition - wp.xyz);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform vec3 uDeep; varying vec3 vW; varying vec3 vV;
      #include <fog_pars_fragment>
      float h(vec2 p) { return sin(p.x * 1.7 + uTime * 0.9) * sin(p.y * 1.3 - uTime * 0.7) + sin((p.x + p.y) * 2.9 + uTime * 1.4) * 0.5; }
      void main() {
        vec2 p = vW.xz;
        float n = h(p) * 0.5 + h(p * 2.3 + 7.0) * 0.25;
        ${lava ? `
          float crust = smoothstep(0.1, 0.55, n + 0.25 * sin(p.x * 0.7 + p.y * 0.9 + uTime * 0.2));
          vec3 c = mix(uColor * 3.2, uDeep * 0.35, crust);
          gl_FragColor = vec4(c, 1.0);
        ` : `
          float fres = pow(1.0 - max(vV.y, 0.0), 3.0);
          float caus = pow(max(0.0, 1.0 - abs(n) * 2.2), 6.0);
          vec3 c = mix(uDeep, uColor, 0.35 + 0.3 * n) + vec3(0.6, 0.9, 1.0) * caus * 0.35 + uColor * fres * 0.8;
          gl_FragColor = vec4(c, 0.55 + fres * 0.3);
        `}
        #include <fog_fragment>
      }`,
  });
}

/** A soft round shadow/light decal texture (for rune circles, glow pools). */
let pool: THREE.Texture | null = null;
export function poolTexture() {
  if (pool) return pool;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  pool = new THREE.CanvasTexture(c);
  return pool;
}
