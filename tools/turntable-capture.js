// Pre-rendered turntables (client, 2026-11-28: the "fake 3D" tip "can be implemented, especially during building
// overview and section overview"): renders 360° frame sets of the building overview and the level views from our own
// scene at the highest settings, plus each floor's / room's outline projected into every frame (the hotspots).
// Dev tool, run in the page on the local dev server (serve.mjs saves under tools/out/tt/):
//   const t = await import("/tools/turntable-capture.js"); await t.capture({ set: "overview-day", frames: 48 })
// then copy tools/out/tt/* to data/tt/ (js/turntable.js plays them; ?tt=1 for now).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function capture({ set, view = "overview", level = null, time = "day", frames = 48, w = 1600, h = 1000, ss = 2, q = 0.82 }) {
  const S = window.STIN, T = S.THREE, { renderer, camera, scene, controls } = S;
  // the view, as the site shows it (the camera flight finished at once)
  if (S.env.current !== time) { S.setTime(time); await sleep(1500); }
  S.selectFloor(view === "level" ? level : null);
  await sleep(3500);
  const target = controls.target.clone(), off = camera.position.clone().sub(target);
  // phones (portrait sets): the same framing the site uses for portrait screens (flyTo's fit)
  const fit = w < h ? Math.min(2.4, 1.2 / (w / h)) / Math.min(2.4, camera.aspect < 1 ? 1.2 / camera.aspect : 1) : 1;
  off.multiplyScalar(fit);
  const radius = Math.hypot(off.x, off.z), height = off.y, a0 = Math.atan2(off.z, off.x);
  // freeze the site's own loop while capturing (it would resize / re-render between our frames)
  const raf = window.requestAnimationFrame, queued = [];
  window.requestAnimationFrame = (cb) => { queued.push(cb); return 0; };
  const vols = []; scene.traverse((o) => { if (o.isMesh && o.userData?.unit && o.visible) vols.push(o); }); // the room status volumes (room + bathroom)
  for (const o of vols) o.visible = false; // (clean frames: the viewer draws its own hotspots)
  const pr = renderer.getPixelRatio(), size = renderer.getSize(new T.Vector2()), aspect = camera.aspect;
  const sun = scene.children.find((o) => o.isDirectionalLight && o.castShadow), mapSize = sun?.shadow.mapSize.x;
  if (sun) { sun.shadow.mapSize.setScalar(4096); sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.needsUpdate = true; }
  renderer.setPixelRatio(1); renderer.setSize(w * ss, h * ss, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const g = out.getContext("2d"); g.imageSmoothingQuality = "high";
  // hotspot shapes: floors (overview) = their band boxes; rooms (level) = their outlines on the floor
  const rp = S.levelObjects[0]; let root = rp; while (root.parent && root.parent !== scene) root = root.parent;
  const R = root.position, v = new T.Vector3();
  const spots = [];
  if (view === "overview") {
    for (const b of scene.children.filter((o) => o.userData?.floor !== undefined && o.isMesh)) {
      b.geometry.computeBoundingBox(); const bb = b.geometry.boundingBox.clone().applyMatrix4(b.matrixWorld);
      const pts = []; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) pts.push(new T.Vector3(x, y, z));
      spots.push({ id: "L" + b.userData.floor, kind: "floor", level: b.userData.floor, pts });
    }
  } else {
    for (const u of S.units.filter((u) => u.level === level)) {
      const y = S.levelY[level] + 0.05;
      spots.push({ id: u.label, kind: u.kind === "space" ? "space" : "unit", label: u.label, status: u.status ?? null,
        pts: u.outline.map(([x, py]) => new T.Vector3(x + R.x, y, -py + R.z)) });
    }
  }
  const polys = spots.map(() => []);
  for (let i = 0; i < frames; i++) {
    const a = a0 + (i / frames) * Math.PI * 2;
    camera.position.set(target.x + Math.cos(a) * radius, target.y + height, target.z + Math.sin(a) * radius);
    camera.lookAt(target); camera.updateMatrixWorld();
    S.prepFrame?.(); // (neighbour blocks in front of the building step aside, as in the live view)
    if (sun) sun.shadow.needsUpdate = true;
    S.renderScene();
    g.drawImage(renderer.domElement, 0, 0, w, h);
    const blob = await new Promise((r) => out.toBlob(r, "image/webp", q));
    await fetch(`/__save?path=tools/out/tt/${set}/${String(i).padStart(2, "0")}.webp`, { method: "POST", body: blob });
    spots.forEach((s, k) => {
      const p = s.pts.map((P) => { v.copy(P).project(camera); return [(v.x + 1) / 2, (1 - v.y) / 2]; });
      polys[k].push((s.kind === "floor" ? hull(p) : p).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]));
    });
  }
  const meta = { set, view, level, time, frames, w, h, a0, spots: spots.map((s, k) => ({ id: s.id, kind: s.kind, level: s.level ?? level, label: s.label ?? null, status: s.status ?? null, polys: polys[k] })) };
  await fetch(`/__save?path=tools/out/tt/${set}.json`, { method: "POST", body: JSON.stringify(meta) });
  // restore
  if (sun) { sun.shadow.mapSize.setScalar(mapSize); sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.needsUpdate = true; }
  renderer.setPixelRatio(pr); renderer.setSize(size.x, size.y, false); camera.aspect = aspect; camera.updateProjectionMatrix();
  for (const o of vols) o.visible = true;
  window.requestAnimationFrame = raf; for (const cb of queued) raf(cb);
  return { set, frames, spots: spots.length };
}
function hull(p) { // convex hull (monotone chain) of 2D points
  const s = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of s.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
