// Style rooms (client brief 2026-11-26): K.401, K.405, K.407, K.413 and K.416 are re-skinned and made interactive in the
// manner of the Nagoya Hill 3D viewer (research/nagoya-hill-reverse.md) - as templates for the other rooms.
// GEOMETRY IS NOT CHANGED: these rooms arrive as separate meshes (tools/blender/06s_style_rooms.py tags them
// `style_room`, `surface`; tools/pack-levels.mjs leaves them unmerged) and only their materials are replaced here.
//
// * Materials: one material per (room, palette key), MeshStandardMaterial with the reference's roughness / metalness
//   table, our own procedural textures (js/proctex.js, tinted by the colour), three palettes (signature walnut, light
//   oak & travertine, graphite) - switching style only sets colours.
// * Wall hiding: the room view's existing camera-side cutaway (main.js updateRoomCut, full wall height), with light
//   section caps (#e3dcd2) as in the reference.
// * Interaction: a toggle registry (value eases to its target, easeInOutQuad, duration 1 / speed): doors (90 deg in
//   ~0.91 s, balcony pair together), TV, room lights (LED strips + lamps + a warm downlight), curtains (draw across the
//   glass door). Hover: back-face outline, pointer cursor, a tooltip whose verb flips with the state; small hotspot
//   dots; click only for a short press (< 320 ms, < 10 px) with a 450 ms debounce.
// * URL: #K405-light (room + style) opens that room in that style.
import * as THREE from "three";
import { makeTextures } from "./proctex.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const STYLE_ROOMS = { "K.401": "signature", "K.405": "light", "K.407": "signature", "K.413": "signature", "K.416": "signature" };
// palette colours (hex values as published by the reference's style presets; our own textures)
const SIG = { floor: "#8a6a52", tile: "#cfc8bd", paint: "#d9d1c7", cap: "#e3dcd2", ceiling: "#f2efea", wood: "#6b4a34", woodPanel: "#5f4230",
  bedFrame: "#3a2e27", door: "#4a3628", sheet: "#efede9", duvet: "#cdc8c1", throwM: "#8a5a3e", blackout: "#8d8379", oak: "#b9a690",
  charcoal: "#4c4b49", travTop: "#e2d7c8", bathWall: "#8f8a84", bathFloor: "#77726c", metal: "#1e1e1e", sofa: "#a39b90", rug: "#c9c2b8", lacquer: "#c6c0b8" };
export const PALETTES = {
  signature: { name: "Signature walnut", c: SIG },
  light: { name: "Light oak", c: { ...SIG, floor: "#b48e68", tile: "#e4dfd7", paint: "#e8e2d9", cap: "#e6dfd3", wood: "#b08a64", woodPanel: "#a8825c",
    bedFrame: "#8a6e55", door: "#9a7a5a", duvet: "#d8d3cb", throwM: "#a77a5a", blackout: "#b7aa98", oak: "#d2c1a6", charcoal: "#8e8b86",
    travTop: "#ece4d8", bathWall: "#bdb6ad", bathFloor: "#a39c93", sofa: "#c4bcb1", rug: "#ddd6cc", lacquer: "#d9d3ca" } },
  graphite: { name: "Graphite", c: { ...SIG, floor: "#5d4d42", tile: "#9c9892", paint: "#b9b5af", cap: "#d4cfc8", ceiling: "#e9e6e1", wood: "#3f342d",
    woodPanel: "#3a302a", bedFrame: "#242221", door: "#2e2622", duvet: "#8f8c88", throwM: "#6d4a34", blackout: "#4b4f53", oak: "#7a6a5a",
    charcoal: "#2f2f30", travTop: "#c9c4bd", bathWall: "#5f5c59", bathFloor: "#4c4946", sofa: "#5c5a57", rug: "#7d7975", lacquer: "#6f6b67" } },
};
// palette key -> [texture, roughness, metalness]
const FINISH = {
  floor: ["planks", 0.45, 0], tile: ["porcelain", 0.32, 0], paint: ["plaster", 0.95, 0], ceiling: ["plaster", 0.95, 0],
  bathWall: ["stone", 0.45, 0], bathFloor: ["stone", 0.55, 0], wood: ["veneer", 0.5, 0], woodPanel: ["veneer", 0.5, 0], door: ["veneer", 0.5, 0],
  bedFrame: ["veneer", 0.5, 0], oak: ["veneer", 0.55, 0], sheet: ["fabric", 0.96, 0], duvet: ["fabric", 0.96, 0], throwM: ["fabric", 0.96, 0],
  blackout: ["fabric", 0.97, 0], sofa: ["boucle", 1, 0], rug: ["boucle", 1, 0], charcoal: ["fabric", 0.82, 0], travTop: ["travertine", 0.4, 0],
  metal: [null, 0.45, 0.5], lacquer: [null, 0.35, 0], ceramic: [null, 0.15, 0],
};
// which palette key a mesh gets (by its split surface, its kind and its original material name); null = keep as is
function keyFor(o, name, inBath) {
  const s = o.userData.surface;
  if (s === "bathfloor") return "bathFloor";
  if (s === "bathwall") return /glass|chrome|metal/i.test(name) ? null : "bathWall";
  if (s === "floor") return inBath ? "bathFloor" : "floor";
  if (s === "ceiling") return "ceiling";
  if (s === "wall") return /tile_wall|marble|stone/i.test(name) ? "bathWall" : /wood|teak/i.test(name) ? "woodPanel" : /glass|chrome|metal/i.test(name) ? null : "paint";
  if (/glass|screen|led|lamp_|brass|book|vase|potted|plastic/i.test(name)) return null;
  if (/wood_light|walnut/i.test(name)) return o.userData.kind === "bed" ? "bedFrame" : "wood";
  if (/teak/i.test(name)) return "oak";
  if (/fabric_sheet/i.test(name)) return "sheet";
  if (/fabric_bedding/i.test(name)) return "duvet";
  if (/fabric_throw|fabric_sage/i.test(name)) return "throwM";
  if (/fabric_curtain/i.test(name)) return "blackout";
  if (/fabric_sofa/i.test(name)) return "sofa";
  if (/rug/i.test(name)) return "rug";
  if (/arm_chair_01_pillow/i.test(name)) return "charcoal";
  if (/chrome|metal|arm_chair_01_legs/i.test(name)) return "metal";
  if (/marble|stone/i.test(name)) return "travTop";
  if (/porcelain|ceramic/i.test(name)) return "ceramic";
  if (/lacquer/i.test(name)) return "lacquer";
  if (/tile_floor/i.test(name)) return inBath ? "bathFloor" : "tile";
  if (/plaster|concrete/i.test(name)) return "paint";
  return null;
}
const easeQuad = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

export function createRoomStyle({ scene, camera, renderer, objects, spaces, units, levelY, planToWorld, inPoly, rootPos, tooltip, invalidate, patch, onLights, borrowLights, releaseLights, loadTexture }) {
  const tex = makeTextures(renderer);
  const rooms = new Map(); // label -> { u, style, mats: {key: material}, meshes, emissive: [{m, base}], curtains, toggles }
  const unitByLabel = new Map(units.map((u) => [u.label, u]));
  for (const label of Object.keys(STYLE_ROOMS)) {
    const u = unitByLabel.get(label); if (!u) continue;
    rooms.set(label, { u, style: STYLE_ROOMS[label], mats: {}, meshes: [], emissive: [], curtains: [], lamps: [], toggles: [] });
  }
  const bathOf = (u) => u.bath?.outline ?? null;
  // ---- (round 28) CC0 photo textures (Poly Haven, see ASSETS_LICENSES.md), fetched the first time a style room opens ----
  // Each replaces one procedural slot: its colour turned into neutral grey detail (mean 0.85, so the room's palette
  // still sets the hue) plus its real normal map, tiled at the texture's real size (the style rooms keep metre UVs).
  const CC0 = { fabric: ["rough_linen", 0.27, 0.27], boucle: ["wool_boucle", 0.315, 0.39], veneer: ["oak_veneer_01", 1.83, 1.83], planks: ["laminate_floor_02", 1.7, 1.7] };
  const NORMAL = { fabric: 0.8, boucle: 1.0, veneer: 0.5, planks: 0.6 };
  let cc0 = null;
  function applyCC0(m) {
    const slot = FINISH[m.userData.rsKey]?.[0], c = cc0?.[slot];
    if (!c?.d) return;
    m.map = c.d; m.normalMap = c.n; m.normalScale.setScalar(NORMAL[slot]); m.bumpMap = null;
    if (slot === "fabric" || slot === "boucle") m.roughnessMap = c.d;
    m.needsUpdate = true;
  }
  function loadCC0() {
    if (cc0 || !loadTexture) return;
    cc0 = {};
    const aniso = Math.min(8, renderer.getMaxAnisotropy ? renderer.getMaxAnisotropy() : renderer.capabilities.getMaxAnisotropy()); // (M2)
    Promise.all(Object.entries(CC0).map(async ([slot, [id, sx, sy]]) => {
      const [d, n] = await Promise.all([loadTexture(`data/levels/tex/cc0_${id}_detail.ktx2`), loadTexture(`data/levels/tex/cc0_${id}_nor.ktx2`)]);
      for (const t of [d, n]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / sx, 1 / sy); t.colorSpace = THREE.NoColorSpace; t.anisotropy = aniso; t.needsUpdate = true; }
      cc0[slot] = { d, n };
    })).then(() => { for (const R of rooms.values()) for (const m of Object.values(R.mats)) applyCC0(m); invalidate(300); })
      .catch((e) => console.warn("CC0 textures", e));
  }
  // ---- materials ----
  function material(R, key) {
    if (R.mats[key]) return R.mats[key];
    const [t, rough, metal] = FINISH[key];
    const m = new THREE.MeshStandardMaterial({ name: `RS_${R.u.label}_${key}`, roughness: rough, metalness: metal, envMapIntensity: 0.6 });
    if (t) m.map = tex[t];
    if (key === "floor" && tex.plankBump) { m.bumpMap = tex.plankBump; m.bumpScale = 0.6; }
    // (round 12 of IMPROVEMENT_LOG.md) surface relief from the same procedural textures - no geometry, no download:
    // a woven feel on linen / curtains / upholstery, a nubbly boucle on rug and sofa, fine grain on veneer and plaster,
    // and the texture also breaks up the roughness a little, so big fabric areas don't read as flat plastic
    const RELIEF = { fabric: 0.9, boucle: 1.6, veneer: 0.35, plaster: 0.25, stone: 0.3, travertine: 0.4 };
    if (t && RELIEF[t] && !m.bumpMap) { m.bumpMap = tex[t]; m.bumpScale = RELIEF[t]; }
    if (t === "fabric" || t === "boucle") m.roughnessMap = tex[t];
    m.userData.rsKey = key;
    R.mats[key] = m;
    return m;
  }
  function applyStyle(R, style) {
    R.style = style; const c = PALETTES[style].c;
    for (const [key, m] of Object.entries(R.mats)) {
      const hex = c[key] ?? (key === "ceramic" ? "#f4f2ee" : SIG[key] ?? "#cccccc");
      m.color.set(hex);
    }
    invalidate(200);
  }
  const p = new THREE.Vector3();
  for (const o of objects) {
    const label = o.userData.style_room; const R = label && rooms.get(label);
    if (!R || !o.isMesh) continue;
    R.meshes.push(o);
    const name = o.material?.name ?? "";
    o.geometry.computeBoundingBox(); o.geometry.boundingBox.getCenter(p); o.localToWorld(p);
    const b = bathOf(R.u), inBath = !!b && inPoly(p.x - rootPos.x, -(p.z - rootPos.z), b);
    if (/led|lamp_globe|lamp_shade/i.test(name)) { // lights: own copy, emissive driven by the lights toggle
      const m = o.material.clone(); m.userData.base = m.emissiveIntensity || 1; o.material = m; R.emissive.push(m);
      if (o.userData.kind === "lamp") R.lamps.push(o);
      continue;
    }
    if (o.userData.kind === "curtain") R.curtains.push(o);
    const key = keyFor(o, name, inBath);
    if (key) o.material = material(R, key);
  }
  for (const R of rooms.values()) applyStyle(R, R.style);
  // Draw calls: after restyling, many pieces of a room share one material (all its painted walls, its floor boards...).
  // Their triangles are joined, per room and material, into one mesh in world space - every vertex stays exactly where
  // it was (mirrored copies get their winding flipped back). Lamps, curtains, TVs and lights stay separate (they move,
  // glow or are picked one by one), and so do bathroom fittings (hidden in the overview).
  for (const R of rooms.values()) {
    const groups = new Map();
    for (const o of R.meshes) {
      const k = o.userData.kind, m = o.material;
      if (!o.parent || k === "lamp" || k === "curtain" || k === "tv" || R.emissive.includes(m) || !m?.userData?.rsKey) continue;
      const key = m.uuid + (o.userData.bathroom ? "|b" : "") + (o.userData.kind === "bed" ? "|bed" : "");
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = []; let y0 = Infinity, y1 = -Infinity;
      for (const o of list) {
        o.updateWorldMatrix(true, false);
        let g = o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.normal || !g.attributes.uv) { geos.length = 0; break; } // (all pieces here have both; never mix)
        if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
        // quantized attributes (meshopt: 16-bit, normalized) -> plain floats first, so world coordinates fit and the
        // pieces can be joined (getX/Y/Z return the real, de-normalized values)
        for (const name of ["position", "normal", "uv"]) {
          const a = g.attributes[name];
          if (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute) continue;
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
          g.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
        }
        g.applyMatrix4(o.matrixWorld);
        if (o.matrixWorld.determinant() < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
        g.computeBoundingBox(); y0 = Math.min(y0, g.boundingBox.min.y); y1 = Math.max(y1, g.boundingBox.max.y);
        geos.push(g);
      }
      const merged = geos.length === list.length ? mergeGeometries(geos, false) : null;
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { ...list[0].userData, y: [y0, y1], merged: list.length };
      scene.add(mesh);
      // the pieces leave the scene and the per-floor visibility list (main.js levelObjects); the merged mesh takes their place
      for (const o of list) { o.parent.remove(o); const i = objects.indexOf(o); if (i >= 0) objects.splice(i, 1); }
      objects.push(mesh);
      R.meshes = R.meshes.filter((o) => !list.includes(o)); R.meshes.push(mesh);
    }
  }
  // the rooms' doors: Nagoya timing (90 deg, ~0.91 s, easeInOutQuad), their leaves in the door veneer (glass stays)
  for (const R of rooms.values()) {
    const sp = spaces.unitSpace(R.u); R.sp = sp;
    for (const d of sp?.doors ?? []) {
      d.dur = 1 / 1.1; d.ease = "quad"; d.swing = 1;
      d.pivot.traverse((m) => { if (m.isMesh && /wood|door/i.test(m.material?.name ?? "")) m.material = material(R, "door"); });
    }
  }

  // ---- toggle registry ----
  const label = (open, close) => (v) => (v > 0.5 ? close : open);
  function addToggle(R, t) { t.v = 0; t.t = 0; R.toggles.push(t); return t; }
  // one warm downlight + one lamp light, shared by the style rooms (moved into the room being shown, so the number of
  // lights in the scene never changes and no shader has to be rebuilt)
  // (round 26) borrowed from the mood-light pool while a style room is shown (js/lighting.js hold / release): two
  // fewer lights in every shader of the site. Without a pool (borrowLights not given) the room keeps its own two.
  let down = null, lamp = null;
  const ownLights = () => { const d = new THREE.PointLight(0xffc98f, 0, 6, 2), l = new THREE.PointLight(0xffd07d, 0, 4, 2); scene.add(d, l); return [d, l]; };
  const own = borrowLights ? null : ownLights();
  for (const R of rooms.values()) {
    const u = R.u, floorY = levelY[u.level];
    // doors (entry, bathroom, balcony pair)
    const seen = new Set();
    for (const d of R.sp?.doors ?? []) {
      if (seen.has(d.pair ?? d)) continue; seen.add(d.pair ?? d);
      const kind = d.role === "entrance" ? "entry door" : d.out ? "balcony doors" : "bathroom door";
      const meshes = []; for (const x of (d.pair ? R.sp.doors.filter((q) => q.pair === d.pair) : [d])) x.pivot.traverse((m) => m.isMesh && meshes.push(m));
      addToggle(R, { id: kind, meshes, text: label(`Open the ${kind}`, `Close the ${kind}`), at: d.centerW.clone(),
        state: () => d.target, click: () => spaces.toggle(d, u.center) });
    }
    // lights: LED strips + lamps glow, warm downlight and lamp light in this room
    if (R.emissive.length) {
      const lampAt = new THREE.Vector3(); if (R.lamps[0]) new THREE.Box3().setFromObject(R.lamps[0]).getCenter(lampAt);
      addToggle(R, { id: "lights", meshes: R.lamps.slice(), text: label("Turn the lights on", "Turn the lights off"), speed: 3,
        at: R.lamps[0] ? lampAt.clone() : u.center.clone().setY(floorY + 1.2),
        apply: (e) => {
          for (const m of R.emissive) m.emissiveIntensity = m.userData.base * (0.15 + 2.3 * e);
          if (active === R && down) { down.intensity = 4.5 * e; lamp.intensity = 0.7 * e; } // (point downlight: 4.5 ~ the old 6 cd spot)
          onLights?.(u.label, e); // (round 22) the room's accent LEDs (js/accents.js)
        } });
    }
    // curtains: drawn across the glass door they hang beside (scaled from their outer end; the mesh itself is unchanged)
    for (const c of R.curtains) {
      const b = new THREE.Box3().setFromObject(c), s = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
      const wide = s.x > s.z ? "x" : "z";
      const glass = (R.sp?.doors ?? []).filter((d) => d.out).map((d) => d.centerW);
      if (!glass.length) continue;
      const gc = glass.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / glass.length);
      const dir = Math.sign(gc[wide] - ctr[wide]) || 1; // the opening is on this side
      const pivot = new THREE.Group(); pivot.position.copy(ctr); pivot.position[wide] = dir > 0 ? b.min[wide] : b.max[wide];
      c.parent.add(pivot); pivot.updateMatrixWorld(); pivot.attach(c);
      const span = Math.min(2.2, Math.abs(gc[wide] - pivot.position[wide]) * 2), k = Math.max(1, span / Math.max(0.2, s[wide]));
      const meshes = [c];
      addToggle(R, { id: "curtain", meshes, text: label("Close the curtain", "Open the curtain"), speed: 0.9, at: ctr.clone(),
        apply: (e) => { pivot.scale[wide] = 1 + (k - 1) * e; } });
    }
  }
  function addTv(R, tv) {
    if (!tv || R.tvToggle) return;
    R.tvToggle = addToggle(R, { id: "tv", meshes: [tv.hit], text: label("Turn the TV on", "Turn the TV off"), speed: 4,
      at: tv.hit.position.clone(), state: () => (tv.on ? 1 : 0), click: () => { tv.on = !tv.on; tv.screen.visible = tv.on; } });
  }

  // ---- hover: outline + tooltip + cursor; hotspot dots ----
  let active = null, hovered = null, outlines = [];
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6, side: THREE.BackSide, depthWrite: false, transparent: true, opacity: 0.9 });
  patch?.(outlineMat);
  const S = new THREE.Matrix4(), T1 = new THREE.Matrix4(), T2 = new THREE.Matrix4(), cc = new THREE.Vector3();
  function setOutline(t) {
    for (const o of outlines) scene.remove(o); outlines = [];
    if (!t) return;
    for (const m of t.meshes) {
      if (!m.geometry) continue;
      m.geometry.computeBoundingBox(); m.geometry.boundingBox.getCenter(cc);
      const o = new THREE.Mesh(m.geometry, outlineMat); o.matrixAutoUpdate = false;
      m.updateMatrixWorld();
      o.matrix.copy(m.matrixWorld).multiply(T1.makeTranslation(cc.x, cc.y, cc.z)).multiply(S.makeScale(1.035, 1.035, 1.035)).multiply(T2.makeTranslation(-cc.x, -cc.y, -cc.z));
      o.renderOrder = 2; o.raycast = () => {}; scene.add(o); outlines.push(o);
    }
  }
  const hotLayer = document.createElement("div"); hotLayer.className = "rs-hotspots"; document.body.appendChild(hotLayer);
  const dock = document.createElement("div"); dock.className = "rs-dock hidden"; document.body.appendChild(dock);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickToggle(e, clipY) {
    if (!active) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const list = active.toggles.flatMap((t) => t.meshes.map((m) => ((m.userData.rsToggle = t), m)));
    const h = ray.intersectObjects(list, false).find((x) => x.point.y < clipY);
    return h ? h.object.userData.rsToggle : null;
  }
  const stateOf = (t) => (t.state ? t.state() : t.t);
  let downAt = 0, lastClick = 0;
  renderer.domElement.addEventListener("pointerdown", () => { downAt = performance.now(); });

  function renderDock() {
    if (!active) { dock.classList.add("hidden"); return; }
    dock.classList.remove("hidden");
    dock.innerHTML = `<span class="rs-title">${active.u.label} · Style</span>` +
      Object.entries(PALETTES).map(([k, v]) => `<button class="chip${active.style === k ? " on" : ""}" data-style="${k}">${v.name}</button>`).join("") +
      (active.toggles.some((t) => t.id === "lights") ? `<button class="chip${active.toggles.find((t) => t.id === "lights").t ? " on" : ""}" data-lights>💡 Lights</button>` : "");
  }
  dock.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || !active) return;
    if (b.dataset.style) { applyStyle(active, b.dataset.style); writeHash(); }
    if (b.dataset.lights !== undefined) { const t = active.toggles.find((x) => x.id === "lights"); t.t = t.t ? 0 : 1; }
    renderDock(); invalidate(600);
  });
  function writeHash() { try { history.replaceState(null, "", `#${active.u.label.replace(".", "")}-${active.style}`); } catch {} }

  return {
    rooms, isStyleRoom: (u) => !!u && rooms.has(u.label),
    // (UI round) night in the room view: the room's lights switch on by themselves (the visitor can still turn them off)
    setLights(on) {
      const lt = active?.toggles.find((t) => t.id === "lights");
      if (!lt || !!lt.t === on) return;
      lt.t = on ? 1 : 0; renderDock(); invalidate(600);
    },
    // room view opened / closed (main.js setRoomView / clearRoomView)
    enter(u, tv) {
      active = rooms.get(u.label) ?? null;
      if (!active) return;
      loadCC0(); // (round 28, once)
      addTv(active, tv);
      // (round 26) from the room's own box: the merged "ceiling" mesh also holds pieces of other storeys (K.405's spans
      // 11.8-15.2 m), which had put the downlight under the room's floor
      // (over the bed: the room's centre includes the bathroom, which put the light against the bathroom wall)
      const bed = new THREE.Box3(); for (const m of active.meshes) if (m.userData.kind === "bed") bed.expandByObject(m);
      const c = (bed.isEmpty() ? u.center.clone() : bed.getCenter(new THREE.Vector3())).setY((u.box?.max.y ?? levelY[u.level] + 2.6) - 0.05);
      if (!down) {
        [down, lamp] = own ?? borrowLights(2);
        down.color.setHex(0xffc98f); down.distance = 6; down.decay = 2;
        lamp.color.setHex(0xffd07d); lamp.distance = 4; lamp.decay = 2;
      }
      down.position.copy(c).setY(c.y - 0.35); // (just under the ceiling: a point light, so not right against it)
      const lt = active.toggles.find((t) => t.id === "lights"); lamp.position.copy(lt?.at ?? c).add(new THREE.Vector3(0, 0.25, 0));
      // (client, 2026-11-27) the room's lights are on by default when it opens (the Lights button can still turn them off)
      if (lt) lt.t = 1;
      lt?.apply(easeQuad(lt.v));
      renderDock(); writeHash();
    },
    leave() {
      if (down) {
        down.intensity = 0; lamp.intensity = 0;
        if (!own) { releaseLights([down, lamp]); down = lamp = null; } // (back to the mood pool)
      }
      active = null; hovered = null; setOutline(null); hotLayer.innerHTML = ""; renderDock();
      try { if (/^#K\d{3}-/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search); } catch {}
    },
    get active() { return active; },
    // pointer move over the canvas while a style room is shown: returns true when a toggle is under the pointer
    hover(e, clipY) {
      const t = pickToggle(e, clipY);
      if (t !== hovered) { hovered = t; setOutline(t); invalidate(60); }
      if (!t) return false;
      tooltip.textContent = t.text(stateOf(t));
      tooltip.style.left = e.clientX + "px"; tooltip.style.top = e.clientY + "px"; tooltip.classList.remove("hidden");
      renderer.domElement.style.cursor = "pointer";
      return true;
    },
    // pointer up: a short click on a toggle (< 320 ms, < 10 px is checked by the caller's drag test; 450 ms debounce)
    click(e, clipY) {
      const now = performance.now();
      if (now - downAt > 320 || now - lastClick < 450) return false;
      const t = pickToggle(e, clipY); if (!t) return false;
      lastClick = now;
      if (t.click) t.click(); else t.t = t.t ? 0 : 1;
      if (t.id === "lights") renderDock();
      if (hovered === t) tooltip.textContent = t.text(t.click ? 1 - stateOf(t) : t.t);
      invalidate(1200);
      return true;
    },
    // every frame: ease the registry's own toggles, place the hotspot dots; returns true while something moves
    tick(dt, showHot) {
      let moving = false;
      if (!active) return false;
      for (const t of active.toggles) {
        if (!t.apply || t.v === t.t) continue;
        const sp = t.speed ?? 1.1;
        t.v = t.t > t.v ? Math.min(t.t, t.v + dt * sp) : Math.max(t.t, t.v - dt * sp);
        t.apply(easeQuad(t.v)); moving = true;
      }
      // hotspots: a small dot per toggle (9 px, 13 px on touch)
      const touch = matchMedia("(pointer: coarse)").matches;
      if (hotLayer.childElementCount !== active.toggles.length) hotLayer.innerHTML = active.toggles.map(() => `<i class="rs-hot${touch ? " touch" : ""}"></i>`).join("");
      active.toggles.forEach((t, i) => {
        const el = hotLayer.children[i]; p.copy(t.at).project(camera);
        const vis = showHot && p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
        el.style.display = vis ? "" : "none";
        if (vis) { el.style.left = ((p.x + 1) / 2) * innerWidth + "px"; el.style.top = ((1 - p.y) / 2) * innerHeight + "px"; el.classList.toggle("on", stateOf(t) > 0.5); }
      });
      return moving;
    },
    // #K405-light at start-up: which room / style to open
    fromHash() {
      const m = /^#K(\d{3})(?:-(signature|light|graphite))?/.exec(location.hash); if (!m) return null;
      const R = rooms.get("K." + m[1]); if (!R) return null;
      if (m[2]) applyStyle(R, m[2]);
      return R.u;
    },
    capColor: (u) => (rooms.get(u?.label) ? PALETTES[rooms.get(u.label).style].c.cap : null),
  };
}
