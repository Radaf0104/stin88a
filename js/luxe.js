// (client, 2026-11-28) The "luxury tower" look for the room view (research/luxury-tower-reference.md), in the live,
// rotatable 3D: "apply it to room 401, 405, 407, 413, and 416, and make them as a template" - the five template rooms
// get it through their default "Luxury" palette (js/roomstyle.js), every other guest room (their copies) through the
// pieces below, which are built for whichever room is opened:
//  - a glossy walnut floor over the room (not the bathroom), unless the room is a template room (its palette has one)
//  - warm ivory plaster on the room's walls while it is shown (the shared plaster materials, put back afterwards)
//  - warm cove light: a thin LED line along the top of every wall plus a soft wash down the wall
//  - soft shading where the floor meets the walls (a real-time stand-in for baked AO)
//  - desktop (classic renderer, not phones): a blurred, Fresnel-faded planar reflection of the room on its floor
// Everything is cut away with the walls nearest the camera (js/isolate.js), like the walls themselves.
import * as THREE from "three";

const WALNUT = 0x6e4e38, IVORY = 0xeae2d7, COVE = 0xffc98f;
const PLASTER = /^(M_plaster_cream|M_plaster_grey)$/;

function gradientTexture(stops, vertical = true) {
  const c = document.createElement("canvas"); c.width = vertical ? 4 : 128; c.height = vertical ? 128 : 4;
  const g = c.getContext("2d"), gr = vertical ? g.createLinearGradient(0, 0, 0, 128) : g.createLinearGradient(0, 0, 128, 0);
  for (const [p, col] of stops) gr.addColorStop(p, col);
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// the room-view backdrop: a flat cool blue-grey gradient (#8FA3B8 at the top -> #5E7590 at the bottom)
export const backdropTexture = () => gradientTexture([[0, "#8fa3b8"], [1, "#5e7590"]]);

export function createLuxe({ scene, parent, renderer, rootPos, patch, isStyleRoom, phone, gpu, invalidate }) {
  const group = new THREE.Group(); group.visible = false; parent.add(group);
  // shared materials (built once; compiled at start-up with the rest, see warm())
  const woodMap = findMap(scene, /^M_(wood_light|teak_deck|teak_timber)$/);
  const floorMat = new THREE.MeshStandardMaterial({ color: WALNUT, roughness: 0.22, metalness: 0, envMapIntensity: 1.15, name: "LUXE_walnut" });
  if (woodMap) { floorMat.map = woodMap.clone(); floorMat.map.wrapS = floorMat.map.wrapT = THREE.RepeatWrapping; floorMat.map.repeat.set(0.45, 0.45); floorMat.map.needsUpdate = true; }
  floorMat.polygonOffset = true; floorMat.polygonOffsetFactor = -2; floorMat.polygonOffsetUnits = -2;
  const coveMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COVE).multiplyScalar(1.4), name: "LUXE_cove" });
  const washMat = new THREE.MeshBasicMaterial({ color: COVE, map: gradientTexture([[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]]),
    transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, name: "LUXE_wash" });
  const aoMat = new THREE.MeshBasicMaterial({ side: THREE.FrontSide, color: 0x2a2119, map: gradientTexture([[0, "rgba(255,255,255,0)"], [1, "rgba(255,255,255,1)"]]),
    transparent: true, opacity: 0.32, depthWrite: false, name: "LUXE_ao" });
  for (const m of [floorMat, coveMat, washMat, aoMat]) patch(m);
  let reflector = null, ReflectorCls = null, reflectMat = null;
  const wantReflect = !phone && !gpu;
  if (wantReflect) import("three/addons/objects/Reflector.js").then((m) => { ReflectorCls = m.Reflector; }).catch(() => {});

  const saved = new Map(); // plaster material -> its own colour / roughness, while a room is shown
  let active = null;
  const meshes = [];
  const clear = () => { for (const m of meshes) { group.remove(m); if (m !== reflector) m.geometry.dispose(); } meshes.length = 0; if (reflector) { group.remove(reflector); reflector.geometry.dispose(); } };

  function enter(u, floorY, night) {
    leave();
    active = u;
    const style = isStyleRoom(u);
    const outline = u.outline, bath = u.bath?.outline ?? null;
    const toW = ([x, y]) => [x + rootPos.x, -y + rootPos.z];
    // floor shape (plan coordinates): the room, minus its bathroom
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    if (bath && bath.length > 2) shape.holes.push(new THREE.Path(bath.map(([x, y]) => new THREE.Vector2(x, y))));
    const floorGeo = () => { const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.translate(rootPos.x, 0, rootPos.z); return g; };
    if (!style) { const f = new THREE.Mesh(floorGeo(), floorMat); f.position.y = floorY + 0.004; f.receiveShadow = true; meshes.push(f); }
    // walls: cove line + wash at the top, soft shading at the bottom, along every edge of the room (and bathroom)
    const edges = []; // [a, b, s]: s = +1 when the polygon runs counter-clockwise (its inside is left of a -> b)
    for (const poly of [outline, ...(bath && bath.length > 2 ? [bath] : [])]) { const s = polyArea(poly) > 0 ? 1 : -1; for (let i = 0; i < poly.length; i++) edges.push([poly[i], poly[(i + 1) % poly.length], s]); }
    for (const [a, b, s] of edges) {
      const [ax, az] = toW(a), [bx, bz] = toW(b), len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      // inward normal in plan: rotate the edge +90 deg (CCW polygon) -> world (x, -y)
      const ex = (b[0] - a[0]) / len, ey = (b[1] - a[1]) / len, nx = -ey * s, ny = ex * s; const nwx = nx, nwz = -ny;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, yaw = Math.atan2(-(bz - az), bx - ax);
      const along = (m, h, inset, y) => { m.position.set(mx + nwx * inset, y, mz + nwz * inset); m.rotation.y = yaw; return m; };
      const top = floorY + 2.52;
      meshes.push(along(new THREE.Mesh(new THREE.BoxGeometry(len - 0.04, 0.025, 0.025), coveMat), 0, 0.03, top));
      const wash = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.04, 0.9), washMat);
      wash.position.set(mx + nwx * 0.012, top - 0.45, mz + nwz * 0.012); wash.rotation.y = Math.atan2(nwx, nwz); meshes.push(wash);
      // floor strip, dark at the wall (v = 0) fading into the room (v = 1)
      const y = floorY + 0.008, d = 0.24, g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([ax, y, az, bx, y, bz, bx + nwx * d, y, bz + nwz * d, ax + nwx * d, y, az + nwz * d], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]); // (both faces: the winding depends on the edge direction)
      const ao = new THREE.Mesh(g, aoMat); ao.renderOrder = 2; meshes.push(ao);
    }
    washMat.opacity = night ? 0.7 : 0.32;
    for (const m of meshes) group.add(m);
    // planar reflection of the room on its floor (desktop): half resolution, blurred, faded by the viewing angle
    if (wantReflect && ReflectorCls) {
      const px = renderer.getPixelRatio(), w = Math.round(innerWidth * px * 0.5), h = Math.round(innerHeight * px * 0.5);
      reflectMat ??= REFLECT_SHADER;
      reflector = new ReflectorCls(floorGeo(), { textureWidth: w, textureHeight: h, clipBias: 0.003, color: 0x888888, shader: reflectMat });
      reflector.material.transparent = true; reflector.material.depthWrite = false;
      reflector.material.uniforms.uTexel.value.set(1 / w, 1 / h);
      reflector.position.y = floorY + 0.006; reflector.renderOrder = 1;
      group.add(reflector);
    }
    // ivory plaster on the shared plaster materials (only this room is drawn now)
    scene.traverse((o) => {
      const m = o.material; if (!o.isMesh || !m || Array.isArray(m) || !PLASTER.test(m.name ?? "") || saved.has(m)) return;
      saved.set(m, { color: m.color.clone(), roughness: m.roughness, ns: m.normalScale?.clone() });
      m.color.setHex(IVORY); m.roughness = 0.9; if (m.normalScale) m.normalScale.setScalar(0.15);
    });
    group.visible = true;
    invalidate(300);
  }
  function leave() {
    if (!active) return;
    active = null; group.visible = false; clear();
    if (reflector) { reflector.getRenderTarget?.().dispose(); reflector = null; }
    for (const [m, s] of saved) { m.color.copy(s.color); m.roughness = s.roughness; if (s.ns) m.normalScale.copy(s.ns); }
    saved.clear();
    invalidate(100);
  }
  function setNight(on) { washMat.opacity = on ? 0.7 : 0.32; coveMat.color.setHex(COVE).multiplyScalar(on ? 2.2 : 1.4); invalidate(200); }
  // shown for one synchronous moment so the start-up compile builds their shaders (no stall on the first room)
  function warm(compile) {
    const g = new THREE.PlaneGeometry(0.01, 0.01), tmp = [floorMat, coveMat, washMat, aoMat].map((m) => new THREE.Mesh(g, m));
    tmp.forEach((m) => { m.position.set(rootPos.x, -50, rootPos.z); group.add(m); });
    group.visible = true; compile(group); group.visible = false;
    tmp.forEach((m) => group.remove(m));
  }
  return { enter, leave, setNight, warm, get active() { return active; }, group };
}
const polyArea = (p) => p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0);
function findMap(scene, re) {
  let t = null; scene.traverse((o) => { if (!t && o.isMesh && !Array.isArray(o.material) && re.test(o.material?.name ?? "") && o.material.map) t = o.material.map; });
  return t;
}
// Reflector shader: the reflection (half resolution) blurred with a 9-tap kernel, and its strength from the angle to the
// floor (Fresnel): ~5 % looking straight down, ~35 % at grazing angles.
const REFLECT_SHADER = {
  name: "LuxeReflector",
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) } },
  vertexShader: `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0); vW = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec4 vUv; varying vec3 vW;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w; vec3 c = vec3(0.0); float wsum = 0.0;
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
        float w = (i == 0 && j == 0) ? 0.25 : ((i == 0 || j == 0) ? 0.125 : 0.0625);
        c += texture2D(tDiffuse, uv + vec2(float(i), float(j)) * uTexel * 2.5).rgb * w; wsum += w;
      }
      c /= wsum;
      float ct = abs(normalize(cameraPosition - vW).y);
      float f = mix(0.05, 0.35, pow(1.0 - ct, 3.0));
      gl_FragColor = vec4(c * color * 1.6, f);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};
