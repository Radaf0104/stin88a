// Site plan around the building, from the masterplan Revit file ("STIN MASTERPLAN FINAL": terrain = toposolids,
// roads / pads = floors, retaining walls), replacing the generated lawn, trees and hills on the website.
//   node tools/build-siteplan.mjs [--in source/revit/siteplan_revit.json] [--out data/levels/SITEPLAN.gltf]
// Input: the JSON written in Revit (see README "Site plan"): triangles per element and material, already in the
// building's own frame (inverse of the STIN VILLA 88A link transform), metres, Revit axes (x, y, z up) - so the site
// lines up with data/levels/*.gltf by itself. Output: one glTF with a mesh per surface type, flat light colours (no
// textures), shared vertices welded, smooth normals on the terrain, meshopt compressed - a few hundred KB.
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, quantize, reorder, prune } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const IN = join(root, arg("in", "source/revit/siteplan_revit.json")), OUT = join(root, arg("out", "data/levels/SITEPLAN.gltf"));

// Revit material -> surface type, and a light, soft palette for the site (the building keeps its own materials)
const TYPE = (m) => /grass|soil/i.test(m) ? (/soil/i.test(m) ? "soil" : "grass") : /asphalt/i.test(m) ? "road" : "pad";
const LOOK = {
  // warm, soft palette after the client's reference render (white render, honey timber, charcoal, hazy morning lawn)
  // Matched by measurement to the client's render (images/3.jpg): olive lawn #727539, dark grey asphalt, pale concrete.
  // The day sun + exposure + haze lift colours ~2-3x on screen, so these base colours are much darker than they read.
  grass: { color: [0.275, 0.31, 0.165], rough: 1.0 }, // olive lawn (round 11: a touch more blue, green kept above red after the warm grade; render #727539)
  soil:  { color: [0.42, 0.37, 0.29], rough: 1.0 },   // warm earth
  road:  { color: [0.22, 0.225, 0.24], rough: 0.95 }, // dark asphalt -> ~#686B70 in sun
  pad:   { color: [0.58, 0.575, 0.56], rough: 0.9 },  // pale concrete pads, retaining walls
};
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const src = JSON.parse(readFileSync(IN, "utf8"));
const merged = {};   // type -> { v: [], i: [] }
for (const e of src.elements) for (const [mat, p] of Object.entries(e.parts)) {
  const t = e.kind === "wall" ? "pad" : TYPE(mat);
  const M = (merged[t] ??= { v: [], i: [] }); const base = M.v.length / 3;
  for (let k = 0; k < p.v.length; k += 3) M.v.push(p.v[k], p.v[k + 2], -p.v[k + 1]);   // Revit (x, y, z) -> glTF (x, z, -y)
  for (const i of p.i) M.i.push(base + i);
}

const doc = new Document(); const buf = doc.createBuffer(); const scene = doc.createScene("siteplan");
let tris = 0;
for (const [t, M] of Object.entries(merged)) {
  const pos = new Float32Array(M.v), idx = new Uint32Array(M.i), nrm = new Float32Array(pos.length);
  // smooth normals (area weighted): the terrain reads as soft ground, not facets
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, c] = [idx[k] * 3, idx[k + 1] * 3, idx[k + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const j of [a, b, c]) { nrm[j] += nx; nrm[j + 1] += ny; nrm[j + 2] += nz; }
  }
  for (let j = 0; j < nrm.length; j += 3) { const l = Math.hypot(nrm[j], nrm[j + 1], nrm[j + 2]) || 1; nrm[j] /= l; nrm[j + 1] /= l; nrm[j + 2] /= l; }
  // UVs in metres, box-projected by the normal (round 18): the site gets subtle procedural textures on the website
  // (asphalt mottling, slab joints, soft lawn variation - js/main.js), tiled by these
  const uv = new Float32Array(pos.length / 3 * 2);
  for (let j = 0, k = 0; j < pos.length; j += 3, k += 2) {
    const ax = Math.abs(nrm[j]), ay = Math.abs(nrm[j + 1]), az = Math.abs(nrm[j + 2]);
    if (ay >= ax && ay >= az) { uv[k] = pos[j]; uv[k + 1] = pos[j + 2]; }
    else if (ax >= az) { uv[k] = pos[j + 2]; uv[k + 1] = pos[j + 1]; }
    else { uv[k] = pos[j]; uv[k + 1] = pos[j + 1]; }
    // stored as (m + 256) / 512, so they fit [0, 1] and quantize to 16 bits (~8 mm); js/main.js undoes it in the repeat
    uv[k] = (uv[k] + 256) / 512; uv[k + 1] = (uv[k + 1] + 256) / 512;
  }
  const L = LOOK[t];
  const mat = doc.createMaterial("SITE_" + t).setBaseColorFactor([...L.color.map(srgbToLin), 1]).setRoughnessFactor(L.rough).setMetallicFactor(0);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buf))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(nrm).setBuffer(buf))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(uv).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buf));
  scene.addChild(doc.createNode("siteplan_" + t).setMesh(doc.createMesh("siteplan_" + t).addPrimitive(prim)).setExtras({ kind: "siteplan", surface: t }));
  tris += idx.length / 3;
}
await MeshoptEncoder.ready;
await doc.transform(weld(), reorder({ encoder: MeshoptEncoder }), quantize({ quantizeTexcoord: 16 }), prune({ keepAttributes: true })); // (keep the UVs: the textures are added on the website)
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
buf.setURI("SITEPLAN.bin");
await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder }).write(OUT, doc);
const kb = (p) => (statSync(p).size / 1024).toFixed(0);
console.log(`site plan: ${src.elements.length} Revit elements, ${tris} triangles in ${Object.keys(merged).length} meshes (${Object.keys(merged).join(", ")}) -> ${OUT} (${kb(OUT)} KB + ${kb(OUT.replace(/\.gltf$/, ".bin"))} KB)`);
