"""13 - Baked EXR lightmaps -> 8-bit PNGs for the web (+ data/levels/lightmaps.json).

  blender -b -P tools/blender/13_lightmaps.py -- --bakes source/bakes --out source/lm_png --manifest data/levels/lightmaps.json

* Indirect light (<set>_[<time>_]sun_indirect_dn.exr): scaled so the brightest 0.5 % of texels reach 1.0 (fixed per
  file, written to the manifest as "scale" -> the site multiplies back by 1 / scale), then encoded with the sRGB curve
  (more steps in the dark corners, no banding); the site reads it with colorSpace = SRGBColorSpace.
* AO (<set>_ao_dn.exr): linear 0-1, written as is (three.js reads aoMap linearly, red channel).
Denoised files (_dn) are used when they exist.
"""
import bpy, sys, os, re, json, glob
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

A = common.args([("bakes", "source/bakes"), ("out", "source/lm_png"), ("manifest", "data/levels/lightmaps.json"), ("pct", "99.5")])
log = common.Log("13_lightmaps")
for k in ("bakes", "out", "manifest"):  # relative to the repo (Blender without a .blend runs in another folder)
    if not os.path.isabs(A[k]): A[k] = os.path.join(common.REPO, A[k])
os.makedirs(A["out"], exist_ok=True); os.makedirs(os.path.dirname(os.path.abspath(A["manifest"])), exist_ok=True)
man = json.load(open(A["manifest"])) if os.path.exists(A["manifest"]) else {}
def srgb_oetf(x): return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 0), 1 / 2.4) - 0.055)
def write_png(px, w, h, path):
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"   # values are written as given (already encoded)
    rgba = np.ones((h, w, 4), dtype=np.float32); rgba[..., :3] = px
    img.pixels.foreach_set(rgba.ravel()); img.filepath_raw = path; img.file_format = "PNG"; img.save()
    bpy.data.images.remove(img)
for f in sorted(glob.glob(os.path.join(A["bakes"], "*.exr"))):
    name = os.path.basename(f)[:-4]
    if not name.endswith("_dn") and os.path.exists(f[:-4] + "_dn.exr"): continue   # the denoised version is used
    base = name[:-3] if name.endswith("_dn") else name
    m = re.match(r"(LM_[A-Za-z0-9]+)_(?:(golden|night)_)?(sun|nosun)_indirect$", base)
    ao = re.match(r"(LM_[A-Za-z0-9]+)_ao$", base)
    if not (m or ao): continue
    if m and m.group(3) == "nosun" and os.path.exists(f.replace("_nosun_", "_sun_")): continue  # sun-on bake wins
    img = bpy.data.images.load(f, check_existing=False); w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(img)
    if m:
        lm_set, time, sun = m.group(1), m.group(2) or "day", m.group(3)
        lit = px[px.max(2) > 0]
        peak = float(np.percentile(lit.max(1), float(A["pct"]))) if len(lit) else 1.0
        scale = 1.0 / max(peak, 1e-6)
        out = os.path.join(A["out"], "%s_%s.png" % (lm_set, time))
        write_png(srgb_oetf(np.clip(px * scale, 0, 1)), w, h, out)
        man.setdefault(lm_set, {})[time] = {"png": os.path.basename(out), "file": "lm/%s_%s.ktx2" % (lm_set, time), "scale": round(scale, 5), "sun": sun == "sun", "size": w}
        log("%s %s: peak %.3f -> scale %.3f -> %s" % (lm_set, time, peak, scale, os.path.basename(out)))
    else:
        lm_set = ao.group(1)
        out = os.path.join(A["out"], "%s_ao.png" % lm_set)
        write_png(np.clip(px, 0, 1), w, h, out)
        man.setdefault(lm_set, {})["ao"] = {"png": os.path.basename(out), "file": "lm/%s_ao.ktx2" % lm_set, "size": w}
        log("%s AO -> %s" % (lm_set, os.path.basename(out)))
json.dump(man, open(A["manifest"], "w"), indent=1)
log("manifest", A["manifest"])
