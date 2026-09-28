import * as THREE from 'three';
import { renderer } from '../../core/renderer';
import type { MaterialLib, Proto } from './protos';
import { DITHER_GLSL, LOOK } from './shared';

// Far-field trees as impostors: every prototype is rendered from VIEWS azimuths into an albedo atlas
// and a normal atlas at load time. At runtime ONE instanced draw covers every tree on the island:
// camera-facing (cylindrical) quads pick the two nearest views and relight the baked normals with the
// current sun, sky ambient and fog, so a forest 1 km away still reads, at dusk as well as noon.
// Near the camera they dither-swap with the full meshes (same Bayer pattern, complementary).

export const VIEWS = 8;
const MAXP = 48;

export interface ImpostorInst {
  proto: Proto; x: number; y: number; z: number; rot: number; scale: number; stretch: number;
  leaf: THREE.Color; body: THREE.Color; snow: number; glow: number;
}

/** 1 = takes the instance leaf tint, 0.5 = body tint, 0 = untinted. */
export type TintClass = (part: { mat: string; foliage: boolean }) => number;

const BAKE_VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vCol;
  void main() {
    vUv = uv;
    vN = normalize(normalMatrix * normal);
    #ifdef USE_COLOR
      vCol = color;
    #else
      vCol = vec3(1.0);
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BAKE_FRAG = /* glsl */ `
  uniform sampler2D map; uniform float hasMap; uniform vec3 diffuse; uniform float alphaCut; uniform float mask; uniform float pass;
  varying vec2 vUv; varying vec3 vN; varying vec3 vCol;
  void main() {
    vec4 t = hasMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
    if (t.a < alphaCut) discard;
    vec3 alb = clamp(t.rgb * diffuse * vCol, 0.0, 1.0);
    if (pass < 0.5) {
      gl_FragColor = vec4(pow(alb, vec3(1.0 / 2.2)), 1.0);
    } else {
      vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
      gl_FragColor = vec4(n * 0.5 + 0.5, mask);
    }
  }
`;

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec4 aPS;
  attribute vec4 aRD;
  attribute vec4 aLeaf;
  attribute vec3 aBody;
  uniform vec4 uProto[${MAXP}];
  uniform vec4 uAtlas;
  uniform vec3 uViewPos;
  uniform vec4 uRange;
  varying vec2 vUv0; varying vec2 vUv1; varying float vB;
  varying vec3 vLeaf; varying vec3 vBody; varying vec3 vRight; varying vec3 vFwd;
  varying float vFade; varying vec2 vSG; varying float vDist;
  void main() {
    vec4 P = uProto[int(aRD.y + 0.5)];
    float s = aPS.w;
    float W = P.x * s;
    vec3 base = aPS.xyz;
    vec3 toCam = cameraPosition - base;
    toCam.y = 0.0;
    float hl = length(toCam);
    vec3 fwd = hl > 1e-3 ? toCam / hl : vec3(0.0, 0.0, 1.0);
    vec3 right = vec3(fwd.z, 0.0, -fwd.x);
    float d = distance(uViewPos, base);
    float V = uAtlas.z;
    float f = fract((atan(fwd.x, fwd.z) - aRD.x) / 6.28318530718) * V;
    float i0 = floor(f);
    vB = f - i0;
    float i1 = mod(i0 + 1.0, V);
    vec2 local = vec2(position.x + 0.5, position.y);
    vUv0 = (vec2(P.z + i0, P.w) + local) * uAtlas.xy;
    vUv1 = (vec2(P.z + i1, P.w) + local) * uAtlas.xy;
    vec3 wp = base + right * position.x * W + vec3(0.0, (P.y + position.y * P.x * aLeaf.w) * s, 0.0);
    vFade = smoothstep(uRange.x, uRange.y, d) * (1.0 - smoothstep(uRange.z * 0.9, uRange.z, d));
    bool off = d < uRange.x - 0.5 || d > uRange.z;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = off ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * mvPosition;
    vLeaf = aLeaf.rgb; vBody = aBody; vRight = right; vFwd = fwd; vSG = aRD.zw; vDist = d;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  ${DITHER_GLSL}
  uniform sampler2D uAlb;
  uniform sampler2D uNrm;
  uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmbTop; uniform vec3 uAmbBottom; uniform vec3 uEnvAmb;
  uniform float uNight; uniform float uShade;
  varying vec2 vUv0; varying vec2 vUv1; varying float vB;
  varying vec3 vLeaf; varying vec3 vBody; varying vec3 vRight; varying vec3 vFwd;
  varying float vFade; varying vec2 vSG; varying float vDist;
  void main() {
    vec4 a = mix(texture2D(uAlb, vUv0), texture2D(uAlb, vUv1), vB);
    float cut = mix(0.5, 0.28, smoothstep(90.0, 600.0, vDist));
    if (a.a < cut) discard;
    if (vFade < 1.0 && vFade <= bayer4(gl_FragCoord.xy)) discard;
    #ifdef DEPTH
      gl_FragColor = vec4(1.0);
    #else
      vec4 nn = mix(texture2D(uNrm, vUv0), texture2D(uNrm, vUv1), vB);
      vec3 nv = normalize(nn.xyz * 2.0 - 1.0);
      vec3 N = normalize(vRight * nv.x + vec3(0.0, nv.y, 0.0) + vFwd * nv.z);
      float m = nn.a;
      vec3 alb = pow(a.rgb / max(a.a, 1e-3), vec3(2.2));
      alb *= mix(mix(vec3(1.0), vBody, smoothstep(0.0, 0.5, m)), vLeaf, smoothstep(0.5, 1.0, m));
      alb = mix(alb, vec3(0.9, 0.93, 1.0), vSG.x * smoothstep(0.25, 0.7, N.y));
      float ndl = max(dot(N, uSunDir), 0.0);
      vec3 amb = mix(uAmbBottom, uAmbTop, N.y * 0.5 + 0.5);
      vec3 col = alb * (uSunCol * ndl * uShade * RECIPROCAL_PI + amb * RECIPROCAL_PI + uEnvAmb);
      float back = pow(max(dot(-vFwd, uSunDir), 0.0), 3.0) * step(0.75, m);
      col += alb * uSunCol * back * 0.12;
      col += alb * vSG.y * (0.25 + 1.6 * uNight);
      gl_FragColor = vec4(col, 1.0);
      #include <fog_fragment>
    #endif
  }
`;

export class Impostors {
  mesh: THREE.Mesh;
  readonly slots = new Map<number, number>();
  private geo: THREE.InstancedBufferGeometry;
  private uniforms: Record<string, THREE.IUniform>;
  private albedo: THREE.WebGLRenderTarget;
  private normal: THREE.WebGLRenderTarget;
  private protoData: THREE.Vector4[] = [];

  constructor(protos: Proto[], mats: MaterialLib, tintClass: TintClass, cell: number) {
    const list = protos.slice(0, MAXP);
    const maxW = Math.min(4096, renderer.capabilities.maxTextureSize);
    const perRow = Math.max(1, Math.floor(maxW / (cell * VIEWS)));
    const rows = Math.max(1, Math.ceil(list.length / perRow));
    const W = perRow * VIEWS * cell, H = rows * cell;
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      rt.texture.anisotropy = 4;
      renderer.initRenderTarget(rt); // allocate the full mip chain, then don't rebuild it per cell
      rt.texture.generateMipmaps = false;
      return rt;
    };
    this.albedo = mk();
    this.normal = mk();
    for (let i = 0; i < MAXP; i++) this.protoData.push(new THREE.Vector4());

    this.bake(list, mats, tintClass, cell, perRow, rows);

    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setIndex(quad.index);
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.instanceCount = 0;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uProto: { value: this.protoData },
      uAtlas: { value: new THREE.Vector4(1 / (perRow * VIEWS), 1 / rows, VIEWS, 0) },
      uViewPos: { value: new THREE.Vector3() },
      uRange: { value: new THREE.Vector4(40, 48, 2000, 0) },
      uShade: { value: 0.8 },
    }]);
    // shared by reference (merge clones)
    Object.assign(this.uniforms, {
      uAlb: { value: this.albedo.texture }, uNrm: { value: this.normal.texture },
      uSunDir: LOOK.uSunDir, uSunCol: LOOK.uSunCol, uAmbTop: LOOK.uAmbTop, uAmbBottom: LOOK.uAmbBottom, uEnvAmb: LOOK.uEnvAmb, uNight: LOOK.uNight,
    });
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'impostors';
    this.mesh.customDepthMaterial = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, defines: { DEPTH: 1 }, side: THREE.DoubleSide });
  }

  private bake(list: Proto[], mats: MaterialLib, tintClass: TintClass, cell: number, perRow: number, rows: number) {
    const scene = new THREE.Scene();
    const bakeMats = new Map<string, THREE.ShaderMaterial>();
    const matFor = (name: string, mask: number) => {
      const key = `${name}:${mask}`;
      let m = bakeMats.get(key);
      if (!m) {
        const src = mats.get(name);
        m = new THREE.ShaderMaterial({
          vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: THREE.DoubleSide, vertexColors: !!src.vertexColors,
          uniforms: {
            map: { value: src.map }, hasMap: { value: src.map ? 1 : 0 }, diffuse: { value: src.color.clone() },
            alphaCut: { value: src.alphaTest > 0 ? src.alphaTest : -1 }, mask: { value: mask }, pass: { value: 0 },
          },
        });
        bakeMats.set(key, m);
      }
      return m;
    };
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, 0, 0.1, 2000);

    list.forEach((proto, slot) => {
      this.slots.set(proto.id, slot);
      scene.clear();
      const meshes = proto.parts.map((p) => new THREE.Mesh(p.geometry, matFor(p.mat, tintClass(p))));
      scene.add(...meshes);
      const Hh = proto.box.max.y - proto.box.min.y;
      const size = Math.max(2 * proto.radius, Hh) * 1.04;
      const y0 = proto.box.min.y;
      const col0 = (slot % perRow) * VIEWS, row = Math.floor(slot / perRow);
      this.protoData[slot].set(size, y0, col0, row);
      cam.left = -size / 2; cam.right = size / 2; cam.top = size; cam.bottom = 0;
      cam.updateProjectionMatrix();
      for (let pass = 0; pass < 2; pass++) {
        const rt = pass === 0 ? this.albedo : this.normal;
        for (const m of bakeMats.values()) m.uniforms.pass.value = pass;
        if (slot === 0) {
          rt.scissorTest = false;
          rt.viewport.set(0, 0, rt.width, rt.height);
          renderer.setRenderTarget(rt);
          renderer.setClearColor(pass === 0 ? new THREE.Color(0, 0, 0) : new THREE.Color(0.5, 0.5, 1.0), pass === 0 ? 0 : 1);
          renderer.clear(true, true, false);
        }
        for (let v = 0; v < VIEWS; v++) {
          const a = (v / VIEWS) * Math.PI * 2;
          cam.position.set(Math.sin(a) * 1000, y0, Math.cos(a) * 1000);
          cam.lookAt(0, y0, 0);
          cam.updateMatrixWorld();
          rt.viewport.set((col0 + v) * cell, row * cell, cell, cell);
          rt.scissor.set((col0 + v) * cell, row * cell, cell, cell);
          rt.scissorTest = true;
          renderer.setRenderTarget(rt);
          renderer.clear(false, true, false);
          renderer.render(scene, cam);
        }
      }
      scene.remove(...meshes);
    });
    // one mip chain for each atlas, generated once
    for (const rt of [this.albedo, this.normal]) {
      rt.scissorTest = false;
      rt.viewport.set(0, 0, rt.width, rt.height);
      rt.texture.generateMipmaps = true;
      renderer.setRenderTarget(rt);
      renderer.render(new THREE.Scene(), cam);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    for (const m of bakeMats.values()) m.dispose();
    void rows;
  }

  setInstances(list: ImpostorInst[]) {
    const n = list.length;
    const ps = new Float32Array(n * 4), rd = new Float32Array(n * 4), leaf = new Float32Array(n * 4), body = new Float32Array(n * 3);
    let k = 0;
    for (const it of list) {
      const slot = this.slots.get(it.proto.id);
      if (slot === undefined) continue;
      ps[k * 4] = it.x; ps[k * 4 + 1] = it.y; ps[k * 4 + 2] = it.z; ps[k * 4 + 3] = it.scale;
      rd[k * 4] = it.rot; rd[k * 4 + 1] = slot; rd[k * 4 + 2] = it.snow; rd[k * 4 + 3] = it.glow;
      leaf[k * 4] = it.leaf.r; leaf[k * 4 + 1] = it.leaf.g; leaf[k * 4 + 2] = it.leaf.b; leaf[k * 4 + 3] = it.stretch;
      body[k * 3] = it.body.r; body[k * 3 + 1] = it.body.g; body[k * 3 + 2] = it.body.b;
      k++;
    }
    this.geo.setAttribute('aPS', new THREE.InstancedBufferAttribute(ps, 4));
    this.geo.setAttribute('aRD', new THREE.InstancedBufferAttribute(rd, 4));
    this.geo.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(leaf, 4));
    this.geo.setAttribute('aBody', new THREE.InstancedBufferAttribute(body, 3));
    this.geo.instanceCount = k;
  }

  update(view: THREE.Vector3, fadeStart: number, fadeEnd: number, far: number) {
    (this.uniforms.uViewPos.value as THREE.Vector3).copy(view);
    (this.uniforms.uRange.value as THREE.Vector4).set(fadeStart, fadeEnd, far, 0);
  }

  get count() { return this.geo.instanceCount; }
}
