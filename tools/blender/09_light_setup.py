"""09 - Light setup for the bake, matched to the website's Day settings (js/environment.js TIMES.day, js/lighting.js).

  blender -b source/blender/stin88a_08_materials.blend -P tools/blender/09_light_setup.py -- --rooms K.305 --out source/blender/stin88a_09_lights.blend

* World: the site's day sky photo (assets/sky/autumn_field_puresky_2k.hdr), turned so the sun in the photo sits where the
  site puts the sun (sunAz, sunElev).
* Sun lamp in the site's sun direction and colour (it bounces into the indirect bake; see 10_bake.py --sun).
* Room lamps at the site's mood-light anchors for the baked rooms: bedroom (centre, 2.25 m, #ffd6ad) and bathroom
  (2.2 m, #fff0dc), strength = MOODS power x TIMES.day.lamps (daylight wins at day).
* Light portals (area lights flagged as portals) over the glass of the baked rooms, which help Cycles find the sky.
* Colour management AgX. Everything created here lives in the collection "BAKE_LIGHTS" (replaced on every run).
"""
import bpy, sys, os, re, math
import numpy as np
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("rooms", "K.305"), ("out", "source/blender/stin88a_09_lights.blend"), ("sun-energy", None), ("time", "day")])
log = common.Log("09_lights")
sc = bpy.context.scene
env = open(os.path.join(common.REPO, "js", "environment.js"), encoding="utf8").read()
# the TIMES entry for --time (day / golden / night): from "<time>:" to the next time's key
blk = re.search(r"\n\s*%s:\s*\{(.*?)(?=\n\s*(?:day|golden|night):\s*\{|\n\};)" % A["time"], env, re.S).group(1)
def num(key, default=None):
    m = re.search(r"\b%s:\s*(-?[\d.]+)" % key, blk); return float(m.group(1)) if m else default
sun_az = num("sunAz"); sun_el = num("sunElev")            # golden hour: no sunElev -> the sun's height in the photo
sun_col = int(re.search(r"\bsun:\s*0x([0-9a-fA-F]+)", blk).group(1), 16)
lamps = num("lamps", 1.0)
hdr_rel = (re.search(r'hdri:\s*"([^"]+)"', blk) or re.search(r'hdri:\s*"([^"]+)"', env)).group(1)
sun_energy = float(A["sun_energy"]) if A["sun_energy"] else {"day": 4.5, "golden": 2.5, "night": 0.4}.get(A["time"], 3.0)
log("time %s: sunAz %s, sunElev %s, sun #%06x, lamps x%.2f, sky %s" % (A["time"], sun_az, sun_el, sun_col, lamps, hdr_rel))
lit = open(os.path.join(common.REPO, "js", "lighting.js"), encoding="utf8").read()
def mood(name):
    m = re.search(name + r":\s*\{\s*color:\s*0x([0-9a-fA-F]+),\s*power:\s*([\d.]+),\s*height:\s*([\d.]+)", lit)
    return int(m.group(1), 16), float(m.group(2)), float(m.group(3))
def hex_lin(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

old = bpy.data.collections.get("BAKE_LIGHTS")
if old:
    for o in list(old.objects): bpy.data.objects.remove(o)
    bpy.data.collections.remove(old)
col = common.collection("BAKE_LIGHTS")

# ---- world: the time's sky photo (2k version when there is one) ----
hdr = os.path.join(common.REPO, hdr_rel.replace("_1k.", "_2k."))
if not os.path.exists(hdr): hdr = os.path.join(common.REPO, hdr_rel)
img = bpy.data.images.load(hdr, check_existing=True)
W_, H_ = img.size
px = np.empty(W_ * H_ * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(H_, W_, 4)
lum = px[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
row, colx = np.unravel_index(np.argmax(lum), lum.shape)
u, v = (colx + 0.5) / W_, (row + 0.5) / H_
# (Blender stores pixel rows bottom-up: v = 0 is the bottom of the photo = straight down, v = 0.5 the horizon)
phi = math.pi - 2 * math.pi * u; z = math.sin((v - 0.5) * math.pi); r = math.sqrt(max(0, 1 - z * z))
sun_px = Vector((-r * math.cos(phi), r * math.sin(phi), z))
# ---- sun direction (three.js setFromSphericalCoords -> Revit / Blender axes); no sunElev: the photo's sun height ----
if sun_el is None: sun_el = max(6.0, math.degrees(math.asin(max(-1, min(1, z)))))
az, el = math.radians(sun_az), math.radians(sun_el)
d_site = (math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az))
sun_dir = Vector((d_site[0], -d_site[2], d_site[1])).normalized()
# rotation about z that maps sun_dir onto the photo's sun (the mapping rotates the lookup vector)
a_px = math.atan2(sun_px.y, sun_px.x); a_sun = math.atan2(sun_dir.y, sun_dir.x)
rot = a_px - a_sun
w = sc.world or bpy.data.worlds.new("World"); sc.world = w; w.use_nodes = True
nt = w.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Rotation"].default_value[2] = rot
et = nt.nodes.new("ShaderNodeTexEnvironment"); et.image = img
bg = nt.nodes.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value = 1.0
out = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], et.inputs["Vector"])
nt.links.new(et.outputs["Color"], bg.inputs["Color"]); nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
w["sun_in_photo_elev_deg"] = math.degrees(math.asin(max(-1, min(1, z))))
log("sky: photo sun at %.0f deg elevation, turned %.1f deg so it lies at the site's sunAz %.0f" % (w["sun_in_photo_elev_deg"], math.degrees(rot), sun_az))

# ---- sun lamp ----
sl = bpy.data.lights.new("BAKE_SUN", "SUN"); sl.energy = sun_energy; sl.color = hex_lin(sun_col); sl.angle = math.radians(0.6)
so = bpy.data.objects.new("BAKE_SUN", sl); col.objects.link(so)
so.rotation_euler = sun_dir.to_track_quat("Z", "Y").to_euler()

# ---- room lamps + portals for each baked room ----
model = common.model_json()
glass_objs = [o for o in bpy.data.objects if o.type == "MESH" and o.get("lm_set", "").startswith("LM_K") and any(m and "glass" in m.name for m in o.data.materials)]
for room in A["rooms"].split(","):
    room = room.strip()
    for name, mood_key in ((room, "bedroom"), ("KM " + room, "bathroom")):
        r = next((x for x in model["rooms"] if x["name"].strip() == name), None)
        if not r: continue
        c = np.array(r["outline"]).mean(0)
        colr, power, height = mood(mood_key)
        L = bpy.data.lights.new("BAKE_LAMP_%s" % name.replace(" ", "_"), "POINT")
        # a third of the way to white (the room3 renders are warm, not orange) and a softer conversion to watts
        L.color = tuple(c + (1 - c) * 0.35 for c in hex_lin(colr)); L.shadow_soft_size = 0.15
        L.energy = power * lamps * 7.0  # three.js intensity (candela-ish) -> watts, same ratio for all lamps
        lo = bpy.data.objects.new(L.name, L); col.objects.link(lo); lo.location = (c[0], c[1], r["z"] + height)
        log("lamp %s: %s at %.2f m, %.1f W" % (name, mood_key, height, L.energy))
# portals: one rectangle per glass pane of the baked rooms (both faces of a pane -> one portal), facing into the room
n_portal = 0
seen = set()
room_c = [np.array(x["outline"]).mean(0) for x in model["rooms"] if x["name"].strip() in [r.strip() for r in A["rooms"].split(",")]]
room_c = Vector((float(room_c[0][0]), float(room_c[0][1]), 0)) if room_c else Vector((0, 0, 0))
for o in glass_objs:
    me = o.data; mw = o.matrix_world
    big = [p for p in me.polygons if p.area > 0.3 and abs(p.normal.z) < 0.2]
    for p in big:
        n = (mw.to_3x3() @ p.normal).normalized(); c = mw @ p.center
        key = (round(c.x / 0.1), round(c.y / 0.1), round(c.z / 0.1))
        if key in seen: continue
        seen.add(key)
        vs = [mw @ me.vertices[i].co for i in p.vertices]
        hz = Vector((-n.y, n.x, 0)).normalized()
        wdt = max(v.dot(hz) for v in vs) - min(v.dot(hz) for v in vs); hgt = max(v.z for v in vs) - min(v.z for v in vs)
        P = bpy.data.lights.new("BAKE_PORTAL", "AREA"); P.shape = "RECTANGLE"; P.size = max(0.1, wdt); P.size_y = max(0.1, hgt)
        try: P.cycles.is_portal = True
        except Exception: pass
        po = bpy.data.objects.new("BAKE_PORTAL", P); col.objects.link(po)
        # area lights shine along -Z: point it into the building (the room is behind the glass, away from the sky)
        to_room = Vector((room_c.x - c.x, room_c.y - c.y, 0))
        inward = n if n.dot(to_room) > 0 else -n
        po.location = c; po.rotation_euler = (inward).to_track_quat("-Z", "Y").to_euler()
        n_portal += 1
log("portals: %d over the glass of the baked rooms" % n_portal)

sc.view_settings.view_transform = "AgX"
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"])
