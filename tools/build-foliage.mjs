// (M5) KTX2 textures for the trees and the lawn, from the CC0 sources (ASSETS_LICENSES.md):
//   leaf clusters  tools/out/cc0src/leaf_cluster_atlas.png  (composited in the browser from ambientCG LeafSet005: two
//                  512 px cards of leaves on thin twigs, with alpha)
//   bark           Poly Haven bark_brown_02 (diff + OpenGL normal)
//   lawn           ambientCG Grass004 (colour + OpenGL normal)
// Desktop -> data/levels/tex/, phones (half size) -> data/levels/tex_m/.
//   node tools/build-foliage.mjs        (needs toktx from KTX-Software, like pack-levels.mjs)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "tools/out/cc0src");
const TOKTX = existsSync(join(process.env.LOCALAPPDATA ?? "", "Programs/KTX-Software/bin/toktx.exe"))
  ? join(process.env.LOCALAPPDATA, "Programs/KTX-Software/bin/toktx.exe") : "toktx";

const JOBS = [
  // name, source, kind, desktop size, phone size
  ["foliage_leaves", "leaf_cluster_atlas.png", "alpha", "1024x512", "512x256"],
  ["foliage_bark", "bark_brown_02_diff_1k.jpg", "color", "512x512", "256x256"],
  ["foliage_bark_nor", "bark_brown_02_nor_gl_1k.jpg", "normal", "256x256", "128x128"],
  ["lawn_grass", "Grass004_1K-JPG_Color.jpg", "color", "512x512", "256x256"],
  ["lawn_grass_nor", "Grass004_1K-JPG_NormalGL.jpg", "normal", "512x512", "256x256"],
];
for (const set of ["tex", "tex_m"]) mkdirSync(join(root, "data/levels", set), { recursive: true });
for (const [name, file, kind, big, small] of JOBS) {
  for (const [set, size] of [["tex", big], ["tex_m", small]]) {
    const src = join(SRC, file), dst = join(root, "data/levels", set, name + ".ktx2");
    const args = ["--t2", "--genmipmap", "--assign_oetf", kind === "normal" ? "linear" : "srgb", "--resize", size];
    // leaves: UASTC keeps the cut-out edges clean (ETC1S smears the alpha); normals: UASTC + RDO; colour: ETC1S
    if (kind === "alpha" || kind === "normal") args.push("--encode", "uastc", "--uastc_quality", "2", "--uastc_rdo_l", "3", "--zcmp", "18");
    else args.push("--encode", "etc1s", "--clevel", "4", "--qlevel", "160");
    for (let attempt = 1; ; attempt++) {
      try { execFileSync(TOKTX, [...args, dst, src], { stdio: "pipe" }); break; }
      catch (e) {
        if (attempt >= 4) throw new Error("toktx failed for " + src + ": " + (e.stderr?.toString() || e.message));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt);
      }
    }
    console.log(set.padEnd(6), name.padEnd(18), (statSync(dst).size / 1024).toFixed(0) + " KB");
  }
}
