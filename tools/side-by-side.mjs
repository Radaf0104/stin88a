// DEV TOOL: pairs every "<pin>_<stage>.png" in a folder with images/renders/<pin>.jpg and writes
// "<pin>_<stage>_vs_render.jpg" (render | reference, same height, labelled).
//   node tools/side-by-side.mjs source/compare/phase2
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "package.json"));
const sharp = require("sharp");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, process.argv[2] ?? "source/compare/phase2");
const label = (text, w) => Buffer.from(`<svg width="${w}" height="34"><rect width="100%" height="100%" fill="#000" opacity="0.55"/>
  <text x="12" y="23" font-family="Arial" font-size="18" fill="#fff">${text}</text></svg>`);
for (const f of readdirSync(dir).filter((f) => /^r\d\d_.+\.png$/.test(f))) {
  const pin = f.slice(0, 3), ref = join(root, "images/renders", pin + ".jpg");
  if (!existsSync(ref)) continue;
  const a = sharp(join(dir, f)), { width: wa, height: h } = await a.metadata();
  const b = await sharp(ref).resize({ height: h }).toBuffer(), { width: wb } = await sharp(b).metadata();
  const out = join(dir, f.replace(/\.png$/, "_vs_render.jpg"));
  await sharp({ create: { width: wa + wb, height: h, channels: 3, background: "#fff" } })
    .composite([{ input: await a.toBuffer(), left: 0, top: 0 }, { input: b, left: wa, top: 0 },
      { input: label("Blender check: " + f.replace(".png", ""), wa), left: 0, top: 0 }, { input: label("Unreal render " + pin, wb), left: wa, top: 0 }])
    .jpeg({ quality: 86 }).toFile(out);
  console.log("wrote", out);
}
