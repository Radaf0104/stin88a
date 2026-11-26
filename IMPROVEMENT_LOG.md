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
