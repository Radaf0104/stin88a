# STIN 88A — Phase 0 audit (Revit → Blender → Web pipeline)

Branch `blender-pipeline`, folder **V4** = the V3 site (the local optimised version, not yet live) on top of `main`.
Numbers come from `node tools/audit-geometry.mjs` (full output: `source/audit-geometry.json`) and from the running
site. Model export of 2026-11-25 (after your interior update).

> The brief describes the site as it was a few weeks ago. The current V4 differs in these points, and the GLB work
> plugs into the current code:
> - **No post-processing.** The colour grade (`js/grade.js`) is now added to every material's shader, together with a
>   built-in bloom imitation and fog moved before the tone curve. The composer, GTAO and bloom passes are no longer built.
> - **"Step inside" was replaced** by the **room view** (the room alone on white, walls facing the camera cut away, no ceiling,
>   clickable TV and doors, 3.2 m section) and **walk mode** starts at the stairs or a room entrance.
> - **Floor / room / walk views fade everything else to white** (`js/isolate.js`) with plain even light (no sun or shadows).
> - Doors are detected from the geometry and swing (`js/spaces.js`); walking is limited to the room / corridor you are in.
> - `model.json` has 266 groups (not 258), 89 materials, 100 rooms.

---

## 1. How the geometry is loaded (`js/main.js`, "load" and "Building geometry")

| Step | What happens |
|---|---|
| Files | `data/model.json` + `data/units.json` fetched together, then `data/geometry.q.bin.gz` (falls back to `data/geometry.bin`) and `data/cap.q.bin.gz` |
| Decoding | gzip → `Uint16Array` → `min + q × scale` per axis (`model.quant`): float32 xyz triplets, **3 per triangle, non-indexed** |
| Units | metres (the Revit export multiplied feet by 0.3048) |
| Revit coordinates | **internal origin**, z up (Revit API `Triangulate()` output, no project base point / survey point applied) |
| Axis change | three.js `(x, y, z) = (Revit x, Revit z, −Revit y)`, applied per vertex at load (fixtures: matrix `REVIT_TO_THREE`) |
| Centring | everything sits under one `root` group; after building it, `root.position = −(centre of its bounding box)` in x and z only: **`root.position = (1.2961, 0, −1.8122)`**, no rotation, no scale |
| Groups → meshes | `model.groups[]` = one run of triangles per (Revit material, level, category), `offset`/`count` in floats. Groups are merged into **one mesh per look per level**: Revit materials that map to the same preset share one three.js material (`lookKey`), key = `material.uuid + level` |
| Order inside a mesh | "Plumbing Fixtures" triangles last, so the building overview draws `drawRange(0, overviewVerts)` and skips bathrooms |
| Remembered positions | `doorChunks`, `ceilingChunks`, `tvChunks` = `{mesh, start, count, level}` of the Doors, Ceilings and Communication Devices triangles inside the merged meshes |
| Normals / UVs | `computeVertexNormals()` (flat, non-indexed) and `addBoxUVs()` (box projection in metres, V = world up on walls) |
| Level of a group | Revit's level of the **element's lowest point** (`lvl_index(bbox.Min.Z)`), *not* a slice: columns, curtain walls and stair cores that start on Level 1 run up to the roof (see bbox table, §6) |

### Fixtures and proxies
- `model.fixtures`: 3 families stored once and instanced (toilet ×54, basin ×52, shower ×50). Each part is simplified on
  load (vertex clustering, 2.2 cm), then drawn as one `InstancedMesh` per level, double-sided (mirrored copies),
  `userData.bathroom = true`. Matrices come from Revit (`it.m`, column-major, metres) × `REVIT_TO_THREE`.
- `model.proxies`: "Plover Office Chair" ×45 (≈355k triangles each in Revit) is replaced by a 5-box stand-in chair.

### Floor cut and section caps
- One global clipping plane (`renderer.clippingPlanes`, normal pointing down) is always active. "No cut" parks it at y = 1e6.
  `setCut(y)`: floor view y = level + 1.35 m, room view y = level + 3.2 m, walk y = level + 3.7 m (walk has no caps).
- Caps (stencil): `capMesh` holds **every triangle of Walls, Floors, Structural Columns, Columns, Structural Framing,
  Roofs** from the *untouched* export (`cap.q.bin.gz`, made by `tools/pack-geometry.mjs` from `geometry.orig.bin`), drawn
  first with colour off and "invert stencil" on both sides. Where the count is odd the pixel is inside a cut solid, and
  a big grey plane at the cut height (`cap`, stencil ≠ 0) paints it. **This needs watertight solids**; the visible
  geometry was nudged apart by `tools/fix-geometry.mjs` against z-fighting, so it no longer is.
- `showBand(lo, hi)`: every drawable object has `userData.y = [minY, maxY]` (`levelObjects`); objects entirely above the
  cut (or, in the white views, below the isolated floor) are not drawn.

## 2. Everything that depends on the geometry's structure

| Feature | Depends on | GLB path must provide |
|---|---|---|
| Floor cut / levels above not drawn | `userData.y` per object, any mesh split | per-level objects (or per-level bounding boxes) |
| Stencil caps | closed solids of the 6 structural categories (`cap.q.bin.gz`) | **keep `cap.q.bin.gz`** from the Revit export (recommended) or export closed, un-bevelled solids per level |
| Building overview hides bathrooms | Plumbing Fixtures triangles last + `drawRange`; fixtures `userData.bathroom` | bathroom parts as separate objects, flagged (e.g. glTF extras `bathroom: true`) |
| Overview hides interior doors | `spaces.doors[].interior` | door leaves as separate objects |
| Walk collision (`js/walk.js`, three-mesh-bvh) | all groups **except** Doors, Communication Devices, Specialty Equipment, Plumbing Fixtures, Lighting Fixtures, Furniture, Casework (`NO_COLLIDE`), plus an 800 m site plane at y −0.25 | Revit category per object (glTF extras), or a separate low-poly collider GLB |
| Floor under you, stairs, lawn grass probe | `walker.floorBelow()` / `raycastAll()` on the collider | same collider |
| Doors swing / slide (walk + room view) | **Doors** triangles clustered per door (`spaces.js`): 1.7–3.2 m tall, 0.5–3.2 m wide, ≤ 0.5 m thick; leaf = triangles inside the frame; > 40 % glass = sliding; roles from the rooms 0.6 m either side | each **door leaf as its own object with its hinge as origin** (and frame separate), named per door |
| Balcony depth | rays at 24 heights to the railing + floor probe on the collider | collider includes railings and balcony slabs |
| Rooms, units, corridor, communal, villa | `model.rooms[].outline` (Revit plan, metres) + names: `K.xxx`, `KM K.xxx`, `CORRIDOR` (L3), `AREA KOMUNAL` / `LIVING`, villa = L2 rooms west of the units; stair & lift rectangles **hard-coded** in `spaces.js` (`STAIR`, `LIFT`, Revit coords) | `model.json` rooms unchanged (keep exporting them from Revit) |
| Room view: ceiling hidden | **Ceilings** triangles collapsed in place (`setCeilings`) | ceilings as separate objects (per level), flagged |
| Room view: TV | Communication Devices triangles inside the room outline, 0.3–2.3 m above the floor → a screen plane is added | TVs as objects with category, or keep the same triangles |
| Room view: walls in front cut away | shader test on world position (no structure needed) | — |
| Window light (old "inside" mode) | unit bounding box + which side faces the facade (no geometry) | — |
| Warm lit ceilings seen from outside (`roomGlow`) | room outlines | — |
| Mood lights (`js/lighting.js`) | anchors from units / spaces (centre, bathroom centre, corridor bays, communal & villa grid) | — |
| Trees step aside | `buildingBox` | same world placement |
| AO exclusions | `userData.noAO` (left over; GTAO is no longer built) | — |

## 3. Everything that touches materials

- `presetFor(name, info)` (`js/materials.js`): Revit material name/class → preset kind (water, glass, frosted glass,
  emissive, metal, paint, porcelain, wood, deck, battens, fabric, tile, roof, grass, asphalt/paving, concrete, plaster, plain).
- `materialFor()`: one three.js material per *look* (shared by all Revit names with the same preset). Photo textures from
  `assets/tex/` (plaster, oak, concrete, marble, asphalt, grass), tinted to the preset colour; procedural canvas textures
  otherwise; textures load after the first picture (average-colour placeholders).
- `addBattens(m)`: shader that draws 6 cm battens / 4 cm dark gaps on "Default New Material" and "Wood 1" panels.
- Glass: `MeshPhysicalMaterial`, transparent, depthWrite off, Fresnel opacity in the shader, `userData.glass` (glows warm
  at dusk in `setTime`), `renderOrder 3`, casts no shadow. Frosted: no Fresnel. Water: physical, transparent.
- `userData.lamp` (LIGHT SOURCE material: emissive, strength per time of day), `userData.preset`.
- Opaque materials are single-sided (Revit solids are closed); fixtures get double-sided copies.
- **Every material is patched twice by shader additions**: `isolate.js` (white-view mask, cut-away walls) and `grade.js`
  (pre-tone-curve fog + bloom imitation, colour grade). Works for MeshStandard / Physical / Basic / Lambert / Phong,
  which is what `GLTFLoader` creates, so GLB materials will take both patches.

## 4. Revit materials, triangles (after `fix-geometry`, without the 1.42 M instanced fixture triangles)

239,676 triangles in 266 groups. Top materials (full list: `source/audit-geometry.json`):

| Revit material | Triangles | Categories |
|---|---:|---|
| Default New Material | 68,904 | Curtain Panels (facade slat panels, family "Brick Gap") |
| WOOD 1 a | 25,502 | Curtain Wall Mullions, Doors |
| Pine | 13,068 | Casework, Furniture, Walls |
| CEMENT | 12,331 | Walls, Ceilings, Columns |
| Default | 11,426 | Furniture, Hardscape, Plumbing, Specialty Equipment, Doors, Windows |
| Metal - Paint Finish - Dark Gray,Matte | 11,170 | Railings |
| FABRIC | 7,912 | Furniture |
| Plastic - Sony - Black_Matt | 7,296 | Communication Devices (TVs) |
| Concrete, Cast-in-Place gray | 6,372 | Floors, Framing, Walls, Columns, Stairs |
| GREY | 6,370 | Mullions, Floors, Walls |
| Stainless Steel, Brushed | 6,224 | Plumbing |
| CHROME | 5,821 | Plumbing |
| Metal - Paint Finish - Grey | 5,640 | Doors |
| CONCRETE | 4,763 | Columns, Framing, Floors, Stairs |
| Timber - Ash | 3,672 | Furniture |
| Glass | 3,656 | Curtain Panels, Doors |
| … 73 more | 34,445 | |

By category: Curtain Panels 72,496 · Mullions 32,794 · Furniture 30,934 · Walls 15,996 · Plumbing 14,341 · Doors 13,600 ·
Casework 13,484 · Railings 11,358 · Communication Devices 7,872 · Framing 5,181 · Floors 5,084 · Ceilings 4,040 ·
Windows 3,964 · Structural Columns 2,991 · Hardscape 1,600 · Specialty Equipment 1,364 · Runs 756 · Stairs 672 ·
Columns 643 · Roofs 271 · Toposolid 191 · Landings 44.

Performance today (1280×720, building overview, everything incl. trees and grass): ~3 ms per frame, 338 draw calls,
~704k triangles.

## 5. Proposed coordinate transform Blender → site

1. **Keep Revit's internal coordinates in Blender**, in metres, Z up (scale 0.3048 if the FBX comes in feet; no offset,
   no rotation). Blender then matches `geometry.bin` exactly.
2. The glTF exporter's "+Y up" writes `(x, y, z)` → `(x, z, −y)`, which is **exactly the site's Revit → three.js
   conversion**. So the GLB's coordinates equal the site's root-local coordinates.
3. On the site, add each loaded GLB scene **under `root`** (which applies the `(1.2961, 0, −1.8122)` centring offset).
   No other transform.

Check (numbers from `geometry.bin`; `01_import.py --inspect` will compare the FBX against these per level, tolerance
1 cm, and report any shift or scale):

| Level (element base) | Triangles | Revit min (x, y, z) | Revit max (x, y, z) | Site root-local min (x, y, z) | max |
|---|---:|---|---|---|---|
| 0 Ground | 3,285 | −25.629, −12.637, −3.800 | 23.037, 9.013, 16.500 | −25.629, −3.800, −9.013 | 23.037, 16.500, 12.637 |
| 1 Level 1 | 119,958 | −19.516, −11.547, −0.150 | 16.364, 8.573, 16.000 | −19.516, −0.150, −8.573 | 16.364, 16.000, 11.547 |
| 2 Level 2 | 42,350 | −17.672, −11.752, 3.845 | 15.659, 8.388, 15.905 | −17.672, 3.845, −8.388 | 15.659, 15.905, 11.752 |
| 3 Level 3 | 37,975 | −16.922, −11.453, 7.845 | 15.659, 8.163, 15.950 | −16.922, 7.845, −8.163 | 15.659, 15.950, 11.453 |
| 4 Level 4 | 35,904 | −16.922, −5.017, 11.845 | 15.659, 8.163, 16.500 | −16.922, 11.845, −8.163 | 15.659, 16.500, 5.017 |
| 5 Roof | 204 | −16.818, −4.916, 15.895 | 15.594, 8.071, 16.492 | −16.818, 15.895, −8.071 | 15.594, 16.492, 4.916 |
| all | 239,676 | −25.629, −12.637, −3.800 | 23.037, 9.013, 16.500 | | |

Verified on the running site: the bounding box centre of all geometry is (−1.2961, 1.8122) in Revit x/y, and
`root.position` is (1.2961, 0, −1.8122): world = (x + 1.2961, z, −y − 1.8122). (Level 1's bbox reaching 16 m shows the
"level = element base" rule: tall elements starting on Level 1.) `02_levels.py` will instead cut by height (§2 brief),
so the new per-level boxes will be tighter; the per-level check uses total extents and a few reference points (e.g.
room K.305's corner, a column), not these mixed boxes.

## 6. Findings that affect the plan (need your decision)

1. **Room view shows every unit furnished.** Since this week, all 42 rooms open in the room view with furniture, TV and
   clickable doors. The brief's "other units: shell only + curtains" would make most room views empty. Recommended:
   keep full (low-res lightmap) furniture in every unit, share furniture meshes as instances (one bed model, 42 copies),
   high-res lightmaps only for the pilot / furnished room types.
2. **Section caps need closed solids.** Bevelled, cleaned, joined Blender meshes won't count stencil correctly.
   Recommended: keep `cap.q.bin.gz` from the Revit export for the caps (geometry-only, never drawn in colour).
3. **Doors and ceilings are found by category today.** The Blender scripts must keep the Revit category of every object
   (custom property → glTF extras → `userData.category`), keep door leaves separate with the hinge as origin, and keep
   ceilings, TVs and bathroom parts as separate (flagged) objects.
4. **Facade battens as real geometry** (6 cm / 4 cm): the panels are already 68,904 triangles as flat panels. Real
   battens with bevels could add a few hundred thousand triangles; I'll measure the facade area in Phase 2 and propose
   LOD (geometry near, shader far) if it goes over budget.
5. **"Default" material** (11,426 triangles in furniture, doors, windows, plumbing) means "no material set in the family".
   It needs a per-family decision in Phase 3.
6. **Doorless rooms**: K.202 and K.316 have no entrance door in the current Revit model (K.316 also has two identical
   bathroom doors on top of each other). Fix in Revit before the Phase 1 export.
7. **Plover Office Chair** (~355k triangles each × 45) must stay out of every FBX (Phase 1 hides it); we already have its
   45 placements in `model.json` (`proxies`).
