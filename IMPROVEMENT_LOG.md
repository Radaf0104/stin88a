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
