// Real-world surroundings: Google Photorealistic 3D Tiles, placed so the site's lat/lon sits at the model origin.
// Needs a Google Maps Platform API key with the "Map Tiles API" enabled (CONFIG.googleMapsKey).
// The tiles, and the tiles library itself (~105 KB + Draco), are loaded the first time the map is switched on.
import * as THREE from "three";

const D2R = THREE.MathUtils.DEG2RAD;

export function createMap({ scene, camera, renderer, site, apiKey }) {
  // holder: rotates the tiles so true north lines up with the model, and lifts them so the ground meets Level 1
  const holder = new THREE.Group();
  holder.visible = false;
  scene.add(holder);
  let tiles = null, loading = null, groundTries = 0, lastGroundAt = 0;

  async function init() {
    const [{ TilesRenderer }, { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, ReorientationPlugin }, { DRACOLoader }] = await Promise.all([
      import("3d-tiles-renderer/three"), import("3d-tiles-renderer/plugins"), import("three/addons/loaders/DRACOLoader.js"),
    ]);
    tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    const draco = new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/");
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    // put the site at the origin, local up = +Y (tiles frame: X = west, Z = north)
    tiles.registerPlugin(new ReorientationPlugin({ lat: site.lat * D2R, lon: site.lon * D2R, height: site.height ?? 0, recenter: true }));
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    tiles.addEventListener?.("load-model", ({ scene: s }) => s.traverse((o) => { if (o.isMesh) o.receiveShadow = true; }));
    holder.add(tiles.group);
    holder.rotation.y = (site.northRotation ?? 0) * D2R;
  }

  // Snap the terrain under the site to the model's ground level. Repeats for a while as finer tiles stream in.
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  function ground(now) {
    if (groundTries > 12 || now - lastGroundAt < 1000) return;
    lastGroundAt = now;
    holder.updateMatrixWorld(true);
    ray.set(new THREE.Vector3(site.groundProbe?.[0] ?? 0, 3000, site.groundProbe?.[1] ?? 0), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(tiles.group, true)[0];
    if (!hit) return;
    holder.position.y += (site.groundLevel ?? 0) - hit.point.y;
    groundTries++;
  }

  return {
    get on() { return holder.visible; },
    get available() { return !!apiKey; },
    set(on) {
      if (on && !apiKey) return false;
      if (on && !loading) loading = init().catch((e) => { console.warn("map unavailable", e); loading = null; });
      holder.visible = on;
      return true;
    },
    update(now) {
      if (!tiles || !holder.visible) return;
      camera.updateMatrixWorld();
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.update();
      ground(now);
    },
    attributions() {
      if (!tiles || !holder.visible) return "";
      const a = tiles.getAttributions?.() ?? [];
      return a.filter((x) => x.type === "string").map((x) => x.value).join(" · ");
    },
  };
}
