import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Q, renderer } from '../core/renderer';
import { ZONES, WORLD_SIZE } from '../data/zones';
import { lerp } from '../core/noise';

// Sky, sun, fog, image-based lighting, clouds and floating motes. All of it blends between
// zone moods as the player crosses borders.

interface Mood { turbidity: number; rayleigh: number; elevation: number; azimuth: number; fog: THREE.Color; motes: THREE.Color }

export class Atmosphere {
  sky = new Sky();
  sun = new THREE.DirectionalLight('#fff1dc', 3.4);
  hemi = new THREE.HemisphereLight('#cfe4ff', '#6a5a48', 1.15);
  fog: THREE.FogExp2;
  clouds = new THREE.Group();
  private motes: THREE.Points;
  private moteMat: THREE.ShaderMaterial;
  private pmrem = new THREE.PMREMGenerator(renderer);
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private cur: Mood;
  private target: Mood;
  private envDirty = 1;
  private sunDir = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    const m = this.moodFor([1, 0, 0, 0]);
    this.cur = { ...m, fog: m.fog.clone(), motes: m.motes.clone() };
    this.target = m;
    this.sky.scale.setScalar(Math.min(4500, Q.far * 0.95));
    scene.add(this.sky);
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);

    this.fog = new THREE.FogExp2(this.cur.fog.getHex(), Q.fog);
    scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -48; sc.right = sc.top = 48; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.buildClouds();
    scene.add(this.clouds);

    // motes
    const N = 420;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.moteMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uColor: { value: this.cur.motes.clone() }, uGround: { value: 0 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime; uniform vec3 uCenter; uniform float uGround;
        varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.3 + aSeed * 40.0) * 2.0;
          p.z += cos(uTime * 0.25 + aSeed * 30.0) * 2.0;
          p.y = mod(p.y + uTime * (0.2 + aSeed * 0.3), 10.0);
          vec3 rel = mod(p - uCenter + 30.0, 60.0) - 30.0;
          vec3 w = vec3(uCenter.x + rel.x, uGround + p.y, uCenter.z + rel.z);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((2.0 + aSeed * 3.0) * (60.0 / -mv.z), 7.0);
          vA = (0.5 + 0.5 * sin(uTime * 2.0 + aSeed * 60.0)) * (1.0 - smoothstep(20.0, 30.0, length(rel.xz))) * smoothstep(4.0, 9.0, -mv.z);
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * 2.2, a * vA * 0.9); }`,
    });
    this.motes = new THREE.Points(g, this.moteMat);
    this.motes.frustumCulled = false;
    scene.add(this.motes);
  }

  private moodFor(w: number[]): Mood {
    const m: Mood = { turbidity: 0, rayleigh: 0, elevation: 0, azimuth: 0, fog: new THREE.Color(0, 0, 0), motes: new THREE.Color(0, 0, 0) };
    ZONES.forEach((z, i) => {
      m.turbidity += z.sky.turbidity * w[i];
      m.rayleigh += z.sky.rayleigh * w[i];
      m.elevation += z.sky.elevation * w[i];
      m.azimuth += z.sky.azimuth * w[i];
      m.fog.add(new THREE.Color(z.fog).multiplyScalar(w[i]));
      m.motes.add(new THREE.Color(z.particles).multiplyScalar(w[i]));
    });
    return m;
  }

  private buildClouds() {
    const puff = new THREE.IcosahedronGeometry(1, 3);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#b8c4d8', emissiveIntensity: 0.45, fog: false });
    const count = 70 * 9;
    const inst = new THREE.InstancedMesh(puff, mat, count);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (let c = 0; c < 70; c++) {
      const a = Math.random() * Math.PI * 2;
      const r = 120 + Math.random() * Math.min(520, Q.far - 190);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 95 + Math.random() * 70;
      const s = 10 + Math.random() * 16;
      for (let p = 0; p < 9; p++) {
        const ps = s * (0.5 + Math.random() * 0.6);
        m4.compose(new THREE.Vector3(cx + (Math.random() - 0.5) * s * 3, cy + Math.random() * s * 0.5, cz + (Math.random() - 0.5) * s * 1.6), q, new THREE.Vector3(ps * 1.3, ps * 0.8, ps));
        inst.setMatrixAt(n++, m4);
      }
    }
    inst.castShadow = false;
    this.clouds.add(inst);
  }

  setZoneWeights(w: number[]) { this.target = this.moodFor(w); }

  update(dt: number, t: number, focus: THREE.Vector3, groundY: number) {
    const k = 1 - Math.exp(-dt * 0.8);
    const c = this.cur, tg = this.target;
    const before = c.elevation + c.azimuth + c.turbidity + c.rayleigh;
    c.turbidity = lerp(c.turbidity, tg.turbidity, k);
    c.rayleigh = lerp(c.rayleigh, tg.rayleigh, k);
    c.elevation = lerp(c.elevation, tg.elevation, k);
    c.azimuth = lerp(c.azimuth, tg.azimuth, k);
    c.fog.lerp(tg.fog, k);
    c.motes.lerp(tg.motes, k);
    const moved = Math.abs(c.elevation + c.azimuth + c.turbidity + c.rayleigh - before);

    const phi = THREE.MathUtils.degToRad(90 - c.elevation);
    const theta = THREE.MathUtils.degToRad(c.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = c.turbidity;
      u.rayleigh.value = c.rayleigh;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.82;
      u.sunPosition.value.copy(this.sunDir);
    }
    this.fog.color.copy(c.fog);
    this.hemi.color.copy(c.fog).lerp(new THREE.Color('#dfeaff'), 0.5);
    const warm = THREE.MathUtils.clamp(1 - c.elevation / 25, 0, 1);
    this.sun.color.setRGB(1, 0.93 - warm * 0.15, 0.82 - warm * 0.3);
    this.sun.intensity = 2.6 + (1 - warm) * 1.2;

    // shadow frustum follows the focus point, snapped to texels to avoid shimmering
    const texel = 96 / Q.shadow;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 140);

    this.sky.position.set(focus.x, 0, focus.z);
    this.clouds.position.x = Math.sin(t * 0.004) * 60;
    this.clouds.rotation.y = t * 0.002;

    this.moteMat.uniforms.uTime.value = t;
    (this.moteMat.uniforms.uCenter.value as THREE.Vector3).copy(focus);
    this.moteMat.uniforms.uGround.value = groundY;
    (this.moteMat.uniforms.uColor.value as THREE.Color).copy(c.motes);

    if (moved > 0.02) this.envDirty += moved;
    if (this.envDirty > 0.6 || !this.envRT) this.refreshEnv();
  }

  refreshEnv() {
    this.envDirty = 0;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
    old?.dispose();
  }

  get worldSize() { return WORLD_SIZE; }
}
