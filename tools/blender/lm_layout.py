"""Draws each lightmap set's UVMap_LM layout as a PNG: every mesh in its own colour, texels covered twice in red.

  blender -b source/blender/stin88a_07_uv.blend -P tools/blender/lm_layout.py -- --sets LM_L2,LM_K305 --res 1024 --tag phase4
"""
import bpy, sys, os, colorsys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("sets", "LM_L2"), ("res", "1024"), ("tag", "phase4")])
R = int(A["res"])
out_dir = os.path.join(common.REPO, "source", "compare", A["tag"]); os.makedirs(out_dir, exist_ok=True)
for name in A["sets"].split(","):
    objs = list({o.data.name: o for o in bpy.data.objects if o.type == "MESH" and o.get("lm_set") == name and o.data.uv_layers.get("UVMap_LM")}.values())
    img = np.full((R, R, 3), 0.08, dtype=np.float32); count = np.zeros((R, R), dtype=np.uint8)
    for k, o in enumerate(sorted(objs, key=lambda o: o.name)):
        col = colorsys.hsv_to_rgb((k * 0.618) % 1.0, 0.55, 0.95)
        me = o.data; me.calc_loop_triangles(); lm = me.uv_layers["UVMap_LM"]
        uv = np.empty(len(me.loops) * 2); lm.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2) * R
        tl = np.empty(len(me.loop_triangles) * 3, dtype=np.int64); me.loop_triangles.foreach_get("loops", tl); tl = tl.reshape(-1, 3)
        mine = np.zeros((R, R), dtype=bool)
        for t in tl:
            P = uv[t]; x0, y0 = np.maximum(np.floor(P.min(0)).astype(int), 0); x1, y1 = np.minimum(np.ceil(P.max(0)).astype(int), R)
            if x1 <= x0 or y1 <= y0: continue
            xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = P
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-12: continue
            l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d; l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
            inside = (l1 >= 0) & (l2 >= 0) & (1 - l1 - l2 >= 0)
            sub = mine[y0:y1, x0:x1]; sub |= inside
        count += mine.astype(np.uint8)
        img[mine] = col
    img[count > 1] = (1.0, 0.0, 0.0)
    fill = (count > 0).mean(); over = (count > 1).sum() / max(1, (count > 0).sum())
    rgba = np.concatenate([img[::-1], np.ones((R, R, 1), np.float32)], 2)  # flip: image row 0 = top
    im = bpy.data.images.new(name, R, R); im.pixels.foreach_set(rgba[::-1].ravel())
    im.filepath_raw = os.path.join(out_dir, "lightmap_layout_%s.png" % name); im.file_format = "PNG"; im.save()
    print("[lm] %s: %d meshes, fill %.0f %%, overlap between meshes %.2f %% -> %s" % (name, len(objs), 100 * fill, 100 * over, im.filepath_raw))
