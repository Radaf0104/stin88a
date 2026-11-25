// DEV TOOL (not uploaded). Re-encodes the photo textures as WebP (much smaller than the original JPGs) and measures each
// one's average colour (used as the placeholder while the real texture is still downloading). Run in the browser console
// of the local site (node serve.mjs):
//   const m = await import('/tools/encode-textures.js?' + Date.now()); console.table(await m.encodeAll());
// Results land in tools/out/tex/ (copy them to assets/tex/ and assets/models/fern_02/textures/).
const JOBS = [
  // [source, output name, size (px, square), quality]
  ...["white_plaster_02", "oak_veneer_01", "concrete_floor_worn_001", "marble_01", "asphalt_02"].flatMap((id) => [
    [`assets/tex/${id}_diff.jpg`, `${id}_diff.webp`, 1024, 0.8],
    [`assets/tex/${id}_nor.jpg`, `${id}_nor.webp`, 1024, 0.85],
    [`assets/tex/${id}_rough.jpg`, `${id}_rough.webp`, 512, 0.8],
  ]),
  ["assets/tex/leafy_grass_nor.jpg", "leafy_grass_nor.webp", 1024, 0.85],
  ["assets/models/fern_02/textures/fern_02_diff_1k.jpg", "fern_02_diff.webp", 512, 0.85],
  ["assets/models/fern_02/textures/fern_02_nor_gl_1k.jpg", "fern_02_nor_gl.webp", 512, 0.85],
  ["assets/models/fern_02/textures/fern_02_arm_1k.jpg", "fern_02_arm.webp", 512, 0.85],
];

export async function encodeAll() {
  const rows = [];
  for (const [src, out, size, q] of JOBS) {
    const blob = await (await fetch("/" + src)).blob();
    // no colour management: normal / roughness maps are data, not colours
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const c = document.createElement("canvas"); c.width = c.height = size;
    const g = c.getContext("2d", { colorSpace: "srgb" });
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, size, size);
    const d = g.getImageData(0, 0, size, size).data;
    let r = 0, gg = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; a += d[i + 3]; }
    const n = d.length / 4;
    const webp = await new Promise((res) => c.toBlob(res, "image/webp", q));
    const s = await fetch("/__save?path=" + encodeURIComponent("tools/out/tex/" + out), { method: "POST", body: webp });
    rows.push({ out, srcKB: Math.round(blob.size / 1024), webpKB: Math.round(webp.size / 1024), size: `${bmp.width}→${size}`,
      avg: [r, gg, b].map((v) => Math.round(v / n)).join(","), alpha: Math.round(a / n), saved: s.ok });
  }
  return rows;
}
