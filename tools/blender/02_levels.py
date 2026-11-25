"""02 - Sort every object into a level collection: L0, L1, L2, L3, L4, ROOF, SITE.

  blender -b source/blender/stin88a_master.blend -P tools/blender/02_levels.py -- --out source/blender/stin88a_02_levels.blend

Level bands (common.level_bands): each level runs from 0.16 m under its floor level (the slab underside, so a floor slab
belongs to the level you stand on) to 0.16 m under the next one. L0 = below Level 1's slab, ROOF = above the roof slab
underside, SITE = Hardscape.
  * Tall vertical elements (walls, columns, mullions, panels, stair runs, railings, windows > 1 m high) that cross a band
    edge are cut there (bmesh bisect, no fill: the floor cut and the stencil caps don't need closed pieces).
  * Everything else goes whole to the band its middle lies in (so beams hang in the level below their top).
Objects are renamed "<LEVEL>_<category>_<revit id>[_<n>]" and get a "level" property.
Idempotent: reads the 01 output and writes a new file.
"""
import bpy, bmesh, sys, os
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("out", "source/blender/stin88a_02_levels.blend")])
log = common.Log("02_levels")
bands = common.level_bands()
edges = sorted({b[1] for b in bands if b[1] > -1e8})
VERTICAL = {"Walls", "Columns", "Structural Columns", "Curtain Wall Mullions", "Curtain Panels", "Runs", "Railings", "Windows"}

cols = {name: common.collection(name) for name in ["L0", "L1", "L2", "L3", "L4", "ROOF", "SITE"]}
def band_of(z):
    for name, lo, hi in bands:
        if lo <= z < hi: return name
    return "ROOF"

src = [o for o in bpy.data.objects if o.type == "MESH"]
n_split, n_pieces = 0, 0
moved = {k: 0 for k in cols}
for o in src:
    cat = o.get("category", "")
    co = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    z0, z1 = co[:, 2].min(), co[:, 2].max()
    if cat == "Hardscape":
        targets = [("SITE", o)]
    else:
        crossing = [e for e in edges if z0 < e - 0.005 and z1 > e + 0.005]
        if crossing and cat in VERTICAL and z1 - z0 > 1.0:
            # cut at every band edge it crosses, then split the faces by band
            bm = bmesh.new(); bm.from_mesh(o.data)
            for e in crossing:
                geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
                bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=(0, 0, e), plane_no=(0, 0, 1))
            groups = {}
            for f in bm.faces: groups.setdefault(band_of(f.calc_center_median().z), []).append(f.index)
            targets = []
            for k, (bname, idx) in enumerate(sorted(groups.items())):
                piece = bm.copy()
                keep = set(idx)
                bmesh.ops.delete(piece, geom=[f for f in piece.faces if f.index not in keep], context="FACES")
                me = bpy.data.meshes.new(o.data.name + "_%d" % k)
                piece.to_mesh(me); piece.free()
                for m in o.data.materials: me.materials.append(m)
                ob = bpy.data.objects.new(me.name, me)
                for key in o.keys(): ob[key] = o[key]
                targets.append((bname, ob))
            bm.free()
            n_split += 1; n_pieces += len(targets)
            bpy.data.objects.remove(o)
        else:
            targets = [(band_of((z0 + z1) / 2), o)]
    for k, (bname, ob) in enumerate(targets):
        for c in list(ob.users_collection): c.objects.unlink(ob)
        cols[bname].objects.link(ob)
        ob["level"] = bname
        ob.name = "%s_%s_%s%s" % (bname, ob.get("category", "x").replace(" ", ""), ob.get("revit_id", "0"), "_%d" % k if len(targets) > 1 else "")
        moved[bname] += 1

imp = bpy.data.collections.get("IFC_IMPORT")
if imp and not imp.objects: bpy.data.collections.remove(imp)
log("split %d tall elements into %d pieces" % (n_split, n_pieces))
total = 0
for name, c in cols.items():
    t = common.tri_count(c.objects); total += t
    log("%-4s objects %5d  triangles %7d" % (name, len(c.objects), t))
log("total triangles", total)
os.makedirs(os.path.dirname(os.path.abspath(A["out"])), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"])
