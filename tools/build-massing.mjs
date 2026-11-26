// Builds massing footprints for the 3D site plan from the Revit export.
// Run from the project root:  node tools/build-massing.mjs [insetMetres]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = path.join(ROOT, '..', 'stin88a-v4', 'source', 'revit', 'siteplan_revit.json');
const OUTPUT = path.join(ROOT, 'data', 'massing.json');

const inset = process.argv[2] !== undefined ? Number(process.argv[2]) : 2.0; // metres
export const BUILDING = { minX: -25.6, maxX: 23.0, minY: -12.6, maxY: 9.0 }; // existing building (measured)
export const CLEAR = 2;                                                       // metres of clearance
const BOARDING_H = 4 * 3.3;   // 4 floors x 3.3 m
const PARKING_H = 3 * 3.0;    // 3 decks x 3.0 m

const PADS = [
  { id: 'p1', revitId: 10674385, use: 'boarding', floors: 4, height: BOARDING_H, label: { en: 'Boarding house', id: 'Rumah kos' } },
  // p2 (2026-11-26, client markup images/4.png): fills pad 2 AND the lower terrace west of it (10675913, level -6.0),
  // from the western retaining wall to the terrace edge by the building's apron. Outline = the two pads' shared outline
  // (not a convex hull: that would cut across the apron). It stands on the lower terrace and keeps the same roof level
  // as pad 1 (-3.5 + 13.2 = 9.7), so it reads as one storey more on the low side.
  { id: 'p2', revitId: 10675631, alsoRevitIds: [10675913], use: 'boarding', floors: 5, roof: -3.5 + BOARDING_H,
    // 2nd markup (images/5.png): the notch by the building apron is filled up to a straight line from the south edge
    // (just short of the apron's corner) to the corner 2 m clear of the building -> `footprint` is the final outline
    // (already inset 1.5 m from the retaining walls / road; no further inset).
    footprint: [[-48.48, 19.5], [-45.82, -5.34], [-30.9, -4.89], [-27.6, 8.54], [-27.6, 12.87], [-28.31, 19.49]],
    label: { en: 'Boarding house', id: 'Rumah kos' } },
  { id: 'p3', revitId: 10676867, use: 'parking', floors: 3, height: PARKING_H, label: { en: 'Parking building', id: 'Gedung parkir' } },
  { id: 'p4', revitId: 10677905, use: 'parking', floors: 3, height: PARKING_H, label: { en: 'Parking building', id: 'Gedung parkir' } },
];

const r2 = (n) => Math.round(n * 100) / 100;

// Signed polygon area (positive when counter-clockwise).
function signedArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// Convex hull (Andrew's monotone chain), returned counter-clockwise.
function convexHull(pts) {
  const s = [...new Map(pts.map((p) => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (arr) => {
    const h = [];
    for (const p of arr) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...build(s), ...build([...s].reverse())];
}

// Shrink a CCW convex polygon: move each edge inward by d, intersect neighbouring edges.
function insetPolygon(poly, d) {
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
    // Left normal (-dy, dx) points inward for CCW polygons.
    return { p: [a[0] - dy * d, a[1] + dx * d], dx, dy };
  });
  return lines.map((l2, i) => {
    const l1 = lines[(i + n - 1) % n];
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 1e-9) return l2.p;
    const t = ((l2.p[0] - l1.p[0]) * l2.dy - (l2.p[1] - l1.p[1]) * l2.dx) / den;
    return [l1.p[0] + l1.dx * t, l1.p[1] + l1.dy * t];
  });
}

// Drop vertices on a straight line (< 1 degree turn) or closer than 0.5 m to the previous kept one.
function simplify(poly) {
  const kept = poly.filter((p, i) => {
    const prev = poly[(i + poly.length - 1) % poly.length], next = poly[(i + 1) % poly.length];
    const a1 = Math.atan2(p[1] - prev[1], p[0] - prev[0]), a2 = Math.atan2(next[1] - p[1], next[0] - p[0]);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    return (turn * 180) / Math.PI >= 1;
  });
  const res = [];
  for (const p of kept) {
    if (!res.length || Math.hypot(p[0] - res[res.length - 1][0], p[1] - res[res.length - 1][1]) >= 0.5) res.push(p);
  }
  if (res.length > 1 && Math.hypot(res[0][0] - res[res.length - 1][0], res[0][1] - res[res.length - 1][1]) < 0.5) res.pop();
  return res;
}

// Sutherland-Hodgman: keep the part of poly where f(p) >= 0 (f is a signed distance).
function clipHalfPlane(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if (fa >= 0 !== fb >= 0) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// If the polygon overlaps the building (grown by CLEAR), clip to the half-plane that keeps most area.
function avoidBuilding(poly) {
  const { minX, maxX, minY, maxY } = BUILDING, c = CLEAR;
  const planes = [
    (p) => p[1] - (maxY + c), // north of building
    (p) => (minY - c) - p[1], // south
    (p) => p[0] - (maxX + c), // east
    (p) => (minX - c) - p[0], // west
  ];
  // Overlap test: clip the polygon to the expanded rectangle; any area left means overlap.
  let inRect = poly;
  for (const f of [(p) => p[0] - (minX - c), (p) => (maxX + c) - p[0], (p) => p[1] - (minY - c), (p) => (maxY + c) - p[1]]) {
    inRect = inRect.length ? clipHalfPlane(inRect, f) : inRect;
  }
  if (inRect.length < 3 || Math.abs(signedArea(inRect)) < 1e-6) return poly;
  let best = [], bestArea = -1;
  for (const f of planes) {
    const clipped = clipHalfPlane(poly, f);
    const a = clipped.length >= 3 ? Math.abs(signedArea(clipped)) : 0;
    if (a > bestArea) { best = clipped; bestArea = a; }
  }
  return best;
}

const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const items = [];

for (const pad of PADS) {
  const els = [pad.revitId, ...(pad.alsoRevitIds ?? [])].map((id) => {
    const el = data.elements.find((e) => e.id === id);
    if (!el) throw new Error(`Element ${id} not found`);
    return el;
  });

  // Collect vertices of upward-facing triangles (normal z > 0.7); base = the lowest of the pads' top levels.
  const pts = [];
  let topZ = Infinity;
  for (const el of els) {
  let elTop = -Infinity;
  for (const part of Object.values(el.parts)) {
    const { v, i } = part;
    for (let k = 0; k < i.length; k += 3) {
      const A = [i[k], i[k + 1], i[k + 2]].map((j) => [v[j * 3], v[j * 3 + 1], v[j * 3 + 2]]);
      const u = A[1].map((n, q) => n - A[0][q]), w = A[2].map((n, q) => n - A[0][q]);
      const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
      const len = Math.hypot(nx, ny, nz);
      if (!len || nz / len <= 0.7) continue;
      for (const p of A) { pts.push([p[0], p[1]]); elTop = Math.max(elTop, p[2]); }
    }
  }
  topZ = Math.min(topZ, elTop);
  }
  if (pts.length < 3) throw new Error(`${pad.id}: no top triangles`);
  const height = pad.roof !== undefined ? pad.roof - topZ : pad.height;

  // Hull (or the given outline) -> inset -> simplify -> clip away from the building -> simplify again.
  let poly = pad.footprint ? pad.footprint.map((p) => [...p]) : simplify(insetPolygon(pad.outline ?? convexHull(pts), pad.inset ?? inset));
  poly = simplify(avoidBuilding(poly));
  if (poly.length < 3) throw new Error(`${pad.id}: degenerate footprint`);
  if (signedArea(poly) < 0) poly.reverse(); // make sure it is counter-clockwise

  const area = Math.round(Math.abs(signedArea(poly)));
  items.push({
    id: pad.id, revitId: pad.revitId, use: pad.use, label: pad.label, floors: pad.floors,
    base: r2(topZ), height: r2(height), footprint: poly.map(([x, y]) => [r2(x), r2(y)]), area,
  });

  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  console.log(`${pad.id}: ${poly.length} verts, area ${area} m2, base ${r2(topZ)}, height ${r2(height)}, ` +
    `bbox x[${r2(Math.min(...xs))}, ${r2(Math.max(...xs))}] y[${r2(Math.min(...ys))}, ${r2(Math.max(...ys))}]`);
}

const out = {
  note: `Massing footprints for the 3D site plan: top-face convex hull of each Revit pad, inset ${inset} m, clipped clear of the existing building.`,
  frame: 'building frame, metres, Revit axes (x, y, z up); three.js: (x, z, -y)',
  items,
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(out));
console.log(`wrote ${OUTPUT} (${fs.statSync(OUTPUT).size} bytes)`);
