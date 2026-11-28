// Pre-rendered turntables for the building overview and the level views (client, 2026-11-28: "this can be
// implemented, especially during building overview and section overview"): 48 frames rendered offline from our own
// scene (tools/turntable-capture.js, data/tt/), scrubbed by dragging so the building turns smoothly with clean, sharp
// shapes; every frame carries each floor's / room's outline, so hovering lights a whole floor (overview) or a room
// (level view) and a click goes on, as in the live 3D. The room view stays live 3D. Test: ?tt=1.
// Loaded early by index.html: the overview's first frame replaces the landing picture as soon as it is decoded, and
// the live 3D keeps loading underneath; until it is ready, a click waits behind the loading veil.
const FRAMES_AHEAD = 6;
const portrait = () => innerWidth < innerHeight;
let api = null; // set by js/main.js (attach) once the live 3D is ready

const el = document.createElement("div"); el.id = "tt"; el.className = "hidden";
el.innerHTML = `<img id="ttImg" alt="" draggable="false"><svg id="ttSvg" xmlns="http://www.w3.org/2000/svg"></svg><div id="ttHint"></div>`;
const img = el.querySelector("#ttImg"), svg = el.querySelector("#ttSvg"), hint = el.querySelector("#ttHint");
const sets = new Map(); // name -> { meta, imgs[], loaded[] }
let cur = null, frame = 0, hover = null, enabled = true, wantSet = null, dragging = null;

function setName(view, time) { return (view === "overview" ? `overview-${time}` : `level${view}`) + (portrait() ? "-m" : ""); }
// the frame sets rendered so far (tools/turntable-capture.js); other views use the live 3D without asking the server
const AVAILABLE = new Set(["overview-day", "overview-night", "level3"].flatMap((n) => [n, n + "-m"]));
async function loadSet(name) {
  if (!AVAILABLE.has(name)) return null;
  if (sets.has(name)) return sets.get(name);
  const meta = await fetch(`data/tt/${name}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!meta) { sets.set(name, null); return null; }
  const s = { name, meta, imgs: [], loaded: [] };
  sets.set(name, s);
  // (RAM budget) frames are kept as their compressed WebP blobs (~15-90 KB) and only the one on screen is decoded:
  // 48 decoded frames would hold ~180 MB (phone) / ~300 MB (desktop), far over an in-app browser's budget
  const load = (i) => fetch(`data/tt/${name}/${String(i).padStart(2, "0")}.webp`).then((r) => (r.ok ? r.blob() : null)).then((b) => {
    if (!b) return;
    s.imgs[i] = { src: URL.createObjectURL(b) }; s.loaded[i] = true;
    if (cur === s && i === frame) show();
  }).catch(() => {});
  await load(0); // the first frame first, then the rest, nearest the start first, a few at a time
  (async () => {
    const order = []; for (let d = 1; d <= meta.frames / 2; d++) { order.push(d % meta.frames); order.push((meta.frames - d) % meta.frames); }
    const queue = [...new Set(order)];
    const run = async () => { while (queue.length) await load(queue.shift()); };
    await Promise.all(Array.from({ length: FRAMES_AHEAD }, run));
  })();
  return s;
}
// the frame on screen: the nearest decoded one
function show() {
  if (!cur) return;
  const n = cur.meta.frames; let i = frame;
  for (let d = 0; d < n && !cur.loaded[i]; d++) i = d % 2 ? (frame + d + n) % n : (frame - d + n) % n;
  if (!cur.loaded[i]) return;
  if (img.src !== cur.imgs[i].src) img.src = cur.imgs[i].src;
  drawSpots(i);
}
// image "cover" fit: frame coordinates (0..1) -> screen pixels
function fitter() {
  const W = el.clientWidth, H = el.clientHeight, w = cur.meta.w, h = cur.meta.h, s = Math.max(W / w, H / h);
  const ox = (W - w * s) / 2, oy = (H - h * s) / 2;
  return ([x, y]) => [ox + x * w * s, oy + y * h * s];
}
function drawSpots(i) {
  const f = fitter();
  svg.setAttribute("viewBox", `0 0 ${el.clientWidth} ${el.clientHeight}`);
  svg.innerHTML = cur.meta.spots.map((s) => {
    const pts = s.polys[i].map(f).map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
    const cls = ["spot", s.kind, s.status ?? "", hover === s.id ? "on" : ""].join(" ");
    return `<polygon data-id="${s.id}" class="${cls}" points="${pts}"/>`;
  }).join("");
}
const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
function spotAt(e) {
  if (!cur) return null;
  const r = el.getBoundingClientRect(), f = fitter(), x = e.clientX - r.left, y = e.clientY - r.top;
  // where outlines overlap (a floor box seen from above overlaps the floors next to it), the one whose middle is
  // nearest the pointer wins
  let best = null, bd = Infinity;
  for (const s of cur.meta.spots) {
    const p = s.polys[frame].map(f); if (!inPoly(x, y, p)) continue;
    const c = p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]), d = Math.hypot(c[0] - x, c[1] - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function setHover(id) { if (hover === id) return; hover = id; if (cur) drawSpots(frame); }

el.addEventListener("pointerdown", (e) => { dragging = { x: e.clientX, f: frame, moved: false, id: e.pointerId }; el.setPointerCapture(e.pointerId); });
el.addEventListener("pointermove", (e) => {
  if (!cur) return;
  if (dragging) {
    const dx = e.clientX - dragging.x;
    if (Math.abs(dx) > 4) dragging.moved = true;
    // a full drag across the screen turns the building once
    const n = cur.meta.frames, f = Math.round(dragging.f - (dx / el.clientWidth) * n);
    const nf = ((f % n) + n) % n;
    if (nf !== frame) { frame = nf; show(); }
    return;
  }
  const s = spotAt(e);
  setHover(s?.id ?? null);
  api?.tooltip(s, e);
  api?.hoverPanel?.(s);
  el.style.cursor = s ? "pointer" : "grab";
});
el.addEventListener("pointerup", (e) => {
  const d = dragging; dragging = null;
  if (!d || d.moved) return;
  const s = spotAt(e); if (!s) return;
  api?.tooltip(null);
  const go = () => api.pick(s);
  if (api) go(); else waitForApi(go);
});
el.addEventListener("pointerleave", () => { setHover(null); api?.tooltip(null); });
addEventListener("resize", () => { if (cur) { const v = wantSet; wantSet = null; sync(v); } });
function waitForApi(fn) { // the live 3D is still loading: the veil + bar until it is ready, then go on
  window.__progress?.(0.6);
  const t = setInterval(() => { if (api) { clearInterval(t); fn(); } }, 100);
}

// which set the current view shows (null = live 3D)
async function sync(view, time = "day") {
  const name = enabled && view !== null && view !== undefined ? setName(view, time) : null;
  if (name === wantSet) return;
  wantSet = name;
  if (!name) { el.classList.add("hidden"); cur = null; document.body.classList.remove("tt-on"); return; }
  const s = await loadSet(name);
  if (wantSet !== name) return;
  if (!s) { el.classList.add("hidden"); cur = null; document.body.classList.remove("tt-on"); return; } // (no frames for this view: live 3D)
  const keepAngle = cur && cur.meta.frames === s.meta.frames ? frame : 0;
  cur = s; frame = keepAngle; hover = null;
  el.classList.remove("hidden"); document.body.classList.add("tt-on"); show();
  hint.textContent = api?.hintText?.() ?? "Drag to turn · tap a floor";
}

export function boot() {
  document.getElementById("app").insertBefore(el, document.getElementById("labels"));
  window.__tt = { attach, sync, setHover, toggle, get enabled() { return enabled; }, get active() { return !!cur; } };
  // the overview's first frame replaces the landing picture as soon as it is decoded
  sync("overview", "day").then(() => {
    if (!cur) return;
    const hero = document.getElementById("hero");
    if (hero && !hero.classList.contains("fading")) { hero.classList.add("fading"); setTimeout(() => hero.classList.add("gone"), 1900); }
    window.__ttShownAt = Math.round(performance.now());
  });
}
function attach(a) { api = a; }
function toggle(on = !enabled) { enabled = on; const v = wantSet; wantSet = "-"; api?.resync?.(); return enabled; }
