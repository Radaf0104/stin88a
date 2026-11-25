// DEV TOOL (not uploaded). Paste/import in the browser console of the running site to get the scorecard used in AUDIT.md:
//   const b = await import('/tools/bench.js?' + Date.now()); await b.scorecard()
// Same camera, same canvas size handling, medians of 7×20 frames (GPU synced with readPixels).
export async function scorecard() {
  await new Promise((r) => { const c = () => (window.STIN ? r() : setTimeout(c, 200)); c(); });
  const S = window.STIN, { renderer, scene, camera, composer, gtao, controls } = S;
  if (!document.getElementById("hero").classList.contains("gone")) { document.getElementById("heroExplore").click(); await new Promise((r) => setTimeout(r, 2800)); }
  controls.enableDamping = false; controls.target.set(0, 5, 0); camera.position.set(38, 22, 42); controls.update(); camera.updateMatrixWorld();
  await new Promise((r) => setTimeout(r, 800));
  // fixed 1280×720 render size for both versions (the live page lowers its own resolution when it runs slowly)
  renderer.setPixelRatio(1); renderer.setSize(1280, 720, false); camera.aspect = 1280 / 720; camera.updateProjectionMatrix();
  composer?.setPixelRatio(1); composer?.setSize(1280, 720);
  const gl = renderer.getContext(), px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const med = (a) => +a.sort((x, y) => x - y)[a.length >> 1].toFixed(2);
  const bench = (fn) => { const out = []; for (let r = 0; r < 7; r++) { for (let i = 0; i < 3; i++) fn(); sync(); const t0 = performance.now(); for (let i = 0; i < 20; i++) fn(); sync(); out.push((performance.now() - t0) / 20); } return med(out); };
  const wasAO = gtao?.enabled;
  if (gtao) gtao.enabled = false;
  const moving = composer ? bench(() => composer.render(0.016)) : bench(() => renderer.render(scene, camera));
  renderer.info.autoReset = false; renderer.info.reset(); composer ? composer.render(0.016) : renderer.render(scene, camera);
  const callsMoving = renderer.info.render.calls, trisMoving = renderer.info.render.triangles;
  let still = null, callsStill = null;
  if (gtao) { gtao.enabled = true; still = bench(() => composer.render(0.016)); renderer.info.reset(); composer.render(0.016); callsStill = renderer.info.render.calls; gtao.enabled = wasAO; }
  renderer.info.autoReset = true;
  let meshes = 0, inst = 0, instances = 0, tris = 0, casters = 0, lights = 0, phys = 0, dbl = 0;
  const mats = new Set();
  scene.traverse((o) => {
    if (o.isLight) lights++;
    if (!o.isMesh) return;
    meshes++; if (o.isInstancedMesh) { inst++; instances += o.count; }
    const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    tris += o.isInstancedMesh ? n * o.count : n;
    if (o.castShadow) casters++;
    const m = o.material; if (!mats.has(m)) { mats.add(m); if (m.isMeshPhysicalMaterial) phys++; if (m.side === 2) dbl++; }
  });
  const res = performance.getEntriesByType("resource");
  return {
    canvas: [renderer.domElement.width, renderer.domElement.height], startup: S.timings,
    frameMs: { moving, stillWithAO: still }, drawCalls: { moving: callsMoving, stillWithAO: callsStill }, trianglesDrawnMoving: trisMoving,
    meshes, instancedMeshes: inst, instances, sceneTriangles: tris, materials: mats.size, physical: phys, doubleSided: dbl,
    lights, shadowCasters: casters, gpu: { ...renderer.info.memory, programs: renderer.info.programs.length },
    jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    downloadedMB: +(res.reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0) / 1048576).toFixed(2), requests: res.length,
  };
}
