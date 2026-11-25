// Shrinks data/geometry.bin (float32, from the Revit export) into data/geometry.q.bin.gz:
// positions stored as 16-bit integers (~1 mm precision over the site) and gzip-compressed.
// The website loads the small file automatically and falls back to geometry.bin if it is missing.
// Run after every Revit export:  node tools/pack-geometry.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = join(root, "data/geometry.bin"), modelPath = join(root, "data/model.json");
const buf = readFileSync(binPath);
const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const model = JSON.parse(readFileSync(modelPath, "utf8"));

// Section-cap solids: after tools/fix-geometry.mjs has nudged surfaces apart (anti-flicker), an element made of two
// materials is no longer perfectly closed, and the stencil caps of the floor cut count surfaces, so they need closed
// solids. The caps therefore use the untouched export of the structural categories (walls, floors, columns, beams,
// roofs), stored as data/cap.q.bin.gz with the same quantisation. (Not written when there is no geometry.orig.bin.)
const CAP_CATS = new Set(["Walls", "Floors", "Structural Columns", "Columns", "Structural Framing", "Roofs"]);
let cap = null;
if (existsSync(join(root, "data/geometry.orig.bin")) && existsSync(join(root, "data/model.orig.json"))) {
  const ob = readFileSync(join(root, "data/geometry.orig.bin")), of = new Float32Array(ob.buffer, ob.byteOffset, ob.byteLength / 4);
  const om = JSON.parse(readFileSync(join(root, "data/model.orig.json"), "utf8"));
  const parts = om.groups.filter((g) => CAP_CATS.has(g.category)).map((g) => of.subarray(g.offset, g.offset + g.count));
  cap = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { cap.set(p, o); o += p.length; }
}

const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const arr of cap ? [f, cap] : [f]) for (let i = 0; i < arr.length; i++) { const a = i % 3; if (arr[i] < min[a]) min[a] = arr[i]; if (arr[i] > max[a]) max[a] = arr[i]; }
const scale = max.map((m, a) => (m - min[a]) / 65535 || 1);
let maxErr = 0;
function quantise(arr) {
  const q = new Uint16Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const a = i % 3, v = Math.round((arr[i] - min[a]) / scale[a]);
    q[i] = v;
    maxErr = Math.max(maxErr, Math.abs(min[a] + v * scale[a] - arr[i]));
  }
  return gzipSync(Buffer.from(q.buffer), { level: 9 });
}
const gz = quantise(f);
writeFileSync(join(root, "data/geometry.q.bin.gz"), gz);
const mb = (n) => (n / 1048576).toFixed(2) + " MB";
model.quant = { min, scale };
if (cap) {
  const cgz = quantise(cap);
  writeFileSync(join(root, "data/cap.q.bin.gz"), cgz);
  model.cap = { file: "data/cap.q.bin.gz", count: cap.length };
  console.log(`cap solids (untouched export) -> cap.q.bin.gz ${mb(cgz.length)}`);
} else delete model.cap;
writeFileSync(modelPath, JSON.stringify(model));
console.log(`geometry.bin ${mb(buf.byteLength)} -> geometry.q.bin.gz ${mb(gz.length)}  (max error ${(maxErr * 1000).toFixed(2)} mm)`);
