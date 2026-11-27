// (M5) Trees for the site: the references (3.jpg, 8.webp, 9.webp) are framed by large broadleaf trees and a tree line in
// haze; the site plan had none. CC0 photo-scanned trees are millions of triangles, so these are built here instead,
// from real CC0 photographs (ASSETS_LICENSES.md): Poly Haven bark (bark_brown_02) on a tapered trunk + main branches,
// and a canopy of crossed "leaf cluster" cards (leaves of ambientCG LeafSet005 composited onto twigs, with alpha).
//  - 3 species shapes (round street tree, tall oval tree, broad spreading tree), each one geometry for the wood and one
//    for the leaves, drawn GPU-instanced: ~6 draw calls for all trees, ~300-900 triangles per tree
//  - per tree: random height, turn, lean and leaf tint (instance colour); soft round contact shadow on the ground
//  - card normals point out of the crown (not the card's own normal), so a crown shades like one soft volume
//  - trees don't cast into the sun's shadow map (cost, and dappled self-shadow needs alpha shadows); the contact
//    shadow and the canopy's own shading carry them
// Plain three.js materials: works on the classic and the new renderer alike.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const SPECIES = [
  // h: height (m), trunk: trunk radius at the base, clear: bare trunk (fraction of h), crown: [radius x/z, radius y],
  // cards: leaf cards, card: card size (m), branches
  { h: 9, trunk: 0.22, clear: 0.35, crown: [3.4, 3.0], cards: 70, card: 2.4, branches: 5 },
  { h: 13, trunk: 0.28, clear: 0.30, crown: [2.8, 4.8], cards: 90, card: 2.6, branches: 6 },
  { h: 10, trunk: 0.30, clear: 0.40, crown: [5.0, 2.8], cards: 100, card: 2.8, branches: 7 },
];

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

// tapered cylinder from a to b (radii r0 -> r1), bark UVs in metres (u around, v along)
function limb(a, b, r0, r1, radial = 7) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 3, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r0 / 0.6, uv.getY(i) * len / 0.6);
  g.translate(0, len / 2, 0);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(a.x, a.y, a.z);
  return g;
}

function buildSpecies(sp, seed) {
  const r = rng(seed);
  const wood = [], leaves = [];
  const top = new THREE.Vector3(0, sp.h * 0.92, 0);
  const crownC = new THREE.Vector3(0, sp.h - sp.crown[1], 0);
  wood.push(limb(new THREE.Vector3(0, -0.3, 0), top, sp.trunk, sp.trunk * 0.25, 8));
  const tips = [];
  for (let i = 0; i < sp.branches; i++) {
    const a = (i / sp.branches) * Math.PI * 2 + r() * 0.8;
    const y0 = sp.h * (sp.clear + r() * 0.25);
    const tip = new THREE.Vector3(Math.cos(a) * sp.crown[0] * (0.55 + r() * 0.3), crownC.y + (r() - 0.3) * sp.crown[1] * 0.9, Math.sin(a) * sp.crown[0] * (0.55 + r() * 0.3));
    wood.push(limb(new THREE.Vector3(0, y0, 0), tip, sp.trunk * 0.45, sp.trunk * 0.12, 5));
    tips.push(tip);
  }
  // leaf cards: in the crown ellipsoid, denser towards the outside (where light hits), each a random orientation;
  // normals point away from the crown centre (soft, volumetric shading); UV picks one of the two atlas cards
  const plane = new THREE.PlaneGeometry(1, 1);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  for (let i = 0; i < sp.cards; i++) {
    const tip = tips[(r() * tips.length) | 0];
    const d = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(Math.pow(r(), 0.35));
    p.set(d.x * sp.crown[0], d.y * sp.crown[1], d.z * sp.crown[0]).add(crownC).lerp(tip, 0.25 * r());
    // facing out of the crown (+-40 deg tilt, any spin): from outside a crown reads full, and cards seen edge-on
    // (thin slivers) are rare
    const out = p.clone().sub(crownC).normalize();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out);
    e.set((r() - 0.5) * 1.4, (r() - 0.5) * 1.4, r() * Math.PI * 2);
    q.multiply(new THREE.Quaternion().setFromEuler(e));
    const size = sp.card * (0.75 + r() * 0.5);
    s.set(size, size, size);
    const g = plane.clone().applyMatrix4(m.compose(p, q, s));
    const half = r() < 0.5 ? 0 : 0.5;
    const uv = g.attributes.uv, nrm = g.attributes.normal, pos = g.attributes.position;
    for (let k = 0; k < uv.count; k++) {
      uv.setX(k, half + uv.getX(k) * 0.5);
      const v = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(crownC);
      v.y *= sp.crown[0] / sp.crown[1];
      v.normalize();
      nrm.setXYZ(k, v.x, v.y, v.z);
    }
    leaves.push(g);
  }
  const woodGeo = mergeGeometries(wood.map((g) => g.toNonIndexed()));
  const leafGeo = mergeGeometries(leaves);
  woodGeo.computeBoundingSphere(); leafGeo.computeBoundingSphere();
  return { woodGeo, leafGeo };
}

function contactShadowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(0.55, "rgba(0,0,0,0.28)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// places: [{ x, y, z, species, scale, turn, tint }] (world, on the ground). loadKtx(url) -> Promise<texture>.
export function createFoliage({ places, loadKtx, phone = false, anisotropy = 4 }) {
  const group = new THREE.Group(); group.name = "foliage";
  const dir = phone ? "data/levels/tex_m/" : "data/levels/tex/";
  const bark = new THREE.MeshStandardMaterial({ name: "FOL_bark", color: 0x8a7a6a, roughness: 0.95 });
  const leaf = new THREE.MeshStandardMaterial({
    // (the photo leaves are bright spring green: toned to the deeper, greyer greens of the references' trees)
    name: "FOL_leaves", color: new THREE.Color().setRGB(0.62, 0.68, 0.52), roughness: 0.78, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true,
  });
  const shadowMat = new THREE.MeshBasicMaterial({ name: "FOL_contact", map: contactShadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  // textures arrive a moment later; until then the materials show their plain colour (no shader change: the maps are
  // assigned before the first compile wherever possible, see ready)
  const ready = Promise.all([
    loadKtx(dir + "foliage_leaves.ktx2"), loadKtx(dir + "foliage_bark.ktx2"), loadKtx(dir + "foliage_bark_nor.ktx2"),
  ]).then(([lt, bt, bn]) => {
    lt.colorSpace = THREE.SRGBColorSpace; bt.colorSpace = THREE.SRGBColorSpace; bn.colorSpace = THREE.NoColorSpace;
    for (const t of [bt, bn]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy; }
    lt.anisotropy = anisotropy;
    leaf.map = lt; bark.map = bt; bark.normalMap = bn; bark.color.set(0xffffff);
    leaf.needsUpdate = bark.needsUpdate = true;
  }).catch((e) => console.warn("foliage textures", e));

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  SPECIES.forEach((sp, si) => {
    const mine = places.filter((p) => p.species === si);
    if (!mine.length) return;
    const { woodGeo, leafGeo } = buildSpecies(sp, 101 + si * 37);
    const wood = new THREE.InstancedMesh(woodGeo, bark, mine.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leaf, mine.length);
    wood.name = "foliage_wood_" + si; leaves.name = "foliage_leaves_" + si;
    mine.forEach((p, i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), p.turn).multiply(new THREE.Quaternion().setFromAxisAngle(v.set(1, 0, 0), p.lean ?? 0));
      m4.compose(v.set(p.x, p.y, p.z), q, s.setScalar(p.scale));
      wood.setMatrixAt(i, m4); leaves.setMatrixAt(i, m4);
      leaves.setColorAt(i, col.setRGB(...p.tint));
    });
    for (const im of [wood, leaves]) { im.castShadow = false; im.receiveShadow = true; im.computeBoundingSphere(); group.add(im); }
  });
  // contact shadows: one instanced quad per tree, flat on the ground, sized to its crown
  const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(quad, shadowMat, places.length);
  shadows.name = "foliage_contact";
  places.forEach((p, i) => {
    const sp = SPECIES[p.species], d = sp.crown[0] * 2.3 * p.scale;
    shadows.setMatrixAt(i, m4.compose(v.set(p.x, p.y + 0.03, p.z), q.identity(), s.set(d, 1, d)));
  });
  shadows.renderOrder = 1; shadows.computeBoundingSphere(); group.add(shadows);
  return { group, ready, materials: [bark, leaf, shadowMat], count: places.length };
}

// Scatter: candidate points on a jittered grid, kept where the ground below is lawn (hit test supplied by the caller),
// away from the building and from each other. Clusters: a low-frequency noise thins the grid, so trees stand in groups
// and lines like in the references instead of an even orchard. Returns the places for createFoliage.
export function scatterTrees({ bounds, isLawn, groundY, keepOut, spacing = 9, seed = 5, density = 0.55 }) {
  const r = rng(seed), out = [];
  const n2 = (x, z) => Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.052 - 0.7) + 0.6 * Math.sin((x + z) * 0.021 + 2.1);
  for (let x = bounds.min.x; x <= bounds.max.x; x += spacing) for (let z = bounds.min.z; z <= bounds.max.z; z += spacing) {
    const px = x + (r() - 0.5) * spacing * 0.9, pz = z + (r() - 0.5) * spacing * 0.9;
    if (n2(px, pz) + (r() - 0.5) * 0.8 < 1 - density * 2) continue;
    if (keepOut(px, pz) || !isLawn(px, pz)) continue;
    const y = groundY(px, pz);
    if (y === null) continue;
    const species = r() < 0.45 ? 0 : r() < 0.6 ? 2 : 1;
    const g = 0.85 + r() * 0.3; // leaf tint: a little lighter / darker, yellower / bluer per tree
    // (sized like 3.jpg's trees: 9-20 m, as tall as the lower floors and up to the roof line of a 4-storey block)
    out.push({ x: px, y, z: pz, species, scale: 1.0 + r() * 0.65, turn: r() * Math.PI * 2, lean: (r() - 0.5) * 0.08,
      tint: [g * (0.95 + r() * 0.12), g * (0.97 + r() * 0.06), g * (0.85 + r() * 0.15)] });
  }
  return out;
}
