import * as THREE from 'three';

// Aerial perspective for every lit material in the scene.
//
// three's built-in fog is one flat colour, which is what made the island milky. This replaces the fog
// shader chunks globally with height + distance fog whose colour depends on the view direction relative
// to the sun: distant ridges take on the (blue-violet) aerial colour, valleys hold low mist, and at the
// far plane everything melts into the exact sky colour the dome draws at the horizon.
//
// The parameters live in ONE Float32Array. `UniformsUtils.clone` copies typed arrays by reference, so every
// material compiled from ShaderLib shares it and Atmosphere only has to write it once per frame. Materials
// that don't carry the uniform (custom ShaderMaterials with fog: true built before this ran) keep the stock
// exp2 fog: their `wmFog[0].w` reads 0.

/**
 * Six vec4s:
 * 0 sun dir.xyz, enabled (1)
 * 1 aerial rgb, aerial density (1/m)
 * 2 horizon haze rgb (away from the sun), haze start (m)
 * 3 sun-side haze rgb, haze end (m)
 * 4 height-fog rgb, height-fog density
 * 5 height falloff (1/m), height-fog base (m), sun glow power, max aerial blend
 */
export const FOG_PARAMS = new Float32Array(24);

/** GLSL shared by the fog chunk and the sky dome (so the horizon matches exactly). */
export const FOG_GLSL = /* glsl */ `
  vec3 wmHaze(vec3 dir) {
    float s = pow(max(dot(dir, wmFog[0].xyz), 0.0), wmFog[5].z);
    return mix(wmFog[2].rgb, wmFog[3].rgb, s);
  }
  vec3 wmApplyFog(vec3 col, vec3 wpos, vec3 cam) {
    vec3 v = wpos - cam;
    float d = length(v);
    vec3 dir = v / max(d, 1e-3);
    float s = pow(max(dot(dir, wmFog[0].xyz), 0.0), wmFog[5].z);
    // aerial perspective: in-scattered light tints distance blue-violet but never erases it; the air
    // thins with altitude (scale height 380 m), so looking down from the summit stays clear
    float ka = 1.0 / 380.0;
    float ya = max(cam.y - wmFog[5].y, 0.0);
    float kda = ka * (wpos.y - cam.y);
    float rayA = abs(kda) > 1e-3 ? (1.0 - exp(-kda)) / kda : 1.0;
    float aer = (1.0 - exp(-d * wmFog[1].w * exp(-ka * ya) * rayA)) * wmFog[5].w;
    col = mix(col, mix(wmFog[1].rgb, wmFog[3].rgb, s * 0.45), aer);
    // height fog: analytic integral of density * exp(-k (y - base)) along the view ray
    float k = wmFog[5].x;
    float y0 = cam.y - wmFog[5].y;
    float dy = wpos.y - cam.y;
    float kd = k * dy;
    float ray = abs(kd) > 1e-3 ? (1.0 - exp(-kd)) / kd : 1.0;
    float hf = 1.0 - exp(-wmFog[4].w * exp(-k * y0) * d * ray);
    col = mix(col, mix(wmFog[4].rgb, wmFog[3].rgb, s * 0.35), clamp(hf, 0.0, 0.92));
    // far haze: land at the far plane becomes the sky dome's horizon colour
    float hz = smoothstep(wmFog[2].w, wmFog[3].w, d);
    return mix(col, mix(wmFog[2].rgb, wmFog[3].rgb, s), hz);
  }
`;

let installed = false;

export function installFog() {
  if (installed) return;
  installed = true;
  (THREE.UniformsLib.fog as Record<string, THREE.IUniform>).wmFog = { value: FOG_PARAMS };
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms && 'fogColor' in lib.uniforms) lib.uniforms.wmFog = { value: FOG_PARAMS };
  }
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying float vFogDepth;
      varying vec3 vFogWorld;
    #endif`;
  // world position from the view-space position: camera + R^T * mv (works for instancing, skinning, sprites)
  C.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogDepth = - mvPosition.z;
      vFogWorld = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
    #endif`;
  C.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying float vFogDepth;
      varying vec3 vFogWorld;
      uniform vec4 wmFog[ 6 ];
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
      ${FOG_GLSL}
    #endif`;
  C.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      if ( wmFog[ 0 ].w > 0.5 ) {
        gl_FragColor.rgb = wmApplyFog( gl_FragColor.rgb, vFogWorld, cameraPosition );
      } else {
        #ifdef FOG_EXP2
          float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
        #else
          float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        #endif
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
      }
    #endif`;
}

/** Same maths on the CPU (for particles / sanity checks). */
export function fogUniform() { return { value: FOG_PARAMS }; }
