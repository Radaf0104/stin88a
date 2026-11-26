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
