"""07 - UV maps: "UVMap" for the material textures, "UVMap_LM" for the baked lightmaps.

  blender -b source/blender/stin88a_06_furnished.blend -P tools/blender/07_uv.py -- --out source/blender/stin88a_07_uv.blend
          [--pilot K.305] [--lm-size 2048] [--pilot-size 2048]

UVMap: box projection in metres, in each mesh's own coordinates (so every copy of a piece of furniture looks the same):
  the axis the face looks along is dropped; walls get V = height (wood grain / slats run vertically like the renders),
  floors / ceilings follow the room grid (x, y), so floor tiles line up. Meshes that already have UVs (the Poly Haven
  chair) keep theirs, renamed "UVMap".
UVMap_LM: Smart UV Project (66 deg, island margin 0.004), then packed per lightmap set with rotation:
  LM_<level> = the level's shell meshes and door leaves (one 2048 px lightmap per level);
  LM_<pilot> = the pilot room (its walls / floor / ceiling faces split off the level meshes, and its furniture made into
  unique copies, because copies that share one mesh can't each carry their own light).
  Other furniture keeps shared meshes; its lightmap treatment is an open question for Phase 5 (see the report).
Report: texel density (px per m) per set and per mesh, and overlapping lightmap texels (none allowed).
Idempotent: reads the 06 output and writes a new file.
"""
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("out", "source/blender/stin88a_07_uv.blend"), ("pilot", "K.305"), ("lm-size", "2048"), ("pilot-size", "2048"),
                 ("report", "source/compare/phase4/07_uv.json"), ("skip-lm", False), ("sets", "")])
log = common.Log("07_uv")
model = common.model_json()
LEVELS = ["L0", "L1", "L2", "L3", "L4", "ROOF", "SITE"]

def in_poly(x, y, pts):
    c = False
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
    return c

# ---------- 1. pilot room: split its faces off the level meshes, unique furniture copies ----------
pilot = A["pilot"].strip()
rooms = [r for r in model["rooms"] if r["name"].strip() in (pilot, "KM " + pilot)]
pz = rooms[0]["z"]
grow = 0.2  # include the walls around the room (half a wall thickness and a bit)
def poly_grow(pts, d):
    c = np.mean(pts, 0); return [tuple(c + (np.array(p) - c) * (1 + d / max(1e-6, np.linalg.norm(np.array(p) - c)))) for p in pts]
outlines = [poly_grow(r["outline"], grow) for r in rooms]
def in_pilot(p):
    return pz - 0.2 <= p.z <= pz + 3.3 and any(in_poly(p.x, p.y, o) for o in outlines)
pilot_objs = []
lvl_col = None
# re-run on a 07 output: the room's wall / floor pieces were already split off (dressing objects from 06b carry the
# pilot's lm_set too, so only split shell pieces count)
already = any(o.get("lm_set") == "LM_" + pilot.replace(".", "") and o.get("kind") in ("shell", "ceiling", "doorframe", "stair", "railing")
              for o in bpy.data.objects)
for L in ([] if already else LEVELS):
    col = bpy.data.collections.get(L)
    if not col: continue
    for o in list(col.objects):
        if o.type != "MESH": continue
        if o.get("kind") in ("shell", "ceiling", "doorframe", "stair", "railing") and o.matrix_world == o.matrix_world.Identity(4):
            me = o.data
            sel = [p.index for p in me.polygons if in_pilot(p.center)]
            if not sel: continue
            bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
            pb = bm.copy(); pb.faces.ensure_lookup_table()
            keep = set(sel)
            bmesh.ops.delete(pb, geom=[f for f in pb.faces if f.index not in keep], context="FACES")
            bmesh.ops.delete(bm, geom=[bm.faces[i] for i in sel], context="FACES")
            bm.to_mesh(me); bm.free()
            pm = bpy.data.meshes.new("%s_%s" % (L, pilot)); pb.to_mesh(pm); pb.free()
            for m in me.materials: pm.materials.append(m)
            po = bpy.data.objects.new("%s_%s_%s" % (L, pilot.replace(".", ""), o.name.split("_", 1)[1]), pm)
            for k in o.keys(): po[k] = o[k]
            po["lm_set"] = "LM_" + pilot.replace(".", ""); col.objects.link(po); pilot_objs.append(po); lvl_col = col
        elif o.get("room", "") in (pilot, "KM " + pilot) or (o.get("kind") == "door" and in_pilot(o.matrix_world.translation + Vector((0, 0, 1)))):
            o.data = o.data.copy()  # unique copy: its own lightmap
            o["lm_set"] = "LM_" + pilot.replace(".", ""); pilot_objs.append(o)
log("pilot %s: %d objects (room faces split off the level meshes + its furniture / doors as unique copies)" % (pilot, len(pilot_objs)))

# ---------- 2. lightmap sets ----------
sets = {}
for L in LEVELS:
    col = bpy.data.collections.get(L)
    if not col: continue
    for o in col.objects:
        if o.type != "MESH" or not len(o.data.polygons): continue
        if "lm_set" not in o:
            o["lm_set"] = ("LM_" + L) if (o.get("kind") in ("shell", "ceiling", "doorframe", "stair", "railing", "door")) else "LM_furniture_shared"
        sets.setdefault(o["lm_set"], []).append(o)

# ---------- 3. UVMap: box projection in metres (mesh coordinates) ----------
done = set()
for o in [o for objs in sets.values() for o in objs]:
    me = o.data
    if me.name in done: continue
    done.add(me.name)
    if me.uv_layers and me.uv_layers[0].name != "UVMap_LM" and o.get("kind") == "chair":
        me.uv_layers[0].name = "UVMap"; continue
    if me.uv_layers and me.uv_layers[0].name.startswith("UVChannel") or (me.uv_layers and "chair" in me.name):
        me.uv_layers[0].name = "UVMap"; continue
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    n = len(me.loops)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    lv = np.empty(n, dtype=np.int64); me.loops.foreach_get("vertex_index", lv)
    pn = np.empty(len(me.polygons) * 3); me.polygons.foreach_get("normal", pn); pn = np.abs(pn.reshape(-1, 3))
    ls = np.empty(len(me.polygons), dtype=np.int64); me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(len(me.polygons), dtype=np.int64); me.polygons.foreach_get("loop_total", lt)
    face_of_loop = np.repeat(np.arange(len(me.polygons)), lt)
    ax = np.argmax(pn, 1)[face_of_loop]
    p = co[lv]
    u = np.where(ax == 2, p[:, 0], np.where(ax == 0, p[:, 1], p[:, 0]))
    v = np.where(ax == 2, p[:, 1], p[:, 2])
    uv.data.foreach_set("uv", np.stack([u, v], 1).ravel())
log("UVMap (box projection, metres) on %d meshes" % len(done))

# ---------- 4. UVMap_LM: smart project per mesh, pack per set ----------
def ensure_lm(me):
    lm = me.uv_layers.get("UVMap_LM") or me.uv_layers.new(name="UVMap_LM")
    me.uv_layers.active = lm
    return lm
vl = bpy.context.view_layer
def edit_ops(objs, fn):
    for o in vl.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    vl.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    fn()
    bpy.ops.object.mode_set(mode="OBJECT")
def self_overlap(o, res=384):
    """share of a mesh's lightmap texels covered by more than one of its own triangles"""
    me = o.data; me.calc_loop_triangles(); lm = me.uv_layers["UVMap_LM"]
    uv = np.empty(len(me.loops) * 2); lm.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2) * res
    tl = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get("loops", tl); tl = tl.reshape(-1, 3)
    cnt = np.zeros((res, res), dtype=np.uint16)
    for t in tl:
        P = uv[t]; x0, y0 = np.maximum(np.floor(P.min(0)).astype(int), 0); x1, y1 = np.minimum(np.ceil(P.max(0)).astype(int), res)
        if x1 <= x0 or y1 <= y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        (ax_, ay), (bx, by), (cx, cy) = P
        d = (by - cy) * (ax_ - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12: continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d; l2 = ((cy - ay) * (xs - cx) + (ax_ - cx) * (ys - cy)) / d
        cnt[y0:y1, x0:x1] += (l1 > 0.02) & (l2 > 0.02) & (1 - l1 - l2 > 0.02)
    return (cnt > 1).sum() / max(1, (cnt > 0).sum())

report = {"sets": {}, "meshes": {}}
if A["skip_lm"]: sets = {}  # texture UVs only (the lightmap layout is decided separately)
sets.pop("LM_furniture_shared", None)  # shared furniture meshes: lightmap treatment decided in Phase 5
only = set(filter(None, A["sets"].split(",")))
for name, objs in sorted(sets.items()):
    if only and name not in only: continue  # --sets: rebuild only these lightmap sets, keep the others as they are
    uniq, seen = [], set()
    for o in objs:
        if o.data.name not in seen: seen.add(o.data.name); uniq.append(o)
    # smart project each mesh on its own (a fresh layer, so no metre-sized box UVs are left behind), check it, then
    # one pack for the whole set
    # island margins in lightmap pixels, not as a fixed fraction: estimate how many pixels each mesh's square will get
    # (expected fill ~45 % of the map, ~60 % inside each square) and give every island ~4 px of space
    size_px = int(A["pilot_size"] if name.startswith("LM_K") else A["lm_size"])
    def area_of(o):
        me = o.data; me.calc_loop_triangles(); return max(1e-4, sum(t.area for t in me.loop_triangles))
    areas = {o.name: area_of(o) for o in uniq}
    px_per_m = math.sqrt(0.45 * size_px * size_px / sum(areas.values()))
    for o in uniq:
        me = o.data
        side_px = math.sqrt(areas[o.name] / 0.6) * px_per_m
        o["lm_margin"] = min(0.02, max(0.0005, 4.0 / max(side_px, 1.0)))
        if me.uv_layers.get("UVMap_LM"): me.uv_layers.remove(me.uv_layers["UVMap_LM"])
        ensure_lm(me)
        edit_ops([o], lambda: bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, scale_to_bounds=False))
        uvs = np.empty(len(me.loops) * 2); me.uv_layers["UVMap_LM"].data.foreach_get("uv", uvs)
        if len(uvs) and (uvs.min() < -1e-3 or uvs.max() > 1 + 1e-3):
            raise RuntimeError("smart project left UVs outside 0-1 on %s (%.2f..%.2f)" % (o.name, uvs.min(), uvs.max()))
        # pack this mesh's islands into its own 0-1 square (one mesh at a time: Blender's packer broke down on whole
        # levels with thousands of islands)
        mg = o["lm_margin"]
        edit_ops([o], lambda: bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=mg))
        # Blender's packer sometimes stacks islands on a mesh: check, and fall back to Lightmap Pack (one box per face,
        # cannot overlap) when it does
        ov = self_overlap(o)
        if ov > 0.001:
            edit_ops([o], lambda: bpy.ops.uv.lightmap_pack(PREF_CONTEXT="ALL_FACES", PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False,
                                                           PREF_BOX_DIV=48, PREF_MARGIN_DIV=0.25))
            log("  %s: islands overlapped (%.1f %%) after packing -> Lightmap Pack, now %.2f %%" % (o.name, 100 * ov, 100 * self_overlap(o)))
    # place the meshes' squares into the set's lightmap: each square scaled by sqrt(surface area) so the texel density
    # is the same everywhere, shelf-packed (largest first) into the smallest square that holds them all
    def surface(o):
        me = o.data; me.calc_loop_triangles()
        return max(1e-4, sum(t.area for t in me.loop_triangles))
    items = sorted(((math.sqrt(surface(o)), o) for o in uniq), key=lambda t: -t[0])
    gap = 4.0 / size_px  # ~4 px between meshes
    def shelf(S):
        x = y = row_h = 0.0; pos = []
        for s, o in items:
            w = s / S + gap
            if x + w > 1.0: x, y, row_h = 0.0, y + row_h, 0.0
            if y + w > 1.0 + 1e-9: return None
            pos.append((o, x, y, s / S)); x += w; row_h = max(row_h, w)
        return pos
    lo, hi = sum(s for s, _ in items) ** 0 * max(s for s, _ in items), sum(s for s, _ in items) * 2
    for _ in range(40):  # smallest scale that fits
        mid = (lo + hi) / 2
        if shelf(mid): hi = mid
        else: lo = mid
    for o, x, y, k in shelf(hi):
        lm = o.data.uv_layers["UVMap_LM"]
        uvs = np.empty(len(o.data.loops) * 2); lm.data.foreach_get("uv", uvs); uvs = uvs.reshape(-1, 2)
        lm.data.foreach_set("uv", (uvs * k + np.array([x, y])).ravel())
    # texel density + overlaps
    size = int(A["pilot_size"] if name.startswith("LM_K") else A["lm_size"])
    grid = np.zeros((1024, 1024), dtype=np.uint16)
    world_area = uv_area = 0.0
    for o in uniq:
        me = o.data; lm = me.uv_layers["UVMap_LM"]
        uvs = np.empty(len(me.loops) * 2); lm.data.foreach_get("uv", uvs); uvs = uvs.reshape(-1, 2)
        me.calc_loop_triangles()
        tl = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get("loops", tl); tl = tl.reshape(-1, 3)
        a, b, c = uvs[tl[:, 0]], uvs[tl[:, 1]], uvs[tl[:, 2]]
        ua = 0.5 * np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1]))
        sc_ = np.array(o.matrix_world.to_scale()); s = float(np.prod(np.abs(sc_))) ** (2 / 3)
        wa = sum(t.area for t in me.loop_triangles) * s
        world_area += wa; uv_area += ua.sum()
        report["meshes"][o.name] = {"set": name, "texel_px_per_m": round(math.sqrt(ua.sum() * size * size / max(wa, 1e-9)), 1)}
        # rasterise the triangle centroids + corners (cheap overlap estimate on a 1024 grid)
        for pts in (a, b, c, (a + b + c) / 3):
            ij = np.clip((pts * 1024).astype(int), 0, 1023)
        cen = np.clip((((a + b + c) / 3) * 1024).astype(int), 0, 1023)
        np.add.at(grid, (cen[:, 1], cen[:, 0]), 1)
    density = math.sqrt(uv_area * size * size / max(world_area, 1e-9))
    used = uv_area
    report["sets"][name] = {"objects": len(objs), "meshes": len(uniq), "lightmap_px": size, "surface_m2": round(world_area, 1),
                            "uv_fill": round(used, 3), "texel_px_per_m": round(density, 1)}
    log("%-22s meshes %3d  surface %7.1f m2  uv fill %4.0f %%  texel density %5.1f px/m at %d px" % (name, len(uniq), world_area, 100 * used, density, size))

# overlap check: exact, per set, by rasterising every lightmap triangle at the lightmap resolution / 4
def overlap_pct(objs, res=512):
    cover = np.zeros((res, res), dtype=np.uint8); over = 0; total = 0
    for o in objs:
        me = o.data; lm = me.uv_layers["UVMap_LM"]
        uvs = np.empty(len(me.loops) * 2); lm.data.foreach_get("uv", uvs); uvs = uvs.reshape(-1, 2) * res
        tl = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get("loops", tl); tl = tl.reshape(-1, 3)
        for t in tl:
            P = uvs[t]; x0, y0 = np.floor(P.min(0)).astype(int); x1, y1 = np.ceil(P.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, res), min(y1, res)
            if x1 <= x0 or y1 <= y0: continue
            xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
            (ax_, ay), (bx, by), (cx, cy) = P
            d = (by - cy) * (ax_ - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-12: continue
            l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d; l2 = ((cy - ay) * (xs - cx) + (ax_ - cx) * (ys - cy)) / d
            inside = (l1 > 0.02) & (l2 > 0.02) & (1 - l1 - l2 > 0.02)
            sub = cover[y0:y1, x0:x1]
            over += int((inside & (sub > 0)).sum()); total += int(inside.sum())
            sub[inside] = 1
    return 100.0 * over / max(total, 1)
for name, objs in sorted(sets.items()):
    if name == "LM_furniture_shared" or name not in report["sets"]: continue  # (sets not rebuilt in this run)
    uniq = list({o.data.name: o for o in objs}.values())
    pct = overlap_pct(uniq)
    report["sets"][name]["overlap_pct"] = round(pct, 3)
    log("%-22s overlapping lightmap texels: %.3f %%" % (name, pct))

os.makedirs(os.path.dirname(os.path.abspath(A["report"])), exist_ok=True)
json.dump(report, open(A["report"], "w"), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"])
