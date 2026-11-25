"""05 - Audit of the furniture / fittings export (WEB_PLACEMENT): every distinct family with its instance count,
triangles per instance and in total, size, and the rooms it stands in.

  blender -b -P tools/blender/05_placement_audit.py -- --fbx source/revit/2026-11-25_WEB_PLACEMENT.fbx
         --placement source/revit/2026-11-25_placement.json --out source/compare/phase3/placement_audit

Triangles come from the FBX (object names end in "[revit id]"); family, type, category, level, room, size and transform
come from the read-only Revit export (placement.json). Revit in-place models ("Casework 12", "Furniture 7") are one-offs,
so they are grouped by category and size class instead of by name. Writes <out>.json and <out>.md. Changes nothing.
"""
import bpy, sys, os, re, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("fbx", None), ("placement", None), ("out", "source/compare/phase3/placement_audit")])
log = common.Log("05_audit")
for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials):
    for b in list(coll): coll.remove(b)
bpy.ops.import_scene.fbx(filepath=os.path.abspath(A["fbx"]), use_image_search=False)
recs = json.load(open(A["placement"]))
by_id = {r["id"]: r for r in recs}
tris, unnamed = {}, []
for o in bpy.context.scene.objects:
    if o.type != "MESH": continue
    me = o.data; me.calc_loop_triangles(); n = len(me.loop_triangles)
    m = re.search(r"\[(\d+)\]", o.name)
    if m and m.group(1) in by_id: tris[m.group(1)] = tris.get(m.group(1), 0) + n; continue
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    mw = np.array(o.matrix_world); w = co @ mw[:3, :3].T + mw[:3, 3]
    unnamed.append((o.name, (w.min(0) + w.max(0)) / 2, n))
# objects named by a hash instead of "[id]": the nearest element (bbox centre) whose family name starts the object name
for name, c, n in unnamed:
    cand = [r for r in recs if name.startswith(r["family"][:12])] or recs
    best = min(cand, key=lambda r: np.linalg.norm((np.array(r["bbox"][0]) + np.array(r["bbox"][1])) / 2 - c))
    tris[best["id"]] = tris.get(best["id"], 0) + n
log("FBX objects: %d with a Revit id, %d matched by family + position; triangles %d" % (len(tris), len(unnamed), sum(tris.values())))
# rooms from the Revit room outlines (model.json): which room the element's centre stands in
model = common.model_json()
def in_poly(x, y, pts):
    c = False
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
    return c
for r in recs:
    cx, cy = (r["bbox"][0][0] + r["bbox"][1][0]) / 2, (r["bbox"][0][1] + r["bbox"][1][1]) / 2; z = r["bbox"][0][2]
    rm = next((x for x in model["rooms"] if abs(z - x["z"]) < 1.5 and in_poly(cx, cy, x["outline"])), None)
    r["room"] = rm["name"].strip() if rm else "-"
INPLACE = re.compile(r"^(Casework|Furniture|Plumbing Fixtures) \d+$")
groups = {}
for r in recs:
    size = np.array(r["bbox"][1]) - np.array(r["bbox"][0])
    r["size"] = size.round(2).tolist(); r["tris"] = tris.get(r["id"], 0)
    if INPLACE.match(r["family"]):
        h = size[2]
        cls = "tall (wardrobe / shelving)" if h > 1.5 else "counter / desk height" if h > 0.6 else "low"
        key = ("%s (in-place)" % r["category"], cls)
    else:
        key = (r["category"], r["family"])
    groups.setdefault(key, []).append(r)

rows = []
for (cat, fam), rs in groups.items():
    t = [r["tris"] for r in rs]
    sizes = np.array([sorted(r["size"][:2]) + [r["size"][2]] for r in rs])
    rooms = {}
    for r in rs:
        k = re.sub(r"K\.\d{3}", "K.xxx", r["room"] or "-"); rooms[k] = rooms.get(k, 0) + 1
    rows.append({"category": cat, "family": fam, "count": len(rs), "tris_each": int(np.median(t)) if t else 0, "tris_total": int(sum(t)),
                 "size_m": np.median(sizes, axis=0).round(2).tolist(), "rooms": dict(sorted(rooms.items(), key=lambda kv: -kv[1])[:4]),
                 "in_fbx": sum(1 for r in rs if r["id"] in tris), "ids": [r["id"] for r in rs]})
rows.sort(key=lambda r: -r["tris_total"])
os.makedirs(os.path.dirname(os.path.abspath(A["out"])), exist_ok=True)
json.dump(rows, open(A["out"] + ".json", "w"), indent=1)
with open(A["out"] + ".md", "w", encoding="utf8") as f:
    f.write("| Category | Family | Count | Tris each | Tris total | Size (w x d x h, m) | Rooms |\n|---|---|---:|---:|---:|---|---|\n")
    for r in rows:
        f.write("| %s | %s | %d | %s | %s | %s | %s |\n" % (r["category"], r["family"], r["count"], format(r["tris_each"], ","), format(r["tris_total"], ","),
                " x ".join("%.2f" % v for v in r["size_m"]), ", ".join("%s %d" % kv for kv in r["rooms"].items())))
log("groups", len(rows), "total triangles", sum(r["tris_total"] for r in rows))
for r in rows: log("%-28s %-58s x%-3d each %7d total %8d size %s rooms %s" % (r["category"], r["family"][:58], r["count"], r["tris_each"], r["tris_total"], r["size_m"], r["rooms"]))
