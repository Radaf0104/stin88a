// Isolation ("section box") for the floor view, the single-room view and walking room by room.
// Every scene material gets one small shader addition: a fragment whose world position lies outside a plan-view
// mask (a black/white picture of the allowed area, seen from above) or below a height is dissolved away.
// `fade` (0..1) says how much of the outside has dissolved, so the view can melt to white while the camera flies.
// The mask only changes a texture and a few numbers, never the shaders, so switching views is instant (no shader
// rebuild, no freeze).
import * as THREE from "three";

export function createIsolation() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048; canvas.height = 1024; // ~2 cm per pixel: room edges land within a wall's thickness
  const g = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false; // canvas row 0 = smallest z (otherwise the plan would be read mirrored north-south)
  const U = {
    uIsoMask: { value: tex },
    uIsoRect: { value: new THREE.Vector4(0, 0, 1, 1) }, // world x0, z0, width, depth covered by the mask
    uIsoMinY: { value: -1e6 },                           // nothing below this height (floors under the chosen one)
    uIsoFade: { value: 0 },                              // 0 = everything shown, 1 = outside fully gone
    // room view: the walls between the camera and the room (and what hangs on them) are cut away, like a doll's house
    uIsoCutA: { value: new THREE.Vector4(0, 0, 0, 0) },  // two plan rectangles (x0, z0, x1, z1) ...
    uIsoCutB: { value: new THREE.Vector4(0, 0, 0, 0) },
    uIsoCutY: { value: 1e6 },                            // ... cut above this height (the floor stays)
    uIsoDeepY: { value: -1e6 },                          // "deep" areas (green in the mask, e.g. the stairwell) go down to here
  };
  let rect = { x0: 0, z0: 0, w: 1, d: 1 };

  // The mask covers a fixed area of the world (the building plus a margin), set once.
  function setBounds(box3, margin = 4) {
    rect = { x0: box3.min.x - margin, z0: box3.min.z - margin, w: box3.max.x - box3.min.x + 2 * margin, d: box3.max.z - box3.min.z + 2 * margin };
    U.uIsoRect.value.set(rect.x0, rect.z0, rect.w, rect.d);
  }
  const px = (x, z) => [((x - rect.x0) / rect.w) * canvas.width, ((z - rect.z0) / rect.d) * canvas.height];

  // polygons: arrays of [x, z] world points. expand (m) grows each one outwards (to include the walls around a room).
  // subtract: areas cut out again afterwards (not grown, so the walls around them stay), e.g. rooms seen from a corridor.
  // deep / deepY: areas that also show what lies below minY, down to deepY (walking: the stair flight down, instead of
  // a white hole at the top of the stairs). Drawn in the green channel, so they never widen the plan mask itself.
  function setMask(polygons, expand = 0, minY = -1e6, subtract = [], deep = [], deepY = minY) {
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#000"; g.fillRect(0, 0, canvas.width, canvas.height);
    g.lineJoin = "miter"; g.miterLimit = 4;
    g.lineWidth = Math.max(1, (2 * expand * canvas.width) / rect.w);
    const path = (poly) => { g.beginPath(); poly.forEach(([x, z], i) => { const [a, b] = px(x, z); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); };
    g.fillStyle = g.strokeStyle = "#fff";
    for (const poly of polygons) { if (!poly || poly.length < 3) continue; path(poly); g.fill(); if (expand > 0) g.stroke(); }
    g.fillStyle = "#000";
    for (const poly of subtract) { if (!poly || poly.length < 3) continue; path(poly); g.fill(); }
    g.globalCompositeOperation = "lighter"; g.fillStyle = "#0f0";
    for (const poly of deep) { if (!poly || poly.length < 3) continue; path(poly); g.fill(); }
    g.globalCompositeOperation = "source-over";
    tex.needsUpdate = true;
    U.uIsoMinY.value = minY;
    U.uIsoDeepY.value = deepY;
  }

  // Adds the mask test to a material (once). Keeps any shader changes the material already has (glass, battens…).
  function patch(m) {
    if (!m || m.userData.isoPatched || !(m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
    m.userData.isoPatched = true;
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vIsoW;")
        .replace("#include <project_vertex>", `#include <project_vertex>
          vec4 isoP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            isoP = instanceMatrix * isoP;
          #endif
          vIsoW = (modelMatrix * isoP).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vIsoW;
          uniform sampler2D uIsoMask; uniform vec4 uIsoRect; uniform float uIsoMinY; uniform float uIsoFade; uniform float uIsoDeepY;
          uniform vec4 uIsoCutA; uniform vec4 uIsoCutB; uniform float uIsoCutY;`)
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
          if (vIsoW.y > uIsoCutY && (
              (vIsoW.x > uIsoCutA.x && vIsoW.x < uIsoCutA.z && vIsoW.z > uIsoCutA.y && vIsoW.z < uIsoCutA.w) ||
              (vIsoW.x > uIsoCutB.x && vIsoW.x < uIsoCutB.z && vIsoW.z > uIsoCutB.y && vIsoW.z < uIsoCutB.w))) discard;
          if (uIsoFade > 0.0) {
            vec2 isoUv = (vIsoW.xz - uIsoRect.xy) / uIsoRect.zw;
            vec2 isoM = (isoUv.x >= 0.0 && isoUv.x <= 1.0 && isoUv.y >= 0.0 && isoUv.y <= 1.0) ? texture2D(uIsoMask, isoUv).rg : vec2(0.0);
            float isoIn = isoM.x;
            if (vIsoW.y < uIsoMinY) isoIn = (isoM.y > 0.5 && vIsoW.y > uIsoDeepY) ? 1.0 : 0.0;
            // dissolve: a fixed screen pattern decides which pixels go first, so the outside melts away evenly
            float isoD = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (isoIn < 0.5 && isoD < uIsoFade) discard;
          }`);
    };
    m.customProgramCacheKey = () => (prevKey ? prevKey() : "") + "|iso";
    m.needsUpdate = true;
  }
  function patchScene(root, skip = () => false) {
    root.traverse((o) => {
      if (!o.isMesh || skip(o)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) patch(m);
    });
  }

  return {
    uniforms: U, setBounds, setMask, patch, patchScene,
    get fade() { return U.uIsoFade.value; }, set fade(v) { U.uIsoFade.value = v; },
  };
}
