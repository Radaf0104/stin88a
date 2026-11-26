# Blender pipeline (Revit → Blender → web)

Run every script headless with Blender 5.3 (not on PATH on this computer):

```
"C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" -b <file.blend> -P tools/blender/<script>.py -- <args>
```

**Never add `--factory-startup`** (and scripts never call `read_factory_settings`): with factory settings Blender's
extension manager removes the Python packages installed for your extensions (Bonsai's ifcopenshell etc.).
ifcopenshell for the scripts is installed separately from Bonsai's bundled wheel (no download) into a short path
(the project path is too long for its files): `pip install --no-index --no-deps --target <short dir> <bonsai wheels>`.

Revit exports (Phase 1) are made through the Revit connector from the views `WEB_EXPORT` / `WEB_PLACEMENT`
(Medium detail, Show Complete, filter `NO PLOVER CHAIR`) into `source/revit/`. **Revit's FBX carries no materials**
(material indices only), so the IFC 4 export is the geometry source (materials, IFC class, Revit element id in `Tag`).

Scripts are numbered and run in order. Each one takes input/output paths as arguments, can be run twice with the same
result, and logs what it changed.

| # | Script | Status | What it does |
|---|---|---|---|
| — | `tools/audit-geometry.mjs` (Node) | done | numbers for `source/AUDIT.md` from the current `geometry.bin` / `model.json` |
| 01 | `01_import.py` | done | IFC → one object per element (category, Revit id, storey, Revit materials), coordinate + room check → `stin88a_master.blend` |
| 02 | `02_levels.py` | done | collections L0–L4 / ROOF / SITE; tall elements cut 0.16 m under each floor level → `stin88a_02_levels.blend` |
| 03 | `03_cleanup.py` | done | merge, coplanar faces merged back (1°, `--dissolve-deg`), hidden contact faces, decimate elements > 5,000 tris, 8 mm bevel per element (`--bevel-segments 1`) → `stin88a_03_cleanup.blend` |
| 04 | `04_join.py` | done | clean materials, door leaves split (hinge origin; balcony sliding doors of the rental rooms → outward French doors: two 0.8 m leaves + fixed side lights, or one leaf when ~1 m wide), join per level / kind / material, weighted normals → `stin88a_04_join.blend` |
| 05 | `05_placement_audit.py` | done | furniture families: count, triangles, size, rooms → `source/compare/phase3/placement_audit.md` |
| 06 | `06_place_assets.py` | done | placement IFC → per-family keep / decimate / script-built (beds facing the TV; 3.5 m rooms / suites: 1.6 m bed + backdrop + two end tables, old Revit bed joinery removed; shower columns, fridge) / Poly Haven chair facing its desk (tucked under it in the 3.5 m rooms); copies placed as instances → `stin88a_06_furnished.blend` |
| 06b | `06b_dress_room.py` | done (K.305) | room dressing: LED strips, lamps, cushion, rug, curtain, plant, books → `stin88a_06b_dressed.blend` |
| 06c | `06c_coplanar.py` | done | same-plane, same-facing surfaces of two objects (flicker): the one behind moves back 3 mm (structure behind fittings; trim > metal > timber > plaster > concrete), exact duplicates removed, up to 7 passes → `stin88a_06c_coplanar.blend` (input of 07) |
| 07 | `07_uv.py` | UVMap done; UVMap_LM waiting on the lightmap-budget decision | UVMap = box projection in metres; UVMap_LM = smart project + pack per mesh, shelf-packed per level (`--skip-lm` = texture UVs only) → `stin88a_07_uv.blend` |
| 08 | `08_materials.py` | done (Gate 4) | Principled BSDF + tinted CC0 textures (in `source/textures/`), generated brushed metal, bathroom wall tiles, glass / water placeholders → `stin88a_08_materials.blend` |
| 09 | `09_light_setup.py` | pilot done | day sky turned to the site's sunAz, sun lamp, room lamps at the mood anchors, window portals → `stin88a_09_lights.blend` |
| 10 | `10_bake.py` | pilot done | Cycles (OptiX) bake of one lightmap set: indirect (`--sun on/off`) + AO, OpenImageDenoise → `source/bakes/*.exr` |
| 11 | `11_lightmap_preview.py` | pilot done | Eevee preview: live sun + lamps + baked bounce light x base colour, at the site's exposure (`--emission-only` = lightmap alone) |
| — | `lm_layout.py` | done | draws a lightmap set's UV layout (one colour per mesh, overlaps red) |
| — | `room_render.py` | done | Eevee check inside a room (camera behind the end wall, like the interior renders) → `source/compare/phase3/` |
| — | `check_render.py` + `tools/side-by-side.mjs` | done | Eevee renders from the site's render pins next to the Unreal renders → `source/compare/<tag>/` |

Full run (≈ 2.5 min):
```
B="C:\Program Files\Blender Foundation\Blender 5.3\blender.exe"
$B -b -P tools/blender/01_import.py -- --ifc source/revit/<date>_WEB_EXPORT.ifc --out source/blender/stin88a_master.blend
$B -b source/blender/stin88a_master.blend   -P tools/blender/02_levels.py  -- --out source/blender/stin88a_02_levels.blend
$B -b source/blender/stin88a_02_levels.blend -P tools/blender/03_cleanup.py -- --out source/blender/stin88a_03_cleanup.blend
$B -b source/blender/stin88a_03_cleanup.blend -P tools/blender/04_join.py   -- --out source/blender/stin88a_04_join.blend
$B -b source/blender/stin88a_04_join.blend   -P tools/blender/check_render.py -- --pins r01,r02,r09 --tag phase2
node tools/side-by-side.mjs source/compare/phase2
```

Inputs: `source/revit/` (Revit exports). Outputs: `source/blender/` (blend files), `source/compare/` (check images),
`data/levels/` (published GLBs, Phase 6). Heavy files under `source/` are kept out of Git (see `.gitignore`).
