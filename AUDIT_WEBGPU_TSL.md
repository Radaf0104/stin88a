# STIN 88A: Phase 1 audit for the WebGPU/TSL photoreal rebuild

- **Build audited:** `cebeb71` (live), branch `v5-glb-site`. Local code is identical; only the log commit `3030d67` is newer.
- **Date:** 2026-11-27.
- **Briefs:**
  - `research/BRIEF_webgpu_tsl_photoreal.md` (brief 1)
  - `research/BRIEF_2_advanced_photoreal.md` (brief 2; its five pillars are in §7)
- **References:**
  - Facade and interior: `3.jpg` (= `6.jpg`, the same file).
  - Site, landscape and aerial: `8.webp` (tropical campus aerial) and `9.webp` (hillside campus in haze).
  - Interiors: the Nagoya Hill notes (`research/nagoya-hill-reverse.md`).
- **Captures** (in `tools/out/`):
  - `audit_hero_cebeb71.jpg`: the default overview.
  - `audit_render0_cebeb71.jpg`: the render-0 gallery camera, the closest one to 3.jpg.
- **Gap matrix:** the research agent wrote the full matrix in `research/gap_matrix_webgpu.md`. §5 merges it and adds the aerial and landscape rows from 8/9.webp.

---

## 0. Summary

1. **The biggest gap is not the renderer.**
   - The gap is mostly composition and content:
     - The camera is a high aerial view, not an eye-level two-point view.
     - There are no trees or context.
     - White neighbour massing fills the background.
     - There is no ambient occlusion.
     - Glass shows neither reflections nor lit rooms.
   - All of these can be fixed under either renderer.
2. **The renderer is three r170 `WebGLRenderer`.**
   - Output is sRGB with Neutral tone mapping (day; AgX for golden/night) at exposure 1.0.
   - Lighting is one sun with a 2048 PCF-soft shadow, a hemisphere fill, an HDRI environment at intensity 0.2, and 6 pooled point lights.
   - There is **no post-processing** at all: the grade, vignette and fake bloom are injected into every material.
3. **There are 8 `onBeforeCompile` shader hooks, plus 2 `ShaderMaterial`s, stencil section caps and a clipping plane.**
   - The two global hooks, the grade (`grade.js`) and the iso mask (`isolate.js`), touch every material.
   - All of this must be rewritten for TSL. None of it is a blocker; §6 has the port list.
4. **Performance today:**
   - 331 draw calls and 563k triangles in the overview.
   - **21 ms median per frame** at 2000×1116 on an RTX 4060 laptop, measured in the hidden built-in browser pane, so treat it as an upper bound.
   - The 60 FPS target is therefore **already not met at 1.25× pixel ratio on desktop** before any GTAO, SSR, transmission or DoF is added.
   - The rebuild needs quality tiers from day one. On phones, 60 FPS with the full photoreal stack is not realistic; 30 FPS with a reduced tier is.
5. **Moving to WebGPU/TSL is feasible.** The recommended route is a **staged port** with the WebGL 2 backend of `WebGPURenderer` as the fallback and the old renderer kept behind `?renderer=classic` until the new one has parity (§6).

---

## 1. Renderer pipeline and colour management

| Item | Current (`js/main.js`, `js/environment.js`) | Assessment | Target |
|---|---|---|---|
| three.js | r170 from jsDelivr through an **importmap**. **No package.json and no Vite**: the brief's "Three.js + Vite" assumption is wrong; it is plain ES modules and a static host. | r170 has `three/webgpu` and `three/tsl`, but TSL changed a lot between r170 and current releases (PostProcessing, `ao()`, `ssr()`, `traa()`, `reflector()`, ClippingGroup). | Upgrade to the current three release and pin the exact version in the importmap (`three.webgpu.min.js` + `three.tsl.min.js`). Keep the importmap; no bundler is needed. |
| Renderer | `WebGLRenderer({antialias, stencil})`; `renderer.clippingPlanes = [clipPlane]` (plan cuts); a second WebGLRenderer for the 360° panorama viewer. | A WebGL-only API surface. | `WebGPURenderer({antialias, stencil, forceWebGL: ?})` with `await renderer.init()`; the panorama viewer can stay a separate small WebGL page. |
| Colour space | `outputColorSpace = SRGBColorSpace` (default); textures tagged correctly (sRGB albedo, NoColorSpace for data). | Correct linear workflow. | Unchanged. |
| Tone mapping | Day: **NeutralToneMapping** at exposure 1.0. Golden and night: **AgX** at 0.75. | Neutral was chosen because AgX greyed the sky. It is fine for the reference's clean whites. | Keep Neutral for day, AgX for golden and night, applied in `renderOutput()` at the end of the post chain. |
| Grade | `grade.js` injects contrast, gain, gamma, saturation, warm/cool split, vignette **and a fake bloom** into **every material** through `onBeforeCompile` (before and after the tone curve), plus a graded sky `ShaderMaterial`. | Clever for "no post-processing" (round 20), but it changes every shader and blocks a real bloom or AO. | One TSL grade node in the post chain (contrast, lift/gamma/gain, WB, vignette) and a real selective bloom. Every material is then untouched. |
| Pixel ratio | Cap 1.5 desktop / 1.25 phone, budget 3.5 MP, adaptive `dprScale` 0.6–1 from frame time (33 / 18 ms thresholds). | Good. | Keep, and add the quality tiers (§6.4). |
| Render loop | Render on demand; shadows rendered once (`autoUpdate=false`); start-up compiles shaders off-screen. | Good; keep it. WebGPU needs `renderer.compileAsync` for the same effect. | Same model, using `compileAsync`. |
| Draw calls | Overview **331 calls, 563k triangles**; 957 meshes (79 instanced), 144 materials, 63 textures, 34 programs. | Acceptable for desktop. Phones are the limit. | WebGPU lowers per-call CPU cost; keep the static merge and instancing. |
| Texture compression | KTX2: ETC1S colour, UASTC normals, 512 px (phone 256). 57 desktop files, 4.4 MB; 1.4 MB phone. | Good format. 512 px is soft for close-ups. | Keep KTX2. Use 1k for the hero materials (stucco, teak, glass dirt) only on the desktop tier. |
| **Anisotropy** | **All glTF textures (stucco, concrete, teak, battens, deck, paving, tiles) have `anisotropy = 1`.** Only the site plan (8) and style rooms (8) set more. The GPU supports 16. | **Real defect:** facades and the ground blur at grazing angles. It is a one-line fix in the loader. | 8 on desktop, 4 on phones, for every material map. |
| Lightmaps | A baked lightmap/AO pipeline exists (`lightmaps.json`, `data/levels/lm/`), but **0 meshes are lightmapped** at run time. | Dead weight in the repo; it would be a good AO source if re-baked. | Either re-bake AO for the shell (uv1) or delete it; see §4. |

## 2. Geometry, scale, normals and UV

- **Source:**
  - Revit → Blender → glTF, packed with gltf-transform and meshopt (`tools/pack-levels.mjs`).
  - 6 level files plus ROOF, SITE and SITEPLAN.
  - Units are metres; the scale is correct (checked against room dimensions in earlier rounds).
- **Hierarchy and naming:**
  - Every level is merged per material (`mergeLevel`).
  - Meshes carry `userData` (`y`, `kind`, `style_room`, `bathroom`, `lm_set`).
  - Material names are stable, e.g. `M_plaster_cream`, `M_teak_batten`, `Glazing-Clear`. The TSL material factory can map by name directly.
- **Normals and winding:**
  - Revit winding is **inconsistent** (round 27: switching to FrontSide made the wardrobe and shelves vanish).
  - Opaque presets are FrontSide only where safe; furniture and casework stay DoubleSide.
  - TSL normal maps must handle back faces (`frontFacing` flip); three does this by default for DoubleSide.
- **Hard edges:**
  - The Revit solids have no bevels anywhere (parapets, window boxes, slab edges, columns), so silhouettes are knife-sharp.
  - At hero distance a 1–2 cm bevel would show as a thin highlight line in 3.jpg.
  - Fix in TSL without changing geometry: an **edge-wear/rounded-edge approximation** from the AO/curvature in the post pass, or a baked curvature map. Changing geometry is excluded for furniture and not worth it for the shell.
- **UVs:**
  - Shell meshes get **box-projected metre UVs** (`addBoxUVs`), so the real-world scale is correct.
  - Seams show where box faces change axis. Tiling is visible on large plaster walls, since one 512 px tile repeats every ~1 m with no breakup.
  - The site plan has metre UVs (round 18).
  - Battens are one GPU-instanced unit box (round 21) with hashed UV jitter.
  - **TSL fix:** triplanar `positionWorld` mapping for plaster, concrete, roof and paving removes the seams, plus macro noise breakup at 3–30 m. Keep UVs for wood (grain direction) and fabrics.
- **Overlaps and z-fighting:** none known in the shell. Accent decals use polygonOffset.

## 3. Materials

Live scene: **144 materials**. These were collected from the running page; the "x" column is how many meshes use each one. Every Revit/GLB material is a `MeshStandardMaterial`, built either by the preset factory (`js/materials.js`, `proctex.js`) or by the style-room factory (`roomstyle.js`). Glass and water are `MeshPhysicalMaterial`.

**No material anywhere has an `aoMap`. No glass uses `transmission`. No metal has anisotropy.**

### 3.1 Shell and exterior (what the hero shows)

| Material | Uses | Current | Weakness vs. photoreal PBR | TSL / PBR target |
|---|---|---|---|---|
| `M_plaster_cream` (facade stucco) | 15 | Photo texture (map, normal ×1.3, rough), tinted toward cream; roughness 1 × map; anisotropy 1. | Shaded faces turn **pink/mauve** (peach albedo, warm ground fill and low environment). The tile repeats with no macro variation, and grain blurs at grazing angles. | `MeshStandardNodeMaterial`: albedo ≈ #E4DDD3; triplanar trowel normal; `mx_fractal_noise_float` macro value ±4% and roughness 0.82–0.94; grime gradient at the base and under sills (height above slab, AO-driven). |
| `M_plaster_grey`, `M_concrete` | 7 / 13 | Photo textures as above. | Same; the concrete is a uniform tile with no formwork or staining. | Triplanar concrete with pores normal; roughness 0.7–0.9 from noise; drip streaks below edges (`positionWorld.y` gradient × noise). |
| `M_teak_batten` (fins, screens) | 2 (instanced) | Photo wood plus the `addBattens` shader (procedural 10 cm battens with a dark gap and per-batten tone) or real instanced boxes. | Reads grey-beige and mesh-like from a distance, with no self-shadowing relief. Albedo too grey. | Albedo #9C7A5C; grain along Y; roughness 0.5–0.65 following the grain; per-instance hue ±4% from `hash(instanceIndex)`; GTAO in the gaps; a subtle clearcoat 0.15. |
| `M_teak_timber`, `M_wood_light` | 33 / 110 | Photo wood. | Fine up close. Too saturated or orange on soffits and decks. | Shared `woodNode(params)`: grain, roughness along the grain, per-board variation. |
| `M_teak_deck` | 5 | Photo wood at 2.5× density (round 19). | **Orange and flat** in the overview, with no AO under the canopy. | #8A6A52, plank normal, AO, roughness 0.5. |
| `Glazing-Clear` | 38 | Physical: colour #4f5c5c, roughness 0.02, opacity 0.28 → 0.9 Fresnel (`onBeforeCompile`), `envMapIntensity` 2.2, DoubleSide, no depth write. | Opaque blue-grey slabs from outside. The environment is only 0.2 globally and nothing is reflected except the HDRI, so there are no reflections of trees or the building. | `MeshPhysicalNodeMaterial`: ior 1.52, roughness 0.03, real Fresnel from `ior` (drops the hook), thin attenuation tint; **transmission only on the desktop/Ultra tier and only for the few hero panes**; otherwise alpha + env. Lit rooms behind (§4). |
| `GLAZINGfrosty` | 3 | Physical, roughness 0.45, opacity 0.55. | OK. | Transmission with roughness 0.4 (Ultra) or alpha. |
| `M_metal_grey`, `M_metal_dark` (frames, railings, fascia) | 108 / 5 | Flat colour, metalness 0.35, roughness 0.5–0.55. | **Metalness 0.35 is physically wrong** (0 or 1). No map. Railings alias into solid bands. | Powder coat: metalness 0, roughness 0.35–0.5, colour #2B2C2E (frames) / #8E8F8C (fascia), micro-roughness noise; railings anti-aliased with MSAA/TRAA. |
| `M_metal_brushed`, `M_chrome`, `M_brass` | 51 / 20 / 17 | Brushed: metalness 1 + map. Chrome: roughness 0.08. Brass: **metalness 0** (wrong). | Brass reads as yellow plastic, and no metal has anisotropy. | Brushed: `anisotropy` 0.6 along U. Brass: metalness 1, roughness 0.3, colour #C9A46A. |
| Roof (`ROOF.gltf`, `M_roof_shingle`) | 2 | Flat colour, roughness 0.9. | Large **flat dark brown** areas dominate the aerial views. | Membrane/gravel #9C9892, triplanar gravel normal and noise, roughness 0.95. |
| `M_site_paving`, `SITE_road`, `SITE_pad` | 2 / 1 / 1 | Photo or canvas maps, roughness 0.9–0.95. | Uniform near-black asphalt; no kerbs, joints or wear. | Asphalt #3A3D40 with fractal noise ±6%, tyre-track roughness bands; pavers with grout (`fract(uv*n)` mask: grout roughness 0.95 vs. stone 0.6). |
| `SITE_grass`, `SITE_soil` | 1 / 1 | Canvas colour map, no normal; flat olive plane. | **A flat lawn**: no blades, no colour variation, hard edges. | Tiled CC0 grass (2 m) + macro noise hue (15–30 m) + roughness 0.9; instanced grass cards near the camera (desktop); soil-to-grass blend mask. |
| `Water` | 1 | Physical, opacity 0.75, roughness 0.03. | No reflection, ripple or depth. | Brief 2 pillar 2 (§7). |
| Massing (`massing.js`, neighbours) | – | Flat white or cream boxes with outline lines. | Fills the background of every view as glowing white blocks. | Lower the albedo to 0.55–0.65, fog them strongly, or swap in low-poly context buildings with glazing bands (9.webp style). |

### 3.2 Interiors and furniture (geometry frozen; materials may change)

- **Template rooms K.401/405/407/413/416 (`RS_*`, ~85 materials):**
  - Canvas palette textures plus the round-28 CC0 linen, bouclé, oak and laminate maps.
  - No AO maps; contact is faked by the round-22 accent shadow decals.
  - Wood panels and doors: roughness 0.5 with no normal map.
  - Ceramics: roughness 0.15, colour only.
  - Target: the same `woodNode` and `fabricNode` with a sheen for fabrics (`MeshPhysicalNodeMaterial.sheen`), plus AO from GTAO.
- **Other rooms (`M_fabric_*`, `M_book_*`, `M_lamp_*`, `potted_plant_04`, `modern_arm_chair_01_*`):**
  - Photo or colour materials.
  - Lamp shades and globes are opaque standard materials, not emissive.
  - Target:
    - Lamp shades: emissive plus transmission (Ultra) or emissive only.
    - LEDs: emissive at 2700–3000 K into bloom.
- **`M_porcelain`, `M_tile_floor`, `M_tile_wall`:**
  - Roughness 0.1–0.35; tiles have photo maps.
  - Target: grout mask with separate roughness, and a clearcoat on the porcelain.

### 3.3 Shader hooks that hold materials together today (must be replaced)

| Hook | File | Purpose | TSL replacement |
|---|---|---|---|
| Grade + fake bloom (all materials) | `grade.js:67` | Colour grade inside every shader. | A post node (§1). |
| Iso / isolation mask (all materials) | `isolate.js:64` | Fades or hides everything outside the selected unit/floor polygon, with a "deep" channel for stairs. | `opacityNode`/`discard` driven by a shared `texture(maskTex, positionWorld.xz)` uniform node, added in the material factory. Moderate effort. |
| Glass Fresnel alpha | `materials.js:200` | Opacity rises at grazing angles. | Native in `MeshPhysicalNodeMaterial` (ior), or `opacityNode = mix(a, .9, fresnel)`. |
| Procedural battens | `materials.js:272` | Batten stripes on flat panels. | `colorNode` from `fract(positionWorld.x|z / 0.10)`; trivial in TSL. |
| UV jitter per instance | `main.js:336` | Breaks repeated knots on instanced battens. | `uv().add(hash(instanceIndex))`; trivial. |
| Accent contact shadow | `accents.js:15` | Soft fall-off decal computed from instance scale. | `opacityNode` from `uv()` and the instance scale; trivial. GTAO may make it redundant. |
| Leaf wind | `landscape.js:119` | (`landscape.js` is not loaded any more.) | Brief 2 foliage system. |
| Sky (`ShaderMaterial`) + three `Sky` addon | `grade.js:106`, `environment.js:7` | Graded HDRI sky dome; procedural fallback sky. | `scene.backgroundNode` + `SkyMesh` (the TSL sky addon). |
| Section caps (stencil) + clipping plane | `main.js:259, 592, 120` | Plan cuts with dark caps. | WebGPURenderer supports stencil material properties. Clipping uses `ClippingGroup` in current three. Port and test; this is the riskiest piece. |

## 4. Lighting, shadows and environment

| Item | Current | Issue | Target |
|---|---|---|---|
| Sun | DirectionalLight #ffefdc at 7.8, azimuth −38° (front-left of the terrace facade), elevation 48°. | In the eye-level render camera the front facade is lit, which is correct. In the **default aerial view** the camera-facing faces are in shade, and the light is high and flat, so window boxes and fins cast short shadows with little rhythm. 3.jpg has a **low (~25°) warm sun from the front-left**. | Azimuth per camera preset (the preset stores the time/sun), elevation 25–30°, #FFE2C0, then retune the intensity at exposure 1. |
| Shadow | 2048² (1024 phone), PCFSoft, radius 1, bias −2.5e-4, normalBias 0.025; ortho frustum ±34 m (3.3 cm per texel); near 1, far 195; rendered once. | Edges are uniformly soft and blurry at the hero distance, with no contact hardening. The frustum covers the whole site even in the eye-level view. | Fit the frustum to the view per preset (or 2-cascade CSM on desktop), 4096 on Ultra, PCF with a contact-hardening approximation (PCSS-style blocker search in a TSL shadow filter) on Ultra only. |
| Ambient / IBL | HDRI (`autumn_field_puresky`, 512 px equirect → PMREM, 128 per face) at **environmentIntensity 0.2**; hemisphere fill 0.28 (#e2ebf4 / #7a7d4a); RoomEnvironment PMREM indoors. | 0.2 is very low (chosen to fight milky shading in round 10). Shade therefore comes from the hemisphere light, whose olive ground colour plus the peach albedo gives the **pink/mauve shade**. Glass has nothing to reflect. | Environment 0.5–0.7 with a neutral ground; a 1k HDRI for reflections (or a PMREM baked from a cube capture of the scene for glass); the hemisphere light only as a small sky tint. |
| AO / contact | **None** (GTAO was removed in round 20 with the composer). Only interior accent decals. | Recesses, battens, soffits, the deck under the canopy and the furniture-floor contact all float. **The largest shading gap after the camera.** | TSL `ao()` (GTAO) at half resolution in the post chain; Ultra/High only, computed once when the view stops (like round 9's "AO after still"). Optionally a baked shell AO in uv1 for Balanced/phone (the dead lightmap pipeline). |
| GI / bounce | None beyond the hemisphere light. | Deep shade is flat. | A hemisphere ground colour matched to the lawn/paving albedo, plus GTAO's multi-bounce colour. Real-time GI is out of scope. |
| Artificial light | 6 pooled PointLights (3 on phones) for mood lighting, a lazy SpotLight window light, an emissive `roomGlow` box, emissive accents (LED lines, washes). | From outside no room reads as lit (the glass is opaque-looking). | Warm 2700 K emissive room glow behind the glass in the hero, with bloom threshold > 1 so only lamps and LEDs bloom. |
| Fog / atmosphere | FogExp2 #e3ecf4, density 0.0015. | Too light for the aerial views; the site ends at a visible ground edge with no horizon context. | Height-and-distance fog node (aerial perspective: stronger with distance, thinner with height) plus a distant terrain/skyline card ring (9.webp). |

## 5. Visual gap matrix

Facade and interior: `3.jpg`. Site, landscape and aerial: `8.webp` / `9.webp`. Rows 1–21 are condensed from the research agent's matrix (`research/gap_matrix_webgpu.md`), which has the full fix text; rows 22–29 are new, from 8/9.webp.

| # | Element / aspect | Current preview (`cebeb71`) | Target in reference | Root cause & Node/PBR fix |
|---|---|---|---|---|
| 1 | Facade walls / stucco | Cream-peach; shade turns pink/mauve; tiling with no macro variation; blurred at grazing angles. | Warm off-white limewash (≈#E7DBCF lit), fine trowel grain; shade cool grey-beige. | Albedo #E4DDD3; triplanar stucco + `mx_fractal_noise` value/roughness; environment ↑ 0.5; anisotropy 8; neutral hemisphere ground. |
| 2 | Deep window boxes (chamfered recesses) | Thin flat bands; recess depth barely reads. | Strong light-and-shade rhythm: the main facade motif. | Low front-left sun + GTAO `ao()` + a tighter shadow frustum. |
| 3 | Window frames / mullions | Dark, thin; metalness 0.35 (wrong). | Slim charcoal aluminium with a soft specular edge. | Powder coat: metalness 0, roughness 0.4, #2B2C2E. |
| 4 | Fascia / listplank / canopy edges | Thick dark slab edges; canopy tops flat brown. | Slender light-grey fascia lines. | #8E8F8C, roughness 0.5; the eye-level camera hides the canopy tops; an edge highlight via curvature/Fresnel. |
| 5 | Railings | Solid dark bands (aliasing). | Fine black balustrades you can see through. | MSAA 4× + TRAA when still; metalness 0, roughness 0.4. |
| 6 | Glazing | Opaque blue-grey, no reflections. | Reflects sky and trees; warm rooms visible behind. | `MeshPhysicalNodeMaterial` ior 1.52, roughness 0.03; glass-only env boost; SSR on Ultra; transmission on hero panes only on Ultra. |
| 7 | Metal (soffits, columns, hardware) | Flat; brass non-metal. | Grey steel and powder coat, soft highlights. | Correct the metalness; micro-roughness noise; anisotropy for brushed. |
| 8 | Timber battens / louvers | Grey-beige, mesh-like, low contrast. | Warm teak fins (#A0846B) with individual shadows. | #9C7A5C; per-instance hue hash; grain roughness; GTAO; sun low so the fins self-shadow. |
| 9 | Decking / terrace soffit | Orange, saturated, flat. | Natural wood, darker, partly in shade. | #8A6A52, plank normal, AO. |
| 10 | Roof | Large flat dark-brown planes. | Not visible (eye level); in aerials (8/9.webp) light roofs with gravel or green roofs. | #9C9892 gravel triplanar, roughness 0.95; optional sedum/green roof mask for aerial presets. |
| 11 | Asphalt / drive / carport | Large near-black uniform areas. | Thin dark grey strip (3.jpg); in 8.webp a pale plaza with marked parking. | #3A3D40 + noise ±6% + wear bands; parking-line decals; kerbs as a TSL edge mask. |
| 12 | Gravel | Not modelled. | Gravel margins along paths and the building base (8.webp). | Triplanar gravel normal + albedo noise; alpha-blended margin strip along the building footprint (site-plan polygon offset). |
| 13 | Grout / tile joints | Paving and tiles without separate grout roughness. | Brick/stone wall at the garage base (3.jpg); plaza pavers (8.webp). | `fract(uv*n)` grout mask → colour and roughness 0.95 vs. 0.6 stone; normal groove. |
| 14 | Skylight / round lantern | Pale disc. | Glassy ring. | Glass material on the ring. |
| 15 | Lawn | Flat uniform olive plane, hard edges. | Lush blade texture, colour variation, soft foreground. | CC0 grass albedo/normal at 2 m + macro hue noise; instanced grass cards near the camera (desktop). |
| 16 | Trees / shrubs / planters (hero) | **None**; white massing fills the background. | Large trees left and right in haze, hedge, ivy. | Brief 2 foliage system: instanced PBR trees, alpha-to-coverage leaves, wind via `positionNode`. |
| 17 | Sky / atmosphere | Pale gradient with a lilac band; little haze. | Clear soft blue (#C0D3E3 → #D5DDE3), strong aerial perspective. | `SkyMesh` or a clear HDRI; height/distance fog node. |
| 18 | Sun direction / shadows | Elevation 48°, flat light in the aerial view. | Low front-left warm sun (~25°, #FFE2C0). | Per-preset sun; fitted frustum; 2048–4096. |
| 19 | Interior lights from outside | No visible glow. | Warm bedrooms behind the L1 glazing; terrace sconces. | Emissive room-glow node (2700 K) + bloom; sconces as emissive. |
| 20 | Camera (facade hero) | High aerial 3/4, fov 38 at ~(38, 25, 43). | Eye level (~1.7 m), near-frontal two-point, ~35–50 mm, straight verticals; building fills ~80% of the width. | "Hero" preset with a vertical shift (`setViewOffset`) for straight verticals; make it the first view; keep the aerial view as "Overview". |
| 21 | Tone / grade | Neutral 1.0, environment 0.2; lifted blacks (p5 63), slight green cast (RGB 124/130/126). | Contrasty, warm, clean whites, deep but not crushed shade. | Grade node after `renderOutput()` (contrast 1.1, gamma 1.08, warm WB); calibrate p5/p50/p95 against 3.jpg. |
| 22 | **Vegetation density (aerial)** | Nothing on the site plan except lawn. | 8.webp: dense palm and broadleaf canopy, clustered shrubs along curving paths, trees lining roads, rooftop planting. 9.webp: continuous forested slopes. | Instanced tree **populations** from site-plan polygons (Poisson scatter by zone: road edge, lawn cluster, forest fill); 2–3 species × 3 LODs (cross-card impostors past ~80 m); tint per instance; a canopy cast-shadow pass at a lower resolution. Phone tier: impostor cards only. |
| 23 | **Terrain / slope** | A flat site plan ending at an edge; the "horizon" is the ground plane rim. | 9.webp: hillside with forested ridges receding into haze; 8.webp: flat but fully landscaped to the frame edge. | A large low-poly terrain ring (heightfield from public DEM or hand-shaped hills) with forest-canopy texture + normal, faded by aerial-perspective fog; no hard ground edge in any preset. |
| 24 | **Distant context / skyline** | White massing boxes only. | 9.webp: distant city skyline and mountains, desaturated blue-grey by haze. | Massing toned to mid-grey with glazing bands, plus a 360° skyline/mountain card ring at 800–2000 m, fog-blended. |
| 25 | **Atmosphere / haze (aerial)** | FogExp2 0.0015, a uniform light tint. | 9.webp: strong haze, contrast falling with distance, sun-side glow; 8.webp: light humid haze. | Aerial-perspective node: `fog = 1 − exp(−d·k·exp(−h/H))` with a sun-direction in-scatter colour (warm toward the sun, blue away); density per preset. |
| 26 | **Roads and paths** | Straight dark asphalt bands. | 8.webp: curving pale paths with edges, a road with lane markings and pedestrian crossings. 9.webp: a winding road with markings. | Asphalt material + line-marking decals from site-plan polylines; path material (light concrete/pavers) with soft verge blending into grass. |
| 27 | **Water feature** | One small `Water` material; no reflection. | 8.webp: landscaped pond with reflections of trees and buildings. | Brief 2 water system (`reflector()`, Fresnel, ripples). Only where the site plan has water; no new water is invented. |
| 28 | **Plaza / parking** | None. | 8.webp: pale paving with green parking bays, cars, white umbrellas. | Paver material with grout; parking bays as decals; optional low-poly cars (instanced, 2–3 models) for scale. |
| 29 | **Aerial camera presets** | One default overview (high 3/4). | 8.webp: ~45° oblique from a corner at high altitude, wide FOV. 9.webp: low-oblique, long lens toward the ridges, deep haze. | Presets "Aerial oblique" (8.webp) and "Approach, hillside haze" (9.webp), each storing fov, position, target, sun/time, fog density and DoF focus. |

**Top 5 by visual impact:**
1. Eye-level hero camera (20).
2. Low sun + GTAO (2, 18).
3. Vegetation, terrain and haze (16, 22–25).
4. Glass with reflections and room glow (6, 19).
5. Facade materials and anisotropy (1, 8, 9).

---

## 6. Feasibility: `WebGPURenderer` + TSL

### 6.1 Verdict

**Feasible, with a staged port. Not a big-bang rewrite.** Two reasons:
- `WebGPURenderer` falls back to its own **WebGL 2 backend**, and node materials compile to GLSL there, so one material code path serves both.
- Nothing in the site depends on a WebGL-only feature that TSL lacks.

The cost is in replacing the two global shader hooks (grade, isolation), the sky, and the stencil/clip plan cuts, and in re-verifying every view (walk mode, floor isolation, style rooms, plan cuts, map mode).

### 6.2 What has to be rewritten

| Module | Today | Effort |
|---|---|---|
| Import surface | `import * as THREE from "three"` in 15 files + addons | **Moderate.** Every file switches to `three/webgpu` (plus `three/tsl`). Mixing them is forbidden. Addons must be the WebGPU-compatible ones. |
| `grade.js` | All-material grade + fake bloom + sky ShaderMaterial | **Moderate.** Replaced by the post chain (simpler than today). |
| `isolate.js` | All-material mask hook | **Moderate.** The mask is applied as an `opacityNode`/discard in the material factory. |
| `materials.js`, `proctex.js` | Preset factory, canvas procedural textures | **Moderate–large.** It becomes `materialFactoryTSL.js`. Canvas textures can stay as textures or become TSL procedural nodes. |
| `roomstyle.js` | Style-room materials + CC0 | **Small–moderate.** The same textures go into node materials. |
| `accents.js`, battens, UV jitter | Small hooks | **Trivial** in TSL. |
| `environment.js` | PMREM, CubeCamera, `Sky`, RGBELoader | **Small–moderate.** PMREM works; `SkyMesh` replaces `Sky`; `HDRLoader` replaces RGBELoader in newer three. |
| Section caps + clipping (`main.js`) | Stencil + `renderer.clippingPlanes` | **Moderate–high risk.** It needs `ClippingGroup` and stencil support in both backends; prototype it first. |
| Post FX | None | **New:** `PostProcessing` + `pass()` + MRT (normal/depth) + `ao()` + bloom + grade + `traa()`/SMAA + DoF. |
| `map.js` (Google 3D Tiles, 3d-tiles-renderer 0.5.4) | WebGL | **Risk.** Check the current 3d-tiles-renderer with WebGPURenderer; if it fails, keep map mode on the classic renderer. |
| `walk.js` (three-mesh-bvh) | CPU BVH | **None** (CPU only). |
| KTX2 | `detectSupport(renderer)` | **Trivial:** `await detectSupportAsync(renderer)` after `init()`. |
| Panorama viewer | Its own WebGLRenderer | **None:** leave it as is. |

**Rough effort:**
- 8–12 focused working days for parity on the new renderer (same look).
- Then 6–10 days for the photoreal look-dev of brief 1.
- Then 6–10 days for brief 2 (water, foliage, shadows, DoF, calibration).

### 6.3 Browser support (as of late 2026)

- **WebGPU on:**
  - Chrome/Edge desktop
  - Chrome Android (most devices from 2021+)
  - Safari 26 on macOS/iOS/iPadOS
  - Firefox on Windows (newer releases)
- **Fallback:** older Safari, Firefox on other platforms and older Android get the **WebGL 2 backend** automatically.
- **Caveat 1:** the WebGL 2 backend of `WebGPURenderer` is generally **slower** than the classic `WebGLRenderer`, because the generated shaders are larger. This matters for older phones.
- **Caveat 2:** first-time pipeline compilation in WebGPU is slower. Plan `compileAsync` during the loading screen, as round 23 does today.

### 6.4 Risk to 60 FPS and quality tiers

Today: 21 ms per frame at 2.2 MP (desktop RTX 4060 laptop, hidden pane; real foreground numbers are likely lower).

| Tier | Target device | Contents |
|---|---|---|
| **Ultra** | Desktop discrete GPU | DPR ≤ 1.5; GTAO half-res; SSR on glass; bloom; TRAA; shadow 4096 + PCSS-lite; transmission on hero panes; full trees with shadow; grass cards; DoF. Computed fully when still, cheaper while moving. |
| **High** | Laptop iGPU / good tablet | DPR ≤ 1.25; GTAO quarter-res when still; bloom; SMAA; shadow 2048; no SSR/transmission; trees without leaf shadow. |
| **Balanced** | Phones (default when `pointer: coarse`) | DPR ≤ 1.0–1.25 adaptive; no GTAO (baked shell AO if re-baked); no bloom (emissive only); shadow 1024; impostor trees; no DoF. Target 30–60 FPS. |

Auto-pick from a 1-second benchmark on the loading screen, with a manual selector (brief 2 pillar 5). The existing adaptive-DPR loop stays.

### 6.5 Recommended order (each step committed and A/B-measured; backup tag `v5-live-94e0ddf` and folder stay untouched)

1. **M0 – backup:** tag `pre-webgpu-cebeb71`; work on a new branch `v6-webgpu`.
2. **M1 – look wins on the current renderer:** hero camera preset, anisotropy, sun per preset, environment level, metalness fixes, massing tone. These are the biggest visual gains, have no renderer risk, and can be published on their own if better.
3. **M2 – renderer port at parity:** `three/webgpu` import, `materialFactoryTSL.js` reproducing today's look, isolation as a node, sky, plan cuts. `?renderer=classic` remains the fallback until parity is verified.
4. **M3 – post chain:** GTAO, bloom, grade node, TRAA/SMAA, tiers.
5. **M4 – photoreal materials:** stucco, concrete, teak, glass, metal, paving, grout, gravel, lawn.
6. **M5 – landscape and atmosphere:** trees, terrain ring, skyline, aerial fog, aerial presets.
7. **Brief 2:** shadow PCSS/CSM, water `reflector()`, foliage SSS + wind, BRDF calibration table, DoF + tier UI.

### 6.6 Version and asset watch-outs (from the research agent's follow-up notes)

Details are in `research/tsl-patterns-assets.md` and `research/vegetation-haze-backdrop.md`. The aerial addendum rows A1–A9 are in `research/gap_matrix_webgpu.md`.

- **Pin one three.js release and test the WebGL 2 fallback with `forceWebGL`.** Several TSL APIs changed between r181 and r186:
  - `PostProcessing` was renamed to `RenderPipeline` (r183).
  - `PCFSoftShadowMap` was removed (r186).
  - `SkyMesh` lost `turbidity`/`up`.

  Code from older examples will not run unchanged.
- **InstancedMesh2 and octahedral-impostor libraries are not confirmed to work with WebGPU.** They also patch shaders in the `onBeforeCompile` style, which the brief forbids. Prototype with core `InstancedMesh` (one per LOD) first.
- **Shadows:**
  - Trees should not cast into the sun shadow map; use blob/AO decals under them.
  - The building keeps the real shadows (CSM, 2–3 cascades).
  - Brief 2's "dappled foliage shadow" is therefore limited to the Ultra tier and a few hero trees near the camera.
- **Haze:** a height + distance `fogNode` whose colour equals the sky at the horizon (≈ #C8D3DA).
- **Assets:**
  - Don't ship the three.js example water normals; they have no stated licence. Use ambientCG CC0 instead.
  - Poly Haven has CC0 trees, tropical plants and `palm_bark`, but no palm model.
  - Quaternius/Kenney packs need a per-pack licence check, because some are not CC0.
  - 8.webp carries a studio watermark: use it as a mood reference only.

---

## 7. Brief 2: five-pillar audit (short)

| Pillar | Current | Gap | Plan |
|---|---|---|---|
| 1. Soft shadow physics | PCFSoft 2048, radius 1, ±34 m frustum, no AO, shade tinted pink by the fill. | No contact hardening; blurry at the hero distance; no AO; no foliage shadows (there is no foliage). | Fitted frustum or 2-cascade CSM; 4096 on Ultra; PCSS-lite TSL filter (Ultra); GTAO; alpha-tested leaf shadows; a neutral sky-tinted fill. |
| 2. Photoreal water | One `Water` MeshPhysical (opacity 0.75); no reflection or ripples. | Everything. | `waterSystemTSL.js`: `reflector()` (half-res; Balanced: env-only), Fresnel ior 1.333, two scrolling normal maps by `time` offsetting the reflection UVs, depth-based colour attenuation, caustics on the pool floor masked by the shadow. |
| 3. Foliage | **None** live (`landscape.js` with generated trees is unloaded). | Everything. 8/9.webp need dense canopies. | `foliageSystemTSL.js`: instanced trees (CC0 GLB if downloads are approved, otherwise a procedural PBR tree generator: bark normal/AO, moss mask at the base, leaf cards with alpha-to-coverage), translucency `mix(back-light)`, height-masked wind `positionNode`, per-instance HSV tint, 3 LODs + impostors. |
| 4. Sun/BRDF calibration | Sun 7.8, environment 0.2, exposure 1.0; grade injected per material; brass non-metal, metals at 0.35. | Albedos not checked against 0.04–0.82; metalness wrong on several materials; no grazing Fresnel tuning. | A calibration table (albedo sRGB, roughness range, metalness, normal strength per material) plus a hero-camera p5/p50/p95 match to 3.jpg. |
| 5. DoF + tiers | None. Adaptive DPR only. | Everything. | TSL `dof()` node: focus = `controls.target` distance with damping; aperture per preset (wide f/8, close f/2.8); the tier selector from §6.4. |

**Open question from the brief 2 file:** the pasted text stops at "4.", so point 4 of the output list may have been cut off. This needs confirming with the user before brief 2 starts.

---

## 8. Phase 2: TSL material blueprint (summary)

**Rules:**
- Import only from `three/webgpu` and `three/tsl`.
- No `onBeforeCompile`, no `three/nodes`.
- `await renderer.init()` before the first frame.
- Matte surfaces use `MeshStandardNodeMaterial`; glass, water, clearcoat wood, fabrics with sheen and brushed metal use `MeshPhysicalNodeMaterial`.

**Shared node library (`materialFactoryTSL.js`):**
- `triplanar(tex, scale, sharpness)`: from `positionWorld` and `normalWorld`; used for plaster, concrete, roof, paving and gravel.
- `breakup(base, scale, amount)`: `mx_fractal_noise_float(positionWorld.mul(scale))`, used for macro value and roughness variation.
- `grime(heightAboveSlab)`: darkening and roughness gain at wall bases and under sills; drip streaks.
- `instanceJitter(amount)`: `hash(instanceIndex)` → hue/value and UV offset (battens, trees, furniture copies).
- `isoMask()`: the isolation/floor mask as an opacity/discard node, added to every material by the factory, which replaces `isolate.js`.
- `grout(uv, tile, width)`: a joint mask driving colour, roughness and normal.

**Per category (base values; final values go in the calibration table):**

| Category | Material | Colour (sRGB) | Roughness | Metal | Maps / nodes | Extra |
|---|---|---|---|---|---|---|
| Plaster/stucco | Standard | #E4DDD3 | 0.82–0.94 noise | 0 | Triplanar normal (trowel), breakup, grime | – |
| Concrete | Standard | #B9B4AC | 0.7–0.9 | 0 | Triplanar pores normal, streaks | – |
| Stone/tile/pavers | Standard | per material | stone 0.55–0.7 / grout 0.95 | 0 | Grout mask, sharp normal, tonal variation per tile (`hash(floor(uv*n))`) | – |
| Gravel | Standard | #9C9892 | 0.95 | 0 | Triplanar gravel normal + albedo | – |
| Wood/teak/deck | Physical | battens #9C7A5C / deck #8A6A52 | 0.45–0.65 along the grain | 0 | Grain map + per-board jitter | clearcoat 0.1–0.2, roughness 0.4 |
| Glass | Physical | tint #DDE7E4 attenuation | 0.02–0.05 | 0 | – | ior 1.52, thickness 0.006; transmission on Ultra hero panes, otherwise alpha + env; SSR (Ultra) |
| Metal: frames/rails | Standard | #2B2C2E | 0.35–0.45 | 0 (powder coat) | Micro-roughness noise | – |
| Metal: brushed/chrome/brass | Physical | per material | 0.08–0.35 | 1 | Roughness noise | anisotropy 0.6 (brushed) |
| Water | Physical | attenuation #2E6B73 | 0.02 | 0 | Two scrolling normals by `time` | `reflector()`, ior 1.333, Fresnel |
| Vegetation | Standard + translucency | per species, ±8% tint per instance | 0.6–0.8 | 0 | Leaf albedo/normal, alphaTest / alpha-to-coverage | Wind `positionNode`, back-light term |
| Grass | Standard | #6E7338 average | 0.9 | 0 | CC0 albedo/normal 2 m + macro hue noise | Grass cards near the camera (Ultra) |
| Fabric | Physical | room palette | 0.85–0.97 | 0 | CC0 linen/bouclé (round 28) | sheen 0.5, sheenRoughness 0.8 |
| Emissive | Basic/Standard emissive | 2700 K #FFB46B / 3000 K #FFC48A / 4000 K #FFE0BC | – | – | – | Intensity in HDR; selective bloom threshold > 1 |

**PBR asset manifest:**
- **Format:** KTX2.
  - Albedo ETC1S, sRGB.
  - Normal/ORM UASTC, linear.
- **Size:** 1k on desktop Ultra/High, 512 on phones.
- **Normal maps:** the OpenGL (+Y) convention, which is what Poly Haven `nor_gl` uses.
- **Folders:** `data/pbr/<material>/{albedo,normal,orm}.ktx2` and `data/pbr_m/` for phones.
- **Sources:** CC0 only (Poly Haven / ambientCG). Every file is recorded in `ASSETS_LICENSES.md`.
- **Fallback:** a procedural TSL node per category if a texture is missing.

---

## 9. Constraints carried into the rebuild

- Furniture geometry (dimensions, placement, shapes) stays unchanged; only materials, lighting and post change.
- The template rooms K.401/405/407/413/416 keep their layout.
- No Revit file is opened or touched. Exports are requested from the Revit agent only.
- Back up before every milestone (tag + branch). The live rollback tag `v5-live-94e0ddf` and the backup folder stay untouched.
- Publishing happens only at a milestone measured better than `cebeb71` in look and performance (desktop + throttled phone, no console errors), with a rollback tag pushed first.
- New downloads (CC0 textures, tree models, HDRIs) need explicit approval before fetching.
