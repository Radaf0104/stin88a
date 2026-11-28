// RAM budget (marketing traffic: iPhone Safari / in-app browsers, 250-300 MB): where the page's memory goes.
// Dev tool, in the page:  (await import("/tools/mem-estimate.js")).estimate()
// GPU sizes are estimates from the data three.js holds (compressed formats at their real size); "CPU copy" is data
// still held in JS after the upload (texture mipmaps / images, geometry arrays).
const MB = (b) => +(b / 1048576).toFixed(1);
export function estimate() {
  const S = window.STIN, T = S.THREE, r = S.renderer, gl = r.getContext?.();
  const tex = new Set(), geo = new Set(), rts = new Set();
  const addTex = (t) => { if (t?.isTexture) tex.add(t); };
  S.scene.traverse((o) => {
    if (o.geometry) geo.add(o.geometry);
    for (const m of [].concat(o.material ?? [])) for (const k in m) { const v = m[k]; if (v?.isTexture) addTex(v); }
    if (o.material?.uniforms) for (const u of Object.values(o.material.uniforms)) addTex(u?.value);
    if (o.isReflector) rts.add(o.getRenderTarget());
    if (o.isLight && o.shadow?.map) rts.add(o.shadow.map);
  });
  addTex(S.scene.background); addTex(S.scene.environment);
  let texGPU = 0, texCPU = 0, nTex = 0;
  for (const t of tex) {
    nTex++;
    if (t.isCompressedTexture || t.mipmaps?.[0]?.data) {
      const b = (t.mipmaps ?? []).reduce((a, m) => a + (m.data?.byteLength ?? 0), 0);
      texCPU += b; texGPU += b || (t.image?.width ?? 0) * (t.image?.height ?? 0) * 1.33;
    } else {
      const im = t.image, w = im?.width ?? im?.videoWidth ?? 0, h = im?.height ?? 0, d = im?.depth ?? 1;
      const bpp = t.type === T.FloatType ? 16 : t.type === T.HalfFloatType ? 8 : 4;
      const g = w * h * d * bpp * (t.generateMipmaps ? 1.33 : 1); texGPU += g * (t.isCubeTexture ? 6 : 1);
      if (im && (im.data || im instanceof ImageBitmap || im instanceof HTMLImageElement || im instanceof HTMLCanvasElement)) texCPU += im.data?.byteLength ?? w * h * 4;
    }
  }
  let geoB = 0;
  for (const g of geo) { for (const a of Object.values(g.attributes)) geoB += a.array?.byteLength ?? 0; geoB += g.index?.array?.byteLength ?? 0; }
  const cw = r.domElement.width, ch = r.domElement.height, samples = gl?.getContextAttributes?.().antialias ? 4 : 0;
  const drawBuf = cw * ch * 8 * (1 + samples); // colour + depth/stencil, and the MSAA buffers
  let rtB = 0; for (const t of rts) if (t) rtB += t.width * t.height * 8;
  const imgs = [...document.images].filter((i) => i.complete && i.naturalWidth && getComputedStyle(i).display !== "none" && !i.closest(".hidden"))
    .reduce((a, i) => a + i.naturalWidth * i.naturalHeight * 4, 0);
  const tt = window.__tt ? "(turntable frames: decoded on demand by the browser)" : "";
  const heap = performance.memory?.usedJSHeapSize ?? 0;
  const out = { textures: nTex, texGPU_MB: MB(texGPU), texCPUcopy_MB: MB(texCPU), geometry_MB: MB(geoB), geometryGPU_MB: MB(geoB),
    drawingBuffer_MB: MB(drawBuf), renderTargets_MB: MB(rtB), decodedImages_MB: MB(imgs), jsHeap_MB: MB(heap), jsHeapPeak_MB: window.__mem ? MB(window.__mem.peak) : null,
    jsHeapPeakAt_ms: window.__mem?.peakAt ?? null, info: r.info?.memory, note: tt };
  out.total_est_MB = +(out.texGPU_MB + out.texCPUcopy_MB + out.geometry_MB * 2 + out.drawingBuffer_MB + out.renderTargets_MB + out.decodedImages_MB + out.jsHeap_MB).toFixed(1);
  return out;
}
