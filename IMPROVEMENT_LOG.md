# STIN 88A V5: improvement log

A standing task: improve performance, colour and assets, round after round. Every round is measured, written up here
and saved as a local git commit. Nothing is pushed to the live site (still `94e0ddf`, backup tag `v5-live-94e0ddf`).

**How it is measured:** `tools/bench.js` scorecard (fixed camera, 1280×720 canvas, pixel ratio 1, median of 7 × 20
GPU-synced frames), plus `performance.getEntriesByType("resource")` for download size.
The Claude browser pane was hidden during these rounds. Download, draw-call, triangle and GPU frame-time numbers are
valid; start-up CPU times are not (a hidden page runs throttled). There was no network or CPU throttling available
in this browser, so phone numbers are not measured yet.

## Baseline (commit b08f6dc: template rooms K.401/405/407/413/416 restyled)
| metric | value |
|---|---|
| download (all requests) | 22.15 MB, 124 requests: levels .bin 13.4 MB, .gltf JSON 2.3 MB, KTX2 4.4 MB, sky HDR 1.1 MB |
| draw calls (overview, moving) | **790** |
| frame time (1280×720, moving, no AO) | **26.2 ms** |
| triangles drawn / in scene | 766 k / 949 k |
| meshes / materials / double-sided materials | 1105 / 332 / 235 |

## Round 1: draw calls of the style rooms
The five style rooms arrive as ~311 separate meshes (one per room × surface × source material, so they can be
restyled), which added ~310 draw calls.
- **js/roomstyle.js:** after restyling, the pieces of a room that share one material are joined into one mesh in world space. The vertices are unchanged: quantized attributes are converted to floats first, and mirrored copies get their winding flipped back. Lamps, curtains, TVs and lights stay separate.
- **tools/pack-levels.mjs:** style-room nodes may now merge inside the packer too, but only within one room and one surface (curtains and lamps excluded). This has a small effect, because 06s already makes one piece per room / surface / material.

| metric | before | after |
|---|---|---|
| draw calls | 790 | **593** (−25 %) |
| frame time | 26.2 ms | **12.3 ms** |
| meshes / materials | 1105 / 332 | 893 / 313 |
| style-room meshes | 311 | 137 |
| scene triangles | 949 416 | 949 416 (geometry identical) |

Checked: K.401 renders the same as before (`tools/out/r1_K401_merged.jpg`), with no console errors in a fresh tab.

## Round 2: hide what can't be seen, instance the heavy furniture copies
- **Overview culling (js/main.js showBand):** from outside, the TVs (on inner walls, ~2 draw calls each) and the corridor entrance doors are not drawn, like the interior doors and bathroom fittings already weren't. The floor and room views still show them (checked: 98 TV meshes and 42 entrance doors visible on Level 4).
- **GPU instancing (tools/pack-levels.mjs instanceHeavy):**
  - About 36 % of all triangles (310 k of 858 k) were copies of the same furniture: toilets, chairs, beds, basins from the template rooms.
  - Shared meshes with ≥ 400 triangles and ≥ 3 copies are now written once and drawn as `EXT_mesh_gpu_instancing` → `THREE.InstancedMesh`, with one exact transform per copy.
  - Mirrored copies use a pre-mirrored mesh (x negated, winding flipped), so no instance has a negative scale.
  - Lighter meshes are still merged per material.
- **js/main.js loader:** bounds of instanced meshes cover all instances, and walk-mode collision includes every instance.

| metric | round 1 | after culling | after instancing |
|---|---|---|---|
| download (all) | 22.15 MB | 22.15 MB | **19.45 MB** (levels 20.03 → 17.52 MB in the pack report) |
| draw calls (overview) | 593 | **495** | 574 (+79: each instanced primitive is a call) |
| frame time (1280×720) | 12.3 ms | ~12–20 ms (noisy: hidden pane) | 12.2 ms |
| scene triangles | 949 416 | 949 416 | 949 416 (same geometry) |
| instanced meshes / instances | 0 | 0 | 148 / 569 |

Checked: K.404 and K.408 (a mirrored copy) look the same as before, with fittings in place (`tools/out/r2_K404.jpg`, `r2_K408.jpg`). No console errors.
**Next:** raise INST_MIN_TRIS (only the very heaviest meshes instanced) to win back draw calls; a lighter sky / environment (1.1 MB HDR); research ideas (pending).

## Round 3: instancing threshold, lighter sky
- **Instancing threshold (tools/pack-levels.mjs):** a mesh is instanced only when its copies save ≥ 5000 triangles: desk chairs, toilets, basins, beds, globe lamps. That gives about 75 % of the saving with a third of the instanced draw calls; the rest is merged per material again.
- **Day sky 1k → 512 px HDR** (`assets/sky/autumn_field_puresky_512.hdr`, made with tools/shrink-hdr.mjs: 1.06 → 0.28 MB). The sky is a smooth gradient, so the overview looks the same (`tools/out/r3_overview.jpg`). The stand-in environment cube was cut 256 → 128 to match, so there is no shader rebuild when the photo arrives (31 programs, as before).

| metric | round 2 | round 3 |
|---|---|---|
| download (all) | 19.45 MB | **19.04 MB** |
| draw calls (overview) | 574 | **515** |
| instanced meshes / instances | 148 / 569 | 66 / 339 |
| scene triangles | 949 416 | 949 416 |
| sky HDR | 1.06 MB | 0.28 MB |

**Research in** (research/website-improvement.md, research/v5-perf-color-ideas.md): the live site is ready only after ~22 s because the jsDelivr ES modules load one after another (KTX2Loader starts at 9.4 s, L1.gltf at ~16 s). That is the next round. Colour: blacks are lifted, highlights too bright and there is a slight green tint against the hero render (exposure 1.8 on Neutral).

## Round 4: no more load waterfall
The research measured the live site: building ready only after ~22 s, because the ES modules from jsDelivr are discovered one import level at a time (main → passes/controls → KTX2Loader/meshopt only after model.json → WorkerPool/ktx-parse → basis transcoder): 4–5 round trips in a row before the first level file is even requested.
- **index.html:** modulepreload for the whole module tree (10 local modules + 22 three.js addons, including KTX2Loader, meshopt and their own imports) and preload (as fetch, crossorigin, the same mode the loaders use, so nothing is fetched twice) for the basis transcoder js + wasm, every level .gltf + .bin, the site plan and the 512 px sky. The unused js/landscape.js preload was removed.

| metric (local server, cached; a phone network will gain far more) | before | after |
|---|---|---|
| KTX2Loader requested at | 205 ms | **24 ms** |
| basis transcoder requested at | 303 ms | **25 ms** |
| L1.gltf requested at | 237 ms | **25 ms** |
| ready (all floors, shaders compiled) | 1415 ms | **1229 ms** |
| duplicate downloads | – | none |

## Round 5: colour, matched to the hero render
Measured from the hero render's own camera (gallery `r02`, terrace facade; new debug helper `STIN.renderCam(i)`), with frames downsampled to 200 px. The research's snippet gives luminance p5/p50/p95 and mean RGB.
- **js/environment.js `TIMES.day`:**
  - Exposure 1.8 → **1.2**, with a stronger sun (5 → 6.8). The high exposure was lifting the blacks and pushing the plaster into the highlight shoulder, which gave the milky look.
  - Sky and env fill lower (env .26 → .22, ground fill .36 → .28), less haze (fog .0022 → .0015, skyHaze .2 → .15).
  - Grade: lift .03 → 0, contrast 1.08 → 1.14, saturation 1.04. Highlights warmer and less green (R +4.5 %, G −1.5 %), shadows slightly cooler and less green.
- Walk mode and room views use their own exposure, so interiors are unchanged (checked K.405 in walk: `tools/out/c2_walk_K405.jpg`).

| | p5 / p50 / p95 | mean RGB |
|---|---|---|
| hero render (Unreal) | 33 / 136 / 232 | 142 / 142 / 133 |
| V5 before | 99 / 170 / 239 | 156 / **166** / 151 (green) |
| V5 after | 83 / 158 / 238 | 143 / 151 / 136 |

The remaining gap in p5 is content, not tone: the render's darkest 5 % are trees and deep shade, which our scene doesn't have (lawn is its darkest large area). Pictures: `tools/out/c1_r02_before.jpg`, `c1_C_exp12_grade_env.jpg`.

## Round 6: a phone profile
Every device got the full desktop settings: a 4096² sun shadow map (~64 MB of GPU memory), 6 mood lights (each one shaded on every pixel) and up to 1.5× pixel density.
- **js/main.js:** `phone` = a touch screen whose short side is ≤ 900 px. Phones get the same look with a 2048 shadow map, 3 mood lights and a 1.25× sharpness cap. Desktop and tablets are unchanged.

| | desktop | phone (375×812 emulated) |
|---|---|---|
| sun shadow map | 4096 | **2048** (a quarter of the memory) |
| lights in the scene | 8 | **5** |
| pixel-density cap | 1.5 | **1.25** (≈30 % fewer pixels than 1.5 on a 3× phone screen) |

Checked: both profiles load without console errors. There is no real phone GPU here to time it on.

## Round 7: a regression fixed, lighter railings
- **Bug found and fixed (introduced by round 4):** each level's glTF points at the same shared textures (`data/levels/tex/*.ktx2`). With the levels now loading in parallel, every level's parser requested the same files at the same moment, before any was cached, so ~3 MB of textures downloaded twice (download measured 22.4 MB). **js/main.js:** one shared promise per texture URL in front of the KTX2Loader, so each texture is fetched and transcoded once and shared by every level. Download is back to **19.04 MB** with 0 duplicates and 64 GPU textures.
- **Railings (tools/pack-levels.mjs):** the metal railing meshes are simplified with an ~8 mm error bound (most of their triangles were 8 mm edge bevels) and locked borders. L2: 17 516 → 6 018 triangles; L3/L4: 6.9 k → 5.3 k. Visually unchanged (`tools/out/r7_railings.jpg`).
- **Tried and dropped:**
  - Simplifying the flat plaster shell gave only −2 %: our merged shell is already lean (5–11 k triangles per floor). The research saw the older live build.
  - The facade's timber battens (70 k triangles on L1) don't simplify within 8 mm. Their triangles are real slat geometry, not bevels.

| metric | round 6 | round 7 |
|---|---|---|
| download (measured in the browser) | 19.04 MB* | **19.04 MB**, 0 duplicate requests |
| scene triangles | 949 416 | **934 580** |
| draw calls (overview) | 515 | 515 |
| ready (local) | 1229 ms | 1215 ms |

\*Round 4 really downloaded 22.4 MB because of the duplicate textures. The 19.04 MB in rounds 4–6 was measured before the parallel requests started colliding.

## Round 8: one material per name across the levels
Every level file brought its own copy of the same Blender material (same textures, shared since round 7), so the scene had 313 materials.
- **js/main.js loader:** the first material of each name is reused by every level, except the materials replaced by the site's own shaders (glass, water) and the style rooms' own materials (js/roomstyle.js).

| metric | round 7 | round 8 |
|---|---|---|
| materials in the scene | 313 | **201** |
| shader programs | 31 | 31 |
| draw calls | 515 | 515 |
| ready (local) | 1215 ms | **1052 ms** |
| hero-camera colour p5/p50/p95, RGB | 83/158/238, 143/151/136 | identical (the look is unchanged) |

GPU frame time this round: 5.4 ms at 1280×720. The browser pane was visible for once; earlier rounds' 12 ms were measured in a hidden, throttled tab and aren't comparable.

## Round 9: lighter normal maps
- **tools/pack-levels.mjs:** the UASTC normal maps (already 512 px) are encoded with RDO 3 instead of 1.5. A test on M_plaster_cream_nor gave 180 → 155 KB at RDO 3 and 141 KB at 4.5; 3 was chosen, since it barely affects fine relief.

| metric | round 8 | round 9 |
|---|---|---|
| normal maps (12 files) | 1686 KB | **1534 KB** |
| KTX2 total | 4.32 MB | 4.18 MB |
| download (measured in the browser) | 19.04 MB | **18.89 MB**, 0 duplicates |
| meshes with normal maps | 299 | 299 (all still load) |

## Status after 9 rounds (vs baseline)
| | baseline (b08f6dc) | now |
|---|---|---|
| download | 22.15 MB | **18.89 MB** (−15 %) |
| draw calls (overview) | 790 | **515** (−35 %) |
| scene triangles | 949 k | 935 k |
| materials | 332 | 201 |
| first level request (local) | after a 4–5-step module waterfall | at ~25 ms, everything in parallel |
| colour vs hero render (RGB) | 156/166/151 (milky, green) | 143/151/136 |
| phones | desktop settings | own profile (2048 shadow map, 3 lights, 1.25× pixels) |

**Ideas for the next rounds:**
- Load the first floor's shell first and the other floors' furniture when idle (phones).
- Cheap contact shadows under furniture.
- Interior colour match against the room renders.
- CC0 fabric textures (Poly Haven linen / bouclé) for the style rooms.

## Round 10: colour preset from research/color-preset.json, measured and refined
Every variant was measured from the hero camera (luminance p5 / p50 / p95 | mean RGB). Target: 33 / 136 / 232 | 142 / 142 / 133.

| variant | settings | result |
|---|---|---|
| round 5 (before) | Neutral, exposure 1.2, env .22 | 83 / 158 / 238 \| 143 / 151 / 136 |
| research A | Neutral 1.15, env **.6**, contrast 1.10, black point −.03, WB r1.03 g.98 | 96 / 165 / 241 \| 152 / 161 / 151 (the high env lifts the blacks) |
| research B | **AgX** 1.0, env .6 | 106 / 157 / 224 \| 155 / 154 / 147 (no clipping, good tint, but AgX's toe lifts the blacks) |
| B with env .22 | AgX 1.0–1.25 | p5 99–106, p95 213–218 (AgX is too flat here) |
| C1 | round 5 + stronger WB (warm g .965, cool g .955) | 82 / 155 / 234 \| 144 / 147 / 135 |
| **C4 (applied)** | Neutral, **exposure 1.0, sun 7.8, env .2, contrast 1.16**, WB as C1 | **71 / 149 / 234 \| 138 / 142 / 130** |

- C4 is the closest so far: highlights match (234 vs 232), green is gone (R and G within 4, B 8–12 below, as in the render), and midtones are 13 brighter.
- The remaining p5 gap is scene content (the render's tree shadows).
- Picture: `tools/out/cp_C4.jpg`. Applied in js/environment.js `TIMES.day`.

## Round 11: midtone gamma (research colour v2) and the lawn hue
- **js/grade.js:** a new `gamma` control in the in-material grade: `pow(c, gamma)` on the display colour after contrast, which leaves 0 and 1 in place. It defaults to 1, so other times of day are unaffected. Day uses **1.08**.
- Gamma trials (hero camera; plaster and lawn swatches):

| gamma | p5 / p50 / p95 | mean RGB | plaster | lawn |
|---|---|---|---|---|
| 1.00 | 71 / 149 / 234 | 138 / 142 / 130 | #d8cfbc | #66621a |
| 1.08 | 69 / 145 / 233 | 133 / 138 / 127 | #d8ceba | #5f5b16 |
| 1.12 | 66 / 143 / 233 | 131 / 136 / 126 | #d8ceb9 | #5c5814 |
| 1.17 | 63 / 141 / 233 | 129 / 134 / 125 | #d8cdb8 | #585412 |

  Gamma doesn't move the plaster but darkens the lawn further from the render's #727539, so the mild 1.08 was chosen.
- **Lawn base colour (tools/build-siteplan.mjs):** [0.27, 0.30, 0.13] → **[0.275, 0.31, 0.165]**: a little more blue, with green kept just above red after the warm grade. Tried first: [0.29, 0.30, 0.17] read brown (#675b23) and [0.26, 0.32, 0.16] read green again (mean G 8 above R).

| | p5 / p50 / p95 | mean RGB | lawn |
|---|---|---|---|
| hero render | 33 / 136 / 232 | 142 / 142 / 133 | #727539 |
| round 10 | 71 / 149 / 234 | 138 / 142 / 130 | #66621a |
| **round 11** | **69 / 145 / 233** | **134 / 139 / 131** | #615e21 |

Picture: `tools/out/r11_hero.jpg`. The remaining p5 / p50 gap is the histogram's shape (the render has ~22 % bright sky and deep tree shade), not the tone settings.

## Round 12: material relief in the template rooms (assets, no geometry, no download)
- **js/roomstyle.js:** the style rooms' materials take surface relief from the same procedural textures (js/proctex.js), with nothing new to download:
  - fabric → woven bump (0.9) + roughness variation (bedding, sheets, throw, curtains, chair upholstery)
  - bouclé → nubbly bump (1.6) + roughness variation (rug, sofa)
  - veneer → fine grain bump (0.35)
  - plaster (0.25), stone (0.3), travertine (0.4)
- Shader programs 31 → 32. No geometry changed and no console errors. Close-up: `tools/out/r12_K413_close.jpg` (the bouclé sofa and woven bedding are visible; that scripted render lacks the room view's plain light, so it's darker than the real view).

**Looked at and parked:**
- **Deferring furniture to after the first view:** only ~25 % of the level geometry is furniture without walk-mode collision (the rest has to be there for walking), so the phone gain is modest for an invasive loader change.
- **Lighter furniture:** simplifying it would change its shape, which the rules don't allow. The heavy shared pieces are already GPU-instanced (round 2/3).
- **CC0 texture downloads** (Poly Haven fabrics) need the user's OK first. They're optional, since our procedural textures cost 0 bytes.

## Round 13: what a phone really downloads; a half-size texture set for phones
**Measuring the real transfer.** GitHub Pages gzips the geometry .bin files (checked on the live site: L1.bin is 3.5 MB on disk and 1.6 MB transferred, `Content-Encoding: gzip`), while KTX2 doesn't compress any further. Every file the page loads at start, gzipped like GitHub Pages:

| | on disk | over the wire |
|---|---|---|
| level geometry .bin | 13.0 MB | 6.03 MB |
| level glTF JSON | 2.3 MB | 0.16 MB |
| KTX2 textures | 4.28 MB | **4.28 MB** (~40 % of the transfer) |
| everything at start | 18.6 MB | **10.9 MB** |

(The local server doesn't gzip, so the "download" numbers in rounds 1–12 overstate a real visitor's transfer; the relative gains still hold.)

- **tools/pack-levels.mjs:** every texture is also encoded at half size into `data/levels/tex_m/` (full-size colour 1024 → 512; normal, roughness and small items 512 → 256).
- **js/main.js:** on a phone (the round 6 profile) the shared KTX2 loader swaps `tex/` for `tex_m/`. Desktop is unchanged.

| | desktop | phone (375×812 emulated) |
|---|---|---|
| textures downloaded | 49 files, 4276 KB | 49 files, **1150 KB** |
| total over the wire (est.) | 10.9 MB | **≈ 7.8 MB** (−29 %) |
| textured meshes loaded | 312 | 312 |

No console errors on either profile. CPU and network throttling still can't be emulated in this browser, so phone load and FPS aren't measured directly.

## Round 14: 16-bit UVs (geometry −37 % over the wire)
**Measured:** by attribute (uncompressed), the UVs were the biggest part of the geometry: TEXCOORD_0 as 32-bit floats was 7.5 MB, against 5.8 MB of (already 16-bit) positions, 4.2 MB of indices and 2.9 MB of normals. quantize() skipped them, because the box-projected UVs are in metres, outside [0, 1].
- **tools/pack-levels.mjs packUVs:**
  - Every textured material's UVs use one fixed rule, uv' = (uv + 128) / 256, and its texture slots get the inverse `KHR_texture_transform` (offset −128, scale 256). The texture lands exactly where it did. 16-bit storage gives ~4 mm in texture space, invisible on 1–2 m texture tiles. Being the same everywhere keeps the materials identical across levels (round 8 sharing).
  - Primitives whose material has no texture drop their UVs (~200 k vertices).
  - The style rooms keep metre UVs (js/roomstyle.js tiles its procedural textures by them). Where they share a textured material with the rest, they get a raw copy `<name>__raw` (25 materials; the loader's glass/water override ignores the suffix).
  - `quantize({ quantizeTexcoord: 16 })`.

| | before | after |
|---|---|---|
| level geometry (.bin) over the wire | 6029 KB | **3793 KB** (−37 %) |
| levels on disk (pack report) | 17.60 MB | 14.02 MB |
| total over the wire, desktop / phone | 10.9 / ≈ 7.8 MB | **≈ 8.7 / ≈ 5.6 MB** |
| hero-camera colour (p5/p50/p95, RGB) | 69/145/233, 134/139/131 | identical (textures land in the same place) |
| materials / programs / draw calls | 201 / 31 / 515 | 209 (+8 raw copies) / 31 / 515 |
| GPU textures | 64 | 64 (shared, no duplicate requests) |

Checked: K.404 (packed UVs) has stone, walnut and tiles mapped as before (`tools/out/r14_K404.jpg`). K.401 (style room, raw metre UVs, procedural textures at 1.67 repeats = 0.6 m tiles) is intact. No console errors.

## Round 15: runtime - draw calls in the overview
**Measured** (visible draw calls in the overview, by kind): doors 94 (the balcony glass doors, 2–4 primitives each, seen through the facade), furniture 74, shell 71, and about 85 from the five style rooms' separate small dressing (lamps 20, cushions, rugs, curtains, decor; kept separate so it can be clicked), which from outside is only specks behind glass.
- **js/main.js showBand:** in the overview, the style rooms' small dressing (lamp, led, decor, cushion, curtain, rug, plant) is not drawn, like the TVs and bathroom fittings. Floor and room views still show it (Level 4 floor view: all 20 style-room lamps visible).

| | before | after |
|---|---|---|
| draw calls (overview, bench camera) | 515 | **469** |
| GPU frame (1280×720, pane visible) | 5.4 ms | 4.4 ms |

**Tried and reverted:** decoding meshopt in web workers (`MeshoptDecoder.useWorkers`). The building was ready later (629 / 675 ms vs 514 ms), because worker start-up costs more than decoding these mid-size buffers on the main thread.
Start-up timeline now (local, desktop): building 514 ms → collision 653 ms → shaders compiled (compileAsync) 1011 ms → ready 1025 ms.

## Round 16: a static stand-in for the exterior doors in the overview
The overview draws the exterior doors (balcony glass, fixed leaves) closed and never moves them, but each leaf is its own hinged mesh with 2–4 materials, so they took ~90 of the remaining draw calls.
- **js/main.js:** at start-up all exterior door leaves (not interior, not corridor entrances) are joined per material into a static stand-in in world space, at their closed position. Every vertex stays where it is, and mirrored leaves get their winding flipped back. The overview draws the stand-in (7 meshes) and hides the hinged leaves. Floor, room and walk views do the opposite, so the doors still open there (checked: Level 3 view shows 28 real leaves and 0 stand-ins).

| | before | after |
|---|---|---|
| draw calls (overview, bench camera) | 469 | **369** (−21 %) |
| GPU frame (1280×720) | 4.4 ms | 3.5 ms |
| hero-camera colour (p5/p50/p95, RGB) | 69/145/233, 134/139/131 | identical |

**Since the baseline:** overview draw calls 790 → 369 (−53 %).

## Round 17: facade materials matched to the render by swatch
Draw calls left (369): mostly the building shell (71), interior furniture seen through the windows (74) and door frames (26). Cutting more would mean duplicating whole floors of geometry for an overview-only copy (more GPU memory), so this round turned to materials outside the template rooms.
- **Measured:** 5×5 px swatches from the hero camera, with the material under each pixel found by raycasting. Against the render: the facade timber read too orange (#a6724c vs #a0846b), the terrace deck very saturated (#3a2012), and the sunlit plaster a bit bright and yellow (#f4e9d2 vs #e7dbcf).
- **js/main.js:** per-material colour factors (the render's value / ours, converted to linear), applied once to each shared material at load (`FACADE_TINT`).

| swatch | render | before | after |
|---|---|---|---|
| facade timber, sunlit | #a0846b | #a6724c | **#a28771** |
| terrace deck | warm mid brown | #3a2012 (saturated) | #3e2618 |
| plaster, sunlit | #e7dbcf | #f4e9d2 | #f4e6d7 (bluer; brightness held by the tone shoulder) |
| whole frame p5/p50/p95, RGB | 33/136/232, 142/142/133 | 69/145/233, 134/139/131 | 70/145/231, 134/139/132 |

A stronger plaster factor (0.885) was tried: sunlit plaster barely moved (the Neutral shoulder and the highlight lift keep it bright) and it only darkened the shade and interiors, so the mild one was kept.

## Round 18 — site materials (roads, pads, lawn, soil)
- `tools/build-siteplan.mjs`: box-projected metre UVs (stored (m+256)/512, 16-bit), `prune({keepAttributes})` keeps them. SITEPLAN 12 KB + 154 KB.
- `js/main.js`: the site plan gets the shared procedural maps (no download): asphalt mottling (plaster, 3 m), slab joints on pads/retaining walls (porcelain, 1.2 m), soft lawn variation (plaster, 9 m), soil (plaster, 5 m).
- Measured, hero camera: before 69/145/233, RGB 134/139/131 → after 65/145/232, RGB 130/136/130 (slight shadow-end texture, median unchanged). No console errors. Check render: tools/out/r18_site.jpg.

## Round 19 — walk-mode first frame (lobbies, phone) and the corridor floor
Found by rendering the walk start on every floor, desktop 1600x893 and phone 375x812 (2x):
- **White hole at the stairs** (floors 2-4): the start faces the stair flight down, which lay below the isolation height cut and dissolved to white. `isolate.js` now takes "deep" areas (green channel of the mask + `uIsoDeepY`); walk mode in a lobby marks the stair outline deep down one storey (`spaces.stairWell()`), so the flight down shows. The rest of the floor below stays hidden.
- **Phone field of view**: walking used 70 deg vertical everywhere, about 36 deg across on a portrait phone (a slot). `walkFov()` keeps ~50 deg across, at most 90 deg vertical, re-applied on resize/rotation. Desktop is unchanged at 70 deg.
- **Start pitch**: stair starts look ~7 deg down (`walker.start(.., lookPitch)`), so less of the frame is the underside of the flight overhead.
- **Floor 1 faced glass doors in a corner**: the "most open direction" used bare ray length, and glass lets rays through. It now scores walkable floor of the lobby ahead over a +-15 deg fan, so floor 1 opens facing the communal room.
- **Corridor and lobby floors (M_teak_deck)**: the texture tiled every ~1.3 m, so knots were ~25 cm at eye level. `TEX_DENSITY` gives 2.5x UV density (texture clones share the same image, no download). Balconies get the same finer grain.
- Measured: hero 65/145/232, RGB 130/136/130 (unchanged). GPU textures 68, no new geometry, all modules parse.
- Renders: tools/out/r19_lobby_before.jpg / r19_L2_desk.jpg, r19_phone_before.jpg / r19_phone_after.jpg, r19_L1_desk.jpg, r19_L3_desk.jpg.
- Not measured: first-frame time on a real phone (the browser pane was hidden, so timings there aren't meaningful).

## Round 20 — lights, shadows, JavaScript weight (research audit items 1, 2 and the bonus)
Checked each audit claim before acting:
- **Window light was never on**: `enterRoom()` (the eye-level room view that aimed it) is never called, so the RectAreaLight sat at intensity 0, adding per-pixel cost and area-light code to every shader. It is now a soft SpotLight, added to the scene only if a window is ever set; today, none is. The RectAreaLight libraries are gone (107 KB gz / 314 KB raw). `WINDOW_CD` is a first estimate, not yet matched by render.
- **Dead post-processing chain**: `buildComposer()` (GTAO, bloom, output pass, grade pass) is never called, yet its modules were imported and preloaded. Removed the code, imports and preloads (EffectComposer, Pass, CopyShader, GTAOPass/Shader, PoissonDenoise, SimplexNoise, UnrealBloom, LuminosityHighPass, OutputPass/Shader, ShaderPass, MaskPass: about 22 KB gz).
- **three.module.min.js**: 266.6 → 172.2 KB gz (1.31 → 0.69 MB raw).
- In total, about **224 KB less gzipped JS and about 1 MB less to parse**: 15 JS files, 256 KB encoded.
- **Sun shadow** 4096 → 2048 on desktop, 2048 → 1024 on phone. The shadow box is 68 m, so texels are 3.3 / 6.6 cm. A/B at the hero camera shows no visible change (tools/out/r20_shadow_compare.jpg). Saves 48 MB of GPU memory on desktop.
- **Mood lights kept (6 desktop / 3 phone)**: a GPU-synced bench in the K.405 walk view gave 5.1–5.4 ms with all lights and 6.1 ms with the minimum. That's noise, so no measurable cost on this GPU.
- **Not done**: shadow casters are 385, not 800, and only 28 are under 0.4 m, so that would be a small gain. Audit items 3–5 are next.
- Measured: hero 65/145/232, RGB 130/136/130 (unchanged); 368 calls, 735k triangles, 30 programs (was 43 in the same session), 63 textures. Warm shader compile ~0.3 s (a cold cache after a shader-source change took 1.7 s once), ready 1.18 s (was 1.30). Overview frame 7.3–10.9 ms (was 12.4; noisy).

## Round 21 — research items 3–5: facade battens instanced; items 4 and 5 checked
- **Item 3, battens**: the L1 batten mesh was 5,747 pieces, 5,742 of them plain boxes (68.9k triangles, ~1.0 MB of compressed vertex data). New pack step `instanceBoxes()` (tools/pack-levels.mjs, run after the bevel simplify) finds every piece that is exactly a box. That means 8 corners, 3 orthogonal face directions, and all vertices on the box within 1 mm. Each becomes one GPU instance of a single unit box (centre, rotation from its face directions, scale = its sizes). The 10 odd triangles stay as they were. Same geometry on screen: the before/after close-up from the same camera matches (tools/out/r21_batten_before.jpg / r21_batten_after.jpg).
- All copies share the first box's UVs, which repeated one knot pattern on every block. `jitterInstanceUVs()` (js/main.js) offsets each instance's texture lookups by a hash of `gl_InstanceID`, so the grain varies again.
- **Size**: L1.bin 2.34 → 1.53 MB raw (−803 KB). Gzipped it's only 926 → 831 KB (−95 KB): meshopt-compressed boxes already gzip well. The real saving on the wire depends on whether GitHub Pages gzips .bin files. Other levels are byte-identical.
- Pipeline: the pack was run in stin88a-v4 (the raw Blender export), and only L1.gltf/.bin and pack_report.json were taken. The other KTX2 files that V4 had re-encoded stay at V5's committed versions.
- **Not done in item 3**: simplifying plaster walls (tried in an earlier round, no gain) and furniture (bedding, porcelain, wood_light). The template-room rule is exact shapes, so furniture is left alone.
- **Item 4**: nothing to change. The 6 copies each of lamp_shade / lamp_globe / led_warm are per style room by design (roomstyle.js clones them so each room's light switch lights only that room). The unnamed materials are the hidden unit hover volumes. Shaders already pre-compile with compileAsync.
- **Item 5** (LED strips, lit niche, contact-shadow decals) adds new geometry to the template rooms, which the standing rule doesn't allow (materials / textures / optimization / interactions only). Asked mastercontrol; not done.
- Measured: hero 65/145/232, RGB 130/136/130 (unchanged); 369 calls (+1), 735k triangles (same), 31 programs, ready 1.18 s.

## Round 22 — research item 5: room accents (LED lines, lit niches, contact shadows)
Approved by the user ("Yes, add them", relayed by mastercontrol on 2026-11-27). Existing furniture keeps its exact size, place and shape: these are separate, thin pieces.
- **Data**: `tools/build-accents.mjs` reads the raw Blender export (stin88a-v4/source/glb_raw, one node per object, the template rooms already copied into every room by 06t). It writes `data/room_accents.json` (17.7 KB) for 45 rooms:
  - 138 **contact shadows**, under the bed and every piece of floor-standing casework (footprint + 12 cm fall-off);
  - 51 **plinth LEDs**, along the room-facing foot of every full-height unit (wardrobe / shelving wall), each with a warm floor wash;
  - 240 **lit-niche LEDs**, under the open shelves of those units (shelf undersides 0.9–2.4 m up). They run along the straight back edge, because the shelf fronts are curved and a front line overshot them (first try, fixed).
  - Overlapping casework nodes produced each line twice; de-duplicated.
- **Site**: `js/accents.js` draws one instanced mesh each per level for shadows, LED lines and washes (shared materials, 12 draws in all). The shadow fall-off is computed in the shader from each instance's size, so it stays 12 cm whatever the piece. LEDs are a pale diffuser by day (0.85) and warm when lit: + 1.6 × glow (time of day: day 0, golden 0.4, night 1), at least 0.6 in the isolated room / floor / walk views where the time of day doesn't show. Floor washes appear only when lit. The style rooms' light switch dims their LEDs too (`onLights` hook in roomstyle.js; they start "off" at 0.15 like their lamps). Hidden in the building overview like the other small dressing. The headboard-top LED already existed (06b) and is unchanged.
- **Measured**: overview unchanged (369 calls, 735,348 triangles). The floor 4 view adds 3 calls and 1.5k triangles. Hero 61/145/231, RGB 129/135/129 in this browser session, identical with the accents hidden (the earlier 65 was a different browser session). Ready 1.38 s (was ~1.18 s): 3 new shader programs compile at start-up. The accents JSON is preloaded (arrives at 21 ms). No console errors.
- Renders: tools/out/r22_K405b_before.jpg / r22_K405b_after.jpg (shelf LEDs, wardrobe contact shadow), r22_K405_before.jpg / r22_K405_after.jpg (bed contact shadow).
- `STIN.accents` debug handle: `setRoom(label, k)`, `setGlow(g)`, `setPlain(k)`.

## Round 23 — re-measure after the accents; start-up regression fixed
Phone profile measured in the browser pane's phone preset (375x812, phone user agent and touch; pixel ratio 1.25, 1024 shadow map, half-size textures). Frames are GPU-synced (readPixels after each render) on this machine's GPU. No CPU throttling is available in this pane, so the numbers compare builds, not real phones.
- **Overview**: 369 calls, about 11 ms per frame; accents hidden there, unchanged.
- **Floor 4**: 446 calls with accents, 443 without; 9.8 ms against 9.9 ms (noise).
- **K.405 walk**: 138 calls with accents, 135 without; 6.3–8.6 ms against 6.7 ms (noise).
- **Regression**: start-up. The accents' 3 shader programs compiled before the first frame: phone ready 1.45 s, shader pre-compile 466 ms.
- **Fix**: the accents never show in the loading render or the overview, so `buildAccents()` now runs right after start-up. It patches their materials, replays any light-switch states set meanwhile (`accentRoomK`), compiles their shaders off-screen (`compileAsync` on each mesh, shown only for that synchronous moment), then lets `showBand` decide visibility. Phone ready 1.32 s, pre-compile 367 ms; accents in place at ~1.7 s. No console errors.
- **Overview: small loose items hidden in every room** (round 23, part 2). The overview drew ~170 interior draws seen only through glazing. Hiding all interior furniture halved the triangle count but visibly emptied the rooms and the terrace (tools/out/r23_ov_compare.jpg), so that was not done. Hiding only the small loose items (chairs, plants, lamps, decor, cushions, rugs; `OVERVIEW_HIDDEN`, previously done for the style rooms only) changes at most 15 of ~89k sampled pixels on every gallery camera (mean difference 0). The hero is identical at 64/145/232, RGB 130/136/130 (desktop). Overview 360 → 331 calls, 724k → 586k triangles. Frame time on this desktop GPU is unchanged within noise (alternating A/B, 3 runs each: phone canvas 7.6–11.1 ms with, 8.8–9.5 ms without; 1600x893 9.0–9.9 ms with, 8.6–8.8 ms without). An earlier single run that showed 13.8 → 8.3 ms was warm-up, not a real gain. The saving is aimed at weak phone GPUs, which this pane can't emulate.

## Round 24 — research round 3 audit: walk collision and small normal maps
Checked each item of the new list (research\v5-perf-color-ideas.md, "Round 3 audit") against the code first:
- **Item 5, collision before the first frame** (done). The walk collision can't simply be postponed: spaces.js casts rays against it while loading, to find each balcony's depth, which shapes the walkable areas. So the tree is made cheaper instead. Ceilings (above the walker's head) and the facade battens (outside every walkable area) are left out of the collision set: 338k → ~261k triangles. The BVH uses 24 triangles per leaf (was 12).
  - Measured back to back on desktop (one pair, same machine, minutes apart): BVH build 156 → 91 ms, merge 37 → 25 ms, level setup 714 → 606 ms, ready 1.37 → 1.15 s. Later loads were slower across the board (the machine got busier: level setup 1.0–1.4 s on every load), so absolute times aren't comparable across sessions.
  - Checked: replaying the balcony-depth rays against the batten triangles alone, none of the 13 balconies (floors 2–4) has a batten in the way, so the walkable areas are unchanged. The walker lands on the floor on levels 1 and 4 and in K.405.
  - New `collisionMerge` timing mark splits merge from BVH.
- **Item 4, KTX2** (done, partly). The audit guessed the colour maps were UASTC; they are all ETC1S already (2.8 MB). UASTC is only on the 12 normal maps (1.57 MB), as designed. Four normal maps on small surfaces / small items now encode at 256 px in pack-levels.mjs: site paving 259 → 45 KB (622 triangles of paving), marble 68 → 20 KB (24 triangles), potted plant 229 → 61 KB, chair legs 137 → 39 KB. Desktop −528 KB; the phone set was already 256 px, so it's unchanged. Only these 4 files are taken from the V4 pack run; all level files are byte-identical. Hero unchanged at 64/145/232, RGB 130/136/130.
- **Not done**:
  - Item 1, plaster / grass simplify: tried in an earlier round, no gain.
  - Item 2, the 0-intensity spot + point: they are the style rooms' switchable room lights. Removing them changes the light count, so every shader rebuilds when a switch is used, and round 20 measured no frame cost from them.
  - Item 3, glTF JSON 2.29 MB: it gzips to ~145 KB, so ~2 % of the download on the wire; left for later.

## Round 25 — research round 3, item 1 re-tested with numbers: lawn simplified, walls left
- **Walls (not done, now measured)**: the exact recipe proposed (weld, then simplify ratio .3, error .0005, borders locked) on `L1–L4_plaster_cream` in the packed files gives 107,610 → 100,982 triangles (−6 %); with borders unlocked −8 %. These walls are many small flat pieces around openings, with nearly every vertex on a piece border. The triangles are genuinely needed, not tessellation noise, so no change. Unlocking borders would also risk cracks.
- **Lawn (done)**: the site plan lawn is smooth toposolid terrain. `tools/build-siteplan.mjs` now simplifies grass and soil to within ~2 cm, borders locked, so the edges along roads, pads and retaining walls stay exactly in place. Grass 26,277 → 3,267 triangles (−88 %); SITEPLAN.bin 154 → 45 KB. The site plan was built from stin88a-v4/source/revit/siteplan_revit.json (`--in`), as in round 18.
  - Overview 586k → 563k triangles, 331 calls.
  - Hero unchanged at 64/145/232, RGB 130/136/130.
  - The lawn close-up from round 18's camera matches (tools/out/r25_site_after.jpg against r18_site.jpg). No console errors.
- **Items 2, 3, 5**: nothing new beyond round 24's notes. Item 2: the 0-intensity lights are the style rooms' switchable lights, so removing them means a shader rebuild on every switch. Item 3: JSON gzips to ~145 KB. Item 5: collision done in round 24; shaders already compile with compileAsync while the loading screen shows. The research file has no further items.
- **Timing**: start-up wasn't re-taken. The machine is still busy (level setup 1.31 s against ~0.6 s when quiet), so ready / BVH / shader times now aren't comparable with rounds 23–24.

## Round 26 — research round 3: rest of the list (items 2, 3, 5)
- **Item 2, lights (done)**. The style rooms' own SpotLight + PointLight (intensity 0 except in the style room being viewed) are gone. While a style room is shown, roomstyle.js now borrows two of the mood-light pool's point lights (`mood.hold(2)` / `mood.release()` in lighting.js; held lights skip the anchor placement) and hands them back on leaving. The scene keeps a fixed light count, so switching never rebuilds shaders (48 programs before and after switching K.405's lights on). Scene lights 10 → 8: every lit shader evaluates 2 fewer lights. The downlight is now a point light (4.5, was a 6 cd spot), placed 0.4 m under the room's ceiling over the bed.
  - **Bug found and fixed on the way**: the old downlight was placed from the merged "ceiling" mesh's box, which also holds pieces of other storeys (K.405: 11.8–15.2 m). That put it at 11.75 m, under the room's floor (12.0 m). It now uses the room's own box (14.07 m). Centring it on the room's middle instead of the bed put a hot spot on the bathroom wall (the room box includes the bathroom), so it centres over the bed. Render: tools/out/r26_K405_on.jpg.
  - Frame time: an A/B in the K.405 walk view (2 zero-intensity lights added back, 3 alternating runs) was within this busy machine's noise (12.2–18.4 ms against 14.1–16.8 ms). The gain is for phone GPUs, which this pane can't measure.
- **Item 3, glTF JSON (not done, measured)**: node extras are 136 KB of the 2.33 MB level JSON, and the keys the site never reads (revit_id, revit_name, family, storey, categories, door_height, head_dir / frame_*) are about half of that. The bulk is accessor and bufferView entries from the meshopt layout. All level JSON gzips to 152 KB together, so stripping extras would save ~5 KB on the wire: not worth the risk.
- **Item 5 (nothing further)**: the collision part was done in round 24, and shaders already compile with compileAsync while the loading screen shows. Merging fog / shadow-receiving variants across materials would change looks, so it's left out.
- Round 3's list is finished; a round-4 audit has been requested from the research agent.

## Round 27 — research round 4 audit, checked item by item (no code change)
All measured on the current build; each item tried or checked and left out with numbers, so they aren't re-tried:
- **1. Freeze static matrices**: implemented and measured. 1,229 objects under `root` frozen (door and curtain pivots kept live). The whole per-frame `scene.updateMatrixWorld()` costs 0.11–0.14 ms frozen against 0.13–0.20 ms live: ~0.04 ms a frame. Frame times equal within noise (10.2–11.5 against 9.9–10.7 ms at 1280×960). The audit's −12 % (0.7 ms) did not reproduce. Reverted: not worth the risk of a missed moving object staying frozen.
- **2. BatchedMesh for static furniture**: pack-levels.mjs already merges furniture per level and material (mergeLevel), and repeated heavy pieces are GPU-instanced. BatchedMesh would add little; not done.
- **3. DoubleSide → FrontSide** on the 64 opaque double-sided materials: tested live. Hero 431 / 89k px changed, but the K.405 walk view changed 39 % of its pixels: the wardrobe door and shelves vanish (tools/out/r27_frontside_walk.jpg). The Revit triangles are not consistently wound, so DoubleSide stays.
- **4. Shadow updates during door tweens**: already the case. The sun shadow has autoUpdate off and only re-renders on a section cut, a time change, the pad-1 massing toggle or the site plan's arrival, never per door-tween frame. There is no time slider (day / night button only).
- **5. Nagoya-style hover**: already built exactly as specified in roomstyle.js (back-face outline, verb tooltip, 9 / 13 px hotspots, 320 ms / 10 px / 450 ms click rules, same as nagoya-hill-params.json → toggles).
- **Colour re-measure** (asked by the audit): hero 64/145/232, mean RGB 130/136/130 (reference render 33/136/232, 142/142/133). The slight green lean comes from the lawn. A white-balance grade that brings the mean to R = G (warm [1.08, .95, .95], cool [1.01, .935, .99]: 63/144/229, RGB 133/133/129) turns the sky and facade lavender-pink (tools/out/r27_grade_compare.jpg), so the grade is unchanged.

## Round 28 — CC0 photo textures in the style rooms (user-approved: "Yes, both")
- **Assets**: 4 Poly Haven textures, each asset page checked for CC0 before download (ASSETS_LICENSES.md): rough_linen (bedding, curtains, upholstery), wool_boucle (sofa, rug), oak_veneer_01 (casework, bed frame, doors, panels), laminate_floor_02 (floors). 1k colour + OpenGL normal maps; sources kept outside the repo in stin88a-v4/source/textures/cc0/<id>/.
- **Processing**: each colour map becomes neutral grey detail (mean 0.85), so the rooms' palettes (signature / light / graphite) still set the colour. The boucle's woven check, which read as a plaid on the sofa, is toned down to 30 % contrast. KTX2: detail ETC1S 512 px, normals UASTC 512 px (boucle 256); phone set half size in tex_m/. The floor normal map had a JPEG flavour toktx can't read and was re-saved as PNG first.
- **Site**: roomstyle.js replaces the procedural map / bump of the fabric, boucle, veneer and planks slots with these (normal maps instead of bump), tiled at each texture's real size on the style rooms' metre UVs. They're fetched through the shared KTX2 loader the first time a style room opens, so start-up and visitors who never open one pay nothing.
- **Measured**:
  - Download: desktop 576 KB (8 files), phone 123 KB, only on opening a style room.
  - Room brightness and colour: K.405 entrance mean RGB 212/196/181 before and after; back view 209/192/175 → 212/195/177.
  - Frame time, K.405 walk view: 6.1–6.9 ms with the new normal maps, 5.9–6.6 ms without. Within noise, so no texture was dropped.
- **Looks**: the veneer has a natural oak cathedral grain instead of procedural stripes, and the floor reads as laminate boards (tools/out/r28_K405b_after.jpg against r22_K405b_after.jpg). Linen and boucle are subtle (r28_K413_after.jpg).

## Published: cebeb71 live (2026-11-27), user-approved ("Yes, both")
- Pushed `v5-glb-site` to `origin/main` as a fast-forward (`94e0ddf..cebeb71`, 29 commits, no force). GitHub Pages served the new build after ~40 s. Rollback tag `v5-live-94e0ddf` is unchanged.
- Pre-publish check (local, committed build): loading fade, overview, Level 1 ground, pad-1 auto-hide (hidden on render cameras 3-4), the 5 style rooms with their toggles, all 54 gallery images and thumbnails present, every request 200, no console errors.
- Live, first visit (browser cache refreshed): 115 → 104 files, 12.98 → 11.0 MB compressed (24.1 → 19.8 MB decoded), ready 5.0 → 1.9 s in the built-in browser. Hero 65/145/232, RGB 130/136/130. The CC0 set (8 files, 576 KB) loads on opening K.405. No console errors.
- Note: returning visitors may run a mix of old and new files for up to 10 minutes (GitHub Pages caches for max-age 600).
- Push notification sent: "STIN 88A site updated live".

## M1 (v6-webgpu branch) — look fixes on the current renderer (user: "Yes, start M1")
First milestone of the WebGPU/TSL plan (AUDIT_WEBGPU_TSL.md §6.5). Backup tag `pre-webgpu-cebeb71`; branch `v6-webgpu`. Still WebGLRenderer r170: no renderer change yet.
- **First view = eye-level hero** (3.jpg): the intro now flies to a camera on the lawn in front of the terrace facade (~3.8 m up, the orbit limit) instead of the high aerial view. The aerial overview is still used when leaving a floor.
- **Shift lens**: near eye level the projection is shifted up (off-axis frustum) instead of tilting the camera, so verticals stay vertical like the render. It fades out above ~14° camera elevation and is off while walking or in a room. It costs nothing per frame; picking uses the same matrix.
- **Pink/mauve shade fixed**: cause found by sampling pixels. The day grade's split tone (warm 1.05/.965/.955, cool 1/.955/1) removed green from both ends, so every shaded plaster wall went mauve. Now warm 1.02/1.0/.975 and cool .975/.985/1.02. Plaster tint lin(.95,.94,.985) (lilac) → lin(.95,.95,.945).
- **Navy soffits fixed**: the "pure sky" HDRI lit undersides with blue sky from below. environment.js `groundedEnv` builds a copy for the ambient/reflection light only, with a ground colour below the horizon (horizon × 0.42, tint 1/.97/.84; visible sky unchanged). Day environment 0.2 → 0.35.
- **Sun**: elevation 48° → 32°, colour #ffefdc → #ffeedd, intensity 7.8 → 6.0 (a lower morning sun, so fins and window boxes cast longer shadows).
- **Materials**: anisotropy 8 (phone 4) on every glTF map (was 1, so grazing facades were blurred). Painted/powder-coated metal metalness 0.35 → 0 (frames, railings, fascias: they mirrored the sky). Brass metalness 0 → 1. Teak tint lin(.96,1.16,1.41) → lin(.97,1.04,1.13): warm teak instead of grey-beige. Lawn ×1.3. Massing blocks #f7f5f1 → #cdcac4.
- **Measured** (same GPU, 1600×893 at 1.25×, GPU-synced): hero camera 10.2 ms median against 10.2 ms on live cebeb71; overview 7.9 against 8.9 ms. 331 draw calls and 563k triangles, unchanged.
- **Colour, hero camera**: p5/p50/p95 49/127/240 (live 34/81/210 from the same camera), mean RGB 124/133/127. Side by side with 3.jpg: tools/out/m1_compare.jpg.
- **Checks**: floor 2, unit K.405, back to the overview, golden, night: no console errors. Walk mode didn't start from the scripted check, so it is untested by script (its code path is unchanged; the lens is off while walking).
- Not published.

## Published: M1 live as 9a151f2 (2026-11-27), user-approved ("Publish M1 first")
- Pre-publish fix: portrait screens (phones) keep the aerial overview as the first view. At eye level a 48 m facade was cut off and tiny on a 375×812 screen.
- Checks before the push:
  - Walk mode (floor 4, stairs start): enters and exits, lens off while walking.
  - Phone (375×812): aerial first view, new colours.
  - Floor, unit, golden and night views.
  - No console errors.
- Pushed `v6-webgpu` to `origin/main` as a fast-forward (`cebeb71..9a151f2`, no force). Rollback tag `v5-live-cebeb71` was pushed first; `v5-live-94e0ddf` is unchanged. Pages served it after ~40 s.
- Live check (cache refreshed): eye-level first view at (−2, 3.8, 41.7), environment 0.35, sun 6.0, every request OK, no console errors. Returning visitors may see old files for up to 10 minutes (max-age 600).
- Push notification sent.

## M2 (v6-webgpu) — WebGPURenderer + TSL port, at parity, behind a flag (user: "Start M2")
The default site is unchanged (classic WebGLRenderer, three r170). `?renderer=webgpu` runs the same code on WebGPURenderer, three **0.186.1** (pinned; released 2026-09-24). `?renderer=webgl2` runs the new renderer forced onto its WebGL 2 backend, the automatic fallback where WebGPU is missing.
- **How**: index.html writes the importmap from the URL: "three" is either `three.module.min.js` r170 or `three.webgpu.min.js` 0.186.1, plus `three/tsl`. js/gpu.js exports `GPU` / `FORCE_WEBGL` / `TSL`, and each module picks its branch.
- **Key finding**: WebGPURenderer converts classic materials to node materials at build time, but still reads colour, roughness and the other values from the original material. So the TSL nodes (`maskNode`, `colorNode`, `opacityNode`, `normalNode`) are set on the existing materials, and every runtime change (palettes, glow, site plan lift) keeps working with no material rewrite.
- **Ported** (every `onBeforeCompile` now has a TSL branch; none of them run on the new renderer):
  - **Grade**: one post pass (`createPost`: `pass()` 4× MSAA → old bloom lift in linear → `renderOutput` → split tone / contrast / gamma / lift / saturation / vignette / gain). It rebuilds when the tone curve changes (Neutral ↔ AgX). Grade uniforms become TSL uniforms with the same `.value` API.
  - **Isolation mask** (floor, room and walk views): one shared `maskNode` (same plan-mask texture, cut rectangles, deep stairs, screen dissolve). `maskShadowNode = true` keeps cut walls casting shadows, as before.
  - **Small shader hooks**:
    - glass Fresnel opacity → `opacityNode`
    - procedural battens → `colorNode`
    - per-instance UV jitter → `varying(instanceIndex)` offset on colour, roughness and normal
    - accent contact shadows → `opacityNode` from an `accHalf` instanced attribute
  - **Plan cuts**: no renderer-wide clipping on the new renderer, so building, ground, door proxies and TV live in a `ClippingGroup`. The section-cap stencil needed a depth+stencil texture on the post pass's target. Before that fix the cap plane covered the whole floor.
  - **Sun shadow**: PCF radius 2 (PCFSoft was removed). "Render once" uses the light's own `shadow.autoUpdate` / `needsUpdate` (`requestShadow()`).
  - **Sky**: the scene background (graded by the post pass). The procedural Sky addon can't load on the new build (it imports `UniformsUtils`), so it is imported only on the classic path. The new renderer shows a plain pale-blue sky for the moment before the photo arrives.
  - **Other**: pano viewer gets its own WebGPURenderer; anisotropy queries use `getMaxAnisotropy()`.
- **Measured** (RTX 4060 laptop, built-in browser, 1600×900 at 1.25×, GPU-synced):

| | Classic r170 | WebGPU 0.186.1 | WebGL 2 backend |
|---|---|---|---|
| Hero frame, median | 11.0 ms | 8.6 ms | not measurable with readPixels sync |
| Overview frame, median | 8.2 ms | 9.1 ms | not measurable |
| Hero luminance p5/p50/p95 | 49/127/233 | 53/136/240 | 53/136/240 |
| Hero mean RGB | 123/132/126 | 127/136/132 | 127/136/132 |
| Ready (start-up shaders) | 1.1–1.8 s | 8.4 s (shaders 6.0 s) | 5.3 s |

- **Look**: near parity. The new renderer is ~7 % brighter in the midtones (the bloom lift now also hits the sky; PMREM / MSAA differ slightly). Side by side: tools/out/m2_parity.jpg.
- **Checks on WebGPU**: hero, floor 2 (cut, caps, isolation, status colours), unit K.405 room cutaway, overview, golden, night, walk (floor 4), style room K.405 walk-in (8 CC0 textures, borrowed lights). No console errors. tools/out/m2_gpu_modes.jpg, m2_gpu_floor2b.jpg, m2_gpu_k405.jpg.
- **Open before the new renderer can be the default**:
  1. Start-up shader compile is 5–8× slower: needs async warm-up per level or a pipeline cache.
  2. Map mode (3d-tiles-renderer 0.5.4) is untested on the new renderer.
  3. 360° pano is untested.
  4. The procedural Sky stand-in is to be replaced by the TSL `SkyMesh`.
  5. The ~7 % brightness difference.

## M2b (v6-webgpu) — WebGPU start-up fixed (user: "Fix start-up first")
Profiled with long-task and per-callback timers in the built-in browser. There were three separate causes, all specific to the new renderer:
1. **Compiled for the wrong target**: the start-up `compileAsync` built pipelines for the screen, but the new renderer draws into the post pass's own target (half float, 4× MSAA, depth + stencil). Every real pipeline was then built synchronously in the first frame (~6 s). It now compiles for `compileTarget()` (the pass's target; classic: the screen, unchanged).
2. **The fog object**: `env.set` created a new `FogExp2` every time, and the new renderer keys every material's nodes on the fog object. `setTime("day")` straight after start-up rebuilt every material: a 2.7 s frame half a second after the page appeared. Every time-of-day switch would also have done it. Now one fog object changes colour and density (`setFog`).
3. **The environment texture**: assigning a different texture to `scene.environment` also rebuilds every material (sky photo arriving, outdoor ↔ room light). The new renderer now uses one `pmremTexture` node for the session (`scene.environmentNode`), and a switch only changes the texture it reads (`setEnvTex`). Classic is unchanged.

Also:
- Before the first frame, only what the start camera sees is compiled. Compiling from the eye-level hero camera instead took ~9.5 s.
- `warmUpRest()` then compiles every other mesh in batches of 8 in idle time, each batch shown and un-culled only for the synchronous moment `compileAsync` reads it.

Measured (RTX 4060 laptop, built-in browser, local server, warm HTTP cache):

| | Before (M2) | After |
|---|---|---|
| WebGPU ready | 8.4 s (shaders 6.0 s) | 2.0–3.2 s over 4 runs |
| Worst frame after ready | 2.7 s (fog rebuild) | none > 150 ms; background warm-up done ~26 s after ready |
| First floor click / overview / golden / day | — | no frame > 150 ms |
| First K.405 room view | — | one 191 ms frame |
| Classic ready | 1.1–1.8 s | 1.2 s, no errors |

- Classic had 180 / 363 ms frames on floor and golden switches. They were not compared against before; they are likely pre-existing (they are independent of the new code paths).
- Still open for making the new renderer the default: map mode (3d-tiles-renderer) and the 360° viewer untested; procedural sky stand-in; ~7 % brightness difference; cold-cache start-up (first ever visit, no browser shader cache) not measured here.

## M3 (v6-webgpu) — post chain on the new renderer: GTAO, selective bloom, SMAA, quality tiers (user: "Start M3")
New renderer only (`?renderer=webgpu`). The default classic site is unchanged (ready 1.2 s, no errors after these changes).
- **Quality tiers** (`QUALITY` in grade.js). Default: Balanced on phones, High elsewhere. `?quality=` overrides, and single switches `?ao= &bloom= &smaa= &msaa=` exist for testing.

| Tier | AO | Bloom | Anti-aliasing |
|---|---|---|---|
| Ultra | GTAO full resolution, 16 samples | selective | SMAA |
| High | GTAO half resolution, 12 samples | selective | SMAA |
| Balanced | none | old per-pixel lift only | 4× MSAA (= M2) |

- **GTAO** (three/addons `ao()`), radius 0.35 m, plus `denoise()` (edge-aware, normals rebuilt from depth). It darkens window boxes, batten gaps, soffits and furniture contact. 0.6 m left dark halos around thin railings, so it was reduced.
  - WebGPU can't sample the depth part of a combined depth + stencil buffer ("Multiple aspects selected"), which the section caps need. So the AO tiers keep **two chains**:
    - exterior views: a plain depth buffer + AO
    - plan-cut views: depth + stencil for the caps, no AO (those views fade AO out anyway, `aoAmount = 1 − isoK`)
  - Pre-compile and warm-up cover both targets (`compileTargets()`).
- **Bloom**: at threshold 0.9 in linear light every sunlit wall glowed (a white halo over the facade). Sunlit plaster reaches ~3–4 in linear light, so the threshold follows the time of day: day 4.5 (sun glints only), golden 2.2, night 0.9 (lamps, LED lines). Strength 0.12 / 0.16 / 0.22, radius 0.5. The old per-pixel brightening stays on every tier, so brightness keeps parity with classic. Bloom reads the scene texture directly: fed the AO expression, it first rendered that into an extra full-size texture.
- **Environment maps**: freeing the previous one on a time switch hit frames still queued with it (~100 "destroyed texture used in a submit" GPU errors after start-up). The new renderer now keeps one PMREM target per time of day + source and re-renders it in place. 0 GPU errors since.
- **Hero colour** (1600×900): High 45/135/240, RGB 124/133/129. M2 53/136/240, RGB 127/136/132. The darker p5 is the AO.
- **Frame time** (RTX 4060 laptop, hidden built-in browser pane, GPU-synced): all tiers built in the same page and measured back to back. AO + denoise + SMAA + bloom add about 1–3 ms over Balanced. The machine's own load changed a lot during this session: Balanced measured 8.6 ms earlier and 17–21 ms in the final A/B. So only the relative cost is reliable; absolute 60 FPS needs a re-check on an idle machine.
- **Checks on High**: hero, floor 2 (cut chain, caps), unit K.405, night (lamp glow), golden (its sky photo was still loading: grey stand-in, as before), no console or GPU errors. tools/out/m3_high_hero.jpg, m3_ao_crop.jpg, m3_modes.jpg.
- **Open for M4 look-dev**:
  - AO still makes railings read heavier.
  - The glass lantern picks up AO from what is behind it (transparent surfaces don't write depth).
  - Batten gaps are now strongly shaded: check against 3.jpg.

## M4 (v6-webgpu) — materials + an AA regression fixed (user: "Start M4"); honest result: mostly infrastructure
New renderer only. Classic unchanged (ready 1.6 s, no errors). No downloads: CC0 texture sets were not fetched (they need the user's approval).
- **js/materialsTSL.js** (new, opt-in `?look=1`): TSL detail layered on the existing materials by name, in world space:
  - plaster / concrete: macro breakup ±6–9 %, mottling, grime at wall feet, vertical streaks
  - timber: per-batten tone from `hash(instanceIndex)`
  - powder coat: roughness noise
  - glass: IOR 1.52, roughness 0.03, env 5.5
  - asphalt / pavers: patches + aggregate
  - lawn: dry / lush hue patches over 15–30 m

  Measured A/B at 25–40 m: image mean changes ~1–2 % and is barely visible (tools/out/m4_ab.jpg). But its noise nodes **doubled the WebGPU start-up shader build (ready 3.4–3.6 s → 6.8 s, two runs each)**, so it is off by default. The real photoreal jump needs real PBR texture sets (CC0, approval), trees / landscape (M5) and reflections, not more procedural noise.
- **Anti-aliasing regression from M3 fixed**:
  - M3's High tier swapped 4× MSAA for SMAA (AO needs a readable depth buffer), and the 10 cm timber battens broke into wide moiré bands at 20–40 m (tools/out/m4_moire.jpg). Every tier now draws with 4× MSAA again.
  - The procedural batten shading (`addBattens`) also fades to its average tone where a batten covers < ~2–3 pixels (`fwidth`).
- **AO is now opt-in (Ultra)**:
  - With MSAA, GTAO can't read the multisampled depth ("textureGather(texture_depth_multisampled_2d)"). So AO gets its own half-resolution depth pass (one flat override material; glass writes depth there, so panes no longer take AO from the room behind). AO strength is 80 %.
  - Pre-compiling that pass and the plan-cut (stencil) chain never matched what their own pipelines draw (compileAsync, and even a plain render into the target, left 170–220 pipelines to the first floor click: ~3 s freezes). Only a draw through the chain itself primed it: `primeCutPass()` draws every mesh through both chains once in idle time, then a normal frame in the same task (never shown). After that the first floor click takes 4 ms.
  - Even primed, the AO set-up still froze ~1–1.5 s on the first room view / return to the exterior, and the priming task itself is ~4–5 s. So:
    - **High** (desktop default) = MSAA + selective bloom, no AO.
    - **Ultra** (`?quality=ultra`) = + AO.
- **High tier on WebGPU, after warm-up**:
  - nothing > 150 ms after ready
  - first floor click: no slow frame
  - room K.405: frames ≤ 0.4 s
  - overview, golden, night, day: none
  - 0 errors
- **Warm-up**: the hidden section-cap counter (stencil material) is no longer compiled for passes without a stencil buffer (that produced pipeline validation errors).
- **Still open**:
  - AO without stalls (likely: one chain with stencil + MRT depth, or AO computed only when the view is still)
  - real PBR textures
  - trees / terrain / haze (M5)
  - 37 one-off "isCubeTexture of null" TSL errors seen once in an AO + priming run, not reproduced by per-object compiles; not seen on High

## M5 (v6-webgpu) — trees and a photographed lawn (user: "Yes, with downloads")
Both renderers (plain three.js): the classic site gets them too.
- **Assets** (ASSETS_LICENSES.md): ambientCG LeafSet005 + Grass004, Poly Haven bark_brown_02, all CC0 and checked before download.
  - The Poly Haven tree scans were rejected: 0.3–4.8 M triangles, 40–200 MB of geometry, leaves with no alpha.
  - Leaves are cut out with their opacity map and composited in the browser into two 512 px leaf-cluster cards on thin twigs.
  - KTX2 via tools/build-foliage.mjs: desktop 0.71 MB, phone 0.19 MB.
- **js/foliage.js**: 3 procedural species (round, tall oval, broad spreading).
  - Geometry: tapered bark trunk + 5–7 branches; crown of 70–100 leaf cards facing out of the crown ±40°. Card normals point out of the crown, so it shades as one soft volume.
  - Drawing: GPU-instanced (2 meshes per species + 1 for contact shadows = 7 draw calls for 291 trees, +115k triangles).
  - Per tree: random size 9–20 m, turn, lean and leaf tint; soft round contact shadow.
  - Trees don't cast into the sun's shadow map (cost; alpha shadows).
- **Scatter**: jittered 9 m grid thinned by low-frequency noise (groups and lines, not an orchard). Lawn only, using three-mesh-bvh raycasts against the site plan: 2 s → 17–42 ms. Kept clear of:
  - the building (5 m) and the neighbour blocks (3 m)
  - roads and pads
  - the lawn in front of the terrace facade, so the eye-level hero keeps its open lawn like 3.jpg
- **Lawn**: Grass004 colour + normal map, tiled every 2.5 m, toned to 3.jpg's deeper olive (tint 0.5/0.54/0.4).
- **No mid-frame shader builds**: trees and lawn are compiled asynchronously (every pass), and their textures load first.
  - Classic: the 606 ms first-draw task after ready is gone.
  - New renderer: the trees' 7.5 s freeze is gone.
- **Measured** (classic, 1600×900 at 1.25×, GPU-synced, trees on → off):

| View | Trees on | Trees off |
|---|---|---|
| Hero | 16.0 ms | 15.3 ms |
| Overview | 12.9 ms | 11.5 ms |
| Three-quarter | 13.7 ms | 13.8 ms |

  The machine was loaded during this session; these are relative numbers. Classic ready 1.6–2.3 s, no errors.
- **Views**: tools/out/m5_views.jpg (hero, three-quarter, aerial, rear, golden, night), m5_three4_webgpu.jpg.
- **Found, not caused by M5 (open)**:
  1. The new renderer has a ~3.4 s long task right after start-up even with `?trees=0`. My M2b/M4 checks timed frame and idle callbacks only and missed it; the likely cause is the photo-texture swap (mipmaps built with render passes). This blocks making the new renderer the default.
  2. On the classic renderer the golden-hour switch changes the tone curve (Neutral → AgX), which recompiles every shader (multi-second task in a scripted run). It is existing behaviour on the live site.
- **Not done in M5**: distant terrain / skyline ring and height fog (the 9.webp haze), and wind (the site renders on demand, so static trees cost nothing while idle).
