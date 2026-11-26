"""06c - Surfaces that lie in the same plane and face the same way (two materials in one place: they flicker, "z-fighting").

  blender -b source/blender/stin88a_06b_dressed.blend -P tools/blender/06c_coplanar.py -- --out source/blender/stin88a_06c_coplanar.blend

Revit exports many finishes flush with each other: a door frame head flush with the plaster soffit, the sliding-door
track flush with its frame, a concrete column face flush with the plaster of the same wall, joinery backs flush with a
wall cladding. Only faces that are axis-aligned, face the same direction, lie within 3 mm of each other and really
overlap (points sampled on the smaller face fall inside the other) count.

Fix: the face behind is moved back 3 mm (against its own normal), after being split from its neighbours so nothing
else moves:
* structure (shell / ceiling / stair / doorframe meshes) against a fitting (door leaf, joinery, furniture): the
  structure face goes back - the fitting stays exactly where Revit put it (fittings share one mesh between rooms);
* structure against structure: the lower one in FRONT goes back (trim > metal > timber > plaster > concrete).
Fitting against fitting: the one later in name order goes back. Exact duplicates (same mesh, same place) are removed.
Runs in passes until nothing overlaps (three surfaces in one plane: the ones behind step back 3 / 6 mm).
"""
import bpy, bmesh, sys, os, collections
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("out", "source/blender/stin88a_06c_coplanar.blend"), ("tol", "0.003"), ("push", "0.003")])
log = common.Log("06c_coplanar")

# ---- exact duplicates first: Revit sometimes holds the same element twice (two beds / two toilets in K.316) ----
def sig(o):
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return (o.data.name if o.data else "", len(o.data.vertices), tuple(round(min(v[i] for v in bb), 2) for i in range(3)),
            tuple(round(max(v[i] for v in bb), 2) for i in range(3)))
seen, dups = {}, []
for o in sorted([o for o in bpy.data.objects if o.type == "MESH" and o.get("kind") not in ("shell", "ceiling", "stair", "doorframe", "railing")],
                key=lambda o: o.name):
    s = sig(o)
    if s in seen: dups.append((o.name, seen[s]))
    else: seen[s] = o.name
for name, keep in dups: bpy.data.objects.remove(bpy.data.objects[name])
log("exact duplicates removed: %d %s" % (len(dups), [n for n, _ in dups][:12]))
TOL, PUSH = float(A["tol"]), float(A["push"])
STRUCT = {"shell", "ceiling", "stair", "doorframe", "railing"}
FRONT = ["M_plastic_white", "M_metal_brushed", "M_metal_grey", "M_metal_dark", "M_chrome", "M_wood_light", "M_teak_timber",
         "M_teak_batten", "M_teak_deck", "M_tile_wall", "M_tile_floor", "M_stone_marble", "M_plaster_cream", "M_plaster_grey",
         "M_concrete", "M_site_paving"]
def rank(mat): return FRONT.index(mat) if mat in FRONT else len(FRONT)

def inside(pt, poly):
    c = False; n = len(poly)
    for i in range(n):
        (xi, yi), (xj, yj) = poly[i], poly[i - 1]
        if (yi > pt[1]) != (yj > pt[1]) and pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi: c = not c
    return c
def samples(poly, k=5):
    """points spread over a polygon (fan triangles, barycentric grid)"""
    out = []
    for t in range(1, len(poly) - 1):
        a, b, c = poly[0], poly[t], poly[t + 1]
        for u in range(1, k):
            for v in range(1, k - u):
                w = 1 - u / k - v / k; out.append(a * w + b * (u / k) + c * (v / k))
    return out or [poly.mean(0)]
def overlap(f, g):
    small, big = (f, g) if f[7] <= g[7] else (g, f)
    bmn, bmx = big[5].min(0), big[5].max(0); smn, smx = small[5].min(0), small[5].max(0)
    if (np.minimum(bmx, smx) - np.maximum(bmn, smn) <= 0.005).any(): return False
    S = samples(small[5]); hit = sum(inside(p, big[5]) for p in S)
    return hit >= 0.3 * len(S)

def one_pass(pass_no):
    # ---- every axis-aligned face of every mesh, in world space ----
    faces = []   # (object, poly index, axis, sign, plane, 2D polygon (other two axes), material, area)
    for o in bpy.data.objects:
        if o.type != "MESH" or not len(o.data.polygons): continue
        me = o.data; n = len(me.polygons)
        mw = np.array(o.matrix_world); R = mw[:3, :3]; T = mw[:3, 3]; NR = np.linalg.inv(R).T
        co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); W = co.reshape(-1, 3) @ R.T + T
        nr = np.empty(n * 3); me.polygons.foreach_get("normal", nr); nw = nr.reshape(-1, 3) @ NR.T
        nw /= np.maximum(np.linalg.norm(nw, axis=1, keepdims=True), 1e-12)
        ar = np.empty(n); me.polygons.foreach_get("area", ar)
        ls = np.empty(n, dtype=np.int64); me.polygons.foreach_get("loop_start", ls)
        lt = np.empty(n, dtype=np.int64); me.polygons.foreach_get("loop_total", lt)
        lv = np.empty(len(me.loops), dtype=np.int64); me.loops.foreach_get("vertex_index", lv)
        mi = np.empty(n, dtype=np.int64); me.polygons.foreach_get("material_index", mi)
        ax = np.abs(nw).argmax(1); ok = (np.abs(nw[np.arange(n), ax]) > 0.9995) & (ar > 0.002)
        for i in np.nonzero(ok)[0]:
            a = int(ax[i]); P = W[lv[ls[i]:ls[i] + lt[i]]]; oth = [k for k in range(3) if k != a]
            mat = me.materials[mi[i]].name if mi[i] < len(me.materials) and me.materials[mi[i]] else "-"
            if "glass" in mat.lower() or "water" in mat.lower(): continue
            faces.append((o, int(i), a, int(np.sign(nw[i, a])), float(P[:, a].mean()), P[:, oth], mat, float(ar[i])))
    if pass_no == 1: log("axis-aligned faces:", len(faces))

    # ---- pairs: bucket by (axis, facing, plane) ----
    buckets = collections.defaultdict(list)
    for f in faces: buckets[(f[2], f[3], int(round(f[4] / TOL)))].append(f)
    to_push = collections.defaultdict(set)   # object -> poly indices to move back
    fitting_pairs = collections.Counter(); n_pairs = 0
    for (a, s, b), group in buckets.items():
        near = group + buckets.get((a, s, b + 1), [])
        for i, f in enumerate(group):
            for g in near[i + 1:]:   # the rest of this plane bucket and the next one (3 mm buckets: a pair can straddle)
                if f[0] is g[0] or abs(f[4] - g[4]) > TOL: continue
                if not overlap(f, g): continue
                fs, gs = f[0].get("kind") in STRUCT, g[0].get("kind") in STRUCT
                if fs and gs: back = f if rank(f[6]) > rank(g[6]) else g
                elif fs: back = f
                elif gs: back = g
                else:   # two fittings: the one later in name order goes back (an exact duplicate is removed below)
                    fitting_pairs[tuple(sorted((f[0].name, g[0].name)))] += 1
                    back = f if f[0].name > g[0].name else g
                to_push[back[0]].add(back[1]); n_pairs += 1

    # ---- move the faces behind back by PUSH along their own normal (split off first) ----
    n_faces = 0
    for o, idx in to_push.items():
        if o.data.users > 1: o.data = o.data.copy()
        bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
        fl = [bm.faces[i] for i in idx]
        res = bmesh.ops.split(bm, geom=fl)
        moved = [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
        vs = {v for f in moved for v in f.verts}
        for v in vs:   # local-space normal: the push is along the face normal, scaled from world metres
            nrm = Vector((0, 0, 0))
            for f in v.link_faces:
                if f in moved: nrm += f.normal
            if nrm.length: v.co -= nrm.normalized() * (PUSH / max(o.matrix_world.to_scale()))
        bm.to_mesh(o.data); bm.free(); n_faces += len(idx)
    log("pass %d: %d overlapping pairs, %d faces moved back %.0f mm in %d meshes" % (pass_no, n_pairs, n_faces, PUSH * 1000, len(to_push)))
    return n_pairs, fitting_pairs

# several passes: where three or more surfaces share a plane, the ones behind are pushed back step by step
for pass_no in range(1, 8):   # (after ~7 passes a few dozen pairs of 5,600 just swap places: stop there)
    n_pairs, fitting_pairs = one_pass(pass_no)
    if pass_no == 1: first_fitting = fitting_pairs
    if n_pairs == 0: break
for (a, b), k in first_fitting.most_common(8): log("  fitting against fitting (the later name moved back): %s / %s (%d faces)" % (a, b, k))
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]))
log("saved", A["out"])
