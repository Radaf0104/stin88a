"""Check renders (Eevee) of a pipeline stage from the website's exterior camera pins. Nothing is saved to the .blend.

  blender -b source/blender/stin88a_04_join.blend -P tools/blender/check_render.py -- --pins r01,r02,r09 --tag phase2
  then: node tools/side-by-side.mjs source/compare/phase2      (render | reference image pairs)

Camera = js/main.js flyToRender(): target (0, building height x 0.35, 0), direction from renders[].az / el, distance
radius x 1.9 x dist, vertical field of view 38 deg; image aspect = the reference render's.
Light = TIMES.day in js/environment.js: sun from sunAz / sunElev, sky = the site's day HDRI. A grass plane at the lawn
height (-0.25 m) is added for the check only. Materials: the Revit colours (no textures yet - Phase 4).
"""
import bpy, sys, os, re, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("pins", "r01,r02,r09"), ("tag", "check"), ("height", "720"), ("samples", "32"), ("keep-materials", False)])
log = common.Log("check_render")
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
log("engine", sc.render.engine)
try: sc.eevee.taa_render_samples = int(A["samples"])
except Exception: pass
try: sc.view_settings.view_transform = "AgX"
except TypeError: pass

# sky + sun (TIMES.day)
env = open(os.path.join(common.REPO, "js", "environment.js"), encoding="utf8").read()
day = re.search(r"day:\s*\{[^\n]*", env).group(0)
az = math.radians(float(re.search(r"sunAz:\s*(-?[\d.]+)", day).group(1))); el = math.radians(float(re.search(r"sunElev:\s*(-?[\d.]+)", day).group(1)))
w = bpy.data.worlds.new("CHECK_SKY"); sc.world = w; w.use_nodes = True
nt = w.node_tree; bg = nt.nodes.get("Background")
tex = nt.nodes.new("ShaderNodeTexEnvironment")
tex.image = bpy.data.images.load(os.path.join(common.REPO, "assets", "sky", "autumn_field_puresky_2k.hdr"), check_existing=True)
nt.links.new(tex.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 0.6
sun_site = (math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az))  # three.js setFromSphericalCoords
d = Vector((sun_site[0], -sun_site[2], sun_site[1]))                                 # -> Revit / Blender
sl = bpy.data.lights.new("CHECK_SUN", "SUN"); sl.energy = 4.0; sl.angle = math.radians(1.5)
so = bpy.data.objects.new("CHECK_SUN", sl); sc.collection.objects.link(so)
so.rotation_euler = d.to_track_quat("Z", "Y").to_euler()   # the lamp shines along its -Z, i.e. away from d
# lawn
bpy.ops.mesh.primitive_plane_add(size=800, location=(0, 0, -0.25))
gp = bpy.context.active_object; gp.name = "CHECK_GROUND"
gm = bpy.data.materials.new("CHECK_GRASS"); gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.17, 0.2, 0.05, 1); gp.data.materials.append(gm)
# readable check colours for the clean materials (README targets: plaster #F2E6D7 / #E0D4C4, timber #9A7A60);
# check renders only - the real materials come in Phase 4
PALETTE = {"M_plaster_cream": "E9DCCB", "M_plaster_grey": "C9C4BC", "M_concrete": "B8B3AB", "M_tile_floor": "D8D0C4",
           "M_teak_batten": "E0D4C4", "M_teak_timber": "9A7A60", "M_teak_deck": "8A6A50", "M_wood_light": "C8A982",
           "M_metal_dark": "2E2F31", "M_metal_grey": "6E6E6C", "M_metal_brushed": "A8A8A6", "M_chrome": "D0D0D0",
           "M_plastic_white": "EEEEEA", "M_plastic_black": "1E1F21", "M_roof_shingle": "4B4B4B", "M_site_paving": "8C8A84",
           "M_glass_clear": "4F5C5C", "M_glass_frosted": "E8F2F2", "M_water": "4FA3B5"}
for m in ([] if A["keep_materials"] else bpy.data.materials):
    h = PALETTE.get(m.name)
    if h and m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
        c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]  # sRGB -> linear
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*c, 1)
        m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 1.0
# see-through glass for the check
for m in bpy.data.materials:
    if any(k in m.name.lower() for k in ("glass", "glazing", "water")):
        try: m.surface_render_method = "BLENDED"
        except Exception: pass
        if m.use_nodes and "Principled BSDF" in m.node_tree.nodes: m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.3

out_dir = os.path.join(common.REPO, "source", "compare", A["tag"]); os.makedirs(out_dir, exist_ok=True)
want = set(A["pins"].split(","))
for cam in common.site_render_cameras():
    key = os.path.splitext(cam["file"])[0]
    if key not in want: continue
    ref = bpy.data.images.load(os.path.join(common.REPO, "images", "renders", cam["file"]), check_existing=True)
    H = int(A["height"]); W = int(round(H * ref.size[0] / ref.size[1]))
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
    cd = bpy.data.cameras.new(cam["name"]); cd.sensor_fit = "VERTICAL"; cd.angle_y = math.radians(38); cd.clip_start = 0.1; cd.clip_end = 800
    co = bpy.data.objects.new(cam["name"], cd); sc.collection.objects.link(co)
    co.location = cam["pos"]; co.rotation_euler = (cam["target"] - cam["pos"]).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    stage = os.path.splitext(os.path.basename(bpy.data.filepath))[0].replace("stin88a_", "")
    sc.render.filepath = os.path.join(out_dir, "%s_%s.png" % (key, stage))
    bpy.ops.render.render(write_still=True)
    log("rendered", sc.render.filepath, "%dx%d" % (W, H), "cam", tuple(round(v, 2) for v in cam["pos"]))
