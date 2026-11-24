// Landscape around the building: trees (generated here: no heavy downloads), distant hills, ferns, 3D grass.
// Everything is instanced: ~330 trees cost 16 draw calls.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Leaf-cluster texture drawn on a canvas: ~900 small pointed leaves in three layers (shaded ones underneath,
// sunlit ones on top) with transparent gaps, so crowns have depth and light shows through.
function leafTexture() {
  const S = 512, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), r = rng(5);
  const layers = [[380, 14, 26, 0.55], [320, 24, 36, 0.8], [200, 36, 52, 1.0]]; // count, lightness min, max, size
  for (const [count, l0, l1, sz] of layers) {
    for (let i = 0; i < count; i++) {
      const a0 = r() * Math.PI * 2, d = Math.sqrt(r()) * S * 0.44;
      const x = S / 2 + Math.cos(a0) * d, y = S / 2 + Math.sin(a0) * d;
      const len = (16 + r() * 16) * (0.8 + sz * 0.4), w = len * (0.34 + r() * 0.14), a = r() * Math.PI * 2;
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = `hsl(${78 + r() * 34}, ${34 + r() * 26}%, ${l0 + r() * (l1 - l0)}%)`;
      g.beginPath(); // pointed leaf: two curves meeting at the tips
      g.moveTo(-len / 2, 0);
      g.quadraticCurveTo(0, -w, len / 2, 0);
      g.quadraticCurveTo(0, w, -len / 2, 0);
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.16)"; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Tree shapes. h = height, w = crown radius, flat = crown height / width, clusters = leaf clumps in the crown.
const KINDS = {
  rain:  { h: 8.5, w: 5.6, flat: 0.45, clusters: 9, cards: 380, cy: 0.74 }, // broad umbrella crown (rain tree)
  round: { h: 7.0, w: 3.4, flat: 0.85, clusters: 6, cards: 300, cy: 0.68 },
  tall:  { h: 11,  w: 2.4, flat: 1.7,  clusters: 7, cards: 280, cy: 0.66 }, // columnar
  young: { h: 5.0, w: 2.2, flat: 0.95, clusters: 4, cards: 180, cy: 0.66 },
};
const KIND_NAMES = Object.keys(KINDS);

// A cylinder from a to b (for trunks and branches)
function limb(a, b, r0, r1, seg = 6) {
  const dir = b.clone().sub(a), len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return g.translate(a.x, a.y, a.z).toNonIndexed();
}

// A tree = trunk + one branch per leaf cluster + crossed leaf cards grouped in clusters.
// Each card gets a vertex colour: darker inside the crown and underneath, lighter on the sunlit outside.
// lod 1 = distant version: 40 % of the cards, a bit bigger.
function treeGeometry(kind, seed, lod = 0) {
  const k = KINDS[kind], r = rng(seed);
  const cy = k.h * k.cy, vr = k.w * k.flat * 0.55, hr = k.w * 0.6;
  const crown = new THREE.Vector3(0, cy, 0);
  const clusters = [];
  for (let i = 0; i < k.clusters; i++) {
    const a = (i / k.clusters) * Math.PI * 2 + r() * 0.8, d = (i === 0 ? 0 : 0.45 + r() * 0.4) * hr;
    clusters.push({ c: new THREE.Vector3(Math.cos(a) * d, cy + (r() - 0.35) * vr * 0.9, Math.sin(a) * d), rad: hr * (0.5 + r() * 0.2) * Math.sqrt(5 / k.clusters) * 1.15 });
  }
  // trunk and branches
  const base = new THREE.Vector3(0, 0, 0), fork = new THREE.Vector3(0, cy - vr * 0.7, 0);
  const tr = 0.045 + k.h * 0.009; // trunk radius at the fork (≈ 20–30 cm diameter at the base)
  const parts = [limb(base, fork, tr * 1.4, tr), new THREE.CylinderGeometry(tr * 1.8, tr * 1.4, 0.3, 7, 1, true).translate(0, 0.15, 0).toNonIndexed()];
  for (const cl of clusters) parts.push(limb(fork, cl.c.clone().lerp(fork, 0.25), tr * 0.6, tr * 0.25, 5));
  const trunk = mergeGeometries(parts.map((g) => { g.deleteAttribute("uv"); return g; }));

  const n = Math.round(k.cards * (lod ? 0.4 : 1)), sizeK = lod ? 1.45 : 1;
  const cards = [], tmp = new THREE.Vector3(), nrm = new THREE.Vector3();
  const maxR = Math.max(hr, vr) * 1.4;
  for (let i = 0; i < n; i++) {
    const cl = clusters[Math.floor(r() * clusters.length)];
    // random point in the cluster, biased toward its outside so each clump reads as a rounded mass
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = cl.rad * Math.cbrt(0.3 + r() * 0.7);
    const p = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(th), u * 0.8, Math.sqrt(1 - u * u) * Math.sin(th)).multiplyScalar(rad).add(cl.c);
    const s = (0.9 + r() * 0.6) * sizeK;
    const card = new THREE.PlaneGeometry(s, s);
    card.rotateX(r() * Math.PI); card.rotateY(r() * Math.PI); card.rotateZ(r() * 0.6);
    card.translate(p.x, p.y, p.z);
    // shading: outer + upper cards lighter, inner + lower darker (cheap "self-shadowing" of the crown)
    const out = Math.min(1, p.distanceTo(crown) / maxR), up = THREE.MathUtils.clamp((p.y - (cy - vr)) / (2 * vr), 0, 1);
    const shade = THREE.MathUtils.clamp(0.42 + out * 0.38 + up * 0.28, 0.4, 1.05);
    const warm = 0.94 + r() * 0.12;
    const pos = card.attributes.position, nor = card.attributes.normal, col = [];
    for (let j = 0; j < pos.count; j++) {
      tmp.set(pos.getX(j), pos.getY(j), pos.getZ(j));
      // normals: half from the clump centre, half from the crown centre (soft, rounded light)
      nrm.copy(tmp).sub(cl.c).normalize().add(tmp.clone().sub(crown).normalize()).normalize();
      nor.setXYZ(j, nrm.x, nrm.y, nrm.z);
      col.push(shade * warm, shade, shade * (1.9 - warm));
    }
    card.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    cards.push(card.toNonIndexed());
  }
  return { trunk, canopy: mergeGeometries(cards), center: cy, radius: Math.max(hr, k.h * 0.5) };
}

export function createLandscape({ scene, buildingBox, lite = false }) {
  const group = new THREE.Group();
  scene.add(group);
  const r = rng(88);

  // --- trees ---
  const wind = { value: 0 };
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: leafTexture(), vertexColors: true, alphaTest: 0.45, alphaToCoverage: true,
    side: THREE.DoubleSide, roughness: 0.8,
  });
  // gentle wind: whole crowns sway slowly, leaves flutter a little (vertex shader only; costs nothing on the CPU)
  leafMat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uWind;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iPos = instanceMatrix[3].xyz;
        #else
          vec3 iPos = vec3(0.0);
        #endif
        float sway = transformed.y / 10.0; sway *= sway;
        transformed.x += sin(uWind * 1.1 + iPos.x * 0.31 + iPos.z * 0.17) * 0.18 * sway;
        transformed.z += cos(uWind * 0.83 + iPos.z * 0.29) * 0.12 * sway;
        transformed += normal * sin(uWind * 3.1 + transformed.x * 2.7 + transformed.z * 1.9) * 0.025;`);
  };
  leafMat.customProgramCacheKey = () => "leaves-wind";
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3c, roughness: 0.95, side: THREE.DoubleSide });

  // trees may stand beside / behind the building, but the lawn in front of the terrace facade stays open (like the renders)
  const keepOut = buildingBox.clone().expandByScalar(5);
  keepOut.max.z += 14;
  const spots = [];
  const pickKind = (weights) => { let x = r() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) <= 0) return i; return 0; };
  const tryPlace = (rMin, rMax, n, sMin, sMax, lod, gap, weights) => {
    for (let k = 0, tries = 0; k < n && tries < n * 40; tries++) {
      const a = r() * Math.PI * 2, d = rMin + r() * (rMax - rMin);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (keepOut.containsPoint(new THREE.Vector3(x, 1, z))) continue;
      if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < gap * gap)) continue;
      spots.push({ x, z, s: sMin + r() * (sMax - sMin), rot: r() * Math.PI * 2, kind: pickKind(weights), lod });
      k++;
    }
  };
  //       ring (m)    count  scale      lod  spacing  rain/round/tall/young
  tryPlace(12, 45,      60,  0.85, 1.25,  0,  5.5,    [3, 3.5, 2, 2]);   // around the site
  tryPlace(45, 110,    130,  1.0,  1.6,   1,  5,      [3, 3, 2.5, 1]);   // further out
  tryPlace(110, 175,   170,  1.3,  2.1,   1,  4.2,    [3, 3, 3, 0]);     // dense tree line on the horizon

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const tint = [0xffffff, 0xf2f6dc, 0xe4ecd2, 0xf6efd2, 0xd6e0c6]; // per-tree colour variation (fresh / yellowish / darker)
  const col = new THREE.Color();
  KIND_NAMES.forEach((kind, ki) => {
    for (const lod of [0, 1]) {
      const mine = spots.filter((s) => s.kind === ki && s.lod === lod);
      if (!mine.length) continue;
      const geo = treeGeometry(kind, 11 + ki * 7, lod);
      const pair = [];
      for (const [g, mat] of [[geo.trunk, barkMat], [geo.canopy, leafMat]]) {
        const im = new THREE.InstancedMesh(g, mat, mine.length);
        mine.forEach((s, i) => {
          im.setMatrixAt(i, m4.compose(new THREE.Vector3(s.x, -0.25, s.z), q.setFromAxisAngle(up, s.rot), new THREE.Vector3(s.s, s.s, s.s)));
          if (mat === leafMat) im.setColorAt(i, col.setHex(tint[Math.floor(r() * tint.length)]));
        });
        // only the ring around the site can throw a shadow into the sun's ±34 m shadow map; the far rings are left out of it
        im.castShadow = lod === 0; im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
        pair.push(im);
      }
      mine.forEach((s, i) => {
        s.meshes = pair; s.index = i; s.hidden = false;
        // crown centre and radius in world space, for the "is it in the way?" test
        s.center = new THREE.Vector3(s.x, -0.25 + geo.center * s.s, s.z);
        s.radius = geo.radius * s.s;
      });
    }
  });

  // Hide trees that stand between the camera and the building (closer than the building and overlapping it on screen).
  const corners = [...Array(8)].map(() => new THREE.Vector3()), p = new THREE.Vector3(), e = new THREE.Vector3(), side = new THREE.Vector3();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0), tPos = new THREE.Vector3(), tScale = new THREE.Vector3();
  function updateOcclusion(camera, box, enabled = true) {
    // the building's outline on screen
    let x0 = 1, x1 = -1, y0 = 1, y1 = -1;
    for (let i = 0; i < 8; i++) {
      corners[i].set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      x0 = Math.min(x0, corners[i].x); x1 = Math.max(x1, corners[i].x); y0 = Math.min(y0, corners[i].y); y1 = Math.max(y1, corners[i].y);
    }
    const buildingDist = box.distanceToPoint(camera.position);
    side.setFromMatrixColumn(camera.matrixWorld, 0);
    const changed = new Set();
    for (const s of spots) {
      let hide = false;
      if (enabled && s.meshes) {
        const d = s.center.distanceTo(camera.position);
        if (d < s.radius + 1.5) hide = true; // camera is inside / right next to the crown
        else if (d < buildingDist + s.radius + 2) {
          p.copy(s.center).project(camera);
          // crown radius on screen (approximate, from a point offset sideways by the radius)
          e.copy(s.center).addScaledVector(side, s.radius).project(camera);
          const rr = Math.hypot(e.x - p.x, e.y - p.y);
          hide = p.z < 1 && p.x + rr > x0 && p.x - rr < x1 && p.y + rr > y0 && p.y - rr < y1;
        }
      }
      if (s.meshes && hide !== s.hidden) {
        s.hidden = hide;
        for (const im of s.meshes) {
          im.setMatrixAt(s.index, hide ? hidden : m4.compose(tPos.set(s.x, -0.25, s.z), q.setFromAxisAngle(up, s.rot), tScale.setScalar(s.s)));
          changed.add(im);
        }
      }
    }
    for (const im of changed) im.instanceMatrix.needsUpdate = true;
  }

  // --- distant hills (fade into the haze) ---
  const hills = new THREE.RingGeometry(230, 520, 96, 6).rotateX(-Math.PI / 2);
  const hp = hills.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), z = hp.getZ(i), d = Math.hypot(x, z), a = Math.atan2(z, x);
    const h = (Math.sin(a * 3 + 1) * 0.5 + Math.sin(a * 7 + 2) * 0.3 + Math.sin(a * 13) * 0.15 + 1) * 11 * Math.min(1, (d - 230) / 120);
    hp.setY(i, h - 0.3);
  }
  hills.computeVertexNormals();
  group.add(new THREE.Mesh(hills, new THREE.MeshStandardMaterial({ color: 0x4d6236, roughness: 1 })));

  // --- ferns along the base of the building (CC0 Poly Haven model, 6k triangles) ---
  new GLTFLoader().load("assets/models/fern_02/fern_02_1k.gltf", (gltf) => {
    const meshes = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const b = buildingBox, places = [];
    const along = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 2.2);
      for (let i = 0; i <= n; i++) places.push([x0 + ((x1 - x0) * i) / n + (r() - 0.5), z0 + ((z1 - z0) * i) / n + (r() - 0.5)]);
    };
    const o = 1.3;
    along(b.min.x - o, b.max.z + o, b.max.x + o, b.max.z + o);
    along(b.min.x - o, b.min.z - o, b.max.x + o, b.min.z - o);
    along(b.min.x - o, b.min.z - o, b.min.x - o, b.max.z + o);
    along(b.max.x + o, b.min.z - o, b.max.x + o, b.max.z + o);
    // The file holds 4 fern variants side by side (≈2,400 / 2,250 / 780 / 820 triangles); each spot gets all four as a
    // small clump. Lite (phones): the two heavy variants are drawn with the light ones' shapes (same clump, ~half the triangles).
    const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    const light = meshes.filter((m) => tris(m.geometry) < 1500).map((m) => m.geometry);
    meshes.forEach((mesh, k) => {
      const geo = lite && light.length && tris(mesh.geometry) >= 1500 ? light[k % light.length] : mesh.geometry;
      const im = new THREE.InstancedMesh(geo, mesh.material, places.length);
      places.forEach(([x, z], i) => {
        const s = 0.9 + r() * 0.6;
        m4.compose(new THREE.Vector3(x, -0.25, z), q.setFromAxisAngle(up, r() * Math.PI * 2), new THREE.Vector3(s, s, s)).multiply(mesh.matrixWorld);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = im.receiveShadow = true;
      group.add(im);
    });
  });

  // --- 3D grass blades in a band around the building (the flat lawn texture continues beyond it) ---
  // One clump = ~44 tapered blades (dark at the root, sunlit yellow-green at the tip). Clumps are instanced in 12 m tiles
  // so tiles outside the view are skipped. isBlocked(x, z) says whether there's paving / a slab at that spot.
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  grassMat.userData.noAO = true; // thousands of thin blades would turn the lawn dark in the AO pass
  function clumpGeometry() {
    const rr = rng(404), pos = [], col = [], nor = [];
    const root = new THREE.Color(0x455321), tipA = new THREE.Color(0x8a903e), tipB = new THREE.Color(0xa8a25a); // warm olive, dry tips
    for (let i = 0; i < 44; i++) {
      const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * 0.55, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = 0.1 + rr() * 0.2, w = 0.012 + rr() * 0.01, face = rr() * Math.PI;
      const fx = Math.cos(face) * w, fz = Math.sin(face) * w;
      const lean = 0.25 + rr() * 0.4, la = rr() * Math.PI * 2;
      const tip = tipA.clone().lerp(tipB, rr());
      pos.push(x - fx, 0, z - fz, x + fx, 0, z + fz, x + Math.cos(la) * h * lean, h, z + Math.sin(la) * h * lean);
      for (const c of [root, root, tip]) col.push(c.r, c.g, c.b);
      for (let k = 0; k < 3; k++) nor.push(0, 1, 0); // lit like the ground: soft and even
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    return g;
  }
  function addGrass(isBlocked, density = 1) {
    const clump = clumpGeometry(), rr = rng(77);
    const area = buildingBox.clone().expandByVector(new THREE.Vector3(20, 0, 20));
    area.max.z += 6; // a little more lawn in front of the terrace facade
    const TILE = 12, tiles = new Map();
    const step = 0.72 / Math.sqrt(density); // spacing between clumps (≈ full cover at density 1)
    for (let x = area.min.x; x < area.max.x; x += step)
      for (let z = area.min.z; z < area.max.z; z += step) {
        const px = x + (rr() - 0.5) * step, pz = z + (rr() - 0.5) * step;
        if (buildingBox.containsPoint(new THREE.Vector3(px, 0, pz)) || isBlocked(px, pz)) continue;
        const key = `${Math.floor(px / TILE)},${Math.floor(pz / TILE)}`;
        if (!tiles.has(key)) tiles.set(key, []);
        const s = 0.8 + rr() * 0.5;
        tiles.get(key).push(m4.compose(new THREE.Vector3(px, -0.25, pz), q.setFromAxisAngle(up, rr() * 6.28), new THREE.Vector3(s, s * (0.8 + rr() * 0.5), s)).clone());
      }
    let blades = 0;
    for (const list of tiles.values()) {
      const im = new THREE.InstancedMesh(clump, grassMat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.computeBoundingSphere();
      im.receiveShadow = true;
      group.add(im);
      blades += list.length * 44;
    }
    return blades;
  }

  return {
    group, updateOcclusion, addGrass, treeCount: spots.length,
    tick(t) { wind.value = t; }, // seconds; drives the wind sway
    setNight(on) { leafMat.color.setHex(on ? 0x6a7a60 : 0xe8e6cc); grassMat.color.setHex(on ? 0x55604c : 0xffffff); },
  };
}
