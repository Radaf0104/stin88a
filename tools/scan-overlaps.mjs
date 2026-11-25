// Geometry integrity scan of data/geometry.bin (the Revit export).
// Finds (1) coplanar, same-facing, overlapping triangles from DIFFERENT material groups  -> z-fighting / flicker
//       (2) exact duplicate triangles (same 3 vertices)                                      -> double geometry
//       (3) degenerate triangles (zero area)
// Usage: node tools/scan-overlaps.mjs [--fix]   (--fix nudges the overlapping triangles of the smaller group 2 mm along
//        their normal, writes data/geometry.bin, and you must re-run tools/pack-geometry.mjs afterwards)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = process.argv.includes("--fix");
const NUDGE = 0.002; // metres
const ORIG = process.argv.includes("--orig"); // scan the untouched export instead (data/*.orig.*)
const buf = readFileSync(join(root, ORIG ? "data/geometry.orig.bin" : "data/geometry.bin"));
const f = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const model = JSON.parse(readFileSync(join(root, ORIG ? "data/model.orig.json" : "data/model.json"), "utf8"));
if (ORIG && FIX) throw new Error("--fix works on data/geometry.bin only; use tools/fix-geometry.mjs");
const groups = model.groups;

// ---- collect triangles ----
const tris = []; // {g, i (float index), n:[x,y,z], d, area}
let degenerate = 0;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const P = (i) => [f[i], f[i + 1], f[i + 2]];
groups.forEach((g, gi) => {
  for (let t = 0; t < g.count; t += 9) {
    const i = g.offset + t, a = P(i), b = P(i + 3), c = P(i + 6);
    const n = cross(sub(b, a), sub(c, a)), len = Math.hypot(...n);
    if (len < 1e-8) { degenerate++; continue; }
    const nn = n.map((v) => v / len);
    tris.push({ g: gi, i, n: nn, d: nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2], area: len / 2 });
  }
});

// ---- exact duplicates ----
const dupKey = (i) => [P(i), P(i + 3), P(i + 6)].map((p) => p.map((v) => Math.round(v * 1e4)).join(",")).sort().join("|");
const seenTri = new Map();
const dupes = new Map(); // "gA|gB" -> count
for (const t of tris) {
  const k = dupKey(t.i);
  if (seenTri.has(k)) { const o = seenTri.get(k); const pk = [o.g, t.g].sort((x, y) => x - y).join("|"); dupes.set(pk, (dupes.get(pk) ?? 0) + 1); }
  else seenTri.set(k, t);
}

// ---- coplanar overlaps (same plane within 1.5 mm, same facing) ----
// bucket by quantised normal + plane offset
const bucket = new Map();
const nk = (n) => n.map((v) => Math.round(v * 200)).join(",");
for (const t of tris) {
  const key = nk(t.n) + "@" + Math.round(t.d / 0.003);
  (bucket.get(key) ?? bucket.set(key, []).get(key)).push(t);
}
// 2D projection onto the plane, then convex polygon clipping for the overlap area
function basis(n) {
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = cross(n, a), ul = Math.hypot(...u); const uu = u.map((v) => v / ul);
  return [uu, cross(n, uu)];
}
const proj = (p, [u, v]) => [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]];
function clip(subject, clipPoly) { // Sutherland–Hodgman, both convex, CCW
  let out = subject;
  for (let i = 0; i < clipPoly.length && out.length; i++) {
    const A = clipPoly[i], B = clipPoly[(i + 1) % clipPoly.length], inp = out; out = [];
    const side = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const k = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
    }
  }
  return out;
}
const area2 = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]; s += x0 * y1 - x1 * y0; } return s / 2; };
const ccw = (poly) => (area2(poly) < 0 ? poly.slice().reverse() : poly);

const pairs = new Map(); // "gA|gB" -> {area, trisA:Set, trisB:Set}
for (const [key, list] of bucket) {
  // also compare with the neighbouring offset bucket (plane distance straddling a bucket edge)
  const [nPart, dPart] = key.split("@");
  const other = bucket.get(nPart + "@" + (Number(dPart) + 1)) ?? [];
  const all = list.concat(other);
  if (all.length < 2) continue;
  const B = basis(list[0].n);
  const P2 = all.map((t) => { const pts = ccw([P(t.i), P(t.i + 3), P(t.i + 6)].map((p) => proj(p, B))); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { t, pts, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }; });
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < P2.length; b++) {
    const A = P2[a], Bt = P2[b];
    if (A.t.g === Bt.t.g || Math.abs(A.t.d - Bt.t.d) > 0.0015) continue;
    if (A.bb[2] <= Bt.bb[0] || Bt.bb[2] <= A.bb[0] || A.bb[3] <= Bt.bb[1] || Bt.bb[3] <= A.bb[1]) continue;
    const ov = Math.abs(area2(clip(A.pts, Bt.pts)));
    if (ov < 1e-4) continue;
    const [g1, g2] = A.t.g < Bt.t.g ? [A.t, Bt.t] : [Bt.t, A.t];
    const k = g1.g + "|" + g2.g;
    const e = pairs.get(k) ?? pairs.set(k, { area: 0, ta: new Set(), tb: new Set() }).get(k);
    e.area += ov; e.ta.add(g1.i); e.tb.add(g2.i);
  }
}

// which pairs can actually be seen flickering: only surfaces that look different (same presets as the website)
const msrc = readFileSync(join(root, "js/materials.js"), "utf8");
const mcode = msrc.slice(msrc.indexOf("const hex = "), msrc.indexOf("const matCache")).replace("export function presetFor", "function presetFor");
class Color { constructor(r, g, b) { Object.assign(this, g === undefined ? { hex: r } : { r: +r.toFixed(4), g: +g.toFixed(4), b: +b.toFixed(4) }); } convertSRGBToLinear() { return this; } }
const presetFor = new Function("THREE", mcode + "; return presetFor;")({ Color });
const look = groups.map((g) => JSON.stringify(presetFor(g.material, model.materials[g.material] ?? {})));
const name = (gi) => { const g = groups[gi]; return `${g.material} [${g.category}, L${g.level}]`; };
const rows = [...pairs.entries()].map(([k, e]) => { const [a, b] = k.split("|").map(Number); return { a, b, ...e }; }).sort((x, y) => y.area - x.area);
console.log(`triangles ${tris.length}, degenerate ${degenerate}`);
console.log(`exact duplicate triangles: ${[...dupes.values()].reduce((s, v) => s + v, 0)} in ${dupes.size} group pairs`);
for (const [k, n] of [...dupes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15)) { const [a, b] = k.split("|").map(Number); console.log(`  dup ${n}: ${name(a)}${a === b ? " (same group)" : " <-> " + name(b)}`); }
console.log(`coplanar same-facing overlaps: ${rows.length} group pairs, ${rows.reduce((s, r) => s + r.area, 0).toFixed(2)} m² total`);
const vis = rows.filter((r) => look[r.a] !== look[r.b]);
console.log(`  of which VISIBLE (different looks): ${vis.length} pairs, ${vis.reduce((s, r) => s + r.area, 0).toFixed(2)} m²; same look (can't flicker): ${(rows.reduce((s, r) => s + r.area, 0) - vis.reduce((s, r) => s + r.area, 0)).toFixed(2)} m²`);
if (process.argv.includes("--visible")) rows.splice(0, rows.length, ...vis);
const cen = (r) => { // centroid of the overlapping triangles of group a, in Revit coords (m)
  let x = 0, y = 0, z = 0, n = 0; for (const i of r.ta) { x += f[i] + f[i + 3] + f[i + 6]; y += f[i + 1] + f[i + 4] + f[i + 7]; z += f[i + 2] + f[i + 5] + f[i + 8]; n += 3; }
  return `(${(x / n).toFixed(1)}, ${(y / n).toFixed(1)}, z ${(z / n).toFixed(2)})`;
};
const LIMIT = Number(process.argv.find((a) => a.startsWith("--top="))?.slice(6) ?? 40);
for (const r of rows.slice(0, LIMIT)) console.log(`  ${r.area.toFixed(3)} m²  ${name(r.a)}  <->  ${name(r.b)}  @ ${cen(r)}  [${r.ta.size}/${r.tb.size} tris]`);
// by category pair
const byCat = new Map();
for (const r of rows) { const k = [groups[r.a].category, groups[r.b].category].sort().join(" <-> "); byCat.set(k, (byCat.get(k) ?? 0) + r.area); }
console.log("by category pair:");
for (const [k, v] of [...byCat.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25)) console.log(`  ${v.toFixed(2)} m²  ${k}`);
if (process.argv.includes("--json")) writeFileSync(join(root, "tools/out-overlaps.json"), JSON.stringify(rows.map((r) => ({ a: r.a, b: r.b, area: r.area, ta: [...r.ta], tb: [...r.tb] }))));

if (FIX) {
  // Nudge the overlapping triangles of the group with the smaller total area outwards (along their normal) by 2 mm.
  const groupArea = new Map(); for (const t of tris) groupArea.set(t.g, (groupArea.get(t.g) ?? 0) + t.area);
  const triByIndex = new Map(tris.map((t) => [t.i, t]));
  const moved = new Set();
  for (const r of rows) {
    const idxs = (groupArea.get(r.a) ?? 0) <= (groupArea.get(r.b) ?? 0) ? r.ta : r.tb;
    for (const i of idxs) {
      if (moved.has(i)) continue;
      const t = triByIndex.get(i); moved.add(i);
      for (let v = 0; v < 9; v += 3) { f[i + v] += t.n[0] * NUDGE; f[i + v + 1] += t.n[1] * NUDGE; f[i + v + 2] += t.n[2] * NUDGE; }
    }
  }
  // Exact duplicates inside the SAME group: collapse the copy to a zero-area triangle (keeps offsets/counts intact)
  let removed = 0; const seen2 = new Set();
  for (const t of tris) { const k = dupKey(t.i) + "#" + t.g; if (seen2.has(k)) { for (let v = 3; v < 9; v++) f[t.i + v] = f[t.i + (v % 3)]; removed++; } else seen2.add(k); }
  writeFileSync(join(root, "data/geometry.bin"), Buffer.from(f.buffer));
  console.log(`FIX: nudged ${moved.size} triangles by ${NUDGE * 1000} mm; collapsed ${removed} same-group duplicates. Now run: node tools/pack-geometry.mjs`);
}
