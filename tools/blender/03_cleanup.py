"""03 - Geometry clean-up, per object.

  blender -b source/blender/stin88a_02_levels.blend -P tools/blender/03_cleanup.py -- --out source/blender/stin88a_03_cleanup.blend

1. merge by distance (0.1 mm), dissolve zero-area faces / zero-length edges, delete loose verts & edges,
   remove duplicate faces, recalculate normals outward
2. hidden contact faces: a face of a wall / slab / column / beam / roof / ceiling that lies flat against another
   element (5 sample points, each finds another element's face within 3 mm, facing the other way) can never be seen
   and is deleted (e.g. the bottom of a wall standing on a slab)
3. single elements over --max-tris triangles are decimated (collapse) to that budget (the FAKRO roof hatch is 48k)
4. normals: sharp edges above 30 deg, smooth shading; walls, slabs, columns, roofs, beams get a 8 mm / 2-segment bevel
   on edges above 30 deg with hardened normals + weighted normals (glass, doors, windows, railings, mullions and parts
   smaller than 0.3 m are not bevelled). Modifiers are applied.
The facade: the vertical teak slats are the Revit mullions and the horizontal ribbing is "Brick Gap" - both are already
real geometry in the IFC, so no batten rebuild is done here (see the Gate 2 report).
Idempotent: reads the 02 output and writes a new file.
"""
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("out", "source/blender/stin88a_03_cleanup.blend"), ("max-tris", "5000"), ("no-bevel", False),
                 ("bevel-segments", "1"), ("dissolve-deg", "1.0")])
log = common.Log("03_cleanup")
MAXT = int(A["max_tris"]); SEG = int(A["bevel_segments"]); DISSOLVE = float(A["dissolve_deg"])
objs = [o for o in bpy.data.objects if o.type == "MESH"]
tri0 = common.tri_count(objs)

# ---- 1. per-object clean-up ----
st = {"verts_merged": 0, "dup_faces": 0, "loose": 0}
for o in objs:
    bm = bmesh.new(); bm.from_mesh(o.data)
    nv = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    st["verts_merged"] += nv - len(bm.verts)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-5)
    # the IFC splits every flat face into triangles: merge coplanar ones back into one face (never across materials)
    if DISSOLVE > 0:
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(DISSOLVE), use_dissolve_boundaries=False,
                                 verts=bm.verts, edges=bm.edges, delimit={"MATERIAL"})
    seen, dup = set(), []
    for f in bm.faces:
        k = tuple(sorted(v.index for v in f.verts))
        if k in seen: dup.append(f)
        else: seen.add(k)
    if dup: bmesh.ops.delete(bm, geom=dup, context="FACES_ONLY"); st["dup_faces"] += len(dup)
    loose_e = [e for e in bm.edges if not e.link_faces]
    if loose_e: bmesh.ops.delete(bm, geom=loose_e, context="EDGES"); st["loose"] += len(loose_e)
    loose_v = [v for v in bm.verts if not v.link_faces]
    if loose_v: bmesh.ops.delete(bm, geom=loose_v, context="VERTS"); st["loose"] += len(loose_v)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data); bm.free()
log("1. merged %(verts_merged)d verts, removed %(dup_faces)d duplicate faces, %(loose)d loose verts/edges" % st)

# ---- 2. hidden contact faces between structural elements ----
STRUCT = {"Walls", "Floors", "Columns", "Structural Columns", "Structural Framing", "Roofs", "Ceilings", "Landings"}
sobj = [o for o in objs if o.get("category") in STRUCT and len(o.data.polygons)]
verts, tris, owner = [], [], []
off = 0
for oi, o in enumerate(sobj):
    me = o.data; me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    mw = np.array(o.matrix_world); co = co @ mw[:3, :3].T + mw[:3, 3]
    lt = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get("vertices", lt)
    verts.append(co); tris.append(lt.reshape(-1, 3) + off); owner.append(np.full(len(me.loop_triangles), oi)); off += len(co)
V = np.concatenate(verts); T = np.concatenate(tris); OWN = np.concatenate(owner)
bvh = BVHTree.FromPolygons(V.tolist(), T.tolist(), all_triangles=True, epsilon=0.0)
log("2. BVH over %d structural elements, %d triangles" % (len(sobj), len(T)))
hidden_total, hidden_area = 0, 0.0
for oi, o in enumerate(sobj):
    me = o.data
    mw = o.matrix_world; nm = mw.to_3x3().inverted().transposed()
    kill = []
    for p in me.polygons:
        if p.area < 0.002: continue
        n = (nm @ p.normal).normalized(); c = mw @ p.center
        pts = [c] + [c.lerp(mw @ me.vertices[v].co, 0.8) for v in p.vertices]
        ok = True
        for q in pts:
            loc, hn, idx, d = bvh.ray_cast(q + n * 0.0005, n, 0.003)
            if idx is None or OWN[idx] == oi or hn.dot(n) > -0.9: ok = False; break
        if ok: kill.append(p.index); hidden_area += p.area
    if kill:
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context="FACES")
        bm.to_mesh(me); bm.free(); hidden_total += len(kill)
log("2. deleted %d hidden contact faces (%.0f m2)" % (hidden_total, hidden_area))

# ---- 3. over-budget single elements ----
heavy = [(o, sum(len(p.vertices) - 2 for p in o.data.polygons)) for o in objs]
heavy = [(o, n) for o, n in heavy if n > MAXT]
def apply_mods(o, update=True):
    dg = bpy.context.evaluated_depsgraph_get()
    if update: dg.update()
    oe = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(oe, preserve_all_data_layers=True, depsgraph=dg)
    old = o.data; o.modifiers.clear(); o.data = me; me.name = old.name
    if old.users == 0: bpy.data.meshes.remove(old)
for o, n in heavy:
    m = o.modifiers.new("decimate", "DECIMATE"); m.decimate_type = "COLLAPSE"; m.ratio = MAXT / n
    apply_mods(o)
    log("3. decimated %s (%s) %d -> %d triangles" % (o.name, o.get("revit_name", "")[:50], n, sum(len(p.vertices) - 2 for p in o.data.polygons)))

# ---- 4. mark which elements get the bevel (applied in 04 on the joined meshes: per-object modifiers on ~9,600
#         objects were far too slow); smooth shading + sharp edges above 30 deg come with the bevel there ----
BEVEL = {"Walls", "Floors", "Columns", "Structural Columns", "Roofs", "Structural Framing", "Landings"}
nb, added = 0, 0
for i, o in enumerate(objs):
    me = o.data
    if not len(me.polygons): continue
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    small = np.linalg.norm(co.max(0) - co.min(0)) < 0.3
    o["bevel"] = bool(not A["no_bevel"] and o.get("category") in BEVEL and not small)
    if not o["bevel"]: continue
    # bevel this element alone (a bevel over the joined level meshes made spikes where elements touch)
    t0 = sum(len(p.vertices) - 2 for p in me.polygons)
    bm = bmesh.new(); bm.from_mesh(me)
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(30)]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=0.008, offset_type="OFFSET", segments=SEG, profile=0.5, affect="EDGES", clamp_overlap=True)
        bm.to_mesh(me)
    bm.free()
    added += sum(len(p.vertices) - 2 for p in me.polygons) - t0; nb += 1
log("4. bevelled %d elements (8 mm, %d segment(s), edges > 30 deg): +%d triangles" % (nb, SEG, added))

# ---- report ----
tri1 = common.tri_count(objs)
log("triangles %d -> %d" % (tri0, tri1))
for name in ["L0", "L1", "L2", "L3", "L4", "ROOF", "SITE"]:
    c = bpy.data.collections.get(name)
    if c: log("%-4s triangles %7d" % (name, common.tri_count(c.objects)))
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"])
