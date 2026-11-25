// DEV TOOL: halves a Radiance .hdr (RGBE) sky photo, 2048×1024 -> 1024×512, averaging 2×2 pixels in linear light
// (so the sun keeps its total energy), and writes it run-length encoded.
//   node tools/shrink-hdr.mjs assets/sky/autumn_field_puresky_2k.hdr assets/sky/autumn_field_puresky_1k.hdr
import { readFileSync, writeFileSync } from "node:fs";

const [src, dst] = process.argv.slice(2);
const buf = readFileSync(src);
// ---- header ----
let p = 0;
const line = () => { let s = ""; while (buf[p] !== 0x0a) s += String.fromCharCode(buf[p++]); p++; return s; };
const header = [];
for (let l = line(); l !== ""; l = line()) header.push(l);
const dims = line().match(/-Y (\d+) \+X (\d+)/);
if (!dims) throw new Error("unsupported orientation");
const H = +dims[1], W = +dims[2];
// ---- decode ----
const rgb = new Float32Array(W * H * 3);
const scan = new Uint8Array(W * 4);
for (let y = 0; y < H; y++) {
  if (buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === W) { // new-style RLE
    p += 4;
    for (let c = 0; c < 4; c++) for (let x = 0; x < W;) {
      let n = buf[p++];
      if (n > 128) { n -= 128; const v = buf[p++]; while (n--) scan[(x++) * 4 + c] = v; }
      else while (n--) scan[(x++) * 4 + c] = buf[p++];
    }
  } else { for (let i = 0; i < W * 4; i++) scan[i] = buf[p++]; } // flat
  for (let x = 0; x < W; x++) {
    const e = scan[x * 4 + 3], f = e ? Math.pow(2, e - 136) : 0, o = (y * W + x) * 3;
    rgb[o] = scan[x * 4] * f; rgb[o + 1] = scan[x * 4 + 1] * f; rgb[o + 2] = scan[x * 4 + 2] * f;
  }
}
// ---- 2×2 average ----
const w = W >> 1, h = H >> 1, out = new Float32Array(w * h * 3);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
  const a = ((2 * y) * W + 2 * x) * 3 + c, b = ((2 * y + 1) * W + 2 * x) * 3 + c;
  out[(y * w + x) * 3 + c] = (rgb[a] + rgb[a + 3] + rgb[b] + rgb[b + 3]) / 4;
}
// ---- encode (new-style RLE per scanline) ----
const chunks = [Buffer.from(header.join("\n") + "\n\n" + `-Y ${h} +X ${w}\n`, "latin1")];
const sl = new Uint8Array(w * 4);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3, m = Math.max(out[o], out[o + 1], out[o + 2]);
    if (m < 1e-32) { sl.fill(0, x * 4, x * 4 + 4); continue; }
    const e = Math.ceil(Math.log2(m)), k = 256 / Math.pow(2, e); // mantissa < 256
    sl[x * 4] = Math.min(255, Math.floor(out[o] * k)); sl[x * 4 + 1] = Math.min(255, Math.floor(out[o + 1] * k));
    sl[x * 4 + 2] = Math.min(255, Math.floor(out[o + 2] * k)); sl[x * 4 + 3] = e + 128;
  }
  const bytes = [2, 2, w >> 8, w & 255];
  for (let c = 0; c < 4; c++) {
    let x = 0;
    while (x < w) {
      let run = 1; while (x + run < w && run < 127 && sl[(x + run) * 4 + c] === sl[x * 4 + c]) run++;
      if (run >= 3) { bytes.push(128 + run, sl[x * 4 + c]); x += run; continue; }
      const start = x; let n = 0;
      while (x < w && n < 128) {
        let r2 = 1; while (x + r2 < w && r2 < 3 && sl[(x + r2) * 4 + c] === sl[x * 4 + c]) r2++;
        if (r2 >= 3) break;
        x++; n++;
      }
      bytes.push(n); for (let i = start; i < start + n; i++) bytes.push(sl[i * 4 + c]);
    }
  }
  chunks.push(Buffer.from(bytes));
}
const res = Buffer.concat(chunks);
writeFileSync(dst, res);
console.log(`${src} ${W}×${H} ${(buf.length / 1048576).toFixed(2)} MB -> ${dst} ${w}×${h} ${(res.length / 1048576).toFixed(2)} MB`);
