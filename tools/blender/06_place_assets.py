"""06 - Furniture and fittings: import the placement IFC, replace / simplify per family (source/compare/phase3/PROPOSAL.md),
and place every item as an instance (linked duplicate, so the glTF export stores each design once).

  blender -b source/blender/stin88a_04_join.blend -P tools/blender/06_place_assets.py --
         --ifc source/revit/2026-11-25_WEB_PLACEMENT.ifc --placement source/revit/2026-11-25_placement_v2.json
         --chair <dir>/modern_arm_chair_01_1k.gltf --out source/blender/stin88a_06_furnished.blend

How instances are found: elements of the same family and type have the same geometry in the same vertex order, so each
copy's exact transform (position, rotation, mirroring - wall-hosted basins included) is solved from its vertices against
the first copy (least squares, checked to < 2 mm). Copies that don't match stay as their own object (logged).
Per family (PROPOSAL.md):
  shower column -> script-built (rail, rain head, mixer, hand shower), wall side found by ray casting the shell
  beds (120 cm / Queen / King / Bunk) -> script-built from the Revit size; head end = the end nearer a wall
  toilet / basin / sink / small fittings / corner sofa -> the Revit design decimated to its budget
  office chair (not exported, 355k tris) -> Poly Haven modern_arm_chair_01 (CC0) decimated, at model.json "proxies"
  fridge (no geometry at Medium detail) -> script-built box at the Revit size
  everything else (in-place joinery, TVs, sofas, chairs, tables) -> kept as exported
Objects go into the level collections, named "<L>_<room>_<kind>", with properties category / family / revit_id / room /
bathroom / tv / kind. Idempotent: reads the 04 output and writes a new file.
"""
import bpy, bmesh, sys, os, re, json, math
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("ifc", None), ("placement", None), ("chair", None), ("out", "source/blender/stin88a_06_furnished.blend"),
                 ("chair-scale", "0.71"), ("chair-yaw", "0"),
                 ("bed-style", "box")])  # box = soft boxes (default for now); cloth = cloth simulation (being fixed)
log = common.Log("06_assets")
mmap = common.material_map()
bands = common.level_bands()
model = common.model_json()
UNIT_TYPE = {u["label"].strip(): u.get("type") for u in json.load(open(os.path.join(common.REPO, "data", "units.json"), encoding="utf8"))["units"]}

# ---------- helpers ----------
def verts_of(o):
    co = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3); mw = np.array(o.matrix_world)
    return co @ mw[:3, :3].T + mw[:3, 3]
def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
def band_of(z):
    for name, lo, hi in bands:
        if lo <= z < hi: return name
    return "ROOF"
def in_poly(x, y, pts):
    c = False
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
    return c
def room_at(x, y, z):
    r = next((r for r in model["rooms"] if abs(z - r["z"]) < 1.5 and in_poly(x, y, r["outline"])), None)
    return r["name"].strip() if r else ""
def clean_mat(m):
    if m is None: return None
    name = common.clean_material(m.name, mmap) or "M_drop"
    cm = bpy.data.materials.get(name)
    if cm is None:
        cm = m.copy(); cm.name = name
    return cm
def mat(name, rgb):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name); m.use_nodes = True
        c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in rgb]
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*c, 1); m.diffuse_color = (*c, 1)
    return m
def rounded_box(bm, size, center, bevel=0.0, segs=2, mat_index=0):
    """axis-aligned box (bmesh), optionally with soft rounded edges (cushions, mattresses)"""
    r = bmesh.ops.create_cube(bm, size=1.0)
    vs = r["verts"]
    for v in vs: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + Vector(center)
    before = set(bm.faces)
    if bevel > 0:
        edges = list({e for v in vs for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=segs, profile=0.5, affect="EDGES", clamp_overlap=True)
    for f in bm.faces:  # this box's faces (incl. the new bevel faces) get its material
        if f not in before or any(v in vs for v in f.verts): f.material_index = mat_index
def cylinder(bm, r, h, base, axis="z", segs=12, mat_index=0):
    m = Matrix.Identity(4)
    if axis == "x": m = Matrix.Rotation(math.pi / 2, 4, "Y")
    if axis == "y": m = Matrix.Rotation(math.pi / 2, 4, "X")
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=h, matrix=m)
    for v in res["verts"]: v.co += Vector(base)
    for f in {f for v in res["verts"] for f in v.link_faces}: f.material_index = mat_index
def mesh_from(bm, name, mats):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    for p in me.polygons: p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(35))
    return me

# shell BVH (to find which side of a bed / shower faces a wall)
shell = [o for o in bpy.data.objects if o.type == "MESH" and o.get("kind") in ("shell",)]
sv, st, off = [], [], 0
for o in shell:
    me = o.data; me.calc_loop_triangles()
    v = verts_of(o); t = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get("vertices", t)
    sv.append(v); st.append(t.reshape(-1, 3) + off); off += len(v)
SHELL = BVHTree.FromPolygons(np.concatenate(sv).tolist(), np.concatenate(st).tolist(), all_triangles=True)
def wall_dist(p, d):
    loc, n, i, dist = SHELL.ray_cast(Vector(p), Vector(d), 6.0)
    return dist if dist is not None else 6.0

# ---------- import ----------
coll_in = common.collection("PLACEMENT_IMPORT")
objs = common.import_ifc(os.path.abspath(A["ifc"]), coll_in, log)
recs = {r["id"]: r for r in json.load(open(A["placement"]))}
tri_in = sum(tris(o) for o in objs)
log("imported %d elements, %d triangles" % (len(objs), tri_in))

# family / type of every element (from the Revit export; IFC name "Family:Type:id" as fallback)
for o in objs:
    r = recs.get(o["revit_id"])
    fam = r["family"] if r else o["revit_name"].split(":")[0]
    typ = r["type"] if r else (o["revit_name"].split(":")[1] if ":" in o["revit_name"] else "")
    o["family"] = fam; o["type"] = typ
    if r: o["category"] = r["category"]

RULES = [  # (regex on family, treatment, budget / kind)
    (r"^SHOWER BRAVAT", "shower", 0),
    (r"^Bed", "bed", 0),
    (r"^QARC Toilet", "decimate", 1500),
    (r"^QARC Basin", "decimate", 800),
    (r"^QARC Sink", "decimate", 1500),
    (r"^FFAST602", "decimate", 300),
    (r"^Furniture_BoConcept_Carmo", "decimate", 15000),
    (r"^Fridge", "fridge", 0),
]
def rule_of(fam):
    for rx, t, b in RULES:
        if re.match(rx, fam): return t, b
    return "keep", 0

# ---------- group copies of the same design, solve each copy's transform ----------
groups = {}
for o in objs:
    groups.setdefault((o["family"], o["type"], len(o.data.vertices)), []).append(o)
placed, n_inst, n_unmatched = [], 0, 0
protos = {}  # key -> (mesh in local frame, list of (object source, matrix))
for key, members in groups.items():
    first = members[0]
    if rule_of(first["family"])[0] == "bed":
        # every bed is built for its own room (facing that room's TV, against that room's wall): rooms come mirrored
        # and rotated, so one copy's answer does not carry over to the others
        for o in members: protos[(key, o["revit_id"])] = (o, [(o, Matrix.Translation(Vector(verts_of(o).mean(0))))])
        continue
    V0 = verts_of(first); c0 = V0.mean(0); X = np.hstack([V0 - c0, np.ones((len(V0), 1))])
    insts = []
    for o in members:
        if o is first:
            M = Matrix.Translation(Vector(c0)); insts.append((o, M)); continue
        Y = verts_of(o)
        B, *_ = np.linalg.lstsq(X, Y, rcond=None)
        err = np.abs(X @ B - Y).max()
        if err > 0.002:
            n_unmatched += 1; protos[(key, o["revit_id"])] = (o, [(o, Matrix.Translation(Vector(Y.mean(0))))])
            continue
        M = Matrix(((B[0, 0], B[1, 0], B[2, 0], B[3, 0]), (B[0, 1], B[1, 1], B[2, 1], B[3, 1]), (B[0, 2], B[1, 2], B[2, 2], B[3, 2]), (0, 0, 0, 1)))
        insts.append((o, M)); n_inst += 1
    protos[key] = (first, insts)
log("designs %d, copies solved %d, copies kept separate %d" % (len(protos), n_inst, n_unmatched))

def localize(o, M):
    """mesh of o expressed in the frame M (so that M @ local = world)"""
    me = o.data.copy(); me.transform(M.inverted() @ o.matrix_world); return me

# ---------- script-built replacements ----------
def build_bed(size, head_sign, bunk=False):
    """bed in a local frame: x = width, y = length (head at y = head_sign * L/2), z up from the floor (z = 0)"""
    W, L, H = size
    wood, sheet, duvet, throw = mat("M_wood_light", (0.78, 0.66, 0.51)), mat("M_fabric_sheet", (0.93, 0.92, 0.89)), \
        mat("M_fabric_bedding", (0.89, 0.86, 0.80)), mat("M_fabric_throw", (0.62, 0.60, 0.56))
    mats = [wood, sheet, duvet, throw]
    bm = bmesh.new()
    tiers = [0.0, 1.05] if bunk else [0.0]
    top = min(H, 0.55) if not bunk else 0.45
    cloths = []  # (size_x, size_y, centre, material index, pinned-free) dropped by the cloth simulation, in order
    for z0 in tiers:
        base_h = top * 0.45
        rounded_box(bm, (W, L, base_h), (0, 0, z0 + base_h / 2), 0.01, 1, 0)                  # platform
        mh = top - base_h
        rounded_box(bm, (W - 0.06, L - 0.06, mh), (0, 0, z0 + base_h + mh / 2), 0.04, 2, 1)    # mattress
        n_p = 2 if W > 1.1 else 1
        pw = (W - 0.16) / n_p
        for k in range(n_p):                                                                  # pillows (puffy)
            x = -W / 2 + 0.08 + pw * (k + 0.5)
            rounded_box(bm, (pw - 0.04, 0.38, 0.13), (x, head_sign * (L / 2 - 0.27), z0 + top + 0.065), 0.06, 3, 1)
        # duvet: covers ~74 % of the bed from the foot and hangs over the sides and the foot end
        dl = L * 0.74
        cloths.append(((W + 0.52, dl + 0.28), (0, -head_sign * ((L - dl) / 2 + 0.14), z0 + top + 0.09), 2))
        # throw: a narrow blanket across the foot, dropped on the settled duvet
        cloths.append(((W + 0.36, 0.55), (0, -head_sign * (L / 2 - 0.38), z0 + top + 0.22), 3))
    if bunk:
        for sx in (-1, 1):
            for sy in (-1, 1):
                rounded_box(bm, (0.05, 0.05, H), (sx * (W / 2 - 0.025), sy * (L / 2 - 0.025), H / 2), 0.005, 1, 0)
    if A["bed_style"] == "box":
        # simple soft boxes (no physics): duvet draped over the sides / foot, throw across the foot
        for (sx, sy), ctr, mi in cloths:
            if mi == 2:
                drop = 0.24
                rounded_box(bm, (sx - 0.46, sy - 0.25, drop + 0.06), (ctr[0], ctr[1] + head_sign * 0.125, ctr[2] - 0.03 - (drop + 0.06) / 2), 0.04, 3, 2)
            else:
                rounded_box(bm, (sx - 0.29, sy - 0.05, 0.025), (ctr[0], ctr[1], ctr[2] - 0.135), 0.012, 1, 3)
        return mesh_from(bm, "bed", mats)
    static = mesh_from(bm, "bed_static", mats)
    return drape(static, cloths, mats)

def _tv_box(room, zfloor):
    """world bounding box (min, max) of the TV in this room (Revit "Communication Devices"), or None"""
    if not room: return None
    for o in objs:
        if o.get("category") != "Communication Devices": continue
        V = verts_of(o); mn, mx = V.min(0), V.max(0); cc = (mn + mx) / 2
        if room_at(cc[0], cc[1], float(mn[2])) == room and abs(float(mn[2]) - zfloor) < 2.5: return mn, mx
    return None
def tv_of(room, zfloor):
    """(axis of the TV wall's normal, 0 = x / 1 = y) - the TV is thin along it"""
    b = _tv_box(room, zfloor)
    if b is None: return None
    sz = b[1] - b[0]
    return (0 if sz[0] < sz[1] else 1), 0
def tv_centre(room, zfloor):
    b = _tv_box(room, zfloor); return (b[0] + b[1]) / 2

def add_backdrop(me, W, L, head, side_space, room):
    """3.5 m rooms / suites: a timber backdrop panel behind the head of the bed with a floating end table fixed to it on
    each side (dropped on a side without room for it). Same local frame as build_bed (x = width, head at y = head*L/2)."""
    bm = bmesh.new(); bm.from_mesh(me)
    wood_i = 0   # build_bed's first material = M_wood_light
    t, ph, ns_w, ns_d, gap = 0.04, 1.15, 0.40, 0.35, 0.05   # panel thickness / height, end table width / depth, gap
    yb = head * (L / 2 + 0.01 + t / 2)
    sides = [s for s in (-1, 1) if side_space[s] >= W / 2 + gap + ns_w + 0.02 - 1e-6]
    left = W / 2 + (gap + ns_w + 0.02 if -1 in sides else gap)
    right = W / 2 + (gap + ns_w + 0.02 if 1 in sides else gap)
    rounded_box(bm, (left + right, t, ph), ((right - left) / 2, yb, ph / 2), 0.004, 1, wood_i)           # backdrop
    for s in sides:                                                                                        # end tables
        x = s * (W / 2 + gap + ns_w / 2)
        rounded_box(bm, (ns_w, ns_d, 0.13), (x, head * (L / 2 + 0.01 - ns_d / 2), 0.50), 0.006, 1, wood_i)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    log("  backdrop in %s: %d end table(s)" % (room, len(sides)))

def drape(static, cloths, mats, frames=110, spacing_target=2600):
    """Cloth simulation (Blender's own, headless): each sheet is a subdivided plane dropped onto the static parts (and
    the sheets already settled); the final frame is baked into one mesh with the static parts. Single-sided sheets
    (the glTF material is double-sided) keep the triangle count within the bed budget."""
    # every bed is simulated in its own empty scene (collision state left over from an earlier simulation in the same
    # scene made later sheets fall straight through)
    sc = bpy.data.scenes.new("drape")
    win_scene = bpy.context.window.scene if bpy.context.window else None
    col = bpy.data.objects.new("drape_collider", static.copy()); sc.collection.objects.link(col)
    cm = col.modifiers.new("collision", "COLLISION")
    col.collision.thickness_outer = 0.006; col.collision.cloth_friction = 8
    settled = []
    for (sx, sy), ctr, mi in cloths:
        # colliders must be registered before the sheet starts falling (otherwise the first sheet falls through)
        sc.frame_set(1); sc.view_layers[0].update(); sc.view_layers[0].depsgraph.update()
        n = spacing_target if mi == 2 else spacing_target // 3
        s = math.sqrt(sx * sy / n); nx, ny = max(4, round(sx / s)), max(4, round(sy / s))
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=0.5)
        rng = np.random.default_rng(7 + mi)
        for v in bm.verts:  # a slight lengthwise bulge + small noise, so the sheet lands with natural folds
            bulge = 0.05 * math.cos(v.co.x * math.pi) * math.cos(v.co.y * math.pi * 0.8)
            v.co = Vector((v.co.x * sx, v.co.y * sy, bulge + rng.normal(0, 0.006))) + Vector(ctr)
        for f in bm.faces: f.material_index = mi
        me = bpy.data.meshes.new("sheet"); bm.to_mesh(me); bm.free()
        for m in mats: me.materials.append(m)
        ob = bpy.data.objects.new("sheet", me); sc.collection.objects.link(ob)
        cl = ob.modifiers.new("cloth", "CLOTH"); cs = cl.settings
        cs.quality = 8; cs.mass = 0.35; cs.air_damping = 2.0
        cs.tension_stiffness = cs.compression_stiffness = 10; cs.shear_stiffness = 5; cs.bending_stiffness = 0.15
        cl.collision_settings.distance_min = 0.004; cl.collision_settings.use_self_collision = False
        cl.point_cache.frame_start = 1; cl.point_cache.frame_end = frames
        sc.frame_start, sc.frame_end = 1, frames
        for f in range(1, frames + 1): sc.frame_set(f)
        dg = sc.view_layers[0].depsgraph
        res = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        bpy.data.objects.remove(ob)
        zs = np.array([v.co.z for v in res.vertices])
        if zs.min() < ctr[2] - 1.0:  # fell through: never bake a sheet lying on the floor
            raise RuntimeError("cloth sheet fell through the bed (z %.2f, dropped from %.2f)" % (zs.min(), ctr[2]))
        # the settled sheet becomes a collider for the next one
        so = bpy.data.objects.new("settled", res); sc.collection.objects.link(so)
        sm = so.modifiers.new("collision", "COLLISION"); so.collision.thickness_outer = 0.004
        settled.append(so)
        sc.frame_set(1)
    # one mesh: static parts + settled sheets
    bm = bmesh.new(); bm.from_mesh(static)
    for so in settled: bm.from_mesh(so.data)
    out = bpy.data.meshes.new("bed"); bm.to_mesh(out); bm.free()
    for m in mats: out.materials.append(m)
    for p in out.polygons: p.use_smooth = True
    for o in [col] + settled: bpy.data.objects.remove(o)
    bpy.data.scenes.remove(sc)
    return out

def build_shower(size, wall_axis, wall_sign):
    """shower column: vertical rail against the wall, rain head on an arm, mixer, hand shower (chrome)"""
    chrome = mat("M_chrome", (0.82, 0.82, 0.82))
    bm = bmesh.new()
    H = size[2]
    back = [0.0, 0.0]; back[wall_axis] = wall_sign * (size[wall_axis] / 2 - 0.03)
    out = [0.0, 0.0]; out[wall_axis] = -wall_sign * 0.22
    cylinder(bm, 0.012, H * 0.9, (back[0], back[1], H * 0.45 + 0.05), "z", 12)                          # rail
    arm = [0.0, 0.0]; arm[wall_axis] = (back[wall_axis] + out[wall_axis]) / 2
    cylinder(bm, 0.008, abs(out[wall_axis] - back[wall_axis]), (arm[0], arm[1], H * 0.95), "xy"[wall_axis], 8)  # arm
    cylinder(bm, 0.11, 0.012, (out[0], out[1], H * 0.94), "z", 24)                                     # rain head
    mix = [0.0, 0.0]; mix[wall_axis] = back[wall_axis] - wall_sign * 0.04
    rounded_box(bm, (0.18 if wall_axis else 0.06, 0.06 if wall_axis else 0.18, 0.07), (mix[0], mix[1], 1.0 - 0.0), 0.01, 1)  # mixer
    hs = [0.0, 0.0]; hs[wall_axis] = back[wall_axis] - wall_sign * 0.05
    cylinder(bm, 0.018, 0.22, (hs[0], hs[1], 1.25), "z", 10)                                            # hand shower
    return mesh_from(bm, "shower_column", [chrome])

def build_fridge(size):
    steel, dark = mat("M_metal_brushed", (0.66, 0.66, 0.65)), mat("M_plastic_black", (0.12, 0.12, 0.13))
    bm = bmesh.new()
    W, D, H = size
    rounded_box(bm, (W, D, H), (0, 0, H / 2), 0.01, 1, 0)
    rounded_box(bm, (0.012, 0.03, H * 0.5), (W * 0.05, -D / 2 - 0.012, H * 0.55), 0.003, 1, 1)  # door gap / handle strip
    return mesh_from(bm, "fridge", [steel, dark])

def decimate(me, budget):
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    if n <= budget: return me, n, n
    tmp = bpy.data.objects.new("tmp_dec", me); bpy.context.scene.collection.objects.link(tmp)
    m = tmp.modifiers.new("d", "DECIMATE"); m.decimate_type = "COLLAPSE"; m.ratio = budget / n; m.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get(); dg.update()
    out = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    bpy.data.objects.remove(tmp)
    return out, n, sum(len(p.vertices) - 2 for p in out.polygons)

# ---------- build every design, then place its copies ----------
report = {}
def place(me, insts, kind, fam):
    for src, M in insts:
        p = M.translation
        L = band_of(src.get("zmin", p.z - 0.4) if False else float(verts_of(src)[:, 2].min()))
        room = room_at(p.x, p.y, float(verts_of(src)[:, 2].min()))
        ob = bpy.data.objects.new("%s_%s_%s" % (L, re.sub(r"[^A-Za-z0-9]", "", room) or src["revit_id"], kind), me)
        ob.matrix_world = M
        for k in ("revit_id", "category", "family", "type"): ob[k] = src.get(k, "")
        ob["room"] = room; ob["kind"] = kind; ob["level"] = L
        ob["bathroom"] = src.get("category") == "Plumbing Fixtures"; ob["tv"] = src.get("category") == "Communication Devices"
        ob["collide"] = False
        bpy.data.collections[L].objects.link(ob); placed.append(ob)

for key, (first, insts) in protos.items():
    fam = first["family"]; t, budget = rule_of(fam)
    kind = re.sub(r"[^a-z0-9]+", "_", fam.lower()).strip("_")[:24]
    V = np.array([v.co for v in localize(first, insts[0][1]).vertices]) if t in ("bed", "shower", "fridge") else None
    if t == "bed":
        # size from the bed FRAME (the parts within 0.3 m of the floor), not the whole family: "Bed - 120cm 88A" also
        # holds a floating nightstand beside the head (0.30 x 0.30 m at 0.40-0.45 m), which made its box 1.50 m wide
        z0 = float(V[:, 2].min()); base = V[V[:, 2] < z0 + 0.30]
        bmn, bmx = base.min(0), base.max(0); bsize = bmx - bmn; bc = (bmn + bmx) / 2
        size = np.array([bsize[0], bsize[1], V[:, 2].max() - z0])
        # local frame = world axes of the first copy: the long horizontal axis is the bed's length
        long_ax = 0 if size[0] > size[1] else 1
        c = insts[0][1].translation + Vector((bc[0], bc[1], 0)); z = float(verts_of(first)[:, 2].min()) + 0.5
        d = [0, 0, 0]; d[long_ax] = 1; dp = wall_dist((c.x, c.y, z), d); d[long_ax] = -1; dn = wall_dist((c.x, c.y, z), d)
        head = 1 if dp < dn else -1
        W, Lg = (size[1], size[0]) if long_ax == 0 else (size[0], size[1])
        room0 = room_at(c.x, c.y, z - 0.5)
        # The foot of the bed faces the room's TV (head against the wall opposite it). The frame's longer side is not
        # reliable: the Revit family in the 3.5 m / suite rooms is a 2.11 x 2.43 m block and came out turned 90°.
        tv = tv_of(room0, z - 0.5)
        reoriented = False
        if tv is not None:
            tax, tsign = tv
            want = 1 if c[tax] > tv_centre(room0, z - 0.5)[tax] else -1
            if tax != long_ax or want != head:
                log("  bed %s in %s: turned to face the TV (length along %s, head %+d)" % (fam, room0, "xy"[tax], want))
                long_ax, head, reoriented = tax, want, True
                W, Lg = min(size[0], size[1]), max(size[0], size[1])
        # 3 m rooms ("standard" in data/units.json): 120 cm wide beds
        deluxe = UNIT_TYPE.get(room0) in ("deluxe", "suite")
        if UNIT_TYPE.get(room0) == "standard":
            if abs(W - 1.20) > 0.02: log("  bed %s in 3 m room %s: frame %.2f m wide -> 1.20 m" % (fam, room0, W))
            W = 1.20
        cl = np.array([bc[0], bc[1]], float)  # bed centre in the local (= first copy's world-axis) frame
        if deluxe or reoriented:
            # head against the wall: measured from the frame centre along the head direction
            hd = [0, 0, 0]; hd[long_ax] = head
            panel = 0.05 if deluxe else 0.0
            if deluxe: W, Lg = 1.60, 2.00   # 3.5 m rooms and suites: 160 cm bed with a backdrop panel
            dh = wall_dist((c.x, c.y, z), hd)
            cl[long_ax] += head * (dh - panel - Lg / 2)
        me = build_bed((W, Lg, size[2]), head, bunk="Bunk" in fam)
        if deluxe:
            # cross axis in world terms (local x of the bed before turning), free space on each side for an end table
            cross = 1 - long_ax
            side = {}
            for s in (1, -1):
                d = [0, 0, 0]; d[cross] = s
                p0 = c.copy(); p0[long_ax] = c[long_ax] - bc[long_ax] + cl[long_ax]; p0[cross] = c[cross] - bc[cross] + cl[cross]
                side[s] = wall_dist((p0.x, p0.y, z), d)
            # slide the bed across so the free wall length is shared evenly: room for an end table on both sides if
            # the wall is long enough (the Revit bed sat off-centre, against the bathroom wall)
            span = side[1] + side[-1]; need = W / 2 + 0.05 + 0.40 + 0.02
            shift = (side[1] - side[-1]) / 2 if span >= 2 * need else 0.0
            if abs(shift) > 0.35:   # a long / open wall (corner rooms): only move as far as the short side needs
                short = 1 if side[1] < side[-1] else -1
                shift = -short * max(0.0, need - side[short])
                if abs(shift) > 0.35: shift = 0.0
            cl[cross] += shift; side[1] -= shift; side[-1] += shift
            log("  bed in %s: wall beside the head %.2f m (+%.2f / -%.2f), moved %.2f m across" % (room0, span, side[1], side[-1], shift))
            # local +x of the bed maps to world +x (length along y) or world -y (length along x, turned -90°)
            xmap = {1: side[1], -1: side[-1]} if long_ax == 1 else {1: side[-1], -1: side[1]}
            add_backdrop(me, W, Lg, head, xmap, room0)
        if long_ax == 0: me.transform(Matrix.Rotation(-math.pi / 2, 4, "Z"))   # built along y, the copy's length is along x
        me.transform(Matrix.Translation((cl[0], cl[1], z0)))                      # on the floor, head at the wall
        # parts of the family outside the frame (the floating nightstand) are kept, in light timber
        src = localize(first, insts[0][1])
        bm = bmesh.new(); bm.from_mesh(src); bm.faces.ensure_lookup_table()
        pad = 0.03
        outside = [] if deluxe else [f for f in bm.faces if not (bmn[0] - pad <= f.calc_center_median().x <= bmx[0] + pad and bmn[1] - pad <= f.calc_center_median().y <= bmx[1] + pad)]
        if outside:
            keep = set(outside)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context="FACES")
            for f in bm.faces: f.material_index = 0  # wood (first bed material)
            bm.from_mesh(me)  # + the bed
            merged = bpy.data.meshes.new("bed"); bm.to_mesh(merged)
            for m in me.materials: merged.materials.append(m)
            for p in merged.polygons: p.use_smooth = True
            me = merged
            log("  bed %s: kept %d faces outside the frame (nightstand)" % (fam, len(outside)))
        bm.free()
        kind = "bed"
    elif t == "shower":
        size = V.max(0) - V.min(0)
        c = insts[0][1].translation; z = float(verts_of(first)[:, 2].min()) + 1.0
        best = min(((ax, s) for ax in (0, 1) for s in (1, -1)), key=lambda a: wall_dist((c.x, c.y, z), [a[1] if i == a[0] else 0 for i in range(3)]))
        me = build_shower(size, best[0], best[1]); me.transform(Matrix.Translation((0, 0, float(V[:, 2].min()))))
        kind = "shower"
    elif t == "fridge":
        size = V.max(0) - V.min(0) if len(V) else np.array([0.9, 0.7, 1.68])
        me = build_fridge(size); me.transform(Matrix.Translation((0, 0, float(V[:, 2].min()) if len(V) else 0)))
        kind = "fridge"
    else:
        me = localize(first, insts[0][1])
        for i, m in enumerate(me.materials): me.materials[i] = clean_mat(m)
        n0 = n1 = sum(len(p.vertices) - 2 for p in me.polygons)
        if t == "decimate": me, n0, n1 = decimate(me, budget)
        for p in me.polygons: p.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(35))
        if first.get("category") == "Communication Devices": kind = "tv"
        elif fam.startswith("QARC Toilet") or fam.startswith("TOILET"): kind = "toilet"
        elif fam.startswith("QARC Basin"): kind = "basin"
    me.name = "%s__%s" % (kind, first["revit_id"])
    n_before = len(placed)
    place(me, insts, kind, fam)
    if t == "bed":  # remember where each bed's head and frame are (the room dressing uses them)
        hl = Vector((head if long_ax == 0 else 0, head if long_ax == 1 else 0, 0))
        for ob in placed[n_before:]:
            M = ob.matrix_world
            ob["head_dir"] = [float(x) for x in (M.to_3x3() @ hl).normalized()]
            ob["frame_center"] = [float(x) for x in M @ Vector((float(cl[0]), float(cl[1]), float(z0)))]
            ob["frame_size"] = [float(W), float(Lg)]
    r = report.setdefault(fam, {"treatment": t, "copies": 0, "tris_each_before": tris(first), "tris_each_after": sum(len(p.vertices) - 2 for p in me.polygons)})
    r["copies"] += len(insts)

# office chairs: Poly Haven modern_arm_chair_01 at the Revit chair positions (model.json "proxies")
if A["chair"]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(A["chair"]))
    parts = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    with bpy.context.temp_override(active_object=parts[0], object=parts[0], selected_objects=parts, selected_editable_objects=parts):
        bpy.ops.object.join()
    ch = parts[0]; ch.data.transform(ch.matrix_world); ch.matrix_world = Matrix.Identity(4)
    me = ch.data
    V = np.array([v.co for v in me.vertices]); c = (V.min(0) + V.max(0)) / 2
    s = float(A["chair_scale"])
    me.transform(Matrix.Rotation(math.radians(float(A["chair_yaw"])), 4, "Z") @ Matrix.Diagonal((s, s, s, 1)) @ Matrix.Translation((-c[0], -c[1], -V[:, 2].min())))
    me, n0, n1 = decimate(me, 2500)
    me.name = "desk_chair__polyhaven"
    # which way the chair model faces: away from its backrest (the vertices in the top 40 %)
    CV = np.array([v.co for v in me.vertices]); top = CV[CV[:, 2] > CV[:, 2].max() * 0.6]
    back = top[:, :2].mean(0) - (CV[:, :2].min(0) + CV[:, :2].max(0)) / 2
    chair_yaw0 = math.atan2(-back[1], -back[0])   # model's forward direction (radians, from +x)
    # desk tops: up-facing faces 0.65-0.85 m above their floor in the joinery / furniture placed above
    desks = []
    for o in placed:
        if o.type != "MESH" or o.get("kind") in ("bed", "tv", "toilet", "basin", "shower", "fridge", "chair"): continue
        pm = o.data.polygons; n = len(pm)
        if not n: continue
        nr = np.empty(n * 3); pm.foreach_get("normal", nr); ce = np.empty(n * 3); pm.foreach_get("center", ce); ar = np.empty(n); pm.foreach_get("area", ar)
        mw = np.array(o.matrix_world); n3 = np.linalg.inv(mw[:3, :3]).T
        nw = nr.reshape(-1, 3) @ n3.T; nw /= np.maximum(np.linalg.norm(nw, axis=1, keepdims=True), 1e-9)
        k = (nw[:, 2] > 0.9) & (ar > 0.04)
        if k.any(): desks.append(ce.reshape(-1, 3)[k] @ mw[:3, :3].T + mw[:3, 3])
    desks = np.concatenate(desks) if desks else np.zeros((0, 3))
    def desk_dir(p):
        """unit direction (snapped to x / y) from the chair at p towards the nearest desk top, or None"""
        if not len(desks): return None
        dz = desks[:, 2] - p.z
        cand = desks[(dz > 0.65) & (dz < 0.85)]
        if not len(cand): return None
        d2 = ((cand[:, :2] - (p.x, p.y)) ** 2).sum(1); k = int(d2.argmin())
        if d2[k] > 1.3 ** 2: return None
        v = cand[k, :2] - (p.x, p.y)
        return (math.copysign(1, v[0]), 0) if abs(v[0]) > abs(v[1]) else (0, math.copysign(1, v[1]))
    n_turned = 0
    for o in [o for o in bpy.data.objects if o not in before]: bpy.data.objects.remove(o)
    n = 0
    for px in model.get("proxies", []):
        for it in px["instances"]:
            m = it["m"]; M = Matrix(((m[0], m[4], m[8], m[12]), (m[1], m[5], m[9], m[13]), (m[2], m[6], m[10], m[14]), (0, 0, 0, 1)))
            # keep only the rotation + position (the family's own axes), uniform scale from the asset
            src = {"revit_id": "chair", "category": "Furniture", "family": "Plover Office Chair (Poly Haven modern_arm_chair_01)", "type": ""}
            p = M.translation; L = band_of(p.z + 0.01); room = room_at(p.x, p.y, p.z)
            ob = bpy.data.objects.new("%s_%s_chair" % (L, re.sub(r"[^A-Za-z0-9]", "", room) or "x"), me)
            dd = desk_dir(p)
            if dd is not None:   # face the desk (the Revit chair's own axes are 90° off from this model's)
                M = Matrix.Translation(p) @ Matrix.Rotation(math.atan2(dd[1], dd[0]) - chair_yaw0, 4, "Z"); n_turned += 1
            ob.matrix_world = M
            for k, v in src.items(): ob[k] = v
            ob["room"] = room; ob["kind"] = "chair"; ob["level"] = L; ob["bathroom"] = False; ob["tv"] = False; ob["collide"] = False
            bpy.data.collections[L].objects.link(ob); placed.append(ob); n += 1
    log("chairs: %d placed, %d turned to face their desk" % (n, n_turned))
    report["Plover Office Chair"] = {"treatment": "polyhaven modern_arm_chair_01", "copies": n, "tris_each_before": 355000, "tris_each_after": n1}

# ---------- clean up the import, report ----------
for o in list(coll_in.objects): bpy.data.objects.remove(o)
bpy.data.collections.remove(coll_in)
for m in [m for m in bpy.data.meshes if m.users == 0]: bpy.data.meshes.remove(m)
for m in [m for m in bpy.data.materials if m.users == 0]: bpy.data.materials.remove(m)
tri_out = sum(tris(o) for o in placed)
unique = {o.data.name for o in placed}
uniq_tris = sum(sum(len(p.vertices) - 2 for p in bpy.data.meshes[n].polygons) for n in unique)
log("placed %d objects from %d distinct meshes; triangles drawn %d (was %d), stored once %d" % (len(placed), len(unique), tri_out, tri_in, uniq_tris))
for fam, r in sorted(report.items(), key=lambda kv: -kv[1]["copies"] * kv[1]["tris_each_after"]):
    if r["treatment"] != "keep" or r["copies"] * r["tris_each_after"] > 3000:
        log("  %-52s %-30s x%-3d %6d -> %6d" % (fam[:52], r["treatment"], r["copies"], r["tris_each_before"], r["tris_each_after"]))
json.dump(report, open(os.path.join(common.REPO, "source", "compare", "phase3", "06_place_assets.json"), "w"), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"])
