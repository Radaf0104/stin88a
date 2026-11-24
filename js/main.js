import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { CopyShader } from "three/addons/shaders/CopyShader.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "./config.js";
import { materialFor, addBoxUVs, setLampGlow, allMaterials, startTextureLoading } from "./materials.js";
import { createLandscape } from "./landscape.js";
import { createEnvironment, TIMES } from "./environment.js";
import { createMoodLights, createWindowLight } from "./lighting.js";
import { createWalker } from "./walk.js";
import { createMap } from "./map.js";
import { createGradePass } from "./grade.js";

// ---------- text ----------
const STR = {
  en: {
    overview: "Building overview", floors: "Floors", available: "Available", occupied: "Occupied",
    nAvail: (n) => `${n} available`, area: "Area", type: "Type", status: "Status", floor: "Floor", perMonth: "/ month",
    enter: "Room photos", pano360: "360° view", ask: "Ask on WhatsApp", day: "☀ Day", night: "☾ Night", hint: "Pick a floor to see the rooms",
    hintFloor: "Click a room for details", drag: "Drag to look around · scroll to zoom · Space to walk around", close: "Close",
    assumed: "Layout assumed from Level 3 — confirm in Revit", unnamed: "Unnamed in Revit — needs a room number",
    wa: (u) => `Hi, I'm interested in room ${u} at ${CONFIG.project.name}.`,
    placeholder: "Placeholder — the 360° render from Unreal will appear here", loading: "Loading 3D model…", lang: "ID",
    explore: "Explore in 3D", renders: "Gallery",
    nSpaces: (n) => `${n} shared spaces`, stepIn: "Step inside", photos: "Photos", exitRoom: "← Exit room",
    panMouse: "right-drag to move the view", panTouch: "two fingers to move the view",
    hintInside: "Drag to look around", roomPhotos: "Room photos", seeAngle: "See this angle in 3D", back: "Back to 3D",
    time_day: "☀ Day", time_golden: "🌇 Golden hour", time_night: "☾ Night", walk: "🚶 Walk", hq: "HQ", lite: "Lite",
    exitWalk: "✕ Exit walk", walkHere: "🚶 Walk around", bath: "bathroom",
    mapOn: "🌍 Map", mapOff: "🌿 Lawn", mapNoKey: "The real-world map needs a Google Maps API key: add googleMapsKey in js/config.js.",
    walkHintMouse: "Click to look around · WASD / arrows to move · Shift to run · Esc to release the mouse",
    walkHintTouch: "Left thumb: move · Right thumb: look",
  },
  id: {
    overview: "Tampilan gedung", floors: "Lantai", available: "Tersedia", occupied: "Terisi",
    nAvail: (n) => `${n} tersedia`, area: "Luas", type: "Tipe", status: "Status", floor: "Lantai", perMonth: "/ bulan",
    enter: "Foto kamar", pano360: "Tampilan 360°", ask: "Tanya via WhatsApp", day: "☀ Siang", night: "☾ Malam", hint: "Pilih lantai untuk melihat kamar",
    hintFloor: "Klik kamar untuk detail", drag: "Geser untuk melihat sekeliling · scroll untuk zoom · Spasi untuk berjalan", close: "Tutup",
    assumed: "Tata letak diasumsikan dari Lantai 3 — cek di Revit", unnamed: "Belum bernama di Revit — perlu nomor kamar",
    wa: (u) => `Halo, saya tertarik dengan kamar ${u} di ${CONFIG.project.name}.`,
    placeholder: "Contoh — render 360° dari Unreal akan tampil di sini", loading: "Memuat model 3D…", lang: "EN",
    explore: "Jelajahi 3D", renders: "Galeri",
    nSpaces: (n) => `${n} ruang bersama`, stepIn: "Masuk ke kamar", photos: "Foto", exitRoom: "← Keluar",
    panMouse: "klik kanan + geser untuk menggeser tampilan", panTouch: "dua jari untuk menggeser tampilan",
    hintInside: "Geser untuk melihat sekeliling", roomPhotos: "Foto kamar", seeAngle: "Lihat sudut ini di 3D", back: "Kembali ke 3D",
    time_day: "☀ Siang", time_golden: "🌇 Senja", time_night: "☾ Malam", walk: "🚶 Jalan", hq: "HQ", lite: "Ringan",
    exitWalk: "✕ Selesai", walkHere: "🚶 Jalan-jalan", bath: "kamar mandi",
    mapOn: "🌍 Peta", mapOff: "🌿 Taman", mapNoKey: "Peta dunia nyata butuh API key Google Maps: isi googleMapsKey di js/config.js.",
    walkHintMouse: "Klik untuk melihat · WASD / panah untuk berjalan · Shift untuk lari · Esc melepas mouse",
    walkHintTouch: "Jempol kiri: jalan · Jempol kanan: lihat",
  },
};
let lang = CONFIG.defaultLanguage;
try { lang = localStorage.getItem("stin-lang") || lang; } catch {}
const t = (k, ...a) => { const v = STR[lang][k]; return typeof v === "function" ? v(...a) : v ?? k; };
const L = (obj) => (obj && typeof obj === "object" ? obj[lang] ?? obj.en : obj);

const STATUS_COLOR = { available: 0x2fb57a, occupied: 0xe0443e }; // green / red

// ---------- quality (High = AO + bloom + big shadows; Lite for phones) ----------
const isPhone = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const quality = { high: !isPhone };
try { const q = localStorage.getItem("stin-quality"); if (q) quality.high = q === "high"; } catch {}

// ---------- scene ----------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true }); // stencil = section caps
const maxDpr = quality.high ? 1.5 : 1; // sharpness cap: beyond this the GPU cost rises fast for little visible gain
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.AgXToneMapping; // keeps whites white and shadows colourful (ACES crushed the mid-tones)

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 800); // tight near/far = precise depth for AO
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
// Pan: right-drag (or Ctrl/Shift + drag) with a mouse, two fingers on a touch screen. The point the camera orbits
// around is kept near the building (see clampPan below), so the view can't be dragged off the site.
controls.enablePan = true;
controls.panSpeed = 0.9;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 6;
controls.maxDistance = 220;

// Sky, sun and image-based light (day / golden hour / night)
const env = createEnvironment(renderer, scene);
const sun = env.sun;
sun.shadow.mapSize.setScalar(quality.high ? 4096 : 1024);
const mood = createMoodLights(scene, quality.high ? 6 : 3);

// Post-processing: ambient occlusion (contact shadows) + soft bloom on lamps. High quality only.
let composer = null, gtao = null, gradePass = null, bloomPass = null, scenePass = null;
// The scene is drawn into its own 4× multisampled target (smooth edges; stencil for the section caps) and resolved once
// into the composer's plain buffers. The post passes (bloom, tone mapping, grade) then work on single-sample buffers:
// multisampling the composer's two ping-pong buffers made every full-screen pass pay a resolve (≈9 ms per frame).
class MSAAScenePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene; this.camera = camera; this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true });
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ ...CopyShader, uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), depthTest: false, depthWrite: false }));
  }
  setSize(w, h) { this.target.setSize(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.copy.material.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.copy.render(renderer);
  }
}
function buildComposer() {
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 0 });
  composer = new EffectComposer(renderer, rt);
  scenePass = new MSAAScenePass(scene, camera);
  composer.addPass(scenePass);
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.blendIntensity = 0.7;
  gtao.normalMaterial.side = THREE.DoubleSide; // Revit triangles aren't consistently wound
  gtao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 2, thickness: 0.6, scale: 1 });
  // The AO pass draws the scene once more into a normal/depth buffer. Two things must stay out of it:
  // - the sky photo: drawn into that buffer it filled every pixel with invalid numbers (NaN), so AO came out as
  //   "fully occluded" everywhere and simply darkened the whole picture (the old "AO dims everything" bug);
  // - see-through things (floor hover boxes, coloured room volumes, glass), which it would treat as solid walls.
  const hideForAO = gtao.overrideVisibility.bind(gtao), showAfterAO = gtao.restoreVisibility.bind(gtao);
  let skyForAO = null;
  gtao.overrideVisibility = () => {
    hideForAO(); // (remembers every object's visibility first, so restoreVisibility() brings these back)
    skyForAO = scene.background; scene.background = null;
    // also leaf cards / ferns (cut-out textures look like solid squares to AO) and grass blades (marked noAO)
    scene.traverse((o) => {
      const m = o.isMesh && o.material && !Array.isArray(o.material) ? o.material : null;
      if (m && (m.transparent || m.alphaTest > 0 || m.userData.noAO)) o.visible = false;
    });
  };
  gtao.restoreVisibility = () => { showAfterAO(); scene.background = skyForAO; };
  composer.addPass(gtao);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 0.9);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  gradePass = createGradePass(); // colour grade on the final image (per time of day, set in setTime)
  gradePass.setAspect(innerWidth / innerHeight);
  composer.addPass(gradePass);
}
if (quality.high) buildComposer();

// Cuts the building above the selected floor (like a plan cut). Applied globally so AO/shadows respect it too.
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
// Always on (parked at 1e6 m when nothing is cut): switching clipping on and off changes every material's shader, and
// the first floor click used to rebuild ~17 shaders at once (a 3–4 s freeze). Staying on keeps the start-up shaders valid.
renderer.clippingPlanes = [clipPlane];
const root = new THREE.Group();
scene.add(root);

const ui = {
  floorList: document.getElementById("floorList"), overviewBtn: document.getElementById("overviewBtn"),
  legend: document.getElementById("legend"), card: document.getElementById("card"), hint: document.getElementById("hint"),
  tooltip: document.getElementById("tooltip"), labels: document.getElementById("labels"), loading: document.getElementById("loading"),
  dayNight: document.getElementById("dayNight"), langBtn: document.getElementById("langBtn"),
};

const state = { floor: null, unit: null, hover: null, inside: null, walking: false };
let model, units = [], unitMeshes = [], bands = [], levelY = {}, overviewView, buildingBox;
const isNight = () => env.current === "night";

// ---------- landing + render gallery (work before the 3D model has loaded) ----------
const RENDERS = CONFIG.renders ?? [];
const $ = (id) => document.getElementById(id);
let ready = false;
const hero = $("hero");
if (RENDERS.length) $("heroImg").src = "images/renders/" + RENDERS[0].file;
else hero.classList.add("gone");
function leaveHero(thenGallery) {
  hero.classList.add("gone");
  if (ready) updateRail();
  if (thenGallery) openGallery("exterior", 0);
  else if (ready) introFly();
}
$("heroExplore").onclick = () => leaveHero(false);
$("heroGallery").onclick = () => leaveHero(true);

// Galleries: exterior renders (they know their camera angle) + interior photo sets from config.
const GALLERIES = [
  { key: "exterior", label: { en: "Exterior", id: "Eksterior" },
    items: RENDERS.map((r, i) => ({ src: "images/renders/" + r.file, thumb: "images/renders/thumbs/" + r.file, title: r.title, renderIndex: i })) },
  ...(CONFIG.galleries ?? []).map((g) => ({ key: g.key, label: g.label,
    items: g.items.map((it) => ({ src: g.dir + it.file, thumb: g.dir + "thumbs/" + it.file, title: it.title, zone: it.zone ?? "bed" })) })),
].filter((g) => g.items.length);
const galleryByKey = Object.fromEntries(GALLERIES.map((g) => [g.key, g]));
const lb = { el: $("lightbox"), i: 0, open: false, items: [], tab: null, heading: "" };
// openGallery("exterior", 2)  -> tabbed gallery;  openGallery([items], 0, "K.305") -> one room's photos
function openGallery(keyOrItems, i = 0, heading = "") {
  if (typeof keyOrItems === "string") { lb.tab = galleryByKey[keyOrItems] ? keyOrItems : GALLERIES[0]?.key; lb.items = galleryByKey[lb.tab]?.items ?? []; }
  else { lb.tab = null; lb.items = keyOrItems; }
  if (!lb.items.length) return;
  lb.heading = heading;
  lb.open = true;
  lb.el.classList.remove("hidden");
  document.body.classList.add("lb-open");
  renderTabs();
  $("lbThumbs").innerHTML = lb.items.map((it, k) => `<img src="${it.thumb}" data-i="${k}" alt="" loading="lazy" />`).join("");
  showRender(i);
}
function renderTabs() {
  $("lbTabs").innerHTML = lb.tab === null ? ""
    : GALLERIES.map((g) => `<button class="lb-tab${g.key === lb.tab ? " active" : ""}" data-k="${g.key}">${L(g.label)}</button>`).join("");
}
$("lbTabs").onclick = (e) => { if (e.target.dataset.k) openGallery(e.target.dataset.k, 0); };
$("lbThumbs").onclick = (e) => { if (e.target.dataset.i) showRender(+e.target.dataset.i); };
function closeGallery() {
  lb.open = false; lb.el.classList.add("hidden");
  document.body.classList.remove("lb-open");
  if (ready && !tween && state.floor === null && camera.position.distanceTo(overviewView.pos) > radius * 4) introFly();
}
function showRender(i) {
  lb.i = (i + lb.items.length) % lb.items.length;
  const it = lb.items[lb.i];
  $("lbImg").src = it.src;
  $("lbTitle").textContent = (lb.heading ? lb.heading + " · " : "") + L(it.title);
  $("lbCount").textContent = `${lb.i + 1} / ${lb.items.length}`;
  $("lbAngle").style.display = it.renderIndex !== undefined ? "" : "none";
  [...$("lbThumbs").children].forEach((im, k) => im.classList.toggle("active", k === lb.i));
  $("lbThumbs").children[lb.i]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}
$("lbPrev").onclick = () => showRender(lb.i - 1);
$("lbNext").onclick = () => showRender(lb.i + 1);
$("lbClose").onclick = closeGallery;
$("lbAngle").onclick = () => {
  const r = lb.items[lb.i]?.renderIndex;
  lb.open = false; lb.el.classList.add("hidden");
  document.body.classList.remove("lb-open");
  if (ready && r !== undefined) flyToRender(r);
};
addEventListener("keydown", (e) => {
  if (!lb.open) return;
  if (e.key === "ArrowLeft") showRender(lb.i - 1);
  else if (e.key === "ArrowRight") showRender(lb.i + 1);
  else if (e.key === "Escape") { closeGallery(); e.preventDefault(); }
});
let swipeX = null;
$("lbImg").addEventListener("pointerdown", (e) => (swipeX = e.clientX));
$("lbImg").addEventListener("pointerup", (e) => {
  if (swipeX !== null && Math.abs(e.clientX - swipeX) > 50) showRender(lb.i + (e.clientX < swipeX ? 1 : -1));
  swipeX = null;
});
$("lbImg").ondragstart = () => false;

// ---------- load ----------
document.getElementById("loadingText").textContent = t("loading");
const timings = {}, tStart = performance.now(), mark = (k) => (timings[k] = Math.round(performance.now() - tStart));
const [modelJson, unitsJson] = await Promise.all([fetch("data/model.json").then((r) => r.json()), fetch("data/units.json").then((r) => r.json())]);
model = modelJson;
model.levels.forEach((l, i) => (levelY[i] = l.z));
// Geometry: compressed 16-bit version if it exists (see tools/pack-geometry.mjs), otherwise the raw Revit export
async function loadQuantised(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url);
  const q = new Uint16Array(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const f = new Float32Array(q.length), { min, scale } = model.quant;
  for (let i = 0; i < q.length; i += 3) { f[i] = min[0] + q[i] * scale[0]; f[i + 1] = min[1] + q[i + 1] * scale[1]; f[i + 2] = min[2] + q[i + 2] * scale[2]; }
  return f;
}
async function loadGeometry() {
  if (model.quant && "DecompressionStream" in window) {
    try { return (await loadQuantised("data/geometry.q.bin.gz")).buffer; } catch {}
  }
  return fetch("data/geometry.bin").then((r) => r.arrayBuffer());
}
// Closed solids for the section caps (see tools/pack-geometry.mjs); loaded alongside the building, optional.
const capSolids = model.cap && model.quant && "DecompressionStream" in window ? loadQuantised(model.cap.file).catch(() => null) : Promise.resolve(null);
const geoBuf = await loadGeometry();
mark("download");

// Building geometry: Revit (x, y, z up) -> three.js (x, y up, -y)
const CAP_CATS = new Set(["Walls", "Floors", "Structural Columns", "Columns", "Structural Framing", "Roofs"]);
const capStencilMat = new THREE.MeshBasicMaterial({
  side: THREE.DoubleSide, depthWrite: false, depthTest: false, colorWrite: false,
  stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
  stencilFail: THREE.InvertStencilOp, stencilZFail: THREE.InvertStencilOp, stencilZPass: THREE.InvertStencilOp,
});
// Collisions for walk mode: doors are left out so doorways are walkable; small fixtures/TVs too.
const NO_COLLIDE = new Set(["Doors", "Communication Devices", "Specialty Equipment", "Plumbing Fixtures", "Lighting Fixtures",
  "Furniture", "Casework"]); // furniture & built-in joinery are walk-through
const geoFrom = (chunks) => {
  const n = chunks.reduce((a, c) => a + c.length, 0), pos = new Float32Array(n);
  let o = 0; for (const c of chunks) { pos.set(c, o); o += c.length; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return geo;
};
// Every drawable piece remembers its height range, so whole floors can be skipped when they can't be seen.
const levelObjects = [];
const track = (obj) => { obj.geometry.computeBoundingBox(); const b = obj.geometry.boundingBox; obj.userData.y = [b.min.y, b.max.y]; levelObjects.push(obj); return obj; };
const byMat = new Map(), capChunks = [], collideChunks = [];
for (const g of model.groups) {
  const src = new Float32Array(geoBuf, g.offset * 4, g.count);
  const pos = new Float32Array(g.count);
  for (let i = 0; i < g.count; i += 3) { pos[i] = src[i]; pos[i + 1] = src[i + 2]; pos[i + 2] = -src[i + 1]; }
  // one mesh per *look* per floor (Revit materials that render identically share a material, see materialFor)
  const mat = materialFor(g.material, model.materials[g.material]);
  const key = mat.uuid + "|" + g.level;
  if (!byMat.has(key)) byMat.set(key, { mat, chunks: [] });
  byMat.get(key).chunks.push(pos);
  if (CAP_CATS.has(g.category)) capChunks.push(pos);
  if (!NO_COLLIDE.has(g.category)) collideChunks.push(pos);
}
for (const { mat, chunks } of byMat.values()) {
  const geo = geoFrom(chunks);
  geo.computeVertexNormals();
  addBoxUVs(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = !mat.transparent; // glass and water let the light through
  mesh.receiveShadow = true;
  if (mat.transparent) mesh.renderOrder = 3;
  root.add(track(mesh));
}
// Section caps: a hidden copy flips the stencil bit for every surface behind the cut. Where the count is odd
// the pixel is inside a cut solid, and the cap plane (below) paints it solid. Works whatever the triangle winding.
// Only drawn while a floor is cut.
// The visible surfaces were nudged apart by a few mm against flicker; the caps count surfaces, so they use the
// untouched (watertight) export when it is available.
const capSrc = await capSolids;
if (capSrc) {
  const pos = new Float32Array(capSrc.length);
  for (let i = 0; i < pos.length; i += 3) { pos[i] = capSrc[i]; pos[i + 1] = capSrc[i + 2]; pos[i + 2] = -capSrc[i + 1]; }
  capChunks.length = 0; capChunks.push(pos);
}
const capMesh = new THREE.Mesh(geoFrom(capChunks), capStencilMat);
capMesh.renderOrder = 1;
capMesh.visible = false;
root.add(capMesh);
mark("building");

// Simplify dense fixture meshes by vertex clustering: vertices closer than `cell` metres merge, and the
// triangles that collapse disappear. A 11k-triangle toilet becomes a few hundred and looks the same at room scale.
function simplify(pos, cell) {
  const reps = new Map(), keys = new Array(pos.length / 3);
  for (let i = 0; i < pos.length; i += 3) {
    const k = Math.round(pos[i] / cell) + "," + Math.round(pos[i + 1] / cell) + "," + Math.round(pos[i + 2] / cell);
    keys[i / 3] = k;
    const r = reps.get(k) ?? reps.set(k, [0, 0, 0, 0]).get(k);
    r[0] += pos[i]; r[1] += pos[i + 1]; r[2] += pos[i + 2]; r[3]++;
  }
  const out = [], seen = new Set();
  for (let t = 0; t < keys.length; t += 3) {
    const a = keys[t], b = keys[t + 1], c = keys[t + 2];
    if (a === b || b === c || a === c) continue;
    const tk = [a, b, c].sort().join("|");
    if (seen.has(tk)) continue;
    seen.add(tk);
    for (const k of [a, b, c]) { const r = reps.get(k); out.push(r[0] / r[3], r[1] / r[3], r[2] / r[3]); }
  }
  return new Float32Array(out);
}

// Bathroom fixtures (toilets, showers, basins): simplified, stored once, drawn many times (instancing), one batch per floor.
const REVIT_TO_THREE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const toMatrix = (it) => REVIT_TO_THREE.clone().multiply(new THREE.Matrix4().fromArray(it.m));
const instMatrices = (list) => list.map(toMatrix);
let fixtureTris = [0, 0];
const twoSided = new Map(); // one double-sided copy per base material, shared by every fixture part that uses it
for (const fx of model.fixtures ?? []) {
  const byLevel = Map.groupBy ? Map.groupBy(fx.instances, (it) => it.level) : fx.instances.reduce((m, it) => m.set(it.level, [...(m.get(it.level) ?? []), it]), new Map());
  for (const part of fx.parts) {
    const raw = new Float32Array(geoBuf, part.offset * 4, part.count);
    const pos = raw.length > 9 * 300 ? simplify(raw, 0.022) : raw;
    fixtureTris[0] += raw.length / 9; fixtureTris[1] += pos.length / 9;
    if (!pos.length) continue;
    const geo = geoFrom([pos]);
    geo.computeVertexNormals();
    addBoxUVs(geo);
    // fixtures include mirrored copies (which flip triangle winding), so they keep both sides
    const base = materialFor(part.material, model.materials[part.material]);
    if (base.side !== THREE.DoubleSide && !twoSided.has(base)) twoSided.set(base, Object.assign(base.clone(), { side: THREE.DoubleSide }));
    const mat = base.side === THREE.DoubleSide ? base : twoSided.get(base);
    for (const [, list] of byLevel) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => im.setMatrixAt(i, toMatrix(it)));
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingBox();
      im.userData.y = [im.boundingBox.min.y, im.boundingBox.max.y];
      levelObjects.push(im);
      root.add(im);
    }
  }
}
timings.fixtureTriangles = `${Math.round(fixtureTris[0])} -> ${Math.round(fixtureTris[1])} per set`;
mark("fixtures");
// Office chairs: the Revit family is ~355k triangles each, so a simple stand-in chair is drawn in its place.
for (const px of model.proxies ?? []) {
  const parts = [
    new THREE.BoxGeometry(0.5, 0.48, 0.07).translate(0, 0, 0.47),          // seat (Revit axes: z up)
    new THREE.BoxGeometry(0.48, 0.06, 0.5).translate(0, 0.22, 0.78),        // back
    new THREE.CylinderGeometry(0.03, 0.03, 0.42, 10).rotateX(Math.PI / 2).translate(0, 0, 0.24),
    new THREE.BoxGeometry(0.6, 0.05, 0.035).translate(0, 0, 0.04),
    new THREE.BoxGeometry(0.05, 0.6, 0.035).translate(0, 0, 0.04),
  ].map((g) => g.toNonIndexed());
  const geo = mergeGeometries(parts);
  const ms = instMatrices(px.instances);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.8 }), ms.length);
  ms.forEach((m, i) => im.setMatrixAt(i, m));
  im.castShadow = im.receiveShadow = true;
  root.add(im);
}

// Ground: lawn around the site
const groundGeo = new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2).toNonIndexed();
addBoxUVs(groundGeo);
const ground = new THREE.Mesh(groundGeo, materialFor("Grass", { class: "grass" }));
ground.position.y = -0.25;
ground.receiveShadow = true;
scene.add(ground);
const cap = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
  color: 0x5d564f, roughness: 1, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
  stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
}));
cap.renderOrder = 1.1;
cap.visible = false;
cap.onAfterRender = (r) => r.clearStencil();
scene.add(cap);
buildingBox = new THREE.Box3().setFromObject(root);
const c = buildingBox.getCenter(new THREE.Vector3());
root.position.set(-c.x, 0, -c.z);
buildingBox = new THREE.Box3().setFromObject(root);
const size = buildingBox.getSize(new THREE.Vector3());
const radius = Math.max(size.x, size.z) * 0.5;

// Keep the orbit point within the site while panning: the building plus a margin of lawn around it (much wider while
// the real-world map is on), from the ground to just above the roof. When a pan would go past the edge, the camera
// is moved back by the same amount, so the view simply stops at the edge instead of turning.
const panLimit = new THREE.Box3(), panPrev = new THREE.Vector3();
function clampPan() {
  if (state.inside || state.walking) return;
  const margin = ready && map.on ? 400 : Math.max(12, radius * 0.6);
  panLimit.copy(buildingBox).expandByVector(new THREE.Vector3(margin, 0, margin));
  panLimit.min.y = 0; panLimit.max.y += 3;
  panPrev.copy(controls.target);
  controls.target.clamp(panLimit.min, panLimit.max);
  if (!panPrev.equals(controls.target)) camera.position.add(panPrev.sub(controls.target).negate());
}
controls.addEventListener("change", clampPan);

const sc = sun.shadow.camera;
sc.left = sc.bottom = -radius * 1.4; sc.right = sc.top = radius * 1.4; sc.near = 1; sc.far = radius * 8;

// Walk-mode collision mesh (world coordinates) + a floor under the whole site
const siteFloor = new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2).translate(0, -0.25, 0).toNonIndexed();
collideChunks.push(...[siteFloor.attributes.position.array].map((a) => a.map((v, i) => (i % 3 === 0 ? v + c.x : i % 3 === 2 ? v + c.z : v))));
const collideGeo = geoFrom(collideChunks);
collideGeo.translate(-c.x, 0, -c.z);
const walker = createWalker({ camera, dom: canvas, geometry: collideGeo, onExit: () => exitWalk() });
mark("collision");

// ---------- landscape: trees, distant hills, ferns ----------
const landscape = createLandscape({ scene, buildingBox, lite: !quality.high });
// 3D grass around the building, kept off paving / slabs (anything solid just above the lawn)
const grassProbe = new THREE.Vector3();
landscape.addGrass((x, z) => { const h = walker.floorBelow(grassProbe.set(x, 0.5, z)); return !!h && h.y > ground.position.y + 0.04; }, quality.high ? 1 : 0.35);
mark("grass");

// ---------- real-world map (Google 3D Tiles) ----------
const map = createMap({ scene, camera, renderer, site: CONFIG.site ?? {}, apiKey: CONFIG.googleMapsKey });
let mapWanted = false;
function applyMap() {
  const cut = clipPlane.constant < 1e5 && !state.walking; // a plan cut would slice the hills, so pause the map
  const on = mapWanted && !cut;
  const was = map.on;
  map.set(on);
  ground.visible = landscape.group.visible = !on; // Google's tiles bring their own ground and trees
  if (on) scene.fog = null; // real surroundings: no fake haze
  else if (was && env.current) env.set(env.current, radius); // restore sky haze
  camera.far = on ? 30000 : 800; camera.updateProjectionMatrix();
  controls.maxDistance = on ? 1500 : 220;
}
function toast(msg) {
  const el = document.createElement("div"); el.className = "toast"; el.textContent = msg; document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ---------- draw only what can be seen; shadows are rendered once, not every frame ----------
renderer.shadowMap.autoUpdate = false;
let band = [-Infinity, Infinity];
function showBand(lo = -Infinity, hi = Infinity) {
  band = [lo, hi];
  for (const o of levelObjects) o.visible = o.userData.y[1] >= lo && o.userData.y[0] <= hi;
}
// Re-render the sun's shadow map with the whole (cut) building present, so hidden floors still cast shadows.
function refreshShadows() {
  const keep = band;
  showBand();
  renderer.shadowMap.needsUpdate = true;
  // drawn into the scene's own buffer (the next frame overwrites it), not the screen: a screen render needs a second,
  // screen-specific version of every shader, which used to be built on the first floor click (a multi-second freeze)
  renderer.setRenderTarget(scenePass ? scenePass.target : null);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  showBand(...keep);
}

// Units (clickable room volumes) + shared spaces (Level 1 communal area, villa) from the Revit rooms
units = unitsJson.units;
for (const sp of CONFIG.spaces ?? []) {
  const r = model.rooms.find((x) => x.name.trim().toUpperCase() === sp.room.toUpperCase());
  if (r) units.push({ id: "space-" + r.id, kind: "space", space: sp, label: L(sp.label), level: r.levelIndex, area: r.area,
    outline: r.outline, z: r.z, height: r.height });
}
const SPACE_COLOR = 0xc8693f;
const colorOf = (u) => (u.kind === "space" ? SPACE_COLOR : STATUS_COLOR[u.status]);
function volume(u, outline, z, height, mat) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.min(height || 2.4, 2.6), bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = z + 0.03;
  mesh.visible = false;
  mesh.userData.unit = u;
  mesh.renderOrder = 4;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: colorOf(u) })));
  root.add(mesh);
  unitMeshes.push(mesh);
  return mesh;
}
for (const u of units) {
  const mat = new THREE.MeshStandardMaterial({
    color: colorOf(u), emissive: colorOf(u), emissiveIntensity: 0.25,
    transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.6,
    side: THREE.DoubleSide, // the plan cut removes the box top, so the inside faces must draw
  });
  u.mesh = volume(u, u.outline, u.z, u.height, mat);
  if (u.bath) u.bathMesh = volume(u, u.bath.outline, u.bath.z, u.bath.height, mat); // bathroom = same unit, same colour
}
// Warm lit ceilings in every bedroom, seen through the windows from outside (like the renders' lamp-lit rooms).
// One merged, unlit mesh facing down; brightness per time of day (roomGlow in environment.js); hidden indoors.
const roomGlowMat = new THREE.MeshBasicMaterial({ color: 0xffc58a, side: THREE.BackSide, fog: false });
const roomGlow = (() => {
  const geos = units.filter((u) => u.kind !== "space").map((u) => {
    const g = new THREE.ShapeGeometry(new THREE.Shape(u.outline.map(([x, y]) => new THREE.Vector2(x, y))));
    g.rotateX(-Math.PI / 2);
    g.translate(0, u.z + Math.min(u.height || 2.8, 2.9) - 0.04, 0);
    g.deleteAttribute("uv"); g.deleteAttribute("normal");
    return g;
  });
  const m = new THREE.Mesh(mergeGeometries(geos), roomGlowMat);
  root.add(m);
  return m;
})();
root.updateMatrixWorld(true);
for (const u of units) {
  u.box =new THREE.Box3().setFromObject(u.mesh, true);
  u.center = u.box.getCenter(new THREE.Vector3());
  if (u.bathMesh) u.bathCenter = new THREE.Box3().setFromObject(u.bathMesh, true).getCenter(new THREE.Vector3());
}

// Mood-light anchors: bedroom lamps, bathroom lights, corridor bays, shared spaces
for (const u of units) {
  const fy = levelY[u.level];
  if (u.kind === "space") {
    const moodName = /villa/i.test(u.space.gallery) ? "villa" : "communal";
    const b = u.box, step = 4;
    for (let x = b.min.x + 2; x <= b.max.x - 1; x += step)
      for (let z = b.min.z + 2; z <= b.max.z - 1; z += step) mood.add(new THREE.Vector3(x, fy + 2.5, z), moodName);
  } else {
    mood.add(new THREE.Vector3(u.center.x, fy + 2.25, u.center.z), "bedroom");
    if (u.bathCenter) mood.add(new THREE.Vector3(u.bathCenter.x, fy + 2.2, u.bathCenter.z), "bathroom");
  }
}
for (const lvl of new Set(units.filter((u) => u.kind !== "space").map((u) => u.level))) {
  const us = units.filter((u) => u.level === lvl && u.kind !== "space");
  const zc = us.reduce((a, u) => a + u.center.z, 0) / us.length; // corridor runs between the two room rows
  const xs = [...new Set(us.map((u) => Math.round(u.center.x / 3) * 3))];
  for (const x of xs) mood.add(new THREE.Vector3(x, levelY[lvl] + 2.3, zc), "corridor");
}

// Floor bands (hover + click in the overview)
for (const f of CONFIG.floors) {
  const us = units.filter((u) => u.level === f.level);
  if (!us.length) continue;
  const box = new THREE.Box3();
  us.forEach((u) => box.expandByObject(u.mesh, true));
  const s = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const hgt = (levelY[f.level + 1] ?? levelY[f.level] + 4) - levelY[f.level];
  const geo = new THREE.BoxGeometry(s.x + 2.4, hgt * 0.96, s.z + 2.4);
  const band = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc8693f, transparent: true, opacity: 0, depthWrite: false }));
  band.position.set(ctr.x, levelY[f.level] + hgt / 2, ctr.z);
  band.userData.floor = f.level;
  band.renderOrder = 3;
  scene.add(band);
  bands.push(band);
}

// Unit labels (HTML)
for (const u of units) {
  const el = document.createElement("div");
  el.className = "unit-label";
  el.textContent = u.label;
  el.style.display = "none";
  ui.labels.appendChild(el);
  u.labelEl = el;
}

overviewView = {
  target: new THREE.Vector3(0, size.y * 0.35, 0),
  pos: new THREE.Vector3(radius * 1.55, radius * 1.05, radius * 1.75),
};
camera.position.copy(overviewView.pos).multiplyScalar(1.35);
controls.target.copy(overviewView.target);

// Camera pins: one per render, standing on a ring around the building at the render's direction.
const viewDir = (r) => {
  const az = THREE.MathUtils.degToRad(r.az), el = THREE.MathUtils.degToRad(r.el);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
};
// (the numbered camera pins in the 3D scene were removed; the exterior photo rail does the same job)
const pins = [];
function flyToRender(i, thenShow = false) {
  const r = RENDERS[i];
  if (state.floor !== null) selectFloor(null, false);
  const target = overviewView.target.clone();
  flyTo(target.clone().add(viewDir(r).multiplyScalar(radius * 1.9 * (r.dist ?? 1))), target, 1.3);
  ui.tooltip.classList.add("hidden");
  if (thenShow) setTimeout(() => openGallery("exterior", i), 1400);
}
function introFly() { flyTo(overviewView.pos, overviewView.target, 2.2); }

// ---------- camera tween ----------
let tween = null;
function flyTo(pos, target, dur = 1.1, keepDistance = false) {
  // Portrait screens (phones) need the camera further back to fit the same view (not when flying inside a room).
  const fit = !keepDistance && camera.aspect < 1 ? Math.min(2.4, 1.2 / camera.aspect) : 1;
  const p1 = target.clone().add(pos.clone().sub(target).multiplyScalar(fit));
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1, t1: target.clone(), s: performance.now(), d: dur * 1000 };
}
controls.addEventListener("start", () => { if (tween?.done) { camera.position.copy(tween.p1); controls.target.copy(tween.t1); tween.done(); } tween = null; });
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// ---------- selection ----------
function setCut(y) {
  const on = y !== null && y !== undefined;
  clipPlane.constant = on ? y : 1e6; // (the plane is always active; "no cut" just parks it far above the building)
  cap.visible = capMesh.visible = on;
  if (on) cap.position.y = y - 0.002;
  showBand(-Infinity, on ? y : Infinity); // floors entirely above the cut aren't drawn at all
  applyMap();
  refreshShadows();
}

function selectFloor(level, fly = true) {
  if (state.inside) leaveInside();
  state.floor = level;
  state.unit = null;
  const on = level !== null;
  setCut(on ? levelY[level] + 1.35 : null);
  for (const m of unitMeshes) { m.visible = on && m.userData.unit.level === level; styleUnit(m.userData.unit); }
  for (const b of bands) b.visible = !on;
  if (fly) {
    if (on) {
      const us = units.filter((u) => u.level === level);
      const ctr = us.reduce((a, u) => a.add(u.center), new THREE.Vector3()).divideScalar(us.length);
      flyTo(new THREE.Vector3(ctr.x + radius * 0.35, levelY[level] + radius * 1.25, ctr.z + radius * 1.0), ctr);
    } else flyTo(overviewView.pos, overviewView.target);
  }
  hideCard();
  renderUI();
}

// ---------- step inside: eye-level view, look-around only (the camera can't leave the room) ----------
// Daylight through the window of the room you're in (see createWindowLight). A bedroom's window is on the facade
// end of its long side (the side away from the building's centre line); shared spaces have no single window.
const windowLight = createWindowLight(scene);
let windowRoom = null;
// Which end of a bedroom is the facade (window) end: rooms sit in two rows either side of the corridor, so the
// window is on the side of the room away from the middle of that floor's rooms.
function facadeSide(u) {
  const b = u.box, ax = b.max.x - b.min.x > b.max.z - b.min.z ? "x" : "z";
  const row = units.filter((o) => o.level === u.level && o.kind !== "space");
  const mid = row.reduce((s, o) => s + o.center[ax], 0) / Math.max(1, row.length);
  return { ax, out: Math.sign(u.center[ax] - mid) || 1 };
}
function setWindowRoom(u) {
  u = u && u.kind !== "space" ? u : null;
  if (u === windowRoom) return;
  windowRoom = u;
  if (!u) { windowLight.setWindow(null); invalidate(300); return; }
  const b = u.box, { ax, out } = facadeSide(u), other = ax === "x" ? "z" : "x", floorY = levelY[u.level];
  const pos = u.center.clone(); pos[ax] = (out > 0 ? b.max[ax] : b.min[ax]) - out * 0.08; pos.y = floorY + 1.35;
  const inward = new THREE.Vector3(); inward[ax] = -out;
  windowLight.setWindow({ pos, inward, width: Math.max(1, b.max[other] - b.min[other] - 0.2), height: 2.3 });
  invalidate(300);
}
const insideBar = $("insideBar");
const savedControls = {};
function enterRoom(u) {
  state.unit = u;
  state.inside = u;
  hideCard();
  for (const m of unitMeshes) m.visible = false;
  setCut(levelY[u.level + 1] !== undefined ? levelY[u.level + 1] - 0.3 : null); // open up only the floor above
  // Stand at the corridor end of the room's long side, looking toward the facade (window).
  const b = u.box, { ax, out } = facadeSide(u); // facade (window) end of the room
  const floorY = levelY[u.level];
  const pos = u.center.clone(), look = u.center.clone();
  // Back away from the window toward the entry, but stop before the wardrobe / bathroom wall (first thing hit).
  pos.y = floorY + 1.6;
  const back = new THREE.Vector3(); back[ax] = -out;
  const hit = walker.raycastAll(new THREE.Ray(pos.clone(), back)).find((h) => h.distance > 0.05);
  const room = (b.max[ax] - b.min[ax]) / 2 - 0.45;
  pos[ax] -= out * Math.max(0, Math.min(room, (hit ? hit.distance : room) - 0.35));
  // ...and centre it between the side walls at that spot (rooms aren't always a clean rectangle)
  const side = ax === "x" ? "z" : "x", sdir = new THREE.Vector3();
  const sideHit = (s) => { sdir.set(0, 0, 0); sdir[side] = s; return walker.raycastAll(new THREE.Ray(pos.clone(), sdir.clone())).find((h) => h.distance > 0.02 && h.distance < 4); };
  const l = sideHit(-1), r = sideHit(1);
  if (l && r) pos[side] = (l.point[side] + r.point[side]) / 2;
  look[side] = pos[side];
  look[ax] = out > 0 ? b.max[ax] : b.min[ax];
  look.y = floorY + 1.35;
  const dir = look.clone().sub(pos).normalize();
  Object.assign(savedControls, { minDistance: controls.minDistance, maxDistance: controls.maxDistance, maxPolarAngle: controls.maxPolarAngle,
    rotateSpeed: controls.rotateSpeed, enablePan: controls.enablePan, enableZoom: controls.enableZoom });
  // free distance during the flight; lock to "look around" once arrived
  Object.assign(controls, { minDistance: 0.01, maxDistance: Infinity, maxPolarAngle: Math.PI * 0.9, enablePan: false, enableZoom: false });
  camera.fov = 62; camera.updateProjectionMatrix();
  flyTo(pos, pos.clone().addScaledVector(dir, 0.05), 1.8, true);
  tween.done = () => Object.assign(controls, { maxDistance: 0.2, rotateSpeed: -0.35 });
  setWindowRoom(u); // daylight through this room's window (the room's own lamps come from the mood-light pool)
  $("insideTitle").textContent = u.kind === "space" ? L(u.space.label) : `${u.label} · ${L(CONFIG.types[u.type]?.label) ?? ""}`;
  insideBar.classList.remove("hidden");
  $("insidePano").textContent = t("pano360");
  $("insidePano").classList.toggle("hidden", !CONFIG.types[u.type]?.pano);
  document.body.classList.add("inside");
  ui.hint.textContent = t("hintInside");
  updateRail();
}
function leaveInside() {
  state.inside = null;
  setTimeout(updateRail);
  Object.assign(controls, savedControls);
  camera.fov = 38; camera.updateProjectionMatrix();
  setWindowRoom(null);
  insideBar.classList.add("hidden");
  document.body.classList.remove("inside");
}
function exitRoom() {
  const u = state.inside;
  selectFloor(u.level, false); // leaves "inside" and restores the floor cut
  selectUnit(u);
}
function openPhotosFor(u) {
  if (u.kind === "space") openGallery(u.space.gallery, u.space.start ?? 0);
  else openRoomPhotos(u);
}
$("insidePhotos").onclick = () => { const c = photoContext(); if (c) openGallery(c.items, 0, c.heading); };
$("insidePano").onclick = () => state.inside && openPano(state.inside); // 360° render of this room type
$("insideExit").onclick = () => state.inside && exitRoom();
addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented && state.inside && !lb.open && !pano.open) exitRoom(); });

function selectUnit(u) {
  if (state.inside || state.floor !== u.level) selectFloor(u.level, false); // also restores the floor cut after "inside"
  state.unit = u;
  units.forEach(styleUnit);
  for (const m of unitMeshes) m.visible = m.userData.unit.level === u.level;
  const far = u.kind === "space" ? 1.6 : 1;
  flyTo(new THREE.Vector3(u.center.x + 9 * far, u.center.y + 16 * far, u.center.z + 13 * far), u.center);
  showCard(u);
  renderUI();
}

function styleUnit(u) {
  const m = u.mesh.material, sel = state.unit === u, hov = state.hover === u;
  m.opacity = sel ? 0.65 : hov ? 0.6 : 0.4;
  m.emissiveIntensity = (isNight() ? 0.6 : 0.2) + (sel ? 0.4 : hov ? 0.25 : 0);
}

// ---------- UI ----------
const fmtPrice = (v) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);
const hex = (n) => "#" + n.toString(16).padStart(6, "0");
const priceOf = (u) => u.price ?? CONFIG.types[u.type]?.price;

function renderUI() {
  document.documentElement.lang = lang;
  document.getElementById("projectName").textContent = CONFIG.project.name;
  document.getElementById("tagline").textContent = L(CONFIG.project.tagline);
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  ui.overviewBtn.textContent = t("overview");
  ui.overviewBtn.classList.toggle("active", state.floor === null);
  ui.floorList.innerHTML = "";
  for (const f of CONFIG.floors) {
    const rooms = units.filter((u) => u.level === f.level && u.kind !== "space");
    const n = rooms.filter((u) => u.status === "available").length;
    const nSpaces = units.filter((u) => u.level === f.level && u.kind === "space").length;
    const b = document.createElement("button");
    b.className = "floor-btn" + (state.floor === f.level ? " active" : "");
    b.innerHTML = `<span>${L(f.label)}</span><span class="count">${rooms.length ? t("nAvail", n) : t("nSpaces", nSpaces)}</span>`;
    b.onclick = () => selectFloor(f.level);
    ui.floorList.appendChild(b);
  }
  // Room list for the active floor: shared spaces first, then rooms by number
  for (const u of units) if (u.kind === "space") { u.label = L(u.space.label); u.labelEl.textContent = u.label; }
  const roomList = $("roomList");
  roomList.innerHTML = "";
  if (state.floor !== null) {
    for (const u of units.filter((x) => x.level === state.floor)) {
      const b = document.createElement("button");
      b.className = "room-btn" + (u.kind === "space" ? " space-btn" : "") + (state.unit === u ? " active" : "");
      b.innerHTML = `<i class="dot" style="background:${hex(colorOf(u))}"></i>${u.label}`;
      b.onclick = () => selectUnit(u);
      roomList.appendChild(b);
    }
  }
  ui.legend.innerHTML = ["available", "occupied"]
    .map((s) => `<span><i class="dot" style="background:${hex(STATUS_COLOR[s])}"></i>${t(s)}</span>`).join("");
  ui.hint.textContent = state.inside ? t("hintInside")
    : (state.floor === null ? t("hint") : t("hintFloor")) + " · " + t(matchMedia("(pointer: coarse)").matches ? "panTouch" : "panMouse");
  $("insidePhotos").textContent = t("photos");
  $("insidePano").textContent = t("pano360");
  $("insidePano").classList.toggle("hidden", !(state.inside && CONFIG.types[state.inside.type]?.pano));
  $("insideExit").textContent = t("exitRoom");
  if (state.inside) $("insideTitle").textContent = state.inside.kind === "space" ? L(state.inside.space.label)
    : `${state.inside.label} · ${L(CONFIG.types[state.inside.type]?.label) ?? ""}`;
  ui.dayNight.textContent = t("time_" + (env.current ?? "day"));
  $("walkBtn").textContent = t("walk");
  $("mapBtn").textContent = mapWanted ? t("mapOff") : t("mapOn");
  $("qualityBtn").textContent = quality.high ? t("hq") : t("lite");
  $("walkExit").textContent = t("exitWalk");
  $("walkHint").textContent = matchMedia("(pointer: fine)").matches ? t("walkHintMouse") : t("walkHintTouch");
  $("insideWalk").textContent = t("walkHere");
  $("walkFloors").innerHTML = CONFIG.floors.slice().reverse()
    .map((f) => `<button class="chip${state.walkLevel === f.level ? " on" : ""}" data-l="${f.level}">${L(f.label)}</button>`).join("");
  ui.langBtn.textContent = t("lang");
  $("galleryBtn").textContent = "▦ " + t("renders");
  $("galleryBtn").style.display = RENDERS.length ? "" : "none";
  $("heroTitle").textContent = CONFIG.project.name;
  $("heroTag").textContent = L(CONFIG.project.tagline);
  $("heroExplore").textContent = t("explore");
  $("heroGallery").textContent = t("renders");
  $("lbAngle").textContent = t("seeAngle");
  $("lbClose").textContent = t("back");
  if (lb.open) { renderTabs(); showRender(lb.i); }
  if (typeof updateRail === "function" && ready) updateRail();
  if (state.unit && !state.inside) showCard(state.unit);
}

function showSpaceCard(u) {
  const floorLabel = L(CONFIG.floors.find((f) => f.level === u.level)?.label) ?? `L${u.level}`;
  ui.card.innerHTML = `
    <button class="close" aria-label="${t("close")}">×</button>
    <h2>${L(u.space.label)}</h2>
    <div class="sub">${floorLabel} · ${u.area.toFixed(0)} m²</div>
    <p style="font-size:14px;line-height:1.5;margin:0 0 14px">${L(u.space.text) ?? ""}</p>
    <button class="btn primary" id="stepBtn">${t("stepIn")}</button>
    <button class="btn" id="enterBtn" style="border:1px solid var(--panel-border)">${t("photos")}</button>`;
  ui.card.classList.remove("hidden");
  ui.card.querySelector(".close").onclick = () => { state.unit = null; units.forEach(styleUnit); hideCard(); renderUI(); };
  ui.card.querySelector("#stepBtn").onclick = () => enterRoom(u);
  ui.card.querySelector("#enterBtn").onclick = () => openPhotosFor(u);
}

function showCard(u) {
  if (u.kind === "space") return showSpaceCard(u);
  const type = CONFIG.types[u.type];
  const floorLabel = L(CONFIG.floors.find((f) => f.level === u.level)?.label) ?? `L${u.level}`;
  const canAsk = CONFIG.whatsapp && u.status !== "occupied";
  const note = u.note?.startsWith("Assumed") ? t("assumed") : u.note ? t("unnamed") : "";
  ui.card.innerHTML = `
    <button class="close" aria-label="${t("close")}">×</button>
    <h2>${u.label}</h2>
    <div class="sub">${floorLabel} · ${L(type?.label) ?? u.type}</div>
    ${note ? `<div class="note">⚠ ${note}</div>` : ""}
    <div class="price">${fmtPrice(priceOf(u))} <small>${t("perMonth")}</small></div>
    <dl>
      <dt>${t("area")}</dt><dd>${u.area.toFixed(1)} m²${u.bath ? ` <span style="color:var(--muted)">+ ${u.bath.area.toFixed(1)} m² ${t("bath")}</span>` : ""}</dd>
      <dt>${t("type")}</dt><dd>${L(type?.label) ?? u.type}</dd>
      <dt>${t("status")}</dt><dd><span class="status-pill"><i class="dot" style="background:${hex(STATUS_COLOR[u.status])}"></i>${t(u.status)}</span></dd>
    </dl>
    <button class="btn primary" id="stepBtn">${t("stepIn")}</button>
    <button class="btn" id="enterBtn" style="border:1px solid var(--panel-border)">${t("roomPhotos")}</button>
    ${type?.pano ? `<button class="btn" id="panoBtn" style="border:1px solid var(--panel-border)">${t("pano360")}</button>` : ""}
    ${canAsk ? `<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(t("wa", u.label))}">${t("ask")}</a>` : ""}`;
  ui.card.classList.remove("hidden");
  ui.card.querySelector(".close").onclick = () => { state.unit = null; units.forEach(styleUnit); hideCard(); renderUI(); };
  ui.card.querySelector("#stepBtn").onclick = () => enterRoom(u);
  ui.card.querySelector("#enterBtn").onclick = () => openRoomPhotos(u);
  const pb = ui.card.querySelector("#panoBtn");
  if (pb) pb.onclick = () => openPano(u);
}
function hideCard() { ui.card.classList.add("hidden"); }

ui.overviewBtn.onclick = () => selectFloor(null);
ui.langBtn.onclick = () => { lang = lang === "en" ? "id" : "en"; try { localStorage.setItem("stin-lang", lang); } catch {} renderUI(); };
ui.dayNight.onclick = () => setTime({ day: "golden", golden: "night", night: "day" }[env.current]);
$("qualityBtn").onclick = () => {
  quality.high = !quality.high;
  try { localStorage.setItem("stin-quality", quality.high ? "high" : "lite"); } catch {}
  location.reload(); // shadow-map size and light count are set at start-up
};
$("walkBtn").onclick = () => enterWalk(state.floor ?? 1);
$("mapBtn").onclick = () => {
  if (!map.available) { toast(t("mapNoKey")); return; }
  mapWanted = !mapWanted;
  applyMap();
  if (mapWanted && !state.walking && state.floor === null) // pull back to show the neighbourhood
    flyTo(new THREE.Vector3(radius * 3.2, radius * 2.4, radius * 3.6), overviewView.target, 1.6);
  renderUI();
};
$("walkExit").onclick = () => exitWalk();
$("walkFloors").onclick = (e) => { if (e.target.dataset.l) enterWalk(+e.target.dataset.l); };
$("insideWalk").onclick = () => {
  const p = camera.position.clone(); p.y -= 1.55;
  enterWalk(state.inside.level, p, Math.atan2(-(controls.target.x - camera.position.x), -(controls.target.z - camera.position.z)));
};
$("walkRoom").onclick = () => { const u = $("walkRoom")._unit; if (u) { exitWalk(false); selectUnit(u); } };
$("galleryBtn").onclick = () => openGallery("exterior", 0);

// Room card "Room photos": the room type's photo set + that floor's corridor.
function openRoomPhotos(u) {
  const type = CONFIG.types[u.type];
  const items = [...(galleryByKey[type?.gallery]?.items ?? [])];
  const corridor = CONFIG.corridors?.[u.level];
  if (corridor) items.push({ src: "images/interiors/shared/" + corridor, thumb: "images/interiors/shared/thumbs/" + corridor,
    title: { en: "Corridor", id: "Koridor" } });
  if (items.length) openGallery(items, 0, u.label);
  else openPano(u);
}

// Time of day: sky + sun + environment light, interior lamp strength, glowing windows at dusk/night
function setTime(name) {
  const tm = env.set(name, radius);
  if (map.on) scene.fog = null;
  landscape.setNight(name === "night");
  document.body.classList.toggle("night", name === "night");
  mood.setFactor(tm.lamps);
  setLampGlow(0.6 + tm.glow * 1.4);
  for (const m of allMaterials()) if (m.userData.glass) { m.emissive?.setHex(0xffb066); m.emissiveIntensity = tm.glow * 0.12; }
  ground.material.color.setHex(tm.ground);
  roomGlowMat.color.setHex(0xffc58a).multiplyScalar(tm.roomGlow ?? 0.5);
  gradePass?.setGrade(tm.grade);
  invalidate(300);
  windowLight.setTime(tm);
  units.forEach(styleUnit);
  refreshShadows();
  renderUI();
}

// ---------- walk mode ----------
function spawnFor(level) {
  const sp = units.find((u) => u.level === level && u.kind === "space");
  const rooms = units.filter((u) => u.level === level && u.kind !== "space");
  let p;
  if (rooms.length) { // middle of the corridor between the two rows of rooms
    p = rooms.reduce((a, u) => a.add(u.center), new THREE.Vector3()).divideScalar(rooms.length);
  } else if (sp) p = sp.center.clone();
  else p = new THREE.Vector3(0, 0, 0);
  p.y = levelY[level] + 1;
  const floor = walker.floorBelow(p);
  return floor ?? p.setY(levelY[level]);
}
function enterWalk(level, feet = null, yaw = Math.PI / 2) {
  if (state.inside) leaveInside();
  hideCard(); lb.open && closeGallery();
  state.walking = true; state.walkLevel = level; state.floor = null; state.unit = null;
  setCut(null);
  for (const m of unitMeshes) m.visible = false;
  for (const b of bands) b.visible = false;
  controls.enabled = false; tween = null;
  camera.fov = 70; camera.updateProjectionMatrix();
  walker.start(feet ?? spawnFor(level), yaw);
  document.body.classList.add("walking");
  renderUI();
}
function exitWalk(fly = true) {
  if (!state.walking) return;
  walker.stop();
  state.walking = false;
  setWindowRoom(null);
  document.body.classList.remove("walking");
  showBand();
  updateRail();
  camera.fov = 38; camera.updateProjectionMatrix();
  controls.enabled = true;
  controls.target.copy(camera.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
  camera.up.set(0, 1, 0);
  if (fly) selectFloor(null);
  renderUI();
}
// ---------- photo rail: the renders that match where you are (bedroom / bathroom / corridor / shared space) ----------
const rail = { el: $("photoRail"), key: "" };
function levelAt(y) { let l = 0; for (const [i, z] of Object.entries(levelY)) if (y >= z - 0.6) l = +i; return l; }
function photoContext() {
  let u = null, zone = "bed", level = null;
  if (state.inside) u = state.inside;
  else if (state.walking) {
    const f = walker.feet;
    u = roomAt(f);
    if (u?.bath && inPoly(...toPlan(f), u.bath.outline)) zone = "bath";
    if (!u) level = levelAt(f.y);
  } else if (state.floor === null && hero.classList.contains("gone")) {
    // building overview: the exterior renders; clicking one flies the 3D view to that angle first
    return { key: "ext", heading: L({ en: "Exterior", id: "Eksterior" }), items: galleryByKey.exterior?.items ?? [], exterior: true };
  } else return null;
  if (u?.kind === "space") {
    const items = (galleryByKey[u.space.gallery]?.items ?? []).filter((it) => !u.space.zone || it.zone === u.space.zone);
    return { key: "s" + u.id, heading: L(u.space.label), items };
  }
  if (u) {
    const items = (galleryByKey[CONFIG.types[u.type]?.gallery]?.items ?? []).filter((it) => it.zone === zone);
    return { key: u.id + zone, heading: `${u.label} · ${zone === "bath" ? t("bath") : L(CONFIG.types[u.type]?.label) ?? ""}`, items };
  }
  const corridor = CONFIG.corridors?.[level];
  if (corridor) {
    const items = (galleryByKey.shared?.items ?? []).filter((it) => it.src.endsWith("/" + corridor));
    return { key: "c" + level, heading: L(items[0]?.title) ?? "", items };
  }
  return null;
}
function updateRail() {
  const ctx = photoContext();
  const key = ctx?.items.length ? ctx.key + lang : "";
  if (key === rail.key) return;
  rail.key = key;
  rail.el.classList.toggle("hidden", !key);
  if (!key) return;
  rail.el.classList.toggle("exterior", !!ctx.exterior);
  rail.el.innerHTML = `<div class="rail-title">${ctx.heading}</div>` +
    ctx.items.map((it, i) => `<figure data-i="${i}"><img src="${it.thumb}" alt="" loading="lazy" /><figcaption>${L(it.title)}</figcaption></figure>`).join("");
  rail.el.onclick = (e) => {
    const f = e.target.closest("figure");
    if (!f) return;
    const i = +f.dataset.i, r = ctx.items[i].renderIndex;
    if (ctx.exterior && r !== undefined) flyToRender(r, true); // same as clicking the numbered camera pin
    else openGallery(ctx.items, i, ctx.heading);
  };
  placeRail();
}
// in the overview the rail sits under the floor list (desktop)
function placeRail() {
  if (!rail.el.classList.contains("exterior") || innerWidth <= 720) { rail.el.style.top = ""; return; }
  const fl = document.querySelector(".floors");
  rail.el.style.top = Math.round(fl.getBoundingClientRect().bottom + 12) + "px";
}
addEventListener("resize", placeRail);

// which room am I standing in? (point in polygon on the room outlines, in Revit plan coordinates)
const toPlan = (p) => [p.x - root.position.x, -(p.z - root.position.z)];
const inPoly = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
  const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
function roomAt(feet) {
  const rx = feet.x - root.position.x, ry = -(feet.z - root.position.z); // world -> Revit plan
  return units.find((u) => Math.abs(feet.y - levelY[u.level]) < 1.5 && (inPoly(rx, ry, u.outline) || (u.bath && inPoly(rx, ry, u.bath.outline))));
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
const pickList = [], pickHits = [];
function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (state.inside || state.walking) return null;
  // (the raycaster ignores .visible, so hidden room volumes are skipped here; the list is reused between moves)
  pickList.length = 0;
  for (const m of state.floor === null ? bands : unitMeshes) if (m.visible) pickList.push(m);
  pickHits.length = 0;
  return ray.intersectObjects(pickList, false, pickHits)[0]?.object;
}
canvas.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
canvas.addEventListener("pointermove", (e) => {
  const hit = pick(e);
  const prevHover = state.hover;
  for (const b of bands) b.material.opacity = b === hit ? 0.28 : 0;
  state.hover = hit?.userData.unit ?? null;
  if (prevHover !== state.hover) units.forEach(styleUnit);
  canvas.style.cursor = hit ? "pointer" : "";
  if (hit) {
    const u = hit.userData.unit;
    const f = CONFIG.floors.find((x) => x.level === (u ? u.level : hit.userData.floor));
    const rooms = units.filter((x) => x.level === f.level && x.kind !== "space");
    ui.tooltip.textContent = u ? (u.kind === "space" ? `${u.label} · ${u.area.toFixed(0)} m²` : `${u.label} · ${u.area.toFixed(1)} m² · ${t(u.status)}`)
      : `${L(f.label)} · ${rooms.length ? t("nAvail", rooms.filter((x) => x.status === "available").length)
        : t("nSpaces", units.filter((x) => x.level === f.level).length)}`;
    ui.tooltip.style.left = e.clientX + "px";
    ui.tooltip.style.top = e.clientY + "px";
    ui.tooltip.classList.remove("hidden");
  } else ui.tooltip.classList.add("hidden");
});
canvas.addEventListener("pointerleave", () => { ui.tooltip.classList.add("hidden"); moodFocus = null; });
// Room lights switch on around the point under the mouse (desktop). Ignores anything above the floor cut.
let moodFocus = null, lastMove = null;
canvas.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") lastMove = e; });
function updateMoodFocus() {
  if (!lastMove || state.walking || state.inside) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((lastMove.clientX - r.left) / r.width) * 2 - 1, -((lastMove.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = walker.raycastAll(ray.ray).find((h) => h.point.y <= clipPlane.constant + 0.01);
  moodFocus = hit ? hit.point : null;
  lastMove = null;
}
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const hit = pick(e);
  if (!hit) return;
  if (hit.userData.unit) selectUnit(hit.userData.unit);
  else if (hit.userData.floor !== undefined) selectFloor(hit.userData.floor);
});

// ---------- 360 viewer ----------
const pano = {
  el: document.getElementById("pano"), canvas: document.getElementById("panoCanvas"), open: false,
  lon: 0, lat: 0, fov: 75, drag: null,
};
pano.renderer = null; // created on first use only (a second WebGL context costs memory)
pano.scene = new THREE.Scene();
pano.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
const sphereGeo = new THREE.SphereGeometry(50, 64, 32);
sphereGeo.scale(-1, 1, 1);
pano.sphere = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial());
pano.scene.add(pano.sphere);

function placeholderTexture(label) {
  const cv = document.createElement("canvas");
  cv.width = 2048; cv.height = 1024;
  const g = cv.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0, "#f4f1ec"); grad.addColorStop(0.62, "#e9e1d4"); grad.addColorStop(0.63, "#b99a78"); grad.addColorStop(1, "#8f7356");
  g.fillStyle = grad; g.fillRect(0, 0, 2048, 1024);
  g.strokeStyle = "rgba(0,0,0,0.08)";
  for (let x = 0; x < 2048; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke(); }
  g.fillStyle = "rgba(60,50,40,0.55)"; g.font = "600 44px Inter, sans-serif"; g.textAlign = "center";
  for (let i = 0; i < 4; i++) {
    g.fillText(label, 256 + i * 512, 470);
    g.font = "400 28px Inter, sans-serif"; g.fillText("360° render · Unreal Engine", 256 + i * 512, 520); g.font = "600 44px Inter, sans-serif";
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const texLoader = new THREE.TextureLoader();
function openPano(u) {
  if (!pano.renderer) {
    pano.renderer = new THREE.WebGLRenderer({ canvas: pano.canvas, antialias: true });
    pano.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  }
  const type = CONFIG.types[u.type];
  document.getElementById("panoTitle").textContent = `${u.label} · ${L(type?.label) ?? ""}`;
  document.getElementById("panoClose").textContent = t("close");
  document.getElementById("panoWalk").textContent = t("walkHere");
  pano.unit = u;
  const note = document.getElementById("panoNote");
  note.textContent = "";
  // free the previous room's panorama (up to 7280×3600) before showing the next one
  const setMap = (tex) => { const old = pano.sphere.material.map; pano.sphere.material.map = tex; pano.sphere.material.needsUpdate = true; if (old && old !== tex) old.dispose(); };
  const src = type?.pano;
  const loaded = src && pano.src === src && pano.sphere.material.map?.userData.pano; // same room type again: keep it
  pano.src = src;
  if (!loaded) setMap(placeholderTexture(`${u.label} · ${L(type?.label) ?? u.type}`));
  if (src && !loaded) {
    texLoader.load(src, (tex) => {
      if (pano.src !== src) { tex.dispose(); return; } // another room type was opened meanwhile
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = pano.renderer.capabilities.getMaxAnisotropy(); // sharper near the top/bottom
      tex.userData.pano = true;
      setMap(tex);
    }, undefined, () => (note.textContent = t("placeholder")));
  } else if (!src) note.textContent = t("placeholder");
  // open facing the room's best side; limit looking up/down (AI-edited panoramas warp at the ceiling and floor)
  pano.lon = type?.panoStart ?? 0; pano.lat = 0; pano.fov = 75; pano.maxLat = type?.panoPitch ?? 85;
  pano.el.classList.remove("hidden");
  pano.open = true;
  resize();
}
document.getElementById("panoClose").onclick = () => { pano.open = false; pano.el.classList.add("hidden"); invalidate(300); };
// From the 360° view straight into walk mode in that same room: standing in the middle of the room, facing the
// window (Space key, or the "Walk around" button for touch screens).
function panoToWalk() {
  const u = pano.unit;
  document.getElementById("panoClose").click();
  if (!u) return;
  const start = u.center.clone(); start.y = levelY[u.level] + 1;
  const feet = walker.floorBelow(start) ?? start.setY(levelY[u.level]);
  let yaw = Math.PI / 2;
  if (u.kind !== "space") {
    const { ax, out } = facadeSide(u), look = new THREE.Vector3(); look[ax] = out;
    yaw = Math.atan2(-look.x, -look.z); // same convention as "Walk around" from the room view
  }
  enterWalk(u.level, feet, yaw);
}
document.getElementById("panoWalk").onclick = panoToWalk;
addEventListener("keydown", (e) => {
  if (!pano.open) return;
  if (e.key === "Escape") document.getElementById("panoClose").click();
  else if (e.code === "Space" && !e.repeat) { e.preventDefault(); e.stopPropagation(); panoToWalk(); }
}, true);
pano.canvas.addEventListener("pointerdown", (e) => { pano.drag = [e.clientX, e.clientY, pano.lon, pano.lat]; pano.canvas.setPointerCapture(e.pointerId); });
pano.canvas.addEventListener("pointermove", (e) => {
  if (!pano.drag) return;
  pano.lon = pano.drag[2] - (e.clientX - pano.drag[0]) * 0.15;
  pano.lat = Math.max(-pano.maxLat, Math.min(pano.maxLat, pano.drag[3] + (e.clientY - pano.drag[1]) * 0.15));
});
pano.canvas.addEventListener("pointerup", () => (pano.drag = null));
pano.canvas.addEventListener("wheel", (e) => { pano.fov = Math.max(35, Math.min(95, pano.fov + e.deltaY * 0.04)); e.preventDefault(); }, { passive: false });

// ---------- render on demand ----------
// Nothing is redrawn while nothing changes. A frame is drawn when the camera moves, during fly-throughs, walking,
// the Google map, or for a short while after any input / texture load. Ambient occlusion (soft contact shadows) is
// skipped while things move and added in one extra frame once the view has been still for ~0.25 s.
let dirtyUntil = 0, aoPending = true, lastCamMove = 0, dprScale = 1;
function invalidate(ms = 0) { dirtyUntil = Math.max(dirtyUntil, performance.now() + ms); aoPending = true; }
for (const ev of ["pointermove", "pointerdown", "pointerup", "wheel", "keydown", "keyup", "click", "touchmove"])
  addEventListener(ev, () => invalidate(ev === "pointermove" || ev === "touchmove" ? 120 : 700), { passive: true, capture: true });
{ // anything finishing loading (textures, sky photo, ferns) needs a redraw
  const lm = THREE.DefaultLoadingManager, prevP = lm.onProgress, prevL = lm.onLoad;
  lm.onProgress = (...a) => { prevP?.(...a); invalidate(300); };
  lm.onLoad = (...a) => { prevL?.(...a); invalidate(300); };
}
document.addEventListener("visibilitychange", () => invalidate(300));

// ---------- loop ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  // keep the number of rendered pixels under ~3.5 MP (HQ) / 2 MP (Lite), whatever the screen size
  const budget = quality.high ? 3.5e6 : 2e6;
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxDpr, Math.sqrt(budget / (w * h))) * dprScale);
  invalidate(300);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pano.renderer?.setSize(w, h, false);
  pano.camera.aspect = w / h;
  pano.camera.updateProjectionMatrix();
  composer?.setPixelRatio(renderer.getPixelRatio());
  composer?.setSize(w, h);
  gradePass?.setAspect(w / h);
}
addEventListener("resize", resize);
resize();

const v = new THREE.Vector3(), v2 = new THREE.Vector3();
let lastT = performance.now(), roomCheck = 0, creditT = 1, aoModeNow = "";
const lastCamM = new THREE.Matrix4(), lastCamP = new THREE.Matrix4();
// Adaptive resolution: while frames come back-to-back (the view is moving), measure the frame interval; if it stays
// above ~33 ms (under 30 fps) drop the resolution a step, if it stays under ~18 ms for a few seconds raise it again.
let frameAvg = 0, dprChangedAt = 0;
function adaptResolution(now, renderMs, dt, withAO) {
  if (withAO || dt > 0.15) { frameAvg = 0; return; } // single still frames / gaps don't count
  frameAvg = frameAvg ? frameAvg * 0.9 + dt * 1000 * 0.1 : dt * 1000;
  if (now - dprChangedAt < 1500) return;
  let next = dprScale;
  if (frameAvg > 33 && dprScale > 0.6) next = Math.max(0.6, dprScale - 0.15);
  else if (frameAvg < 18 && dprScale < 1 && now - dprChangedAt > 4000) next = Math.min(1, dprScale + 0.1);
  if (next !== dprScale) { dprScale = next; dprChangedAt = now; frameAvg = 0; resize(); }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = (now - lastT) / 1000; lastT = now;
  if (pano.open) {
    const phi = THREE.MathUtils.degToRad(90 - pano.lat), theta = THREE.MathUtils.degToRad(pano.lon);
    pano.camera.fov = pano.fov; pano.camera.updateProjectionMatrix();
    pano.camera.lookAt(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    pano.renderer.render(pano.scene, pano.camera);
    return;
  }
  if (state.walking) {
    walker.step(dt);
    if ((roomCheck += dt) > 0.3) { // "You're in K.305" chip
      roomCheck = 0;
      // indoors only the floors around you are drawn; outside, the whole building
      const f = walker.feet, b = buildingBox;
      const indoors = f.x > b.min.x && f.x < b.max.x && f.z > b.min.z && f.z < b.max.z && f.y > levelY[1] - 0.5;
      const want = indoors ? [f.y - 4.2, f.y + 4.6] : [-Infinity, Infinity];
      if (isFinite(want[0]) !== isFinite(band[0]) || Math.abs(want[0] - band[0]) > 0.5) showBand(...want);
      const u = roomAt(walker.feet), chip = $("walkRoom");
      chip._unit = u;
      setWindowRoom(u);
      chip.style.display = u ? "" : "none";
      if (u) chip.textContent = u.kind === "space" ? `${L(u.space.label)} ›` : `${u.label} · ${t(u.status)} ›`;
      updateRail();
    }
  } else {
    if (tween) {
      const k = Math.min(1, (now - tween.s) / tween.d), e = ease(k);
      camera.position.lerpVectors(tween.p0, tween.p1, e);
      controls.target.lerpVectors(tween.t0, tween.t1, e);
      if (k === 1) { const done = tween.done; tween = null; done?.(); }
    }
    controls.update();
  }
  map.update(now);
  if ((creditT += dt) > 0.5) { // Google credit, shown while the map is visible
    creditT = 0;
    const credit = map.on ? `<b>Google</b>${map.attributions()}` : "";
    if ($("mapCredit").innerHTML !== credit) $("mapCredit").innerHTML = credit;
  }
  // --- should we draw this frame? (see "render on demand") ---
  camera.updateMatrixWorld();
  const moved = !camera.matrixWorld.equals(lastCamM) || !camera.projectionMatrix.equals(lastCamP);
  if (moved) { lastCamM.copy(camera.matrixWorld); lastCamP.copy(camera.projectionMatrix); lastCamMove = now; aoPending = true; }
  const busy = moved || tween || map.on || now < dirtyUntil;
  const aoOK = composer && !map.on;
  const stillLongEnough = now - lastCamMove > 250 && now >= dirtyUntil;
  if (!busy && !(aoOK && aoPending && stillLongEnough)) return; // nothing changed: keep the last picture
  const withAO = aoOK && !busy && stillLongEnough;
  if (withAO) aoPending = false;

  // trees in front of the building step aside (not while walking, where they're part of the scenery)
  landscape.updateOcclusion(camera, buildingBox, !state.walking && !state.inside);
  landscape.tick(now / 1000);
  roomGlow.visible = !state.walking && !state.inside && state.floor === null;
  // mood lights: around you when walking/inside; around the mouse cursor (desktop) or screen centre otherwise
  updateMoodFocus();
  mood.update(state.walking || state.inside ? camera.position : moodFocus ?? controls.target);
  const aoMode = state.walking || state.inside ? "in" : "out";
  env.setInside(aoMode === "in");
  if (composer) {
    gtao.enabled = withAO;
    if (aoMode !== aoModeNow) {
      aoModeNow = aoMode; // building-scale AO outside, room-scale AO inside
      gtao.updateGtaoMaterial(aoMode === "out" ? { radius: 1.0, distanceExponent: 1.6, thickness: 1.5, scale: 1, samples: 16 } : { radius: 0.32, distanceExponent: 1.6, thickness: 1.2, scale: 1.15, samples: 16 });
      gtao.blendIntensity = aoMode === "out" ? 0.8 : 0.9;
    }
    const t0 = performance.now();
    composer.render(dt);
    adaptResolution(now, performance.now() - t0, dt, withAO);
  } else renderer.render(scene, camera);
  for (const u of units) {
    const show = u.mesh.visible;
    u.labelEl.style.display = show ? "" : "none";
    if (!show) continue;
    v.copy(u.center); v.y = u.z + 0.2; v.project(camera);
    u.labelEl.style.left = ((v.x + 1) / 2) * innerWidth + "px";
    u.labelEl.style.top = ((1 - v.y) / 2) * innerHeight + "px";
  }
  if (!pins.length) return;
  const showPins = state.floor === null && !lb.open && !state.walking;
  const camDir = v2.copy(camera.position).setY(0).normalize();
  for (const p of pins) {
    p.el.style.opacity = p.dir.dot(camDir) < -0.25 ? 0.3 : 1; // fade pins on the far side of the building
    v.copy(p.pos).project(camera);
    const visible = showPins && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    p.el.style.display = visible ? "" : "none";
    if (!visible) continue;
    p.el.style.left = ((v.x + 1) / 2) * innerWidth + "px";
    p.el.style.top = ((1 - v.y) / 2) * innerHeight + "px";
  }
}
// Compile every shader before the first frame without freezing the page (the browser links them in parallel while the
// loading screen keeps animating). Sky, fog and environment are set first so the compiled variants are the ones used;
// the target is the one the scene is really drawn into (composer: linear, tone-mapped later; Lite: the screen).
// The floor-view objects (room volumes and outlines, floor bands, section caps) are hidden at start, so they are shown
// for the compile and for one warm-up frame (with ambient occlusion) under the loading screen; otherwise the first
// floor click would still build their shaders.
env.set("day", radius);
const floorViewObjects = [...unitMeshes, ...bands, cap, capMesh];
const wasVisible = floorViewObjects.map((o) => o.visible);
floorViewObjects.forEach((o) => (o.visible = true));
try {
  renderer.setRenderTarget(scenePass ? scenePass.target : null);
  await renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  if (composer) { gtao.enabled = true; composer.render(0); gtao.enabled = false; } else renderer.render(scene, camera);
} catch (e) { console.warn("shader pre-compile skipped", e); }
floorViewObjects.forEach((o, i) => (o.visible = wasVisible[i]));
renderer.setRenderTarget(null);
mark("shaders");
setTime("day");
env.onHdriReady((name) => setTime(name)); // the sky photo arrived after start-up: switch to it
window.STIN = { THREE, scene, camera, renderer, walker, env, mood, get gtao() { return gtao; }, get composer() { return composer; }, readyAt: performance.now(), timings, levelObjects, landscape, buildingBox, controls };
mark("ready"); // handy for debugging in the browser console
ready = true;
if (hero.classList.contains("gone") && !lb.open) introFly();
requestAnimationFrame(frame);
ui.loading.classList.add("done");
// the building is on screen (with each material's average colour): now fetch the photo textures
setTimeout(startTextureLoading, 50); // (not tied to a drawn frame: a tab opened in the background draws none)
