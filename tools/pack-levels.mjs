// Phase 6: builds data/levels/ for the website from the Blender export (source/glb_raw/*.gltf + tex/) and the
// lightmap PNGs (source/lm_png/ + data/levels/lightmaps.json).
//   node tools/pack-levels.mjs            (needs toktx from KTX-Software on PATH or in %LOCALAPPDATA%\Programs\KTX-Software\bin)
// Per level: dedup + prune + weld, meshes compressed with EXT_meshopt_compression, every texture turned into KTX2 once
// (colour / roughness: ETC1S, normal maps: UASTC) and shared by all levels (data/levels/tex/*.ktx2), written as
// <level>.gltf + <level>.bin. Lightmaps -> data/levels/lm/*.ktx2 (ETC1S; --uastc-lightmaps for UASTC).
// Prints the size of every file against the brief's budget.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, prune, weld, reorder, quantize } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(root, "source/glb_raw"), OUT = join(root, "data/levels"), LMPNG = join(root, "source/lm_png");
const TOKTX = existsSync(join(process.env.LOCALAPPDATA ?? "", "Programs/KTX-Software/bin/toktx.exe"))
  ? join(process.env.LOCALAPPDATA, "Programs/KTX-Software/bin/toktx.exe") : "toktx";
const UASTC_LM = process.argv.includes("--uastc-lightmaps");
mkdirSync(join(OUT, "tex"), { recursive: true }); mkdirSync(join(OUT, "lm"), { recursive: true });

function toktx(src, dst, { normal = false, srgb = true, uastc = false } = {}) {
  if (!process.argv.includes("--force") && existsSync(dst) && statSync(dst).mtimeMs > statSync(src).mtimeMs) return;   // already built from this source
  const args = ["--t2", "--genmipmap", "--assign_oetf", srgb ? "srgb" : "linear"];
  if (normal || uastc) args.push("--encode", "uastc", "--uastc_quality", "2", "--zcmp", "18");
  else args.push("--encode", "etc1s", "--clevel", "4", "--qlevel", "160");
  // normal maps: 512 px + rate-distortion optimisation (surface relief at room scale does not need 1k; it was ~10 MB)
  // (no --normal_mode: that stores X/Y in red/alpha, which three.js does not read as a normal map)
  if (normal) args.push("--resize", "512x512", "--uastc_rdo_l", "1.5");
  try { execFileSync(TOKTX, [...args, dst, src], { stdio: "pipe" }); }
  catch (e) { throw new Error("toktx failed for " + src + " -> " + dst + ": " + (e.stderr?.toString() || e.message)); }
}

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const sizes = [];
const kb = (p) => Math.round(statSync(p).size / 1024);
for (const file of readdirSync(RAW).filter((f) => f.endsWith(".gltf")).sort()) {
  const L = basename(file, ".gltf");
  const doc = await io.read(join(RAW, file));
  // keepAttributes: the lightmap UVs (TEXCOORD_1) are used at runtime only - prune would otherwise drop them
  await doc.transform(dedup(), prune({ keepAttributes: true }), weld());
  // object extras: keep what the website reads (Bonsai adds empty BIM* property groups to every object)
  for (const n of doc.getRoot().listNodes()) {
    const e = n.getExtras(); const out = {};
    for (const [k, v] of Object.entries(e)) if (!k.startsWith("BIM") && k !== "lm_margin") out[k] = v;
    n.setExtras(out);
  }
  // textures: which slot each image is used in decides the encoding
  const usage = new Map();
  for (const mat of doc.getRoot().listMaterials()) {
    const slots = { baseColorTexture: mat.getBaseColorTexture(), metallicRoughnessTexture: mat.getMetallicRoughnessTexture(),
      normalTexture: mat.getNormalTexture(), emissiveTexture: mat.getEmissiveTexture(), occlusionTexture: mat.getOcclusionTexture() };
    for (const [slot, t] of Object.entries(slots)) if (t) usage.set(t, slot);
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const tex of doc.getRoot().listTextures()) {
    const uri = tex.getURI() || tex.getName() + ".jpg";
    const key = basename(uri, extname(uri));
    const slot = usage.get(tex) ?? "baseColorTexture";
    const src = join(tmpdir(), "stinpack_" + key + extname(uri)); writeFileSync(src, tex.getImage());
    const dst = join(OUT, "tex", key + ".ktx2");
    toktx(src, dst, { normal: slot === "normalTexture", srgb: slot === "baseColorTexture" || slot === "emissiveTexture" });
    tex.setImage(readFileSync(dst)).setMimeType("image/ktx2").setURI("tex/" + key + ".ktx2");
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize());
  for (const b of doc.getRoot().listBuffers()) b.setURI(L + ".bin");
  await io.write(join(OUT, L + ".gltf"), doc);
  const tris = doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3, 0), 0);
  sizes.push({ L, gltf: kb(join(OUT, L + ".gltf")), bin: kb(join(OUT, L + ".bin")), meshes: doc.getRoot().listMeshes().length, nodes: doc.getRoot().listNodes().length, tris: Math.round(tris) });
}
// lightmaps
const manPath = join(OUT, "lightmaps.json");
const man = existsSync(manPath) ? JSON.parse(readFileSync(manPath, "utf8")) : {};
const lmSizes = [];
for (const [set, entries] of Object.entries(man))
  for (const [k, e] of Object.entries(entries)) {
    const src = join(LMPNG, e.png); if (!existsSync(src)) continue;
    const dst = join(OUT, e.file);
    toktx(src, dst, { srgb: k !== "ao", uastc: UASTC_LM });
    lmSizes.push({ file: e.file, kb: kb(dst) });
  }
const texKB = readdirSync(join(OUT, "tex")).reduce((a, f) => a + kb(join(OUT, "tex", f)), 0);
const lmKB = lmSizes.reduce((a, s) => a + s.kb, 0);
console.log("level          gltf+bin   meshes  nodes   triangles   (budget 2-4 MB, limit 6 MB per level)");
let geomKB = 0;
for (const s of sizes) { geomKB += s.gltf + s.bin; console.log(`${s.L.padEnd(6)} ${String(((s.gltf + s.bin) / 1024).toFixed(2)).padStart(13)} MB ${String(s.meshes).padStart(6)} ${String(s.nodes).padStart(6)} ${String(s.tris).padStart(11)}`); }
console.log(`shared textures (KTX2): ${(texKB / 1024).toFixed(2)} MB in ${readdirSync(join(OUT, "tex")).length} files`);
for (const s of lmSizes) console.log(`lightmap ${s.file}: ${(s.kb / 1024).toFixed(2)} MB  (budget 0.5-1 MB, hi-res room <= 0.5 MB)`);
console.log(`TOTAL ${((geomKB + texKB + lmKB) / 1024).toFixed(2)} MB  (budget 20 MB, limit 25 MB)`);
writeFileSync(join(OUT, "pack_report.json"), JSON.stringify({ levels: sizes, textures_kb: texKB, lightmaps: lmSizes }, null, 1));
