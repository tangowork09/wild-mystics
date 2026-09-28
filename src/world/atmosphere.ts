import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Q, renderer } from '../core/renderer';
import { ZONES, type Weather } from '../data/zones';
import { lerp, clamp } from '../core/noise';

// Sky, sun & moon, fog, image-based lighting, clouds, stars and per-land weather.
// Time of day: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.

interface Mood { turbidity: number; rayleigh: number; azimuth: number; fog: THREE.Color; motes: THREE.Color; wx: WeatherParams }
interface WeatherParams { vx: number; vy: number; vz: number; size: number; alpha: number; flicker: number; spread: number; height: number }

const WEATHER: Record<Weather, WeatherParams> = {
  pollen: { vx: 0.3, vy: 0.25, vz: 0.1, size: 3.5, alpha: 0.8, flicker: 1, spread: 2, height: 9 },
  mist: { vx: 0.25, vy: 0.02, vz: 0.1, size: 26, alpha: 0.1, flicker: 0.2, spread: 3, height: 3 },
  embers: { vx: 0.2, vy: 1.3, vz: 0.1, size: 3, alpha: 1, flicker: 2.5, spread: 1.5, height: 10 },
  snow: { vx: 0.6, vy: -1.4, vz: 0.3, size: 4, alpha: 0.9, flicker: 0.3, spread: 1.5, height: 14 },
  spores: { vx: 0.1, vy: 0.35, vz: 0.15, size: 4, alpha: 0.9, flicker: 1.5, spread: 2.5, height: 7 },
  sand: { vx: 5.5, vy: 0.1, vz: 1.2, size: 3, alpha: 0.55, flicker: 0.4, spread: 0.6, height: 5 },
};

export class Atmosphere {
  sky = new Sky();
  sun = new THREE.DirectionalLight('#fff1dc', 3.4);
  hemi = new THREE.HemisphereLight('#cfe4ff', '#6a5a48', 1.15);
  fog: THREE.FogExp2;
  clouds = new THREE.Group();
  /** 0 day … 1 full night; read by towns (lamps), wilds (night spawns), UI (clock). */
  night = 0;
  sunElevation = 30;
  private motes: THREE.Points;
  private moteMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private starMat: THREE.PointsMaterial;
  private pmrem = new THREE.PMREMGenerator(renderer);
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private cur: Mood;
  private target: Mood;
  private lastEnvElev = -999;
  private lastEnvTime = 0;
  private sunDir = new THREE.Vector3();
  private cloudMat!: THREE.MeshStandardMaterial;

  constructor(private scene: THREE.Scene) {
    const m = this.moodFor(ZONES.map((_, i) => (i === 0 ? 1 : 0)));
    this.cur = { ...m, fog: m.fog.clone(), motes: m.motes.clone(), wx: { ...m.wx } };
    this.target = m;
    this.sky.scale.setScalar(Math.min(4500, Q.far * 0.95));
    scene.add(this.sky);
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);

    this.fog = new THREE.FogExp2(this.cur.fog.getHex(), Q.fog);
    scene.fog = this.fog;

    this.sun.castShadow = Q.shadow > 0;
    if (Q.shadow > 0) this.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -48; sc.right = sc.top = 48; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.buildClouds();
    scene.add(this.clouds);

    // stars (night)
    const SN = 1400;
    const sp = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      sp[i * 3] = r * Math.cos(th); sp[i * 3 + 1] = Math.abs(u) * 0.9 + 0.08; sp[i * 3 + 2] = r * Math.sin(th);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    scene.add(this.stars);

    // weather motes
    const N = Math.round(Q.grass > 50000 ? 700 : 380);
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.moteMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uColor: { value: this.cur.motes.clone() }, uGround: { value: 0 },
        uVel: { value: new THREE.Vector3() }, uSize: { value: 4 }, uAlpha: { value: 1 }, uFlicker: { value: 1 }, uSpread: { value: 2 }, uHeight: { value: 9 }, uNight: { value: 0 },
      },
      vertexShader: `
        attribute float aSeed; uniform float uTime; uniform vec3 uCenter; uniform float uGround;
        uniform vec3 uVel; uniform float uSize; uniform float uFlicker; uniform float uSpread; uniform float uHeight; uniform float uNight;
        varying float vA;
        void main(){
          vec3 p = position;
          float t = uTime * (0.6 + aSeed * 0.8);
          p.x += uVel.x * t + sin(uTime * 0.3 + aSeed * 40.0) * uSpread;
          p.z += uVel.z * t + cos(uTime * 0.25 + aSeed * 30.0) * uSpread;
          float y = mod(p.y * uHeight + uVel.y * t, uHeight);
          vec3 rel = mod(vec3(p.x, 0.0, p.z) - uCenter + 30.0, 60.0) - 30.0;
          vec3 w = vec3(uCenter.x + rel.x, uGround + y, uCenter.z + rel.z);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((1.0 + aSeed) * uSize * (22.0 / -mv.z), uSize * 3.0);
          float fl = mix(1.0, 0.5 + 0.5 * sin(uTime * 2.0 * uFlicker + aSeed * 60.0), min(uFlicker, 1.0));
          vA = fl * (1.0 - smoothstep(20.0, 30.0, length(rel.xz))) * smoothstep(3.0, 8.0, -mv.z) * (1.0 + uNight * 0.6);
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uAlpha; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor * 1.8, a * vA * uAlpha); }`,
    });
    this.motes = new THREE.Points(g, this.moteMat);
    this.motes.frustumCulled = false;
    scene.add(this.motes);
  }

  private moodFor(w: number[]): Mood {
    const m: Mood = { turbidity: 0, rayleigh: 0, azimuth: 0, fog: new THREE.Color(0, 0, 0), motes: new THREE.Color(0, 0, 0), wx: { vx: 0, vy: 0, vz: 0, size: 0, alpha: 0, flicker: 0, spread: 0, height: 0 } };
    ZONES.forEach((z, i) => {
      if (w[i] < 0.001) return;
      m.turbidity += z.sky.turbidity * w[i];
      m.rayleigh += z.sky.rayleigh * w[i];
      m.azimuth += z.sky.azimuth * w[i];
      m.fog.add(new THREE.Color(z.fog).multiplyScalar(w[i]));
      m.motes.add(new THREE.Color(z.particles).multiplyScalar(w[i]));
      const wp = WEATHER[z.weather];
      for (const k of Object.keys(wp) as (keyof WeatherParams)[]) m.wx[k] += wp[k] * w[i];
    });
    return m;
  }

  private buildClouds() {
    const puff = new THREE.IcosahedronGeometry(1, 3);
    this.cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#b8c4d8', emissiveIntensity: 0.45, fog: false });
    const count = 70 * 9;
    const inst = new THREE.InstancedMesh(puff, this.cloudMat, count);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (let c = 0; c < 70; c++) {
      const a = Math.random() * Math.PI * 2;
      const r = 120 + Math.random() * Math.min(620, Q.far - 190);
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

  update(dt: number, t: number, focus: THREE.Vector3, groundY: number, timeOfDay: number) {
    const k = 1 - Math.exp(-dt * 0.8);
    const c = this.cur, tg = this.target;
    c.turbidity = lerp(c.turbidity, tg.turbidity, k);
    c.rayleigh = lerp(c.rayleigh, tg.rayleigh, k);
    c.azimuth = lerp(c.azimuth, tg.azimuth, k);
    c.fog.lerp(tg.fog, k);
    c.motes.lerp(tg.motes, k);
    for (const key of Object.keys(c.wx) as (keyof WeatherParams)[]) c.wx[key] = lerp(c.wx[key], tg.wx[key], k);

    // sun path
    const ang = (timeOfDay - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang) * 62;
    this.sunElevation = elev;
    const night = clamp((4 - elev) / 12, 0, 1);
    this.night = night;
    const az = c.azimuth + (timeOfDay - 0.5) * 150;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(az));
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = c.turbidity;
      u.rayleigh.value = lerp(c.rayleigh, 0.4, night);
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.82;
      u.sunPosition.value.copy(this.sunDir);
    }
    // key light: sun by day, cool moon by night
    const lightDir = this.sunDir.clone();
    if (night > 0.5) lightDir.set(-this.sunDir.x, Math.max(0.45, -this.sunDir.y), -this.sunDir.z).normalize();
    const warm = clamp(1 - elev / 25, 0, 1);
    const dayCol = new THREE.Color(1, 0.93 - warm * 0.18, 0.82 - warm * 0.35);
    const moonCol = new THREE.Color('#9fb6ff');
    this.sun.color.copy(dayCol).lerp(moonCol, night);
    const dayI = elev > 0 ? 2.4 + (1 - warm) * 1.3 : 1.2;
    this.sun.intensity = lerp(dayI, 0.55, night) * (elev > -2 && elev < 6 && night < 0.5 ? 0.6 : 1);
    const nightFog = new THREE.Color('#141a2c');
    this.fog.color.copy(c.fog).lerp(nightFog, night * 0.85);
    this.hemi.color.copy(c.fog).lerp(new THREE.Color('#dfeaff'), 0.5).lerp(new THREE.Color('#34406a'), night);
    this.hemi.groundColor.set('#6a5a48').lerp(new THREE.Color('#1a1a28'), night);
    this.hemi.intensity = lerp(1.0, 0.45, night);
    this.cloudMat.emissiveIntensity = lerp(0.45, 0.05, night);
    this.cloudMat.color.set('#ffffff').lerp(new THREE.Color('#3a4260'), night);
    this.starMat.opacity = night * 0.95;
    this.stars.position.copy(focus);
    this.stars.scale.setScalar(Math.min(1800, Q.far * 0.8));

    // shadow frustum follows the focus point, snapped to texels to avoid shimmering
    const texel = 96 / Math.max(512, Q.shadow);
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(lightDir, 140);

    this.sky.position.set(focus.x, 0, focus.z);
    this.clouds.position.x = Math.sin(t * 0.004) * 60;
    this.clouds.rotation.y = t * 0.002;

    const u = this.moteMat.uniforms;
    u.uTime.value = t;
    (u.uCenter.value as THREE.Vector3).copy(focus);
    u.uGround.value = groundY;
    (u.uColor.value as THREE.Color).copy(c.motes);
    (u.uVel.value as THREE.Vector3).set(c.wx.vx, c.wx.vy, c.wx.vz);
    u.uSize.value = c.wx.size;
    u.uAlpha.value = c.wx.alpha;
    u.uFlicker.value = c.wx.flicker;
    u.uSpread.value = c.wx.spread;
    u.uHeight.value = c.wx.height;
    u.uNight.value = night;

    // image-based light: refresh when the sun has moved enough (cheap enough every few seconds)
    const now = performance.now();
    if (!this.envRT || (Math.abs(elev - this.lastEnvElev) > 2.5 && now - this.lastEnvTime > 1500)) this.refreshEnv(elev);
  }

  refreshEnv(elev = this.sunElevation) {
    this.lastEnvElev = elev;
    this.lastEnvTime = performance.now();
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = lerp(0.45, 0.12, this.night);
    old?.dispose();
  }
}
