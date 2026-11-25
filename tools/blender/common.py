"""Shared helpers for the tools/blender/*.py scripts (imported by each script; not run on its own)."""
import bpy, sys, os, json, re, math, time
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
# ifcopenshell (from Bonsai's bundled wheel) lives in a short path: the repo path is too long for its files
PYLIB = os.environ.get("STIN_PYLIB", r"D:\WinTemp\claude\f6a292be079a5b7e\9bb59eaf-625c-4b48-8ed2-aae5b56e8d5d\scratchpad\pylib")


def args(spec):
    """spec: list of (name, default) ; flags have default False. Returns a dict from the args after '--'."""
    import argparse
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    for name, default in spec:
        if default is False: ap.add_argument("--" + name, action="store_true")
        else: ap.add_argument("--" + name, default=default)
    return vars(ap.parse_args(argv))


class Log:
    def __init__(self, tag): self.tag, self.t0 = tag, time.time()
    def __call__(self, *s): print("[%s %5.1fs]" % (self.tag, time.time() - self.t0), *s, flush=True)


def model_json():
    return json.load(open(os.path.join(REPO, "data", "model.json"), encoding="utf8"))


# Levels (Revit z, metres). A level's objects run from just under its slab (slab 0.155 m thick, see AUDIT.md) to just
# under the next level's slab, so a floor belongs to the level you stand on and beams hang in the level below.
SLAB = 0.16
def level_bands():
    lv = model_json()["levels"]  # Ground -0.15, Level 1 0, Level 2 4, Level 3 8, Level 4 12, Roof 16
    z = [l["z"] for l in lv]
    cuts = {"L1": z[1] - SLAB, "L2": z[2] - SLAB, "L3": z[3] - SLAB, "L4": z[4] - SLAB, "ROOF": z[5] - SLAB}
    # L0 = below Level 1's slab (foundations), L1 .. L4, ROOF = above the roof slab underside
    return [("L0", -1e9, cuts["L1"]), ("L1", cuts["L1"], cuts["L2"]), ("L2", cuts["L2"], cuts["L3"]),
            ("L3", cuts["L3"], cuts["L4"]), ("L4", cuts["L4"], cuts["ROOF"]), ("ROOF", cuts["ROOF"], 1e9)]


def ifc_category(ifc_class, name, predefined):
    """IFC class + Revit name -> the Revit category the website code expects (see AUDIT.md section 2)."""
    n = (name or "").lower()
    if ifc_class == "IfcWall": return "Walls"
    if ifc_class == "IfcSlab":
        return {"LANDING": "Landings", "ROOF": "Roofs"}.get(predefined, "Floors")
    if ifc_class == "IfcCovering": return "Ceilings"
    if ifc_class == "IfcColumn": return "Structural Columns" if ("kolom" in n or "structural" in n or "concrete" in n) else "Columns"
    if ifc_class == "IfcBeam": return "Structural Framing"
    if ifc_class == "IfcPlate": return "Curtain Panels"
    if ifc_class == "IfcMember": return "Curtain Wall Mullions"
    if ifc_class == "IfcDoor": return "Doors"
    if ifc_class == "IfcWindow": return "Windows"
    if ifc_class == "IfcRailing": return "Railings"
    if ifc_class in ("IfcStairFlight", "IfcStair"): return "Runs"
    if ifc_class == "IfcRoof": return "Roofs"
    if ifc_class == "IfcBuildingElementProxy": return "Hardscape" if "hardscape" in n else "Generic Models"
    return ifc_class


def import_ifc(path, coll, log=print):
    """Every IFC element -> one mesh object in `coll` (Revit internal coordinates, metres), with per-face Blender
    materials named exactly like the Revit materials, and properties revit_id / revit_name / ifc_class / category /
    storey (+ door_w / door_h). Returns the objects."""
    import numpy as np, multiprocessing
    sys.path.insert(0, PYLIB)
    import ifcopenshell, ifcopenshell.geom, ifcopenshell.util.element as ue
    f = ifcopenshell.open(path)
    style_name = {}
    for s in f.by_type("IfcSurfaceStyle"):
        for r in s.Styles or []: style_name[r.id()] = s.Name
    st = ifcopenshell.geom.settings(); st.set("use-world-coords", True)
    it = ifcopenshell.geom.iterator(st, f, multiprocessing.cpu_count(), exclude=("IfcOpeningElement", "IfcSpace"))
    mats, out = {}, []
    def material(name, diffuse, transparency):
        m = mats.get(name) or bpy.data.materials.get(name)
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
    if it.initialize():
        while True:
            sh = it.get(); g = sh.geometry; el = f.by_id(sh.id)
            v = np.array(g.verts, dtype=np.float64).reshape(-1, 3); fc = np.array(g.faces, dtype=np.int32).reshape(-1, 3)
            if len(fc):
                cat = ifc_category(el.is_a(), el.Name, getattr(el, "PredefinedType", None))
                me = bpy.data.meshes.new(f"{cat}_{el.Tag}")
                me.vertices.add(len(v)); me.vertices.foreach_set("co", v.ravel())
                me.loops.add(fc.size); me.loops.foreach_set("vertex_index", fc.ravel())
                me.polygons.add(len(fc)); me.polygons.foreach_set("loop_start", np.arange(0, fc.size, 3, dtype=np.int32))
                mids = np.array(g.material_ids, dtype=np.int32) if len(g.material_ids) else np.zeros(len(fc), np.int32)
                slot_of = {}
                for mi in np.unique(mids):
                    if mi < 0: name, dif, tr = "Default", None, 0
                    else:
                        gm = g.materials[mi]
                        tail = gm.name.split("-")[-1]
                        name = style_name.get(int(tail), gm.name) if tail.isdigit() else gm.name
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
                out.append(ob)
            if not it.next(): break
    log("IFC %s: %d elements, %d materials (ifcopenshell %s)" % (os.path.basename(path), len(out), len(mats), ifcopenshell.version))
    return out


# readable check colours for the clean materials (README targets: plaster #F2E6D7 / #E0D4C4, timber #9A7A60);
# check renders only - the real materials come in Phase 4
PALETTE = {"M_plaster_cream": "E9DCCB", "M_plaster_grey": "C9C4BC", "M_concrete": "B8B3AB", "M_tile_floor": "D8D0C4",
           "M_teak_batten": "E0D4C4", "M_teak_timber": "9A7A60", "M_teak_deck": "8A6A50", "M_wood_light": "A9825C",
           "M_metal_dark": "2E2F31", "M_metal_grey": "6E6E6C", "M_metal_brushed": "A8A8A6", "M_chrome": "D0D0D0",
           "M_plastic_white": "EEEEEA", "M_plastic_black": "1E1F21", "M_roof_shingle": "4B4B4B", "M_site_paving": "8C8A84",
           "M_glass_clear": "4F5C5C", "M_glass_frosted": "E8F2F2", "M_water": "4FA3B5", "M_porcelain": "F4F3EF",
           "M_fabric_bedding": "E4DCCD", "M_fabric_sheet": "EFEDE7", "M_fabric_throw": "9E9A90", "M_fabric_sofa": "8E8A84",
           "M_screen": "101114", "M_lacquer_cream": "E6DCCB"}
def apply_palette():
    import bpy
    for m in bpy.data.materials:
        h = PALETTE.get(m.name)
        if h and m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
            c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
            c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
            m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*c, 1)
            m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 1.0
    for m in bpy.data.materials:
        if any(k in m.name.lower() for k in ("glass", "glazing", "water")):
            try: m.surface_render_method = "BLENDED"
            except Exception: pass
            if m.use_nodes and "Principled BSDF" in m.node_tree.nodes: m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.25


def material_map():
    m = json.load(open(os.path.join(HERE, "material_map.json"), encoding="utf8"))
    out = {}
    for clean, names in m.items():
        if clean.startswith("_note"): continue
        for n in names: out[n] = clean if clean != "_drop" else None
    return out


def clean_material(revit_name, mmap):
    if revit_name in mmap: return mmap[revit_name]
    return "M_rv_" + re.sub(r"[^A-Za-z0-9]+", "_", revit_name).strip("_")[:40]


def tri_count(objs):
    n = 0
    for o in objs:
        if o.type != "MESH": continue
        me = o.data
        n += sum(len(p.vertices) - 2 for p in me.polygons)
    return n


def collection(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


# ---- the website's camera (main.js: overviewView, flyToRender, viewDir) in Blender / Revit coordinates ----
ROOT_OFFSET = (1.2961, 0.0, -1.8122)  # site world = root-local + this (AUDIT.md section 5)
def site_to_revit(p):
    """site world (three.js, y up) -> Revit / Blender (z up)."""
    x, y, z = p[0] - ROOT_OFFSET[0], p[1] - ROOT_OFFSET[1], p[2] - ROOT_OFFSET[2]
    return Vector((x, -z, y))

def site_render_cameras():
    """One camera per exterior render pin (js/config.js renders[] az / el / dist), placed like flyToRender()."""
    cfg = open(os.path.join(REPO, "js", "config.js"), encoding="utf8").read()
    pins = []
    for block in cfg.splitlines():  # one render per line: { file: "r01.jpg", title: {...}, az: -38, el: 36, dist: 2.2 },
        m = re.search(r'file:\s*"([^"]+)"', block)
        if not m: continue
        az = re.search(r"\baz:\s*(-?[\d.]+)", block); el = re.search(r"\bel:\s*(-?[\d.]+)", block)
        dist = re.search(r"\bdist:\s*(-?[\d.]+)", block)
        if az and el: pins.append({"file": m.group(1), "az": float(az.group(1)), "el": float(el.group(1)), "dist": float(dist.group(1)) if dist else 1.0})
    # building box in site world coordinates (centred), from main.js: size.y * 0.35 target, radius = max(size.x, size.z) / 2
    sx, sy, sz = 48.6658, 20.3, 21.6502  # buildingBox size measured on the site (AUDIT.md: (-24.33, -3.8, -10.83) .. (24.33, 16.5, 10.83))
    radius = max(sx, sz) * 0.5
    target_site = (0.0, sy * 0.35, 0.0)
    cams = []
    for p in pins:
        az, el = math.radians(p["az"]), math.radians(p["el"])
        d = (math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el))
        r = radius * 1.9 * p["dist"]
        pos = (target_site[0] + d[0] * r, target_site[1] + d[1] * r, target_site[2] + d[2] * r)
        cams.append({"name": "CAM_" + os.path.splitext(p["file"])[0], "file": p["file"], "pos": site_to_revit(pos), "target": site_to_revit(target_site)})
    return cams
