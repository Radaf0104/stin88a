// Round 22 of IMPROVEMENT_LOG.md: Nagoya-Hill-style accents for every guest room (user-approved: "Yes, add them").
//   node tools/build-accents.mjs [--raw <folder with the Blender export L1..L4.gltf>] [--out data/room_accents.json]
// Reads the raw Blender export (one node per object, before the pack step merges them), where the template rooms
// K.405 / K.407 / K.413 have already been copied into every room (06t). Per room it writes, in the level files' own
// root-local frame (metres, y up):
//   shadow - soft contact shadows on the floor under the bed and every piece of floor-standing casework
//   plinth - a warm LED line along the room-facing foot of every full-height unit (wardrobe / shelving wall), plus
//            the matching floor wash in front of it
//   niche  - LED lines under the open shelves of those units (shelf undersides 0.9-2.4 m above the floor)
// Nothing here moves or reshapes the furniture: these are separate, thin pieces drawn by js/accents.js as a handful of
// GPU-instanced meshes. Room centres come from tools/out/rooms_geo.json (Revit frame: x, y, z up -> x, z, -y here).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const RAW = arg("raw", join(root, "../stin88a-v4/source/glb_raw")), OUT = join(root, arg("out", "data/room_accents.json"));
const geo = JSON.parse(readFileSync(join(root, "tools/out/rooms_geo.json"), "utf8"));
const centre = {}; // room label -> [x, z] in the level frame
for (const u of geo.units) { const xs = u.outline.map((p) => p[0]), ys = u.outline.map((p) => p[1]); centre[u.label] = [(Math.min(...xs) + Math.max(...xs)) / 2, -(Math.min(...ys) + Math.max(...ys)) / 2]; }

const r3 = (x) => Math.round(x * 1000) / 1000;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const out = { note: "see tools/build-accents.mjs", levels: {} };
let counts = { rooms: 0, shadow: 0, plinth: 0, niche: 0 };
for (const L of ["L1", "L2", "L3", "L4"]) {
  const file = join(RAW, L + ".gltf"); if (!existsSync(file)) continue;
  const doc = await io.read(file);
  const rooms = new Map();
  for (const n of doc.getRoot().listNodes()) {
    const e = n.getExtras(), mesh = n.getMesh();
    if (!mesh || !/^K\./.test(e.room ?? "") || e.bathroom || !/^(bed|casework|furniture)/.test(e.kind ?? "")) continue;
    const W = n.getWorldMatrix(), tris = [], v = [], mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of mesh.listPrimitives()) {
      const a = p.getAttribute("POSITION"), idx = p.getIndices()?.getArray(), pts = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, v); const w = [0, 1, 2].map((k) => W[k] * v[0] + W[4 + k] * v[1] + W[8 + k] * v[2] + W[12 + k]);
        pts.push(w); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); }
      }
      const I = idx ?? pts.map((_, i) => i);
      for (let t = 0; t < I.length; t += 3) tris.push([pts[I[t]], pts[I[t + 1]], pts[I[t + 2]]]);
    }
    if (!rooms.has(e.room)) rooms.set(e.room, []);
    rooms.get(e.room).push({ kind: e.kind, mn, mx, tris });
  }
  const lev = { shadow: [], plinth: [], niche: [] };
  for (const [label, items] of rooms) {
    const c = centre[label]; if (!c) continue;
    const floor = Math.min(...items.map((it) => it.mn[1]));
    counts.rooms++;
    for (const it of items) {
      const sx = it.mx[0] - it.mn[0], sz = it.mx[2] - it.mn[2], h = it.mx[1] - it.mn[1];
      const cx = (it.mn[0] + it.mx[0]) / 2, cz = (it.mn[2] + it.mx[2]) / 2;
      const grounded = it.mn[1] - floor < 0.07;
      // contact shadow: footprint + 12 cm of soft fall-off (js/accents.js draws the fall-off), [x, z, w, d, floor, strength]
      if (grounded && sx * sz > 0.08 && sx * sz < 12) { lev.shadow.push([label, r3(cx), r3(cz), r3(sx + 0.24), r3(sz + 0.24), r3(floor), it.kind === "bed" ? 0.5 : 0.4]); counts.shadow++; }
      if (!/^casework/.test(it.kind) || h < 1.8 || !grounded) continue;
      // the side that faces the room centre
      const sides = [[1, 0, it.mx[0], sz], [-1, 0, it.mn[0], sz], [0, 1, it.mx[2], sx], [0, -1, it.mn[2], sx]];
      const best = sides.map((s) => ({ s, d: s[0] * (c[0] - cx) + s[1] * (c[1] - cz) })).sort((a, b) => b.d - a.d)[0].s;
      const [nx, nz, plane, len] = best;
      if (len < 0.3) continue;
      // plinth LED: [x, z, length, floor, nx, nz] (a 12 mm line 6 mm in front of the unit's foot, along its face)
      const px = nx ? plane + nx * 0.006 : cx, pz = nz ? plane + nz * 0.006 : cz;
      lev.plinth.push([label, r3(px), r3(pz), r3(len - 0.04), r3(floor), nx, nz]); counts.plinth++;
      // open shelves: downward faces 0.9-2.4 m up, grouped by height; each group's front edge gets an LED line
      const byH = new Map();
      for (const [a, b, d] of it.tris) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        const ny = uz * vx - ux * vz, l = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
        if (!l || ny / l > -0.95) continue;
        const y = (a[1] + b[1] + d[1]) / 3 - floor; if (y < 0.9 || y > 2.4) continue;
        const k = Math.round(y * 100);
        const g = byH.get(k) ?? { y: (a[1] + b[1] + d[1]) / 3, mn: [1e9, 1e9], mx: [-1e9, -1e9], area: 0 };
        for (const p of [a, b, d]) { g.mn[0] = Math.min(g.mn[0], p[0]); g.mn[1] = Math.min(g.mn[1], p[2]); g.mx[0] = Math.max(g.mx[0], p[0]); g.mx[1] = Math.max(g.mx[1], p[2]); }
        g.area += l / 2; byH.set(k, g);
      }
      for (const g of byH.values()) {
        const along = nx ? g.mx[1] - g.mn[1] : g.mx[0] - g.mn[0], deep = nx ? g.mx[0] - g.mn[0] : g.mx[1] - g.mn[1];
        if (along < 0.25 || deep < 0.12 || deep > 0.65 || g.area < 0.03) continue;
        // along the shelf's BACK edge (straight, against the wall - the fronts can be curved): a wall-washing line
        const back = nx > 0 ? g.mn[0] : nx < 0 ? g.mx[0] : nz > 0 ? g.mn[1] : g.mx[1];
        const ex = nx ? back + nx * 0.03 : (g.mn[0] + g.mx[0]) / 2, ez = nz ? back + nz * 0.03 : (g.mn[1] + g.mx[1]) / 2;
        // niche LED: [x, y, z, length, nx, nz] (a 10 mm line 4 mm under the shelf, 3 cm in from its back edge)
        lev.niche.push([label, r3(ex), r3(g.y - 0.004), r3(ez), r3(along * 0.85), nx, nz]); counts.niche++;
      }
    }
  }
  // two casework nodes can overlap (one unit exported as a part of another): keep one of each line / shadow
  for (const k of Object.keys(lev)) {
    const seen = new Set();
    lev[k] = lev[k].filter((r) => { const key = [r[0], ...r.slice(1, 4).map((x) => Math.round(x * 50))].join("|"); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  out.levels[L] = lev;
}
for (const lev of Object.values(out.levels)) { counts.shadow = counts.plinth = counts.niche = 0; }
for (const lev of Object.values(out.levels)) { counts.shadow += lev.shadow.length; counts.plinth += lev.plinth.length; counts.niche += lev.niche.length; }
writeFileSync(OUT, JSON.stringify(out));
console.log(`accents: ${counts.rooms} rooms, ${counts.shadow} contact shadows, ${counts.plinth} plinth LEDs, ${counts.niche} shelf LEDs -> ${OUT}`);
