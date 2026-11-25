// DEV TOOL (not uploaded): numbers for source/AUDIT.md from data/model.json + data/geometry.bin.
//   node tools/audit-geometry.mjs [--json out.json]
// Prints triangles per Revit material and per category, and each level's bounding box in Revit coordinates
// (metres, z up, internal origin) and in the site's coordinates (three.js: x, y = z, z = -y, before the root offset).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const model = JSON.parse(readFileSync(join(root, "data/model.json"), "utf8"));
const buf = readFileSync(join(root, "data/geometry.bin"));
const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

const byMat = {}, byCat = {}, byLevel = {};
const box = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const grow = (b, x, y, z) => { const p = [x, y, z]; for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], p[k]); b.max[k] = Math.max(b.max[k], p[k]); } };
const all = box();
for (const g of model.groups) {
  const tris = g.count / 9;
  const m = (byMat[g.material] ??= { tris: 0, cats: new Set() }); m.tris += tris; m.cats.add(g.category);
  byCat[g.category] = (byCat[g.category] ?? 0) + tris;
  const L = (byLevel[g.level] ??= { tris: 0, box: box() }); L.tris += tris;
  for (let i = g.offset; i < g.offset + g.count; i += 3) { grow(L.box, f[i], f[i + 1], f[i + 2]); grow(all, f[i], f[i + 1], f[i + 2]); }
}
let fxTris = 0;
for (const fx of model.fixtures ?? []) for (const p of fx.parts) fxTris += (p.count / 9) * fx.instances.length;

const r3 = (v) => Math.round(v * 1000) / 1000;
const toSite = (b) => ({ min: [b.min[0], b.min[2], -b.max[1]].map(r3), max: [b.max[0], b.max[2], -b.min[1]].map(r3) });
const total = Object.values(byCat).reduce((a, b) => a + b, 0);
console.log(`groups ${model.groups.length}, triangles ${Math.round(total)} (+ fixtures ${Math.round(fxTris)} drawn as instances), materials ${Object.keys(byMat).length}, rooms ${model.rooms.length}`);
console.log("\nlevels (Revit z):", model.levels.map((l, i) => `${i} ${l.name} ${l.z}`).join(" | "));
console.log("\nper level: triangles, bbox Revit [x,y,z] -> site [x,y,z] (before root offset)");
for (const [lv, L] of Object.entries(byLevel)) {
  const s = toSite(L.box);
  console.log(`  L${lv} ${model.levels[lv]?.name ?? "?"}: ${Math.round(L.tris)} tris  Revit min ${L.box.min.map(r3)} max ${L.box.max.map(r3)}  site min ${s.min} max ${s.max}`);
}
console.log(`  all: Revit min ${all.min.map(r3)} max ${all.max.map(r3)}`);
console.log("\nper category:");
for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${c.padEnd(26)} ${Math.round(n)}`);
console.log("\nper material:");
for (const [m, v] of Object.entries(byMat).sort((a, b) => b[1].tris - a[1].tris)) console.log(`  ${m.padEnd(52)} ${String(Math.round(v.tris)).padStart(7)}  ${[...v.cats].join(", ")}`);

const i = process.argv.indexOf("--json");
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify({
  levels: Object.fromEntries(Object.entries(byLevel).map(([k, L]) => [k, { tris: Math.round(L.tris), revit: L.box, site: toSite(L.box) }])),
  all, byCat, byMat: Object.fromEntries(Object.entries(byMat).map(([k, v]) => [k, { tris: Math.round(v.tris), cats: [...v.cats] }])),
}, null, 1));
