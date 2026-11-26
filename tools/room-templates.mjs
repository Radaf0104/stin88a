// Builds per-room local frames, width classes and template->target transforms.
// Run from project root: node tools/room-templates.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const geo = JSON.parse(fs.readFileSync(path.join(root, 'tools/out/rooms_geo.json'), 'utf8'));
const TEMPLATES = { '3': 'K.405', '3.5': 'K.407', '4': 'K.413' };

// Width bands [class, lo, hi). Tuned to the histogram clusters (see bandNote).
let BANDS = [['3', 2.7, 3.2], ['3.5', 3.2, 3.7], ['4', 3.7, 4.3]];
let bandNote = 'Measured width clusters 2.85 / 3.34-3.43 / 3.67 / 4.00 (wall thickness shifts them); the nominal bands 3: 2.7-3.2, 3.5: 3.2-3.7, 4: 3.7-4.3 already contain them, so they were kept unchanged. K.301/K.401 (3.67 m) sit at the top of the 3.5 band and K.202/K.316 had no entrance door (borrowed from the same-footprint room on another level).';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Distance from a point to the polygon boundary.
function distToPoly(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ab = sub(b, a), l2 = dot(ab, ab);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    best = Math.min(best, dist(p, [a[0] + t * ab[0], a[1] + t * ab[1]]));
  }
  return best;
}

// Build the local frame of one room.
function frame(u) {
  const xs = u.outline.map(p => p[0]), ys = u.outline.map(p => p[1]);
  const min = [Math.min(...xs), Math.min(...ys)], max = [Math.max(...xs), Math.max(...ys)];
  const bc = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  let ents = u.doors.filter(d => d.role === 'entrance');
  let inferred = null;
  if (!ents.length) {
    // No entrance door recorded: borrow it from a room with the same plan footprint on another level.
    const twin = geo.units.find(o => o !== u && o.doors.some(d => d.role === 'entrance') &&
      [0, 1].every(i => Math.abs(o.boxMin[i] - u.boxMin[i]) < 0.02 && Math.abs(o.boxMax[i] - u.boxMax[i]) < 0.02));
    if (!twin) throw new Error(u.label + ': no entrance door and no twin');
    ents = twin.doors.filter(d => d.role === 'entrance');
    inferred = twin.label;
  }
  ents.sort((a, b) => distToPoly(a.c, u.outline) - distToPoly(b.c, u.outline));
  const door = ents[0].c;
  const v = sub(bc, door);
  // Snap entrance->centre direction to the dominant plan axis.
  const depth = Math.abs(v[0]) >= Math.abs(v[1]) ? [Math.sign(v[0]), 0] : [0, Math.sign(v[1])];
  const side = [-depth[1], depth[0]]; // depth rotated +90 deg CCW
  const alongX = depth[0] !== 0;
  const width = alongX ? max[1] - min[1] : max[0] - min[0];
  const dep = alongX ? max[0] - min[0] : max[1] - min[1];
  // Facade anchor: midpoint of the far bbox edge, z = room floor.
  const anchor = alongX
    ? [depth[0] > 0 ? max[0] : min[0], bc[1], u.boxMin[2]]
    : [bc[0], depth[1] > 0 ? max[1] : min[1], u.boxMin[2]];
  const bathSide = u.bathCenter ? (Math.sign(dot(sub(u.bathCenter, anchor), side)) || null) : null;
  const facade = alongX ? (depth[0] > 0 ? 'east' : 'west') : (depth[1] > 0 ? 'north' : 'south');
  return { u, label: u.label, level: u.level, type: u.type, door, depth, side, anchor, width, dep,
    facade, bathSide, hasBalcony: u.doors.some(d => d.out), inferred };
}

const rooms = geo.units.map(frame);

// Width histogram (0.05 m bins) so the clusters are visible.
const hist = {};
for (const r of rooms) { const k = (Math.round(r.width * 20) / 20).toFixed(2); hist[k] = (hist[k] || 0) + 1; }
console.log('Width histogram (m: count):');
for (const k of Object.keys(hist).sort()) console.log(' ', k, '#'.repeat(hist[k]), hist[k]);

// Optional band override while tuning: BANDS='{"bands":[["3",2.5,3.2]],"note":"..."}'
if (process.env.BANDS) { const t = JSON.parse(process.env.BANDS); BANDS = t.bands; bandNote = t.note; }

const classify = w => (BANDS.find(([, lo, hi]) => w >= lo && w < hi) || ['other'])[0];
for (const r of rooms) r.widthClass = classify(r.width);
const byLabel = Object.fromEntries(rooms.map(r => [r.label, r]));

// Template->target transform as a column-major 4x4:
// p' = L (p - anchorT) + anchorG, where L maps template (depth, side, up) to target (depth, +/-side, up).
function transform(T, G) {
  const mirror = T.bathSide != null && G.bathSide != null && T.bathSide !== G.bathSide;
  const m = mirror ? -1 : 1;
  const L = [[0, 0, 0], [0, 0, 0], [0, 0, 1]];
  const pairs = [[T.depth, G.depth], [T.side, [m * G.side[0], m * G.side[1]]]];
  for (const [t, c] of pairs)
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) L[i][j] += c[i] * t[j];
  const a = T.anchor, b = G.anchor;
  const tr = [0, 1, 2].map(i => b[i] - (L[i][0] * a[0] + L[i][1] * a[1] + L[i][2] * a[2]));
  const e = [L[0][0], L[1][0], L[2][0], 0, L[0][1], L[1][1], L[2][1], 0, L[0][2], L[1][2], L[2][2], 0, tr[0], tr[1], tr[2], 1];
  const deg = v => Math.atan2(v[1], v[0]) * 180 / Math.PI;
  const rot = Math.round(deg(G.depth) - deg(T.depth));
  return { e, mirror, rotationDeg: ((rot % 360) + 360) % 360, translate: tr };
}
const apply = (e, p) => [0, 1, 2].map(i => e[i] * p[0] + e[4 + i] * p[1] + e[8 + i] * p[2] + e[12 + i]);
const r3 = x => Math.round(x * 1e4) / 1e4;

// Report each template's own class.
const warnings = [];
for (const [c, lab] of Object.entries(TEMPLATES)) {
  const r = byLabel[lab];
  const ok = r && r.widthClass === c;
  console.log(`Template ${c} -> ${lab}: width ${r?.width.toFixed(3)} class ${r?.widthClass}${ok ? '' : '   *** TEMPLATE NOT IN ITS INTENDED CLASS ***'}`);
  if (!ok) warnings.push(`Template ${lab} (for class ${c}) measured ${r?.width.toFixed(3)} m = class ${r?.widthClass}`);
}

// Transforms and checks (template entrance door, bath centre and anchor mapped onto the target's).
const out = [], others = [], bad = [];
for (const r of rooms) {
  const T = byLabel[TEMPLATES[r.widthClass]];
  const row = { label: r.label, level: r.level, type: r.type, widthClass: r.widthClass, width: r3(r.width),
    depth: r3(r.dep), facade: r.facade, hasBalcony: r.hasBalcony, bathSide: r.bathSide,
    template: T ? T.label : null, isTemplate: !!T && T.label === r.label };
  if (r.inferred) row.entranceInferredFrom = r.inferred; // entrance door borrowed from this twin room
  if (r.widthClass === 'other') others.push(r.label);
  if (T) {
    const x = transform(T, r);
    const dErr = dist(apply(x.e, T.door), r.door);
    const bErr = r.u.bathCenter && T.u.bathCenter ? dist(apply(x.e, T.u.bathCenter), r.u.bathCenter) : null;
    const aErr = dist(apply(x.e, T.anchor), r.anchor);
    Object.assign(row, { mirror: x.mirror, rotationDeg: x.rotationDeg, translate: x.translate.map(r3),
      matrix: x.e.map(r3), checkErrors: { door: r3(dErr), bath: bErr == null ? null : r3(bErr) } });
    const why = [];
    if (dErr > 0.6) why.push(`door ${dErr.toFixed(2)}`);
    if (bErr != null && bErr > 0.6) why.push(`bath ${bErr.toFixed(2)}`);
    if (aErr > 0.01) why.push(`anchor ${aErr.toFixed(2)}`);
    if (why.length) bad.push(`${r.label} (template ${T.label}): ${why.join(', ')}`);
  } else Object.assign(row, { mirror: false, rotationDeg: null, matrix: null, checkErrors: null });
  out.push(row);
}

const counts = {};
for (const r of rooms) counts[r.widthClass] = (counts[r.widthClass] || 0) + 1;
console.log('Class counts:', counts);
console.log('Other rooms:', others.map(l => `${l}=${byLabel[l].width.toFixed(3)}`).join(', ') || 'none');
console.log('Check errors > 0.6 m:', bad.length ? '\n  ' + bad.join('\n  ') : 'none');
if (warnings.length) console.log('WARNINGS:', warnings);

const note = `${bandNote} Frame: Revit building frame, metres. Matrices are 4x4 column-major (three.js Matrix4.elements) mapping template room to target room; mirror flips the side axis (det -1).` + (warnings.length ? ' WARNING: ' + warnings.join('; ') : '');
fs.writeFileSync(path.join(root, 'data/room_templates.json'), JSON.stringify({ note, templates: TEMPLATES, rooms: out, others }, null, 1));
