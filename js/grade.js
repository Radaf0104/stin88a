// Final colour grade, like a light Lightroom preset: contrast around mid-grey, saturation, warm highlights / cool
// shadows (split toning), a shadow lift, a white point and a soft vignette. Values per time of day live in
// TIMES[...].grade (js/environment.js).
// It used to be a separate full-screen pass after the whole picture was drawn (post-processing). Now the exact same
// formula runs at the very end of every material's own shader, on the finished display colour (after the tone curve
// and sRGB conversion, as before), so the picture keeps its look without a second pass over the screen.
import * as THREE from "three";

export const GRADE_DEFAULT = { gain: 1, contrast: 1, saturation: 1, lift: 0, warm: [1, 1, 1], cool: [1, 1, 1], vignette: 0, gamma: 1 };

const GLSL = /* glsl */ `
  if (uGradeOn > 0.5) {
    vec3 gc = gl_FragColor.rgb;
    float gL = dot(gc, vec3(0.2126, 0.7152, 0.0722));
    gc *= mix(uGradeCool, uGradeWarm, smoothstep(0.15, 0.85, gL));          // split toning
    gc = clamp((gc - 0.5) * uGradeContrast + 0.5, 0.0, 1.0);                 // contrast
    gc = pow(gc, vec3(uGradeGamma));                                         // midtone gamma (0 and 1 stay put)
    gc = gc + uGradeLift * (1.0 - gc) * (1.0 - smoothstep(0.0, 0.5, gc));    // shadow lift
    float gL2 = dot(gc, vec3(0.2126, 0.7152, 0.0722));
    gc = mix(vec3(gL2), gc, uGradeSaturation);                               // saturation
    vec2 gUv = gl_FragCoord.xy / uGradeRes;                                  // vignette (outer edge only)
    float gA = uGradeRes.x / uGradeRes.y;
    float gR = length((gUv - 0.5) * vec2(gA, 1.0)) / length(vec2(gA * 0.5, 0.5));
    gc *= 1.0 - uGradeVignette * smoothstep(0.6, 1.0, gR);
    gl_FragColor.rgb = clamp(gc * uGradeGain, 0.0, 1.0);
  }`;

// Before the tone curve (in linear light), to match the old post-processing order:
//  - the distance haze (fog) is mixed in here, so the tone curve brightens it like everything else (three.js would
//    otherwise add it after the tone curve, which makes far trees and hills darker than before)
//  - the old bloom's brightening of bright surfaces: bloom took every pixel brighter than 0.9 and added it back,
//    blurred, at 0.22 × 5 levels × 0.6 (its strength / radius) ≈ 0.66 × its colour. Over a sunlit facade that is a
//    big, even lift, so it is added per pixel here (the soft halo past the edges of bright areas is the only part lost).
const PRE_TONEMAP = /* glsl */ `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float preFog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float preFog = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    vec3 preFogLin = mix(fogColor / 12.92, pow((fogColor + 0.055) / 1.055, vec3(2.4)), step(0.04045, fogColor)); // fogColor arrives in sRGB
    gl_FragColor.rgb = mix(gl_FragColor.rgb, preFogLin, preFog);
  #endif
  if (uBloomK > 0.0) {
    float preL = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor.rgb += uBloomK * gl_FragColor.rgb * smoothstep(uBloomLo, uBloomHi, preL) + uBloomAmb * gl_FragColor.rgb;
  }`;

export function createGrade() {
  const U = {
    uBloomK: { value: 0.22 * 5 * 0.6 }, uBloomLo: { value: 0.9 }, uBloomHi: { value: 0.91 }, uBloomAmb: { value: 0.12 },
    uGradeOn: { value: 1 }, uGradeContrast: { value: 1 }, uGradeSaturation: { value: 1 }, uGradeLift: { value: 0 },
    uGradeWarm: { value: new THREE.Vector3(1, 1, 1) }, uGradeCool: { value: new THREE.Vector3(1, 1, 1) },
    uGradeVignette: { value: 0 }, uGradeGain: { value: 1 }, uGradeGamma: { value: 1 }, uGradeRes: { value: new THREE.Vector2(1, 1) },
  };
  let bloomOn = true;
  // k / lo / hi: bloom's own strength and threshold; amb: the even glow its widest blur spread over the whole picture
  // (tuned against the old post-processed renders: average brightness within ~1–2 % on overview, facade and lawn)
  const bloomTune = { k: 0.22 * 5 * 0.6, lo: 0.9, hi: 0.91, amb: 0.12 };
  function applyBloom() {
    U.uBloomK.value = bloomOn ? bloomTune.k : 0; U.uBloomAmb.value = bloomOn ? bloomTune.amb : 0;
    U.uBloomLo.value = bloomTune.lo; U.uBloomHi.value = bloomTune.hi;
  }
  function patch(m) {
    if (!m || m.userData.gradePatched) return;
    m.userData.gradePatched = true;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      Object.assign(sh.uniforms, U);
      let f = sh.fragmentShader;
      const decl = "uniform float uBloomK, uBloomLo, uBloomHi, uBloomAmb, uGradeOn, uGradeContrast, uGradeSaturation, uGradeLift, uGradeVignette, uGradeGain, uGradeGamma; uniform vec3 uGradeWarm, uGradeCool; uniform vec2 uGradeRes;\n";
      f = f.includes("#include <common>") ? f.replace("#include <common>", "#include <common>\n" + decl) : decl + f;
      if (f.includes("#include <tonemapping_fragment>")) {
        f = f.replace("#include <fog_fragment>", ""); // (moved before the tone curve, see PRE_TONEMAP)
        f = f.replace("#include <tonemapping_fragment>", PRE_TONEMAP + "\n#include <tonemapping_fragment>");
      }
      // after the tone curve, sRGB conversion and fog (= the finished colour the old pass received)
      if (f.includes("#include <premultiplied_alpha_fragment>")) f = f.replace("#include <premultiplied_alpha_fragment>", GLSL + "\n#include <premultiplied_alpha_fragment>");
      else f = f.replace("#include <colorspace_fragment>", "#include <colorspace_fragment>\n" + GLSL);
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "|grade";
    m.needsUpdate = true;
  }
  return {
    uniforms: U, patch,
    patchScene(root) { root.traverse((o) => { if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) patch(m); }); },
    set(g = GRADE_DEFAULT) {
      const v = { ...GRADE_DEFAULT, ...g };
      U.uGradeGain.value = v.gain; U.uGradeContrast.value = v.contrast; U.uGradeSaturation.value = v.saturation;
      U.uGradeLift.value = v.lift; U.uGradeVignette.value = v.vignette; U.uGradeGamma.value = v.gamma; U.uGradeWarm.value.set(...v.warm); U.uGradeCool.value.set(...v.cool);
    },
    setResolution(w, h) { U.uGradeRes.value.set(w, h); },
    set enabled(on) { U.uGradeOn.value = on ? 1 : 0; },
    set bloom(on) { bloomOn = on; applyBloom(); },
    tuneBloom(k, lo, hi, amb) { Object.assign(bloomTune, { k, lo, hi, amb }); applyBloom(); },
  };
}

// The sky photo as an object in the scene (instead of scene.background), drawn with three.js's own background shader,
// so the grade can be added to it too. Call update() before every render: it copies scene.background / intensity /
// rotation and hides scene.background for that render (restore()).
export function createSky(renderer) {
  const sh = THREE.ShaderLib.backgroundCube;
  const mat = new THREE.ShaderMaterial({
    name: "SkyBackground", uniforms: THREE.UniformsUtils.clone(sh.uniforms), vertexShader: sh.vertexShader, fragmentShader: sh.fragmentShader,
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
  });
  Object.defineProperty(mat, "envMap", { get() { return this.uniforms.envMap.value; } }); // (as three.js does: picks the right shader variant)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1e9;
  mesh.onBeforeRender = (r, s, cam) => mesh.matrixWorld.copyPosition(cam.matrixWorld);
  const cubes = new WeakMap(), e = new THREE.Euler(), m4 = new THREE.Matrix4();
  const cubeOf = (t) => { // equirectangular photo -> cube (cached), like three.js's own background
    if (t.isCubeTexture || t.mapping === THREE.CubeReflectionMapping) return t;
    let rt = cubes.get(t);
    if (!rt) { rt = new THREE.WebGLCubeRenderTarget(t.image.height); rt.fromEquirectangularTexture(renderer, t); cubes.set(t, rt); }
    return rt.texture;
  };
  let held = null;
  return {
    mesh,
    update(scene) {
      const bg = scene.background;
      if (!bg || !bg.isTexture) { mesh.visible = false; held = null; return; }
      const tex = cubeOf(bg), real = tex.isCubeTexture && !tex.isRenderTargetTexture;
      mat.uniforms.envMap.value = tex;
      mat.uniforms.flipEnvMap.value = real ? -1 : 1;
      mat.uniforms.backgroundBlurriness.value = scene.backgroundBlurriness;
      mat.uniforms.backgroundIntensity.value = scene.backgroundIntensity;
      e.copy(scene.backgroundRotation); e.x *= -1; e.y *= -1; e.z *= -1; if (real) { e.y *= -1; e.z *= -1; }
      mat.uniforms.backgroundRotation.value.setFromMatrix4(m4.makeRotationFromEuler(e));
      mat.toneMapped = THREE.ColorManagement.getTransfer(bg.colorSpace) !== THREE.SRGBTransfer;
      mesh.visible = true;
      held = bg; scene.background = null;
    },
    restore(scene) { if (held) { scene.background = held; held = null; } },
  };
}
