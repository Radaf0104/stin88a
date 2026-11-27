import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONFIG } from "./config.js";
import { materialFor, addBoxUVs, setLampGlow, allMaterials, startTextureLoading } from "./materials.js";
// (js/landscape.js - generated trees, hills, grass - replaced by the site plan; kept in the repo for reference)
import { createEnvironment, TIMES } from "./environment.js";
import { createMoodLights, createWindowLight } from "./lighting.js";
import { createWalker } from "./walk.js";
import { createMassing } from "./massing.js";
import { createRoomStyle, STYLE_ROOMS } from "./roomstyle.js";
import { createAccents } from "./accents.js";
import { makeTextures, tileRepeat } from "./proctex.js";
import { createMap } from "./map.js";
import { createGrade, createSky, createPost, QUALITY } from "./grade.js";
import { createIsolation } from "./isolate.js";
import { createSpaces } from "./spaces.js";
import { GPU, FORCE_WEBGL, TSL } from "./gpu.js";
import { createLookTSL } from "./materialsTSL.js";
import { createFoliage, scatterTrees } from "./foliage.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";

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
    panMouse: "right-drag to move the view", panTouch: "two fingers to move the view", goTo: "Go to floor",
    hintInside: "Drag to look around", roomPhotos: "Room photos", seeAngle: "See this angle in 3D", back: "Back to 3D",
    time_day: "☀ Day", time_golden: "🌇 Golden hour", time_night: "☾ Night", walk: "🚶 Walk", hq: "HQ", lite: "Lite",
    exitWalk: "✕ Exit walk", walkHere: "🚶 Walk around", bath: "bathroom",
    massing: "▢ Massing", mapOn: "🌍 Map", mapOff: "🌿 Site plan",mapNoKey: "The real-world map needs a Google Maps API key: add googleMapsKey in js/config.js.",
    walkHintMouse: "Click to look around · WASD / arrows to move · click a door to open it · click the stairs or lift to change floor · Esc releases the mouse",
    walkHintTouch: "Left thumb: move · Right thumb: look · tap a door to open it · tap the stairs or lift to change floor",
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
    panMouse: "klik kanan + geser untuk menggeser tampilan", panTouch: "dua jari untuk menggeser tampilan", goTo: "Pergi ke lantai",
    hintInside: "Geser untuk melihat sekeliling", roomPhotos: "Foto kamar", seeAngle: "Lihat sudut ini di 3D", back: "Kembali ke 3D",
    time_day: "☀ Siang", time_golden: "🌇 Senja", time_night: "☾ Malam", walk: "🚶 Jalan", hq: "HQ", lite: "Ringan",
    exitWalk: "✕ Selesai", walkHere: "🚶 Jalan-jalan", bath: "kamar mandi",
    massing: "▢ Massa", mapOn: "🌍 Peta", mapOff: "🌿 Rencana tapak",mapNoKey: "Peta dunia nyata butuh API key Google Maps: isi googleMapsKey di js/config.js.",
    walkHintMouse: "Klik untuk melihat · WASD / panah untuk berjalan · klik pintu untuk membuka · klik tangga atau lift untuk pindah lantai · Esc melepas mouse",
    walkHintTouch: "Jempol kiri: jalan · Jempol kanan: lihat · ketuk pintu untuk membuka · ketuk tangga atau lift untuk pindah lantai",
  },
};
let lang = CONFIG.defaultLanguage;
try { lang = localStorage.getItem("stin-lang") || lang; } catch {}
const t = (k, ...a) => { const v = STR[lang][k]; return typeof v === "function" ? v(...a) : v ?? k; };
const L = (obj) => (obj && typeof obj === "object" ? obj[lang] ?? obj.en : obj);

const STATUS_COLOR = { available: 0x2fb57a, occupied: 0xe0443e }; // green / red

// ---------- quality: always the full look (AO + bloom + big shadows); the Lite mode and its button were removed ----------
const quality = { high: true };
try { localStorage.removeItem("stin-quality"); } catch {}
// phones (touch screen, short side <= 900 px; round 6 of IMPROVEMENT_LOG.md): the same look, lighter where a phone pays
// the most - a 2048 sun shadow map instead of 4096 (a quarter of the memory), 3 mood lights instead of 6 (each one is
// shaded on every pixel), sharpness capped at 1.25x instead of 1.5x
const phone = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) <= 900;

// ---------- scene ----------
const canvas = document.getElementById("scene");
// (M2) ?renderer=webgpu: WebGPURenderer (three 0.186.1); it falls back to its own WebGL 2 backend by itself where
// WebGPU is missing (?renderer=webgl2 forces that backend, for testing). Default: the classic WebGLRenderer (r170).
const renderer = GPU
  ? new THREE.WebGPURenderer({ canvas, antialias: true, stencil: true, forceWebGL: FORCE_WEBGL })
  : new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true }); // stencil = section caps
if (GPU) await renderer.init();
const maxDpr = quality.high ? (phone ? 1.25 : 1.5) : 1; // sharpness cap: beyond this the GPU cost rises fast for little visible gain
renderer.shadowMap.enabled = true;
// (PCFSoftShadowMap was removed from the new renderer; PCF with a blur radius is its soft shadow)
renderer.shadowMap.type = GPU ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
const maxAniso = () => (GPU ? renderer.getMaxAnisotropy() : renderer.capabilities.getMaxAnisotropy());
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
// (round 20) 2048 / 1024: the shadow box is ~68 m, so 3.3 / 6.6 cm per texel - no visible change at hero distance
// (tools/out/r20_shadow_compare.jpg) and 48 MB less GPU memory than 4096 on desktop
sun.shadow.mapSize.setScalar(quality.high && !phone ? 2048 : 1024);
if (GPU) { sun.shadow.radius = 2; sun.shadow.autoUpdate = false; } // (the new renderer: per-light "render once")
// Ask for one fresh sun shadow render (classic: the renderer-wide flag; new renderer: the light's own flag)
const requestShadow = () => { if (GPU) sun.shadow.needsUpdate = true; else renderer.shadowMap.needsUpdate = true; };
const mood = createMoodLights(scene, quality.high && !phone ? 6 : 3);

// (round 20) the old post-processing chain (composer, AO, bloom, grade pass) was never built any more: its code and
// modules (~180 KB of JS) are gone. These stay null so the guarded calls below keep working.
let composer = null, gtao = null, bloomPass = null, scenePass = null;
// No post-processing: the scene is drawn straight to the screen (with the browser's own edge smoothing). The colour
// grade that used to be a full-screen pass now runs at the end of every material (grade.js), and the sky photo is
// drawn as an object so it is graded too. (Bloom and ambient occlusion were post effects and are gone.)
const grade = createGrade();
const sky = createSky(renderer);
scene.add(sky.mesh);
// (M2) new renderer: the grade (and the old bloom's brightening) is one post-processing pass again, written in TSL;
// materials stay untouched and the sky is the scene background
// (M3) quality tier of the new renderer: ?quality=ultra|high|balanced, else balanced on phones and high elsewhere
const qs = new URLSearchParams(location.search);
const tier = { ...(QUALITY[qs.get("quality")] ?? (phone ? QUALITY.balanced : QUALITY.high)) };
// single switches for testing: ?ao=0|1 &bloom=0|1 &smaa=0|1 &msaa=0|4
for (const k of ["ao", "bloom", "smaa"]) if (qs.has(k)) tier[k] = qs.get(k) === "1";
if (qs.has("msaa")) tier.msaa = +qs.get("msaa");
if (tier.ao) { tier.aoScale ??= 0.5; tier.aoSamples ??= 12; }
const post = GPU ? createPost(renderer, scene, camera, grade.uniforms, tier) : null;
// Every way the scene is really drawn - shaders must be pre-compiled for each (classic: just the screen). New renderer:
// the exterior pass, the AO tiers' depth pass (one flat override material) and the plan-cut pass (stencil, caps).
const compilePasses = () => (post ? post.passes() : [{ target: null, override: null }]);
// run fn() (which calls compileAsync) as if drawing pass p: its target and its override material
function compileFor(p, fn) {
  renderer.setRenderTarget(p.target);
  const keep = scene.overrideMaterial; scene.overrideMaterial = p.override;
  try { return fn(); } finally { scene.overrideMaterial = keep; renderer.setRenderTarget(null); }
}
// (M1) Architectural "shift lens": near eye level the picture is shifted up instead of tilting the camera, so the
// building's verticals stay vertical, like the renders (3.jpg). The shift fades out as the camera rises above ~14 deg,
// and is off while walking or inside a room. Only the projection changes (no extra cost); picking stays consistent
// because the inverse matrix is updated too.
const LENS_SHIFT = 0.62, LENS_FADE = THREE.MathUtils.degToRad(14);
const lensV = new THREE.Vector3();
function applyLens() {
  camera.updateProjectionMatrix(); // resets any previous shift
  let inRoom = false; try { inRoom = !!roomView; } catch {} // (declared further down; a shadow refresh can render first)
  if (state.walking || inRoom) return;
  lensV.subVectors(camera.position, controls.target);
  const elev = Math.asin(THREE.MathUtils.clamp(lensV.y / (lensV.length() || 1), -1, 1));
  const s = LENS_SHIFT * THREE.MathUtils.clamp(1 - elev / LENS_FADE, 0, 1);
  if (s <= 0) return;
  camera.projectionMatrix.elements[9] += s; // off-axis frustum: the view window moves up by s/2 of the screen height
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
function renderScene() { // draw one frame to the screen
  applyLens();
  if (post) { post.render(clipPlane.constant < 1e5); return; } // (M3: the cut views use the stencil chain)
  sky.update(scene);
  renderer.render(scene, camera);
  sky.restore(scene);
}

// Cuts the building above the selected floor (like a plan cut). Applied globally so AO/shadows respect it too.
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
// Always on (parked at 1e6 m when nothing is cut): switching clipping on and off changes every material's shader, and
// the first floor click used to rebuild ~17 shaders at once (a 3–4 s freeze). Staying on keeps the start-up shaders valid.
renderer.clippingPlanes = [clipPlane];
// (M2) the new renderer has no renderer-wide clipping: everything that the plan cut may slice lives in a
// ClippingGroup instead (the section caps, labels and sky stay outside it, as they were never cut in practice)
const clipped = GPU ? Object.assign(new THREE.ClippingGroup(), { clippingPlanes: [clipPlane] }) : scene;
if (GPU) scene.add(clipped);
const root = new THREE.Group();
clipped.add(root);

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
// The landing page is the loading screen (client, 2026-11-26): one full-screen render, shown at once, no click needed.
// When the 3D model is ready and the render has been up for at least HERO_MIN_MS, it fades slowly into the 3D view
// (the camera's intro move plays under the fading image). See leaveHeroWhenReady() at the end of start-up.
const HERO_MIN_MS = 1000, heroShownAt = performance.now();
let heroLeaving = false;
function leaveHero() {
  if (heroLeaving || hero.classList.contains("gone")) return;
  heroLeaving = true;
  hero.classList.add("fading"); // CSS: opacity 1 -> 0 over 1.8 s, ease-in-out
  hero.setAttribute("aria-busy", "false");
  if (ready) { updateRail(); introFly(); }
  setTimeout(() => hero.classList.add("gone"), 1850);
}
function leaveHeroWhenReady() {
  // wait for the first frames to be drawn (so the fade reveals a finished picture), and for the minimum time
  const wait = Math.max(0, HERO_MIN_MS - (performance.now() - heroShownAt));
  setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(leaveHero)), wait);
}

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
// ?model=glb: the Blender-prepared building (data/levels/*.gltf, textured, with baked light) instead of the raw
// Revit triangles. Without it, everything below runs exactly as before.
// (the default since V5; ?model=old shows the raw Revit geometry, data/geometry.q.bin.gz, as before)
const USE_GLB = new URLSearchParams(location.search).get("model") !== "old";
const geoBuf = USE_GLB ? null : await loadGeometry();
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
for (const g of USE_GLB ? [] : model.groups) {
  const src = new Float32Array(geoBuf, g.offset * 4, g.count);
  const pos = new Float32Array(g.count);
  for (let i = 0; i < g.count; i += 3) { pos[i] = src[i]; pos[i + 1] = src[i + 2]; pos[i + 2] = -src[i + 1]; }
  // one mesh per *look* per floor (Revit materials that render identically share a material, see materialFor)
  const mat = materialFor(g.material, model.materials[g.material]);
  const key = mat.uuid + "|" + g.level;
  if (!byMat.has(key)) byMat.set(key, { mat, chunks: [], meta: [] });
  byMat.get(key).chunks.push(pos);
  byMat.get(key).meta.push({ category: g.category, level: g.level });
  if (CAP_CATS.has(g.category)) capChunks.push(pos);
  if (!NO_COLLIDE.has(g.category)) collideChunks.push(pos);
}
const doorChunks = []; // where each door's triangles sit inside the merged meshes (see spaces.js)
const ceilingChunks = [], tvChunks = []; // ceilings (hidden in the room view) and TVs (clickable there)
// Bathroom parts (Revit "Plumbing Fixtures") go last in each mesh, so the building overview can stop drawing just
// before them (they can't be seen from outside); the floor / room / walk views draw everything.
const BATHROOM_CATS = new Set(["Plumbing Fixtures"]);
const buildingMeshes = [];
for (const entry of byMat.values()) {
  const order = entry.chunks.map((c, i) => i).sort((a, b) => BATHROOM_CATS.has(entry.meta[a].category) - BATHROOM_CATS.has(entry.meta[b].category));
  const chunks = order.map((i) => entry.chunks[i]), meta = order.map((i) => entry.meta[i]), mat = entry.mat;
  const geo = geoFrom(chunks);
  geo.computeVertexNormals();
  addBoxUVs(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.overviewVerts = chunks.reduce((a, c, i) => a + (BATHROOM_CATS.has(meta[i].category) ? 0 : c.length), 0) / 3;
  buildingMeshes.push(mesh);
  let at = 0;
  chunks.forEach((c, i) => {
    const ch = { mesh, start: at, count: c.length, level: meta[i].level };
    if (meta[i].category === "Doors") doorChunks.push(ch);
    else if (meta[i].category === "Ceilings") ceilingChunks.push(ch);
    else if (meta[i].category === "Communication Devices") tvChunks.push(ch);
    at += c.length;
  });
  mesh.castShadow = !mat.transparent; // glass and water let the light through
  mesh.receiveShadow = true;
  if (mat.transparent) mesh.renderOrder = 3;
  root.add(track(mesh));
}
// ---------- ?model=glb: the Blender levels (tools/blender/*, tools/pack-levels.mjs) ----------
// Each level file is in root-local coordinates already (Revit x, z, -y), so it goes straight under `root`.
// Object extras (glTF) arrive as userData: kind (shell / ceiling / stair / railing / doorframe / door / bed / tv ...),
// level, collide, bathroom, tv, room, lm_set, door_width / door_slide / door_wide_axis.
const doorLeaves = [], ceilingObjs = [], tvObjs = [], glbLightmapped = [];
// per-material colour factors (linear) from the round 17 swatch match; sRGB ratios r/g/b converted with ^2.2
const lin = (r, g, b) => [r, g, b].map((v) => Math.pow(v, 2.2));
const FACADE_TINT = {
  // (M1) teak was lin(0.96, 1.16, 1.41): matched under the old mauve grade, it read grey-beige once that was fixed
  M_teak_timber: lin(0.97, 1.04, 1.13), M_teak_batten: lin(0.97, 1.04, 1.13), M_teak_deck: lin(1.05, 1.1, 1.12),
  // (M1) was lin(0.95, 0.94, 0.985): its lilac cast (blue up, green down) helped turn the shaded walls mauve
  M_plaster_cream: lin(0.95, 0.95, 0.945), // (stronger factors barely move sunlit plaster - tone shoulder + highlight lift - and only darken the shade)
};
// (M1) physically plausible values: painted / powder-coated frames, railings and fascias are dielectrics (metalness 0;
// 0.35 mirrored the sky and read navy), brass is a metal. Applied once per shared material.
const PBR_FIX = {
  M_metal_grey: { metalness: 0, roughness: 0.45 }, M_metal_dark: { metalness: 0, roughness: 0.42 },
  M_brass: { metalness: 1, roughness: 0.32 },
};
// (M1) every glTF map was sampled with anisotropy 1, so facades and paving blurred at grazing angles
const TEX_ANISO = phone ? 4 : 8;
// (round 19) texture density: the teak deck (balconies, and the corridor / communal floors) tiled every ~1.3 m, so its
// knots read ~25 cm wide at eye level. x2.5 = real-sized grain. Same images (shared source), only the UV scale.
const TEX_DENSITY = { M_teak_deck: 2.5 };
let accents = null; // (round 22) js/accents.js - set once the levels are in
// a copy of a material whose texture lookups move by a per-instance amount (0..1 of the texture) on instanced draws
function jitterInstanceUVs(m) {
  const c = m.clone();
  c.userData = { ...m.userData }; delete c.userData.isoPatched; delete c.userData.gradePatched; // (patched again later)
  if (GPU) { // (M2) the same per-instance offset as TSL nodes: colour, roughness and normal read at the moved UV
    const { varying, fract, vec2, float, instanceIndex, uv, texture, uniform, normalMap } = TSL;
    const uvJ = uv().add(varying(fract(vec2(float(instanceIndex).mul(0.7548777), float(instanceIndex).mul(0.5698403)))));
    if (c.map) c.colorNode = texture(c.map, uvJ).mul(uniform(c.color));
    if (c.roughnessMap) c.roughnessNode = texture(c.roughnessMap, uvJ).g.mul(c.roughness);
    if (c.normalMap) c.normalNode = normalMap(texture(c.normalMap, uvJ), uniform(c.normalScale));
    return c;
  }
  c.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <uv_vertex>", `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec2 uvJit = fract(vec2(float(gl_InstanceID) * 0.7548777, float(gl_InstanceID) * 0.5698403));
        #ifdef USE_MAP
          vMapUv += uvJit;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv += uvJit;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv += uvJit;
        #endif
      #endif`);
  };
  c.customProgramCacheKey = () => "uvjit";
  return c;
}
let lightmapManifest = {};
let loadKtx = null; // url -> Promise<texture>, through the shared KTX2 loader below
const GLB_LEVELS = ["L0", "L1", "L2", "L3", "L4", "ROOF"]; // (the 88A file's own SITE level is replaced by the masterplan site plan, see "Ground")
if (USE_GLB) {
  const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
    import("three/addons/loaders/GLTFLoader.js"), import("three/addons/loaders/KTX2Loader.js"), import("three/addons/libs/meshopt_decoder.module.js")]);
  const ktx2 = new KTX2Loader().setTranscoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/").detectSupport(renderer);
  // The levels share their textures (data/levels/tex/*.ktx2). Loaded in parallel (round 4 preloads), each level's
  // parser asked for the same files at the same moment - before any was cached - so ~3 MB downloaded twice. One
  // promise per file: every texture is fetched and transcoded once and shared by all levels (round 7).
  const ktxShared = new Map(), ktxLoad = ktx2.load.bind(ktx2);
  ktx2.load = (url, onLoad, onProgress, onError) => {
    if (phone) url = url.replace("/levels/tex/", "/levels/tex_m/"); // phones: the half-size set (round 13)
    if (!ktxShared.has(url)) ktxShared.set(url, new Promise((res, rej) => ktxLoad(url, res, onProgress, rej)));
    ktxShared.get(url).then(onLoad, onError);
  };
  loadKtx = (url) => new Promise((res, rej) => ktx2.load(url, res, undefined, rej)); // (round 28: the style rooms' CC0 set)
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
  lightmapManifest = await fetch("data/levels/lightmaps.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const lmCache = new Map();
  const lmTex = (file, srgb) => {
    if (!lmCache.has(file)) lmCache.set(file, ktx2.loadAsync("data/levels/" + file).then((t) => {
      t.channel = 1; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.flipY = false; return t; }).catch(() => null));
    return lmCache.get(file);
  };
  // site shaders by material name (glass with Fresnel, frosted glass, water)
  const OVERRIDE = { M_glass_clear: "Glazing-Clear", M_glass_frosted: "GLAZINGfrosty", M_water: "Water" };
  const gltfs = await Promise.all(GLB_LEVELS.map((L) => loader.loadAsync(`data/levels/${L}.gltf`).catch((e) => { console.warn("level", L, e); return null; })));
  const box = new THREE.Box3(), m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), sharedMats = new Map();
  for (const gltf of gltfs) {
    if (!gltf) continue;
    root.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      // extras sit on the nearest node with a kind: the mesh itself, its multi-material parent, or - for hinged doors
      // (a pivot node at the hinge holding the multi-material leaf node) - the grandparent
      let owner = o;
      while (owner && !owner.userData.kind && owner !== gltf.scene) owner = owner.parent;
      const ud = owner?.userData.kind ? owner.userData : {};
      Object.assign(o.userData, { ...ud, ...o.userData });
      const name = o.material?.name;
      const base = name?.replace(/__raw$/, ""); // (round 14: style rooms' raw-UV copies of a material, see pack-levels packUVs)
      if (OVERRIDE[base]) o.material = materialFor(OVERRIDE[base], {});
      // one material per name across all levels (round 8): every level file brings its own copy of the same Blender
      // material (same textures, now shared - round 7), which multiplied materials and GPU state changes per frame
      else if (name && !Array.isArray(o.material)) {
        const first = sharedMats.get(name);
        if (first) o.material = first;
        else {
          sharedMats.set(name, o.material);
          // (round 17) facade colours matched to the hero render by swatch, from its own camera: the timber read too
          // orange (#a6724c vs #a0846b), the sunlit plaster a touch bright / yellow (#f4e9d2 vs #e7dbcf). Factor = render / ours.
          const tint = FACADE_TINT[name];
          if (tint && o.material.color) o.material.color.multiply(new THREE.Color().setRGB(...tint, THREE.LinearSRGBColorSpace));
          if (PBR_FIX[name]) Object.assign(o.material, PBR_FIX[name]);
          for (const slot of ["map", "normalMap", "roughnessMap", "metalnessMap", "bumpMap", "aoMap"])
            if (o.material[slot]) o.material[slot].anisotropy = TEX_ANISO;
          const k = TEX_DENSITY[name];
          if (k) for (const slot of ["map", "normalMap", "roughnessMap", "metalnessMap", "bumpMap"]) {
            const t = o.material[slot]; if (!t) continue;
            const c = t.clone(); c.repeat.multiplyScalar(k); c.offset.multiplyScalar(k); // uv' = k * (uv * 256 - 128)
            o.material[slot] = c;
          }
        }
      }
      // (round 21) facade battens drawn as instances of one box (pack-levels instanceBoxes): every copy shares the first
      // box's UVs, so each gets its own offset into the teak texture (hashed from its instance number) - no repeated knots
      if (o.isInstancedMesh && /_box_inst$/.test(o.name)) o.material = jitterInstanceUVs(o.material);
      o.castShadow = !o.material.transparent; o.receiveShadow = true;
      if (o.material.transparent) o.renderOrder = 3;
      // GPU-instanced furniture (tools/pack-levels.mjs instanceHeavy): its bounds cover every instance
      if (o.isInstancedMesh) { o.computeBoundingBox(); o.computeBoundingSphere(); box.copy(o.boundingBox).applyMatrix4(o.matrixWorld); }
      else box.setFromObject(o);
      o.userData.y = [box.min.y, box.max.y];
      if (ud.kind === "door") { if (!doorLeaves.includes(owner)) doorLeaves.push(owner); return; } // owner = the hinge pivot
      levelObjects.push(o);
      if (ud.kind === "ceiling") ceilingObjs.push(o);
      if (ud.kind === "tv") tvObjs.push(o);
      if (["shell", "ceiling", "stair", "railing", "doorframe"].includes(ud.kind)) { o.userData.overviewVerts = Infinity; buildingMeshes.push(o); }
      // walk-mode collision: root-local, non-indexed triangles (as the Revit path builds them). (round 24) Not the
      // ceilings (above the walker's head) nor the facade battens (outside every walkable area): 338k -> ~261k
      // triangles, so the collision tree - built before the first frame - is quicker to make
      if (ud.collide && ud.kind !== "ceiling" && !/^M_teak_batten/.test(o.material?.name ?? "")) {
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        const p = g.attributes.position;
        const im = new THREE.Matrix4(), n = o.isInstancedMesh ? o.count : 1; // instanced: every copy collides
        for (let k = 0; k < n; k++) {
          const out = new Float32Array(p.count * 3);
          if (o.isInstancedMesh) { o.getMatrixAt(k, im); m4.multiplyMatrices(o.matrixWorld, im); } else m4.copy(o.matrixWorld);
          for (let i = 0; i < p.count; i++) { v3.fromBufferAttribute(p, i).applyMatrix4(m4); out[i * 3] = v3.x; out[i * 3 + 1] = v3.y; out[i * 3 + 2] = v3.z; }
          collideChunks.push(out);
        }
      }
      if (ud.lm_set && lightmapManifest[ud.lm_set] && o.geometry.attributes.uv1) { o.material = o.material.clone(); glbLightmapped.push(o); }
    });
  }
  // lightmaps: one per lightmap set and time of day (falls back to any time that was baked); AO on the same UVs
  window.applyLightmaps = async (time) => {
    for (const o of glbLightmapped) {
      const e = lightmapManifest[o.userData.lm_set]; const t = e[time] ?? e.day ?? e.golden ?? e.night;
      if (!t) continue;
      const [lm, ao] = await Promise.all([lmTex(t.file, true), e.ao ? lmTex(e.ao.file, false) : null]);
      o.material.lightMap = lm; o.material.lightMapIntensity = (TIMES[time]?.lightmap ?? 1) / t.scale;
      if (ao) { o.material.aoMap = ao; o.material.aoMapIntensity = TIMES[time]?.aoMap ?? 1; }
      o.material.needsUpdate = true;
    }
    invalidate(300);
  };
  timings.glb = `${gltfs.filter(Boolean).length} levels, ${levelObjects.length} meshes, ${doorLeaves.length} door leaves, ${glbLightmapped.length} lightmapped`;
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
for (const fx of USE_GLB ? [] : model.fixtures ?? []) {
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
      im.userData.bathroom = true; // toilets, showers, basins: hidden in the building overview
      levelObjects.push(im);
      root.add(im);
    }
  }
}
timings.fixtureTriangles = `${Math.round(fixtureTris[0])} -> ${Math.round(fixtureTris[1])} per set`;
mark("fixtures");
// Office chairs: the Revit family is ~355k triangles each, so a simple stand-in chair is drawn in its place.
for (const px of USE_GLB ? [] : model.proxies ?? []) {
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

// Ground: the masterplan site plan (Revit "STIN MASTERPLAN FINAL": terrain, roads, pads, retaining walls), built by
// tools/build-siteplan.mjs already in the building's own frame - so it only needs root's offset (set below). It
// replaces the generated lawn, trees and hills; ~120 KB, flat light colours, loaded without holding up the building.
const ground = new THREE.Group();
const sitePlanMats = []; let sitePlanLift = -1; // (floor-view brightening of the site plan, see frame())
const SITE_PLAN_LIGHT = { // the light plan palette used in the white floor views (Level 1)
  grass: new THREE.Color("#c3d1a6"), soil: new THREE.Color("#ddd3c2"), road: new THREE.Color("#c4c3bf"), pad: new THREE.Color("#e8e5df"),
};
ground.name = "siteplan";
clipped.add(ground); // (M2: inside the plan-cut group on the new renderer)
const sitePlanReady = Promise.all([import("three/addons/loaders/GLTFLoader.js"), import("three/addons/libs/meshopt_decoder.module.js")])
  .then(([{ GLTFLoader }, { MeshoptDecoder }]) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync("data/levels/SITEPLAN.gltf"))
  .then((g) => {
    // (round 18) subtle procedural texture on the site's flat colours (0 bytes: js/proctex.js), tiled by its metre UVs:
    // asphalt mottling on roads, slab joints on the concrete pads, a large soft variation on lawn and soil
    const T = makeTextures(renderer);
    const SITE_TEX = { road: [T.plaster, 3], pad: [T.porcelain, 1.2], grass: [T.plaster, 9], soil: [T.plaster, 5] };
    g.scene.traverse((o) => {
      const st = o.isMesh && SITE_TEX[o.material?.name?.replace("SITE_", "")];
      if (st && o.geometry.attributes.uv) { // UVs arrive as (metres + 256) / 512 (tools/build-siteplan.mjs): repeat / offset undo it
        const t = tileRepeat(st[0], st[1]); t.repeat.set(512 / st[1], 512 / st[1]); t.offset.set(-256 / st[1], -256 / st[1]);
        o.material.map = t; o.material.needsUpdate = true;
      }
      // (M1) with the shade no longer tinted, the lawn read dark olive next to 3.jpg's (#6e7338 average): x1.3
      if (o.isMesh && o.material?.name === "SITE_grass" && !o.material.userData.m1Lift) { o.material.color.multiplyScalar(1.3); o.material.userData.m1Lift = true; }
    });
    g.scene.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = false; if (!sitePlanMats.includes(o.material)) sitePlanMats.push(o.material); } });
    ground.add(g.scene);
    return g.scene;
  })
  .catch((e) => { console.warn("site plan", e); return null; });
// Massing of the planned buildings on the masterplan pads (js/massing.js, data/massing.json): white boxes in the site
// plan's frame, so they live in `ground` too. Shown / hidden with the "Massing" button (remembered per browser).
let massing = null;
const massingOn = true; // always shown (no toggle any more); the pad-1 box hides itself when it blocks the view
try { localStorage.removeItem("stin-massing"); } catch {}
const massingReady = createMassing({ parent: ground }).then((m) => {
  massing = m; m.setVisible(massingOn); m.setLang(lang); requestShadow();
  try { invalidate(300); } catch {} // (if it arrives before the render loop is set up, the first frame draws it anyway)
  return m;
}).catch((e) => { console.warn("massing", e); return null; });
// (M5) Trees (js/foliage.js) and a photographed lawn (CC0 ambientCG Grass004), once the site plan and massing are in.
// Trees stand on lawn only, clear of the building, the neighbour blocks, roads / pads and the lawn in front of the
// terrace facade (the hero view, like 3.jpg, keeps an open lawn with trees to the sides and behind). In `ground`, so
// they come and go with the site in the floor / room views. ?trees=0 leaves them out (A/B).
// The trees and the re-textured lawn are compiled (async, for every pass) before they are shown, so their shaders are
// never built in the middle of a frame (new renderer: seconds of freeze; classic: ~0.6 s).
async function compileQuietly(obj) {
  const all = [];
  for (const p of compilePasses()) compileFor(p, () => { if (p.stencil && compilePasses().length > 1) return; all.push(renderer.compileAsync(obj, camera, scene)); });
  await Promise.all(all).catch(() => {});
}
let foliage = null;
const foliageReady = Promise.all([sitePlanReady, massingReady]).then(async ([site, mass]) => {
  if (!site || qs.get("trees") === "0" || !loadKtx) return null;
  const t0 = performance.now();
  const lawn = site.getObjectByName("siteplan_grass");
  // lawn: the photo + its normal map, tiled every 2.5 m on the site plan's metre UVs ((m + 256) / 512), toned to the
  // deeper olive of 3.jpg's lawn (#6e7338 average); the normal map lets the blades catch the low morning sun
  const texDir = phone ? "data/levels/tex_m/" : "data/levels/tex/";
  const lawnReady = lawn ? Promise.all([loadKtx(texDir + "lawn_grass.ktx2"), loadKtx(texDir + "lawn_grass_nor.ktx2")]).then(async ([t, n]) => {
    for (const x of [t, n]) {
      x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = TEX_ANISO;
      x.repeat.set(512 / 2.5, 512 / 2.5); x.offset.set(-256 / 2.5, -256 / 2.5);
    }
    t.colorSpace = THREE.SRGBColorSpace; n.colorSpace = THREE.NoColorSpace;
    // a re-textured copy, compiled first, then swapped in (the old material keeps drawing meanwhile)
    const m = lawn.material.clone();
    Object.assign(m, { map: t, normalMap: n, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92 });
    m.color.setRGB(0.5, 0.54, 0.4); grade.patch(m);
    const old = lawn.material; lawn.material = m; const shown = lawn.visible;
    lawn.visible = true; await compileQuietly(lawn); lawn.visible = shown;
    const i = sitePlanMats.indexOf(old); if (i >= 0) sitePlanMats[i] = m;
    invalidate(300);
  }).catch((e) => console.warn("lawn", e)) : null;
  // ground hits: the site plan meshes get a bounding-volume tree (three-mesh-bvh, already loaded for walking), one ray
  // per candidate (plain raycasts took ~1.2 s per pass over ~1000 points)
  const hitables = []; site.traverse((o) => o.isMesh && hitables.push(o));
  for (const o of hitables) { o.geometry.boundsTree ??= new MeshBVH(o.geometry); o.raycast = acceleratedRaycast; }
  const keepBoxes = [buildingBox.clone().expandByScalar(5)];
  mass?.group?.traverse?.((o) => { if (o.isMesh) keepBoxes.push(new THREE.Box3().setFromObject(o).expandByScalar(3)); });
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3(), hits = new Map();
  ray.firstHitOnly = true;
  const hitAt = (x, z) => {
    const k = x + "," + z; if (hits.has(k)) return hits.get(k);
    from.set(x, 200, z); ray.set(from, down);
    const h = ray.intersectObjects(hitables, false).sort((a, b) => a.distance - b.distance)[0] ?? null;
    hits.set(k, h); return h;
  };
  const heroLawn = (x, z) => x > -32 && x < 32 && z > buildingBox.max.z && z < buildingBox.max.z + 60;
  const places = scatterTrees({
    bounds: new THREE.Box3().setFromObject(lawn ?? site),
    isLawn: (x, z) => hitAt(x, z)?.object === lawn,
    groundY: (x, z) => hitAt(x, z)?.point.y ?? null,
    keepOut: (x, z) => heroLawn(x, z) || keepBoxes.some((b) => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z),
  });
  timings.treeScatter = Math.round(performance.now() - t0);
  const f = createFoliage({ places, loadKtx, phone, anisotropy: TEX_ANISO });
  for (const m of f.materials) grade.patch(m);
  try { look?.apply(f.group); } catch {} // (look is declared further down; the trees may arrive first)
  await f.ready; // textures in before the first compile, so the shaders are built once
  await compileQuietly(f.group);
  ground.add(f.group); foliage = f;
  await lawnReady;
  invalidate(300);
  timings.trees = places.length;
  return f;
}).catch((e) => { console.warn("trees", e); return null; });
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
ground.position.copy(root.position); // the site plan is in the building's frame too
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
mark("collisionMerge");
const walker = createWalker({ camera, dom: canvas, geometry: collideGeo, onExit: () => exitWalk() });
mark("collision");

// ---------- landscape ----------
// The generated trees, distant hills and 3D grass were replaced by the site plan (see "Ground" above). The calls the
// rest of the page makes to the landscape stay, on this empty stand-in (js/landscape.js is no longer loaded).
const landscape = { group: new THREE.Group(), setNight() {}, updateOcclusion() {}, tick() {}, addGrass() {} };
clipped.add(landscape.group);

// ---------- real-world map (Google 3D Tiles) ----------
const map = createMap({ scene, camera, renderer, site: CONFIG.site ?? {}, apiKey: CONFIG.googleMapsKey });
let mapWanted = false;
function applyMap() {
  const cut = clipPlane.constant < 1e5 && !state.walking; // a plan cut would slice the hills, so pause the map
  const on = mapWanted && !cut;
  const was = map.on;
  map.set(on);
  ground.visible = landscape.group.visible = !on && isoK < 1; // Google's tiles bring their own ground and trees; white views have none
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
// (round 15) the style rooms' small dressing - kept as separate meshes so it can be clicked (js/roomstyle.js) - is only
// specks behind glass from outside: ~45 draw calls in the overview for nothing
const SMALL_DRESSING = new Set(["lamp", "led", "decor", "cushion", "curtain", "rug", "plant"]);
const OVERVIEW_HIDDEN = new Set(["chair", "plant", "lamp", "decor", "cushion", "rug"]);
function showBand(lo = -Infinity, hi = Infinity) {
  band = [lo, hi];
  for (const o of levelObjects) o.visible = o.userData.y[1] >= lo && o.userData.y[0] <= hi && !o.userData.hidden;
  // from outside (building overview) the doors inside the building can't be seen: don't draw them
  const outside = state.floor === null && !state.walking;
  // (round 2 of the improvement log: the corridor entrance doors too - they face the enclosed corridors)
  if (outside) try { for (const d of spaces.doors) if (d.interior || d.role === "entrance") d.pivot.visible = false; } catch {} // (spaces not built yet)
  // the exterior doors: their static stand-in in the overview (round 16), the real hinged leaves everywhere else
  try { const proxy = outside && band[0] === -Infinity && overviewDoorProxies.length > 0;
    for (const m of overviewDoorProxies) m.visible = proxy; if (proxy) for (const d of overviewDoorLeaves) d.pivot.visible = false; } catch {}
  // nor the bathrooms: their fittings (instanced) and the Revit plumbing at the end of each building mesh; nor the TVs
  // (on the inner walls, ~2 draw calls each)
  // (round 23) nor the small loose items in every room (chairs, plants, lamps, decor...): through the windows they
  // changed at most 15 of ~89k pixels on any gallery camera, but cost 29 draw calls and ~138k triangles (no frame-time
  // change measurable on a desktop GPU; meant for weak phone GPUs). Beds, casework, curtains and the terrace stay.
  for (const o of levelObjects) if (outside && (o.userData.bathroom || o.userData.kind === "tv" || OVERVIEW_HIDDEN.has(o.userData.kind) || (o.userData.style_room && SMALL_DRESSING.has(o.userData.kind)))) o.visible = false;
  for (const m of buildingMeshes) {
    m.geometry.setDrawRange(0, outside ? m.userData.overviewVerts : Infinity);
    if (outside && !m.userData.overviewVerts) m.visible = false;
  }
}
// Re-render the sun's shadow map with the whole (cut) building present, so hidden floors still cast shadows.
function refreshShadows() {
  const keep = band;
  showBand();
  requestShadow();
  // drawn into the scene's own buffer (the next frame overwrites it), not the screen: a screen render needs a second,
  // screen-specific version of every shader, which used to be built on the first floor click (a multi-second freeze)
  renderer.setRenderTarget(scenePass ? scenePass.target : null);
  renderScene();
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

// ---------- isolation (floor / room / walk views) and the walkable spaces with their doors ----------
const iso = createIsolation();
iso.setBounds(buildingBox, 6);
const probeRay = new THREE.Ray();
const spaces = createSpaces({ model, units, levelY, root, buildingBox, doorChunks, doorLeaves: USE_GLB ? doorLeaves : null,
  probe: (o, dir, min, max) => { const h = walker.raycastAll(probeRay.set(o, dir)).find((x) => x.distance > min); return h && h.distance < max ? h.distance : null; } });
for (const d of spaces.doors) { d.pivot.userData.y = [d.box.min.y, d.box.max.y]; levelObjects.push(d.pivot); } // drawn per floor like the rest

// (round 16) The overview draws the exterior doors (balcony glass, fixed leaves) closed and never moves them, yet each
// leaf is its own hinged mesh with 2-4 materials: ~90 draw calls. A static stand-in - all those leaves joined per
// material, in world space, at their closed position (every vertex where it is; mirrored ones get their winding flipped
// back) - is drawn in the overview instead; floor, room and walk views keep the real hinged leaves.
const overviewDoorLeaves = spaces.doors.filter((d) => !d.interior && d.role !== "entrance");
const overviewDoorProxies = [];
{
  const groups = new Map();
  for (const d of overviewDoorLeaves) d.pivot.traverse((o) => { if (o.isMesh && !Array.isArray(o.material)) { if (!groups.has(o.material)) groups.set(o.material, []); groups.get(o.material).push(o); } });
  const f32 = (a) => { const f = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c); return new THREE.BufferAttribute(f, a.itemSize); };
  for (const [mat, list] of groups) {
    const geos = [];
    for (const o of list) {
      o.updateWorldMatrix(true, false);
      const g = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv"]) if (o.geometry.attributes[name]) g.setAttribute(name, f32(o.geometry.attributes[name]));
      g.setIndex(o.geometry.index ? Array.from(o.geometry.index.array) : [...Array(g.attributes.position.count).keys()]);
      g.applyMatrix4(o.matrixWorld);
      if (o.matrixWorld.determinant() < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
      geos.push(g);
    }
    const names = new Set(geos.map((g) => Object.keys(g.attributes).sort().join()));
    const merged = names.size === 1 ? mergeGeometries(geos, false) : null;
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat); m.castShadow = !mat.transparent; m.receiveShadow = true; if (mat.transparent) m.renderOrder = 3;
    m.visible = false; m.userData.overviewDoors = true; clipped.add(m); overviewDoorProxies.push(m);
  }
}
timings.doors = `${spaces.doors.length} doors (${spaces.doors.filter((d) => d.role === "entrance").length} entrance, ${spaces.doors.filter((d) => d.role === "inside").length} inside)`;

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
// (M1) The first view is the eye-level hero of 3.jpg: standing on the lawn in front of the terrace facade (+z), at
// eye height, looking level (the shift lens frames the whole building). The aerial overview stays for floor exits.
const heroView = {
  pos: new THREE.Vector3(-2, 1.7, buildingBox.max.z + 31),
  target: new THREE.Vector3(-1, 1.2, 0),
};
// Portrait screens (phones) are too narrow for a 48 m facade at eye level (it was cut off and tiny): they keep the
// aerial overview as before.
function introFly() { const v = camera.aspect >= 1 ? heroView : overviewView; flyTo(v.pos, v.target, 2.2); }

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
function setCut(y, caps = true) {
  const on = y !== null && y !== undefined;
  clipPlane.constant = on ? y : 1e6; // (the plane is always active; "no cut" just parks it far above the building)
  cap.visible = capMesh.visible = on && caps;
  if (on) cap.position.y = y - 0.002;
  // floors entirely above the cut aren't drawn at all (nor, once faded to white, the ones below the isolated floor)
  showBand(isoK >= 1 && on && state.floor !== null ? levelY[state.floor] - 0.6 : -Infinity, on ? y : Infinity);
  applyMap();
  if (isoK < 0.5) refreshShadows(); // plain light has no sun, so no shadows to update
}

// ---------- isolated views: the outside melts to white and the light turns plain while the camera flies in ----------
// isoK 0 = the full scene (sky, landscape, sun, shadows, ambient occlusion, bloom), 1 = only the masked part on white
// with plain even light. Everything here only changes numbers (no shader rebuilds), so it can be animated.
const WHITE_BG = new THREE.Color(1.6, 1.6, 1.6); // > 1 so it stays pure white after the tone curve
let isoK = 0, isoAnim = null, savedSky = null;
function setIsoK(k) {
  if (k > 0 && !savedSky) savedSky = { bg: scene.background, intensity: scene.backgroundIntensity, fog: scene.fog?.density ?? 0 };
  isoK = k;
  iso.fade = k;
  accents?.setPlain(k);
  env.setPlain(k);
  const tm = env.time ?? {};
  mood.setFactor((tm.lamps ?? 1) * (1 - k));
  if (bloomPass) bloomPass.enabled = k === 0;
  if (post) post.aoAmount.value = 1 - k; // (M3) the plain white views fade the AO out with the sky
  grade.enabled = k < 0.5; // plain white views: no grade (as before)
  grade.bloom = k === 0;    // nor the bloom brightening (bloom was off there too)
  if (savedSky) {
    if (k >= 1) scene.background = WHITE_BG;
    else { scene.background = savedSky.bg; scene.backgroundIntensity = savedSky.intensity * (1 + 14 * k * k); } // sky washes out to white
    if (scene.fog) scene.fog.density = savedSky.fog * (1 - k);
  }
  const outsideOn = k < 1 && !map.on;
  ground.visible = landscape.group.visible = outsideOn; // fully faded: not drawn at all
  // fully faded: the floors under the isolated one aren't drawn either (they were only being dissolved)
  if (!state.walking && state.floor !== null) showBand(k >= 1 ? levelY[state.floor] - 0.6 : -Infinity, clipPlane.constant);
  if (k === 0 && savedSky) { savedSky = null; refreshShadows(); }
  invalidate(100);
}
function animateIso(to, dur = 1.1) {
  if (to === isoK && !isoAnim) return;
  isoAnim = { from: isoK, to, s: performance.now(), d: dur * 1000 };
}

// The isolated views start just under the floor surface: the slab edges and the beams hanging under it would
// otherwise show as grey strips under the walls and floor.
const FLOOR_DEPTH = 0.03;
function floorView(level) { // section box around one floor: the whole footprint, from just under its slab to the cut
  iso.setMask(spaces.footprint(), 0, levelY[level] - FLOOR_DEPTH);
  controls.minDistance = 6;
}
function selectFloor(level, fly = true) {
  if (state.inside) leaveInside();
  clearRoomView();
  state.floor = level;
  state.unit = null;
  const on = level !== null;
  if (on) floorView(level);
  animateIso(on ? 1 : 0);
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
  $("insidePano").classList.toggle("hidden", !panoOf(u)?.pano);
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

// Room view: only this room (with its bathroom and balcony) on white, cut just under the ceiling, to turn around.
const planToWorld = (pts) => pts.map(([x, y]) => [x + root.position.x, -y + root.position.z]);
function selectUnit(u) {
  if (state.inside || state.floor !== u.level) selectFloor(u.level, false);
  clearRoomView();
  state.unit = u;
  const sp = spaces.unitSpace(u);
  // only this room: its outline grown by one wall thickness (0.15 m), so the neighbours' floors and walls stay out
  iso.setMask(sp ? sp.mask : [planToWorld(u.outline)], 0.16, levelY[u.level] - FLOOR_DEPTH);
  animateIso(1);
  setCut(levelY[u.level] + 3.2); // section 3.2 m above the floor; the ceiling itself is hidden (setCeilings)
  setRoomView(u, sp);
  for (const m of unitMeshes) m.visible = false;
  // look in from above the corridor side, slightly diagonal
  const b = u.box, size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z), d = size * 1.5 + 7;
  const target = u.center.clone(); target.y = levelY[u.level] + 1;
  controls.minDistance = 2;
  flyTo(new THREE.Vector3(target.x + d * 0.55, target.y + d * 0.95, target.z + d * 0.75), target, 1.2);
  showCard(u);
  renderUI();
}

// ---------- room view extras: doll's-house cutaway, no ceilings, clickable TV and doors ----------
let roomView = null; // { u, sp, inner: room + bathroom box, outer: + balcony, floorY, tvs }
// Ceilings: their triangles are collapsed in place while a room is shown (and put back after), like the door leaves
let ceilSaved = null, ceilHidden = false;
function setCeilings(show) {
  if (USE_GLB) { for (const o of ceilingObjs) { o.userData.hidden = !show; o.visible = show; } ceilHidden = !show; return; }
  if (show === !ceilHidden) return;
  ceilHidden = !show;
  ceilSaved ??= ceilingChunks.map((ch) => ch.mesh.geometry.attributes.position.array.slice(ch.start, ch.start + ch.count));
  ceilingChunks.forEach((ch, i) => {
    const a = ch.mesh.geometry.attributes.position;
    if (show) a.array.set(ceilSaved[i], ch.start); else a.array.fill(0, ch.start, ch.start + ch.count);
    a.addUpdateRange(ch.start, ch.count); a.needsUpdate = true;
  });
}
// TVs ("Communication Devices" in Revit) of a room: one screen per room, found once from the triangles in the room
const tvCache = new Map();
function tvOf(u) {
  if (tvCache.has(u)) return tvCache.get(u);
  if (USE_GLB) { // the TV objects standing in this room (their bounding box, world coordinates)
    const b = new THREE.Box3(), c = new THREE.Vector3();
    const tv = tvObjs.find((o) => { b.setFromObject(o); b.getCenter(c); return Math.abs(c.y - levelY[u.level] - 1.3) < 1.2 && inPoly(c.x - root.position.x, -(c.z - root.position.z), u.outline); });
    const res = tv ? makeTv(u, new THREE.Box3().setFromObject(tv)) : null; tvCache.set(u, res); return res;
  }
  const fy = levelY[u.level], box = new THREE.Box3(), rp = root.position;
  let n = 0;
  for (const ch of tvChunks) {
    if (ch.level !== u.level) continue;
    const a = ch.mesh.geometry.attributes.position.array;
    for (let i = ch.start; i < ch.start + ch.count; i += 9) {
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
      if (cy + rp.y < fy + 0.3 || cy + rp.y > fy + 2.3) continue;
      if (!inPoly(cx, -cz, u.outline)) continue; // (mesh coordinates -> Revit plan)
      for (let v = 0; v < 9; v += 3) box.expandByPoint(new THREE.Vector3(a[i + v], a[i + v + 1], a[i + v + 2]).add(rp));
      n++;
    }
  }
  let tv = null;
  const s = box.getSize(new THREE.Vector3());
  if (n && Math.max(s.x, s.z) > 0.45 && s.y > 0.25 && Math.min(s.x, s.z) < 0.3) tv = makeTv(u, box);
  tvCache.set(u, tv);
  return tv;
}
// The picture on the screen: a streaming app's home page, drawn once
let tvTexture = null;
function streamingTexture() {
  if (tvTexture) return tvTexture;
  const cv = document.createElement("canvas"); cv.width = 640; cv.height = 360;
  const g = cv.getContext("2d");
  g.fillStyle = "#141414"; g.fillRect(0, 0, 640, 360);
  const hero = g.createLinearGradient(0, 0, 640, 220);
  hero.addColorStop(0, "#3b1d12"); hero.addColorStop(0.55, "#7a2e1a"); hero.addColorStop(1, "#1d2c44");
  g.fillStyle = hero; g.fillRect(0, 0, 640, 220);
  const fade = g.createLinearGradient(0, 120, 0, 220); fade.addColorStop(0, "rgba(20,20,20,0)"); fade.addColorStop(1, "#141414");
  g.fillStyle = fade; g.fillRect(0, 120, 640, 100);
  g.fillStyle = "#e50914"; g.font = "bold 34px Arial Black, Arial, sans-serif"; g.fillText("NETFLIX", 26, 52);
  g.fillStyle = "#fff"; g.font = "bold 30px Arial, sans-serif"; g.fillText("Tonight's Pick", 26, 140);
  g.fillStyle = "#fff"; g.fillRect(26, 158, 86, 28); g.fillStyle = "#000"; g.font = "bold 15px Arial"; g.fillText("▶  Play", 40, 178);
  g.fillStyle = "rgba(109,109,110,0.8)"; g.fillRect(122, 158, 110, 28); g.fillStyle = "#fff"; g.fillText("ⓘ  More Info", 132, 178);
  const tiles = ["#8c3b2e", "#2e5b8c", "#6b8c2e", "#8c6b2e", "#5b2e8c", "#2e8c7a", "#8c2e5b"];
  g.font = "bold 14px Arial"; g.fillStyle = "#e5e5e5"; g.fillText("Trending Now", 26, 222);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) {
    g.fillStyle = tiles[(i + r * 3) % tiles.length]; g.fillRect(26 + i * 102, 232 + r * 64, 94, 54);
  }
  tvTexture = new THREE.CanvasTexture(cv); tvTexture.colorSpace = THREE.SRGBColorSpace;
  return tvTexture;
}
function makeTv(u, box) {
  const s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const thin = s.x < s.z ? "x" : "z", wide = thin === "x" ? "z" : "x";
  const face = Math.sign(u.center[thin] - c[thin]) || 1; // the screen faces into the room
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(s[wide] * 0.95, s.y * 0.9),
    new THREE.MeshBasicMaterial({ map: streamingTexture(), toneMapped: false, fog: false }));
  screen.position.copy(c); screen.position[thin] += face * (s[thin] / 2 + 0.006);
  screen.rotation.y = thin === "x" ? face * Math.PI / 2 : face > 0 ? 0 : Math.PI;
  screen.visible = false;
  iso.patch(screen.material); // cut away with the wall it hangs on
  const hit = new THREE.Mesh(new THREE.BoxGeometry(s.x + 0.04, s.y + 0.04, s.z + 0.04), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.copy(c);
  clipped.add(screen, hit);
  const tv = { screen, hit, on: false };
  hit.userData.tv = screen.userData.tv = tv;
  return tv;
}
function setRoomView(u, sp) {
  const inner = new THREE.Box3(), outer = new THREE.Box3(), p = new THREE.Vector3();
  const polys = sp ? sp.walk : [planToWorld(u.outline)];
  polys.forEach((poly, i) => { for (const [x, z] of poly) { p.set(x, 0, z); outer.expandByPoint(p); if (i < (u.bath ? 2 : 1)) inner.expandByPoint(p); } });
  const tv = u.kind === "space" ? null : tvOf(u);
  roomView = { u, sp, inner, outer, floorY: levelY[u.level], tv };
  setCeilings(false);
  roomStyle?.enter(u, tv);
  const capHex = roomStyle?.capColor(u); // style rooms: light wall caps (#e3dcd2), like the reference's section cut
  if (capHex) cap.material.color.set(capHex);
  iso.uniforms.uIsoCutY.value = levelY[u.level] + 0.05; // the walls in front go down to just above the floor
  updateRoomCut();
}
function clearRoomView() {
  if (!roomView) return;
  if (roomView.tv) { roomView.tv.on = false; roomView.tv.screen.visible = false; }
  roomView = null;
  roomStyle?.leave(); cap.material.color.set(0x5d564f);
  iso.uniforms.uIsoCutA.value.set(0, 0, 0, 0); iso.uniforms.uIsoCutB.value.set(0, 0, 0, 0); iso.uniforms.uIsoCutY.value = 1e6;
  setCeilings(true);
  spaces.closeAll();
  invalidate(100);
}
// The walls between the camera and the room (and whatever hangs on them) are cut away: a strip along each side of
// the room the camera is beyond, from 0.3 m inside the room to past the wall (or the balcony railing).
function updateRoomCut() {
  const { inner, outer } = roomView, c = camera.position, m = 0.4, inset = 0.3;
  const A = iso.uniforms.uIsoCutA.value.set(0, 0, 0, 0), B = iso.uniforms.uIsoCutB.value.set(0, 0, 0, 0);
  if (c.x > inner.max.x) A.set(inner.max.x - inset, outer.min.z - m, outer.max.x + m, outer.max.z + m);
  else if (c.x < inner.min.x) A.set(outer.min.x - m, outer.min.z - m, inner.min.x + inset, outer.max.z + m);
  if (c.z > inner.max.z) B.set(outer.min.x - m, inner.max.z - inset, outer.max.x + m, outer.max.z + m);
  else if (c.z < inner.min.z) B.set(outer.min.x - m, outer.min.z - m, outer.max.x + m, inner.min.z + inset);
}
// What can be clicked in the room view: the room's doors and its TV
const roomRay = new THREE.Raycaster();
function roomPick(e) {
  if (!roomView || state.walking || state.inside) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  roomRay.setFromCamera(ndc, camera);
  const list = [];
  for (const d of roomView.sp?.doors ?? []) d.pivot.traverse((m) => { if (m.isMesh) { m.userData.door = d; list.push(m); } });
  if (roomView.tv) list.push(roomView.tv.hit);
  return roomRay.intersectObjects(list, false).find((h) => h.point.y < clipPlane.constant) ?? null;
}
function roomClick(e) {
  if (roomStyle?.active && !state.walking && !state.inside) return roomStyle.click(e, clipPlane.constant); // style rooms: their own toggles
  const h = roomPick(e);
  if (!h) return false;
  const tv = h.object.userData.tv;
  if (tv) { tv.on = !tv.on; tv.screen.visible = tv.on; }
  else spaces.toggle(h.object.userData.door, roomView.u.center);
  invalidate(800);
  return true;
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
  $("insidePano").classList.toggle("hidden", !(state.inside && panoOf(state.inside)?.pano));
  $("insideExit").textContent = t("exitRoom");
  if (state.inside) $("insideTitle").textContent = state.inside.kind === "space" ? L(state.inside.space.label)
    : `${state.inside.label} · ${L(CONFIG.types[state.inside.type]?.label) ?? ""}`;
  ui.dayNight.textContent = t("time_" + (env.current ?? "day"));
  ui.dayNight.style.display = state.floor === null && !state.walking ? "" : "none"; // floor / room views have plain light
  $("walkBtn").textContent = t("walk");
  massing?.setLang(lang);
  $("walkExit").textContent = t("exitWalk");
  $("walkHint").textContent = matchMedia("(pointer: fine)").matches ? t("walkHintMouse") : t("walkHintTouch");
  $("insideWalk").textContent = t("walkHere");
  $("walkFloors").innerHTML = `<div class="menu-title">${t("goTo")}</div>` + CONFIG.floors.slice().sort((a, b) => b.level - a.level) // top floor first
    .map((f) => `<button class="chip${state.walkLevel === f.level ? " on" : ""}" data-l="${f.level}">${L(f.label)}</button>`).join("") +
    `<button class="chip" data-close>${t("close")}</button>`;
  // Walk is offered in the floor view (start at the stairs) and on a room's card (start at its entrance)
  $("walkBtn").style.display = state.floor !== null && !state.unit && !state.walking ? "" : "none";
  ui.langBtn.textContent = t("lang");
  $("galleryBtn").textContent = "▦ " + t("renders");
  $("galleryBtn").style.display = RENDERS.length ? "" : "none";
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
    ${isVilla(u) ? "" : `<button class="btn primary" id="stepBtn">${t("walk")}</button>`}
    <button class="btn" id="enterBtn" style="border:1px solid var(--panel-border)">${t("photos")}</button>
    ${u.space.pano ? `<button class="btn" id="panoBtn" style="border:1px solid var(--panel-border)">${t("pano360")}</button>` : ""}`;
  ui.card.classList.remove("hidden");
  ui.card.querySelector(".close").onclick = () => selectFloor(u.level);
  const sb = ui.card.querySelector("#stepBtn");
  if (sb) sb.onclick = () => startWalk(stairStartAt(u.level)); // communal area: start at the stairs
  ui.card.querySelector("#enterBtn").onclick = () => openPhotosFor(u);
  const pb = ui.card.querySelector("#panoBtn");
  if (pb) pb.onclick = () => openPano(u);
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
    <button class="btn primary" id="stepBtn">${t("walk")}</button>
    <button class="btn" id="enterBtn" style="border:1px solid var(--panel-border)">${t("roomPhotos")}</button>
    ${type?.pano ? `<button class="btn" id="panoBtn" style="border:1px solid var(--panel-border)">${t("pano360")}</button>` : ""}
    ${canAsk ? `<a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(t("wa", u.label))}">${t("ask")}</a>` : ""}`;
  ui.card.classList.remove("hidden");
  ui.card.querySelector(".close").onclick = () => selectFloor(u.level); // back to the whole floor
  ui.card.querySelector("#stepBtn").onclick = () => startWalk(spaces.entranceStart(u)); // start at the room's entrance
  ui.card.querySelector("#enterBtn").onclick = () => openRoomPhotos(u);
  const pb = ui.card.querySelector("#panoBtn");
  if (pb) pb.onclick = () => openPano(u);
}
function hideCard() { ui.card.classList.add("hidden"); }

ui.overviewBtn.onclick = () => selectFloor(null);
ui.langBtn.onclick = () => { lang = lang === "en" ? "id" : "en"; try { localStorage.setItem("stin-lang", lang); } catch {} renderUI(); };
ui.dayNight.onclick = () => setTime(env.current === "night" ? "day" : "night"); // golden hour was removed: day <-> night
$("walkBtn").onclick = () => state.floor !== null && startWalk(stairStartAt(state.floor)); // floor view: start at the stairs
// (the "Map" and "Massing" buttons were removed at the client's request, 2026-11-26: the site plan and the massing are
// always shown; the Google 3D map code stays in js/map.js, unused while mapWanted stays false)
$("walkExit").onclick = () => exitWalk();
// floor menu: go to that floor's corridor (Level 1: the communal area), standing in front of the stairs
$("walkFloors").onclick = (e) => {
  if (e.target.dataset.close !== undefined) { closeFloorMenu(); return; }
  if (!e.target.dataset.l) return;
  const l = +e.target.dataset.l;
  closeFloorMenu();
  if (l !== spaces.state.current?.level || spaces.state.current?.kind === "unit") startWalk(stairStartAt(l));
};
$("insideWalk").onclick = () => state.inside && startWalk(spaces.entranceStart(state.inside));
$("walkRoom").onclick = () => { const s = spaces.state.current; if (s?.kind === "unit") exitWalk(); };
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
  accents?.setGlow(tm.glow ?? 0); // (round 22) plinth / shelf LEDs: pale by day, warm at golden hour and night
  for (const m of allMaterials()) if (m.userData.glass) { m.emissive?.setHex(0xffb066); m.emissiveIntensity = tm.glow * 0.12; }
  roomGlowMat.color.setHex(0xffc58a).multiplyScalar(tm.roomGlow ?? 0.5);
  grade.set(tm.grade);
  window.applyLightmaps?.(name); // ?model=glb: the baked light for this time of day
  invalidate(300);
  windowLight.setTime(tm);
  units.forEach(styleUnit);
  if (isoK > 0) { savedSky = { bg: scene.background, intensity: scene.backgroundIntensity, fog: scene.fog?.density ?? 0 }; setIsoK(isoK); } // stay white
  else refreshShadows();
  renderUI();
}

// ---------- walk mode ----------
// Walking room by room: only the space you are in is drawn (on white, plain light). Rooms are entered and left through
// their entrance door (click it), the stairs / lift (click) offer the other floors. See spaces.js.
// in front of the stairs: on solid floor at that level (not over the stairwell) and with the stairs in sight.
// Where the stairs are walled off (Level 1), stand beside the enclosure and face into the room instead of the wall.
const stairStartAt = (l) => {
  const s = stairStartRaw(l);
  if (!s) return s;
  const eye = new THREE.Vector3(s.x, levelY[l] + 1.5, s.z), fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
  const hit = walker.raycastAll(new THREE.Ray(eye, fwd)).find((q) => q.distance > 0.05);
  if (hit && hit.distance < 1.6) { // nose to a wall (e.g. the stair enclosure): turn to the most open direction
    // "open" = walkable floor of this space ahead (to the first wall), over a +-15 deg fan: glass doors and windows
    // let rays through, so a bare ray length would pick a corner by the glazing (round 19)
    const open = (yaw) => {
      const d = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const h = walker.raycastAll(new THREE.Ray(eye, d)).find((q) => q.distance > 0.05), lim = Math.min(h ? h.distance : 14, 14);
      let m = 0;
      for (let t = 0.3; t < lim; t += 0.3, m += 0.3) if (spaces.spaceAt(s.x + d.x * t, s.z + d.z * t, l) !== s.space) break;
      return m;
    };
    let best = s.yaw, far = -1;
    for (let a = 0; a < 24; a++) {
      const yaw = s.yaw + (a / 24) * Math.PI * 2, f = open(yaw - 0.26) + 2 * open(yaw) + open(yaw + 0.26);
      if (f > far) { far = f; best = yaw; }
    }
    s.yaw = best;
  }
  return s;
};
const stairStartRaw = (l) => spaces.stairStart(l, (x, z, cx, cz, strict) => {
  for (let a = -1; a < 8; a++) { // the spot and 0.6 m around it (the stairwell opening is bigger than the flights)
    const px = a < 0 ? x : x + Math.cos((a / 8) * Math.PI * 2) * 0.6, pz = a < 0 ? z : z + Math.sin((a / 8) * Math.PI * 2) * 0.6;
    const h = walker.floorBelow(new THREE.Vector3(px, levelY[l] + 1, pz));
    if (!h || Math.abs(h.y - levelY[l]) > 0.35) return false;
  }
  const eye = new THREE.Vector3(x, levelY[l] + 1.5, z), to = new THREE.Vector3(cx, levelY[l] + 1.5, cz);
  const dist = eye.distanceTo(to), hit = walker.raycastAll(new THREE.Ray(eye, to.sub(eye).normalize())).find((q) => q.distance > 0.05);
  return strict ? !!hit && spaces.isStairs(hit.point) && hit.distance > 1.2 : !hit || spaces.isStairs(hit.point) || hit.distance > dist - 1.2;
});
const isVilla = (u) => u.kind === "space" && /villa/i.test(u.space?.gallery ?? "");
function applyWalkView() {
  const s = spaces.state.current; if (!s) return;
  // the stairwell also shows the flight down (to the floor below), not a white hole at the top of the stairs
  iso.setMask(spaces.maskPolys(), 0.25, levelY[s.level] - FLOOR_DEPTH, spaces.maskSub(), s.kind === "lobby" ? spaces.stairWell() : [], levelY[s.level] - 4.2);
  invalidate(200);
}
spaces.state.onChange = () => { applyWalkView(); updateRail(); };
walker.setAllow((x, z) => !state.walking || spaces.allowed(x, z));
// Walking field of view: 70 deg vertical on a landscape screen. On a portrait phone that leaves only ~35 deg across
// (like looking through a slot), so there it opens up to keep ~50 deg across, at most 90 deg vertical.
const walkFov = () => camera.aspect >= 1 ? 70 : Math.min(90, Math.max(70, (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(25)) / camera.aspect) * 180) / Math.PI));
function startWalk(start) {
  if (!start) return;
  if (state.inside) leaveInside();
  hideCard(); lb.open && closeGallery(); closeFloorMenu();
  clearRoomView();
  const lvl = start.space.level;
  state.walking = true; state.walkLevel = lvl; state.unit = null; state.floor = lvl;
  spaces.closeAll();
  spaces.setCurrent(start.space);
  isoAnim = null; setIsoK(1);
  // the floor you walk on, up to just under the next one (no section caps: you are inside)
  setCut(levelY[lvl] + 3.7, false);
  showBand(levelY[lvl] - 0.5, levelY[lvl] + 4.2);
  for (const m of unitMeshes) m.visible = false;
  for (const b of bands) b.visible = false;
  controls.enabled = false; tween = null;
  camera.fov = walkFov(); camera.updateProjectionMatrix();
  const p = new THREE.Vector3(start.x, levelY[lvl] + 1, start.z);
  // at the stairs: look ~7 deg down, so the first frame shows the flights and the floor rather than the flight overhead
  walker.start(walker.floorBelow(p) ?? p.setY(levelY[lvl]), start.yaw, start.space.kind === "lobby" ? -0.12 : 0);
  document.body.classList.add("walking");
  renderUI();
  invalidate(300);
}
function exitWalk() {
  if (!state.walking) return;
  const s = spaces.state.current;
  walker.stop();
  state.walking = false;
  spaces.closeAll(); spaces.setCurrent(null);
  closeFloorMenu();
  document.body.classList.remove("walking");
  camera.fov = 38; camera.updateProjectionMatrix();
  controls.enabled = true;
  controls.target.copy(camera.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
  camera.up.set(0, 1, 0);
  // back to where you were: the room you were standing in, or the floor
  if (s?.kind === "unit") selectUnit(s.unit);
  else selectFloor(s?.level ?? state.walkLevel ?? 2);
  renderUI();
}
// Floor menu (from the stairs or the lift)
const floorMenu = $("walkFloors");
document.body.appendChild(floorMenu); // a centred pop-up (its old place in the walk bar would offset it)
function openFloorMenu() { floorMenu.classList.add("open"); if (document.pointerLockElement) document.exitPointerLock(); }
function closeFloorMenu() { floorMenu.classList.remove("open"); }
// Click (or tap) while walking: an entrance door opens / closes; the stairs or lift open the floor menu.
const walkRay = new THREE.Raycaster();
function walkClick(e) {
  const r = canvas.getBoundingClientRect();
  if (e) ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); else ndc.set(0, 0);
  walkRay.setFromCamera(ndc, camera);
  const doorHit = walkRay.intersectObjects(spaces.doorMeshes(), false).find((h) => h.distance < 3.5);
  const wallHit = walker.raycastAll(walkRay.ray).find((h) => h.distance > 0.05);
  if (doorHit && (!wallHit || doorHit.distance <= wallHit.distance + 0.05)) { spaces.click(doorHit.object.userData.door, camera.position); invalidate(800); return true; }
  if (wallHit && wallHit.distance < 6 && spaces.isStairs(wallHit.point)) { openFloorMenu(); return true; }
  return false;
}
canvas.addEventListener("click", (e) => { if (state.walking && e.pointerType !== "touch") walkClick(document.pointerLockElement === canvas ? null : e); });
let tapStart = null; // touch: a short tap (not a drag) counts as a click
canvas.addEventListener("pointerdown", (e) => { if (state.walking && e.pointerType === "touch") tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener("pointerup", (e) => {
  if (!state.walking || e.pointerType !== "touch" || !tapStart) return;
  if (performance.now() - tapStart.t < 300 && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 12) walkClick(e);
  tapStart = null;
});
document.addEventListener("pointerlockchange", () => document.body.classList.toggle("locked", document.pointerLockElement === canvas));
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
  } else if (state.floor === null && (hero.classList.contains("gone") || heroLeaving)) {
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
  canvas.style.cursor = hit || (roomView && e.pointerType === "mouse" && roomPick(e)) ? "pointer" : "";
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
// style rooms: hover outline + tooltip with the action ("Open the entry door") over their interactive objects
canvas.addEventListener("pointermove", (e) => {
  if (roomView && roomStyle?.active && e.pointerType === "mouse" && !state.walking && !state.inside) roomStyle.hover(e, clipPlane.constant);
});
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
  if (roomClick(e)) return; // room view: TV on / off, doors open / shut
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
// where a unit's 360° settings live: a room -> its room type, a shared space -> its entry in CONFIG.spaces
function panoOf(u) { return u?.kind === "space" ? u.space : CONFIG.types[u?.type]; }
function openPano(u) {
  if (!pano.renderer) {
    // (M2) the new build has no WebGLRenderer: the 360° viewer uses a second WebGPURenderer (it initialises itself on
    // its first frames)
    pano.renderer = GPU ? new THREE.WebGPURenderer({ canvas: pano.canvas, antialias: true, forceWebGL: FORCE_WEBGL })
      : new THREE.WebGLRenderer({ canvas: pano.canvas, antialias: true });
    if (GPU) pano.renderer.init();
    pano.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  }
  const type = panoOf(u);
  document.getElementById("panoTitle").textContent = u.kind === "space"
    ? `${L(u.space.label)} · ${L(CONFIG.floors.find((f) => f.level === u.level)?.label) ?? ""}`
    : `${u.label} · ${L(type?.label) ?? ""}`;
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
  if (!loaded) setMap(placeholderTexture(document.getElementById("panoTitle").textContent));
  if (src && !loaded) {
    texLoader.load(src, (tex) => {
      if (pano.src !== src) { tex.dispose(); return; } // another room type was opened meanwhile
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = (GPU ? pano.renderer.getMaxAnisotropy() : pano.renderer.capabilities.getMaxAnisotropy()); // sharper near the top/bottom
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
  startWalk(u.kind === "space" ? stairStartAt(u.level) : spaces.entranceStart(u)); // a room: start at its entrance
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
  lm.onLoad = (...a) => { prevL?.(...a); try { iso.patchScene(landscape.group); grade.patchScene(landscape.group); } catch {} invalidate(300); }; // ferns arrive later
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
  if (state.walking) camera.fov = walkFov(); // (a phone turned while walking)
  camera.updateProjectionMatrix();
  pano.renderer?.setSize(w, h, false);
  pano.camera.aspect = w / h;
  pano.camera.updateProjectionMatrix();
  composer?.setPixelRatio(renderer.getPixelRatio());
  composer?.setSize(w, h);
  grade.setResolution(renderer.domElement.width, renderer.domElement.height); // (for the vignette)
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
    // doors: walking through an entrance switches the space; bathroom / balcony doors open as you come close
    if (spaces.update(walker.feet, dt, camera.position)) invalidate(80);
    if ((roomCheck += dt) > 0.3) { // "You're in K.305" chip
      roomCheck = 0;
      const s = spaces.state.current, u = s?.kind === "unit" ? s.unit : null, chip = $("walkRoom");
      chip._unit = u;
      chip.style.display = u ? "" : "none";
      if (u) chip.textContent = `${u.label} · ${t(u.status)} ›`;
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
    if (roomView) { updateRoomCut(); if (spaces.animate(dt)) invalidate(80); if (roomStyle?.tick(dt, !lb.open)) invalidate(80); }
  }
  map.update(now);
  if ((creditT += dt) > 0.5) { // Google credit, shown while the map is visible
    creditT = 0;
    const credit = map.on ? `<b>Google</b>${map.attributions()}` : "";
    if ($("mapCredit").innerHTML !== credit) $("mapCredit").innerHTML = credit;
  }
  if (isoAnim) { // fade to / from the white isolated view
    const k = Math.min(1, (now - isoAnim.s) / isoAnim.d), v = isoAnim.from + (isoAnim.to - isoAnim.from) * ease(k);
    if (k === 1) { const to = isoAnim.to; isoAnim = null; setIsoK(to); } else setIsoK(v);
  }
  // --- should we draw this frame? (see "render on demand") ---
  camera.updateMatrixWorld();
  const moved = !camera.matrixWorld.equals(lastCamM) || !camera.projectionMatrix.equals(lastCamP);
  if (moved) { lastCamM.copy(camera.matrixWorld); lastCamP.copy(camera.projectionMatrix); lastCamMove = now; aoPending = true; }
  const busy = moved || tween || isoAnim || map.on || now < dirtyUntil;
  const aoOK = composer && !map.on && isoK === 0; // no ambient occlusion in the plain isolated views
  const stillLongEnough = now - lastCamMove > 250 && now >= dirtyUntil;
  if (!busy && !(aoOK && aoPending && stillLongEnough)) return; // nothing changed: keep the last picture
  const withAO = aoOK && !busy && stillLongEnough;
  if (withAO) aoPending = false;

  // trees in front of the building step aside (not while walking, where they're part of the scenery)
  landscape.updateOcclusion(camera, buildingBox, !state.walking && !state.inside);
  if (massing?.updateOcclusion(camera, buildingBox)) refreshShadows(); // pad-1 box hidden / shown: its shadow too
  // site in floor views (client, 2026-11-26: "when selecting level 1, show the ground and roads"): the Level 1 view
  // keeps the site plan; other floor / room / walk views drop it once the outside has mostly faded. The massing boxes
  // go in every floor view (the plan cut would slice them open).
  const siteOn = !map.on && (isoK < 0.5 || (state.floor === 1 && !state.walking));
  if (ground.visible !== siteOn) { ground.visible = siteOn; invalidate(100); }
  // the floor views have plain, sunless light on white, in which the site's render colours (olive lawn, dark asphalt)
  // read as a dark slab: blend them to the light site-plan palette, in step with the fade
  if (siteOn && sitePlanMats.length && sitePlanLift !== isoK) {
    sitePlanLift = isoK;
    for (const m of sitePlanMats) {
      m.userData.dayColor ??= m.color.clone();
      const light = SITE_PLAN_LIGHT[m.name.replace("SITE_", "")];
      if (light) m.color.copy(m.userData.dayColor).lerp(light, isoK);
    }
  }
  if (massing && massing.group.visible !== (isoK < 0.5)) { massing.group.visible = isoK < 0.5; invalidate(100); }
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
  } else renderScene();
  for (const u of units) {
    const show = u.mesh.visible;
    u.labelEl.style.display = show ? "" : "none";
    if (!show) continue;
    v.copy(u.center); v.y = u.z + 0.2; v.project(camera);
    u.labelEl.style.left = ((v.x + 1) / 2) * innerWidth + "px";
    u.labelEl.style.top = ((1 - v.y) / 2) * innerHeight + "px";
  }
  massing?.updateLabels(camera, state.floor === null && !lb.open && !state.walking && !state.inside);
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
// every scene material gets the isolation test (except the coloured room volumes / floor bands, which are UI)
// (also not the hidden section-cap counter: it must see whole solids, or a slab cut by the section box reads as
// "inside" and the cap paints over the whole floor; the visible cap plane is isolated, so caps stay in the area)
// The site plan + massing (`ground`) are not isolated either: they're shown / hidden whole (see "site in floor views"
// in frame(): the Level 1 view keeps the ground and roads, other floor views hide them).
// Style rooms (js/roomstyle.js): K.401/405/407/413/416 get their own materials and interactions; created before the
// isolation / grade patches below, so their new materials get both
// (round 22) room accents: contact shadows, plinth and shelf LEDs in every guest room (js/accents.js). They never show
// in the loading render or the building overview, so (round 23) they are built just after start-up - see buildAccents.
// The style rooms' light switch dims their LEDs too; switch states set before then wait in accentRoomK.
const accentRoomK = new Map(Object.keys(STYLE_ROOMS).map((label) => [label, 0.15])); // (their lights start switched off)
let roomStyle = null;
try {
  if (USE_GLB) roomStyle = createRoomStyle({ scene, camera, renderer, objects: levelObjects, spaces, units, levelY, planToWorld, inPoly,
    rootPos: root.position, tooltip: ui.tooltip, invalidate, patch: (m) => { iso.patch(m); grade.patch(m); },
    onLights: (label, e) => { accentRoomK.set(label, 0.15 + 0.85 * e); accents?.setRoom(label, 0.15 + 0.85 * e); },
    borrowLights: (n) => mood.hold(n), releaseLights: (ls) => mood.release(ls), // (round 26: no lights of its own)
    loadTexture: loadKtx }); // (round 28: CC0 linen / boucle / oak / floor, fetched on the first style room opened)
} catch (e) { console.warn("room styles", e); }
async function buildAccents() {
  const a = await createAccents({ root, levelObjects });
  if (!a) return;
  const meshes = levelObjects.filter((o) => o.userData.style_room === "accents");
  for (const m of meshes) { iso.patch(m.material); grade.patch(m.material); }
  for (const [label, k] of accentRoomK) a.setRoom(label, k);
  a.setGlow(env.time?.glow ?? 0); a.setPlain(isoK);
  // compile their 3 shaders off-screen (shown for this synchronous moment only, no frame is drawn in between), then
  // let the current view decide what is visible
  const compiling = [];
  for (const p of compilePasses()) compileFor(p, () => {
    for (const m of meshes) { m.visible = true; compiling.push(renderer.compileAsync(m, camera, scene)); m.visible = false; }
  });
  showBand(band[0], band[1]);
  accents = a;
  await Promise.all(compiling).catch(() => {});
  invalidate(300);
}
const notIsolated = new Set([...unitMeshes, ...bands, roomGlow, capMesh]);
const inGround = (o) => { for (let p = o; p; p = p.parent) if (p === ground) return true; return false; };
iso.patchScene(scene, (o) => notIsolated.has(o) || inGround(o));
grade.patchScene(scene); // and the colour grade, at the end of every material (and the sky)
// the site plan may arrive after this point: give it the grade, then redraw the shadows
// (M4) new renderer: photoreal surface detail (js/materialsTSL.js), before the shaders are compiled
// (opt-in with ?look=1: its noise nodes doubled the start-up shader build, 3.4 -> 6.8 s, for a ~1 % visible change)
const look = GPU && qs.get("look") === "1" ? createLookTSL() : null;
look?.apply(scene);
sitePlanReady.then((s) => { if (!s) return; look?.apply(s); grade.patchScene(s); refreshShadows(); invalidate(300); });
const floorViewObjects = [...unitMeshes, ...bands, cap, capMesh];
const wasVisible = floorViewObjects.map((o) => o.visible);
// (M2) new renderer: building a material's nodes is JavaScript work on the main thread, so before the first frame only
// what the start camera sees is compiled (the whole building from afar: 2.0 s to ready; compiling from the eye-level
// hero camera instead took ~9.5 s); everything else follows in small idle batches (warmUpRest)
if (!GPU) floorViewObjects.forEach((o) => (o.visible = true));
try {
  // (M2) the new renderer draws the scene into the post pass's own target (half float, 4x MSAA, depth + stencil), whose
  // pipelines differ from the screen's: compiling for the screen left every real pipeline to be built synchronously
  // in the first frame (~6 s). Compile for the target actually used.
  post?.prime(); // (M4: every pass's target allocated first, so the compiled pipelines match the real ones)
  sky.update(scene);
  // the start-up view's passes: the scene pass and (AO tiers) its depth pass; the plan-cut pass waits for warmUpRest
  const startPasses = compilePasses().slice(0, post?.quality.ao ? 2 : 1);
  // (M6) new renderer: compiles are frustum-culled, so the intro fly to the eye-level view revealed objects the start
  // camera hadn't framed, and one frame ~1.5 s after the site appeared built all of them at once (a ~3.4 s freeze).
  // Now everything currently shown is sent to compile as well, un-culled for the synchronous moment compileAsync reads
  // the scene. Only the start view's compile is awaited (~3 s); the rest (~11 s of GPU pipeline compiling, off the main
  // thread) carries on while the site is shown. Textures are uploaded here too (they were uploaded on first use, in
  // that same frame).
  const startDone = Promise.all(startPasses.map((p) => compileFor(p, () => renderer.compileAsync(scene, camera))));
  if (GPU) {
    const unculled = [];
    scene.traverse((o) => { if ((o.isMesh || o.isLine) && o.frustumCulled) { o.frustumCulled = false; unculled.push(o); } });
    try { for (const p of startPasses) compileFor(p, () => renderer.compileAsync(scene, camera).then(() => mark("compiledAll")).catch(() => {})); }
    finally { for (const o of unculled) o.frustumCulled = true; }
  }
  await startDone;
  if (GPU) {
    const texs = new Set();
    scene.traverseVisible((o) => { for (const m of [].concat(o.material ?? [])) for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "bumpMap", "lightMap"]) if (m[k]?.isTexture) texs.add(m[k]); });
    for (const t of texs) try { renderer.initTexture(t); } catch {}
    timings.texUploads = texs.size;
  }
  sky.restore(scene);
  mark("compiled");
  renderScene();
} catch (e) { console.warn("shader pre-compile skipped", e); sky.restore(scene); }
floorViewObjects.forEach((o, i) => (o.visible = wasVisible[i]));
// (M2) new renderer: compile every remaining mesh (hidden dressing, interiors, doors, floor-view objects...) a few at a
// time while the browser is idle, each batch shown and un-culled only for the synchronous moment compileAsync reads it
// (no frame is drawn in between), so no first floor click / room visit stalls on building its shaders
function warmUpRest() {
  const all = [];
  scene.traverse((o) => { if ((o.isMesh || o.isLine) && o.material) all.push(o); });
  let i = 0;
  const step = (deadline) => {
    const t0 = performance.now();
    while (i < all.length && (deadline ? deadline.timeRemaining() > 4 : performance.now() - t0 < 12)) {
      const batch = all.slice(i, i + 8); i += 8;
      const keep = batch.map((o) => { const k = []; for (let p = o; p; p = p.parent) k.push([p, p.visible]); return [k, o.frustumCulled]; });
      for (const o of batch) { for (let p = o; p; p = p.parent) p.visible = true; o.frustumCulled = false; }
      // (M3/M4) the exterior passes; the plan-cut pass is primed by one real draw below (its compiles never matched)
      for (const p of compilePasses()) if (!p.stencil || compilePasses().length === 1) compileFor(p, () => {
        for (const o of batch) if (p.stencil || !o.material.stencilWrite) renderer.compileAsync(o, camera, scene).catch(() => {});
      });
      batch.forEach((o, j) => { for (const [p, v] of keep[j][0]) p.visible = v; o.frustumCulled = keep[j][1]; });
    }
    if (i < all.length) schedule(); else { mark("warmUp"); schedule2(primeCutPass); }
  };
  // (M4) The plan-cut chain (stencil target, section caps): neither compileAsync nor a plain render into its target
  // matched what its own pipeline draws, which left ~170-220 pipelines to the first floor click (a ~3 s freeze). One
  // draw through that chain itself, with every mesh shown and un-culled, builds exactly them (measured: first floor
  // click 2 ms). It is followed by a normal frame in the same task: the browser only shows a canvas when the task
  // ends, so this priming frame never reaches the screen.
  function primeCutPass() {
    if (!post || post.chains.length < 2) return;
    const keep = all.map((o) => { const k = []; for (let p = o; p; p = p.parent) k.push([p, p.visible]); return [k, o.frustumCulled]; });
    for (const o of all) { for (let p = o; p; p = p.parent) p.visible = true; o.frustumCulled = false; }
    try { post.render(true); post.render(false); } // (both chains: the exterior one's AO depth pass had the same issue)
    catch (e) { console.warn("cut pass warm-up", e); }
    finally {
      all.forEach((o, j) => { for (const [p, v] of keep[j][0]) p.visible = v; o.frustumCulled = keep[j][1]; });
      renderScene();
      mark("cutPrimed");
    }
  }
  const schedule2 = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 100));
  const schedule = () => (window.requestIdleCallback ? requestIdleCallback(step, { timeout: 500 }) : setTimeout(step, 30));
  schedule();
}
renderer.setRenderTarget(null);
mark("shaders");
setTime("day");
env.onHdriReady((name) => name !== "golden" && setTime(name)); // the sky photo arrived after start-up: switch to it
window.STIN = { THREE, post, tier, look, scene, camera, renderer, walker, env, mood, get accents() { return accents; }, get gtao() { return gtao; }, get composer() { return composer; }, readyAt: performance.now(), timings, levelObjects, landscape, buildingBox, controls,
  iso, spaces, units, levelY, selectFloor, selectUnit, startWalk, exitWalk, renderScene, grade, get isoK() { return isoK; }, get roomView() { return roomView; }, tvOf, get roomStyle() { return roomStyle; }, updateRoomCut: () => roomView && updateRoomCut(), cap, flyToRender, setTime, phone,
  renderCam: (i) => { const r = RENDERS[i], t = overviewView.target.clone(); return [t.clone().add(viewDir(r).multiplyScalar(radius * 1.9 * (r.dist ?? 1))), t]; } };
mark("ready"); // handy for debugging in the browser console
ready = true;
requestAnimationFrame(frame);
leaveHeroWhenReady(); // the loading-screen render fades into the 3D view (and the intro camera move starts)
if (USE_GLB) setTimeout(() => buildAccents().catch((e) => console.warn("room accents", e)), 0); // (round 23: after start-up)
if (GPU) setTimeout(warmUpRest, 600); // (M2: after the intro has started)
// #K405-light: open that style room (in that style) once the intro has faded
{ const hu = roomStyle?.fromHash(); if (hu) setTimeout(() => selectUnit(hu), 3200); }
ui.loading.classList.add("done");
// the building is on screen (with each material's average colour): now fetch the photo textures
setTimeout(startTextureLoading, 50); // (not tied to a drawn frame: a tab opened in the background draws none)
