// Dev tool: compare two raw RGBA screen captures (saved by the in-browser __snap helper) of the same camera view.
// node tools/compare-shots.mjs <a.rgba> <b.rgba> <out.png>
// Both are resampled to 480 px wide; prints mean difference and writes [A | B | difference ×4] as a PNG.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const [fa, fb, out] = process.argv.slice(2);
const load = (f) => { const [w, h] = f.match(/_(\d+)x(\d+)\.rgba$/).slice(1).map(Number); return { w, h, d: readFileSync(f) }; };
let A = load(fa), B = load(fb);
// optional crop (same pixel rectangle of both, sizes must match): CROP=x,y,w,h
if (process.env.CROP) {
  const [cx, cy, cw, ch] = process.env.CROP.split(",").map(Number);
  const crop = (img) => { const d = Buffer.alloc(cw * ch * 4); for (let y = 0; y < ch; y++) img.d.copy(d, y * cw * 4, ((cy + y) * img.w + cx) * 4, ((cy + y) * img.w + cx + cw) * 4); return { w: cw, h: ch, d }; };
  A = crop(A); B = crop(B);
}
const W = 480, H = Math.round((W * A.h) / A.w);
function resample(img) { // box filter (area average)
  const o = new Float32Array(W * H * 3), sx = img.w / W, sy = img.h / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
      const i = (yy * img.w + xx) * 4; r += img.d[i]; g += img.d[i + 1]; b += img.d[i + 2]; n++;
    }
    const o3 = (y * W + x) * 3; o[o3] = r / n; o[o3 + 1] = g / n; o[o3 + 2] = b / n;
  }
  return o;
}
const a = resample(A), b = resample(B);
let sum = 0, big = 0; const mean = [0, 0, 0], meanB = [0, 0, 0];
for (let i = 0; i < a.length; i += 3) {
  const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
  sum += d; if (d > 12) big++;
  for (let c = 0; c < 3; c++) { mean[c] += a[i + c]; meanB[c] += b[i + c]; }
}
const px = a.length / 3;
console.log(JSON.stringify({ meanAbsDiff: +(sum / px).toFixed(2), pctPixelsOver12: +((100 * big) / px).toFixed(2),
  meanA: mean.map((v) => +(v / px).toFixed(1)), meanB: meanB.map((v) => +(v / px).toFixed(1)) }));

// PNG: [A | B | |A-B|×4]
const OW = W * 3, rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + OW * 3);
  for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    const i = (y * W + x) * 3 + c;
    row[1 + x * 3 + c] = a[i]; row[1 + (W + x) * 3 + c] = b[i];
    row[1 + (2 * W + x) * 3 + c] = Math.min(255, Math.abs(a[i] - b[i]) * 4);
  }
  rows.push(row);
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(OW, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
