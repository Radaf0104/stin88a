// proctex.js - small procedural texture set, drawn on plain 2D canvases.
//
// Every texture is a near-white / light-grey VALUE map (average brightness about
// 0.85-0.95, gentle variation, neutral hue). The real colour comes from
// material.color, which multiplies the map, so one texture can serve many palette
// colours. All maps tile seamlessly and use a fixed random seed, so they look the
// same on every load. Each one is built lazily on first access.
//
//   planks      timber floor boards, 6 across, staggered butt joints, flowing grain (tile 1.2 m)
//   plankBump   matching bump map: dark thin joints, faint grain
//   veneer      fine vertical wood-veneer grain, gentle waviness (tile 0.6 m)
//   veneerH     the same veneer with horizontal grain (tile 0.8 m)
//   plaster     limewash wall: big soft blotches plus fine grain, very low contrast (tile 1.4 m)
//   porcelain   plain porcelain tile with a thin light-grey grout line and faint mottling (tile 0.8 m)
//   stone       grey stone porcelain slab, cloudy veins, grout border (tile 0.6 x 1.2 m)
//   travertine  horizontally banded travertine with small pores (tile 0.6 x 1.2 m)
//   fabric      fine linen weave (tile 0.10 m)
//   boucle      soft looped-yarn dots (tile 0.08 m)
//   flute       five vertical reeds per tile with soft shading, for fluted oak panels (0.25 m wide)
//   fluteBump   matching bump for the reeds
//
// UVs are in metres, so a tile of S metres uses repeat = 1/S (already set here).
// Use tileRepeat(tex, sx, sy) to get a clone with a different tile size.
//
// makeTextures(renderer).timings holds the build time in ms of each texture built so far.

import * as THREE from "three";

// ---------- helpers ----------

// tiny seeded PRNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

const grey = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// Call fn(dx, dy) for every wrapped copy (0, -w, +w) x (0, -h, +h) whose box
// (x0,y0)-(x1,y1) touches the tile, so shapes near an edge reappear on the far side.
function wrapped(w, h, x0, y0, x1, y1, fn) {
  for (const dy of [0, -h, h]) {
    if (y1 + dy < 0 || y0 + dy > h) continue;
    for (const dx of [0, -w, w]) {
      if (x1 + dx < 0 || x0 + dx > w) continue;
      fn(dx, dy);
    }
  }
}

// Tileable fractal value noise, returns Float32Array(w*h) in about 0..1.
// cx, cy = lattice cells in the first octave; each octave doubles them.
function fbm(w, h, cx, cy, octaves, seed) {
  const r = rng(seed);
  const out = new Float32Array(w * h);
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const nx = cx << o, ny = cy << o, amp = 1 / (1 << o);
    total += amp;
    const grid = new Float32Array(nx * ny);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    const xi0 = new Int32Array(w), xi1 = new Int32Array(w), xt = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const f = (x / w) * nx, i = Math.floor(f), t = f - i;
      xi0[x] = i % nx;
      xi1[x] = (i + 1) % nx;
      xt[x] = t * t * (3 - 2 * t);
    }
    for (let y = 0; y < h; y++) {
      const f = (y / h) * ny, j = Math.floor(f), t = f - j, ty = t * t * (3 - 2 * t);
      const r0 = (j % ny) * nx, r1 = ((j + 1) % ny) * nx, row = y * w;
      for (let x = 0; x < w; x++) {
        const a = grid[r0 + xi0[x]], b = grid[r0 + xi1[x]];
        const c = grid[r1 + xi0[x]], d = grid[r1 + xi1[x]];
        const top = a + (b - a) * xt[x], bot = c + (d - c) * xt[x];
        out[row + x] += (top + (bot - top) * ty) * amp;
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// Fill a canvas from a per-pixel function fn(x, y, i) -> grey 0..255.
function paintPixels(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const v = clamp255(fn(x, y, i));
      const k = i * 4;
      d[k] = d[k + 1] = d[k + 2] = v;
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Light-grey grout: 1 px on every edge, so neighbouring tiles make a 2 px line.
function groutEdges(ctx, w, h, v) {
  ctx.fillStyle = grey(v);
  ctx.fillRect(0, 0, w, 1);
  ctx.fillRect(0, h - 1, w, 1);
  ctx.fillRect(0, 0, 1, h);
  ctx.fillRect(w - 1, 0, 1, h);
}

// ---------- individual textures ----------

// Board layout shared by colour and bump: 6 columns, two boards per column per tile.
function plankLayout(w, h) {
  const r = rng(1101), cols = 6, cw = w / cols, segs = [];
  for (let i = 0; i < cols; i++) {
    const a = r() * h;
    const b = (a + h * (0.38 + r() * 0.24)) % h;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    segs.push({ x: i * cw, y: lo, len: hi - lo, w: cw });
    segs.push({ x: i * cw, y: hi, len: lo + h - hi, w: cw });
  }
  return segs;
}

function drawPlanks(bump) {
  const w = 1024, h = 1024;
  const [c, ctx] = canvas(w, h);
  const r = rng(bump ? 1103 : 1102);
  const segs = plankLayout(w, h);
  ctx.fillStyle = grey(bump ? 210 : 232);
  ctx.fillRect(0, 0, w, h);
  for (const s of segs) {
    const tone = bump ? 200 + r() * 18 : 228 + r() * 12 - 4; // per-board tone shift
    for (const dy of [0, -h]) {
      const y0 = s.y + dy;
      if (y0 + s.len < 0 || y0 > h) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.x, y0, s.w, s.len);
      ctx.clip();
      ctx.fillStyle = grey(tone);
      ctx.fillRect(s.x, y0, s.w, s.len);
      // flowing grain: long bezier strokes with a lateral drift
      const n = bump ? 10 : 22;
      for (let k = 0; k < n; k++) {
        const gx = s.x + r() * s.w, drift = (r() - 0.5) * s.w * 0.35;
        const ya = y0 - 10, yb = y0 + s.len + 10, hh = yb - ya;
        ctx.beginPath();
        ctx.moveTo(gx, ya);
        ctx.bezierCurveTo(gx + drift, ya + hh * 0.33, gx - drift * 0.8 + (r() - 0.5) * 8, ya + hh * 0.66, gx + (r() - 0.5) * 12, yb);
        const dark = r() < 0.7;
        const v = bump ? (dark ? 120 : 235) : dark ? 120 : 255;
        ctx.strokeStyle = grey(v, (bump ? 0.12 : 0.05) + r() * (bump ? 0.1 : 0.07));
        ctx.lineWidth = 0.6 + r() * (dark ? 1.6 : 2.4);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  // joints: dark thin lines between columns and at butt joints (wrapped)
  const jc = bump ? grey(15, 0.95) : grey(70, 0.6);
  ctx.fillStyle = jc;
  for (let i = 0; i < 6; i++)
    for (const dx of [0, w]) ctx.fillRect((i * w) / 6 - 1 + dx, 0, 2, h);
  for (const s of segs)
    for (const dy of [0, h]) ctx.fillRect(s.x, s.y - 1 + dy, s.w, 2);
  return c;
}

function drawVeneer() {
  const w = 512, h = 512;
  const [c, ctx] = canvas(w, h);
  const r = rng(2201);
  const n = fbm(w, h, 2, 16, 2, 2202);
  paintPixels(ctx, w, h, (x, y, i) => 228 + (n[i] - 0.5) * 22 + (r() - 0.5) * 3);
  const strokes = 150, steps = 18;
  for (let k = 0; k < strokes; k++) {
    const x0 = r() * w, amp = 1 + r() * 4, freq = 1 + ((r() * 3) | 0), ph = r() * 6.283;
    const dark = r() < 0.72;
    ctx.strokeStyle = dark ? grey(110, 0.05 + r() * 0.1) : grey(255, 0.12 + r() * 0.15);
    ctx.lineWidth = 0.5 + r() * (dark ? 1.3 : 2);
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const y = (s / steps) * h;
      pts.push([x0 + amp * Math.sin((y / h) * 6.283 * freq + ph), y]);
    }
    wrapped(w, h, x0 - amp - 3, 0, x0 + amp + 3, h, (dx) => {
      ctx.beginPath();
      pts.forEach((p, j) => (j ? ctx.lineTo(p[0] + dx, p[1]) : ctx.moveTo(p[0] + dx, p[1])));
      ctx.stroke();
    });
  }
  return c;
}

function drawVeneerH(src) {
  const [c, ctx] = canvas(512, 512);
  ctx.translate(256, 256);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, -256, -256);
  return c;
}

function drawPlaster() {
  const w = 512, h = 512;
  const [c, ctx] = canvas(w, h);
  const r = rng(3301);
  const n = fbm(w, h, 3, 3, 3, 3302);
  paintPixels(ctx, w, h, (x, y, i) => 238 + (n[i] - 0.5) * 12 + (r() - 0.5) * 4);
  for (let k = 0; k < 60; k++) {
    const x = r() * w, y = r() * h, rad = 40 + r() * 80;
    const light = r() < 0.5, v = light ? 255 : 150, a = light ? 0.12 : 0.035 + r() * 0.03;
    wrapped(w, h, x - rad, y - rad, x + rad, y + rad, (dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      g.addColorStop(0, grey(v, a));
      g.addColorStop(1, grey(v, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  return c;
}

function drawPorcelain() {
  const w = 512, h = 512;
  const [c, ctx] = canvas(w, h);
  const r = rng(4401);
  const n = fbm(w, h, 4, 4, 2, 4402);
  paintPixels(ctx, w, h, (x, y, i) => 236 + (n[i] - 0.5) * 9 + (r() - 0.5) * 2.5);
  groutEdges(ctx, w, h, 204);
  return c;
}

function drawStone() {
  const w = 512, h = 1024;
  const [c, ctx] = canvas(w, h);
  const r = rng(5501);
  const cloud = fbm(w, h, 3, 6, 3, 5502);
  const vein = fbm(w, h, 2, 3, 3, 5503); // lattice stretched in y -> long, streaky veins
  paintPixels(ctx, w, h, (x, y, i) => {
    let v = 1 - Math.abs((vein[i] + (cloud[i] - 0.5) * 0.5) * 2 - 1);
    v *= v; v *= v; v *= v; v *= v; // sharpen to thin lines
    return 228 + (cloud[i] - 0.5) * 18 - v * 20 + (r() - 0.5) * 3;
  });
  groutEdges(ctx, w, h, 200);
  return c;
}

function drawTravertine() {
  const w = 512, h = 1024;
  const [c, ctx] = canvas(w, h);
  const r = rng(6601);
  const bands = fbm(w, h, 2, 22, 3, 6602);
  paintPixels(ctx, w, h, (x, y, i) => {
    const band = Math.sin(((y / h) * 9 + bands[i] * 5) * 6.283) * 0.5;
    return 226 + (bands[i] - 0.5) * 16 + band * 7 + (r() - 0.5) * 3;
  });
  // small elongated pores, wrapped
  for (let k = 0; k < 220; k++) {
    const x = r() * w, y = r() * h, rx = 1.5 + r() * 5, ry = 0.5 + r() * 1.3;
    ctx.fillStyle = grey(120, 0.12 + r() * 0.2);
    wrapped(w, h, x - rx, y - ry, x + rx, y + ry, (dx, dy) => {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, 6.283);
      ctx.fill();
    });
  }
  return c;
}

function drawFabric() {
  const w = 256, h = 256, period = 8, count = w / period;
  const [c, ctx] = canvas(w, h);
  const r = rng(7701);
  const warp = [], weft = [];
  for (let i = 0; i < count; i++) {
    warp.push((r() - 0.5) * 14);
    weft.push((r() - 0.5) * 14);
  }
  const slub = fbm(w, h, 8, 8, 2, 7702);
  paintPixels(ctx, w, h, (x, y) => {
    const cx = (x / period) | 0, cy = (y / period) | 0;
    const px = (x % period) + 0.5, py = (y % period) + 0.5;
    const over = (cx + cy) & 1; // which thread is on top
    const shade = over ? Math.sin((Math.PI * py) / period) : Math.sin((Math.PI * px) / period);
    const tone = over ? weft[cy] : warp[cx];
    return 216 + shade * 22 + tone + (slub[(y * w + x)] - 0.5) * 10 + (r() - 0.5) * 6;
  });
  return c;
}

function drawBoucle() {
  const w = 256, h = 256;
  const [c, ctx] = canvas(w, h);
  const r = rng(8801);
  ctx.fillStyle = grey(226);
  ctx.fillRect(0, 0, w, h);
  // pre-rendered soft dots (cheap to stamp thousands of times)
  const sprite = (v, a) => {
    const [sc, sx] = canvas(16, 16);
    const g = sx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, grey(v, a));
    g.addColorStop(1, grey(v, 0));
    sx.fillStyle = g;
    sx.fillRect(0, 0, 16, 16);
    return sc;
  };
  const lightDot = sprite(255, 0.7), darkDot = sprite(140, 0.4);
  for (let k = 0; k < 2600; k++) {
    const x = r() * w, y = r() * h, rad = 2 + r() * 3.2;
    const img = r() < 0.5 ? lightDot : darkDot;
    ctx.globalAlpha = 0.55 + r() * 0.45;
    wrapped(w, h, x - rad, y - rad, x + rad, y + rad, (dx, dy) =>
      ctx.drawImage(img, x + dx - rad, y + dy - rad, rad * 2, rad * 2));
  }
  ctx.globalAlpha = 1;
  return c;
}

// profile of one reed across u in 0..1: height (0 in the groove, 1 on the crest)
function reedProfile(u) {
  const t = 2 * u - 1;
  return Math.sqrt(Math.max(0, 1 - t * t * t * t));
}

function drawFlute() {
  const w = 256, h = 512, reeds = 5, rw = w / reeds;
  const [c, ctx] = canvas(w, h);
  const r = rng(9901);
  const grain = fbm(w, h, 64, 3, 2, 9902);
  paintPixels(ctx, w, h, (x, y, i) => {
    const u = (x % rw) / rw;
    const t = 2 * u - 1;
    const lit = 0.5 - 0.5 * t * 0.6; // light from the left
    const hgt = reedProfile(u);
    const shade = 0.55 + 0.45 * hgt * (0.6 + 0.4 * lit * 1.6);
    return 200 + shade * 40 + (grain[i] - 0.5) * 10 + (r() - 0.5) * 2;
  });
  return c;
}

function drawFluteBump() {
  const w = 256, h = 64, rw = w / 5;
  const [c, ctx] = canvas(w, h);
  paintPixels(ctx, w, h, (x) => 30 + reedProfile((x % rw) / rw) * 225);
  return c;
}

// ---------- public API ----------

let cache = null;

export function makeTextures(renderer) {
  if (cache && cache.__renderer === renderer) return cache;
  const maxAniso = renderer?.getMaxAnisotropy ? renderer.getMaxAnisotropy() : renderer?.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1; // (M2: the new renderer has getMaxAnisotropy() itself)
  const aniso = Math.min(8, maxAniso);
  const T = {};
  const timings = {};
  const canvases = {};
  Object.defineProperty(T, "__renderer", { value: renderer });
  Object.defineProperty(T, "timings", { value: timings });

  // define a lazy texture: name, canvas builder, tile size in metres, colour (true) or data (false)
  const def = (name, build, sx, sy, color = true) => {
    let tex = null;
    Object.defineProperty(T, name, {
      enumerable: true,
      get() {
        if (!tex) {
          const t0 = performance.now();
          const cv = build();
          tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = aniso;
          tex.repeat.set(1 / sx, 1 / sy);
          canvases[name] = cv;
          timings[name] = performance.now() - t0;
        }
        return tex;
      },
    });
  };

  def("planks", () => drawPlanks(false), 1.2, 1.2);
  def("plankBump", () => drawPlanks(true), 1.2, 1.2, false);
  def("veneer", () => (canvases.veneer = drawVeneer()), 0.6, 0.6);
  def("veneerH", () => drawVeneerH(canvases.veneer || (canvases.veneer = drawVeneer())), 0.8, 0.8);
  def("plaster", drawPlaster, 1.4, 1.4);
  def("porcelain", drawPorcelain, 0.8, 0.8);
  def("stone", drawStone, 0.6, 1.2);
  def("travertine", drawTravertine, 0.6, 1.2);
  def("fabric", drawFabric, 0.1, 0.1);
  def("boucle", drawBoucle, 0.08, 0.08);
  def("flute", drawFlute, 0.25, 0.5);
  def("fluteBump", drawFluteBump, 0.25, 0.5, false);

  cache = T;
  return T;
}

// Clone a texture with a different tile size (metres per tile).
export function tileRepeat(tex, sx, sy = sx) {
  const t = tex.clone();
  t.repeat.set(1 / sx, 1 / sy);
  t.needsUpdate = true;
  return t;
}
