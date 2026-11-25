"""Check render (Eevee) inside one room, from both ends of its long axis, at eye height, next to an interior photo.
Nothing is saved to the .blend.

  blender -b source/blender/stin88a_06_furnished.blend -P tools/blender/room_render.py -- --room K.305 --photo images/interiors/room3/03.jpg --tag phase3

Camera: 0.35 m inside one short wall of the room outline (model.json), 1.45 m above the floor, looking along the room's
length toward the opposite wall, vertical field of view 50 deg; image aspect = the photo's. Light: the day sky + sun
(TIMES.day) through the windows, plus one warm ceiling light in the room. The ceiling above the camera is kept.
"""
import bpy, sys, os, re, math, json
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("room", "K.305"), ("photo", "images/interiors/room3/03.jpg"), ("tag", "phase3"), ("height", "720"), ("fov", "58"), ("samples", "48"),
                 ("ends", "A,B"), ("back", "1.2"), ("eye", "1.3"), ("keep-materials", False)])
log = common.Log("room_render")
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
try: sc.eevee.taa_render_samples = int(A["samples"])
except Exception: pass
for k in ("use_raytracing", "use_gtao"):
    try: setattr(sc.eevee, k, True)
    except Exception: pass
sc.view_settings.view_transform = "AgX"
if not A["keep_materials"]: common.apply_palette()

env = open(os.path.join(common.REPO, "js", "environment.js"), encoding="utf8").read()
day = re.search(r"day:\s*\{[^\n]*", env).group(0)
az = math.radians(float(re.search(r"sunAz:\s*(-?[\d.]+)", day).group(1))); el = math.radians(float(re.search(r"sunElev:\s*(-?[\d.]+)", day).group(1)))
w = bpy.data.worlds.new("CHECK_SKY"); sc.world = w; w.use_nodes = True
nt = w.node_tree; bg = nt.nodes.get("Background")
tex = nt.nodes.new("ShaderNodeTexEnvironment")
tex.image = bpy.data.images.load(os.path.join(common.REPO, "assets", "sky", "autumn_field_puresky_2k.hdr"), check_existing=True)
nt.links.new(tex.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 1.0
d = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)))
sl = bpy.data.lights.new("CHECK_SUN", "SUN"); sl.energy = 4.0
so = bpy.data.objects.new("CHECK_SUN", sl); sc.collection.objects.link(so); so.rotation_euler = d.to_track_quat("Z", "Y").to_euler()

room = next(r for r in common.model_json()["rooms"] if r["name"].strip() == A["room"])
pts = np.array(room["outline"]); mn, mx = pts.min(0), pts.max(0); c = (mn + mx) / 2; z0 = room["z"]
ax = 0 if (mx - mn)[0] > (mx - mn)[1] else 1
lamp = bpy.data.lights.new("CHECK_ROOM_LIGHT", "AREA"); lamp.energy = 60; lamp.color = (1.0, 0.85, 0.7); lamp.size = 0.6
lo = bpy.data.objects.new("CHECK_ROOM_LIGHT", lamp); sc.collection.objects.link(lo); lo.location = (c[0], c[1], z0 + 2.35)

photo = bpy.data.images.load(os.path.abspath(A["photo"]), check_existing=True)
H = int(A["height"]); W = int(round(H * photo.size[0] / photo.size[1]))
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
out_dir = os.path.join(common.REPO, "source", "compare", A["tag"]); os.makedirs(out_dir, exist_ok=True)
ends = {"A": 1, "B": -1}
for name in A["ends"].split(","):
    end = ends[name]
    back = float(A["back"])  # like the interior renders: camera behind the end wall, the near wall clipped away
    p = c.copy(); p[ax] = (mx[ax] + back) if end > 0 else (mn[ax] - back)
    t = c.copy(); t[ax] = mn[ax] if end > 0 else mx[ax]
    cd = bpy.data.cameras.new("CAM_ROOM"); cd.sensor_fit = "VERTICAL"; cd.angle_y = math.radians(float(A["fov"]))
    cd.clip_start = back + 0.3 if back > 0 else 0.05
    co = bpy.data.objects.new("CAM_ROOM_%d" % end, cd); sc.collection.objects.link(co)
    co.location = (p[0], p[1], z0 + float(A["eye"]))
    co.rotation_euler = (Vector((t[0], t[1], z0 + float(A["eye"]) - 0.25)) - co.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    stage = os.path.splitext(os.path.basename(bpy.data.filepath))[0].replace("stin88a_", "")
    sc.render.filepath = os.path.join(out_dir, "%s_%s_end%s.png" % (A["room"].replace(".", ""), stage, name))
    bpy.ops.render.render(write_still=True)
    log("rendered", sc.render.filepath)
