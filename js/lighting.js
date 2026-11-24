// Mood lighting. Every room, bathroom, corridor bay and shared space gets a "lamp anchor" with its own colour
// temperature and strength. A fixed pool of point lights is moved each frame to the anchors nearest the viewer,
// so the whole building can be lit while the GPU only ever handles a few lights.
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

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
  function update(focus) {
    // the nearest lamps only change when the focus point moves (≥ 25 cm) or the lamp strength changes
    if (!dirty && last.distanceToSquared(focus) < 0.0625) return;
    dirty = false; last.copy(focus);
    for (const a of anchors) a.d = a.pos.distanceToSquared(focus);
    anchors.sort((a, b) => a.d - b.d);
    pool.forEach((l, i) => {
      const a = anchors[i];
      if (!a || a.d > 30 * 30) { l.intensity = 0; return; }
      l.position.copy(a.pos).setY(a.pos.y + 0.3); // up near the ceiling: no hot spots on walls at eye level
      l.color.setHex(a.mood.color);
      l.intensity = a.mood.power * factor;
      l.distance = a.mood === MOODS.communal || a.mood === MOODS.villa ? 10 : 6;
    });
  }
  return { add, update, anchors, setFactor: (f) => { factor = f; dirty = true; }, clear: () => { anchors.length = 0; dirty = true; } };
}

// Daylight through the window of the room you're in: one soft rectangular area light filling the window / balcony
// opening and shining into the room (like the sky seen through the glass). Strength and colour per time of day
// (`window` in TIMES). win = { pos, inward (unit vector), width, height } in world space, or null outside rooms.
export function createWindowLight(scene) {
  RectAreaLightUniformsLib.init();
  const light = new THREE.RectAreaLight(0xffffff, 0, 2, 2);
  scene.add(light);
  let win = null, setting = [0xffffff, 0];
  const apply = () => {
    light.intensity = win ? setting[1] : 0;
    light.color.setHex(setting[0]);
    if (!win) return;
    light.width = win.width; light.height = win.height;
    light.position.copy(win.pos);
    light.lookAt(win.pos.clone().add(win.inward));
  };
  return {
    light,
    setWindow(w) { win = w; apply(); },
    setTime(t) { setting = t.window ?? [0xffffff, 0]; apply(); },
  };
}
