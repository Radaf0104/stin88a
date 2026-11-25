// Builds data/units.json (the editable list of rentable rooms) from data/model.json (exported from Revit).
// Run:  node tools/build-units.mjs
// Re-running overwrites units.json, but keeps status/price/type you already edited for units with the same id.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const model = JSON.parse(readFileSync(join(root, "data/model.json"), "utf8"));
const unitsPath = join(root, "data/units.json");
const previous = existsSync(unitsPath) ? JSON.parse(readFileSync(unitsPath, "utf8")).units : [];
const prevById = Object.fromEntries(previous.map((u) => [u.id, u]));

// A room is a rentable unit when its Revit name is a room number like "K.305".
// (Bathrooms, shaft, corridor and the owner's house rooms have other names, so they are left out.)
const isUnit = (r) => /^K\.\d{3}$/.test(r.name.trim());

const typeFor = (area) => (area < 10.6 ? "standard" : area < 14 ? "deluxe" : "suite");
const demoStatus = ["available", "available", "occupied", "available", "occupied", "available"];
// only two statuses exist: anything that isn't "available" (e.g. older "reserved" / "rented") counts as occupied
const normStatus = (s) => (s === "available" ? "available" : "occupied");

const units = model.rooms.filter(isUnit).map((r) => {
  // its bathroom is the Revit room named "KM <room number>"
  const b = model.rooms.find((x) => x.name.trim() === "KM " + r.name.trim());
  return {
    id: r.id, label: r.name.trim(), level: r.levelIndex, area: r.area, outline: r.outline, z: r.z, height: r.height, note: "",
    bath: b ? { area: b.area, outline: b.outline, z: b.z, height: b.height } : null,
  };
});

// Rooms that are built in the model (walls, bed, bathroom) but have no Revit room drawn in them: copied from a room
// with the same layout, moved to their level and optionally mirrored across a wall (x = mirrorX).
// Level 1: two rooms behind the communal area, under K.211 / K.213. The west one is identical to K.211 (same bed,
// TV, toilet, basin, shower and doors); the east one is its mirror image across the party wall at x = 10.39.
const EXTRA = [
  { label: "K.101", from: "K.211", level: 1 },
  { label: "K.102", from: "K.211", level: 1, mirrorX: 10.39 },
];
for (const e of EXTRA) {
  if (units.some((u) => u.label === e.label)) continue; // drawn in Revit meanwhile: that one wins
  const src = units.find((u) => u.label === e.from);
  const lvl = model.levels.findIndex((l) => l.name === "Level " + e.level);
  if (!src || lvl < 0) { console.warn(`skipped ${e.label}: ${e.from} or Level ${e.level} not found`); continue; }
  const dz = model.levels[lvl].z - src.z;
  const move = (pts) => pts.map(([x, y]) => [e.mirrorX == null ? x : +(2 * e.mirrorX - x).toFixed(3), y]);
  units.push({
    id: "extra-" + e.label, label: e.label, level: e.level, area: src.area, outline: move(src.outline), z: src.z + dz, height: src.height,
    note: "", bath: src.bath ? { ...src.bath, outline: move(src.bath.outline), z: src.bath.z + dz } : null,
  });
}

units.sort((a, b) => a.level - b.level || a.label.localeCompare(b.label, undefined, { numeric: true }));
units.forEach((u, i) => {
  const prev = prevById[u.id];
  u.type = prev?.type ?? typeFor(u.area);
  u.status = normStatus(prev?.status ?? demoStatus[i % demoStatus.length]);
  u.price = prev?.price ?? null; // null = use the price for its type from js/config.js
});

writeFileSync(unitsPath, JSON.stringify({ generatedFrom: "data/model.json", units }, null, 1));
const count = (lvl) => units.filter((u) => u.level === lvl).length;
console.log(`units.json: ${units.length} units (L1 ${count(1)}, L2 ${count(2)}, L3 ${count(3)}, L4 ${count(4)})`);
for (const u of units) console.log(`  L${u.level} ${u.label.padEnd(8)} ${String(u.area).padStart(6)} m2  ${u.type.padEnd(8)} ${u.status}${u.note ? "  <- " + u.note : ""}`);
