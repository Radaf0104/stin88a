# Phase 1 — Revit export (you do this in Revit)

Model: **STIN KAVLING 88 SUPER IMPOSE**. Menu paths are for Revit 2025/2026.

## 0. Before you start
- Fix the two doorless units: **K.202** has no corridor door. **K.316** has no corridor door, and its bathroom has two
  identical doors on top of each other (IDs 3434175 and 3564407); delete one.
- Save the model.

## 1. Coordinates: use the Internal Origin
The current site geometry is in Revit's **internal coordinates** (the API exports them that way). Keep it like that:
- Don't move the Project Base Point or Survey Point for this export.
- IFC: set Coordinate Base = **Internal Coordinates** (step 5).
- FBX has no coordinate option. `01_import.py --inspect` measures the FBX against the numbers in `AUDIT.md` §5 and
  reports any shift or scale (feet vs metres), so nothing has to be guessed.

## 2. View `WEB_EXPORT` (the building shell)
1. Project Browser → Views → 3D Views → right-click **UE_DEMO** → *Duplicate View → Duplicate*. Rename it (F2)
   **WEB_EXPORT**.
2. With WEB_EXPORT open, in Properties:
   - Detail Level = **Medium**
   - Phase Filter = **Show Complete**
   - Section Box: leave it as in UE_DEMO
3. Type **VV** (Visibility/Graphics). On the **Model Categories** tab, untick:
   - Furniture, Furniture Systems, Casework
   - Plumbing Fixtures, Lighting Fixtures, Lighting Devices, Electrical Fixtures, Electrical Equipment
   - Specialty Equipment, Communication Devices
   - Mechanical Equipment, Ducts, Pipes, Cable Trays, Conduits (and any other MEP category)
   - Entourage, Planting
   - Topography / Toposolid
   - Rooms, Generic Models, Mass, Lines

   Keep: Walls, Floors, Ceilings, Roofs, Columns, Structural Columns, Structural Framing, Stairs (with Runs, Landings,
   Supports), Railings, Doors, Windows, Curtain Panels, Curtain Wall Mullions, Hardscape, Parking.
4. In the same VV dialog:
   - **Annotation Categories** tab: untick *Show annotation categories in this view*.
   - **Imported Categories** tab: untick *Show imported categories in this view*.
   - **Revit Links** tab: untick the villa link (the current site leaves links out too).
   - Click OK.

## 3. View `WEB_PLACEMENT` (furniture and fittings, for Phase 3)
1. Duplicate **UE_DEMO** again → rename **WEB_PLACEMENT**. Detail Level = **Medium**, Phase Filter = **Show Complete**.
2. VV → Model Categories: click **None**, then tick only:
   - Furniture, Furniture Systems, Casework
   - Plumbing Fixtures, Lighting Fixtures, Specialty Equipment, Communication Devices
3. Hide the office chair (≈355k triangles each, 45 of them):
   - View tab → **Filters** → New → name `NO PLOVER CHAIR` → Categories: Furniture.
   - Rule: *Family Name* · equals · `Plover Office Chair` → OK.
   - Back in **VV**, open the **Filters** tab → Add → `NO PLOVER CHAIR` → untick *Visible* → OK.
   - (Its 45 positions are already in `model.json`.)
4. Annotations, imported categories and links off, as in step 2.4.

## 4. FBX exports
1. Open **WEB_EXPORT** (it must be the active view).
2. File (R menu) → **Export → FBX**:
   - File name: `2026-MM-DD_WEB_EXPORT.fbx` (today's date).
   - Options: **untick** *Use Levels of Detail*, **untick** *Export room, area and space boundaries as 3D volumes* (if
     shown).
   - Save.
3. Open **WEB_PLACEMENT**, then repeat as `2026-MM-DD_WEB_PLACEMENT.fbx`.

## 5. IFC 4 fallback (only used if the FBX loses names)
1. With **WEB_EXPORT** active: File → **Export → IFC** → *Modify Setup…*:
   - Click the duplicate icon on the setup list to make a new setup → name it `WEB IFC4`.
   - General tab: IFC Version = **IFC4 Reference View**, File Type = **IFC**, Phase = the model's last phase.
   - Coordinate Base = **Internal Coordinates** (General tab; the *Advanced* tab in older exporters).
   - Additional Content tab: tick *Export only elements visible in view*.
   - OK.
2. Export as `2026-MM-DD_WEB_EXPORT.ifc`.

## 6. Send me the files
Save the three files in a folder you choose (e.g. `Documents\STIN export\`) and tell me where.
- I'll copy them into `source/revit/` (kept out of the website and of Git) and run `01_import.py --inspect`.
- I'll report scale (a 3 m room must measure 3 m), object count, material names, triangle count (target < 1.5 M without
  furniture), and the coordinate check against `AUDIT.md` §5.
- I won't change the model or the files you send.

---

## Material names: recommended mapping (25 clean names)

**Recommendation: don't rename or merge materials in Revit.** Revit can't merge two materials. You would have to
re-assign them in every family and wall type, which takes hours and changes your design model. Instead I put this
table in `tools/blender/material_map.json`, and `08_materials.py` applies it on every re-export, automatically.
If you prefer clean names in Revit anyway, rename them in Manage → Materials (right-click → Rename) to the left column.

| Clean material | Revit materials (triangles today) |
|---|---|
| `M_plaster_cream` | CEMENT 12,331 · Default Wall 3,219 · GYPSUM 1,528 · Finishes - Interior - FC - Ceiling 1,016 · Gypsum Wall Board 212 · Polyvinyl Chloride - Rigid 12 |
| `M_plaster_grey` | GREY 6,370 · CEMENT gray 475 |
| `M_concrete` | Concrete, Cast-in-Place gray 6,372 · CONCRETE 4,763 · CONCRETE 1 1,192 · Concrete, Precast 166 |
| `M_tile_floor` | CEMENT SPESI 2,859 · TILE - Ceramic 60x60 324 · TILE - Ceramic 100X100 236 · Default Floor 76 |
| `M_teak_batten` | Default New Material 68,904 (facade slat panels) |
| `M_teak_timber` | WOOD 1 a 25,502 · Timber HWD 2,824 · MADEIRA ESPREGUI_ADEIRA 1,360 |
| `M_teak_deck` | DECK 5 184 |
| `M_wood_light` | Pine 13,068 · Timber - Ash 3,672 · Wood - Birch 1,168 · Softwood, Lumber 1,016 · Birch 512 · Back Board 408 · Wood Laminate 48 · Bois de pin - FAKRO 44 |
| `M_fabric_bedding` | FABRIC 7,912 · fabric - cream 1,120 · Linen, White 288 · Tecido Toalha 302 |
| `M_fabric_sofa` | Available in all fabrics/leathers/colors… (COR) 1,514 · ESTOFADO ESPREGUI_ADEIRA 80 |
| `M_lacquer_cream` | Lacquerable in all colours… (COR) 1,424 |
| `M_metal_dark` | Metal - Paint Finish - Dark Gray,Matte 11,170 · VL_GATE_STEEL 1,524 · Black Paint 384 · STEEL BLACK 188 |
| `M_metal_grey` | Metal - Paint Finish - Grey 5,640 · Metal - Painted - Grey 48 · ALUMUNIUM GREY 48 · Metal Deck 42 |
| `M_metal_brushed` | Stainless Steel, Brushed 6,224 · Stainless Steel 3,320 · Metal - Aluminium Brushed 2,368 · Metal - Brushed Aluminium 736 · Metal - LG - Steel 332 · Aluminium - FAKRO (3 names) 464 · Metal - Aluminium 60 · …berongga2 36 |
| `M_chrome` | CHROME 5,821 · Metal - Chrome 64 · Steel, Chrome Plated 48 · Steel, Polished 24 |
| `M_porcelain` | PORCELAIN WHITE 1,060 · WHITE 48 |
| `M_stone_marble` | MARBLE GREY 24 |
| `M_plastic_white` | QARC White 760 · Plastique - FAKRO - RAL9003 512 · TC-LIGHT GREY 496 · BMCD2AR3 …White 16 |
| `M_plastic_black` | Plastic - Sony - Black_Matt 7,296 · BLACK 864 · M1_B00 - Black 192 · Rubber, Black 48 · Appliance - Gasket 76 · BMCD2AR3 …Black 24 |
| `M_screen` | Screen - Sony - Black_Matt 576 |
| `M_glass_clear` | Glass 3,656 · Glazing-Clear 720 · GLAZING 24 · Glass - Clear, Grey 4 |
| `M_glass_frosted` | GLAZINGfrosty 103 |
| `M_water` | Water 12 |
| `M_light_emitter` | LIGHT SOURCE 192 |
| `M_roof_shingle` | Roofing, grey shingles 126 |
| `M_site_paving` | SOIL 205 · Sand 62 · GRAVEL 1 32 · Earth 26 · PAVING 2 4 · PAVING 6 2 · Grass 16 (site lawn comes from the website) |
| *per family* | **Default 11,426**: "no material set". Decided per family in Phase 3 |
| *dropped* | Analytical Panels 32 (analytical model, not real geometry) |
