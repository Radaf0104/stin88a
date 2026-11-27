// Mood lighting. Every room, bathroom, corridor bay and shared space gets a "lamp anchor" with its own colour
// temperature and strength. A fixed pool of point lights is moved each frame to the anchors nearest the viewer,
// so the whole building can be lit while the GPU only ever handles a few lights.
import * as THREE from "three";

export const MOODS = {
  bedroom:  { color: 0xffd6ad, power: 9,  height: 2.25 }, // ~3000 K warm white (deeper orange made the walls brown)
  bathroom: { color: 0xfff0dc, power: 5,  height: 2.2 },  // ~3500 K, clean
  corridor: { color: 0xffd29e, power: 8,  height: 2.3 },  // cove + sconces like the corridor render
  communal: { color: 0xfff1df, power: 14, height: 2.6 },  // bright, neutral
  villa:    { color: 0xffc890, power: 12, height: 2.5 },  // warm evening
};

export function createMoodLights(scene, count) {
  const pool = Array.from({ length: count }, () => {
    const l = new THREE.PointLight(0xffffff, 0, 7, 2);
    scene.add(l);
    return l;
  });
  const anchors = [];
  let factor = 1, dirty = true;
  const last = new THREE.Vector3(Infinity, 0, 0);
  const add = (pos, mood) => { anchors.push({ pos: pos.clone(), mood: MOODS[mood], d: 0 }); dirty = true; };
  // (round 26) lights lent out (a style room's downlight and lamp, js/roomstyle.js) skip the anchor placement until
  // they are handed back - so the scene keeps the same number of lights and no shader is rebuilt
  const held = new Set();
  function update(focus) {
    // the nearest lamps only change when the focus point moves (≥ 25 cm) or the lamp strength changes
    if (!dirty && last.distanceToSquared(focus) < 0.0625) return;
    dirty = false; last.copy(focus);
    for (const a of anchors) a.d = a.pos.distanceToSquared(focus);
    anchors.sort((a, b) => a.d - b.d);
    let i = 0;
    pool.forEach((l) => {
      if (held.has(l)) return;
      const a = anchors[i++];
      if (!a || a.d > 30 * 30) { l.intensity = 0; return; }
      l.position.copy(a.pos).setY(a.pos.y + 0.3); // up near the ceiling: no hot spots on walls at eye level
      l.color.setHex(a.mood.color);
      l.intensity = a.mood.power * factor;
      l.distance = a.mood === MOODS.communal || a.mood === MOODS.villa ? 10 : 6;
    });
  }
  return { add, update, anchors, setFactor: (f) => { factor = f; dirty = true; }, clear: () => { anchors.length = 0; dirty = true; },
    hold(n) { const ls = pool.filter((l) => !held.has(l)).slice(-n); ls.forEach((l) => held.add(l)); return ls; },
    release(ls) { for (const l of ls) { held.delete(l); l.intensity = 0; } dirty = true; } };
}

// Daylight through the window of the room you're in: one wide, fully soft spot light standing just outside the
// window / balcony opening and shining into the room (like the sky seen through the glass). Strength and colour per
// time of day (`window` in TIMES, in the old area-light units). win = { pos, inward (unit vector), width, height }.
// (round 20: was a RectAreaLight - its LTC library was a 75 KB download and added area-light code to every shader.)
export const WINDOW_CD = 3.2; // candela per old area-light unit per m2 of opening (first estimate, not yet matched by render)
export function createWindowLight(scene) {
  const light = new THREE.SpotLight(0xffffff, 0, 0, 1.25, 1, 2); // ~72 deg half-angle, soft edge, physical falloff
  light.castShadow = false;
  // Added to the scene only the first time a window is set: the eye-level room view that used it (enterRoom) is not
  // reachable at the moment, and an unused light still costs every lit pixel and every shader.
  let win = null, setting = [0xffffff, 0], added = false;
  const apply = () => {
    light.color.setHex(setting[0]);
    if (!win) { light.intensity = 0; return; }
    if (!added) { scene.add(light, light.target); added = true; }
    light.intensity = setting[1] * WINDOW_CD * win.width * win.height;
    light.position.copy(win.pos).addScaledVector(win.inward, -1.0).setY(win.pos.y + 0.3); // 1 m outside, a bit high
    light.target.position.copy(win.pos).addScaledVector(win.inward, 3).setY(win.pos.y - 0.6);
    light.target.updateMatrixWorld();
  };
  return {
    light,
    setWindow(w) { win = w; apply(); },
    setTime(t) { setting = t.window ?? [0xffffff, 0]; apply(); },
  };
}
