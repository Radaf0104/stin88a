"""08 - Materials: Principled BSDF with image textures only (glTF-exportable), tinted to the README colour targets.

  blender -b source/blender/stin88a_07_uv.blend -P tools/blender/08_materials.py -- --out source/blender/stin88a_08_materials.blend
          [--tex <dir with Poly Haven texture folders>]

* Textures: the site's own CC0 set (assets/tex: plaster, oak, concrete, marble, asphalt) + Poly Haven CC0 downloads
  (teak_veneer, large_floor_tiles_02, long_white_tiles, rough_linen; see CREDITS.md). Brushed metal is generated here.
* Each textured material gets its own images in source/textures/ (out of Git): the colour map tinted so its average
  matches the target colour, with a subtle large-scale colour / roughness variation baked in (big walls aren't uniform).
  Tinting is baked into the images because a colour-multiply node does not survive the glTF export.
* Texture scale: UVMap is in metres, so a Mapping node scales by 1 / (texture's real size) - exported as
  KHR_texture_transform.
* Glass, frosted glass, water keep simple placeholders (M_glass_clear, M_glass_frosted, M_water): the site swaps in its
  own shaders by name.
* Bathroom walls: Revit has no wall finish there, so vertical faces inside the "KM K.xxx" rooms (below 2.4 m) get
  M_tile_wall.
Idempotent: reads the 07 output and writes a new file; texture images are regenerated with a fixed random seed.
"""
import bpy, bmesh, sys, os, math, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("out", "source/blender/stin88a_08_materials.blend"),
                 ("tex", r"D:\WinTemp\claude\f6a292be079a5b7e\9bb59eaf-625c-4b48-8ed2-aae5b56e8d5d\scratchpad\assets\polyhaven\textures"),
                 ("res", "1024")])
log = common.Log("08_materials")
TEXOUT = os.path.join(common.REPO, "source", "textures"); os.makedirs(TEXOUT, exist_ok=True)
SITE = os.path.join(common.REPO, "assets", "tex")
PH = A["tex"]
RES = int(A["res"])

def ph(name, kind):  # Poly Haven 1k files
    return os.path.join(PH, name, "%s_%s_1k.jpg" % (name, {"diff": "diff", "nor": "nor_gl", "rough": "rough"}[kind]))
def site(name, kind):
    return os.path.join(SITE, "%s_%s.jpg" % (name, kind))

# clean material -> (source textures, real size in m, target colour (sRGB hex), roughness range, metallic, variation)
SPEC = {
    # facade plaster: warm off-white (exterior renders: sunlit #F4EAE0, shade #EEE1D1)
    "M_plaster_cream": ({"diff": site("white_plaster_02", "diff"), "nor": site("white_plaster_02", "nor"), "rough": site("white_plaster_02", "rough")}, 2.0, "EEE6DB", (0.85, 0.95), 0, 0.02),
    # Revit "Default New Material": the podium's timber screens (wood slats in the renders, not plaster)
    "M_teak_batten":   ({"diff": ph("teak_veneer", "diff"), "nor": ph("teak_veneer", "nor"), "rough": ph("teak_veneer", "rough")}, 1.0, "A88A68", (0.5, 0.7), 0, 0.04),
    "M_plaster_grey":  ({"diff": site("white_plaster_02", "diff"), "nor": site("white_plaster_02", "nor"), "rough": site("white_plaster_02", "rough")}, 2.0, "C9C4BC", (0.85, 0.95), 0, 0.02),
    "M_concrete":      ({"diff": site("concrete_floor_worn_001", "diff"), "nor": site("concrete_floor_worn_001", "nor"), "rough": site("concrete_floor_worn_001", "rough")}, 2.0, "B8B3AB", (0.8, 0.95), 0, 0.06),
    # room floors: light, smooth polished concrete (room3 interior renders)
    "M_tile_floor":    ({"diff": ph("smooth_concrete_floor", "diff"), "nor": ph("smooth_concrete_floor", "nor"), "rough": ph("smooth_concrete_floor", "rough")}, 2.0, "C8C0B4", (0.25, 0.45), 0, 0.03),
    "M_fabric_curtain": ({"diff": ph("rough_linen", "diff"), "nor": ph("rough_linen", "nor"), "rough": ph("rough_linen", "rough")}, 0.27, "A89A85", (0.85, 1.0), 0, 0.0),
    "M_fabric_sage":   ({"diff": ph("rough_linen", "diff"), "nor": ph("rough_linen", "nor"), "rough": ph("rough_linen", "rough")}, 0.27, "8F9877", (0.85, 1.0), 0, 0.0),
    # desk chair upholstery: grey fabric like the room3 renders (the Poly Haven chair comes in black leather)
    "modern_arm_chair_01_pillow": ({"diff": ph("rough_linen", "diff"), "nor": ph("rough_linen", "nor"), "rough": ph("rough_linen", "rough")}, 0.27, "8A8580", (0.85, 1.0), 0, 0.0),
    "M_rug":           ("rug", 2.0, "DCD5CA", (0.9, 1.0), 0, 0.0),
    "M_tile_wall":     ({"diff": ph("long_white_tiles", "diff"), "nor": ph("long_white_tiles", "nor"), "rough": ph("long_white_tiles", "rough")}, 1.27, "EFEDE8", (0.15, 0.3), 0, 0.0),
    "M_teak_timber":   ({"diff": ph("teak_veneer", "diff"), "nor": ph("teak_veneer", "nor"), "rough": ph("teak_veneer", "rough")}, 1.0, "A88A68", (0.5, 0.7), 0, 0.04),  # honey teak (r02 / r11)
    "M_teak_deck":     ({"diff": ph("teak_veneer", "diff"), "nor": ph("teak_veneer", "nor"), "rough": ph("teak_veneer", "rough")}, 1.0, "8A6A50", (0.6, 0.8), 0, 0.05),
    # interior joinery, headboard wall, doors: mid-brown walnut with a straight grain (room3 interior renders)
    "M_wood_light":    ({"diff": ph("walnut_veneer", "diff"), "nor": ph("walnut_veneer", "nor"), "rough": ph("walnut_veneer", "rough")}, 1.8, "8C6A4E", (0.4, 0.6), 0, 0.02),
    "M_stone_marble":  ({"diff": site("marble_01", "diff"), "nor": site("marble_01", "nor"), "rough": site("marble_01", "rough")}, 1.0, "9C9A96", (0.15, 0.3), 0, 0.0),
    "M_site_paving":   ({"diff": site("asphalt_02", "diff"), "nor": site("asphalt_02", "nor"), "rough": site("asphalt_02", "rough")}, 3.0, "8C8A84", (0.85, 1.0), 0, 0.05),
    "M_fabric_bedding": ({"diff": ph("rough_linen", "diff"), "nor": ph("rough_linen", "nor"), "rough": ph("rough_linen", "rough")}, 0.27, "E4DCCD", (0.85, 1.0), 0, 0.0),
    "M_fabric_sheet":  ({"diff": ph("rough_linen", "diff"), "nor": ph("rough_linen", "nor"), "rough": ph("rough_linen", "rough")}, 0.27, "EFEDE7", (0.85, 1.0), 0, 0.0),
    "M_fabric_throw":  ("stripes", 0.5, "E6DFD2", (0.85, 1.0), 0, 0.0),   # cream throw with taupe stripes
    "M_fabric_sofa":   ({"diff": ph("rough_linen", "diff"), "nor": ph("rough_linen", "nor"), "rough": ph("rough_linen", "rough")}, 0.27, "8E8A84", (0.85, 1.0), 0, 0.0),
    "M_metal_brushed": ("brushed", 0.5, "A8A8A6", (0.25, 0.4), 1, 0.0),
}
DETAIL = {"M_plaster_cream": 0.25, "M_plaster_grey": 0.3, "M_concrete": 0.5}
NORMAL_STRENGTH = {"M_plaster_cream": 0.35, "M_plaster_grey": 0.4, "M_concrete": 0.5}
PLAIN = {  # no texture: colour, roughness, metallic
    "M_chrome": ("D0D0D0", 0.08, 1), "M_metal_dark": ("2E2F31", 0.55, 0.35), "M_metal_grey": ("6E6E6C", 0.5, 0.35),
    "M_plastic_white": ("EEEEEA", 0.4, 0), "M_plastic_black": ("1E1F21", 0.45, 0), "M_screen": ("0E0F12", 0.12, 0),
    "M_porcelain": ("F4F3EF", 0.1, 0), "M_roof_shingle": ("4B4B4B", 0.9, 0), "M_lacquer_cream": ("E6DCCB", 0.35, 0),
    "M_light_emitter": ("FFE2B8", 0.5, 0),
}
PLACEHOLDER = {"M_glass_clear": ("4F5C5C", 0.02, 0.28), "M_glass_frosted": ("E8F2F2", 0.45, 0.55), "M_water": ("4FA3B5", 0.03, 0.75)}

def srgb_to_lin(c): c = np.asarray(c, float); return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def hexrgb(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])

def load_px(path):
    img = bpy.data.images.load(path, check_existing=False)
    if tuple(img.size) != (RES, RES): img.scale(RES, RES)
    px = np.empty(RES * RES * 4, dtype=np.float32); img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(RES, RES, 4)
def lin_to_srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
def save_px(px, name, colorspace):
    # 8-bit images store their pixels as given (no colour conversion on foreach_set / save): colour maps are worked on
    # in linear light here, so they are encoded to sRGB before writing (without this every colour texture came out
    # "gamma squared" - the plaster read peach, the teak red-brown, the walnut near black)
    px = np.array(px, dtype=np.float32, copy=True)
    if colorspace == "sRGB": px[..., :3] = lin_to_srgb(px[..., :3])
    img = bpy.data.images.new(name, RES, RES, alpha=False)
    img.pixels.foreach_set(np.clip(px, 0, 1).astype(np.float32).ravel())
    path = os.path.join(TEXOUT, name + ".jpg")
    img.filepath_raw = path; img.file_format = "JPEG"
    bpy.context.scene.render.image_settings.quality = 88
    img.save_render(path) if False else img.save()
    img.colorspace_settings.name = colorspace
    return img
rng = np.random.default_rng(1234)
def low_noise(scale=8):
    """smooth large-scale variation (tileable): a few random sine waves"""
    y, x = np.mgrid[0:RES, 0:RES] / RES
    n = np.zeros((RES, RES))
    for k in range(6):
        fx, fy = rng.integers(1, scale, 2); ph_ = rng.uniform(0, 2 * np.pi)
        n += np.sin(2 * np.pi * (fx * x + fy * y) + ph_) / (k + 1)
    return n / np.abs(n).max()

def make_textures(name, src, target, rough_rng, variation):
    if src == "brushed":  # generated brushed metal: fine streaks along u
        y, x = np.mgrid[0:RES, 0:RES]
        streak = rng.normal(0, 1, (RES, 1)) * 0.6 + rng.normal(0, 1, (RES, RES)) * 0.15
        streak = np.repeat(streak.mean(1, keepdims=True), RES, 1) * 0.7 + streak * 0.3
        streak = (streak - streak.min()) / (streak.max() - streak.min())
        lin = srgb_to_lin(hexrgb(target))
        diff = np.ones((RES, RES, 4)); diff[..., :3] = lin * (0.92 + 0.16 * streak[..., None]);
        rough = np.ones((RES, RES, 4)); rough[..., :3] = (rough_rng[0] + (rough_rng[1] - rough_rng[0]) * streak)[..., None]
        nor = np.ones((RES, RES, 4)); nor[..., 0] = 0.5; nor[..., 1] = 0.5 + 0.03 * (streak - 0.5); nor[..., 2] = 1
        # pixels in Blender images are linear for non-colour data and scene-linear for colour images
        return save_px(diff, name + "_diff", "sRGB"), save_px(rough, name + "_rough", "Non-Color"), save_px(nor, name + "_nor", "Non-Color")
    if src in ("stripes", "rug"):  # generated fabric patterns
        y, x = np.mgrid[0:RES, 0:RES] / RES
        base = srgb_to_lin(hexrgb(target))
        if src == "stripes":   # 2.5 cm taupe stripes every 5 cm (texture = 0.5 m), soft edges + a little weave noise
            s = 0.5 + 0.5 * np.sin(2 * np.pi * x * 10)
            m = np.clip((s - 0.55) * 6, 0, 1)[..., None]
            col = base * (1 - m) + srgb_to_lin(hexrgb("A39784")) * m
        else:                  # rug: cream field with a faded, distressed vintage pattern (fine, low contrast)
            n = low_noise(24)[..., None]
            orn = np.sin(2 * np.pi * (x * 9 + 0.3 * np.sin(2 * np.pi * y * 5))) * np.sin(2 * np.pi * (y * 7 + 0.3 * np.sin(2 * np.pi * x * 4)))
            pat = np.clip((orn - 0.35) * 2.5, 0, 1) * (rng.random((RES, RES)) > 0.45)
            m = np.clip(pat[..., None] * 0.35 + 0.06 * n, 0, 1)
            col = base * (1 - m) + srgb_to_lin(hexrgb("8E8A86")) * m
        grain = 1 + 0.04 * rng.normal(0, 1, (RES, RES, 1))
        d = np.ones((RES, RES, 4)); d[..., :3] = np.clip(col * grain, 0, 1)
        r = np.ones((RES, RES, 4)); r[..., :3] = rough_rng[1]
        nm = np.ones((RES, RES, 4)); nm[..., 0] = 0.5; nm[..., 1] = 0.5; nm[..., 2] = 1
        return save_px(d, name + "_diff", "sRGB"), save_px(r, name + "_rough", "Non-Color"), save_px(nm, name + "_nor", "Non-Color")
    d = load_px(src["diff"])  # 8-bit photo: pixels come in sRGB-encoded -> to linear light for the tinting below
    d[..., :3] = srgb_to_lin(d[..., :3])
    lin_target = srgb_to_lin(hexrgb(target))
    mean = d[..., :3].reshape(-1, 3).mean(0)
    # how much of the photo's own light / dark detail is kept: plaster and concrete only a soft grain (the renders
    # show smooth cream plaster; the full photo contrast read as stained concrete at room scale)
    keep = DETAIL.get(name, 1.0)
    d[..., :3] = mean + keep * (d[..., :3] - mean)
    d[..., :3] = d[..., :3] * (lin_target / np.maximum(mean, 1e-4))
    if variation:
        n = low_noise()[..., None]
        d[..., :3] *= 1 + variation * n
    r = load_px(src["rough"])
    rr = r[..., 0]; rr = (rr - rr.min()) / max(1e-4, rr.max() - rr.min())
    r[..., :3] = (rough_rng[0] + (rough_rng[1] - rough_rng[0]) * rr)[..., None]
    if variation: r[..., :3] = np.clip(r[..., :3] + 0.5 * variation * low_noise()[..., None], 0, 1)
    nm = load_px(src["nor"])
    return save_px(d, name + "_diff", "sRGB"), save_px(r, name + "_rough", "Non-Color"), save_px(nm, name + "_nor", "Non-Color")

def principled(m):
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return nt, b

def build_textured(m, spec):
    src, size, target, rr, metal, var = spec
    diff, rough, nor = make_textures(m.name, src, target, rr, var)
    nt, b = principled(m)
    uv = nt.nodes.new("ShaderNodeUVMap"); uv.uv_map = "UVMap"
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1 / size, 1 / size, 1)
    nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
    def tex(img):
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img; nt.links.new(mp.outputs["Vector"], t.inputs["Vector"]); return t
    nt.links.new(tex(diff).outputs["Color"], b.inputs["Base Color"])
    rt = tex(rough); sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(rt.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Red"], b.inputs["Roughness"])
    nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.uv_map = "UVMap"; nmap.inputs["Strength"].default_value = NORMAL_STRENGTH.get(m.name, 0.8)
    nt.links.new(tex(nor).outputs["Color"], nmap.inputs["Color"]); nt.links.new(nmap.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*srgb_to_lin(hexrgb(target)), 1)

def build_plain(m, spec, alpha=None):
    col, rough, metal = spec[0], spec[1], spec[2]
    nt, b = principled(m)
    c = srgb_to_lin(hexrgb(col))
    b.inputs["Base Color"].default_value = (*c, 1); b.inputs["Roughness"].default_value = rough
    if alpha is None: b.inputs["Metallic"].default_value = metal
    else:
        b.inputs["Alpha"].default_value = alpha
        try: m.surface_render_method = "BLENDED"
        except Exception: pass
    if m.name == "M_light_emitter":
        b.inputs["Emission Color"].default_value = (*c, 1); b.inputs["Emission Strength"].default_value = 3
    m.diffuse_color = (*c, 1)

# bathroom wall tiles: vertical faces inside the KM rooms, below 2.4 m, on the shell meshes
model = common.model_json()
baths = [r for r in model["rooms"] if r["name"].strip().startswith("KM ")]
def in_poly(x, y, pts):
    c = False
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
    return c
tile = bpy.data.materials.get("M_tile_wall") or bpy.data.materials.new("M_tile_wall")
n_tile = 0
for o in [o for o in bpy.data.objects if o.type == "MESH" and o.get("kind") == "shell" and o.matrix_world == o.matrix_world.Identity(4)]:
    me = o.data
    if not any(m and m.name in ("M_plaster_cream", "M_plaster_grey") for m in me.materials): continue
    if "M_tile_wall" not in me.materials: me.materials.append(tile)
    ti = list(me.materials).index(me.materials["M_tile_wall"])
    for p in me.polygons:
        c = p.center
        if abs(p.normal.z) > 0.3: continue
        if not me.materials[p.material_index] or me.materials[p.material_index].name not in ("M_plaster_cream", "M_plaster_grey"): continue
        # the face sits on a bathroom wall when a point 5 cm in front of it is inside a KM room at that level
        q = c + p.normal * 0.05
        r = next((r for r in baths if r["z"] - 0.1 <= c.z <= r["z"] + 2.4 and in_poly(q.x, q.y, r["outline"])), None)
        if r: p.material_index = ti; n_tile += 1
log("bathroom wall faces tiled: %d" % n_tile)

# late fixes for Revit names the earlier stages didn't know (material_map.json now has them for the next full run):
# "Porcelain, White" (toilets, basins) -> porcelain; "DefaultMaterial" -> metal on the lifts / water pump, else concrete
def remap(old, new_for):
    m_old = bpy.data.materials.get(old)
    if not m_old: return 0
    n = 0
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        for i, m in enumerate(o.data.materials):
            if m == m_old:
                tgt = new_for(o)
                o.data.materials[i] = bpy.data.materials.get(tgt) or bpy.data.materials.new(tgt); n += 1
    return n
n1 = remap("M_rv_Porcelain_White", lambda o: "M_porcelain")
n2 = remap("M_rv_DefaultMaterial", lambda o: "M_metal_grey" if any(k in str(o.get("family", "")) for k in ("Lift", "AQUABOOST")) else "M_concrete")
log("late material fixes: porcelain %d, DefaultMaterial %d" % (n1, n2))

done, missing = [], []
for m in list(bpy.data.materials):
    if m.name in SPEC:
        src = SPEC[m.name][0]
        if isinstance(src, dict) and not all(os.path.exists(p) for p in src.values()): missing.append(m.name); continue
        build_textured(m, SPEC[m.name]); done.append(m.name)
    elif m.name in PLAIN: build_plain(m, PLAIN[m.name]); done.append(m.name)
    elif m.name in PLACEHOLDER: build_plain(m, PLACEHOLDER[m.name][:2] + (0,), alpha=PLACEHOLDER[m.name][2]); done.append(m.name)
used = {m.name for o in bpy.data.objects if o.type == "MESH" for m in o.data.materials if m}
untouched = sorted(n for n in used if n not in done)
log("materials built: %d; missing texture files: %s" % (len(done), missing or "none"))
log("materials left as they were (Poly Haven chair, unmapped Revit names): %s" % untouched)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"], "| textures in", TEXOUT)
