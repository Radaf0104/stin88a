"""11 - Preview a baked room the way the website will light it (Eevee), next to an interior photo. Nothing is saved.

  blender -b source/blender/stin88a_09_lights.blend -P tools/blender/11_lightmap_preview.py --
          --set LM_K305 --room K.305 --indirect source/bakes/LM_K305_sun_indirect_dn.exr --ao source/bakes/LM_K305_ao_dn.exr
          --photo images/interiors/room3/03.jpg --tag phase5 [--emission-only]

Per material of the baked meshes (copies, so nothing else changes):
  surface = Principled BSDF (lit live by the sun + room lamps, like three.js)
          + Emission( base colour x indirect lightmap x AO )   (the baked bounce light, like material.lightMap)
The sky is only seen by the camera (through the windows); it adds no light, because its light is in the lightmap.
--emission-only shows the lightmap alone (check for black texels / leaks / seams).
Camera: as tools/blender/room_render.py (behind the end wall, the near wall clipped away).
"""
import bpy, sys, os, math
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("set", "LM_K305"), ("room", "K.305"), ("indirect", None), ("ao", None), ("photo", "images/interiors/room3/03.jpg"),
                 ("tag", "phase5"), ("height", "720"), ("fov", "58"), ("back", "1.2"), ("eye", "1.3"), ("end", "B"),
                 ("emission-only", False), ("label", ""), ("site-exposure", "1.8")])
log = common.Log("11_preview")
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
try: sc.eevee.taa_render_samples = 64
except Exception: pass
for k in ("use_shadows", "use_raytracing"):
    try: setattr(sc.eevee, k, k == "use_shadows")
    except Exception: pass
sc.view_settings.view_transform = "AgX"
# the site's exposure for the time of day (TIMES.day.exposure, a linear multiplier) -> Blender exposure in stops
sc.view_settings.exposure = math.log2(float(A["site_exposure"]))

lm = bpy.data.images.load(os.path.abspath(A["indirect"]), check_existing=True); lm.colorspace_settings.name = "Non-Color"
ao = bpy.data.images.load(os.path.abspath(A["ao"]), check_existing=True) if A["ao"] else None
if ao: ao.colorspace_settings.name = "Non-Color"

targets = [o for o in bpy.data.objects if o.type == "MESH" and o.get("lm_set") == A["set"]]
copies = {}
for o in targets:
    for i, m in enumerate(o.data.materials):
        if not m: continue
        if m.name not in copies:
            c = m.copy(); c.name = m.name + "_LMPREVIEW"; copies[m.name] = c
            nt = c.node_tree; b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if not b: continue
            out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
            uv = nt.nodes.new("ShaderNodeUVMap"); uv.uv_map = "UVMap_LM"
            tl = nt.nodes.new("ShaderNodeTexImage"); tl.image = lm; nt.links.new(uv.outputs["UV"], tl.inputs["Vector"])
            col = tl.outputs["Color"]
            if ao:
                ta = nt.nodes.new("ShaderNodeTexImage"); ta.image = ao; nt.links.new(uv.outputs["UV"], ta.inputs["Vector"])
                mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1
                nt.links.new(col, mul.inputs["A"]); nt.links.new(ta.outputs["Color"], mul.inputs["B"]); col = mul.outputs["Result"]
            # base colour: whatever feeds the Principled base colour (texture or plain value)
            base_link = b.inputs["Base Color"].links
            m2 = nt.nodes.new("ShaderNodeMix"); m2.data_type = "RGBA"; m2.blend_type = "MULTIPLY"; m2.inputs["Factor"].default_value = 1
            if base_link: nt.links.new(base_link[0].from_socket, m2.inputs["A"])
            else: m2.inputs["A"].default_value = b.inputs["Base Color"].default_value
            nt.links.new(col, m2.inputs["B"])
            em = nt.nodes.new("ShaderNodeEmission"); nt.links.new(m2.outputs["Result"], em.inputs["Color"])
            if A["emission_only"]:
                em2 = nt.nodes.new("ShaderNodeEmission"); nt.links.new(col, em2.inputs["Color"])
                nt.links.new(em2.outputs["Emission"], out.inputs["Surface"])
            else:
                add = nt.nodes.new("ShaderNodeAddShader")
                nt.links.new(b.outputs["BSDF"], add.inputs[0]); nt.links.new(em.outputs["Emission"], add.inputs[1])
                nt.links.new(add.outputs["Shader"], out.inputs["Surface"])
        o.data.materials[i] = copies[m.name]
log("lightmap applied to %d meshes (%d materials)" % (len(targets), len(copies)))

# the sky: seen by the camera only (its light is in the lightmap)
w = sc.world; nt = w.node_tree
bg = next(n for n in nt.nodes if n.type == "BACKGROUND"); outw = next(n for n in nt.nodes if n.type == "OUTPUT_WORLD")
lp = nt.nodes.new("ShaderNodeLightPath"); mix = nt.nodes.new("ShaderNodeMixShader"); black = nt.nodes.new("ShaderNodeBackground")
black.inputs["Strength"].default_value = 0
nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"]); nt.links.new(black.outputs["Background"], mix.inputs[1])
nt.links.new(bg.outputs["Background"], mix.inputs[2]); nt.links.new(mix.outputs["Shader"], outw.inputs["Surface"])
if A["emission_only"]:
    for o in bpy.data.objects:
        if o.type == "LIGHT": o.hide_render = True

# camera (as room_render.py)
room = next(r for r in common.model_json()["rooms"] if r["name"].strip() == A["room"])
pts = np.array(room["outline"]); mn, mx = pts.min(0), pts.max(0); c = (mn + mx) / 2; z0 = room["z"]
ax = 0 if (mx - mn)[0] > (mx - mn)[1] else 1
if A["end"] in ("C", "D"): ax = 1 - ax   # C / D: across the room (the short axis)
end = 1 if A["end"] in ("A", "C") else -1; back = float(A["back"])
p = c.copy(); p[ax] = (mx[ax] + back) if end > 0 else (mn[ax] - back)
t = c.copy(); t[ax] = mn[ax] if end > 0 else mx[ax]
cd = bpy.data.cameras.new("CAM_PREVIEW"); cd.sensor_fit = "VERTICAL"; cd.angle_y = math.radians(float(A["fov"])); cd.clip_start = back + 0.3
co = bpy.data.objects.new("CAM_PREVIEW", cd); sc.collection.objects.link(co)
co.location = (p[0], p[1], z0 + float(A["eye"]))
co.rotation_euler = (Vector((t[0], t[1], z0 + float(A["eye"]) - 0.25)) - co.location).to_track_quat("-Z", "Y").to_euler()
sc.camera = co
photo = bpy.data.images.load(os.path.abspath(A["photo"]), check_existing=True)
H = int(A["height"]); W = int(round(H * photo.size[0] / photo.size[1]))
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
out_dir = os.path.join(common.REPO, "source", "compare", A["tag"]); os.makedirs(out_dir, exist_ok=True)
name = "%s_%s%s" % (A["room"].replace(".", "") + "_" + A["end"], A["label"] or os.path.splitext(os.path.basename(A["indirect"]))[0], "_lightmap_only" if A["emission_only"] else "")
sc.render.filepath = os.path.join(out_dir, name + ".png")
bpy.ops.render.render(write_still=True)
log("rendered", sc.render.filepath)
