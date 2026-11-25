// Geometry clean-up of the Revit export (dev tool, not uploaded). Always works from the untouched export:
//   data/geometry.orig.bin + data/model.orig.json  (made automatically on the first run)
// and writes data/geometry.bin + data/model.json. Afterwards run:  node tools/pack-geometry.mjs
//
// What it fixes (see AUDIT.md, Phase 3):
//  1. zero-area triangles                                     -> removed
//  2. exact duplicate triangles (same 3 corners)              -> one copy kept (e.g. Revit stairs exported both as the
//                                                                stair and as its runs/landings)
//  3. coplanar faces of two DIFFERENT-looking surfaces that   -> the surface that should be seen is moved OFFSET mm
//     face the same way and overlap (they flicker: z-fight)      along its face normal (geometric offset, no polygonOffset)
//     Which one is "seen": furniture/joinery/doors/windows > finishes (walls, floors, ceilings) > structure (beams,
//     columns) > site; between equals, a feature finish (timber, tile…) beats plain plaster, then the smaller surface.
//     Surfaces that look identical (e.g. a column flush with a plastered wall, both cream plaster) can't flicker and
//     are left alone.
// The move is applied to every corner of that surface lying on the shared plane, so neighbouring faces stretch with
// it and no cracks open.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const D = (p) => join(root, "data", p);
const OFFSET = 0.005; // 5 mm: above the depth-buffer resolution at overview distances (24-bit depth, ~2–4 mm at 60–80 m)
if (!existsSync(D("geometry.orig.bin"))) copyFileSync(D("geometry.bin"), D("geometry.orig.bin"));
if (!existsSync(D("model.orig.json"))) copyFileSync(D("model.json"), D("model.orig.json"));
const ob = readFileSync(D("geometry.orig.bin"));
const f = new Float32Array(ob.buffer.slice(ob.byteOffset, ob.byteOffset + ob.byteLength)); // writable copy
const model = JSON.parse(readFileSync(D("model.orig.json"), "utf8"));
const groups = model.groups;

// ---- the site's own material presets (same rules as the website), to know which surfaces look the same ----
const src = readFileSync(join(root, "js/materials.js"), "utf8");
const code = src.slice(src.indexOf("const hex = "), src.indexOf("const matCache")).replace("export function presetFor", "function presetFor");
class Color { constructor(r, g, b) { Object.assign(this, g === undefined ? { hex: r } : { r: +r.toFixed(4), g: +g.toFixed(4), b: +b.toFixed(4) }); } convertSRGBToLinear() { return this; } }
const presetFor = new Function("THREE", code + "; return presetFor;")({ Color });
const lookOf = groups.map((g) => presetFor(g.material, model.materials[g.material] ?? {}));
const lookKey = lookOf.map((p) => JSON.stringify(p));
const RANK = { Furniture: 3, Casework: 3, Doors: 3, Windows: 3, "Specialty Equipment": 3, "Plumbing Fixtures": 3, "Lighting Fixtures": 3,
  "Communication Devices": 3, Railings: 3, "Curtain Wall Mullions": 3, "Curtain Panels": 3, "Generic Models": 3,
  "Structural Framing": 1, "Structural Columns": 1, Columns: 1, Toposolid: 0, Hardscape: 0 };
const rank = (gi) => RANK[groups[gi].category] ?? 2;

// ---- triangles ----
const P = (i) => [f[i], f[i + 1], f[i + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const tris = [], drop = new Set(), groupArea = new Float64Array(groups.length);
let degenerate = 0;
groups.forEach((g, gi) => {
  for (let t = 0; t < g.count; t += 9) {
    const i = g.offset + t, a = P(i), n = cross(sub(P(i + 3), a), sub(P(i + 6), a)), len = Math.hypot(...n);
    if (len < 1e-8) { drop.add(i); degenerate++; continue; }
    const nn = n.map((v) => v / len);
    tris.push({ g: gi, i, n: nn, d: nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2] });
    groupArea[gi] += len / 2;
  }
});
// winner between two groups (the one that stays visible)
function winner(a, b) {
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b;
  const pa = lookOf[a].kind === "plaster", pb = lookOf[b].kind === "plaster";
  if (pa !== pb) return pa ? b : a;
  return groupArea[a] <= groupArea[b] ? a : b;
}

// ---- 2. exact duplicates ----
const dupKey = (i) => [P(i), P(i + 3), P(i + 6)].map((p) => p.map((v) => Math.round(v * 1e4)).join(",")).sort().join("|");
const first = new Map(), log = { duplicates: {}, offsets: [] };
for (const t of tris) {
  const k = dupKey(t.i), o = first.get(k);
  if (!o) { first.set(k, t); continue; }
  let lose;
  if (o.g === t.g) lose = t;
  else if (lookKey[o.g] === lookKey[t.g]) { // identical look: drop the stair-assembly copy, otherwise the later one
    const stairs = (x) => groups[x.g].category === "Stairs";
    lose = stairs(o) && !stairs(t) ? o : t;
  } else lose = winner(o.g, t.g) === o.g ? t : o;
  drop.add(lose.i);
  if (lose === o) first.set(k, t);
  const keep = lose === o ? t : o;
  const name = `${groups[lose.g].category}: ${groups[lose.g].material} L${groups[lose.g].level}` + (keep.g === lose.g ? " (same element twice)" : ` (copy of ${groups[keep.g].category}: ${groups[keep.g].material})`);
  log.duplicates[name] = (log.duplicates[name] ?? 0) + 1;
}
const live = tris.filter((t) => !drop.has(t.i));

// ---- 3. coplanar same-facing overlaps between different looks ----
// Faces are grouped into true planes (same facing, within 1.5 mm). In each plane the surfaces that overlap a
// different-looking surface are ordered (the one that should be seen last) and stepped forward along the normal:
// the bottom one stays, the next moves ~5 mm, a third layer more (beam < tile floor < built-in joinery), never >10 mm.
// The step is chosen so the moved face doesn't land on another surface that already sits there (e.g. a tile layer
// 5 mm above the slab): candidates 5, 3, 7, 2, 8… mm are tried. The whole check repeats on the result (max 8 passes).
const NK = (n) => n.map((v) => Math.round(v * 200)).join(",");
const planeOf = (t) => { const a = P(t.i), n = cross(sub(P(t.i + 3), a), sub(P(t.i + 6), a)), l = Math.hypot(...n); t.n = n.map((v) => v / l); t.d = t.n[0] * a[0] + t.n[1] * a[1] + t.n[2] * a[2]; };
function buildClusters() {
  const byNormal = new Map();
  for (const t of live) { const k = NK(t.n); (byNormal.get(k) ?? byNormal.set(k, []).get(k)).push(t); }
  const out = new Map(); // normal key -> clusters [{ d, tris }]
  for (const [k, list] of byNormal) {
    list.sort((a, b) => a.d - b.d);
    const cl = []; let cur = [list[0]];
    for (let i = 1; i < list.length; i++) { if (list[i].d - list[i - 1].d > 0.0015) { cl.push(cur); cur = []; } cur.push(list[i]); }
    cl.push(cur);
    out.set(k, cl.map((tris) => ({ d: tris[tris.length >> 1].d, tris, k })));
  }
  return out;
}
const below = (a, b) => // true when a should be underneath b (b is the visible one)
  rank(a) !== rank(b) ? rank(a) < rank(b) : (lookOf[a].kind === "plaster") !== (lookOf[b].kind === "plaster") ? lookOf[a].kind === "plaster" : groupArea[a] > groupArea[b];
function basis(n) { const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = cross(n, a), l = Math.hypot(...u), uu = u.map((v) => v / l); return [uu, cross(n, uu)]; }
const proj = (p, [u, v]) => [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]];
const area2 = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]; s += x0 * y1 - x1 * y0; } return s / 2; };
const ccw = (poly) => (area2(poly) < 0 ? poly.slice().reverse() : poly);
function clip(s, c) {
  let out = s;
  for (let i = 0; i < c.length && out.length; i++) {
    const A = c[i], B = c[(i + 1) % c.length], inp = out; out = [];
    const side = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const k = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
    }
  }
  return out;
}
const projTri = (t, B) => { const pts = ccw([P(t.i), P(t.i + 3), P(t.i + 6)].map((p) => proj(p, B))); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { t, pts, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }; };
const bbHit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const orig = f.slice(); // corners before any offset (to measure how far each one moved)
const unresolved = [];
let movedCorners = 0, pass = 0, extraCorners = 0;
// corner lookup by position (0.05 mm), rebuilt every pass, for keeping multi-material elements closed
const posKey = (i) => Math.round(f[i] * 2e4) + "," + Math.round(f[i + 1] * 2e4) + "," + Math.round(f[i + 2] * 2e4);
const groupStarts = groups.map((g, gi) => [g.offset, g.offset + g.count, gi]).sort((a, b) => a[0] - b[0]);
const groupOfCorner = (i) => { let lo = 0, hi = groupStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (groupStarts[mid][0] <= i) lo = mid; else hi = mid - 1; } return groupStarts[lo][2]; };
const triNormal = (t) => { const a = P(t), n = cross(sub(P(t + 3), a), sub(P(t + 6), a)), l = Math.hypot(...n) || 1; return n.map((v) => v / l); };
let cornersAt = new Map();
for (; pass < 8; pass++) {
  if (pass) live.forEach(planeOf);
  cornersAt = new Map();
  for (const t of live) for (let k = 0; k < 9; k += 3) { const key = posKey(t.i + k); (cornersAt.get(key) ?? cornersAt.set(key, []).get(key)).push(t.i + k); }
  unresolved.length = 0; // only what the last pass couldn't fix counts
  const all = buildClusters();
  const batch = [];
  for (const [k, list] of all) {
    const B = basis(list[0].tris[0].n);
    const projCache = new Map();
    const projected = (c) => projCache.get(c) ?? projCache.set(c, c.tris.map((t) => projTri(t, B))).get(c);
    for (const cl of list) {
      if (cl.tris.length < 2 || new Set(cl.tris.map((t) => lookKey[t.g])).size < 2) continue;
      const P2 = projected(cl).slice().sort((a, b) => a.bb[0] - b.bb[0]); // sweep along x
      const conflict = new Map(); // "a|b" -> area
      for (let a = 0; a < P2.length; a++) for (let b = a + 1; b < P2.length && P2[b].bb[0] < P2[a].bb[2]; b++) {
        const A = P2[a], Bt = P2[b];
        if (A.t.g === Bt.t.g || lookKey[A.t.g] === lookKey[Bt.t.g] || !bbHit(A.bb, Bt.bb)) continue;
        const ov = Math.abs(area2(clip(A.pts, Bt.pts)));
        if (ov < 1e-4) continue;
        const key = Math.min(A.t.g, Bt.t.g) + "|" + Math.max(A.t.g, Bt.t.g);
        conflict.set(key, (conflict.get(key) ?? 0) + ov);
      }
      if (!conflict.size) continue;
      const has = (g, h) => conflict.has(Math.min(g, h) + "|" + Math.max(g, h));
      const parts = [...new Set([...conflict.keys()].flatMap((x) => x.split("|").map(Number)))];
      parts.sort((a, b) => (below(a, b) ? -1 : below(b, a) ? 1 : 0));
      const chosen = new Map(); // group -> offset in mm (0 = stays)
      for (const g of parts) {
        const lower = parts.filter((h) => chosen.has(h) && has(g, h));
        if (!lower.length) { chosen.set(g, 0); continue; }
        const min = Math.max(...lower.map((h) => chosen.get(h))) + 2;
        const own = P2.filter((p) => p.t.g === g), ds = own.map((p) => p.t.d).sort((a, b) => a - b), d = ds[ds.length >> 1];
        const bb = own.reduce((a, p) => [Math.min(a[0], p.bb[0]), Math.min(a[1], p.bb[1]), Math.max(a[2], p.bb[2]), Math.max(a[3], p.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]);
        const nrm = own[0].t.n;
        // corners of this surface on this plane, and how far they have already been moved
        const idx = [];
        for (let i = groups[g].offset; i < groups[g].offset + groups[g].count; i += 3)
          if (Math.abs(nrm[0] * f[i] + nrm[1] * f[i + 1] + nrm[2] * f[i + 2] - d) <= 0.0016) idx.push(i);
        // how far these corners already moved along this normal (earlier passes)
        const already = idx.reduce((a, i) => Math.max(a, 1000 * ((f[i] - orig[i]) * nrm[0] + (f[i + 1] - orig[i + 1]) * nrm[1] + (f[i + 2] - orig[i + 2]) * nrm[2])), 0);
        const lands = (off) => list.some((c2) => Math.abs(c2.d - (d + off / 1000)) < 0.0015 &&
          projected(c2).some((p) => p.t.g !== g && lookKey[p.t.g] !== lookKey[g] && bbHit(p.bb, bb)));
        const off = [5, 3, 7, 2, 8, 4, 6, 9, 10].find((o) => o >= min && already + o <= 10.01 && !lands(o));
        if (off === undefined) {
          const why = min > 10 ? "needs > 10 mm" : already + min > 10.01 ? "already moved 10 mm" : "every 2–10 mm step lands on another surface";
          unresolved.push({ surface: `${groups[g].category}: ${groups[g].material} L${groups[g].level}`, at: P(own[0].t.i).map((v) => +v.toFixed(2)), why,
            area_m2: +lower.reduce((s, h) => s + conflict.get(Math.min(g, h) + "|" + Math.max(g, h)), 0).toFixed(3) });
          chosen.set(g, 0); continue;
        }
        chosen.set(g, off);
        const over = lower.map((h) => `${groups[h].category}: ${groups[h].material}`);
        // One Revit element can be split over two groups (two materials, e.g. plaster face + concrete edge). The edge
        // faces of the OTHER material that meet the moved face at the same corner are stretched with it, so the
        // element stays closed (no hairline gap / light leak). Faces lying in the plane itself, and the surfaces this
        // one is being separated from, are not touched.
        const losers = new Set(lower);
        for (const i of idx.slice()) {
          for (const j of cornersAt.get(posKey(i)) ?? []) {
            const gj = groupOfCorner(j);
            if (gj === g || losers.has(gj) || drop.has(j - (j % 9))) continue;
            const tn = triNormal(j - (j % 9));
            if (Math.abs(tn[0] * nrm[0] + tn[1] * nrm[1] + tn[2] * nrm[2]) > 0.9) continue;
            idx.push(j); extraCorners++;
          }
        }
        batch.push({ g, nrm, off, idx, over, area: lower.reduce((s, h) => s + conflict.get(Math.min(g, h) + "|" + Math.max(g, h)), 0), at: P(own[0].t.i) });
      }
    }
  }
  if (!batch.length) break;
  // A corner moves at most once per line of direction per pass. Opposite normals share the key: zero-thickness panels
  // (both faces on one plane) would otherwise be pushed out along one face's normal and straight back along the other's.
  const applied = new Set();
  const lineKey = (n) => { const s = Math.sign(n.find((v) => Math.abs(v) > 1e-3)); return NK(n.map((v) => v * s)); };
  for (const m of batch) { // corners were collected before anything moved in this pass
    const off = m.off / 1000, nk = lineKey(m.nrm);
    let n = 0;
    for (const i of m.idx) {
      if (applied.has(i + "|" + nk)) continue;
      applied.add(i + "|" + nk); n++;
      f[i] += m.nrm[0] * off; f[i + 1] += m.nrm[1] * off; f[i + 2] += m.nrm[2] * off;
    }
    m.idx.length = n;
    movedCorners += n;
    const g = groups[m.g];
    log.offsets.push({ pass: pass + 1, surface: `${g.category}: ${g.material} L${g.level}`, offset_mm: m.off, over: m.over,
      area_m2: +m.area.toFixed(3), normal: m.nrm.map((v) => +v.toFixed(2)), at: m.at.map((v) => +v.toFixed(2)), corners: m.idx.length });
  }
}
log.unresolved = unresolved.sort((a, b) => b.area_m2 - a.area_m2);
// largest displacement of any corner (vector length) and largest along a single axis
let maxMove = 0, maxAxis = 0;
for (let i = 0; i < f.length; i += 3) {
  const dx = f[i] - orig[i], dy = f[i + 1] - orig[i + 1], dz = f[i + 2] - orig[i + 2];
  maxMove = Math.max(maxMove, Math.hypot(dx, dy, dz)); maxAxis = Math.max(maxAxis, Math.abs(dx), Math.abs(dy), Math.abs(dz));
}

// ---- write the compacted buffer (dropped triangles removed; groups and fixture parts get new offsets) ----
const ranges = [...groups.map((g) => ({ o: g, filter: true })), ...(model.fixtures ?? []).flatMap((fx) => fx.parts.map((p) => ({ o: p, filter: false })))]
  .sort((a, b) => a.o.offset - b.o.offset);
const out = new Float32Array(f.length); let w = 0;
for (const r of ranges) {
  const start = w;
  for (let i = r.o.offset; i < r.o.offset + r.o.count; i += 9) {
    if (r.filter && drop.has(i)) continue;
    out.set(f.subarray(i, i + 9), w); w += 9;
  }
  r.o.offset = start; r.o.count = w - start;
}
writeFileSync(D("geometry.bin"), Buffer.from(out.buffer, 0, w * 4));
delete model.quant; // pack-geometry writes the new one
writeFileSync(D("model.json"), JSON.stringify(model));
const removedDup = Object.values(log.duplicates).reduce((a, b) => a + b, 0);
log.summary = { degenerateRemoved: degenerate, duplicatesRemoved: removedDup, passes: pass, surfacesOffset: log.offsets.length, cornersMoved: movedCorners,
  edgeCornersStretched: extraCorners, maxCornerMoveMm: +(maxMove * 1000).toFixed(1), maxAlongOneAxisMm: +(maxAxis * 1000).toFixed(1), unresolved: unresolved.length,
  unresolvedArea_m2: +unresolved.reduce((s, u) => s + u.area_m2, 0).toFixed(2), trianglesBefore: tris.length + degenerate, trianglesAfter: tris.length - removedDup };
log.offsets.sort((a, b) => b.area_m2 - a.area_m2);
writeFileSync(join(root, "tools/out/fix-geometry-log.json"), JSON.stringify(log, null, 1));
console.log(JSON.stringify(log.summary));
console.log("largest offsets:"); for (const o of log.offsets.slice(0, 25)) console.log(`  ${o.area_m2} m²  ${o.surface}  over  ${o.over.join(", ")}  @ ${o.at}`);
console.log("duplicates removed:"); for (const [k, v] of Object.entries(log.duplicates).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${v}  ${k}`);
