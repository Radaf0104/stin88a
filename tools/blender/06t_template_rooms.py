"""06t - Template rooms: every guest room gets the furniture of one dressed template room of its width.

  blender -b source/blender/stin88a_06b_dressed.blend -P tools/blender/06t_template_rooms.py --
          [--table data/room_templates.json] --out source/blender/stin88a_06t_templated.blend

Client brief (2026-11-26): 3 m rooms copy K.405, 3.5 m rooms copy K.407, 4 m rooms copy K.413 ("mirror and rotate as
needed ... remove the other, then duplicate these room accordingly").
* Input table: data/room_templates.json (tools/room-templates.mjs): per room its width class, template and a 4x4 matrix
  (column-major, building frame = Blender frame) taking the template room onto it - rotated so the entrance and
  facade match, mirrored when the bathroom is on the other side, anchored on the facade wall.
* In every non-template room, everything placed per room (furniture, joinery, TVs, bathroom fittings, dressing: objects
  with a `room` property, structure and doors excluded) is deleted; then each template object is added again as a
  linked duplicate (shares its mesh: stored once in the glTF) with matrix = room matrix @ template matrix.
  Mirrored copies have a negative determinant; the glTF export and tools/pack-levels.mjs handle that (winding flipped).
* Copies get the target room's room / level; lm_set is cleared (template copies are not lightmapped).
* Rooms of class "other" are left as they are and listed in the log.
Idempotent: reads the 06b output and writes a new file.
"""
import bpy, sys, os, json
from mathutils import Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("table", os.path.join(common.REPO, "data", "room_templates.json")),
                 ("out", "source/blender/stin88a_06t_templated.blend")])
log = common.Log("06t_templates")
table = json.load(open(A["table"], encoding="utf8"))
STRUCT = {"shell", "ceiling", "stair", "railing", "doorframe", "door"}

def room_objs(label):
    return [o for o in bpy.data.objects if o.type == "MESH" and o.get("room") in (label, "KM " + label)
            and o.get("kind") not in STRUCT]

templates = set(table["templates"].values())
tobjs = {t: room_objs(t) for t in templates}
for t, objs in tobjs.items():
    kinds = {}
    for o in objs: kinds[o.get("kind")] = kinds.get(o.get("kind"), 0) + 1
    log("template %s: %d objects %s" % (t, len(objs), dict(sorted(kinds.items()))))
    if not objs: raise SystemExit("template %s has no furniture - dress it first (06b)" % t)

removed = added = 0
for r in table["rooms"]:
    label = r["label"]
    if r.get("isTemplate") or label in templates: continue
    if r["widthClass"] == "other" or not r.get("template"):
        log("left as is (class %s): %s" % (r["widthClass"], label)); continue
    e = r["matrix"]
    M = Matrix(((e[0], e[4], e[8], e[12]), (e[1], e[5], e[9], e[13]), (e[2], e[6], e[10], e[14]), (e[3], e[7], e[11], e[15])))
    L = "L%d" % r["level"]
    old = room_objs(label)
    for o in old: bpy.data.objects.remove(o, do_unlink=True)
    removed += len(old)
    for src in tobjs[r["template"]]:
        ob = src.copy()                       # linked duplicate: same mesh data
        ob.matrix_world = M @ src.matrix_world
        ob["room"] = ("KM " + label) if str(src.get("room", "")).startswith("KM ") else label
        ob["level"] = L
        if "lm_set" in ob: ob["lm_set"] = ""
        ob.name = "%s_%s_%s" % (L, label.replace(".", ""), src.get("kind", "obj"))
        bpy.data.collections[L].objects.link(ob)
        added += 1
    log("%s <- %s (%s m%s, %d deg): removed %d, added %d" % (label, r["template"], r["widthClass"],
        ", mirrored" if r.get("mirror") else "", r.get("rotationDeg", 0), len(old), len(tobjs[r["template"]])))

log("total: removed %d objects, added %d linked copies" % (removed, added))
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(A["out"]), compress=True)
log("saved", A["out"])
