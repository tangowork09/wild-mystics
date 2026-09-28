import * as THREE from 'three';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import { Q, renderer, type Pipeline } from '../core/renderer';
import { ZONES } from '../data/zones';
import { clamp } from '../core/noise';
import { FOG_PARAMS, installFog } from './atmo/fog';
import { SkyDome } from './atmo/sky';
import { evalSky, moodFor, lerpMood, newMood, newSkyState, sunElevation, type MoodMix } from './atmo/palette';
import { Weathers } from './atmo/weather';
import { LOOK } from './flora/shared';

// Sky, sun & moon, fog (aerial perspective), image-based light, clouds, stars, aurora, lights,
// local lamps at night and per-land weather. Time of day: 0 = midnight, 0.25 = sunrise, 0.5 = noon,
// 0.75 = sunset. Colours come from the time-of-day palette blended with the mood of the lands around
// the player (see atmo/palette.ts and `Zone.sky`).

installFog();

export { WEATHER, type WeatherParams } from './atmo/weather';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class Atmosphere {
  sky: SkyDome;
  /** Key light: the sun by day, the moon by night (cascaded shadows on high tiers). */
  sun: THREE.DirectionalLight | SunLight;
  hemi = new THREE.HemisphereLight('#cfe4ff', '#6a5a48', 1);
  fog: THREE.FogExp2;
  /** 0 day … 1 full night; read by towns (lamps), wilds (night spawns), UI (clock). */
  night = 0;
  sunElevation = 30;
  /** Unit vector toward the sun (and the moon), world space. */
  sunDir = new THREE.Vector3(0, 1, 0);
  moonDir = new THREE.Vector3(0, 1, 0);
  readonly state = newSkyState();
  weather: Weathers;

  private camera: THREE.PerspectiveCamera | null = null;
  private pipeline: Pipeline | null = null;
  private mood: MoodMix;
  private target: MoodMix = newMood();
  private pmrem = new THREE.PMREMGenerator(renderer);
  private envScene = new THREE.Scene();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnv = { time: 0, sig: 0 };
  private cloudOff = new THREE.Vector2();
  private lightDir = new THREE.Vector3(0, 1, 0);
  private lastLightDir = new THREE.Vector3();
  private lamps: THREE.PointLight[] = [];
  private lampSpots: THREE.Vector3[] = [];
  private lampScan = -1;
  private lampTimer = 0;
  private cascaded: boolean;

  constructor(private scene: THREE.Scene, camera?: THREE.PerspectiveCamera) {
    this.camera = camera ?? null;
    const w0 = ZONES.map((_, i) => (i === 0 ? 1 : 0));
    this.mood = moodFor(w0);
    this.target = moodFor(w0);

    this.sky = new SkyDome(Q.clouds);
    scene.add(this.sky.mesh);
    const envSky = new THREE.Mesh(this.sky.mesh.geometry, this.sky.material);
    envSky.frustumCulled = false;
    this.envScene.add(envSky);

    // three's fog object only switches the fog chunks on; the colour/density come from FOG_PARAMS
    this.fog = new THREE.FogExp2('#9cc8f0', 0.0015);
    scene.fog = this.fog;

    this.cascaded = Q.cascades > 1 && Q.shadow > 0;
    if (this.cascaded) {
      const s = new SunLight('#fff1dc', 3);
      s.castShadow = true;
      s.shadow.mapSize.set(Q.shadow, Q.shadow);
      s.shadow.camera.far = Q.shadowFar;
      s.shadow.camera.near = 2;
      s.shadow.bias = -0.00025;
      s.shadow.normalBias = 0.045;
      s.shadow.radius = 2.5;
      this.sun = s;
      scene.add(s);
    } else {
      const s = new THREE.DirectionalLight('#fff1dc', 3);
      s.castShadow = Q.shadow > 0;
      if (Q.shadow > 0) s.shadow.mapSize.set(Q.shadow, Q.shadow);
      const H = Q.shadowFar * 0.55;
      const sc = s.shadow.camera;
      sc.left = sc.bottom = -H; sc.right = sc.top = H; sc.near = 1; sc.far = 400;
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.04;
      s.shadow.radius = 2;
      this.sun = s;
      scene.add(s, s.target);
    }
    scene.add(this.hemi);

    for (let i = 0; i < Q.lamps; i++) {
      const l = new THREE.PointLight('#ffb866', 0, 22, 1.6);
      l.castShadow = false;
      this.lamps.push(l);
      scene.add(l);
    }

    this.weather = new Weathers(Q.motes);
    scene.add(this.weather.group);
  }

  /** Called once the post pipeline exists: the grade follows the sky. */
  attach(pipeline: Pipeline, camera: THREE.PerspectiveCamera) {
    this.pipeline = pipeline;
    this.camera = camera;
  }

  setZoneWeights(w: number[]) { moodFor(w, this.target); this.weather.setWeights(w); }

  /** Register a warm light source (lantern, brazier…) that lights up its surroundings at night. */
  addLamp(p: THREE.Vector3) {
    if (!this.lampSpots.some((q) => q.distanceToSquared(p) < 4)) this.lampSpots.push(p.clone());
  }

  update(dt: number, t: number, focus: THREE.Vector3, groundY: number, timeOfDay: number) {
    const k = 1 - Math.exp(-dt * 0.8);
    lerpMood(this.mood, this.target, k);

    // ── sun & moon paths (sun rises ESE, culminates in the south, sets WSW)
    const elev = sunElevation(timeOfDay);
    this.sunElevation = elev;
    const night = clamp((4 - elev) / 12, 0, 1);
    this.night = night;
    const bear = THREE.MathUtils.degToRad(100 + (timeOfDay - 0.25) * 320);
    const e = THREE.MathUtils.degToRad(elev);
    this.sunDir.set(Math.cos(e) * Math.sin(bear), Math.sin(e), -Math.cos(e) * Math.cos(bear)).normalize();
    const mb = bear + Math.PI + 0.35;
    const me = THREE.MathUtils.degToRad(clamp(-elev * 0.85 + 18, 22, 68));
    this.moonDir.set(Math.cos(me) * Math.sin(mb), Math.sin(me), -Math.cos(me) * Math.cos(mb)).normalize();

    const s = evalSky(timeOfDay, this.mood, night, this.state);

    // ── key light: sun above −3°, moon below; intensity dips through the hand-over so shadows never pop
    const useSun = elev > -3;
    const dir = useSun ? this.sunDir : this.moonDir;
    const handover = clamp(Math.abs(elev + 3) / 3, 0, 1);
    this.lightDir.copy(dir);
    // step the light direction (not every frame) so shadow texels don't crawl as the sun moves
    if (this.lastLightDir.angleTo(this.lightDir) > 0.0035 || this.lastLightDir.lengthSq() === 0) this.lastLightDir.copy(this.lightDir);
    const L = this.lastLightDir;
    this.sun.color.copy(s.sunCol);
    this.sun.intensity = s.sunI * handover;
    if (this.sun instanceof SunLight) {
      this.sun.position.copy(L).multiplyScalar(100);
      this.sun.updateMatrixWorld();
    } else {
      this.placeDirectional(this.sun, focus, L);
    }

    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiI;

    // ── fog: aerial perspective + valley mist + far haze that meets the sky dome
    const far = this.camera?.far ?? Q.far;
    const P = FOG_PARAMS;
    P[0] = this.sunDir.x; P[1] = Math.max(this.sunDir.y, -0.2); P[2] = this.sunDir.z; P[3] = 1;
    P[4] = s.aerial.r; P[5] = s.aerial.g; P[6] = s.aerial.b; P[7] = 0.00115 * s.aerialD * Q.fog;
    P[8] = s.hazeAway.r; P[9] = s.hazeAway.g; P[10] = s.hazeAway.b; P[11] = far * 0.42;
    P[12] = s.hazeSun.r; P[13] = s.hazeSun.g; P[14] = s.hazeSun.b; P[15] = far * 0.97;
    P[16] = s.mist.r; P[17] = s.mist.g; P[18] = s.mist.b; P[19] = 0.0022 * s.mistD * (0.55 + 0.45 * Math.max(night, morningMist(timeOfDay)));
    P[20] = 0.055; P[21] = groundY - 2; P[22] = s.glowPow; P[23] = 0.72;
    this.fog.color.copy(s.hazeAway);

    // ── sky dome + clouds drifting downwind
    const wind = LOOK.uWind.value;
    this.cloudOff.x += wind.x * dt * 0.0022;
    this.cloudOff.y += wind.y * dt * 0.0022;
    this.sky.update(s, this.sunDir, this.moonDir, night, t, this.cloudOff);

    // ── shared vegetation uniforms
    LOOK.uTime.value = t;
    LOOK.uSunDir.value.copy(L);
    LOOK.uSunCol.value.copy(s.sunCol).multiplyScalar(this.sun.intensity);
    LOOK.uAmbTop.value.copy(s.hemiSky).multiplyScalar(s.hemiI);
    LOOK.uAmbBottom.value.copy(s.hemiGround).multiplyScalar(s.hemiI);
    LOOK.uEnvAmb.value.copy(s.zenith).lerp(s.horizon, 0.6).multiplyScalar(s.env);
    LOOK.uNight.value = night;
    wind.w += dt * (0.05 + wind.z * 0.06);
    LOOK.uPlayer.value.copy(focus);

    // ── colour grade follows the sky
    const g = this.pipeline?.grade;
    if (g) {
      g.set({
        exposure: s.exposure, wb: s.wb, saturation: s.sat, vibrance: s.vibrance, shadowTint: s.shadowTint, highTint: s.highTint,
        lookPower: s.lookPower, lookSat: s.lookSat, contrast: s.contrast,
      });
      if (this.pipeline?.bloom) this.pipeline.bloom.intensity = 0.55 * s.bloom;
    }

    // ── warm local lights at night
    this.updateLamps(dt, focus, night);

    // ── weather particles
    this.weather.update(dt, t, focus, groundY, this.target, this.mood, s, night);

    // ── image-based light: re-captured when the sky has changed enough
    const now = performance.now();
    if (!this.envRT || (Math.abs(skySig(s) - this.lastEnv.sig) > 0.04 && now - this.lastEnv.time > 1800)) this.refreshEnv();
    this.scene.environmentIntensity = s.env;
  }

  refreshEnv() {
    const s = this.state;
    this.lastEnv.sig = skySig(s);
    this.lastEnv.time = performance.now();
    const old = this.envRT;
    this.sky.u.uEnv.value = 1;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.03, 0.1, 200, { size: Q.env });
    this.sky.u.uEnv.value = 0;
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = s.env;
    old?.dispose();
  }

  /** Single shadow map (phones): centred ahead of the camera and snapped to texels in light space. */
  private placeDirectional(light: THREE.DirectionalLight, focus: THREE.Vector3, dir: THREE.Vector3) {
    const H = Q.shadowFar * 0.55;
    const c = _v.copy(focus);
    if (this.camera) {
      const fwd = this.camera.getWorldDirection(new THREE.Vector3());
      fwd.y = 0;
      if (fwd.lengthSq() > 1e-4) c.addScaledVector(fwd.normalize(), H * 0.45);
    }
    // light-space snapping
    _m.lookAt(new THREE.Vector3(), dir.clone().negate(), Math.abs(dir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : UP);
    const inv = _m.clone().invert();
    c.applyMatrix4(inv);
    const texel = (2 * H) / Math.max(256, Q.shadow);
    c.x = Math.round(c.x / texel) * texel;
    c.y = Math.round(c.y / texel) * texel;
    c.applyMatrix4(_m);
    light.target.position.copy(c);
    light.position.copy(c).addScaledVector(dir, 180);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
  }

  private updateLamps(dt: number, focus: THREE.Vector3, night: number) {
    if (!this.lamps.length) return;
    // discover emissive lanterns once the towns are built (first frames), then every few seconds
    this.lampTimer -= dt;
    if (this.lampScan < 3 && this.lampTimer <= 0) {
      this.lampScan++;
      this.lampTimer = 2;
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m === this.sky.mesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!mat || Array.isArray(mat) || !mat.emissive || mat.emissiveIntensity < 1) return;
        const e = mat.emissive;
        if (e.r < 0.5 || e.r < e.b * 1.6 || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
        m.getWorldPosition(_v);
        this.addLamp(_v);
      });
    }
    const fade = clamp((night - 0.25) / 0.5, 0, 1);
    const cam = this.camera?.position ?? focus;
    const near = this.lampSpots
      .map((p) => ({ p, d: p.distanceToSquared(cam) }))
      .filter((q) => q.d < 60 * 60)
      .sort((a, b) => a.d - b.d);
    this.lamps.forEach((l, i) => {
      const spot = near[i];
      if (!spot || fade <= 0) { l.intensity = 0; return; }
      l.position.copy(spot.p);
      const edge = clamp(1 - (Math.sqrt(spot.d) - 40) / 20, 0, 1);
      l.intensity = 14 * fade * edge * (0.92 + 0.08 * Math.sin(performance.now() * 0.004 + i * 1.7));
    });
  }
}

/** 0..1 — extra ground mist around dawn. */
function morningMist(t: number) {
  const d = Math.abs(t - 0.28);
  return clamp(1 - d / 0.08, 0, 1);
}

const skySig = (s: { zenith: THREE.Color; horizon: THREE.Color; hazeSun: THREE.Color; sunI: number; cloudCover: number; aurora: number }) =>
  s.zenith.r * 3 + s.horizon.g * 5 + s.hazeSun.b * 7 + s.sunI * 0.3 + s.cloudCover * 2 + s.aurora;
