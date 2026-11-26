// Phase 6: builds data/levels/ for the website from the Blender export (source/glb_raw/*.gltf + tex/) and the
// lightmap PNGs (source/lm_png/ + data/levels/lightmaps.json).
//   node tools/pack-levels.mjs            (needs toktx from KTX-Software on PATH or in %LOCALAPPDATA%\Programs\KTX-Software\bin)
// Per level: dedup + prune + weld, meshes compressed with EXT_meshopt_compression, every texture turned into KTX2 once
// (colour / roughness: ETC1S, normal maps: UASTC) and shared by all levels (data/levels/tex/*.ktx2), written as
// <level>.gltf + <level>.bin. Lightmaps -> data/levels/lm/*.ktx2 (ETC1S; --uastc-lightmaps for UASTC).
// Prints the size of every file against the brief's budget.
import { NodeIO, MathUtils } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTMeshoptCompression, EXTMeshGPUInstancing, KHRTextureTransform } from "@gltf-transform/extensions";
import { dedup, prune, weld, reorder, quantize, joinPrimitives, transformPrimitive, simplifyPrimitive, compactPrimitive } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
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
mkdirSync(join(OUT, "tex"), { recursive: true }); mkdirSync(join(OUT, "tex_m"), { recursive: true }); mkdirSync(join(OUT, "lm"), { recursive: true });

// colour maps that stay at full size: big surfaces seen up close over whole walls / floors / facades. Everything else
// (bedding, curtains, rug, chair, plant, metal...) only ever covers a small part of the screen: 512 px is plenty.
const FULL_SIZE = /plaster|wood|teak|tile|concrete|paving|marble|stone/;
function toktx(src, dst, { normal = false, srgb = true, uastc = false, half = false, mobile = false } = {}) {
  if (!process.argv.includes("--force") && existsSync(dst) && statSync(dst).mtimeMs > statSync(src).mtimeMs) return;   // already built from this source
  const args = ["--t2", "--genmipmap", "--assign_oetf", srgb ? "srgb" : "linear"];
  if (normal || uastc) args.push("--encode", "uastc", "--uastc_quality", "2", "--zcmp", "18");
  else args.push("--encode", "etc1s", "--clevel", "4", "--qlevel", "160");
  // normal maps: 512 px + rate-distortion optimisation (surface relief at room scale does not need 1k; it was ~10 MB)
  // (no --normal_mode: that stores X/Y in red/alpha, which three.js does not read as a normal map)
  if (mobile) args.push("--resize", normal || half ? "256x256" : "512x512", ...(normal ? ["--uastc_rdo_l", "3"] : []));   // phone set (round 13): half size
  else if (normal) args.push("--resize", "512x512", "--uastc_rdo_l", "3");   // (round 9: RDO 1.5 -> 3, normal maps ~14 % smaller)
  else if (half) args.push("--resize", "512x512");   // roughness maps and small-item colour maps
  // (retried: on Windows the output file is sometimes still locked for a moment - "could not open output file")
  for (let attempt = 1; ; attempt++) {
    try { execFileSync(TOKTX, [...args, dst, src], { stdio: "pipe" }); return; }
    catch (e) {
      if (attempt >= 4) throw new Error("toktx failed for " + src + " -> " + dst + ": " + (e.stderr?.toString() || e.message));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt);
    }
  }
}

// Draw calls: every glTF primitive is one draw call (and one more per shadow pass). The Blender export keeps one node
// per piece of furniture (~840 primitives), so pieces that the website treats the same way are merged, per level, into
// one mesh per material. Kept as they are: door leaves (they swing / slide), TVs (clickable), meshes with a baked
// lightmap (own UVs + lightmap texture). Grouped separately so the site can still tell them apart: ceilings (shown /
// hidden), the building shell (shell / stair / railing / doorframe: drawn in the overview), bathroom fittings (hidden
// in the overview), collision. Copies that share one mesh are written out per copy, so the file grows a little.

// Download size (improvement log, round 2): ~36 % of all triangles are copies of the same furniture (06t template
// rooms). Heavy shared meshes (>= INST_MIN_TRIS triangles, >= 3 copies) are written once and drawn as GPU instances
// (EXT_mesh_gpu_instancing -> THREE.InstancedMesh): one node holding the mesh + a translation / rotation / scale per
// copy, so every copy keeps exactly its place. Mirrored copies (negative determinant) get a mirrored copy of the mesh
// (x negated, winding flipped) and the instance matrix times diag(-1, 1, 1), so no instance has a negative scale.
// Light meshes are still merged per material (mergeLevel) - instancing them would only add draw calls.
// (round 3: only meshes whose copies save >= INST_MIN_SAVED triangles - ~75 % of the saving in ~1/3 of the draw calls)
const INST_MIN_TRIS = 400, INST_MIN_COPIES = 3, INST_MIN_SAVED = 5000;
function instanceHeavy(doc) {
  const root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  const ext = doc.createExtension(EXTMeshGPUInstancing);
  const inDoor = (n) => { for (let p = n; p; p = p.getParentNode?.()) if (p.getExtras().kind === "door") return true; return false; };
  const tris = (m) => m.listPrimitives().reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3, 0);
  const groups = new Map();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(), e = node.getExtras();
    if (!mesh || node.listChildren().length || e.kind === "tv" || e.tv || e.style_room || inDoor(node)) continue;
    const w = node.getWorldMatrix();
    const det = w[0] * (w[5] * w[10] - w[6] * w[9]) - w[1] * (w[4] * w[10] - w[6] * w[8]) + w[2] * (w[4] * w[9] - w[5] * w[8]);
    const key = [root.listMeshes().indexOf(mesh), !!e.bathroom, !!e.collide].join("|");
    if (!groups.has(key)) groups.set(key, { mesh, e, items: [] });
    groups.get(key).items.push({ node, w, det });
  }
  let nodesIn = 0, batches = 0;
  for (const g of groups.values()) {
    if (g.items.length < INST_MIN_COPIES || tris(g.mesh) < INST_MIN_TRIS || tris(g.mesh) * (g.items.length - 1) < INST_MIN_SAVED) continue;
    for (const mirrored of [false, true]) {
      const items = g.items.filter((it) => (it.det < 0) === mirrored);
      if (!items.length) continue;
      let mesh = g.mesh;
      if (mirrored) { // a mirrored copy of the mesh: x negated (positions, normals, tangents), winding flipped
        mesh = doc.createMesh(g.mesh.getName() + "_mirror");
        for (const p0 of g.mesh.listPrimitives()) {
          const p = p0.clone();
          for (const sem of p.listSemantics()) {
            const a = p.getAttribute(sem).clone(); p.setAttribute(sem, a);
            if (sem === "POSITION" || sem === "NORMAL" || sem === "TANGENT") {
              const el = []; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, el); el[0] = -el[0]; a.setElement(i, el); }
            }
          }
          if (p.getIndices()) { const idx = p.getIndices().clone(); const arr = idx.getArray(); for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; } idx.setArray(arr); p.setIndices(idx); }
          mesh.addPrimitive(p);
        }
      }
      const n = items.length, T = new Float32Array(n * 3), R = new Float32Array(n * 4), S = new Float32Array(n * 3);
      const t = [0, 0, 0], r = [0, 0, 0, 1], sc = [1, 1, 1];
      items.forEach((it, i) => {
        const m = Array.from(it.w);
        if (mirrored) { m[0] = -m[0]; m[1] = -m[1]; m[2] = -m[2]; } // w * diag(-1, 1, 1): first column negated
        MathUtils.decompose(m, t, r, sc);
        T.set(t, i * 3); R.set(r, i * 4); S.set(sc, i * 3);
      });
      const buf = root.listBuffers()[0];
      const batch = ext.createInstancedMesh()
        .setAttribute("TRANSLATION", doc.createAccessor().setType("VEC3").setArray(T).setBuffer(buf))
        .setAttribute("ROTATION", doc.createAccessor().setType("VEC4").setArray(R).setBuffer(buf))
        .setAttribute("SCALE", doc.createAccessor().setType("VEC3").setArray(S).setBuffer(buf));
      const node = doc.createNode(mesh.getName() + "_inst").setMesh(mesh).setExtension("EXT_mesh_gpu_instancing", batch)
        .setExtras({ kind: g.e.kind ?? "furniture", level: g.e.level, bathroom: !!g.e.bathroom, collide: !!g.e.collide, instanced: n });
      scene.addChild(node);
      for (const it of items) it.node.dispose();
      nodesIn += n; batches++;
    }
  }
  return { nodesIn, batches };
}

// (round 21 of IMPROVEMENT_LOG.md) The facade battens: after the bevel simplify below, the L1 batten mesh is ~5,700
// plain boxes (~1 MB of compressed vertices). Every piece that is exactly a box (8 corners, 3 orthogonal face
// directions, all 24 vertices on the box) becomes one GPU instance of a single unit box: translation = its centre,
// rotation = its face directions (sorted by size, right-handed), scale = its sizes. Same triangles on screen, a few
// bytes per piece on the wire. All pieces share the first box's UVs (the teak grain on a 5 cm face). Anything that is
// not a clean box stays in the original mesh.
function instanceBoxes(doc, matRe = /^M_teak_batten$/) {
  const root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  const ext = doc.createExtension(EXTMeshGPUInstancing), buf = root.listBuffers()[0];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const xf = (m, p, w) => [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + (w ? m[12 + k] : 0));
  const stats = { boxes: 0, left: 0, batches: 0 };
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(), e = node.getExtras();
    if (!mesh || e.style_room || e.kind === "door" || node.getExtension("EXT_mesh_gpu_instancing")) continue;
    if (mesh.listParents().filter((x) => x.propertyType === "Node").length > 1) continue;
    const W = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      if (!p.getIndices() || !matRe.test(p.getMaterial()?.getName() ?? "") || p.getAttribute("TEXCOORD_1")) continue;
      const P = p.getAttribute("POSITION"), UV = p.getAttribute("TEXCOORD_0"), idx = p.getIndices().getArray();
      const n = P.getCount(), pw = [], el = [];
      for (let i = 0; i < n; i++) pw.push(xf(W, P.getElement(i, el), true));
      // pieces: vertices welded by position (0.1 mm), triangles joined by shared corners
      const key = new Map(), vid = new Int32Array(n);
      for (let i = 0; i < n; i++) { const k = pw[i].map((x) => Math.round(x * 1e4)).join(","); if (!key.has(k)) key.set(k, key.size); vid[i] = key.get(k); }
      const par = Int32Array.from({ length: key.size }, (_, i) => i), f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
      for (let t = 0; t < idx.length; t += 3) { const a = f(vid[idx[t]]); for (const j of [1, 2]) { const b = f(vid[idx[t + j]]); if (b !== a) par[b] = a; } }
      const comps = new Map();
      for (let t = 0; t < idx.length; t += 3) { const r = f(vid[idx[t]]); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(t); }
      const keepTris = [], inst = []; let proto = null;
      for (const tris of comps.values()) {
        const verts = [...new Set(tris.flatMap((t) => [idx[t], idx[t + 1], idx[t + 2]]))];
        const corners = new Set(verts.map((i) => vid[i]));
        const axes = [];
        for (const t of tris) {
          const nn = cross(sub(pw[idx[t + 1]], pw[idx[t]]), sub(pw[idx[t + 2]], pw[idx[t]]));
          if (Math.hypot(...nn) < 1e-12) continue;
          const u = unit(nn); if (!axes.some((a) => Math.abs(dot(a, u)) > 0.999)) axes.push(u);
        }
        let ok = corners.size === 8 && axes.length === 3 && Math.abs(dot(axes[0], axes[1])) < 1e-3 && Math.abs(dot(axes[0], axes[2])) < 1e-3 && Math.abs(dot(axes[1], axes[2])) < 1e-3;
        let box = null;
        if (ok) {
          const lo = [0, 1, 2].map((k) => Math.min(...verts.map((i) => dot(pw[i], axes[k])))), hi = [0, 1, 2].map((k) => Math.max(...verts.map((i) => dot(pw[i], axes[k]))));
          const ext3 = hi.map((h, k) => h - lo[k]);
          ok = ext3.every((x) => x > 1e-4) && verts.every((i) => [0, 1, 2].every((k) => { const d = dot(pw[i], axes[k]); return Math.abs(d - lo[k]) < 1e-3 || Math.abs(d - hi[k]) < 1e-3; }));
          if (ok) {
            const order = [0, 1, 2].sort((a, b) => ext3[a] - ext3[b]);
            const ax = order.map((k) => axes[k]), ex = order.map((k) => ext3[k]);
            if (dot(cross(ax[0], ax[1]), ax[2]) < 0) ax[2] = ax[2].map((x) => -x);
            const c = [0, 1, 2].reduce((acc, k) => acc.map((v, j) => v + axes[k][j] * (lo[k] + hi[k]) / 2), [0, 0, 0]);
            box = { ax, ex, c };
          }
        }
        if (!ok) { keepTris.push(...tris); continue; }
        if (!proto) { // the unit box, in this piece's own frame
          const map = new Map(), pos = [], nrm = [], uv = [], ind = [];
          for (const t of tris) for (let j = 0; j < 3; j++) {
            const i = idx[t + j];
            if (!map.has(i)) {
              map.set(i, pos.length / 3); const d = sub(pw[i], box.c);
              pos.push(...[0, 1, 2].map((k) => dot(d, box.ax[k]) / box.ex[k]));
              if (UV) uv.push(...UV.getElement(i, []));
            }
            ind.push(map.get(i));
          }
          for (let t = 0; t < ind.length; t += 3) { // flat normals from the unit-box faces
            const a = ind[t] * 3, b = ind[t + 1] * 3, cc = ind[t + 2] * 3;
            const nn = unit(cross(sub(pos.slice(b, b + 3), pos.slice(a, a + 3)), sub(pos.slice(cc, cc + 3), pos.slice(a, a + 3))));
            for (const v of [ind[t], ind[t + 1], ind[t + 2]]) { nrm[v * 3] = nn[0]; nrm[v * 3 + 1] = nn[1]; nrm[v * 3 + 2] = nn[2]; }
          }
          proto = { pos, nrm, uv, ind };
        }
        inst.push(box);
      }
      if (inst.length < 50) continue; // (not worth it)
      const m = inst.length, T = new Float32Array(m * 3), R = new Float32Array(m * 4), S = new Float32Array(m * 3), t3 = [0, 0, 0], r4 = [0, 0, 0, 1], s3 = [1, 1, 1];
      inst.forEach((b, i) => {
        const mat = [...b.ax[0].map((x) => x * b.ex[0]), 0, ...b.ax[1].map((x) => x * b.ex[1]), 0, ...b.ax[2].map((x) => x * b.ex[2]), 0, ...b.c, 1];
        MathUtils.decompose(mat, t3, r4, s3); T.set(t3, i * 3); R.set(r4, i * 4); S.set(s3, i * 3);
      });
      const bp = doc.createPrimitive().setMaterial(p.getMaterial())
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(proto.pos)).setBuffer(buf))
        .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(proto.nrm)).setBuffer(buf))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(proto.ind)).setBuffer(buf));
      if (UV) bp.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(proto.uv)).setBuffer(buf));
      const batch = ext.createInstancedMesh()
        .setAttribute("TRANSLATION", doc.createAccessor().setType("VEC3").setArray(T).setBuffer(buf))
        .setAttribute("ROTATION", doc.createAccessor().setType("VEC4").setArray(R).setBuffer(buf))
        .setAttribute("SCALE", doc.createAccessor().setType("VEC3").setArray(S).setBuffer(buf));
      scene.addChild(doc.createNode(mesh.getName() + "_box_inst").setMesh(doc.createMesh(mesh.getName() + "_box").addPrimitive(bp))
        .setExtension("EXT_mesh_gpu_instancing", batch).setExtras({ ...e, instanced: m }));
      stats.boxes += m; stats.left += keepTris.length; stats.batches++;
      if (keepTris.length) { const ni = new Uint32Array(keepTris.length * 3); keepTris.forEach((t, k) => ni.set([idx[t], idx[t + 1], idx[t + 2]], k * 3)); p.getIndices().setArray(ni); compactPrimitive(p); }
      else { mesh.removePrimitive(p); p.dispose(); }
    }
    if (!mesh.listPrimitives().length) node.setMesh(null);
  }
  return stats;
}

// Download size (round 14 of IMPROVEMENT_LOG.md): the UVs are in metres (07_uv box projection), outside [0, 1], so
// quantize() left them as 32-bit floats - 7.5 MB, the biggest attribute. Every textured material's UVs are mapped
// with one fixed rule, uv' = (uv + 128) / 256, and its textures get the inverse KHR_texture_transform (offset -128,
// scale 256): the texture lands exactly where it did, and 16-bit storage is ~4 mm in texture space. The same rule
// everywhere keeps materials identical across levels (the site shares them by name). Primitives whose material has no
// texture don't need UVs at all. The style rooms (06s) keep their metre UVs (js/roomstyle.js tiles its procedural
// textures by them): where they share a material with the rest, they get a raw copy named <name>__raw.
const UV_OFF = -128, UV_SCALE = 256;
function packUVs(doc) {
  const root = doc.getRoot(), ext = doc.createExtension(KHRTextureTransform);
  const styleMeshes = new Set();
  for (const n of root.listNodes()) if (n.getExtras().style_room && n.getMesh()) styleMeshes.add(n.getMesh());
  const infos = (m) => [m.getBaseColorTextureInfo(), m.getNormalTextureInfo(), m.getMetallicRoughnessTextureInfo(), m.getOcclusionTextureInfo(), m.getEmissiveTextureInfo()]
    .filter((ti, i) => ti && [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getOcclusionTexture(), m.getEmissiveTexture()][i]);
  // 1. style-room primitives get a raw copy of a material that the rest of the building also uses
  const otherUse = new Set();
  for (const me of root.listMeshes()) if (!styleMeshes.has(me)) for (const p of me.listPrimitives()) if (p.getMaterial()) otherUse.add(p.getMaterial());
  const raw = new Map();
  for (const me of styleMeshes) for (const p of me.listPrimitives()) {
    const m = p.getMaterial(); if (!m || !otherUse.has(m) || !infos(m).length) continue; // (untextured: UVs irrelevant)
    if (!raw.has(m)) raw.set(m, m.clone().setName(m.getName() + "__raw"));
    p.setMaterial(raw.get(m));
  }
  // 2. everything else: textured -> packed UVs + texture transform; untextured -> no UVs
  const transformed = new Set(); let packed = 0, dropped = 0;
  for (const me of root.listMeshes()) {
    if (styleMeshes.has(me)) continue;
    for (const p of me.listPrimitives()) {
      const m = p.getMaterial(), uv = p.getAttribute("TEXCOORD_0");
      if (!m || !uv) continue;
      if (!infos(m).length) { p.setAttribute("TEXCOORD_0", null); dropped += uv.getCount(); continue; }
      const a = uv.clone(), el = [0, 0];
      for (let i = 0; i < a.getCount(); i++) { a.getElement(i, el); a.setElement(i, [(el[0] - UV_OFF) / UV_SCALE, (el[1] - UV_OFF) / UV_SCALE]); }
      p.setAttribute("TEXCOORD_0", a); packed += a.getCount();
      if (!transformed.has(m)) {
        transformed.add(m);
        for (const ti of infos(m)) ti.setExtension("KHR_texture_transform", ext.createTransform().setOffset([UV_OFF, UV_OFF]).setScale([UV_SCALE, UV_SCALE]));
      }
    }
  }
  return { packed, dropped, raw: raw.size };
}

const BUILDING = new Set(["shell", "stair", "railing", "doorframe"]);
const STYLE_KEEP = new Set(["curtain", "lamp"]); // style-room parts the website moves / picks one by one
function mergeLevel(doc, man) {
  const root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  const inDoor = (n) => { for (let p = n; p; p = p.getParentNode?.()) if (p.getExtras().kind === "door") return true; return false; };
  const groups = new Map();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(), e = node.getExtras();
    if (!mesh || node.listChildren().length || node.getExtension("EXT_mesh_gpu_instancing") || e.kind === "tv" || e.tv || inDoor(node) || man[e.lm_set] || (e.style_room && STYLE_KEEP.has(e.kind))) continue;
    // style rooms (06s): merged too, but only within one room and one surface (js/roomstyle.js restyles them per room);
    // what moves or is picked on its own (curtains, lamps) stays a separate node
    const sk = e.style_room ? [e.style_room, e.surface ?? "", e.kind === "bed" ? "bed" : ""].join("/") : "";
    const cls = e.kind === "ceiling" ? "ceiling" : BUILDING.has(e.kind) ? "building" : "furniture";
    const w = node.getWorldMatrix();
    const det = w[0] * (w[5] * w[10] - w[6] * w[9]) - w[1] * (w[4] * w[10] - w[6] * w[8]) + w[2] * (w[4] * w[9] - w[5] * w[8]);
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 || !prim.getIndices()) continue;   // triangles with indices (weld() made them indexed)
      const sem = prim.listSemantics().sort().join(",");
      const key = [prim.getMaterial()?.getName() ?? "-", cls, !!e.bathroom, !!e.collide, sem, sk].join("|");
      if (!groups.has(key)) groups.set(key, { cls, e, items: [] });
      groups.get(key).items.push({ node, prim, w, det });
    }
  }
  let before = 0, after = 0;
  const done = new Map();   // node -> its primitives that went into a merged mesh
  for (const [key, g] of groups) {
    before += g.items.length;
    if (g.items.length < 2) { after += 1; continue; }
    // world-space copies of every primitive (accessors copied, so shared furniture meshes are left untouched)
    const parts = g.items.map(({ prim, w, det }) => {
      const p = prim.clone();
      for (const s of p.listSemantics()) p.setAttribute(s, p.getAttribute(s).clone());
      const idx = p.getIndices().clone(); p.setIndices(idx);
      transformPrimitive(p, w);
      if (det < 0) { const a = idx.getArray(); for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } idx.setArray(a); }
      return p;
    });
    const joined = joinPrimitives(parts);
    for (const p of parts) { for (const s of p.listSemantics()) p.getAttribute(s).dispose(); p.getIndices().dispose(); p.dispose(); }
    const mesh = doc.createMesh(key.split("|").slice(0, 2).join("_")).addPrimitive(joined);
    const kind = g.cls === "ceiling" ? "ceiling" : g.cls === "building" ? (g.e.kind || "shell") : "furniture";
    const node = doc.createNode(mesh.getName()).setMesh(mesh)
      .setExtras({ kind: g.e.style_room && g.e.kind === "bed" ? "bed" : kind, level: g.e.level, bathroom: !!g.e.bathroom, collide: !!g.e.collide, merged: g.items.length,
        ...(g.e.style_room ? { style_room: g.e.style_room, ...(g.e.surface ? { surface: g.e.surface } : {}) } : {}) });
    scene.addChild(node);
    for (const it of g.items) { if (!done.has(it.node)) done.set(it.node, new Set()); done.get(it.node).add(it.prim); }
    after += 1;
  }
  // a node whose primitives all went into merged meshes is removed; one with some left gets its own mesh holding just
  // those (meshes can be shared by several copies, so the shared mesh itself is never edited)
  for (const [n, merged] of done) {
    const m = n.getMesh(), rest = m.listPrimitives().filter((p) => !merged.has(p));
    if (!rest.length) { n.dispose(); continue; }
    const own = doc.createMesh(m.getName()); for (const p of rest) own.addPrimitive(p); n.setMesh(own);
  }
  return { before, after };
}

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const sizes = [];
// lightmap sets that were baked (their meshes keep their own node: lightmap UVs + their own lightmap)
const LM_MAN = existsSync(join(OUT, "lightmaps.json")) ? JSON.parse(readFileSync(join(OUT, "lightmaps.json"), "utf8")) : {};
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
  const ig = instanceHeavy(doc);
  console.log(`${L}: ${ig.nodesIn} furniture copies -> ${ig.batches} GPU-instanced meshes`);
  const mg = mergeLevel(doc, LM_MAN);
  // (round 7 of IMPROVEMENT_LOG.md) the facade's timber battens and the metal railings are thin elements repeated
  // hundreds of times; most of their triangles are the 8 mm edge bevels (03_cleanup), invisible at viewing distance.
  // Only these two materials are simplified, with an error bound of ~8 mm (converted to the mesh's own size) and
  // locked borders (battens: unlocked - each slat face is its own piece, so locked borders would freeze every edge;
  // the error bound still keeps every slat in place within ~8 mm). Never furniture, doors or the style rooms.
  const THIN = /^M_(teak_batten|metal_dark)$/;
  let thBefore = 0, thAfter = 0;
  await MeshoptSimplifier.ready;
  for (const n of doc.getRoot().listNodes()) {
    const e = n.getExtras(), m = n.getMesh();
    if (!m || e.style_room || e.kind === "door" || !["shell", "railing"].includes(e.kind)) continue;
    for (const p of m.listPrimitives()) {
      if (!p.getIndices() || !THIN.test(p.getMaterial()?.getName() ?? "")) continue;
      const pos = p.getAttribute("POSITION"), mn = pos.getMin([]), mx = pos.getMax([]);
      const radius = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
      thBefore += p.getIndices().getCount() / 3;
      simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: 0, error: Math.min(0.01, 0.008 / Math.max(radius, 0.01)), lockBorder: !/batten/.test(p.getMaterial().getName()) });
      thAfter += p.getIndices().getCount() / 3;
    }
  }
  console.log(`${L}: battens + railings ${thBefore} -> ${thAfter} triangles`);
  const bx = instanceBoxes(doc);
  if (bx.batches) console.log(`${L}: ${bx.boxes} batten boxes -> ${bx.batches} GPU-instanced box (${bx.left} triangles left as they were)`);
  // Door leaves turn about their node's origin (the hinge, tools/blender/04_join.py). quantize() below moves a mesh
  // node's origin / scale to fit its quantized positions, which put the pivot in the middle of every leaf (doors
  // spun on their centre). The leaf node keeps the hinge and its extras as a parent; the mesh moves to a child node,
  // which quantize may adjust freely.
  let nPivots = 0;
  for (const n of doc.getRoot().listNodes()) {
    if (n.getExtras().kind !== "door" || !n.getMesh() || n.listChildren().length) continue;
    const child = doc.createNode(n.getName() + "_mesh").setMesh(n.getMesh());
    n.setMesh(null).addChild(child); nPivots++;
  }
  await doc.transform(prune({ keepAttributes: true }));
  console.log(`${L}: merged ${mg.before} furniture / building primitives into ${mg.after}`);
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
    const isColour = slot === "baseColorTexture" || slot === "emissiveTexture";
    const opts = { normal: slot === "normalTexture", srgb: isColour,
      half: slot === "metallicRoughnessTexture" || slot === "occlusionTexture" || (isColour && !FULL_SIZE.test(key.toLowerCase())) };
    toktx(src, dst, opts);
    // (round 13 of IMPROVEMENT_LOG.md) a half-size set for phones, same names in data/levels/tex_m/ - the site swaps the
    // folder when it runs on a phone (js/main.js); KTX2 doesn't compress any further on the wire, so this is ~40 % of a
    // phone's download
    toktx(src, join(OUT, "tex_m", key + ".ktx2"), { ...opts, mobile: true });
    tex.setImage(readFileSync(dst)).setMimeType("image/ktx2").setURI("tex/" + key + ".ktx2");
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const uvs = packUVs(doc);
  console.log(`${L}: UVs packed for ${uvs.packed} vertices, dropped for ${uvs.dropped} (untextured), ${uvs.raw} raw style-room materials`);
  await doc.transform(prune({ keepAttributes: true }), reorder({ encoder: MeshoptEncoder }), quantize({ quantizeTexcoord: 16 }));
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
