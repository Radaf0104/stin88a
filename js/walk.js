// First-person walk-through with real collision.
// The player is a capsule (radius 0.28 m, eye at ~1.6 m) tested against a BVH of the building, so you can walk
// corridors, enter rooms through doorways, climb stairs, but not pass through walls, furniture or railings.
// Desktop: click to capture the mouse, WASD / arrows to move, Shift to run. Touch: left thumb moves, right thumb looks.
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

const RADIUS = 0.28, SEG = 1.05, EYE = 0.12; // capsule = two spheres 1.05 m apart; feet = pos.y - SEG - RADIUS
export function createWalker({ camera, dom, geometry, onExit }) {
  const bvh = new MeshBVH(geometry, { maxLeafTris: 12 });
  const pos = new THREE.Vector3(), vel = new THREE.Vector3();
  let yaw = 0, pitch = 0, onGround = false, active = false;
  const keys = new Set();
  const seg = new THREE.Line3(), box = new THREE.Box3(), triPt = new THREE.Vector3(), capPt = new THREE.Vector3();
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const touch = { move: null, look: null, mx: 0, my: 0 };

  // ---- input ----
  const onKey = (e, down) => {
    if (!active) return;
    const k = e.code;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(k)) {
      down ? keys.add(k) : keys.delete(k); e.preventDefault();
    }
  };
  addEventListener("keydown", (e) => onKey(e, true));
  addEventListener("keyup", (e) => onKey(e, false));
  // Mouse: click captures the mouse (pointer lock). Where the page isn't allowed to capture it (some embeds),
  // dragging with the mouse button held looks around instead.
  let lockFailed = false;
  dom.addEventListener("click", () => {
    if (!active || lockFailed || !matchMedia("(pointer: fine)").matches || document.pointerLockElement === dom) return;
    try { const p = dom.requestPointerLock?.(); p?.catch?.(() => (lockFailed = true)); } catch { lockFailed = true; }
  });
  addEventListener("mousemove", (e) => {
    if (!active) return;
    const locked = document.pointerLockElement === dom, dragging = e.buttons === 1 && e.target === dom;
    if (!locked && !dragging) return;
    const k = locked ? 0.0022 : 0.004;
    yaw -= e.movementX * k; pitch = THREE.MathUtils.clamp(pitch - e.movementY * k, -1.35, 1.35);
  });
  dom.addEventListener("pointerdown", (e) => {
    if (!active || e.pointerType === "mouse") return;
    const left = e.clientX < innerWidth / 2;
    if (left && !touch.move) touch.move = { id: e.pointerId, x: e.clientX, y: e.clientY };
    else if (!left && !touch.look) touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    dom.setPointerCapture?.(e.pointerId);
  });
  dom.addEventListener("pointermove", (e) => {
    if (!active) return;
    if (touch.move?.id === e.pointerId) { touch.mx = THREE.MathUtils.clamp((e.clientX - touch.move.x) / 60, -1, 1); touch.my = THREE.MathUtils.clamp((e.clientY - touch.move.y) / 60, -1, 1); }
    if (touch.look?.id === e.pointerId) {
      yaw -= (e.clientX - touch.look.x) * 0.005; pitch = THREE.MathUtils.clamp(pitch - (e.clientY - touch.look.y) * 0.005, -1.35, 1.35);
      touch.look.x = e.clientX; touch.look.y = e.clientY;
    }
  });
  const endTouch = (e) => {
    if (touch.move?.id === e.pointerId) { touch.move = null; touch.mx = touch.my = 0; }
    if (touch.look?.id === e.pointerId) touch.look = null;
  };
  dom.addEventListener("pointerup", endTouch);
  dom.addEventListener("pointercancel", endTouch);

  // ---- physics ----
  function step(dt) {
    dt = Math.min(dt, 0.05);
    const run = keys.has("ShiftLeft") || keys.has("ShiftRight");
    let f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - touch.my;
    let s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) + touch.mx;
    const speed = run ? 3.2 : 1.6;
    const fwd = tmp.set(-Math.sin(yaw), 0, -Math.cos(yaw)), right = tmp2.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, s);
    if (move.lengthSq() > 1) move.normalize();
    vel.x = move.x * speed; vel.z = move.z * speed;
    vel.y = onGround ? -1 : vel.y - 9.8 * dt;
    pos.addScaledVector(vel, dt);

    // capsule vs triangles: push out of anything closer than the radius
    seg.start.copy(pos); seg.end.copy(pos).y -= SEG;
    box.makeEmpty(); box.expandByPoint(seg.start); box.expandByPoint(seg.end); box.min.addScalar(-RADIUS); box.max.addScalar(RADIUS);
    bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri) => {
        const d = tri.closestPointToSegment(seg, triPt, capPt);
        if (d < RADIUS) {
          const dir = capPt.sub(triPt).normalize(), depth = RADIUS - d;
          seg.start.addScaledVector(dir, depth); seg.end.addScaledVector(dir, depth);
        }
      },
    });
    const delta = tmp.subVectors(seg.start, pos);
    onGround = delta.y > Math.abs(dt * vel.y * 0.25);
    pos.copy(seg.start);
    if (onGround) vel.y = 0;
    if (pos.y < -20) respawn(); // fell off the world
    camera.position.set(pos.x, pos.y + EYE, pos.z);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  }

  let spawnAt = null;
  function respawn() { if (spawnAt) teleport(spawnAt.p, spawnAt.yaw); }
  function teleport(feet, lookYaw = yaw) {
    pos.copy(feet); pos.y += SEG + RADIUS + 0.05;
    vel.set(0, 0, 0); yaw = lookYaw; pitch = 0; spawnAt = { p: feet.clone(), yaw: lookYaw };
  }
  function start(feet, lookYaw) {
    active = true; keys.clear();
    camera.rotation.order = "YXZ";
    teleport(feet, lookYaw);
  }
  function stop() {
    active = false; keys.clear();
    if (document.pointerLockElement === dom) document.exitPointerLock();
  }
  document.addEventListener("pointerlockchange", () => { if (active && document.pointerLockElement !== dom) keys.clear(); });
  addEventListener("keydown", (e) => { if (active && e.key === "Escape" && document.pointerLockElement !== dom) onExit?.(); });

  return {
    start, stop, step, teleport,
    get active() { return active; },
    get feet() { return new THREE.Vector3(pos.x, pos.y - SEG - RADIUS, pos.z); },
    get yaw() { return yaw; },
    // fast ray test against the building (used to find what the mouse is pointing at); all hits, nearest first
    raycastAll(ray) { return bvh.raycast(ray, THREE.DoubleSide).sort((a, b) => a.distance - b.distance); },
    // drop a point onto the floor below it (used to place spawn points)
    floorBelow(p) {
      const r = new THREE.Raycaster(p.clone().setY(p.y + 0.5), new THREE.Vector3(0, -1, 0), 0, 3);
      r.firstHitOnly = true;
      const hit = bvh.raycastFirst(r.ray, THREE.DoubleSide);
      return hit ? hit.point : null;
    },
  };
}
