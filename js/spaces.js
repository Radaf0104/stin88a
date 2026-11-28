// Spaces and doors for walking room by room.
// A "space" is one place you can stand in: a rental room (with its bathroom and balcony), a floor's corridor, or the
// Level 1 communal area. Only the space you are in is drawn (see isolate.js); everything else is white.
// Doors are found in the Revit geometry: each door is separated into its frame (stays in the wall) and its leaf, which
// gets its own small mesh so it can swing (or slide, for glass balcony doors).
//   - entrance doors (room <-> corridor) open when clicked; the space behind is loaded, and once you have walked
//     through, the door closes and the space you left is unloaded
//   - doors inside a room (bathroom, balcony) open by themselves when you come close
//   - every other door (outside, the private villa, ...) stays shut
// Coordinates: Revit plan (x, y) -> world (x + root.x, -y + root.z). Door geometry lives in the building meshes, which
// are children of `root`.
import * as THREE from "three";

// Revit plan rectangles of the stair core and the lift next to it (same on every floor)
const STAIR = [1.0, -3.25, 3.25, 1.15], LIFT = [1.25, 2.55, 2.55, 3.95]; // x0, y0, x1, y1
const rectPoly = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export function inPoly(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
// Sutherland–Hodgman: keep the part of a (possibly non-convex) polygon with x >= x0 (Revit plan coords)
function clipX(poly, x0) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ia = a[0] >= x0, ib = b[0] >= x0;
    if (ia) out.push(a);
    if (ia !== ib) { const k = (x0 - a[0]) / (b[0] - a[0]); out.push([x0, a[1] + (b[1] - a[1]) * k]); }
  }
  return out;
}

// probe(origin, dir, min, max): distance to the first solid surface along a ray (or null), used to find balcony railings
export function createSpaces({ model, units, levelY, root, buildingBox, doorChunks, doorLeaves = null, probe = null }) {
  const rp = root.position;
  const W = ([x, y]) => [x + rp.x, -y + rp.z]; // Revit plan -> world x, z
  const toW = (poly) => poly.map(W);
  const spaces = [];

  // ---- rental rooms: room + bathroom (+ balcony, added below once its door is found) ----
  for (const u of units) {
    if (u.kind === "space") continue;
    const polys = [toW(u.outline)];
    if (u.bath) polys.push(toW(u.bath.outline));
    spaces.push({ id: "u" + u.id, kind: "unit", unit: u, level: u.level, walk: polys, mask: polys, label: u.label });
  }

  // ---- corridors (Levels 2-4) and the communal area (Level 1); the stairs and lift are shown but not walkable ----
  // Revit has the corridor as a room on Level 3 only. The floors share that corridor; on Levels 2 and 4 some of it is
  // rooms instead, so on every floor the corridor is that outline minus the rooms (and the private villa on Level 2).
  const core = [toW(rectPoly(STAIR)), toW(rectPoly(LIFT))];
  const corridor = model.rooms.filter((r) => /CORRIDOR/i.test(r.name)).map((r) => toW(r.outline));
  for (const lvl of [2, 3, 4]) {
    if (levelY[lvl] === undefined || !units.some((u) => u.level === lvl && u.kind !== "space")) continue;
    const roomPolys = spaces.filter((s) => s.kind === "unit" && s.level === lvl).flatMap((s) => s.walk);
    const unitsX0 = Math.min(...units.filter((u) => u.level === lvl && u.kind !== "space").flatMap((u) => u.outline.map((p) => p[0])));
    const villa = lvl !== 2 ? [] : model.rooms.filter((r) => r.levelIndex === 2 && !/^K\.\d{3}|^KM |CORRIDOR/i.test(r.name.trim()) && Math.max(...r.outline.map((p) => p[0])) < unitsX0)
      .map((r) => toW(r.outline));
    spaces.push({ id: "c" + lvl, kind: "lobby", level: lvl, walk: corridor, walkSub: [...roomPolys, ...villa, ...core],
      mask: [...corridor, ...core], maskSub: villa, rooms: [...roomPolys], label: null });
  }
  const communal = model.rooms.filter((r) => r.levelIndex === 1 && /KOMUNAL|LIVING/i.test(r.name)).map((r) => toW(r.outline));
  if (communal.length) spaces.push({ id: "c1", kind: "lobby", level: 1, walk: communal, mask: [...communal, ...core], label: null });
  // is (x, z) inside this space? (inside one of its areas and not in a cut-out)
  const inside = (s, x, z) => s.walk.some((p) => inPoly(x, z, p)) && !(s.walkSub ?? []).some((p) => inPoly(x, z, p));

  const levelOf = (y) => { let l = 1; for (const [i, z] of Object.entries(levelY)) if (y >= z - 0.6 && +i >= 1) l = +i; return l; };
  // rooms first: a room is never "corridor"
  const spaceAt = (x, z, level) => spaces.find((s) => s.level === level && s.kind === "unit" && inside(s, x, z))
    ?? spaces.find((s) => s.level === level && s.kind !== "unit" && inside(s, x, z)) ?? null;
  const lobby = (level) => spaces.find((s) => s.kind === "lobby" && s.level === level) ?? null;
  const unitSpace = (u) => spaces.find((s) => s.unit === u) ?? null;

  // ---- doors ----
  const doors = [], rejected = [];
  const doorGroup = new THREE.Group();
  root.add(doorGroup);
  const tmpBox = new THREE.Box3();
  // ?model=glb: the door leaves arrive as their own objects, origin on the hinge (tools/blender/04_join.py)
  for (const leaf of doorLeaves ?? []) {
    tmpBox.setFromObject(leaf); const box = tmpBox.clone().translate(rp.clone().negate()); // root-local
    const u = leaf.userData, wide = u.door_wide_axis === "x" ? 0 : 2, thin = wide === 0 ? 2 : 0;
    const width = u.door_width ?? (box.max.getComponent(wide) - box.min.getComponent(wide));
    const centerW = box.getCenter(new THREE.Vector3()).add(rp);
    // the hinge is where the leaf object sits; along Revit y (three -z) it is the far end, so slides / swings flip.
    // French balcony doors (tools/blender/04_join.py): the second leaf is hinged on its other end ("max"), so it turns
    // the other way round to open to the same side; both leaves of a pair open together.
    const dir = (wide === 2 ? -1 : 1) * (u.door_hinge === "max" ? -1 : 1);
    doors.push({ level: 0, pivot: leaf, slide: !!u.door_slide, thin, wide, width, box, centerW, k: 0, target: 0, sign: 1, role: "fixed", links: [],
      hingeBase: leaf.position.getComponent(wide), slideDir: dir, swingFlip: dir, pair: u.door_pair ?? null, out: !!u.door_out });
  }
  for (const lvl of doorLeaves ? [] : new Set(doorChunks.map((c) => c.level))) {
    // all door triangles of this floor
    const tris = [];
    for (const ch of doorChunks.filter((c) => c.level === lvl)) {
      const a = ch.mesh.geometry.attributes.position.array;
      for (let i = ch.start; i < ch.start + ch.count; i += 9) {
        const mn = [Math.min(a[i], a[i + 3], a[i + 6]), Math.min(a[i + 1], a[i + 4], a[i + 7]), Math.min(a[i + 2], a[i + 5], a[i + 8])];
        const mx = [Math.max(a[i], a[i + 3], a[i + 6]), Math.max(a[i + 1], a[i + 4], a[i + 7]), Math.max(a[i + 2], a[i + 5], a[i + 8])];
        if (mx[0] - mn[0] + mx[1] - mn[1] + mx[2] - mn[2] < 1e-6) continue; // already collapsed
        tris.push({ mesh: ch.mesh, i, mn, mx });
      }
    }
    // group touching triangles into door instances (union-find, spatial hash on 0.5 m cells)
    const parent = tris.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const cells = new Map(), C = 0.5, tol = 0.02;
    tris.forEach((t, ti) => {
      for (let x = Math.floor(t.mn[0] / C); x <= Math.floor(t.mx[0] / C); x++)
        for (let z = Math.floor(t.mn[2] / C); z <= Math.floor(t.mx[2] / C); z++) {
          const k = x + "," + z, list = cells.get(k) ?? cells.set(k, []).get(k);
          for (const oi of list) {
            const o = tris[oi];
            if (t.mn[0] - tol <= o.mx[0] && o.mn[0] - tol <= t.mx[0] && t.mn[1] - tol <= o.mx[1] && o.mn[1] - tol <= t.mx[1] && t.mn[2] - tol <= o.mx[2] && o.mn[2] - tol <= t.mx[2]) parent[find(ti)] = find(oi);
          }
          list.push(ti);
        }
    });
    const groups = new Map();
    tris.forEach((t, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)).push(t); });
    for (const list of groups.values()) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const t of list) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], t.mn[k]); mx[k] = Math.max(mx[k], t.mx[k]); }
      const dx = mx[0] - mn[0], dy = mx[1] - mn[1], dz = mx[2] - mn[2];
      const thin = dx < dz ? 0 : 2, wide = thin === 0 ? 2 : 0, width = Math.max(dx, dz);
      if (dy < 1.7 || dy > 3.2 || width < 0.5 || width > 3.2 || Math.min(dx, dz) > 0.5) { rejected.push({ lvl, mn, mx, n: list.length }); continue; } // not a door
      // leaf = everything inside the frame (away from the jambs and the head)
      const leaf = list.filter((t) => { const c = (t.mn[wide] + t.mx[wide]) / 2, cy = (t.mn[1] + t.mx[1]) / 2;
        return c > mn[wide] + 0.06 && c < mx[wide] - 0.06 && cy > mn[1] + 0.02 && cy < mx[1] - 0.07 && t.mx[1] < mx[1] - 0.04; });
      if (leaf.length < 2) continue;
      let glass = 0, all = 0;
      for (const t of leaf) { const a = (t.mx[wide] - t.mn[wide]) * (t.mx[1] - t.mn[1]); all += a; if (t.mesh.material.transparent) glass += a; }
      const slide = glass > all * 0.4;
      const hinge = new THREE.Vector3(); hinge.setComponent(wide, mn[wide] + 0.03); hinge.setComponent(thin, (mn[thin] + mx[thin]) / 2); hinge.y = mn[1];
      const pivot = new THREE.Group(); pivot.position.copy(hinge);
      // copy the leaf triangles (per material) into the pivot, then collapse them in the building mesh
      const byMesh = new Map();
      for (const t of leaf) (byMesh.get(t.mesh) ?? byMesh.set(t.mesh, []).get(t.mesh)).push(t.i);
      for (const [mesh, idxs] of byMesh) {
        const src = mesh.geometry.attributes, n = idxs.length * 9;
        const pos = new Float32Array(n), nor = new Float32Array(n), uv = src.uv ? new Float32Array((n / 3) * 2) : null;
        idxs.forEach((i, k) => {
          for (let v = 0; v < 9; v++) { pos[k * 9 + v] = src.position.array[i + v] - hinge.getComponent(v % 3); nor[k * 9 + v] = src.normal.array[i + v]; }
          if (uv) for (let v = 0; v < 6; v++) uv[k * 6 + v] = src.uv.array[(i / 3) * 2 + v];
          for (let v = 3; v < 9; v++) src.position.array[i + v] = src.position.array[i + (v % 3)]; // degenerate in place
        });
        src.position.needsUpdate = true;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
        if (uv) geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        const leafMesh = new THREE.Mesh(geo, mesh.material);
        leafMesh.castShadow = mesh.castShadow; leafMesh.receiveShadow = true;
        if (mesh.material.transparent) leafMesh.renderOrder = 3;
        pivot.add(leafMesh);
      }
      doorGroup.add(pivot);
      const box = new THREE.Box3(new THREE.Vector3(...mn), new THREE.Vector3(...mx));
      const centerW = box.getCenter(new THREE.Vector3()).add(rp);
      doors.push({ level: lvl, pivot, slide, thin, wide, width, box, centerW, k: 0, target: 0, sign: 1, role: "fixed", links: [] });
    }
  }
  // door roles: look 0.6 m to either side of the door
  const axis = ["x", "y", "z"];
  for (const d of doors) {
    const p = d.centerW, off = (s) => { const q = p.clone(); q[axis[d.thin]] += s * 0.6; return q; };
    const a = off(1), b = off(-1), lvl = levelOf(d.box.min.y + 0.1);
    const sa = spaceAt(a.x, a.z, lvl), sb = spaceAt(b.x, b.z, lvl);
    d.level = lvl;
    if (sa && sb && sa === sb) { d.role = "inside"; d.links = [sa]; }
    else if (sa && sb && (sa.kind === "unit") !== (sb.kind === "unit")) { d.role = "entrance"; d.links = [sa, sb]; }
    else if ((sa?.kind === "unit" && !sb) || (sb?.kind === "unit" && !sa)) {
      // Room <-> outside (neither corridor nor another room): a balcony door. The balcony (from the wall out 2.2 m,
      // as wide as the room) becomes part of the room, and the door opens by itself when you come close.
      const room = sa ?? sb, op = sa ? b : a, ax = axis[d.thin], o = ax === "x" ? "z" : "x";
      const dir = Math.sign(op[ax] - p[ax]), ub = room.unit.box;
      // how deep the balcony is: up to its railing (open bars, so rays at many heights) or where its floor ends
      let depth = 2.2;
      if (probe) {
        let best = 3.5;
        const dv = new THREE.Vector3(); dv[ax] = dir;
        for (let h = 0.05; h <= 1.21; h += 0.05) for (const s of [-0.3, 0, 0.3]) {
          const q = p.clone(); q.y = levelY[lvl] + h; q[o] += s * d.width;
          const hit = probe(q, dv, 0.3, best); if (hit !== null) best = hit;
        }
        const down = new THREE.Vector3(0, -1, 0);
        for (let t = 0.3; t < best; t += 0.05) {
          const q = p.clone(); q.y = levelY[lvl] + 0.5; q[ax] += dir * t;
          if (probe(q, down, 0, 0.7) === null) { best = t; break; }
        }
        depth = best + 0.06;
      }
      d.balconyDepth = depth;
      const lo = Math.min(p[ax], p[ax] + dir * depth), hi = Math.max(p[ax], p[ax] + dir * depth);
      const r = ax === "x" ? [[lo, ub.min[o]], [hi, ub.min[o]], [hi, ub.max[o]], [lo, ub.max[o]]] : [[ub.min[o], lo], [ub.max[o], lo], [ub.max[o], hi], [ub.min[o], hi]];
      room.walk.push(r);
      const lob = lobby(lvl); if (lob) { lob.walkSub.push(r); lob.rooms.push(r); }
      d.role = "inside"; d.links = [room]; d.balcony = true;
    }
    // doors that can only be seen from inside the building (room entrances, bathroom doors)
    d.interior = d.role === "entrance" || (d.role === "inside" && !d.balcony);
    for (const s of d.links) (s.doors ??= []).push(d);
  }
  const doorway = (d) => { // the opening, reaching across the wall into both rooms
    const c = d.centerW, half = d.width / 2 - 0.08, r = [];
    for (const [sw, st] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = c.clone(); q[axis[d.wide]] += sw * half; q[axis[d.thin]] += st * 0.7; r.push([q.x, q.z]); }
    return r;
  };

  // ---- walk state ----
  const st = { current: null, loaded: new Set(), entrance: null, onChange: null };
  // what to draw: the loaded spaces (+ the open doorway); a corridor cuts out the rooms that are not loaded
  const maskPolys = () => [...st.loaded].flatMap((s) => s.mask).concat(st.entrance ? [doorway(st.entrance)] : []);
  const maskSub = () => {
    const loadedRooms = new Set([...st.loaded].filter((s) => s.kind === "unit").flatMap((s) => s.walk));
    return [...st.loaded].flatMap((s) => [...(s.maskSub ?? []), ...(s.rooms ?? []).filter((p) => !loadedRooms.has(p))]);
  };
  function closeAll() { // every door shut at once (leaving walk mode)
    for (const d of doors) {
      d.k = d.target = 0; d.pivot.rotation.y = 0; d.pivot.position.setComponent(d.wide, d.hingeBase ?? d.box.min.getComponent(d.wide) + 0.03);
      if (d.thinBase !== undefined) d.pivot.position.setComponent(d.thin, d.thinBase);
    }
  }
  // (client, 2026-11-28: "the door function does not follow floor plan") door behaviour from the Revit plan
  // (data/door_plan.json, tools/build-door-plan.mjs). slide: the balcony pairs that are 2-panel sliding doors (XO) in
  // the plan: the fixed panel stays, the other slides across it, just inside (it no longer swings out as a French leaf).
  function applyPlan(plan) {
    const toPlan = (w) => [w.x - rp.x, -(w.z - rp.z)]; // world -> Revit plan axes
    const planAxis = (d) => (d.wide === 0 ? 0 : 1);   // the wide axis in plan terms (x, or y = world -z)
    let n = 0;
    for (const [id, p] of Object.entries(plan?.slide ?? {})) {
      const leaves = doors.filter((d) => String(d.pair) === id);
      if (leaves.length !== 2) continue;
      const pa = planAxis(leaves[0]);
      leaves.sort((a, b) => toPlan(a.centerW)[pa] - toPlan(b.centerW)[pa]); // [min end, max end]
      const op = p.operable === "min" ? leaves[0] : leaves[1], fixed = op === leaves[0] ? leaves[1] : leaves[0];
      op.slide = true; op.out = true; op.width = Math.min(op.width, 1.2);
      op.slideDir = Math.sign(fixed.centerW.getComponent(op.wide) - op.centerW.getComponent(op.wide)) || 1;
      op.thinBase = op.pivot.position.getComponent(op.thin); op.thinShift = 0.06; op.thinSign = 1;
      op.dur = 0.9; op.ease = "quad";
      fixed.fixed = true; n++;
    }
    // swing (Revit agent's door_swings.json: hinge = centre of the plan's swing arc, side = where the arc lies): the
    // leaf at the plan door (same floor, centre within 0.4 m) gets the plan's hinge end and opens to the plan's side.
    // About half the exported leaves had their hinge (the leaf object's origin) at the other end of the leaf: those get
    // a new pivot at the plan's hinge (the leaf hangs from it unchanged) and turn the other way round.
    const v = new THREE.Vector3();
    for (const p of Object.values(plan?.swing ?? {})) {
      if (!p.point) continue;
      let best = null, bd = 0.4;
      for (const d of doors) {
        if (d.slide || d.fixed || d.planSide) continue;
        if (Math.abs(d.centerW.y - rp.y - p.point[2] - 1) > 1.4) continue; // (leaf centre ~1 m above its floor)
        const c = toPlan(d.centerW), dist = Math.hypot(c[0] - p.point[0], c[1] - p.point[1]);
        if (dist < bd) { bd = dist; best = d; }
      }
      if (!best) continue;
      const d = best;
      d.planSide = new THREE.Vector3(p.side[0], 0, -p.side[1]).normalize(); // plan -> world (y -> -z)
      const hw = d.pivot.getWorldPosition(v.set(0, 0, 0)).clone(), hp = toPlan(hw);
      if (Math.hypot(hp[0] - p.hinge[0], hp[1] - p.hinge[1]) > (p.width ?? d.width) * 0.5) { // hinge on the wrong end
        const leaf = d.pivot, parent = leaf.parent, wrap = new THREE.Group();
        const nh = hw.clone(); nh.setComponent(d.wide, 2 * d.centerW.getComponent(d.wide) - hw.getComponent(d.wide));
        parent.add(wrap); wrap.position.copy(parent.worldToLocal(nh)); wrap.updateMatrixWorld(true); wrap.attach(leaf);
        wrap.userData = { ...leaf.userData, planHinge: true };
        d.pivot = wrap; d.hingeBase = wrap.position.getComponent(d.wide); d.swingFlip = -(d.swingFlip ?? 1); d.hingeMoved = true;
      }
      n++;
    }
    return n;
  }
  function setCurrent(space) {
    st.current = space; st.loaded = new Set(space ? [space] : []); st.entrance = null;
    for (const d of doors) { d.target = 0; }
    st.onChange?.();
  }
  function allowed(x, z) {
    const s = st.current; if (!s) return true;
    if (inside(s, x, z)) return true;
    for (const d of s.doors ?? []) if (d.k > 0.6 && inPoly(x, z, doorway(d))) return true;
    if (st.entrance && st.entrance.k > 0.6) {
      const other = st.entrance.links.find((o) => o !== s);
      if (other && inside(other, x, z)) return true;
    }
    return false;
  }
  function update(feet, dt, camPos) {
    const s = st.current; if (!s) return false;
    let moved = false;
    // walked through the open entrance door into the other space: switch, close the door, unload the old space
    if (st.entrance) {
      const other = st.entrance.links.find((o) => o !== s);
      if (other && inside(other, feet.x, feet.z) && !inside(s, feet.x, feet.z)) {
        const d = st.entrance; st.current = other; st.loaded = new Set([other]); st.entrance = null; d.target = 0; st.onChange?.();
      } else if (st.entrance.centerW.distanceTo(feet) > 5 && st.entrance.k > 0.99) { // walked away without going through
        st.entrance.target = 0; st.entrance = null; st.loaded = new Set([s]); st.onChange?.();
      }
    }
    // doors inside the room (bathroom, balcony) open when you are close
    for (const d of st.current.doors ?? []) if (d.role === "inside") {
      const dist = Math.hypot(feet.x - d.centerW.x, feet.z - d.centerW.z);
      if (dist < 1.5 && d.target === 0) { d.target = 1; d.sign = swingSign(d, camPos); } else if (dist > 2.3) d.target = 0;
    }
    return animate(dt) || moved;
  }
  // doors swing / slide toward their target (also used outside walk mode, in the room view)
  function animate(dt) {
    let moved = false;
    for (const d of doors) {
      if (d.k === d.target) continue;
      // per-door timing (js/roomstyle.js sets dur / ease / swing on the style rooms' doors: 90 deg in ~0.91 s,
      // easeInOutQuad, like the Nagoya Hill reference); other doors keep 0.55 s smoothstep and a 83 deg swing
      const dur = d.dur ?? 0.55;
      d.k = d.target > d.k ? Math.min(d.target, d.k + dt / dur) : Math.max(d.target, d.k - dt / dur);
      const e = d.ease === "quad" ? (d.k < 0.5 ? 2 * d.k * d.k : 1 - (-2 * d.k + 2) ** 2 / 2) : d.k * d.k * (3 - 2 * d.k);
      if (d.slide) {
        d.pivot.position.setComponent(d.wide, (d.hingeBase ?? d.box.min.getComponent(d.wide) + 0.03) + (d.slideDir ?? 1) * e * (d.width - 0.12));
        // (plan sliders) the moving panel steps just inside the fixed one first, then runs along it
        if (d.thinShift) d.pivot.position.setComponent(d.thin, d.thinBase + d.thinSign * d.thinShift * Math.min(1, e * 4));
      }
      else d.pivot.rotation.y = (d.swingFlip ?? 1) * d.sign * e * Math.PI * 0.5 * (d.swing ?? 0.92);
      moved = true;
    }
    return moved;
  }
  // swing away from where you stand
  function swingSign(d, camPos) {
    const s = Math.sign(camPos[axis[d.thin]] - d.centerW[axis[d.thin]]) || 1;
    return d.wide === 0 ? s : -s;
  }
  // Click on an entrance door (yours, or one seen from the corridor): open it and load the space behind it.
  function click(door, camPos) {
    const s = st.current;
    if (!s || door.role !== "entrance" || !door.links.includes(s)) return false;
    if (door.target === 1) { // clicking an open door closes it again
      door.target = 0; if (st.entrance === door) { st.entrance = null; st.loaded = new Set([s]); st.onChange?.(); }
      return true;
    }
    if (st.entrance && st.entrance !== door) st.entrance.target = 0;
    door.sign = swingSign(door, camPos); door.target = 1;
    st.entrance = door; st.loaded = new Set([s, ...door.links]);
    st.onChange?.();
    return true;
  }
  // Room view: a click opens / closes any door of the room. Entrance doors swing into the room, bathroom doors into
  // the bathroom (away from the room's middle); balcony glass slides.
  function toggle(door, roomCenter) {
    const set = door.pair ? doors.filter((d) => d.pair === door.pair && !d.fixed) : [door]; // French doors: both leaves (a plan slider: its moving panel)
    if (set.some((d) => d.target === 1)) { for (const d of set) d.target = 0; return; } // (a plan slider's fixed panel closes it too)
    const away = door.role === "entrance" ? door.centerW.clone().multiplyScalar(2).sub(roomCenter) : roomCenter;
    for (const d of set) {
      // (plan swing) open toward the plan's side: "away" from a point on the other side of the leaf
      d.sign = swingSign(d, d.planSide ? d.centerW.clone().sub(d.planSide) : away); d.target = 1;
      if (d.thinShift) d.thinSign = Math.sign(roomCenter[axis[d.thin]] - d.centerW[axis[d.thin]]) || 1; // slide on the room side
    }
  }
  const doorMeshes = () => doors.filter((d) => d.role === "entrance" && st.current && d.links.includes(st.current)).flatMap((d) => { const ms = []; d.pivot.traverse((m) => { if (m.isMesh) { m.userData.door = d; ms.push(m); } }); return ms; }); // (hinged leaves: pivot > leaf node > meshes)

  // where to stand
  // isFloor(x, z): is there solid floor at this level here? (not the stairwell or the lift shaft)
  function stairStart(level, isFloor = () => true) {
    const s = lobby(level); if (!s) return null;
    const [cx, cz] = W([(STAIR[0] + STAIR[2]) / 2, (STAIR[1] + STAIR[3]) / 2]);
    // first try spots that look straight at the stair flights, then any spot near them
    for (const strict of [true, false]) for (const r of [2.0, 2.5, 3.0, 3.6, 4.4, 5.4]) for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2, x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r;
      if (inside(s, x, z) && !stairRects().some((q) => inPoly(x, z, q)) && !spaces.some((o) => o.kind === "unit" && o.level === level && inside(o, x, z)) && isFloor(x, z, cx, cz, strict))
        return { space: s, x, z, yaw: Math.atan2(-(cx - x), -(cz - z)) };
    }
    return { space: s, x: s.walk[0][0][0], z: s.walk[0][0][1], yaw: 0 };
  }
  function entranceStart(u) {
    const s = unitSpace(u); if (!s) return null;
    const d = (s.doors ?? []).find((x) => x.role === "entrance");
    if (!d) return { space: s, x: u.center.x, z: u.center.z, yaw: 0 };
    // 0.8 m inside the room from the entrance door, facing into the room
    for (const sgn of [1, -1]) {
      const q = d.centerW.clone(); q[axis[d.thin]] += sgn * 0.8;
      if (inside(s, q.x, q.z)) {
        const look = d.centerW.clone(); look[axis[d.thin]] += sgn * 5;
        return { space: s, x: q.x, z: q.z, yaw: Math.atan2(-(look.x - q.x), -(look.z - q.z)) };
      }
    }
    return { space: s, x: u.center.x, z: u.center.z, yaw: 0 };
  }
  const stairRects = () => [STAIR, LIFT].map((r) => toW(rectPoly([r[0] - 0.35, r[1] - 0.35, r[2] + 0.35, r[3] + 0.35])));
  const isStairs = (p) => stairRects().some((poly) => inPoly(p.x, p.z, poly));
  const stairWell = () => [toW(rectPoly(STAIR))]; // the stair flights only (not the lift shaft, nor what lies beside them)

  return {
    spaces, doors, rejected, doorGroup, state: st, lobby, unitSpace, spaceAt, levelOf, allowed, update, animate, toggle, click, doorMeshes,
    setCurrent, closeAll, applyPlan, maskPolys, maskSub, stairStart, entranceStart, isStairs, stairWell,
    footprint: () => { const b = buildingBox; return [[[b.min.x - 0.6, b.min.z - 0.6], [b.max.x + 0.6, b.min.z - 0.6], [b.max.x + 0.6, b.max.z + 0.6], [b.min.x - 0.6, b.max.z + 0.6]]]; },
  };
}
