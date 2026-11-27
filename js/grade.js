// Final colour grade, like a light Lightroom preset: contrast around mid-grey, saturation, warm highlights / cool
// shadows (split toning), a shadow lift, a white point and a soft vignette. Values per time of day live in
// TIMES[...].grade (js/environment.js).
// It used to be a separate full-screen pass after the whole picture was drawn (post-processing). Now the exact same
// formula runs at the very end of every material's own shader, on the finished display colour (after the tone curve
// and sRGB conversion, as before), so the picture keeps its look without a second pass over the screen.
import * as THREE from "three";
import { GPU, TSL } from "./gpu.js";

// glow*: (M3, new renderer's AO tiers) the real bloom - only what is brighter than glowThreshold in linear light glows.
// By day sunlit plaster reaches ~3-4, so only sun glints pass 4.5; at night the lamps and LED lines (~1-2.5) do.
export const GRADE_DEFAULT = { gain: 1, contrast: 1, saturation: 1, lift: 0, warm: [1, 1, 1], cool: [1, 1, 1], vignette: 0, gamma: 1, glowThreshold: 4.5, glowStrength: 0.12 };

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
    uGlowThreshold: { value: 4.5 }, uGlowStrength: { value: 0.12 },
  };
  // (M2) new renderer: the same numbers as TSL uniform nodes (they also have .value, so set() below works unchanged)
  if (GPU) for (const k in U) U[k] = TSL.uniform(U[k].value);
  let bloomOn = true;
  // k / lo / hi: bloom's own strength and threshold; amb: the even glow its widest blur spread over the whole picture
  // (tuned against the old post-processed renders: average brightness within ~1–2 % on overview, facade and lawn)
  const bloomTune = { k: 0.22 * 5 * 0.6, lo: 0.9, hi: 0.91, amb: 0.12 };
  function applyBloom() {
    U.uBloomK.value = bloomOn ? bloomTune.k : 0; U.uBloomAmb.value = bloomOn ? bloomTune.amb : 0;
    U.uBloomLo.value = bloomTune.lo; U.uBloomHi.value = bloomTune.hi;
  }
  function patch(m) {
    if (GPU) return; // (M2) new renderer: graded once in the post pass (createPost), materials untouched
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
      U.uGlowThreshold.value = v.glowThreshold; U.uGlowStrength.value = v.glowStrength;
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
  // (M2) new renderer: the sky stays scene.background (it is graded by the post pass with everything else)
  if (GPU) return { mesh: new THREE.Group(), update() {}, restore() {} };
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

// (M2, M3) New renderer only. The picture is drawn once into the pass's target, then one TSL chain finishes it:
//  1. ambient occlusion (GTAO, from the depth buffer) darkens corners, recesses, soffits and furniture contact
//  2. bloom: a soft glow around the brightest surfaces (lamps, LED lines, sunlit white plaster), in linear light; on
//     the tier without it, the old per-pixel bloom brightening stands in (PRE_TONEMAP above)
//  3. the tone curve + sRGB (renderOutput, using the renderer's toneMapping / exposure / colour space)
//  4. the grade on the display colour (GLSL above, line for line)
//  5. edge smoothing: 4x multisampling of the scene, or SMAA on the finished picture where AO reads the depth buffer
// Q = the quality tier (QUALITY below). U = the grade's uniforms (TSL uniform nodes on this renderer). render() rebuilds
// the chain when the tone curve changes (day = Neutral, golden / night = AgX).
const POST = GPU ? await Promise.all([
  import("three/addons/tsl/display/GTAONode.js"), import("three/addons/tsl/display/BloomNode.js"), import("three/addons/tsl/display/SMAANode.js"),
  import("three/addons/tsl/display/DenoiseNode.js"),
]).then(([a, b, s, d]) => ({ ao: a.ao, bloom: b.bloom, smaa: s.smaa, denoise: d.denoise })) : null;

// Ultra: full-resolution AO + bloom (discrete desktop GPUs). High: half-resolution AO + bloom (default on desktops /
// laptops). Balanced: no AO, no real bloom, 4x MSAA (phones / tablets). ?quality=ultra|high|balanced overrides.
export const QUALITY = {
  ultra:    { name: "ultra", ao: true, aoScale: 1, aoSamples: 16, bloom: true, msaa: 0, smaa: true },
  high:     { name: "high", ao: true, aoScale: 0.5, aoSamples: 12, bloom: true, msaa: 0, smaa: true },
  balanced: { name: "balanced", ao: false, bloom: false, msaa: 4, smaa: false },
};

export function createPost(renderer, scene, camera, U, Q = QUALITY.high) {
  const { pass, vec3, vec4, vec2, float, dot, mix, smoothstep, clamp, pow, length, screenUV, screenSize, renderOutput, uniform } = TSL;
  const LUM = vec3(0.2126, 0.7152, 0.0722);
  const aoAmount = uniform(1); // 0 = AO off (the isolated white views fade it out with the rest)
  // One chain = one scene pass + the finishing steps. GTAO has to read the depth buffer, which WebGPU can't do on the
  // combined depth + stencil buffer the section caps need (js/main.js counts surfaces in the stencil). So the AO tiers
  // keep two chains: without a plan cut (exterior views) a plain depth buffer + AO; with a cut (floor / room views, which
  // fade the AO out anyway) depth + stencil for the caps, no AO. Balanced has a single (stencil) chain.
  function chain(stencil) {
    let depthTexture;
    if (stencil) { depthTexture = new THREE.DepthTexture(); depthTexture.format = THREE.DepthStencilFormat; depthTexture.type = THREE.UnsignedInt248Type; }
    const scenePass = pass(scene, camera, { samples: Q.msaa, stencilBuffer: stencil, ...(depthTexture ? { depthTexture } : {}) });
    const src = scenePass.getTextureNode("output");
    let lin = src.rgb, aoPass = null;
    if (Q.ao && !stencil) {
      aoPass = POST.ao(scenePass.getTextureNode("depth"), null, camera);
      aoPass.resolutionScale = Q.aoScale;
      aoPass.samples.value = Q.aoSamples;
      // 0.35 m reach: window boxes, soffits and fin gaps darken, without dark halos around thin railings (0.6 m had them)
      aoPass.radius.value = 0.35; aoPass.thickness.value = 1; aoPass.distanceExponent.value = 1.3; aoPass.scale.value = 1.1;
      // edge-aware blur of the AO (normals rebuilt from depth): removes its sampling grain without bleeding over edges
      const depthNode = scenePass.getTextureNode("depth");
      const aoClean = POST.denoise(aoPass.getTextureNode(), depthNode, null, camera);
      lin = lin.mul(mix(float(1), aoClean.r, aoAmount));
    }
    // the old per-pixel brightening stays on every tier (the look and brightness were tuned with it); the AO tiers add
    // a real, selective glow on top: only what passes the time-of-day threshold (sun glints by day, lamps / LEDs at night)
    const L0 = dot(lin, LUM);
    const lifted = lin.add(lin.mul(U.uBloomK).mul(smoothstep(U.uBloomLo, U.uBloomHi, L0))).add(lin.mul(U.uBloomAmb));
    // (bloom reads the scene texture itself: given the AO expression it first rendered that into a full-size texture)
    lin = Q.bloom ? lifted.add(POST.bloom(src, U.uGlowStrength, 0.5, U.uGlowThreshold).rgb) : lifted;
    const shown = renderOutput(vec4(lin, src.a));
    let gc = shown.rgb;
    const gL = dot(gc, LUM);
    gc = gc.mul(mix(U.uGradeCool, U.uGradeWarm, smoothstep(0.15, 0.85, gL)));                      // split toning
    gc = clamp(gc.sub(0.5).mul(U.uGradeContrast).add(0.5), 0.0, 1.0);                               // contrast
    gc = pow(gc, vec3(U.uGradeGamma));                                                               // midtone gamma
    gc = gc.add(U.uGradeLift.mul(float(1).sub(gc)).mul(float(1).sub(smoothstep(0.0, 0.5, gc))));   // shadow lift
    gc = mix(vec3(dot(gc, LUM)), gc, U.uGradeSaturation);                                            // saturation
    const aspect = screenSize.x.div(screenSize.y);
    const gR = length(screenUV.sub(0.5).mul(vec2(aspect, 1))).div(length(vec2(aspect.mul(0.5), 0.5)));
    gc = gc.mul(float(1).sub(U.uGradeVignette.mul(smoothstep(0.6, 1.0, gR))));                    // vignette
    gc = clamp(gc.mul(U.uGradeGain), 0.0, 1.0);
    let out = vec4(mix(shown.rgb, gc, U.uGradeOn), 1);
    if (Q.smaa) out = POST.smaa(out);
    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputColorTransform = false; // (done above, before the grade)
    pipeline.outputNode = out;
    return { pipeline, scenePass, aoPass };
  }
  const cutChain = chain(true);
  const openChain = Q.ao ? chain(false) : cutChain;
  const chains = [...new Set([openChain, cutChain])];
  let tm = renderer.toneMapping, cs = renderer.outputColorSpace;
  return {
    aoAmount, quality: Q, chains,
    aoPass: openChain.aoPass,
    // the render targets the scene is drawn into (shaders are pre-compiled for each); [0] = the start-up view's
    targets: () => chains.map((c) => c.scenePass.renderTarget),
    render(cut = false) {
      if (renderer.toneMapping !== tm || renderer.outputColorSpace !== cs) {
        tm = renderer.toneMapping; cs = renderer.outputColorSpace;
        for (const c of chains) c.pipeline.needsUpdate = true;
      }
      (cut ? cutChain : openChain).pipeline.render();
    },
  };
}
