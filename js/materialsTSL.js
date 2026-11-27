// (M4) Photoreal surface detail for the new renderer (WebGPURenderer + TSL). Nothing here runs on the classic path.
// The materials themselves (colour, photo maps, roughness - js/materials.js and the glTF) stay as they are; TSL nodes
// are layered on top, by material name, in world space so they never show a tile or a UV seam:
//  - macro breakup: large soft value / roughness variation (metres), so a 50 m wall isn't one flat repeated tile
//  - micro mottling and weathering: grime at the foot of walls, faint vertical streaks on concrete, wear on asphalt
//  - per-piece variation: each timber batten a slightly different tone (hash of its instance)
//  - physically based glass (index of refraction 1.52) with a stronger sky reflection
// Geometry is never touched (furniture rule). apply(root) can be called again for objects that arrive later
// (site plan): each material is upgraded once.
import { TSL } from "./gpu.js";

export function createLookTSL() {
  const {
    positionWorld, normalWorld, materialColor, materialRoughness, mx_fractal_noise_float, mx_noise_float, vec3, float,
    mix, smoothstep, clamp, abs, hash, instanceIndex, varying, uniform,
  } = TSL;
  const K = uniform(1); // master strength of all of it (0 = the M3 look), for A/B checks
  const P = positionWorld;
  // macro value breakup, ~4 m features (soft, 3 octaves), in -1..1
  const macro = (scale = 0.25) => mx_fractal_noise_float(P.mul(scale), 3, 2.0, 0.5);
  const vary = (amount, n) => float(1).add(n.mul(amount).mul(K)); // 1 +- amount
  // darker, rougher band at the foot of walls (rain splash / dust), fading out by 0.8 m above the ground slab
  const grime = (amount) => float(1).sub(float(amount).mul(K).mul(float(1).sub(smoothstep(0.0, 0.8, P.y))).mul(smoothstep(0.3, 0.7, float(1).sub(abs(normalWorld.y)))));

  const RECIPES = {
    plaster(m) { // limewash stucco: +-3.5 % over metres, +-2 % mottling, grime at the base
      const n = macro(0.25), fine = mx_noise_float(P.mul(2.2));
      m.colorNode = materialColor.mul(vary(0.06, n)).mul(vary(0.03, fine)).mul(grime(0.16));
      m.roughnessNode = clamp(materialRoughness.mul(vary(0.06, n)), 0.05, 1);
    },
    concrete(m) { // board-marked concrete: stronger breakup + faint vertical weathering streaks
      const n = macro(0.3);
      const streak = mx_noise_float(vec3(P.x.mul(3.5), P.y.mul(0.12), P.z.mul(3.5))).mul(0.5).add(0.5);
      m.colorNode = materialColor.mul(vary(0.09, n)).mul(float(1).sub(streak.mul(0.09).mul(K))).mul(grime(0.18));
      m.roughnessNode = clamp(materialRoughness.mul(vary(0.08, n)), 0.05, 1);
    },
    timber(m) { // teak: a slightly different tone per batten (instanced) or per ~1 m (panels), plus soft macro
      const piece = m.userData.instancedBattens ? varying(hash(instanceIndex)) : mx_noise_float(P.mul(0.9)).mul(0.5).add(0.5);
      const tone = float(0.93).add(piece.mul(0.12)); // 0.93 .. 1.05
      const base = m.colorNode ?? materialColor; // (instanced battens already sample their UV-jittered colour)
      m.colorNode = base.mul(mix(float(1), tone, K)).mul(vary(0.03, macro(0.4)));
      m.roughnessNode = clamp(materialRoughness.mul(mix(float(1), float(1.08).sub(piece.mul(0.16)), K)), 0.05, 1);
    },
    paint(m) { // powder-coated frames, railings, fascias: micro roughness variation only (no tint)
      m.roughnessNode = clamp(materialRoughness.mul(vary(0.15, mx_noise_float(P.mul(6.0)))), 0.05, 1);
    },
    glass(m) { // physically based clear glass: IOR 1.52, crisp, a stronger sky / tree reflection
      m.ior = 1.52; m.roughness = 0.03; m.envMapIntensity = 5.5; m.specularIntensity = 1;
    },
    asphalt(m) { // roads / drive: large patches +-7 %, fine aggregate +-4 %, slightly glossier wheel tracks
      const n = macro(0.12), fine = mx_noise_float(P.mul(3.0));
      m.colorNode = materialColor.mul(vary(0.07, n)).mul(vary(0.04, fine));
      m.roughnessNode = clamp(materialRoughness.mul(vary(0.05, n)), 0.05, 1);
    },
    paving(m) { // concrete pads / pavers: gentle tonal variation
      m.colorNode = materialColor.mul(vary(0.04, macro(0.2))).mul(vary(0.02, mx_noise_float(P.mul(1.5))));
    },
    lawn(m) { // grass: drier yellow-green and lusher blue-green patches over 15-30 m, plus mowing-scale mottling
      const t = smoothstep(-0.45, 0.45, macro(0.05));
      const hue = mix(vec3(1.14, 1.04, 0.72), vec3(0.84, 1.05, 1.0), t);
      m.colorNode = materialColor.mul(mix(vec3(1), hue, K)).mul(vary(0.10, mx_noise_float(P.mul(0.8))));
    },
  };
  // material name -> recipe (the names the glTF / site plan / js/materials.js give)
  const RULES = [
    [/^M_plaster_(cream|grey)/, "plaster"], [/^M_concrete/, "concrete"],
    [/^M_teak_(batten|timber|deck)/, "timber"],
    [/^M_metal_(grey|dark)/, "paint"],
    [/^Glazing-Clear/, "glass"],
    [/^SITE_road|^M_site_paving/, "asphalt"], [/^SITE_pad/, "paving"], [/^SITE_grass/, "lawn"],
  ];
  const done = new WeakSet(), counts = {};
  function upgrade(m, mesh) {
    if (!m || done.has(m) || !m.name) return;
    const rule = RULES.find(([re]) => re.test(m.name.replace(/__raw$/, "")));
    if (!rule) return;
    done.add(m);
    if (mesh?.isInstancedMesh && /_box_inst$/.test(mesh.name)) m.userData.instancedBattens = true;
    RECIPES[rule[1]](m);
    m.needsUpdate = true;
    counts[rule[1]] = (counts[rule[1]] ?? 0) + 1;
  }
  return {
    strength: K, counts,
    apply(root) { root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) upgrade(m, o); }); },
  };
}
