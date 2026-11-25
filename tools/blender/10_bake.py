"""10 - Bake a lightmap set with Cycles: indirect (bounced) light + ambient occlusion, then denoise.

  blender -b source/blender/stin88a_09_lights.blend -P tools/blender/10_bake.py -- --set LM_K305 --samples 128 --sun on

* Target = every mesh whose "lm_set" is --set, baked into its UVMap_LM; everything else stays in the scene so light
  bounces off the whole building.
* Indirect: bake type DIFFUSE, pass filter INDIRECT only (no direct light, no surface colour) -> float EXR.
  --sun on: the sun lamp's light bounces in (its *direct* light still comes from the website's live sun);
  --sun off: sky + room lamps only (the brief's setting).
* AO: bake type AO, distance 1.0 m.
* Margin 16 px, max bounces 6, GPU if one is found (OptiX, then CUDA), else CPU.
* Denoise: Cycles does not denoise bakes, so a second pass runs the EXR through OpenImageDenoise (the compositor's
  Denoise node, built in). Raw and denoised EXRs go to source/bakes/. The temporary image nodes are removed again.
"""
import bpy, sys, os, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("set", "LM_K305"), ("samples", "128"), ("ao-samples", "128"), ("size", "2048"), ("bounces", "6"),
                 ("sun", "on"), ("skip-ao", False), ("time", "day")])
log = common.Log("10_bake")
sc = bpy.context.scene
OUT = os.path.join(common.REPO, "source", "bakes"); os.makedirs(OUT, exist_ok=True)
SIZE = int(A["size"])

# ---- Cycles, GPU ----
sc.render.engine = "CYCLES"
dev = "CPU"
try:
    cp = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            cp.compute_device_type = kind; cp.get_devices()
            gpus = [d for d in cp.devices if d.type == kind]
            if gpus:
                for d in cp.devices: d.use = d.type == kind
                sc.cycles.device = "GPU"; dev = "%s (%s)" % (kind, ", ".join(d.name for d in gpus)); break
        except TypeError: continue
except Exception as ex: log("GPU setup failed, using CPU:", ex)
log("device:", dev)
sc.cycles.samples = int(A["samples"]); sc.cycles.max_bounces = int(A["bounces"])
sc.cycles.diffuse_bounces = int(A["bounces"]); sc.cycles.glossy_bounces = 2; sc.cycles.transmission_bounces = 4
sc.cycles.use_denoising = False
sc.render.bake.margin = 16; sc.render.bake.use_clear = True; sc.render.bake.target = "IMAGE_TEXTURES"
sun = bpy.data.objects.get("BAKE_SUN")
if sun: sun.hide_render = A["sun"] != "on"
if sc.world: sc.world.light_settings.distance = 1.0  # AO distance

targets = [o for o in bpy.data.objects if o.type == "MESH" and o.get("lm_set") == A["set"] and o.data.uv_layers.get("UVMap_LM")]
if not targets: raise SystemExit("no meshes in lightmap set %s" % A["set"])
for o in targets: o.data.uv_layers.active = o.data.uv_layers["UVMap_LM"]
tris = sum(len(o.data.polygons) for o in targets)
log("set %s: %d meshes, %d faces, %d px, sun %s" % (A["set"], len(targets), tris, SIZE, A["sun"]))

def bake(kind, samples, name):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=True)
    added = []
    for m in {m for o in targets for m in o.data.materials if m}:
        if not m.use_nodes: m.use_nodes = True
        n = m.node_tree.nodes.new("ShaderNodeTexImage"); n.image = img; n.name = "_BAKE_TARGET"
        m.node_tree.nodes.active = n; added.append((m, n))
    vl = bpy.context.view_layer
    for o in vl.objects: o.select_set(False)
    for o in targets: o.select_set(True)
    vl.objects.active = targets[0]
    sc.cycles.samples = samples
    t0 = time.time()
    if kind == "INDIRECT":
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"INDIRECT"}, margin=16, use_clear=True)
    else:
        bpy.ops.object.bake(type="AO", margin=16, use_clear=True)
    dt = time.time() - t0
    path = os.path.join(OUT, name + ".exr")
    img.filepath_raw = path; img.file_format = "OPEN_EXR"; img.save()
    for m, n in added: m.node_tree.nodes.remove(n)
    px = np.empty(SIZE * SIZE * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(-1, 4)[:, :3]
    lit = px[px.max(1) > 0]
    log("%s baked in %.0f s (%d samples) -> %s; non-empty texels %.0f %%, median %.3f, 99th pct %.3f" % (
        kind, dt, samples, os.path.basename(path), 100 * len(lit) / len(px), float(np.median(lit)) if len(lit) else 0, float(np.percentile(lit, 99)) if len(lit) else 0))
    return path, dt

def denoise(path):
    """OpenImageDenoise through the compositor (Denoise node), written as <name>_dn.exr"""
    out = path.replace(".exr", "_dn.exr")
    img = bpy.data.images.load(path, check_existing=False)
    s = bpy.data.scenes.new("denoise"); s.render.resolution_x, s.render.resolution_y = img.size; s.render.resolution_percentage = 100
    s.render.image_settings.file_format = "OPEN_EXR"; s.render.image_settings.color_depth = "32"
    s.render.engine = "BLENDER_WORKBENCH"
    cam = bpy.data.objects.new("dn_cam", bpy.data.cameras.new("dn_cam")); s.collection.objects.link(cam); s.camera = cam
    try:  # Blender 5: the compositor is a node group assigned to the scene
        tree = bpy.data.node_groups.new("denoise", "CompositorNodeTree")
        s.compositing_node_group = tree
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        go = tree.nodes.new("NodeGroupOutput")
    except AttributeError:  # older API
        s.use_nodes = True; tree = s.node_tree
        for n in list(tree.nodes): tree.nodes.remove(n)
        go = tree.nodes.new("CompositorNodeComposite")
    inode = tree.nodes.new("CompositorNodeImage"); inode.image = img
    dn = tree.nodes.new("CompositorNodeDenoise")
    try: dn.prefilter = "ACCURATE"
    except Exception: pass
    tree.links.new(inode.outputs["Image"], dn.inputs["Image"])
    tree.links.new(dn.outputs["Image"], go.inputs[0])
    s.render.use_compositing = True; s.render.use_sequencer = False
    s.render.filepath = out
    with bpy.context.temp_override(scene=s):
        bpy.ops.render.render(write_still=True, scene=s.name)
    bpy.data.scenes.remove(s)
    log("denoised ->", os.path.basename(out), "exists" if os.path.exists(out) else "MISSING")
    return out

tag = "%s_%s%s" % (A["set"], "" if A["time"] == "day" else A["time"] + "_", "sun" if A["sun"] == "on" else "nosun")
p_ind, t_ind = bake("INDIRECT", int(A["samples"]), tag + "_indirect")
try: denoise(p_ind)
except Exception as ex: log("denoise failed:", ex)
if not A["skip_ao"]:
    p_ao, t_ao = bake("AO", int(A["ao_samples"]), A["set"] + "_ao")
    try: denoise(p_ao)
    except Exception as ex: log("denoise failed:", ex)
log("done")
