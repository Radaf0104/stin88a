// Realistic materials for the Revit export.
// Every Revit material name is matched to a "preset" (plaster, teak, stone tile, glass, chrome...). Textures are generated
// procedurally in the browser (no downloads), tile seamlessly, and are mapped in metres (see addBoxUVs).
import * as THREE from "three";

// ---------- tileable noise ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function valueNoise(size, cells, seed) {
  const r = rng(seed), grid = new Float32Array(cells * cells).map(() => r());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = (x / size) * cells, gy = (y / size) * cells, x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (i, j) => grid[((j + cells) % cells) * cells + ((i + cells) % cells)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx, b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    out[y * size + x] = a + (b - a) * sy;
  }
  return out;
}
function fbm(size, base, octaves, seed) {
  const out = new Float32Array(size * size); let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function toTexture(size, fn, srgb) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d"), img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = fn(i % size, (i / size) | 0, i);
    const [r, g, b] = Array.isArray(v) ? v : [v, v, v];
    img.data[i * 4] = r * 255; img.data[i * 4 + 1] = g * 255; img.data[i * 4 + 2] = b * 255; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- texture sets (each = { map, bump, size in metres }) ----------
const S = 512;
const cache = {};
function textures(kind) {
  if (cache[kind]) return cache[kind];
  let set;
  if (kind === "plaster") {
    const n = fbm(S, 4, 5, 11), f = fbm(S, 64, 2, 12);
    set = { size: 1.6, map: toTexture(S, (x, y, i) => 0.9 + n[i] * 0.07 + f[i] * 0.03, true), bump: toTexture(S, (x, y, i) => n[i] * 0.4 + f[i] * 0.6), bumpScale: 1.2 };
  } else if (kind === "concrete") {
    const n = fbm(S, 3, 5, 21), p = fbm(S, 96, 1, 22);
    set = { size: 2.0, map: toTexture(S, (x, y, i) => 0.82 + n[i] * 0.16 - (p[i] > 0.86 ? 0.12 : 0), true), bump: toTexture(S, (x, y, i) => n[i] * 0.5 + (p[i] > 0.86 ? 0 : 0.5)), bumpScale: 1.5 };
  } else if (kind === "wood" || kind === "deck") {
    const n = fbm(S, 4, 4, 31), fine = fbm(S, 48, 2, 32), planks = kind === "deck" ? 7 : 1;
    const g = (x, y, i) => {
      const u = x / S, v = y / S;
      const ring = 0.5 + 0.5 * Math.sin((u * (kind === "deck" ? 60 : 46) + n[i] * 2.5) * Math.PI); // straight-ish grain along V
      let val = 0.8 + ring * 0.1 + fine[i] * 0.06;
      if (planks > 1) { const pu = (u * planks) % 1; if (pu < 0.025 || pu > 0.975) val *= 0.35; val *= 0.92 + 0.08 * ((Math.floor(u * planks) * 37) % 7) / 7; }
      return val;
    };
    // grain runs along V; the UV mapper puts V along the longest direction of vertical slats
    set = { size: kind === "deck" ? 1.0 : 0.6, map: toTexture(S, (x, y, i) => Math.min(1, g(x, y, i)), true), bump: toTexture(S, (x, y, i) => g(x, y, i)), bumpScale: 0.5 };
  } else if (kind === "tile") {
    const n = fbm(S, 6, 4, 41), tiles = 2, grout = 3;
    const tint = Array.from({ length: 4 }, (_, k) => 0.96 + ((k * 53) % 9) / 200);
    const f = (x, y, i) => {
      const tx = Math.floor((x / S) * tiles), ty = Math.floor((y / S) * tiles);
      const gx = x % (S / tiles), gy = y % (S / tiles);
      if (gx < grout || gy < grout) return 0.68;
      return tint[(tx + ty * tiles) % 4] * (0.93 + n[i] * 0.07);
    };
    set = { size: 1.2, map: toTexture(S, f, true), bump: toTexture(S, (x, y, i) => (f(x, y, i) < 0.7 ? 0 : 0.8)), bumpScale: 1.0 };
  } else if (kind === "fabric") {
    const n = fbm(S, 8, 3, 51);
    const f = (x, y, i) => 0.85 + 0.08 * (((x >> 1) + (y >> 1)) % 2) + n[i] * 0.07;
    set = { size: 0.3, map: toTexture(S, f, true), bump: toTexture(S, f), bumpScale: 0.6 };
  } else if (kind === "brushed") {
    const n = fbm(S, 4, 2, 61);
    const f = (x, y, i) => 0.8 + 0.2 * ((Math.sin(y * 1.7 + n[i] * 40) + 1) / 2);
    set = { size: 0.5, map: null, rough: toTexture(S, f), bump: null };
  } else if (kind === "grass") {
    const n = fbm(S, 6, 5, 71), f = fbm(S, 128, 1, 72);
    set = { size: 6, map: toTexture(S, (x, y, i) => { const v = 0.7 + n[i] * 0.35 + f[i] * 0.12; return [v * 0.85, v, v * 0.7]; }, true), bump: toTexture(S, (x, y, i) => f[i]), bumpScale: 2 };
  }
  cache[kind] = set;
  return set;
}

// ---------- real photo textures (CC0, Poly Haven): colour + bump (normal) + roughness, tiled in metres ----------
// WebP (tools/encode-textures.js): colour + normal 1024 px, roughness 512 px. `avg` = each map's average colour, used as a
// 1-pixel stand-in until the photo has downloaded, so surfaces already look right (just smooth) on the first frame.
const REAL = {
  plaster: { id: "white_plaster_02", size: 2.2, tint: 0.7, bumpOnly: true, avg: { nor: [129, 129, 252], rough: [231, 231, 231] } }, // clean white like the renders: keep only the fine bump
  wood: { id: "oak_veneer_01", size: 1.4, tint: 0.72, avg: { diff: [161, 126, 87], nor: [127, 127, 254], rough: [135, 135, 135] } },
  deck: { id: "oak_veneer_01", size: 1.4, tint: 0.55, avg: { diff: [161, 126, 87], nor: [127, 127, 254], rough: [135, 135, 135] } },
  concrete: { id: "concrete_floor_worn_001", size: 2.5, tint: 0.5, avg: { diff: [86, 86, 84], nor: [128, 127, 251], rough: [138, 138, 138] } },
  tile: { id: "marble_01", size: 1.8, tint: 0.85, avg: { diff: [177, 157, 122], nor: [125, 124, 253], rough: [129, 129, 129] } },
  grass: { id: "leafy_grass", size: 3.5, tint: 1, bumpOnly: true, noRough: true, avg: { nor: [127, 128, 226] } }, // the photo is dry leaves: keep its bump, colour it green
  asphalt: { id: "asphalt_02", size: 4, tint: 1, avg: { diff: [90, 90, 85], nor: [127, 127, 248], rough: [196, 196, 196] } },
};
// Photos are not fetched while the building is being built: startTextureLoading() (called once the first frame is on
// screen) downloads them, so the model, code and sky get the bandwidth first.
const imgLoader = new THREE.ImageLoader();
const pending = [];
let loadingStarted = false;
function fetchInto(t, url) {
  imgLoader.load(url, (img) => {
    t.image = img;
    t.dispose(); // the 1-pixel stand-in was already uploaded: free it so the full-size photo gets new GPU storage
    t.needsUpdate = true;
  });
}
export function startTextureLoading() {
  if (loadingStarted) return;
  loadingStarted = true;
  for (const [t, url] of pending.splice(0)) fetchInto(t, url);
}
const realCache = {};
function realTextures(kind) {
  const r = REAL[kind];
  if (!r) return null;
  if (realCache[kind]) return realCache[kind];
  const load = (suffix, srgb) => {
    const px = document.createElement("canvas"); px.width = px.height = 1;
    const [cr, cg, cb] = r.avg[suffix];
    const g = px.getContext("2d"); g.fillStyle = `rgb(${cr},${cg},${cb})`; g.fillRect(0, 0, 1, 1);
    const t = new THREE.Texture(px);
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.repeat.set(1 / r.size, 1 / r.size);
    const url = `assets/tex/${r.id}_${suffix}.webp`;
    if (loadingStarted) fetchInto(t, url); else pending.push([t, url]);
    return t;
  };
  // only the maps a material will actually use are downloaded (bump-only sets skip the colour photo, the lawn its roughness)
  return (realCache[kind] = { map: r.bumpOnly ? null : load("diff", true), normal: load("nor", false), rough: r.noRough ? null : load("rough", false), tint: r.tint });
}

// ---------- presets ----------
const hex = (c) => new THREE.Color(c);
function rgb(info) { const [r, g, b] = info?.color ?? [200, 200, 200]; return new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear(); }

export function presetFor(name, info = {}) {
  const n = name.toLowerCase(), cls = (info.class || "").toLowerCase();
  if (/water/.test(n)) return { kind: "water" };
  if (/frosty/.test(n)) return { kind: "glass", frosted: true };
  if (/glass|glazing/.test(n) || cls === "glass" || info.transparency >= 50) return { kind: "glass" };
  if (/light source/.test(n)) return { kind: "emissive", color: 0xffe2b8 };
  if (/chrome|polished/.test(n)) return { kind: "metal", color: 0xe8e8e8, rough: 0.12 };
  if (/brushed|stainless|alumin|alumun/.test(n)) return { kind: "metal", color: 0xc9c9c6, rough: 0.32, tex: "brushed" };
  if (/paint finish|steel black|gate_steel|black paint|metal - paint|railing|painted/.test(n)) return { kind: "paint", color: n.includes("grey") && !n.includes("dark") ? 0x8a8a87 : 0x2e2f31, rough: 0.45, metal: 0 }; // (M1) paint / powder coat is a dielectric: metal 0.35 mirrored the sky (navy frames)
  if (cls === "metal" || /metal|steel/.test(n)) return { kind: "metal", color: 0xa8a8a6, rough: 0.4 };
  if (/porcelain|ceramic|marble/.test(n) || (/white/.test(n) && /plumb/.test(info.cats || ""))) return { kind: "porcelain", color: n.includes("marble") ? 0x9c9a96 : 0xf6f5f1 };
  if (/deck/.test(n)) return { kind: "wood", tex: "deck", color: rgb(info) };
  if (n === "default new material" || /^wood 1/.test(n)) return { kind: "wood", tex: "wood", color: 0xb39577, battens: true }; // facade teak slats
  if (/wood|timber|pine|birch|ash|oak|walnut|madeira|laminate|lumber|back board|bois/.test(n) || /wood/.test(cls)) return { kind: "wood", tex: "wood", color: rgb(info) };
  if (/fabric|linen|textile|toalha|estofado|cor collection|lacquerable/.test(n) || /fabric|textile/.test(cls)) return { kind: "fabric", color: /cor collection|lacquerable/.test(n) ? 0xb9b1a6 : rgb(info) };
  if (/tile|spesi|default floor/.test(n)) return { kind: "tile", color: 0xe4ddd1 };
  if (/shingle|roofing/.test(n)) return { kind: "plain", color: 0x4b4b4b, rough: 0.9 };
  if (/grass/.test(n)) return { kind: "grass" };
  if (/soil|earth|sand|gravel|paving/.test(n)) return { kind: "asphalt", color: 0xffffff }; // site paving / driveway
  if (/cast-in-place|precast|concrete 1/.test(n)) return { kind: "concrete", color: 0xc4c0b8 };
  if (/cement|concrete|gypsum|finishes|default wall|qarc white|^white$|^grey$|ceiling/.test(n)) return { kind: "plaster", color: n === "grey" ? 0xcfcbc4 : 0xe4cfb8 }; // warm cream like the renders
  if (/black|screen|plastic|rubber|m1_b00/.test(n)) return { kind: "plain", color: info.color && info.color[0] > 100 ? rgb(info) : 0x1e1f21, rough: /screen/.test(n) ? 0.15 : 0.45 };
  return { kind: "plain", color: rgb(info), rough: 0.7 };
}

const matCache = new Map(), lookCache = new Map();
// Many Revit materials end up looking identical (CEMENT, CONCRETE, Default Wall, Gypsum… are all the same cream plaster).
// They share one material, so the building can be drawn with one mesh per *look* per floor instead of per Revit name.
const lookKey = (p) => JSON.stringify(p, (k, v) => (v && v.isColor ? v.getHexString() : v));
export function materialFor(name, info) {
  if (matCache.has(name)) return matCache.get(name);
  const p = presetFor(name, info);
  const key = lookKey(p);
  if (lookCache.has(key)) { const shared = lookCache.get(key); matCache.set(name, shared); return shared; }
  let m;
  const tex = (kind) => {
    const t = textures(kind);
    const out = {};
    for (const k of ["map", "bump", "rough"]) if (t[k]) { out[k] = t[k].clone(); out[k].repeat.set(1 / t.size, 1 / t.size); out[k].needsUpdate = true; }
    return { ...out, bumpScale: t.bumpScale };
  };
  switch (p.kind) {
    case "glass":
      // Clear glass: slightly dark grey-green tint; it becomes more opaque and mirror-like at grazing angles (Fresnel),
      // so facades seen at an angle reflect sky and trees while glass seen head-on shows the room behind it.
      m = new THREE.MeshPhysicalMaterial({
        color: p.frosted ? 0xe8f2f2 : 0x4f5c5c, metalness: 0, roughness: p.frosted ? 0.45 : 0.02, transparent: true,
        opacity: p.frosted ? 0.55 : 0.28, envMapIntensity: 2.2, specularIntensity: 1, side: THREE.DoubleSide, depthWrite: false,
      });
      if (!p.frosted) m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", `
          float glassFr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 4.0);
          diffuseColor.a = mix(diffuseColor.a, 0.9, glassFr);
          #include <opaque_fragment>`);
      };
      m.userData.glass = true;
      break;
    case "water":
      m = new THREE.MeshPhysicalMaterial({ color: 0x4fa3b5, roughness: 0.03, transparent: true, opacity: 0.75, envMapIntensity: 1.5, side: THREE.DoubleSide });
      break;
    case "emissive":
      m = new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 1.2 });
      m.userData.lamp = true;
      break;
    case "metal": {
      const t = p.tex ? tex(p.tex) : {};
      m = new THREE.MeshStandardMaterial({ color: p.color, metalness: 1, roughness: p.rough, roughnessMap: t.rough ?? null, side: THREE.DoubleSide });
      break;
    }
    case "paint":
      m = new THREE.MeshStandardMaterial({ color: p.color, metalness: p.metal, roughness: p.rough, side: THREE.DoubleSide });
      break;
    case "porcelain":
      // glazed ceramic: a standard material with a crisp, slightly stronger reflection gives the look of the former
      // clearcoat layer without its second specular lobe (tiles cover whole bathroom floors and walls)
      m = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.1, envMapIntensity: 1.25, side: THREE.DoubleSide });
      break;
    case "grass": { // lawn: green colour variation (generated) + the photo's bump
      const r = realTextures("grass"), g = tex("grass");
      m = new THREE.MeshStandardMaterial({ color: 0x7fa05a, map: g.map, normalMap: r.normal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95 });
      break;
    }
    case "asphalt": {
      const r = realTextures("asphalt");
      m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: r.map, normalMap: r.normal, roughnessMap: r.rough, roughness: 1 });
      break;
    }
    case "plain":
      m = new THREE.MeshStandardMaterial({ color: p.color, roughness: p.rough ?? 0.7, side: THREE.DoubleSide });
      break;
    default: { // plaster, concrete, wood, tile, fabric
      const kind = p.tex ?? p.kind;
      const r = realTextures(kind);
      if (r) { // photo texture, gently tinted toward the Revit/preset colour
        const col = new THREE.Color(p.color).lerp(new THREE.Color(1, 1, 1), p.battens ? 0.62 : r.tint);
        const ns = kind === "plaster" ? 1.3 : 0.8; // plaster: a bit more stucco grain for raking sun
        m = new THREE.MeshStandardMaterial({
          color: r.map ? col : new THREE.Color(p.color).lerp(new THREE.Color(1, 1, 1), 0.35),
          map: r.map, normalMap: r.normal, normalScale: new THREE.Vector2(ns, ns), roughnessMap: r.rough, roughness: 1,
        });
        if (p.battens) addBattens(m);
        break;
      }
      const t = tex(kind);
      const rough = { plaster: 0.92, concrete: 0.85, wood: 0.62, deck: 0.7, tile: 0.35, fabric: 0.95 }[kind] ?? 0.8;
      m = new THREE.MeshStandardMaterial({ color: p.color, map: t.map ?? null, bumpMap: t.bump ?? null, bumpScale: t.bumpScale ?? 1, roughness: rough, side: THREE.DoubleSide });
    }
  }
  m.name = name;
  m.userData.preset = p.kind;
  // Revit solids are closed and consistently wound, so opaque surfaces only need their front side (half the work).
  if (!m.transparent) m.side = THREE.FrontSide;
  matCache.set(name, m);
  lookCache.set(key, m);
  return m;
}

// Vertical timber battens on flat Revit panels: every 10 cm a 6 cm batten with rounded (shaded) edges, a dark 4 cm gap
// and a slightly different tone per batten. The panels stay flat geometry; only the shading changes.
// Battens follow world x or z (whichever runs along the panel), so they line up across neighbouring panels.
function addBattens(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBatPos; varying vec3 vBatN;")
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
        vBatPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vBatN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBatPos; varying vec3 vBatN;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        if (abs(vBatN.y) < 0.5) {
          float h = abs(vBatN.x) > abs(vBatN.z) ? vBatPos.z : vBatPos.x;
          float period = 0.10, w = 0.6;
          float t = fract(h / period);
          float idx = floor(h / period);
          float edge = smoothstep(0.0, 0.12, t) * smoothstep(w, w - 0.12, t);   // rounded batten edges
          float tone = 0.93 + 0.12 * fract(sin(idx * 12.9898) * 43758.5453);   // per-batten colour variation
          float shade = t < w ? mix(0.72, 1.0, edge) * tone : 0.42;           // darker gap behind the battens
          diffuseColor.rgb *= shade;
        }`);
  };
  m.customProgramCacheKey = () => "battens";
}

// Box-projected UVs in metres (positions already in metres). For each triangle the axis most aligned with its normal
// is dropped; vertical faces put V on the world-up axis so wood grain / slats run vertically like the renders.
export function addBoxUVs(geo) {
  const p = geo.attributes.position.array, uv = new Float32Array((p.length / 3) * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), ab = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.fromArray(p, i); b.fromArray(p, i + 3); c.fromArray(p, i + 6);
    nrm.subVectors(c, b).cross(ab.subVectors(a, b));
    const ax = Math.abs(nrm.x), ay = Math.abs(nrm.y), az = Math.abs(nrm.z);
    for (let k = 0; k < 3; k++) {
      const x = p[i + k * 3], y = p[i + k * 3 + 1], z = p[i + k * 3 + 2], o = (i / 3 + k) * 2;
      if (ay >= ax && ay >= az) { uv[o] = x; uv[o + 1] = z; }        // floors / ceilings (three.js y = up)
      else if (ax >= az) { uv[o] = z; uv[o + 1] = y; }               // walls facing x
      else { uv[o] = x; uv[o + 1] = y; }                             // walls facing z
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export function setLampGlow(k) { for (const m of matCache.values()) if (m.userData.lamp) m.emissiveIntensity = k; }
export function allMaterials() { return [...lookCache.values()]; }
