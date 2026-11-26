"""06s - Style rooms: keep a few rooms as separate, addressable objects so the website can restyle and animate them.

  blender -b source/blender/stin88a_06c_coplanar.blend -P tools/blender/06s_style_rooms.py --
          --rooms K.401,K.405,K.407,K.413,K.416 --out source/blender/stin88a_06s_styled.blend

Client brief (2026-11-26): re-texture these rooms and make their furniture / doors interactive, as templates, WITHOUT
changing any geometry. So nothing is moved, resized or rebuilt here:
* the room's own wall / floor / ceiling faces (inside its outline grown by 6 cm - the room-facing finish only, not the neighbour's side - from the floor to 3.3 m up) are
  split off the level's shell meshes into objects of their own - the same faces, same vertices, same materials;
  each piece gets  style_room = <room>  and  surface = floor | ceiling | wall  (from the face normal);
* the room's furniture, fittings and dressing (objects with room = <room> or "KM <room>") get  style_room  too.
tools/pack-levels.mjs leaves every node with a style_room out of the per-material merge, so on the website each of
these rooms is a set of separate meshes (js/roomstyle.js gives them their own materials and interactions).
Run after 06c (so the coplanar fixes are already in the faces) and before 07. Idempotent.
"""
import bpy, bmesh, sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("rooms", "K.401,K.405,K.407,K.413,K.416"), ("out", "source/blender/stin88a_06s_styled.blend")])
log = common.Log("06s_style")
model = common.model_json()
LEVELS = ["L0", "L1", "L2", "L3", "L4", "ROOF"]
SHELL = ("shell", "ceiling")

def in_poly(x, y, pts):
    c = False
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
    return c
def poly_grow(pts, d):
    c = np.mean(pts, 0); return [tuple(c + (np.array(p) - c) * (1 + d / max(1e-6, np.linalg.norm(np.array(p) - c)))) for p in pts]

for label in [r.strip() for r in A["rooms"].split(",") if r.strip()]:
    rooms = [r for r in model["rooms"] if r["name"].strip() in (label, "KM " + label)]
    if not rooms: log("no Revit room", label); continue
    z0 = rooms[0]["z"]; outlines = [poly_grow(r["outline"], 0.06) for r in rooms]  # room outlines sit on the finish faces: 6 cm keeps the neighbour's side out
    inside = lambda p: z0 - 0.2 <= p.z <= z0 + 3.3 and any(in_poly(p.x, p.y, o) for o in outlines)
    # the en-suite ("KM <room>") is told apart, so its floor / walls get the bathroom finishes on the website
    baths = [poly_grow(r["outline"], 0.06) for r in rooms if r["name"].strip().startswith("KM ")]
    in_bath = lambda p: any(in_poly(p.x, p.y, o) for o in baths)
    if any(o.get("style_room") == label and o.get("kind") in SHELL for o in bpy.data.objects):
        log(label, "already split"); continue
    split = tagged = 0
    for L in LEVELS:
        col = bpy.data.collections.get(L)
        if not col: continue
        for o in list(col.objects):
            if o.type != "MESH": continue
            if o.get("kind") in SHELL and not o.get("style_room"):
                if o.matrix_world != o.matrix_world.Identity(4): continue
                me = o.data
                for surface in ("floor", "ceiling", "wall", "bathfloor", "bathwall"):
                    def want(p):
                        n = p.normal; c = o.matrix_world @ p.center
                        s = "floor" if n.z > 0.7 else "ceiling" if n.z < -0.7 else "wall"
                        if s != "ceiling" and in_bath(c): s = "bath" + s
                        return s == surface and inside(c)
                    sel = [p.index for p in me.polygons if want(p)]
                    if not sel: continue
                    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
                    pb = bm.copy(); pb.faces.ensure_lookup_table(); keep = set(sel)
                    bmesh.ops.delete(pb, geom=[f for f in pb.faces if f.index not in keep], context="FACES")
                    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in sel], context="FACES")
                    bm.to_mesh(me); bm.free()
                    pm = bpy.data.meshes.new("%s_%s_%s" % (L, label, surface)); pb.to_mesh(pm); pb.free()
                    for m in me.materials: pm.materials.append(m)
                    po = bpy.data.objects.new("%s_%s_%s_%s" % (L, label.replace(".", ""), surface, o.name.split("_", 1)[-1]), pm)
                    for k in o.keys(): po[k] = o[k]
                    po["style_room"] = label; po["surface"] = surface; po["room"] = label
                    col.objects.link(po); split += 1
            elif o.get("room", "") in (label, "KM " + label):
                o["style_room"] = label; tagged += 1
    log("%s: %d shell pieces split off (no vertex moved), %d furniture / fitting objects tagged" % (label, split, tagged))

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"])
