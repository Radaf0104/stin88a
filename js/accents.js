// Room accents (round 22 of IMPROVEMENT_LOG.md, Nagoya Hill style, user-approved): soft contact shadows under the
// bed and the floor-standing casework, a warm LED line along the foot of every full-height unit (with its floor wash)
// and LED lines under the open shelves ("lit niche"). Positions come from data/room_accents.json
// (tools/build-accents.mjs, measured on the furniture of every room); nothing here touches the furniture itself.
// Per level: three GPU-instanced meshes (shadows, LED lines, floor washes) with shared materials - 12 draw calls in all.
// Brightness: time of day (glow: day 0, golden 0.4, night 1) x the room's light switch (style rooms, js/roomstyle.js).
import * as THREE from "three";
import { GPU, TSL } from "./gpu.js";

const WARM = new THREE.Color(0xffc98f);
const FALLOFF = 0.12; // m: how far a contact shadow fades out beyond the furniture's foot

function shadowMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.name = "accent_shadow";
  if (GPU) { // (M2) the same fall-off as TSL nodes; each instance's half size + strength come in the "accHalf" attribute
    const { attribute, positionGeometry, varying, vec2, vec3, max, abs, length, smoothstep, float } = TSL;
    const a = attribute("accHalf", "vec3"), half = varying(a.xy), k = varying(a.z);
    const P = varying(positionGeometry.xz.mul(2).mul(a.xy));
    const accQ = max(abs(P).sub(half.sub(FALLOFF)), vec2(0));
    const accK = float(1).sub(smoothstep(0, FALLOFF, length(accQ)));
    m.colorNode = vec3(0);
    m.opacityNode = accK.mul(accK).mul(k);
    return m;
  }
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vAccP; varying vec2 vAccHalf;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vAccHalf = 0.5 * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
        #else
          vAccHalf = vec2(0.5);
        #endif
        vAccP = position.xz * 2.0 * vAccHalf;`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vAccP; varying vec2 vAccHalf;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec2 accQ = max(abs(vAccP) - (vAccHalf - ${FALLOFF.toFixed(3)}), 0.0);
        float accK = 1.0 - smoothstep(0.0, ${FALLOFF.toFixed(3)}, length(accQ));
        #ifdef USE_INSTANCING_COLOR
          diffuseColor.a *= accK * accK * vColor.r;
        #else
          diffuseColor.a *= accK * accK * 0.45;
        #endif
        diffuseColor.rgb = vec3(0.0);`);
  };
  m.customProgramCacheKey = () => "accent_shadow";
  return m;
}
function washTexture() {
  const c = document.createElement("canvas"); c.width = 4; c.height = 64;
  const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export async function createAccents({ root, levelObjects, url = "data/room_accents.json" }) {
  let data; try { data = await (await fetch(url)).json(); } catch { return null; }
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), box = new THREE.BoxGeometry(1, 1, 1);
  const shadowMat = shadowMaterial();
  const ledMat = new THREE.MeshBasicMaterial({ color: WARM }); ledMat.name = "accent_led";
  const washMat = new THREE.MeshBasicMaterial({ color: WARM, map: washTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); washMat.name = "accent_wash";
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const lines = [], washes = []; // { mesh, rooms: [label per instance] }
  const roomK = new Map(); // label -> light switch 0..1 (rooms without one stay at 1)
  let glow = 0, plain = 0; // plain: the isolated room / floor / walk views (even white light, no time of day)
  const add = (mesh, floor, order) => {
    mesh.castShadow = mesh.receiveShadow = false; mesh.renderOrder = order; mesh.frustumCulled = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    // like the other small dressing: hidden in the building overview, shown with its floor (js/main.js showBand)
    Object.assign(mesh.userData, { y: [floor - 0.1, floor + 2.6], style_room: "accents", kind: "led" });
    root.add(mesh); levelObjects.push(mesh);
  };
  for (const [L, lev] of Object.entries(data.levels)) {
    const floor = Math.min(...lev.shadow.map((r) => r[5]), ...lev.plinth.map((r) => r[4]));
    if (lev.shadow.length) {
      // (M2) new renderer: its own copy of the plane carrying each instance's half size and strength
      const geo = GPU ? plane.clone() : plane, half = GPU ? new Float32Array(lev.shadow.length * 3) : null;
      const mesh = new THREE.InstancedMesh(geo, shadowMat, lev.shadow.length); mesh.name = L + "_accent_shadows";
      lev.shadow.forEach(([, x, z, w, d, y, k], i) => {
        mesh.setMatrixAt(i, m4.compose(p.set(x, y + 0.009, z), q.identity(), s.set(w, 1, d)));
        mesh.setColorAt(i, col.setRGB(k, k, k));
        if (half) half.set([w / 2, d / 2, k], i * 3);
      });
      if (half) geo.setAttribute("accHalf", new THREE.InstancedBufferAttribute(half, 3));
      add(mesh, floor, 2);
    }
    const nLines = lev.plinth.length + lev.niche.length;
    if (nLines) {
      const mesh = new THREE.InstancedMesh(box, ledMat, nLines), rooms = []; mesh.name = L + "_accent_leds";
      let i = 0;
      for (const [label, x, z, len, y, nx] of lev.plinth) { // along the unit's face, at its foot
        mesh.setMatrixAt(i++, m4.compose(p.set(x, y + 0.012, z), q.identity(), nx ? s.set(0.01, 0.012, len) : s.set(len, 0.012, 0.01))); rooms.push(label);
      }
      for (const [label, x, y, z, len, nx] of lev.niche) { // under a shelf, along its front edge
        mesh.setMatrixAt(i++, m4.compose(p.set(x, y, z), q.identity(), nx ? s.set(0.012, 0.008, len) : s.set(len, 0.008, 0.012))); rooms.push(label);
      }
      for (let k = 0; k < nLines; k++) mesh.setColorAt(k, col.setRGB(1, 1, 1));
      lines.push({ mesh, rooms }); add(mesh, floor, 0);
    }
    if (lev.plinth.length) {
      const mesh = new THREE.InstancedMesh(plane, washMat, lev.plinth.length), rooms = []; mesh.name = L + "_accent_wash";
      lev.plinth.forEach(([label, x, z, len, y, nx, nz], i) => {
        q.setFromAxisAngle(up, Math.atan2(nx, nz)); // local +z (the fade) points away from the unit
        mesh.setMatrixAt(i, m4.compose(p.set(x + nx * 0.175, y + 0.004, z + nz * 0.175), q, s.set(len, 1, 0.35)));
        mesh.setColorAt(i, col.setRGB(0, 0, 0)); rooms.push(label);
      });
      washes.push({ mesh, rooms }); add(mesh, floor, 3);
    }
  }
  // LED line: a pale diffuser by day (0.85), warm and bright when lit; floor wash only when lit
  // (in the isolated views the time of day doesn't show, so the LEDs glow at least at 0.6 there)
  function refresh() {
    const g = Math.max(glow, 0.6 * plain);
    for (const { mesh, rooms } of lines) { rooms.forEach((r, i) => { const v = 0.85 + 1.6 * g * (roomK.get(r) ?? 1); mesh.setColorAt(i, col.setRGB(v, v, v)); }); mesh.instanceColor.needsUpdate = true; }
    for (const { mesh, rooms } of washes) { rooms.forEach((r, i) => { const v = 0.55 * g * (roomK.get(r) ?? 1); mesh.setColorAt(i, col.setRGB(v, v, v)); }); mesh.instanceColor.needsUpdate = true; }
  }
  refresh();
  return {
    counts: Object.fromEntries(Object.entries(data.levels).map(([L, v]) => [L, [v.shadow.length, v.plinth.length, v.niche.length]])),
    setGlow(g) { glow = g; refresh(); },
    setPlain(k) { if (Math.abs(k - plain) < 0.02 && k !== 0 && k !== 1) return; plain = k; refresh(); },
    setRoom(label, k) { roomK.set(label, k); refresh(); },
  };
}
