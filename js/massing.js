// Massing: plain white boxes for the planned buildings on the masterplan pads (boarding house on pads 1-2, parking
// building on pads 3-4). Footprints come from data/massing.json (tools/build-massing.mjs, from the site plan export),
// in the building frame with Revit axes - the same frame as the site plan, so the group sits inside the site plan group.
// Each box is one extruded footprint with a flat roof (a few dozen triangles), one shared matte white material, thin
// floor lines so the storeys read, and a floating label with its use.
import * as THREE from "three";

// labels: floating name tags ("Boarding house" / "Parking building") - off since the client asked to remove them (2026-11-26)
export async function createMassing({ parent, url = "data/massing.json", labels = false, occludeIds = ["p1"] }) {
  const group = new THREE.Group();
  group.name = "massing";
  parent.add(group);
  const items = [];
  let data;
  try { data = await fetch(url).then((r) => (r.ok ? r.json() : null)); } catch { data = null; }
  if (!data?.items?.length) return { group, items, setVisible() {}, updateLabels() {}, setLang() {}, updateOcclusion() { return false; } };

  const wall = new THREE.MeshStandardMaterial({ color: 0xf7f5f1, roughness: 0.92, metalness: 0 });
  const line = new THREE.LineBasicMaterial({ color: 0xb9b4ac, transparent: true, opacity: 0.55 });
  const toThree = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // Revit (x, y, z up) -> three (x, z, -y)
  for (const it of data.items) {
    const fp = it.footprint;
    if (!fp || fp.length < 3) continue;
    const shape = new THREE.Shape(fp.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: it.height, bevelEnabled: false, steps: 1 }).applyMatrix4(toThree);
    geo.translate(0, it.base - 0.05, 0); // a hair into the pad: no gap at the base
    const mesh = new THREE.Mesh(geo, wall);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { kind: "massing", use: it.use, id: it.id };
    group.add(mesh);
    // storey lines: one closed outline per floor level (the roof edge included)
    const floors = Math.max(1, it.floors ?? 1), pts = [];
    for (let f = 1; f <= floors; f++) {
      const y = it.base + (it.height * f) / floors;
      for (let k = 0; k < fp.length; k++) {
        const [ax, ay] = fp[k], [bx, by] = fp[(k + 1) % fp.length];
        pts.push(ax, y + 0.01, -ay, bx, y + 0.01, -by);
      }
    }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)), line);
    group.add(lines);
    // label anchor: footprint centroid, just above the roof
    let cx = 0, cy = 0;
    for (const [x, y] of fp) { cx += x; cy += y; }
    const anchor = new THREE.Vector3(cx / fp.length, it.base + it.height + 1.2, -cy / fp.length);
    let el = null;
    if (labels) { el = document.createElement("div"); el.className = "massing-label " + it.use; document.body.appendChild(el); }
    items.push({ it, mesh, lines, anchor, el });
  }

  let visible = true;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  // Boxes that step aside when they stand between the camera and the main building (client, 2026-11-26: only the
  // boarding house right next to it, pad 1). Cheap test, run before each drawn frame: rays from the camera to 6 points
  // on the building's box; if 2 or more pass through the massing box's bounds (or the camera is inside them), it hides.
  const occluders = items.filter((m) => occludeIds.includes(m.it.id)).map((m) => ({ m, box: new THREE.Box3(), hidden: false }));
  const ray = new THREE.Ray(), hit = new THREE.Vector3(), samples = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());
  return {
    group, items,
    // returns true when a box was hidden or shown this frame (the caller re-renders the sun's shadow map)
    updateOcclusion(camera, buildingBox) {
      if (!occluders.length || !visible || !buildingBox) return false;
      const b = buildingBox, c = b.getCenter(w), mid = b.min.y + (b.max.y - b.min.y) * 0.45;
      samples[0].copy(c); samples[1].set(c.x, b.max.y - 1, c.z);
      samples[2].set(b.min.x + (b.max.x - b.min.x) * 0.25, mid, b.min.z + (b.max.z - b.min.z) * 0.25);
      samples[3].set(b.min.x + (b.max.x - b.min.x) * 0.75, mid, b.min.z + (b.max.z - b.min.z) * 0.25);
      samples[4].set(b.min.x + (b.max.x - b.min.x) * 0.25, mid, b.min.z + (b.max.z - b.min.z) * 0.75);
      samples[5].set(b.min.x + (b.max.x - b.min.x) * 0.75, mid, b.min.z + (b.max.z - b.min.z) * 0.75);
      let changed = false;
      for (const o of occluders) {
        if (o.box.isEmpty()) o.box.setFromObject(o.m.mesh); // static: measured once (world space)
        let blocked = o.box.containsPoint(camera.position) ? 99 : 0;
        for (const s of samples) {
          if (blocked >= 2) break;
          ray.origin.copy(camera.position); ray.direction.subVectors(s, camera.position);
          const d = ray.direction.length(); ray.direction.multiplyScalar(1 / d);
          if (ray.intersectBox(o.box, hit) && hit.distanceTo(camera.position) < d) blocked++;
        }
        const hide = blocked >= 2;
        if (hide !== o.hidden) { o.hidden = hide; o.m.mesh.visible = o.m.lines.visible = !hide; changed = true; }
      }
      return changed;
    },
    setVisible(on) { visible = on; group.visible = on; for (const m of items) m.el?.classList.toggle("hidden", !on); },
    setLang(lang) { for (const m of items) if (m.el) m.el.textContent = m.it.label?.[lang] ?? m.it.label?.en ?? m.it.use; },
    // called every drawn frame; show = labels allowed right now (overview, not walking)
    updateLabels(camera, show) {
      if (!labels) return;
      for (const m of items) {
        const on = visible && show;
        if (on) { m.mesh.getWorldPosition(w); v.copy(m.anchor).applyMatrix4(group.matrixWorld).project(camera); }
        const inView = on && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        m.el.style.display = inView ? "" : "none";
        if (!inView) continue;
        m.el.style.left = ((v.x + 1) / 2) * innerWidth + "px";
        m.el.style.top = ((1 - v.y) / 2) * innerHeight + "px";
      }
    },
  };
}
