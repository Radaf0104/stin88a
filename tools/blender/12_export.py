"""12 - Export one glTF per level collection (L0, L1, L2, L3, L4, ROOF, SITE) for the website.

  blender -b source/blender/stin88a_08_materials.blend -P tools/blender/12_export.py -- --out source/glb_raw

* glTF 2.0, +Y up, modifiers applied, both UV sets (TEXCOORD_0 = UVMap for textures, TEXCOORD_1 = UVMap_LM for the
  lightmap), normals on, tangents off, no cameras / lights / animation, object names kept, custom properties exported
  as extras (-> userData on the site: level, kind, category, room, lm_set, collide, bathroom, tv, door_*).
* Format GLTF_SEPARATE with images as JPEG in one shared folder (tools/pack-levels.mjs turns them into KTX2 once and
  every level points at the same files, so shared textures download once).
* Furniture copies that share a mesh are exported as nodes sharing one glTF mesh (stored once).
* The log lists per level: nodes, meshes, triangles, and how many meshes carry TEXCOORD_1 (checked in the written file).
"""
import bpy, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("out", "source/glb_raw"), ("levels", "L0,L1,L2,L3,L4,ROOF,SITE")])
log = common.Log("12_export")
out = os.path.abspath(A["out"]); os.makedirs(out, exist_ok=True)
vl = bpy.context.view_layer
# glTF exports UV maps in their order: make sure UVMap comes before UVMap_LM everywhere
for me in bpy.data.meshes:
    names = [u.name for u in me.uv_layers]
    if "UVMap" in names and "UVMap_LM" in names and names.index("UVMap") > names.index("UVMap_LM"):
        log("warning: %s has UVMap_LM before UVMap" % me.name)
    if "UVMap" in names: me.uv_layers["UVMap"].active_render = True
report = {}
for L in A["levels"].split(","):
    col = bpy.data.collections.get(L)
    if not col: continue
    objs = [o for o in col.all_objects if o.type == "MESH"]
    for o in vl.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    if not objs: continue
    vl.objects.active = objs[0]
    path = os.path.join(out, L + ".gltf")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLTF_SEPARATE", export_texture_dir="tex", use_selection=True,
                              export_yup=True, export_apply=True, export_texcoords=True, export_normals=True, export_tangents=False,
                              export_cameras=False, export_lights=False, export_animations=False, export_extras=True,
                              export_image_format="JPEG", export_jpeg_quality=92, export_materials="EXPORT")
    g = json.load(open(path, encoding="utf8"))
    meshes = g.get("meshes", [])
    tc1 = sum(1 for m in meshes if any("TEXCOORD_1" in p["attributes"] for p in m["primitives"]))
    lm_nodes = sum(1 for n in g.get("nodes", []) if n.get("extras", {}).get("lm_set", "").startswith("LM_") and "mesh" in n)
    tris = sum(common.tri_count([o]) for o in objs)
    report[L] = {"nodes": len(g.get("nodes", [])), "meshes": len(meshes), "triangles": tris, "meshes_with_TEXCOORD_1": tc1, "materials": len(g.get("materials", []))}
    log("%-4s nodes %4d  meshes %4d  triangles %7d  materials %3d  meshes with TEXCOORD_1 %d" % (L, len(g.get("nodes", [])), len(meshes), tris, len(g.get("materials", [])), tc1))
json.dump(report, open(os.path.join(out, "export_report.json"), "w"), indent=1)
log("written to", out)
