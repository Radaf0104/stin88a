"""06b - Room dressing for the furnished room types (pilot: K.305), after the room3 interior renders.

  blender -b source/blender/stin88a_06_furnished.blend -P tools/blender/06b_dress_room.py -- --rooms K.305
          --plant <dir>/potted_plant_04_1k.gltf --out source/blender/stin88a_06b_dressed.blend

Everything is placed by rules from the room's own Revit joinery, so the same script can dress every room of a type:
* LED strips (emissive, baked into the lightmap as light sources):
    - along the top of the headboard wall panel (in-place casework whose top is 0.9-1.3 m above the floor): the top
      faces are copied 3 mm up as an emissive strip -> wall wash above the panel;
    - under the desk top and under floating consoles (downward faces 0.1-0.85 m above the floor) -> light on the floor;
    - behind the TV: an emissive panel 3 cm behind the screen, 10 % bigger -> halo on the wall.
* globe lamp on the bed's floating nightstand, a drum table lamp on the desk (emissive shade / globe);
* linen curtain (pleated, floor to ceiling) at the side of each glass door / window of the room;
* rug under the bed (towards the foot), books / storage box / plant on the TV console, green cushion on the pillows.
Every new object gets room / kind / lm_set like the furniture, so 07 lightmaps and 10 bakes include it.
Idempotent: reads the 06 output and writes a new file.
"""
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("rooms", "K.305"), ("plant", None), ("out", "source/blender/stin88a_06b_dressed.blend")])
log = common.Log("06b_dress")
model = common.model_json()

def mat(name, rgb, emit=0.0, rough=0.6):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name); m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in rgb]
        b.inputs["Base Color"].default_value = (*c, 1); b.inputs["Roughness"].default_value = rough; m.diffuse_color = (*c, 1)
        if emit:
            b.inputs["Emission Color"].default_value = (*c, 1); b.inputs["Emission Strength"].default_value = emit
    return m
LED = lambda: mat("M_led_warm", (1.0, 0.87, 0.70), emit=5.0)   # ~2700-3000 K, not orange
GLOBE = lambda: mat("M_lamp_globe", (1.0, 0.86, 0.66), emit=4.0, rough=0.3)
SHADE = lambda: mat("M_lamp_shade", (0.98, 0.9, 0.78), emit=2.0, rough=0.8)
BRASS = lambda: mat("M_brass", (0.72, 0.56, 0.32), rough=0.3)

def verts_world(o):
    return np.array([o.matrix_world @ v.co for v in o.data.vertices])
def new_obj(name, me, room, L, kind, lm):
    ob = bpy.data.objects.new(name, me)
    ob["room"] = room; ob["kind"] = kind; ob["level"] = L; ob["category"] = "Dressing"; ob["collide"] = False
    ob["bathroom"] = False; ob["tv"] = False; ob["lm_set"] = lm
    bpy.data.collections[L].objects.link(ob)
    return ob
def box(bm, size, center, bevel=0.0, segs=1, mi=0):
    r = bmesh.ops.create_cube(bm, size=1.0); vs = r["verts"]
    for v in vs: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + Vector(center)
    before = set(bm.faces)
    if bevel: bmesh.ops.bevel(bm, geom=list({e for v in vs for e in v.link_edges}), offset=bevel, segments=segs, affect="EDGES", clamp_overlap=True)
    for f in bm.faces:
        if f not in before or any(v in vs for v in f.verts): f.material_index = mi
def faces_copy(o, test, lift, material, name):
    """copy the faces of o that pass test(world centre, world normal) as a new mesh, lifted along their normal"""
    me = o.data; mw = o.matrix_world; nm = mw.to_3x3().inverted().transposed()
    bm = bmesh.new()
    for p in me.polygons:
        n = (nm @ p.normal).normalized(); c = mw @ p.center
        if not test(c, n): continue
        vs = [bm.verts.new(mw @ me.vertices[i].co + n * lift) for i in p.vertices]
        try: bm.faces.new(vs)
        except ValueError: pass
    if not bm.faces: bm.free(); return None
    out = bpy.data.meshes.new(name); bm.to_mesh(out); bm.free(); out.materials.append(material)
    return out

def dress(room_name):
    r = next(x for x in model["rooms"] if x["name"].strip() == room_name)
    z0 = r["z"]; pts = np.array(r["outline"]); mn, mx = pts.min(0), pts.max(0)
    objs = [o for o in bpy.data.objects if o.type == "MESH" and o.get("room") in (room_name, "KM " + room_name)]
    L = objs[0]["level"] if objs else "L3"; lm = "LM_" + room_name.replace(".", "")
    tag = room_name.replace(".", "")
    made = []
    # --- LED strips on the joinery ---
    for o in objs:
        if not str(o.get("family", "")).startswith(("Casework", "Furniture")): continue
        V = verts_world(o); top = V[:, 2].max() - z0
        if 0.9 <= top <= 1.3:   # headboard wall panel: its top faces glow (wall wash)
            me = faces_copy(o, lambda c, n: n.z > 0.9 and c.z > z0 + top - 0.02, 0.003, LED(), "led_headboard")
            if me: made.append(new_obj("%s_%s_led_headboard" % (L, tag), me, room_name, L, "led", lm))
        me = faces_copy(o, lambda c, n: n.z < -0.9 and z0 + 0.1 < c.z < z0 + 0.85, 0.003, LED(), "led_under")
        if me: made.append(new_obj("%s_%s_led_under_%s" % (L, tag, o.get("kind")), me, room_name, L, "led", lm))
    # --- TV halo ---
    for o in [o for o in objs if o.get("kind") == "tv"]:
        V = verts_world(o); a, b = V.min(0), V.max(0); s = b - a; c = (a + b) / 2
        thin = 0 if s[0] < s[1] else 1; wide = 1 - thin
        room_c = (mn + mx) / 2; into = 1 if room_c[thin] > c[thin] else -1   # the screen faces into the room
        bm = bmesh.new()
        size = [0, 0, s[2] * 0.9]; size[thin] = 0.005; size[wide] = s[wide] * 0.9   # hidden behind the screen: only its glow on the wall shows
        cc = c.copy(); cc[thin] = (a[thin] if into > 0 else b[thin]) - into * 0.0
        cc[thin] = c[thin] - into * (s[thin] / 2 + 0.012)
        box(bm, size, cc)
        me = bpy.data.meshes.new("tv_halo"); bm.to_mesh(me); bm.free(); me.materials.append(LED())
        made.append(new_obj("%s_%s_led_tv" % (L, tag), me, room_name, L, "led", lm))
    # --- the bed: globe lamp on its nightstand, green cushion, rug ---
    beds = [o for o in objs if o.get("kind") == "bed" and "head_dir" in o]
    for bed in beds:
        hd = Vector(bed["head_dir"]); fc = Vector(bed["frame_center"]); W, Lg = bed["frame_size"]
        side = Vector((-hd.y, hd.x, 0))
        # nightstand = wood faces of the bed mesh above 0.38 m
        me = bed.data; mw = bed.matrix_world
        wood = [i for i, m in enumerate(me.materials) if m and "wood" in m.name]
        ns = [mw @ p.center for p in me.polygons if p.material_index in wood and (mw @ p.center).z > z0 + 0.38 and p.normal.length > 0]
        if ns:
            nc = Vector(np.mean([tuple(v) for v in ns], 0)); ntop = max(v.z for v in ns)
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=0.11, matrix=Matrix.Translation((nc.x, nc.y, ntop + 0.25)))
            for f in bm.faces: f.material_index = 0
            r2 = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.006, radius2=0.006, depth=0.16, matrix=Matrix.Translation((nc.x, nc.y, ntop + 0.08)))
            for f in {f for v in r2["verts"] for f in v.link_faces}: f.material_index = 1
            r3 = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.06, radius2=0.06, depth=0.01, matrix=Matrix.Translation((nc.x, nc.y, ntop + 0.005)))
            for f in {f for v in r3["verts"] for f in v.link_faces}: f.material_index = 1
            me2 = bpy.data.meshes.new("globe_lamp"); bm.to_mesh(me2); bm.free(); me2.materials.append(GLOBE()); me2.materials.append(BRASS())
            for p in me2.polygons: p.use_smooth = True
            made.append(new_obj("%s_%s_globe_lamp" % (L, tag), me2, room_name, L, "lamp", lm))
        # green cushion in front of the pillows
        head_pt = fc + hd * (Lg / 2 - 0.42)
        bm = bmesh.new(); box(bm, (0.42, 0.13, 0.34), (0, 0, 0), 0.06, 4)
        me3 = bpy.data.meshes.new("cushion"); bm.to_mesh(me3); bm.free(); me3.materials.append(mat("M_fabric_sage", (0.55, 0.60, 0.47), rough=0.95))
        for p in me3.polygons: p.use_smooth = True
        cu = new_obj("%s_%s_cushion" % (L, tag), me3, room_name, L, "cushion", lm)
        ang = math.atan2(side.y, side.x)
        cu.matrix_world = Matrix.Translation((head_pt.x, head_pt.y, z0 + 0.66)) @ Matrix.Rotation(ang, 4, "Z") @ Matrix.Rotation(math.radians(-18), 4, "X") if False else \
            Matrix.Translation((head_pt.x, head_pt.y, z0 + 0.68)) @ Matrix.Rotation(ang, 4, "Z")
        made.append(cu)
        # rug: centred on the bed, shifted towards the foot, wider than the bed
        rc = fc - hd * 0.35
        # one rectangle, (bed width + 0.7 m) x (up to 2.4 m), 6 mm above the floor, facing UP
        bm = bmesh.new()
        rw, rl = W + 0.7, min(Lg + 0.3, 2.4)
        base = Vector((rc.x, rc.y, z0 + 0.006))
        corners = [base + side * (sx * rw / 2) + hd * (sy * rl / 2) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        n = (corners[1] - corners[0]).cross(corners[2] - corners[1])
        if n.z < 0: corners.reverse()
        bm.faces.new([bm.verts.new(c) for c in corners])
        me4 = bpy.data.meshes.new("rug"); bm.to_mesh(me4); bm.free(); me4.materials.append(mat("M_rug", (0.86, 0.83, 0.78), rough=1.0))
        made.append(new_obj("%s_%s_rug" % (L, tag), me4, room_name, L, "rug", lm))
    # --- desk lamp: on the desk top (upward joinery faces 0.65-0.85 m), at the end furthest from the bed head ---
    desk_tops = []
    for o in objs:
        if not str(o.get("family", "")).startswith(("Casework", "Furniture")): continue
        mw = o.matrix_world; nm = mw.to_3x3().inverted().transposed()
        for p in o.data.polygons:
            n = (nm @ p.normal).normalized(); c = mw @ p.center
            if n.z > 0.9 and z0 + 0.65 < c.z < z0 + 0.85 and p.area > 0.05: desk_tops.append((p.area, c))
    if desk_tops:
        c = max(desk_tops, key=lambda t: t[0])[1]
        bm = bmesh.new()
        rr = bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=0.15, radius2=0.12, depth=0.22, matrix=Matrix.Translation((c.x, c.y, c.z + 0.36)))
        for f in {f for v in rr["verts"] for f in v.link_faces}: f.material_index = 0
        r2 = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.008, radius2=0.008, depth=0.27, matrix=Matrix.Translation((c.x, c.y, c.z + 0.135)))
        for f in {f for v in r2["verts"] for f in v.link_faces}: f.material_index = 1
        r3 = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.07, radius2=0.07, depth=0.012, matrix=Matrix.Translation((c.x, c.y, c.z + 0.006)))
        for f in {f for v in r3["verts"] for f in v.link_faces}: f.material_index = 1
        me5 = bpy.data.meshes.new("desk_lamp"); bm.to_mesh(me5); bm.free(); me5.materials.append(SHADE()); me5.materials.append(BRASS())
        for p in me5.polygons: p.use_smooth = True
        made.append(new_obj("%s_%s_desk_lamp" % (L, tag), me5, room_name, L, "lamp", lm))
    # --- console decor: books + storage box (+ plant) on the floating console(s) (top 0.3-0.6 m) ---
    for o in objs:
        if not str(o.get("family", "")).startswith("Furniture"): continue
        V = verts_world(o); a, b = V.min(0), V.max(0); top = b[2] - z0
        if not (0.25 < top < 0.6 and (b - a)[:2].max() > 0.8): continue
        s = b - a; long = 0 if s[0] > s[1] else 1
        bm = bmesh.new()
        p0 = (a + b) / 2; p0[2] = b[2]
        def at(t): q = p0.copy(); q[long] += t * s[long]; return q
        q = at(0.28); box(bm, (0.22 if long else 0.16, 0.16 if long else 0.22, 0.04), (q[0], q[1], q[2] + 0.02), 0.003, 1, 0)
        box(bm, (0.2 if long else 0.15, 0.15 if long else 0.2, 0.03), (q[0], q[1], q[2] + 0.055), 0.003, 1, 1)
        q = at(-0.25)
        rr = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.07, matrix=Matrix.Translation((q[0], q[1], q[2] + 0.07)))
        for f in {f for v in rr["verts"] for f in v.link_faces}: f.material_index = 2
        me6 = bpy.data.meshes.new("console_decor"); bm.to_mesh(me6); bm.free()
        for m in (mat("M_book_cream", (0.90, 0.87, 0.80)), mat("M_book_sage", (0.62, 0.66, 0.58)), mat("M_ceramic_vase", (0.93, 0.90, 0.85), rough=0.4)): me6.materials.append(m)
        for p in me6.polygons: p.use_smooth = True
        made.append(new_obj("%s_%s_decor_console" % (L, tag), me6, room_name, L, "decor", lm))
        if A["plant"]:
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=os.path.abspath(A["plant"]))
            parts = [x for x in bpy.data.objects if x not in before and x.type == "MESH"]
            if parts:
                with bpy.context.temp_override(active_object=parts[0], object=parts[0], selected_objects=parts, selected_editable_objects=parts):
                    bpy.ops.object.join()
                pl = parts[0]; pl.data.transform(pl.matrix_world); pl.matrix_world = Matrix.Identity(4)
                PV = np.array([v.co for v in pl.data.vertices]); k = 0.32 / max(1e-3, PV[:, 2].max() - PV[:, 2].min())
                pl.data.transform(Matrix.Diagonal((k, k, k, 1)) @ Matrix.Translation((-PV[:, 0].mean(), -PV[:, 1].mean(), -PV[:, 2].min())))
                q = at(0.0); pl.location = (q[0], q[1], q[2])
                for x in [x for x in bpy.data.objects if x not in before and x is not pl]: bpy.data.objects.remove(x)
                for c in list(pl.users_collection): c.objects.unlink(pl)
                bpy.data.collections[L].objects.link(pl); pl.name = "%s_%s_plant" % (L, tag)
                for k2, v2 in (("room", room_name), ("kind", "plant"), ("level", L), ("category", "Dressing"), ("collide", False), ("bathroom", False), ("tv", False), ("lm_set", lm)): pl[k2] = v2
                made.append(pl)
    # --- curtains at the glass doors / windows of the room (doors with glass in this room, outside the bathroom) ---
    for d in [o for o in bpy.data.objects if o.type == "MESH" and o.get("kind") == "door"]:
        if not any(m and "glass" in m.name for m in d.data.materials): continue
        V = verts_world(d); a, b = V.min(0), V.max(0); c = (a + b) / 2
        if not (mn[0] - 0.3 < c[0] < mx[0] + 0.3 and mn[1] - 0.3 < c[1] < mx[1] + 0.3 and abs(a[2] - z0) < 0.3): continue
        s = b - a; thin = 0 if s[0] < s[1] else 1; wide = 1 - thin
        room_c = (mn + mx) / 2; into = 1 if room_c[thin] > c[thin] else -1
        frame_w = max(s[wide], 0.9)
        # a bunched curtain at one end of the opening (the end away from the bed head if there is a bed)
        cw, ch = 0.55, r["height"] - 0.03
        end = 1
        if beds:
            hd = Vector(beds[0]["head_dir"]); end = -1 if hd[wide] * 1 > 0 else 1
        cx = c[wide] + end * (frame_w / 2 + 0.05)
        bm = bmesh.new()
        nx, nz = 28, 2
        for i in range(nx + 1):
            for j in range(nz + 1):
                t = i / nx
                off = 0.035 * math.sin(t * math.pi * 10)                       # pleats
                p = [0, 0, z0 + 0.01 + ch * j / nz]
                p[wide] = cx + (t - 0.5) * cw; p[thin] = c[thin] + into * (0.16 + off)
                bm.verts.new(p)
        bm.verts.ensure_lookup_table()
        for i in range(nx):
            for j in range(nz):
                k = i * (nz + 1) + j
                bm.faces.new((bm.verts[k], bm.verts[k + nz + 1], bm.verts[k + nz + 2], bm.verts[k + 1]))
        me7 = bpy.data.meshes.new("curtain"); bm.to_mesh(me7); bm.free(); me7.materials.append(mat("M_fabric_curtain", (0.66, 0.60, 0.52), rough=0.95))
        for p in me7.polygons: p.use_smooth = True
        made.append(new_obj("%s_%s_curtain" % (L, tag), me7, room_name, L, "curtain", lm))
    log("%s: %d dressing objects: %s" % (room_name, len(made), sorted({o.get("kind") for o in made})))
    return made

for rm in A["rooms"].split(","): dress(rm.strip())
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"])
