// Audit: does the website's furniture / fittings and door behaviour match the Revit floor plan, room by room?
// Inputs: ../stin88a-revit-data/stin88a_elements.json (Revit export) and tools/out/web_rooms.json (dumped from the
// running site: every piece's plan centre, size, yaw, and every door leaf). Writes tools/out/plan_audit.json + .md.
// Run: node tools/audit-plan.mjs
import fs from "node:fs";
const E = JSON.parse(fs.readFileSync("../stin88a-revit-data/stin88a_elements.json", "utf8"));
const W = JSON.parse(fs.readFileSync("tools/out/web_rooms.json", "utf8"));

// Revit family -> website kind, and which website piece stands for it (the biggest piece of that kind in the room)
const FAM = [
  [/^Bed/i, "bed"], [/Plover/i, "chair"], [/Toilet/i, "toilet"], [/Basin/i, "basin"], [/SHOWER/i, "shower"],
];
const kindOf = (e) => FAM.find(([re]) => re.test(e.family))?.[1];
const vol = (i) => i.size[0] * i.size[1] * Math.max(i.size[2], 0.01);
const rad = (d) => (d * Math.PI) / 180;
// family frame: rotate the plan offset by -rotation, mirror flips local x
function toLocal(d, e) {
  const a = -rad(e.rotation_deg ?? 0), x = d[0] * Math.cos(a) - d[1] * Math.sin(a), y = d[0] * Math.sin(a) + d[1] * Math.cos(a);
  return [e.mirrored ? -x : x, y];
}
function toWorld(l, e) {
  const x0 = e.mirrored ? -l[0] : l[0], a = rad(e.rotation_deg ?? 0);
  return [x0 * Math.cos(a) - l[1] * Math.sin(a), x0 * Math.sin(a) + l[1] * Math.cos(a)];
}
const roomOfE = (e) => (e.room_name ?? "").replace(/^KM /, "");
const guest = new Set(W.rooms.map((r) => r.label));
const revit = E.filter((e) => e.point && kindOf(e) && guest.has(roomOfE(e)));
const webBy = (room, kind) => W.items.filter((i) => i.room === room && i.kind === kind).sort((a, b) => vol(b) - vol(a));

// 1) calibrate each family's origin -> web-centre offset (local frame) as the median over all rooms
const off = {};
for (const e of revit) {
  const w = webBy(roomOfE(e), kindOf(e))[0]; if (!w) continue;
  const key = e.family + "|" + e.type;
  (off[key] ??= []).push(toLocal([w.c[0] - e.point[0], w.c[1] - e.point[1]], e));
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const OFF = Object.fromEntries(Object.entries(off).map(([k, v]) => [k, [med(v.map((p) => p[0])), med(v.map((p) => p[1]))]]));

// 2) per room: predicted web centre vs actual
const rows = [];
for (const e of revit) {
  const room = roomOfE(e), kind = kindOf(e), key = e.family + "|" + e.type;
  const o = toWorld(OFF[key], e), pred = [e.point[0] + o[0], e.point[1] + o[1]];
  const cands = webBy(room, kind);
  if (!cands.length) { rows.push({ room, kind, id: e.id, family: e.family, issue: "missing on the website", revit: pred }); continue; }
  const best = cands.reduce((b, w) => { const d = Math.hypot(w.c[0] - pred[0], w.c[1] - pred[1]); return d < b.d ? { w, d } : b; }, { d: Infinity });
  rows.push({ room, kind, id: e.id, family: e.family, d: +best.d.toFixed(2), revit: pred.map((v) => +v.toFixed(2)), web: best.w.c.slice(0, 2), webName: best.w.name });
}
// website pieces of these kinds that Revit doesn't have in that room
for (const r of W.rooms) for (const kind of ["bed", "chair", "toilet", "basin", "shower"]) {
  const nW = webBy(r.label, kind).length ? 1 : 0, nR = revit.filter((e) => roomOfE(e) === r.label && kindOf(e) === kind).length;
  if (nW && !nR) rows.push({ room: r.label, kind, issue: "on the website, not in the Revit plan" });
}

// 3) doors: Revit balcony / bathroom / entrance doors per room vs the website's leaves (slide vs swing, French pairs)
const doorRows = [];
const revDoors = E.filter((e) => e.category === "Doors" && e.point);
for (const r of W.rooms) {
  const xs = r.outline.map((p) => p[0]), ys = r.outline.map((p) => p[1]);
  const box = [Math.min(...xs) - 0.35, Math.min(...ys) - 0.35, Math.max(...xs) + 0.35, Math.max(...ys) + 0.35];
  const z = { 2: 4, 3: 8, 4: 12, 1: 0 }[r.level];
  const rd = revDoors.filter((d) => Math.abs(d.point[2] - z) < 0.5 && d.point[0] > box[0] && d.point[0] < box[2] && d.point[1] > box[1] && d.point[1] < box[3]);
  const wd = W.doors.filter((d) => d.room === r.label || (d.c[0] > box[0] && d.c[0] < box[2] && d.c[1] > box[1] && d.c[1] < box[3] && Math.abs(d.c[2] - 1 - z) < 1.5));
  const rSlide = rd.filter((d) => /Slide/i.test(d.family)), rSwing = rd.filter((d) => /Flush|Sgl_P01|Passage/i.test(d.family));
  const wSlide = wd.filter((d) => d.slide), wFrench = wd.filter((d) => d.out && !d.slide), wSwing = wd.filter((d) => !d.slide && !d.out);
  doorRows.push({ room: r.label, revit: { sliding: rSlide.length, swing: rSwing.length, families: [...new Set(rd.map((d) => d.family + " " + d.type))] },
    web: { sliding: wSlide.length, frenchLeaves: wFrench.length, swing: wSwing.length } });
}

const bad = rows.filter((r) => r.issue || r.d > 0.35);
const byRoom = {};
for (const r of bad) (byRoom[r.room] ??= []).push(r);
fs.writeFileSync("tools/out/plan_audit.json", JSON.stringify({ offsets: OFF, rows, doorRows }, null, 1));
let md = "# Plan audit: website vs Revit floor plan\n\nFurniture / fittings more than 0.35 m from their plan position (or missing / extra), per room:\n\n";
for (const [room, list] of Object.entries(byRoom).sort()) md += `- **${room}**: ${list.map((r) => r.issue ? `${r.kind} ${r.issue}` : `${r.kind} off by ${r.d} m (plan ${r.revit}, web ${r.web})`).join("; ")}\n`;
md += `\nMatched within 0.35 m: ${rows.filter((r) => !r.issue && r.d <= 0.35).length} of ${rows.filter((r) => !r.issue || r.issue === "missing on the website").length} plan elements.\n\n## Doors per room (Revit plan vs website)\n\n| room | plan sliding | plan swing | web sliding | web French leaves | web swing |\n|---|---|---|---|---|---|\n`;
for (const d of doorRows) md += `| ${d.room} | ${d.revit.sliding} | ${d.revit.swing} | ${d.web.sliding} | ${d.web.frenchLeaves} | ${d.web.swing} |\n`;
fs.writeFileSync("tools/out/plan_audit.md", md);
console.log(md);
