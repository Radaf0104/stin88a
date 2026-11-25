"""01 - Import the Revit export into Blender and check it against the current site geometry.

IFC (default, the geometry source - Revit's FBX has no materials):
  blender -b -P tools/blender/01_import.py -- --ifc source/revit/2026-11-25_WEB_EXPORT.ifc --out source/blender/stin88a_master.blend
FBX (inspection only):
  blender -b -P tools/blender/01_import.py -- --fbx source/revit/X.fbx --inspect [--shell]

Every IFC element becomes one mesh object, in Revit internal coordinates (metres, z up), named
"<category>_<revit id>", with custom properties: revit_id, revit_name, ifc_class, category, storey (+ door_w / door_h for doors).
One Blender material per Revit material (named exactly as in Revit, colour from Revit), per face.
Checks: bounding box against data/geometry.bin (same categories), clear width of room K.305 by ray casting.
Idempotent: always starts from an empty scene and overwrites --out.
"""
import bpy, sys, os, json
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("ifc", None), ("fbx", None), ("inspect", False), ("shell", False), ("out", "source/blender/stin88a_master.blend"),
                 ("report", None), ("room", "K.305")])
log = common.Log("01_import")

# ---- empty scene (data only; never reset preferences, see README) ----
for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.collections, bpy.data.images, bpy.data.cameras, bpy.data.lights):
    for b in list(coll): coll.remove(b)

importer = None
if A["ifc"]:
    sys.path.insert(0, common.PYLIB)
    import ifcopenshell, ifcopenshell.geom, ifcopenshell.util.element as ue
    import multiprocessing
    path = os.path.abspath(A["ifc"]); log("IFC", path)
    f = ifcopenshell.open(path)
    # surface style rendering id -> Revit material name (the geometry iterator only knows the rendering entity)
    style_name = {}
    for s in f.by_type("IfcSurfaceStyle"):
        for r in s.Styles or []: style_name[r.id()] = s.Name
    st = ifcopenshell.geom.settings(); st.set("use-world-coords", True)
    it = ifcopenshell.geom.iterator(st, f, multiprocessing.cpu_count(), exclude=("IfcOpeningElement", "IfcSpace"))
    mats = {}
    def material(name, diffuse, transparency):
        m = mats.get(name)
        if m is None:
            m = bpy.data.materials.new(name)
            c = tuple(diffuse) if diffuse else (0.8, 0.8, 0.8)
            m.diffuse_color = (c[0], c[1], c[2], 1.0 - (transparency or 0.0))
            m.use_nodes = True
            b = m.node_tree.nodes.get("Principled BSDF")
            if b:
                b.inputs["Base Color"].default_value = (c[0], c[1], c[2], 1)
                if transparency: b.inputs["Alpha"].default_value = max(0.15, 1 - transparency)
            m["revit_material"] = name
            mats[name] = m
        return m
    coll = common.collection("IFC_IMPORT")
    n_el = 0
    if it.initialize():
        while True:
            sh = it.get(); g = sh.geometry; el = f.by_id(sh.id)
            v = np.array(g.verts, dtype=np.float64).reshape(-1, 3); fc = np.array(g.faces, dtype=np.int32).reshape(-1, 3)
            if len(fc):
                cat = common.ifc_category(el.is_a(), el.Name, getattr(el, "PredefinedType", None))
                me = bpy.data.meshes.new(f"{cat}_{el.Tag}")
                me.vertices.add(len(v)); me.vertices.foreach_set("co", v.ravel())
                me.loops.add(fc.size); me.loops.foreach_set("vertex_index", fc.ravel())
                me.polygons.add(len(fc)); me.polygons.foreach_set("loop_start", np.arange(0, fc.size, 3, dtype=np.int32))
                # materials per face
                mids = np.array(g.material_ids, dtype=np.int32) if len(g.material_ids) else np.zeros(len(fc), np.int32)
                slot_of = {}
                for mi in np.unique(mids):
                    if mi < 0: name, dif, tr = "Default", None, 0
                    else:
                        gm = g.materials[mi]
                        rid = int(gm.name.split("-")[-1]) if gm.name.split("-")[-1].isdigit() else None
                        name = style_name.get(rid, gm.name)
                        dif = gm.diffuse.components if hasattr(gm.diffuse, "components") else (gm.diffuse if gm.has_diffuse else None)
                        tr = gm.transparency if gm.has_transparency else 0
                    me.materials.append(material(name, dif, tr)); slot_of[int(mi)] = len(me.materials) - 1
                me.polygons.foreach_set("material_index", np.array([slot_of[int(x)] for x in mids], dtype=np.int32))
                me.update(calc_edges=True); me.validate(clean_customdata=False)
                ob = bpy.data.objects.new(me.name, me); coll.objects.link(ob)
                storey = ue.get_container(el)
                ob["revit_id"] = str(el.Tag); ob["revit_name"] = el.Name or ""; ob["ifc_class"] = el.is_a()
                ob["category"] = cat; ob["storey"] = storey.Name if storey else ""
                if el.is_a("IfcDoor"):
                    ob["door_w"] = (el.OverallWidth or 0) / 1000.0; ob["door_h"] = (el.OverallHeight or 0) / 1000.0
                n_el += 1
            if not it.next(): break
    importer = "ifcopenshell %s" % ifcopenshell.version
    log("elements", n_el, "materials", len(mats))
elif A["fbx"]:
    path = os.path.abspath(A["fbx"]); log("FBX", path)
    bpy.ops.import_scene.fbx(filepath=path, use_custom_props=True, use_image_search=False)
    importer = "import_scene.fbx"
else:
    raise SystemExit("give --ifc or --fbx")

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

# ---- counts ----
tris_total, mat_tris, cat_tris, storey_tris = 0, {}, {}, {}
bmin, bmax = np.full(3, 1e9), np.full(3, -1e9)
for o in meshes:
    me = o.data
    n = len(me.polygons)  # IFC faces are triangles
    if A["fbx"]: me.calc_loop_triangles(); n = len(me.loop_triangles)
    tris_total += n
    cat_tris[o.get("category", "?")] = cat_tris.get(o.get("category", "?"), 0) + n
    storey_tris[o.get("storey", "?")] = storey_tris.get(o.get("storey", "?"), 0) + n
    if len(me.polygons):
        mi = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get("material_index", mi)
        for idx, c in zip(*np.unique(mi, return_counts=True)):
            m = me.materials[idx] if idx < len(me.materials) and me.materials[idx] else None
            k = m.name if m else "(none)"; mat_tris[k] = mat_tris.get(k, 0) + int(c)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co)
    if len(co):
        w = co.reshape(-1, 3) @ np.array(o.matrix_world)[:3, :3].T + np.array(o.matrix_world)[:3, 3]
        bmin = np.minimum(bmin, w.min(0)); bmax = np.maximum(bmax, w.max(0))
log("objects", len(meshes), "triangles", tris_total, "materials", len(mat_tris))
log("bbox min", np.round(bmin, 3).tolist(), "max", np.round(bmax, 3).tolist())
log("triangles per category", dict(sorted(cat_tris.items(), key=lambda kv: -kv[1])))
log("triangles per storey", storey_tris)

# ---- reference: the same categories in the site's untouched Revit export (internal coordinates, metres) ----
model = common.model_json()
SHELL = {"Walls", "Floors", "Ceilings", "Columns", "Structural Columns", "Structural Framing", "Curtain Panels", "Curtain Wall Mullions",
         "Doors", "Windows", "Railings", "Stairs", "Runs", "Landings", "Roofs", "Hardscape"}
PLACE = {"Furniture", "Casework", "Plumbing Fixtures", "Lighting Fixtures", "Specialty Equipment", "Communication Devices"}
cats = SHELL if (A["ifc"] or A["shell"]) else PLACE
d = os.path.join(common.REPO, "data")
geo = np.fromfile(os.path.join(d, "geometry.orig.bin" if os.path.exists(os.path.join(d, "geometry.orig.bin")) else "geometry.bin"), dtype=np.float32)
gm = json.load(open(os.path.join(d, "model.orig.json"), encoding="utf8")) if os.path.exists(os.path.join(d, "model.orig.json")) else model
rmin, rmax = np.full(3, 1e9), np.full(3, -1e9)
for g in gm["groups"]:
    if g["category"] not in cats: continue
    p = geo[g["offset"]:g["offset"] + g["count"]].reshape(-1, 3); rmin = np.minimum(rmin, p.min(0)); rmax = np.maximum(rmax, p.max(0))
if cats is PLACE:
    for fx in gm.get("fixtures", []):
        for it_ in fx["instances"]:
            t = np.array(it_["m"][12:15]); rmin = np.minimum(rmin, t); rmax = np.maximum(rmax, t)
ratio = (rmax - rmin) / np.maximum(bmax - bmin, 1e-9)
scale = float(np.median(ratio))
for s in (1.0, 0.3048, 0.01, 0.001):
    if abs(scale / s - 1) < 0.02: scale = s; break
offset = rmin - bmin * scale
log("reference min", np.round(rmin, 3).tolist(), "max", np.round(rmax, 3).tolist())
log("scale to metres %.5f, offset %s m" % (scale, np.round(offset, 4).tolist()))

# ---- room check: clear width of a room by ray casting vs the Revit room outline ----
room_check = None
r = next((x for x in model["rooms"] if x["name"].strip() == A["room"]), None)
if r and cats is SHELL:
    dg = bpy.context.evaluated_depsgraph_get()
    pts = np.array(r["outline"]); c = pts.mean(0); z = r["z"] + 1.0
    origin = Vector(((c[0] - offset[0]) / scale, (c[1] - offset[1]) / scale, (z - offset[2]) / scale))
    room_check = {"room": A["room"]}
    for ax in (0, 1):
        dist = []
        for sgn in (1, -1):
            dv = Vector((0, 0, 0)); dv[ax] = sgn
            ok, loc, *_ = bpy.context.scene.ray_cast(dg, origin, dv)
            dist.append((loc - origin).length * scale if ok else None)
        xs = []
        for i in range(len(pts)):
            p0, p1 = pts[i], pts[(i + 1) % len(pts)]; o_ = 1 - ax
            if (p0[o_] - c[o_]) * (p1[o_] - c[o_]) <= 0 and p0[o_] != p1[o_]:
                t = (c[o_] - p0[o_]) / (p1[o_] - p0[o_]); xs.append(p0[ax] + t * (p1[ax] - p0[ax]))
        room_check["xy"[ax]] = {"measured_m": round(sum(dist), 3) if None not in dist else None, "revit_outline_m": round(max(xs) - min(xs), 3) if len(xs) > 1 else None}
    log("room check", json.dumps(room_check))

report = {"source": os.path.basename(path), "importer": importer, "objects": len(meshes), "triangles": tris_total,
          "per_category": cat_tris, "per_storey": storey_tris, "materials": dict(sorted(mat_tris.items(), key=lambda kv: -kv[1])),
          "bbox": {"min": bmin.tolist(), "max": bmax.tolist()}, "reference": {"min": rmin.tolist(), "max": rmax.tolist()},
          "scale_to_m": scale, "offset_m": offset.tolist(), "room_check": room_check}
if A["report"]:
    os.makedirs(os.path.dirname(os.path.abspath(A["report"])), exist_ok=True)
    json.dump(report, open(A["report"], "w"), indent=1); log("report", A["report"])

if not A["inspect"]:
    if abs(scale - 1) > 1e-6 or np.abs(offset).max() > 0.01:
        raise SystemExit("coordinates differ from the site (scale %.5f, offset %s): stopping, see the log" % (scale, offset))
    os.makedirs(os.path.dirname(os.path.abspath(A["out"])), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
    log("saved", A["out"])
