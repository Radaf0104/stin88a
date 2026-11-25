"""04 - Per level: clean material names, door leaves split off (hinge = origin), everything else joined by kind + material.

  blender -b source/blender/stin88a_03_cleanup.blend -P tools/blender/04_join.py -- --out source/blender/stin88a_04_join.blend

* Materials: every Revit material is replaced by its clean material from material_map.json (M_plaster_cream, ...).
  The clean material keeps the list of Revit names it stands for ("revit_materials").
* Doors (as in js/spaces.js): the leaf = faces inside the frame (0.06 m in from the jambs, 0.07 m under the head);
  each leaf becomes its own object "<L>_door_<revit id>" with its origin on the hinge (one jamb end, mid-thickness,
  floor), properties door_width / door_slide (glass leaf) / revit_id. The frame stays with the other door parts.
* Kinds kept apart (the site needs them separately): ceiling, stair (Runs, Landings), railing, doorframe; the rest is
  "shell". Each kind is split by material: one mesh per (level, kind, material), named "<L>_[<kind>_]<material>".
  Glass, frosted glass and water are separate materials, so they end up as separate meshes too.
* Properties on every joined mesh: level, kind, categories (Revit categories inside), collide (walk mode).
Idempotent: reads the 03 output and writes a new file.
"""
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("out", "source/blender/stin88a_04_join.blend"), ("no-bevel", False)])
log = common.Log("04_join")
mmap = common.material_map()
LEVELS = ["L0", "L1", "L2", "L3", "L4", "ROOF", "SITE"]

# ---- clean materials ----
clean = {}
unmapped = set()
def clean_mat(m):
    name = common.clean_material(m.name, mmap) if m else "M_default"
    if name is None: name = "M_drop"
    if name.startswith("M_rv_"): unmapped.add(m.name)
    cm = clean.get(name)
    if cm is None:
        cm = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        if m:
            cm.diffuse_color = m.diffuse_color
            cm.use_nodes = True
            b = cm.node_tree.nodes.get("Principled BSDF"); sb = m.node_tree.nodes.get("Principled BSDF") if m.use_nodes else None
            if b and sb:
                b.inputs["Base Color"].default_value = sb.inputs["Base Color"].default_value
                b.inputs["Alpha"].default_value = sb.inputs["Alpha"].default_value
        cm["revit_materials"] = []
        clean[name] = cm
    if m and m.name not in cm["revit_materials"]: cm["revit_materials"] = list(cm["revit_materials"]) + [m.name]
    return cm
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    for i, m in enumerate(o.data.materials): o.data.materials[i] = clean_mat(m)
for m in [m for m in bpy.data.materials if m.name not in clean and m.users == 0]: bpy.data.materials.remove(m)
log("clean materials", len(clean), "unmapped Revit names:", sorted(unmapped) or "none")

# ---- door leaves ----
def split_door(o):
    me = o.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    mn, mx = co.min(0), co.max(0); d = mx - mn
    thin, wide = (0, 1) if d[0] < d[1] else (1, 0)
    if d[2] < 1.7 or d[2] > 3.2 or d[wide] < 0.5 or d[wide] > 3.2 or d[thin] > 0.5: return None
    leaf = []
    for p in me.polygons:
        vs = co[list(p.vertices)]; c = vs.mean(0)
        if mn[wide] + 0.06 < c[wide] < mx[wide] - 0.06 and mn[2] + 0.02 < c[2] < mx[2] - 0.07 and vs[:, 2].max() < mx[2] - 0.04: leaf.append(p.index)
    if len(leaf) < 2: return None
    glass = sum(me.polygons[i].area for i in leaf if "glass" in (me.materials[me.polygons[i].material_index].name.lower()))
    area = sum(me.polygons[i].area for i in leaf)
    hinge = Vector((0, 0, 0)); hinge[wide] = mn[wide] + 0.03; hinge[thin] = (mn[thin] + mx[thin]) / 2; hinge.z = mn[2]
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    lb = bm.copy(); lb.faces.ensure_lookup_table()
    keep = set(leaf)
    bmesh.ops.delete(lb, geom=[f for f in lb.faces if f.index not in keep], context="FACES")
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in leaf], context="FACES")
    bm.to_mesh(me); bm.free()
    lme = bpy.data.meshes.new("door_leaf"); lb.to_mesh(lme); lb.free()
    for m in me.materials: lme.materials.append(m)
    lme.transform(Matrix.Translation(-hinge))
    lo = bpy.data.objects.new("%s_door_%s" % (o["level"], o["revit_id"]), lme)
    lo.location = hinge
    for k in ("revit_id", "revit_name", "storey", "level"): lo[k] = o[k]
    lo["category"] = "Doors"; lo["kind"] = "door"; lo["collide"] = False
    lo["door_width"] = float(d[wide]); lo["door_height"] = float(d[2]); lo["door_slide"] = bool(glass > 0.4 * area)
    lo["door_wide_axis"] = "xy"[wide]
    for c in o.users_collection: c.objects.link(lo)
    return lo
n_leaf = n_notdoor = 0
for o in [o for o in bpy.data.objects if o.type == "MESH" and o.get("category") == "Doors"]:
    if split_door(o): n_leaf += 1
    else: n_notdoor += 1
log("door leaves split off: %d (doors not matching the leaf rule, kept whole: %d)" % (n_leaf, n_notdoor))

# ---- join per level / kind, then one mesh per material ----
def kind_of(o):
    c = o.get("category", "")
    if c == "Ceilings": return "ceiling"
    if c in ("Runs", "Landings", "Stairs"): return "stair"
    if c == "Railings": return "railing"
    if c == "Doors": return "doorframe"
    return "shell"
def join(objs):
    first = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=first, object=first, selected_objects=objs, selected_editable_objects=objs):
            bpy.ops.object.join()
    return first
def apply_mods(o):
    dg = bpy.context.evaluated_depsgraph_get(); dg.update()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = o.data; o.modifiers.clear(); o.data = me
    if old.users == 0: bpy.data.meshes.remove(old)
stats, stats_bevel = {}, {}
for L in LEVELS:
    col = bpy.data.collections.get(L)
    if not col: continue
    groups = {}
    for o in list(col.objects):
        if o.type != "MESH" or o.get("kind") == "door": continue
        groups.setdefault(kind_of(o), []).append(o)
    for kind, objs in groups.items():
        cats = sorted({o.get("category", "") for o in objs})
        bev = [o for o in objs if o.get("bevel") and not A["no_bevel"]]
        rest = [o for o in objs if o not in bev]
        if bev:  # walls / slabs / columns / beams / roofs, bevelled per element in 03: weighted normals keep the big
                 # faces flat and the 8 mm bevels soft
            b0 = join(bev)
            b0.data.shade_smooth(); b0.data.set_sharp_from_angle(angle=math.radians(30))
            w = b0.modifiers.new("wnormal", "WEIGHTED_NORMAL"); w.keep_sharp = True; w.weight = 50; w.mode = "FACE_AREA"
            apply_mods(b0)
        if rest:  # everything else: smooth shading with sharp edges above 30 deg (round rails stay round, boxes stay crisp)
            r0 = join(rest); r0.data.shade_smooth(); r0.data.set_sharp_from_angle(angle=math.radians(30))
            rest = [r0]
        joined = join(([b0] if bev else []) + rest)
        me = joined.data
        # one object per material
        for mi, mat in enumerate(list(me.materials)):
            if mat is None or mat.name == "M_drop": continue
            bm = bmesh.new(); bm.from_mesh(me)
            dele = [f for f in bm.faces if f.material_index != mi]
            if len(dele) == len(bm.faces): bm.free(); continue
            bmesh.ops.delete(bm, geom=dele, context="FACES")
            for f in bm.faces: f.material_index = 0
            nme = bpy.data.meshes.new("tmp"); bm.to_mesh(nme); bm.free()
            nme.materials.append(mat)
            nm = mat.name[2:] if mat.name.startswith("M_") else mat.name
            ob = bpy.data.objects.new("%s_%s%s" % (L, "" if kind == "shell" else kind + "_", nm), nme)
            nme.name = ob.name
            ob["level"] = L; ob["kind"] = kind; ob["categories"] = cats; ob["collide"] = kind != "doorframe"
            col.objects.link(ob)
        bpy.data.objects.remove(joined)
    objs = [o for o in col.objects if o.type == "MESH"]
    stats[L] = (len(objs), sum(1 for o in objs if o.get("kind") == "door"), common.tri_count(objs))
for m in [m for m in bpy.data.meshes if m.users == 0]: bpy.data.meshes.remove(m)

total = 0
for L, (n, nd, t) in stats.items():
    total += t
    log("%-4s meshes %3d (%3d door leaves + %3d joined)  triangles %7d" % (L, n, nd, n - nd, t))
log("total triangles", total)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"])
