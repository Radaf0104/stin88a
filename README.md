# STIN 88A – interactive website (hybrid)

The building, floors and rooms come straight from the Revit model. The look (360° interiors, hero images) comes from Unreal renders.

## Run it on your computer
```
node serve.mjs
```
Then open http://localhost:5176 (V5 port; set `PORT` to change it)

## What the viewer does
- Full-screen landing render (`images/landing/hero-1200|2000.webp|jpg`, made with sharp), no buttons. Click, tap or Enter fades it into the 3D view over 1.8 s (`#hero` in `index.html` / `style.css` / `main.js`). Each exterior render in the gallery can fly the 3D view to its angle ("See this angle in 3D")
- Floors 1–4: plan cut at 1.35 m with solid (stencil-capped) wall sections, a room list, colour-coded availability
- Level 1 shared spaces (`spaces` in config, matched to Revit room names): communal living & dining, private villa
- Room / space card → **Step inside**: eye-level fly-in with a warm room light, look-around only (can't leave the room), then the real interior renders open
- Gallery tabs: Exterior (landscape renders only: r02, r03, r07, r08, r09 in `renders` in `js/config.js`) · 3 m Room · 3.5 m Room · Facilities · Private Villa; EN/ID
- **Realistic materials** (`js/materials.js`): every Revit material is mapped to a preset (plaster, teak, stone tile, deck,
  fabric, brushed steel, chrome, porcelain, glass, water) with procedural textures in metres. Change a look by editing `presetFor()`.
- **Sky & time of day** (`js/environment.js`): physical sky for Day / Golden hour, starry sky for Night; the sky is also the
  environment light, so glass and metal reflect it.
- **Walk mode** (`js/walk.js`): first-person with collision (walls, furniture, railings; doors are open), stairs, floor jumps.
  Desktop: click + WASD/arrows, Shift = run. Phone: left thumb moves, right thumb looks. Shows which room you're standing in.
- **Mood lighting** (`js/lighting.js`): warm bedroom lamps, bathroom lights, corridor bays, communal and villa lighting;
  stronger at golden hour / night.
- **Bathrooms**: each unit includes its Revit room "KM K.xxx" (area shown on the card, part of the 3D volume);
  toilets, showers and basins are instanced; the heavy office chair is replaced by a simple stand-in.
- **Quality** button: HQ (ambient occlusion + bloom + colour grade + 4K shadows) or Lite (default on phones).
- **Render on demand** (`main.js`, "render on demand"): nothing is redrawn while the view is still. Frames are drawn
  when the camera moves, during fly-throughs, walking, the Google map, and briefly after any input or texture load.
- **Ambient occlusion only when still**: while moving, frames are drawn without AO; ~0.25 s after the view stops, one
  extra frame adds it (outside: building-scale settings, inside rooms: room-scale). The AO pass skips the sky photo
  (it used to fill AO's buffer with invalid numbers and darken everything), see-through objects, leaf cards and grass.
- **Adaptive resolution**: if moving frames stay slower than ~30 fps the resolution steps down (to 60 % at most), and
  steps back up when frames are fast again.

## V5 additions (2026-11-26)
- **Site plan from the masterplan:** `tools/build-siteplan.mjs` → `data/levels/SITEPLAN.gltf` (terrain, roads, pads, retaining walls
  from Revit "STIN MASTERPLAN FINAL", exported by `tools/revit/export_siteplan.py`). Colours match the client render
  (olive lawn, dark asphalt, pale concrete) in `LOOK`. In the white floor views, Level 1 keeps the site, blended to a light
  plan palette (`SITE_PLAN_LIGHT` in `main.js`); other floors hide it.
- **Massing of planned buildings:** `tools/build-massing.mjs` → `data/massing.json` → `js/massing.js`. Plain white extruded boxes:
  boarding house on pads 1 and 2 (pad 2 = the client-marked L-shape over the lower terrace, explicit `footprint`), parking
  building on pads 3 and 4. No labels, no toggle. The pad-1 box beside the main building hides when it blocks the view to
  the building (`updateOcclusion`: 6 rays per drawn frame).
- **Template rooms:** every guest room is furnished from one dressed template of its width: 3 m → K.405, 3.5 m → K.407,
  4 m → K.413. K.301 and K.401 (3.67 m) are in the 3.5 m class.
  - `tools/room-templates.mjs` → `data/room_templates.json` (width class, rotation, mirror and a 4×4 matrix per room,
    anchored on the facade wall, mirrored by bathroom side).
  - Blender: `06b_dress_room.py --rooms K.405,K.407,K.413` dresses them (LED strips, lamps, cushion, rug, curtains,
    decimated plant, books). `06t_template_rooms.py` removes the other rooms' furniture and adds linked copies.
  - Pipeline order: 06 → 06b → 06t → 06c → 07 `--skip-lm` → 08 → 12 → `node tools/pack-levels.mjs` (run in the `stin88a-v4`
    pipeline workspace, then copy `data/levels/*` except `SITEPLAN.*` into V5).
- **Doors:** hinged leaves load as pivot > leaf node > meshes. The loader walks up to the node with `kind` (`main.js`) and
  `doorMeshes` traverses (`spaces.js`). 138 doors, 42 entrance.
- **Look:** day light, sky and haze retuned to the client render. UI palette: timber #A07A52, charcoal #24262A (`style.css`).

## Real-world map (Google Photorealistic 3D Tiles)
- **Not in use in V5:** the Map button was removed. The code in `js/map.js` stays, unused.
- It swaps the lawn for Google's 3D surroundings at the plot (`site` in `js/config.js`: −6.614033, 106.887443).
- Needs `googleMapsKey` in `js/config.js`: a Google Maps Platform key with **Map Tiles API** enabled, billing linked,
  restricted to your site addresses (e.g. `http://localhost:5176/*` and your domain) and to the Map Tiles API only.
- `site.northRotation` turns the surroundings to match true north (front faces ~164°); `site.groundLevel` sets where the
  terrain meets the model. The map pauses while a floor is cut (the plan cut would slice the hills).
- Google's logo/credits are shown bottom-left while the map is on.

## Exterior look (route 2)
- **Sky photos (HDRI)**: `assets/sky/` (day: Autumn Field, golden hour: Kloppenheim 06). The sun light is placed where the
  sun is in the photo, then the sky is turned so the sun comes from the front-left (`sunAz` in `js/environment.js`).
- **Photo textures**: `assets/tex/` (white plaster, oak veneer, concrete, marble, asphalt, leafy grass) with bump + roughness.
- **Landscape** (`js/landscape.js`): ~360 trees generated in the browser, distant hills, Poly Haven fern along the base.
  Poly Haven's own tree models were 44–200 MB each, too heavy for a website.
  - 4 tree types (`KINDS`): broad "rain tree", round, tall columnar, young. Crowns are several leaf clumps with a branch
    into each; leaves are darker inside / underneath and lighter on the sunlit outside; each tree gets a slightly
    different green; crowns sway gently in the wind.
  - 3 rings (`tryPlace` calls): 60 trees within 45 m (full detail), 130 at 45–110 m and 170 forming the tree line at
    110–175 m (lighter versions). The lawn in front of the terrace facade stays open.
  - Trees between the camera and the building, or that the camera is inside, are hidden automatically.
- Tone curve: AgX for golden hour / night; Day uses "PBR Neutral" (keeps white plaster white and the sky blue).
  Exposure / sun / sky brightness per time of day: `TIMES` in `js/environment.js`.
- **Day = "sunny morning" look** (matched to the terrace-facade render): sun aimed at the facade from the front-left
  (`sunAz`, `sunElev`), sky light kept lower so shade reads clearly (`env`), blue-from-above / green-from-lawn fill (`fill`),
  the visible sky shown with a pale hazy horizon (`skyHaze`, `skyDesat`) and matching distance haze (`fogDensity`).
- **Glass** is dark-tinted and turns mirror-like at grazing angles; bedrooms show **warm lit ceilings** through the
  windows from outside (`roomGlow` per time of day; hidden when you walk or step inside).
- **Day colours are matched to the elevation render** (measured on screen): sunlit plaster ≈ #F2E6D7, plaster in the
  recesses ≈ #E0D4C4, timber ≈ #9A7A60 average, lawn ≈ #727333 (warm olive). Change them via the plaster colour /
  batten colour in `presetFor()`, the sky (≈ #D6DEE5 pale grey-blue, whiter at the horizon) via `bg` / `skyDesat` /
  `skyHaze`, the grass blade colours in `clumpGeometry()`, and `ground` / `grade` in `TIMES.day`.
- **Colour grade** (`js/grade.js`, HQ only): white point (`gain`), contrast, saturation, warm highlights / cool shadows and vignette on the final
  image; values per time of day in `grade` inside `TIMES`.
- **Timber battens**: the facade slat panels (Revit "Default New Material" / "Wood 1") are drawn as 6 cm battens with
  4 cm dark gaps (`addBattens` in `js/materials.js`). The panels stay flat in Revit; only the shading changes.
- **3D grass**: ~9,600 instanced clumps (~420k blades) in a 20 m band around the building, kept off paving/slabs
  (`addGrass` in `js/landscape.js`; Lite uses about a third). Trees also hide when the camera is inside their crown.
- All assets: CC0 from polyhaven.com (no attribution required; credit appreciated).

## Files you'll edit
| File | What it's for |
|---|---|
| `js/config.js` | Project name, tagline, **WhatsApp number**, **prices per room type**, 360° image per type |
| `data/units.json` | One entry per room: `label`, `type` (standard / deluxe / suite), `status` (available / occupied), optional `price` override |
| `images/renders/` + `renders` list in `js/config.js` | Exterior renders for the gallery (landscape images only; the landing page uses `images/landing/`). Each has `az`/`el` (camera direction) so "See this angle in 3D" flies there. Add `thumbs/` copies (~320 px tall) for new ones. |
| `images/interiors/<set>/` + `galleries` in `js/config.js` | Interior photo sets: `room3` (3 m room), `room35` (3.5 m room), `shared` (living/dining, terrace, corridors), `villa`. Each room type's `gallery` decides which set its "Room photos" button opens; `corridors` adds that floor's corridor. |
| `pano` on a room type | 360° render (2:1 equirectangular, e.g. 4096×2048 or larger) in `images/pano/`. Shows a "360° view" button on the room card and in the room bar when inside. In the 360° view, **Space** (or the "Walk around" button) switches to walk mode in that room, facing the window. `panoStart` = direction it opens facing (degrees), `panoPitch` = how far up/down people can look (45 hides warped ceilings/floors in AI-edited panoramas). Now set: 3 m Room → `images/pano/room3.webp` (Gemini-edited, 1024 px), 3.5 m Room → `images/pano/room35.jpg` (Topaz-upscaled, resized to 7200×3600, JPG quality 82, 1.7 MB). Replace both with upscaled 4096×2048 versions (same file names). |

## Data from Revit
- `data/geometry.bin` + `data/model.json` are exported from the Revit view **UE_DEMO** (walls, floors, furniture… grouped by level).
  Left out on purpose because they are extremely heavy: *Plover Office Chair* (~355k triangles each), *SHOWER BRAVAT*, *QARC Toilet*, *QARC Basin*.
- `node tools/build-units.mjs` rebuilds `data/units.json` from the Revit rooms. It keeps the status/type/price you already edited.
- `node tools/pack-geometry.mjs` compresses `geometry.bin` (9 MB) into `geometry.q.bin.gz` (~1.1 MB, 16-bit, <0.5 mm error).
  **Run it after every Revit export**; the site loads the small file and falls back to `geometry.bin` if it's missing.

## Performance notes
- Sun shadows are rendered once (and again only when the time of day or the floor cut changes), not every frame.
- Bathroom fixtures are simplified on load (~27k -> ~4k triangles per set) and instanced.
- Meshes are split per material per floor; floors above a cut, or away from you while walking indoors, aren't drawn.
- Opaque surfaces are single-sided; screen resolution is capped (HQ 3.5 MP, Lite 2 MP); HQ uses 6 mood lights, Lite 3.

### Which rooms become units
Any Revit room named like `K.305` (K + 3 digits). 42 today: Level 2 = 10, Level 3 = 16, Level 4 = 16.
Numbering follows the drawings: odd numbers on the south side, even on the north, west → east;
K.206 / K.207 / K.311 are the unused "gap" numbers at the stair/corridor.

## 360° renders from Unreal (one per room type)
1. In a room of that type, place a camera at eye height (~1.6 m), centred in the room.
2. Render it with Movie Render Queue's panoramic (equirectangular) output at 2:1, e.g. 6144×3072.
3. Save as `images/pano-standard.jpg` / `pano-deluxe.jpg` / `pano-suite.jpg` (names are set in `js/config.js`).

## Publish for free
Upload this whole folder to **Cloudflare Pages** (Workers & Pages → Create → Pages → upload assets) or GitHub Pages. No build step needed.
