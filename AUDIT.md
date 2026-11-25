# STIN 88A V1: audit, optimisation and geometry-integrity report

**Scope.** This is a working copy of the V1 site that is identical to the GitHub upload.
- All measurements were taken at `localhost:5174` in Chrome (ANGLE / D3D11, RTX 4060 Laptop).
- The canvas was 920×777 at DPR 1.25, High quality, in the overview camera with daytime lighting.
- GPU times are taken with a `readPixels` sync after N frames, so they are wall-clock times per frame, not GPU timer queries.

**Not uploaded.**

---

## PHASE 1: Audit (before any change)

### 1.1 Scene graph and geometry inventory

**Scene totals**

| | Value |
|---|---|
| Meshes in scene | 396 (incl. 101 `InstancedMesh`, 10,988 instances) |
| Triangles in the scene | 1,496,293 |
| Draw calls, moving frame (no AO) | 284–322 calls, ≈1.36 M triangles |
| Draw calls, still frame (with AO, scene drawn twice) | 546 calls, ≈1.84 M triangles |
| Geometries / textures on the GPU | 316 / 54 |
| Shader programs | 52 at start-up |

**Where the triangles are**

| Part | Triangles | Share | Notes |
|---|---|---|---|
| Ferns (Poly Haven fern_02: 6,232 tris × 72 instances × 4 sub-meshes) | **448,704** | 30 % | They cast shadows. Alpha-tested and double-sided. |
| Revit building (`data/geometry.bin`) | 232,862 | 16 % | In 258 groups. |
| Fixtures (instanced, already simplified 27,461 → 4,007 per set) | ≈211,000 | 14 % | |
| 3D grass (clumps of 44 blades, instanced in 12 m tiles) | ≈149,000 | 10 % | |
| Trees (360 instances, 2 LODs) | ≈143,000 | 10 % | Leaves 109k + trunks 34k. |
| Rest | | | Hills ring, ground, unit volumes, edges and others. |

**Building, by Revit category (triangles)**
- Curtain Panels 72,496; Curtain Wall Mullions 32,116; Furniture 31,638; Walls 17,066; Plumbing 14,420; Doors 13,312; Railings 11,358.
- Everything else is below 9k each.

**Building meshes**
- There are 200 building meshes: one per *Revit material* per level (`js/main.js:268-288`).
- The 88 Revit materials resolve to only **45 distinct looks**. For example, `CEMENT`, `CONCRETE`, `Default Wall`, `Finishes…`, `Gypsum` and `Ceiling` all become the same cream plaster.
- Grouping meshes by *look* per level would give **142 meshes, 58 fewer draw calls**.

**Instancing:** trees, ferns, grass, fixtures and chairs are already instanced. There are no further instancing candidates of note.

**Merge candidates**
- The 58 building meshes above.
- Section-cap stencil mesh `js/main.js:292`: one mesh, drawn only while a floor is cut. It's fine.

**Geometry defects:** these are inventoried in 1.6 and fixed in Phase 3.

### 1.2 Materials, shaders and textures

**Counts**
- 237 material objects in total.
  - Of those: 44 unit volumes, 44 unit edge lines, fixture clones, and the rest.
- There are 65 distinct looks.
- By type: MeshStandard 132, **MeshPhysical 13**, MeshBasic 6.

**MeshPhysical on opaque surfaces**
- There are 6 of them: `TILE - Ceramic 100X100`, `TILE - Ceramic 60x60`, `MARBLE GREY`, `PORCELAIN WHITE`, and `Porcelain, White` ×2.
- The source is the porcelain preset, `js/materials.js:193-195`, which uses clearcoat 0.8.
- Ceramic tiles cover the bathroom floors and walls, so the extra clearcoat lobe is paid on large screen areas.
- Physical is justified only for the 7 transparent materials (glass and water).

**DoubleSide**

There are 62 DoubleSide materials, falling into three groups:

1. **Needed:**
   - glass and water (transparent)
   - unit volumes (`main.js:470`, the cut opens them)
   - leaves and ferns (cards)
   - grass blades
   - stencil caps
2. **Needed but duplicated:** `main.js:337` clones the base material for every fixture part. This happens because mirrored instances flip their winding.
3. **Not needed:** tree bark `landscape.js:131` (closed tapered cylinders).

Opaque Revit materials are already FrontSide (`materials.js:230`).

**Textures**

| | Count / size |
|---|---|
| Unique image textures | 46: 21 at 1024², 25 at 512² (procedural canvas) |
| Anisotropy | 8 on all photo and canvas textures; 4 on leaves |
| Mipmaps | on by default |
| Sky background | `paleSky` DataTexture, mipmaps off, `LinearFilter` (correct) |

`texture.clone()` shares the GPU source (r170), so the per-material clones in `materials.js:159` do **not** duplicate GPU memory.

**Wasted texture downloads** (`materials.js:119`)
- Every real-texture set also loads `photo: load("diff")`, which no material uses. `photoTextures()` is imported in `main.js:10` but never called.
- The `bumpOnly` sets don't use their diffuse map at all:
  - `white_plaster_02_diff.jpg` 515 KB
  - `leafy_grass_diff.jpg` 1,167 KB
- The lawn also never uses `leafy_grass_rough.jpg` (499 KB).
- In total, **≈2.2 MB of the 9.8 MB of textures is downloaded and decoded for nothing**.
- The other sets decode their diffuse map twice (once for `map`, once for `photo`).

**Disposal**
- `envRT` is disposed when the time of day changes (`environment.js:77`).
- Pano textures are replaced but never disposed (`main.js:1090-1097`): each opened room leaks one 2048² canvas texture plus one pano JPEG (up to 7280×3600) on the GPU.
- The old `placeholderTexture` canvas is never disposed either.

### 1.3 Lights, shadows and post-processing

**Lights**
- 1 Directional (the sun, the only shadow caster)
- 1 Hemisphere fill
- **6 PointLights** (the mood pool; the High quality setting)
- 1 RectAreaLight (window; intensity 0 outside rooms)
- IBL: sky PMREM outside, RoomEnvironment PMREM indoors

Every lit material shades all 6 point lights on every pixel, even when they are 30 m away with intensity 0.
- Intensity-0 lights are still in the shader loop.
- three.js only drops a light from the shader when it is `visible=false`, not when intensity is 0.

**Shadow map**
- 4096² PCFSoft, static (`autoUpdate=false`, re-rendered only on time or cut change, `main.js:428-441`).
- Frustum ±34 m square, near 1, far 195 m (`main.js:390-391`).
- Bias −0.00025, normalBias 0.025 (`environment.js:65-66`).
- The frustum is a square around the building's *bounding circle*, not fitted to the building's footprint in light space.
  - With the sun at −38°/48°, about 40 % of the map covers empty lawn.
  - The far plane is about 3× deeper than the scene (wasted depth precision).

**Shadow casters**
- There are 230 of them, 1.03 M triangles in all.
- The shadow map is static, so casters cost nothing per frame. They cost only on refresh, ≈7 ms each time: on a time-of-day change or a floor cut.
- These should not cast:
  - water (transparent, `materials.js:179`)
  - the distant tree rings (110–175 m). The whole InstancedMesh is drawn into the map because its bounding sphere spans the ring, but only trees within about 45 m can land inside the ±34 m map.

**Shadow refresh cost:** ≈7 ms each time, which is acceptable because it is rare.

**Post-processing** (`main.js:92-122`)
- **Chain:** MSAA×4 HalfFloat RT → RenderPass → GTAO (only on still frames) → UnrealBloom → Output → Grade.
- **Measured frame cost** (median of 7×20 frames, configurations interleaved):

| Configuration | ms / frame |
|---|---|
| Scene straight to the canvas (`renderer.render`) | 3.6–4.7 |
| Full chain, no AO (what a moving frame costs) | **13.3–13.7** |
| Full chain, with AO (the one still frame) | 20.9 |
| Full chain with both composer targets at **0 samples** | **4.6** |
| Full chain with only target 1 multisampled | 10.6 |
| Full chain without bloom | 10.7 (bloom ≈ 1.6–3 ms) |

- **The root cause is MSAA ×4 on *both* ping-pong targets.**
  - `main.js:93` creates the composer target with `samples: 4`, and `EffectComposer` clones it for its second buffer.
  - Every full-screen pass (bloom, output, grade) therefore writes into a 4× multisampled half-float buffer and pays a resolve.
  - This alone is **≈9 ms of a 13.5 ms frame (65 %)**.
  - Only the scene render needs antialiasing.
- **Bloom** is 1.6–3 ms at strength 0.22 / threshold 0.9. In daylight almost nothing passes the threshold (`glow` 0).
- **Landscape geometry is cheap on this GPU.** Hiding all ferns, grass or leaves changes the scene render by only ≈0.3 ms (within noise). Triangle count matters more on phones (Lite mode, no composer).
- **DPR** is capped at 1.5 (High) with a 3.5 MP pixel budget, plus adaptive DPR (0.6–1.0×, `main.js:1153-1186`). This is fine.

### 1.4 Render loop and memory

**What already works well**
- Render-on-demand (`main.js:1137-1236`).
- AO is deferred until the view is still.
- Adaptive resolution.
- Floors above the cut are skipped (`showBand`).

**Per-frame or per-event allocations**

| Where | What |
|---|---|
| `main.js:1268` | `camera.position.clone()` every rendered frame (`pins` is now empty, so the loop does nothing). |
| `main.js:1002` | `unitMeshes.filter()` array on every pointermove. |
| `walk.js:72` | `new Vector3()` every walk step. |
| `walk.js:121` | `feet` getter allocates; it is called 2–3× every 0.3 s. |
| `walk.js:127` | `floorBelow` creates a **new Raycaster + 2 Vector3 per call**. At start-up it is called once per grass sample (≈9,000×). |
| `landscape.js:211` | 2 Vector3 whenever a tree's hide state flips. |
| `materials.js:269` | `a.clone()` for every triangle in `addBoxUVs` (≈240k allocations at load). |
| `lighting.js:26` | Sorts every lamp anchor (≈150) on each rendered frame. It is cheap, but it is O(n log n) for 6 lights. |

**Start-up** (`timings`; total ≈2.8 s to ready)

| Phase | Time | Main contents |
|---|---|---|
| geometry download + decode | 554 ms | |
| building | 185 ms | normals, box UVs |
| fixtures, collision, grass | 170 ms | |
| **units → first frame** | **1.9 s** | 44 ExtrudeGeometry + EdgesGeometry; `setTime`: PMREM, paleSky on the 2k half-float HDR (≈420 ms); first shadow render + **synchronous compile of ~50 shader programs** (≈1.1 s) |

**Eager work that could wait**
- The golden-hour HDR (4.3 MB file, ≈2.8 MB transferred) is loaded and processed at start-up (`environment.js:53-61`), even though the site opens in daytime.
- `paleSky()` runs for golden too.
- `map.js` imports 3d-tiles-renderer (105 KB) before the map is ever switched on.

**Leaks**
- The pano texture (1.2, Disposal).
- `invalidate` listeners and the rest are global singletons, which is fine.

**Event throttling:** pointermove picking is a raycast against 4–44 boxes, which is cheap. `invalidate` is already debounced by a timestamp.

### 1.5 Priority matrix

| # | Priority | Finding | Location | Fix (Phase 2/3) |
|---|---|---|---|---|
| P0 | **Critical** | MSAA ×4 on both composer ping-pong targets: every post pass writes and resolves a multisampled half-float buffer, ≈9 ms of a 13.5 ms frame. | `js/main.js:93` | Render only the scene into a private MSAA target; composer targets at 0 samples. |
| P1 | **High** (phones) | Ferns: the glTF holds 4 fern variants side by side (b 2,384 / c 2,248 / a 784 / d 816 triangles), and all 4 are instanced at each of the 72 spots as a 1 m cluster. 449k triangles (30 % of the scene); measured cheap on desktop (≈0.3 ms), heavy for phone GPUs. | `js/landscape.js:230-255` | Desktop: unchanged (keeps the look). Lite / phones: the two heavy variants are replaced by rotated copies of the light ones, so the cluster density is the same at −49 % triangles. |
| P2 | **High** | Bloom 1.6–3 ms per frame; in daylight no lamp passes its threshold, so it adds nothing. | `js/main.js:117`, `setTime` `main.js:868` | Disable the pass when the time of day has no glow (day outdoors). |
| P3 | **Medium** | 6 point lights are evaluated for every pixel even when the pool light is at intensity 0. | `js/lighting.js:16-35` | Keep them (removing lights recompiles every shader); the cost is part of the scene's 3.6 ms. Revisit only for phones. |
| P4 | **High** | 1.9 s main-thread freeze before the first frame (shader compile + paleSky). | `js/main.js:1279`, `js/environment.js:165` | `renderer.compileAsync` behind the loading screen; paleSky at reduced resolution. |
| P5 | **High** | ≈2.2 MB of textures downloaded and decoded but never used. | `js/materials.js:119` | Drop `photo`; skip `diff` for `bumpOnly`; skip the unused grass roughness map. |
| P6 | **High** | Golden HDR (2.8 MB) loaded and processed at start-up. | `js/environment.js:53-61` | Load each HDR when its time is first chosen. |
| P7 | **High** | Visible coplanar z-fighting between different-looking surfaces (hand estimate ≈118 m²; the exact tool count in Phase 3 is **169.9 m² in 269 surface pairs**). Examples: beams in plaster walls, casework on tiled floors, wood ceilings on FC boards. | `data/geometry.bin` (see 1.6) | Geometric 2–10 mm offset of the visible surface (Phase 3). |
| P8 | **High** | Duplicate stair geometry: Stairs and Runs/Landings exported twice (800 triangles, 65 m² of overdraw and z-fight). | `data/geometry.bin`, groups Stairs L1 | Remove the duplicate copy (Phase 3). |
| P9 | Medium | 58 extra draw calls: one mesh per Revit material instead of per look. | `js/main.js:268-288` | Merge by look signature per level. |
| P10 | Medium | 6 opaque MeshPhysical (clearcoat) materials on tiles and porcelain. | `js/materials.js:193-195` | MeshStandard with tuned roughness / env intensity. |
| P11 | Medium | Shadow frustum not fitted (≈40 % of texels on empty lawn), far plane 3× too deep: blurrier shadows than the 4096 map could give. | `js/main.js:390-391` | Fit the ortho frustum to the building + near trees in light space. |
| P12 | Low | Water casts shadows; distant tree rings are drawn into the (static) shadow map. | `js/main.js:284`, `js/landscape.js:168` | Exclude every transparent material; outer rings `castShadow=false`. |
| P13 | Medium | Pano textures never disposed (GPU leak on each room opened). | `js/main.js:1090-1097` | Dispose the previous map. |
| P14 | Low | Per-frame / per-step allocations. | `main.js:1268`, `main.js:1002`, `walk.js:72,121,127`, `landscape.js:211`, `materials.js:269` | Reuse scratch vectors and a cached array. |
| P15 | Low | Fixture DoubleSide material cloned for every part. | `js/main.js:337` | Cache one DoubleSide variant per base material. |
| P16 | Low | Mood anchor sort every frame. | `js/lighting.js:26` | Partial selection of the 6 nearest, only when the focus moved >0.5 m. |
| P17 | Low | Bark material DoubleSide. | `js/landscape.js:131` | FrontSide (closed limbs). |
| P18 | Low | Same-look coplanar overlaps (≈400 m², e.g. columns flush with walls, wall stacks at level joints) and 1,400 same-group duplicate triangles. | `data/geometry.bin` | Not visible (identical shading). Collapse exact duplicates; leave flush same-look faces (removing them needs Revit join cleanup). |

### 1.6 Geometry integrity scan (`tools/scan-overlaps.mjs`, read-only run)

**Method**
- Every triangle of `data/geometry.bin` is bucketed by quantised normal (0.005) and plane offset (3 mm, plus the neighbouring bucket).
- Pairs from different groups that lie on the same plane within 1.5 mm and face the same way are clipped against each other (Sutherland–Hodgman) to get the true overlap area.
- Exact duplicates are matched by their sorted vertex triplets at 0.1 mm.

**Results**
- 232,862 triangles. 61 are degenerate (zero area).
- **3,228 exact duplicate triangles** in 142 group pairs.
- **352 coplanar overlapping group pairs, 525 m² in total.**

A pair is only *visible* z-fighting when the two surfaces look different. The cream plaster preset is shared by CEMENT, CONCRETE, Default Wall and the other names listed in 1.1, so most of the area cannot be seen.

| Zone | Pair (look A ↔ look B) | Area | Where (Revit x, y, z) | Visible? |
|---|---|---|---|---|
| 1 Site | Pine furniture (planter/bench top) ↔ SOIL toposolid | 5.8 m² | (−7.3, −0.9, 0.00) | **yes**: wood ↔ paving |
| 1 Site | Floors ↔ Toposolid | 1.1 m² | site edge | **yes** |
| 1 Site | Ground plane (`main.js:369`, y −0.25) ↔ SOIL toposolid underside at −0.25 | n/a | (−13…−5.6, −3.8…8.4) | no: opposite facing, the underside is back-face culled. Checked by downward ray sampling (13,432 rays, 0.5 m grid): no same-facing coplanar hits. |
| 2 Structure | Structural framing (grey concrete) ↔ CEMENT / Default Wall (cream plaster) | 34 m² | beams flush with wall faces, every level (e.g. (−3.8, 0.5, 11.9), (−4.1, 3.1, 7.8)) | **yes** |
| 2 Structure | Structural framing ↔ floors (same concrete) | 56 m² | slab soffits | no (same look) |
| 2 Structure | Structural columns (CONCRETE→plaster) ↔ CEMENT walls (plaster) | 152 m² | columns flush in walls, L2–L4 | no (same look) |
| 3 Envelope | Wall ↔ wall (CEMENT L2↔L3 etc., stacked at level joints) | 79 m² | level joints | no (same look) |
| 3 Envelope | Doors ↔ walls | 1.4 m² | door frames | **yes** |
| 4 Openings | Window ↔ window | 2.1 m² | window frames | **yes** (frame vs sill) |
| 4 Openings | Ceilings ↔ curtain wall mullions | 0.9 m² | head of curtain wall | **yes** |
| 5 Roof / ceilings | FC ceiling board ↔ softwood lumber ceiling | 9.0 m² | (−3.9, 6.5, 15.5) L4 | **yes**: plaster ↔ wood |
| 5 Roof / ceilings | Softwood lumber ceiling ↔ CEMENT walls | 3.3 m² | (−1.6, 2.4, 11.5) | **yes** |
| 6 Circulation | Stairs ↔ Runs: **exact duplicates** (464 + 292 triangles) | 58 m² | stair cores (−6.9, 4.1) and (2.1, −0.6) | no (same look), but double geometry |
| 6 Circulation | Stairs ↔ Landings: duplicates (44 triangles) | 6.8 m² | (2.0, −2.4, 1.9) | no, but double geometry |
| 7 Interior | Pine casework ↔ CEMENT SPESI (tile) floors | 23 m² | built-in beds / wardrobes, L2–L4 | **yes**: wood ↔ tile |
| 7 Interior | Floors (tile) ↔ furniture (Pine) | 13 m² | L2–L4 | **yes** |
| 7 Interior | Furniture "Default" ↔ CEMENT walls | 14 m² | wall-hung items L2–L4 | **yes** |
| 7 Interior | Casework ↔ walls, casework ↔ furniture | 11 m² | | **yes** |
| 7 Interior | Same-group duplicates: Furniture "Default" ×198 (L3, L4), Sony black plastic ×152, Ceilings lumber ×117 and others | | | no, but double geometry |

**Transparency checks**
- Glass: `transparent`, `depthWrite:false`, renderOrder 3, excluded from shadows.
- Unit volumes: renderOrder 4, `depthWrite:false`.
- Floor bands: opacity 0 unless hovered.
- Water writes depth (`depthWrite` default true) and renders in the transparent queue. Glass behind water can disappear. There is one pool, so this is low risk; it is fixed with the other transparency settings.
- Leaves and ferns: `alphaTest` + alpha-to-coverage (correct, no sorting needed).

**Normals, light leaks and UVs**
- Normals are recomputed per mesh (`computeVertexNormals`) on non-indexed triangles, so they are flat per face (no smoothing seams).
- Revit winding is consistent for solids. Mirrored fixtures are handled by DoubleSide (`main.js:335`).
- UVs are world-space box projection in metres, so the texture is continuous across neighbouring elements by construction.
- No inverted solids were found by the scanner. Opposite-facing coplanar pairs are back-to-back faces, which is normal for walls meeting slabs.

---

## PHASE 2: Optimisation (applied)

| # | Change | Where | Result |
|---|---|---|---|
| P0 | The scene renders into its own 4× MSAA half-float target (with stencil, for the caps) and is resolved **once** into single-sample composer buffers. Bloom, tone mapping and grade no longer pay a multisample resolve. | `js/main.js` `MSAAScenePass`, `buildComposer` | Moving frame 16.1 → 7.6 ms, AO frame 23.8 → 7.9 ms (1280×720). Edges still antialiased: pixel diff vs original 0.64/255. |
| P1 | Lite (phones): the two heavy fern variants use the light variants' shapes (same clumps, same spots). Desktop unchanged. | `js/landscape.js` fern loader, `createLandscape({lite})` | Lite: ferns 449k → 230k triangles. |
| P2 | Bloom **left on.** With P0 it costs ≈0.1 ms, so turning it off in daylight would change the look for no gain. | — | Kept. |
| P3 | Point-light pool **kept** (removing lights recompiles all shaders; the cost is inside the 3.6 ms scene pass). | — | Kept. |
| P4 | Shaders are compiled with `renderer.compileAsync` behind the loading screen, for the real target and the real sky/fog/environment. The sky background is built at half resolution (cloudless "pure sky" photos, visually identical). | `js/main.js` end of file, `js/environment.js` `paleSky`/`analyse` | Warm start-up to first frame 1.33 → 0.97–1.04 s; the 0.4 s sky freeze is about 4× shorter. |
| P5 | Unused texture downloads removed: the `photo` copy, the colour map of bump-only sets, the lawn's roughness map. `photoTextures()` (never called) removed. | `js/materials.js` `realTextures` | −2.2 MB of JPGs, 7 fewer image decodes. |
| P6 | Each HDR sky is fetched the first time its time of day is chosen. The procedural sky stands in for the ~1 s it takes. | `js/environment.js` `requestHdri` | Golden-hour HDR (4.3 MB file) is no longer loaded at start. |
| — | Google 3D-tiles library and Draco are imported only when the map is switched on. | `js/map.js` | −105 KB+ JS at start. |
| P9 | Revit materials that render identically share **one material**, and the building is merged per *look* per floor. | `js/materials.js` `lookCache`, `js/main.js` building loop | Meshes 396 → 323, materials 151 → 106, draw calls −84 (moving) / −150 (AO). |
| P10 | Porcelain / ceramic tiles: MeshPhysical (clearcoat) → MeshStandard (roughness 0.1, env ×1.25). | `js/materials.js` `porcelain` | MeshPhysical 13 → 3 (only glass, frosted glass, water). |
| P11 | Shadow frustum **not changed.** Fitting it to the building plus its projected shadow measured 0.9–1.5× the current area (no gain). | — | Kept 4096², ±34 m. |
| P12 | Transparent materials (glass **and** water) don't cast. The outer tree rings (lod 1, > 45 m) are left out of the shadow map. | `js/main.js`, `js/landscape.js` | Shadow casters 230 → 155. |
| P13 | The previous panorama (up to 7280×3600) is disposed when another room is opened. The same room type is not re-downloaded. | `js/main.js` `openPano` | No GPU leak per opened room. |
| P14 | Per-frame / per-step allocations removed: pins loop, pick list, walk step vector, `floorBelow` (≈9,000 Raycasters at start-up), tree-hide vectors, `addBoxUVs` clone per triangle. | `main.js`, `walk.js`, `landscape.js`, `materials.js` | JS heap after start 148 → 83 MB. |
| P15 | One double-sided fixture material per base material (instead of a clone per part). | `js/main.js` fixtures | Fewer material objects. |
| P16 | Mood lights re-sorted only when the focus moves ≥ 25 cm or the lamp strength changes. | `js/lighting.js` | No sort on still frames. |
| P17 | Bark **kept** DoubleSide (open limb tubes are visible from inside at the forks). | — | Kept. |
| P18 | See Phase 3. | | |

## PHASE 3: Geometry, overlap and glitch fixes (applied)

**Tools** (dev only, in `tools/`, not uploaded):
- `fix-geometry.mjs` always starts from the untouched export (`data/geometry.orig.bin`, `data/model.orig.json`) and writes `data/geometry.bin` + `data/model.json`.
- `pack-geometry.mjs` then writes `geometry.q.bin.gz` and the new `cap.q.bin.gz`.
- `scan-overlaps.mjs [--orig] [--visible]` checks the result.

**Method**
1. **Zero-area triangles**: removed (61).
2. **Exact duplicate triangles**: one copy kept (3,228 removed).
   - Stair assemblies exported twice (Stairs + Runs/Landings).
   - Furniture "Default" and Sony TVs doubled inside the same element.
   - Wall/column faces exported twice, and similar cases.
3. **Coplanar, same-facing, overlapping faces of different-looking surfaces** (z-fighting). Faces are grouped into true planes (≤ 1.5 mm). In each plane the surfaces are ordered by what should be seen:
   - order: joinery / furniture / doors / windows > finishes > structure > site
   - then a timber/tile finish wins over plain plaster
   - then the smaller surface wins

   The visible one is moved **2–10 mm along its face normal** (5 mm normally). The tool picks the first step that doesn't land on another surface already sitting there (for example a tile layer 5 mm above the slab), and repeats until nothing is left (5–8 passes).
   - **No polygonOffset** is used.
   - Every corner of that surface on the plane moves, so its own faces stretch and stay closed.
   - The other-material faces of the same Revit element that meet it at a corner (an element split over two materials) are stretched too, so no hairline gaps open.
   - Zero-thickness panels (both faces on one plane) move only once per pass.
   - **Same-look overlaps are left alone** (they can't flicker). Removing them needs a Revit "Join Geometry" clean-up.
4. **Section caps.** The stencil caps of the floor cut count surfaces, so they need perfectly closed solids. They now use the **untouched** walls/floors/columns/beams/roofs (`data/cap.q.bin.gz`, 133 KB). Without this, the first attempt showed light streaks on cut floors.

**Totals**

| | Before | After |
|---|---|---|
| Building triangles | 232,923 | 229,634 (−3,289) |
| Zero-area / duplicate triangles | 61 / 3,228 | 0 / 0 |
| **Visible** coplanar overlap (different looks) | **169.9 m², 269 pairs** | **0.05 m², 4 pairs** (−99.97 %) |
| Same-look coplanar overlap (cannot flicker) | 355.5 m² | 171.5 m² |
| Largest move of a corner | — | 10.2 mm along one axis (14.1 mm diagonal at a box corner) |

**Zone-by-zone resolution log** (visible area before → after; locations are Revit metres x, y, z)

| Zone | Before | After | What was done (examples) |
|---|---|---|---|
| 1 Site / landscape | ≈7.5 m² | 0 | Planter/bench (Pine) on SOIL toposolid at (−7.3, −0.9, 0.00) lifted 5 mm. Floors ↔ toposolid and beam ↔ toposolid separated. The ground plane at −0.25 was checked: no same-facing overlap. |
| 2 Structure / slabs | ≈45 m² | 0 | Plaster wall faces moved 5 mm proud of flush concrete beams on every level, e.g. (−3.8, 0.5, 11.85), (−4.1, 3.1, 7.8), (−2.0, −3.9, 15.9). Slab tops vs columns/beams separated. |
| 3 Envelope / facade | ≈28 m² | 0 | Floor finish (tile, deck) over wall/column tops at each level joint, e.g. DECK 5 L4 at z 12.0, CEMENT SPESI at z 7.95 / 11.95. Door frames over walls. |
| 4 Openings / glazing | ≈3.5 m² | 0.02 m² | Window frame ↔ sill, curtain-wall mullion heads vs ceilings. Remaining: a 0.017 m² mullion foot on the L2 floor at (−15.2, 2.6, 5.05), already at the 10 mm limit. |
| 5 Roof / ceilings | ≈19 m² | 0.003 m² | Timber (softwood) ceilings moved 5 mm in front of the FC board ceiling at (−3.9, 6.5, 15.5) and of wall tops at z 11.5 / 7.5. |
| 6 Vertical circulation | duplicates only (65 m² of double stair geometry) | 0 | 800 duplicate stair/landing triangles removed; the run copies are kept. |
| 7 Interior | ≈63 m² | 0.03 m² | Built-in joinery (Pine) on tiled floors and walls, beds/desks on floors, wall-hung items off walls, at L2–L4, e.g. (−5.5, 5.6, 7.95), (6.0, −1.4, 11.95). Remaining: a 0.033 m² cabinet back on a wall at (−3.6, 1.8, 13.6), already at the 10 mm limit. |

**Transparency, normals, UVs**
- **Transparency** is unchanged and correct: glass depthWrite off and renderOrder 3, room volumes 4, leaves alpha-to-coverage. Water still writes depth. It was not changed and not specifically inspected; it is low risk (one pool).
- **Normals** are recomputed after the offsets, so faces remain flat-shaded.
- **UVs** are world box-projected, so a 5 mm move shifts the texture by 5 mm, which is invisible.

## PHASE 4: Verification

**Checks run** (`localhost:5174`, Chrome / ANGLE D3D11, RTX 4060 Laptop):
- Console: **0 errors, 0 warnings** in every state below.
- Load: HQ and Lite (phone).
- Hero → "Explore in 3D".
- Floor cut Levels 2–4 with section caps.
- Room card, 360° view: two rooms, then closed.
- Walk mode: spawned on the floor, walked 2.4 m, exited.
- Day → golden hour (HDR fetched on demand) → night.
- Building overview, orbit / zoom.
- Pixel comparison against the untouched copy (`localhost:5175`) at identical cameras:
  - overview mean difference 0.64/255 (same resolution)
  - cut floor 0.84/255, edges only
  - the streak regression found on the cut view was fixed (section 3, item 4)

**Performance scorecard.** Same camera. Frame times are medians of 7×20 frames at a fixed 1280×720; everything else is at the live canvas size.

| Metric | Before (uploaded V1) | After | Change |
|---|---|---|---|
| Frame, moving (no AO) | 16.06 ms | **7.55 ms** | −53 % |
| Frame, still (with AO) | 23.79 ms | **7.91 ms** | −67 % |
| Draw calls moving / with AO | 340 / 564 | 256 / 414 | −25 % / −27 % |
| Meshes (instanced) | 396 (101) | 323 (101) | −73 |
| Scene triangles (HQ) | 1,496,293 | 1,491,715 | −4.6k |
| Scene triangles (Lite) | ≈1.22 M (computed) | 1.00 M (measured) | ferns −49 % |
| Materials | 151 | 106 | −30 % |
| MeshPhysical | 13 | 3 | only glass / frosted / water |
| DoubleSide materials | 62 | 56 | |
| Geometries on GPU | 250 | 178 | −29 % |
| Textures on GPU | 54 | 56 | +2 render-target textures from the new scene pass; fewer image files are downloaded |
| Shader programs | 52 | 57 | +copy pass, pre-compiled variants |
| Lights | 9 | 9 | unchanged (by design) |
| Shadow casters | 230 | 155 | −33 % |
| Downloaded at start | 21.75 MB, 84 requests | **15.29 MB, 72 requests** | −30 % |
| JS heap after start | 148 MB | 83 MB | −44 % |
| Start-up to first frame (warm cache) | 1.33 s | 0.97–1.04 s | −25 % |
| Adaptive resolution while orbiting | dropped to 0.85–0.95× | stays at 1.0× | sharper |

A cold first load (empty GPU shader cache) took 4.4 s once for the optimised copy; the original was not measured cold, so there is no comparison for that case.

**Files that differ from the GitHub version** (to upload later):
- `js/main.js`, `js/materials.js`, `js/environment.js`, `js/landscape.js`, `js/lighting.js`, `js/walk.js`, `js/map.js`
- `data/model.json`, `data/geometry.q.bin.gz`, `data/geometry.bin` (fallback)
- **new** `data/cap.q.bin.gz`

**Do not upload:**
- `data/geometry.orig.bin`, `data/model.orig.json`
- `tools/`, `serve.mjs`, `AUDIT.md`

### Follow-up: loading (done after the audit)

| Change | Where | Result |
|---|---|---|
| Photo textures re-encoded as WebP (colour/normal 1024 px, roughness 512 px), fern textures 512 px WebP | `tools/encode-textures.js`, `assets/tex/*.webp`, `assets/models/fern_02/` | used textures 8.6 MB → 1.9 MB |
| HDR skies halved to 1024×512 (2×2 average in linear light, sun energy kept); the visible sky was already shown at that size | `tools/shrink-hdr.mjs`, `assets/sky/*_1k.hdr`, `js/environment.js` | 4.3 MB → 1.1 MB each |
| Textures start downloading once the building is built. Until then each map is a 1-pixel stand-in of its average colour, so nothing renders black on slow connections | `js/materials.js` (`startTextureLoading`), `js/main.js` | model + code get the bandwidth first |
| Model data, code libraries and the cover picture are requested immediately (`preload` / `modulepreload` / `<img src>`) instead of one after another | `index.html` | everything needed for the first frame starts at 0.13 s |

**Result**
- Download at start: **15.5 → 5.6 MB** (the live V1 is 21.8 MB). The building appears after ≈2.4 MB.
- Local start-up: 0.86 s.
- Console clean.
- Pixel comparison with the original (overview / facade / lawn): mean difference 2.7–4.1 / 255. That is a 1–1.5 % overall brightness lift from the 1k sky lighting, with no visible texture loss.

**Estimate on a 10 Mbit/s phone connection** (not measured):
- Building on screen in ≈2 s plus CPU time.
- Fully loaded in ≈5 s, against ≈17 s for the live V1.

### Remaining recommendations

1. **Revit re-export clean-up.** This is the real fix for what the tools patch around. Steps:
   - **Join Geometry** on walls ↔ columns/beams/slabs. This removes 171 m² of same-look coplanar faces and the flush-face problem at source.
   - Export stairs once (assembly *or* runs/landings).
   - Remove the doubled "Default" furniture family and the doubled TV.
   - Give zero-thickness panels a thickness.
   - After every export: `node tools/fix-geometry.mjs` then `node tools/pack-geometry.mjs`.
2. **Meshopt / Draco geometry.** The 16-bit + gzip pack (1.13 MB) could go to ≈0.5–0.6 MB with meshoptimizer (also indexed, so the GPU does less vertex work).
3. **KTX2 / Basis textures.** The 1k photo JPGs are 0.1–1.2 MB each. KTX2 (UASTC for normals, ETC1S for colour) cuts GPU memory 4–6× and avoids the main-thread decode.
4. **HDR skies.** 4.3 MB per `.hdr` (2.8 MB transferred). A 1k RGBE or KTX2-HDR version (≈0.5–1 MB) would make golden hour appear almost instantly.
5. **Ferns on desktop.** Already cheap on a desktop GPU. A distance LOD could also halve them for integrated laptop GPUs.
6. **Cold-start shader cache.** The first-ever visit still compiles ~57 programs. Fewer material variants (see 1) would shorten it.
