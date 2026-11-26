# Revit (pyRevit / IronPython, run in "STIN MASTERPLAN FINAL.rvt"): writes the site plan geometry for the website.
# Terrain (toposolids), roads and pads (floors) and retaining walls are triangulated and moved into the building's own
# frame - the inverse of the "STIN VILLA 88A" link instance transform - in metres, Revit axes. Bottom faces are left out
# (never seen). Then: node tools/build-siteplan.mjs  ->  data/levels/SITEPLAN.gltf
from Autodesk.Revit.DB import *
import json
OUT = r"source/revit/siteplan_revit.json"   # change to an absolute path when running from Revit
doc = __revit__.ActiveUIDocument.Document
F = 0.3048
link = [l for l in FilteredElementCollector(doc).OfClass(RevitLinkInstance) if l.Name.startswith('STIN VILLA 88A')][0]
Tinv = link.GetTotalTransform().Inverse
opt = Options(); opt.DetailLevel = ViewDetailLevel.Coarse; opt.ComputeReferences = False
out = {"transform_note": "building (STIN VILLA 88A link) frame, metres, Revit axes", "elements": []}
def solids(g):
    for o in g:
        if isinstance(o, Solid) and o.Volume > 0: yield o
        elif isinstance(o, GeometryInstance):
            for s in solids(o.GetInstanceGeometry()): yield s
for bic, kind in ((BuiltInCategory.OST_Toposolid, 'topo'), (BuiltInCategory.OST_Floors, 'floor'), (BuiltInCategory.OST_Walls, 'wall')):
    for e in FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType():
        g = e.get_Geometry(opt)
        if g is None: continue
        parts = {}
        for s in solids(g):
            for f in s.Faces:
                try: n = f.ComputeNormal(UV(0.5, 0.5))
                except: n = XYZ(0, 0, 1)
                if n.Z < -0.7: continue
                m = doc.GetElement(f.MaterialElementId)
                P = parts.setdefault(m.Name if m else e.Name, {"v": [], "i": []})
                mesh = f.Triangulate(0.25); base = len(P["v"]) // 3
                for k in range(mesh.Vertices.Count):
                    p = Tinv.OfPoint(mesh.Vertices[k]); P["v"].extend([round(p.X * F, 3), round(p.Y * F, 3), round(p.Z * F, 3)])
                for t in range(mesh.NumTriangles):
                    tr = mesh.get_Triangle(t); P["i"].extend([base + int(tr.get_Index(j)) for j in range(3)])
        out["elements"].append({"id": int(e.Id.Value), "kind": kind, "name": e.Name, "parts": parts})
f = open(OUT, "w"); f.write(json.dumps(out)); f.close()
print("elements", len(out["elements"]), "->", OUT)
