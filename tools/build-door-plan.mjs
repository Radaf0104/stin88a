// Door behaviour from the Revit floor plan -> data/door_plan.json (read by js/spaces.js via main.js).
// (client, 2026-11-28: "the door function does not follow floor plan")
//  - slide: the balcony doors that are 2-panel sliding doors in the plan (QARC_Al_Slide_XO: one fixed panel X, one
//    sliding panel O). tools/blender/04_join.py had turned them into two outward French leaves; on the site the leaf
//    pair (leaf userData door_pair = the Revit id) now behaves as the XO slider again.
//  - swing (when ../stin88a-revit-data/door_swings.json exists, from the Revit agent): per swinging door its hinge
//    point and the side its leaf opens to, read from the plan's swing arcs.
// Run: node tools/build-door-plan.mjs
import fs from "node:fs";
const E = JSON.parse(fs.readFileSync("../stin88a-revit-data/stin88a_elements.json", "utf8"));
const out = { source: "stin88a-revit-data (Revit export, read-only)", slide: {}, swing: {} };
for (const e of E) {
  if (e.category !== "Doors" || !e.point) continue;
  if (/Slide/i.test(e.family)) {
    // which panel slides: XO = fixed panel on the left, sliding on the right, seen with the facing vector at your back
    // (the family's own layout); mirrored or turned 180 deg swaps the sides. dir = +1: the sliding panel is the one at
    // the +x / +y end (plan axes) of the opening.
    const flip = (e.mirrored ? 1 : 0) ^ (Math.round(((e.rotation_deg ?? 0) % 360 + 360) % 360) === 180 ? 1 : 0);
    out.slide[e.id] = { point: e.point, width: e.width_m, facing: e.facing, operable: flip ? "min" : "max" };
  }
}
const swingsFile = "../stin88a-revit-data/door_swings.json";
if (fs.existsSync(swingsFile)) {
  for (const d of JSON.parse(fs.readFileSync(swingsFile, "utf8"))) {
    if (d.sliding || !d.hinge || !d.swing_side) continue;
    out.swing[d.id] = { hinge: d.hinge, side: d.swing_side, room: d.swing_room ?? null, other: d.other_room ?? null };
  }
}
fs.writeFileSync("data/door_plan.json", JSON.stringify(out));
console.log(`data/door_plan.json: ${Object.keys(out.slide).length} sliding, ${Object.keys(out.swing).length} swing doors`);
