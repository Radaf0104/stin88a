// Sky + image-based lighting for three times of day.
// Day and golden hour use real photographed skies (HDRI, CC0 from Poly Haven): the photo is the visible sky AND the
// light source, so glass, chrome and plaster pick up its real colours. The sun light (for shadows) is placed where the
// sun actually is in the photo, then the whole sky is turned so the sun rakes across the front facade.
// Night uses a painted gradient with stars. If an HDRI can't load, the procedural Sky model is used instead.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const TIMES = {
  // sunAz: where we want the sun (degrees, 0 = in front of the terrace facade (+z), 90 = from +x); hdri: sky photo
  // sun from the front-left like the renders (fin shadows fall to the right); bg = how bright the sky photo is shown
  // Morning look (matches the terrace-facade render): a strong warm sun aimed at the facade, a weaker sky light so the
  // shade reads cool and clearly darker; the visible sky is shown paler (desaturated, hazy horizon) than the light it gives.
  // sunElev overrides the sun height found in the photo; skyDesat / skyHaze control how pale the visible sky is;
  // fill = sky-blue from above + green bounce from the lawn; roomGlow = warm lit ceilings seen through the windows.
  // neutral: use the "PBR Neutral" tone curve, which keeps whites white and the sky blue (AgX greys them out in sun)
  // (1k versions of the 2k Poly Haven photos, made with tools/shrink-hdr.mjs: a quarter of the download, same look)
  day:    { hdri: "assets/sky/autumn_field_puresky_1k.hdr", neutral: true, sunAz: -38, sunElev: 48, sun: 0xffefdc, sunI: 5, env: 0.26, bg: 0.98, exposure: 1.8, skyDesat: 0.04, skyHaze: 0.2, fill: [0xe2ebf4, 0x7a7d4a, 0.36],
            // (2026-11-26 reference render "3.jpg": sky #C0D3E3 -> #D5DDE3 at the horizon, a touch warmer sun, olive lawn bounce)
            // (exterior render: pale blue sky #C5D7E4, white plaster, neutral grey shade - so a cool sky fill and a
            // green-grey lawn bounce instead of the old yellow one, which turned the plaster peach)
            roomGlow: 0.8, lamps: 0.35, glow: 0.0,
            // indoors: neutral studio-room light + cool daylight through the window, lamps dimmed (they're "on" but daylight wins)
            roomEnv: 0.3, window: [0xeef3ff, 4],
            // colours matched by measurement to the client's elevation render: cream plaster, light honey timber, olive lawn
            grade: { gain: 0.955, contrast: 1.08, saturation: 1.0, lift: 0.03, warm: [1.02, 1.0, 0.965], cool: [0.985, 1.0, 1.03], vignette: 0.16 }, ground: 0x4a5a2c, fogDensity: 0.0022 /* the masterplan site reaches ~150 m: lighter haze so it keeps its colour */, elev: 48, turbidity: 3, rayleigh: 1.2 },
  golden: { hdri: "assets/sky/kloppenheim_06_puresky_1k.hdr", sunAz: -55, sun: 0xffb46e, sunI: 2.3, env: 0.53, bg: 2.0, exposure: 0.75,
            fill: [0xfff4e6, 0x9a8a72, 0.09], roomEnv: 0.22, window: [0xffcf9a, 2.5], skyDesat: 0.2, skyHaze: 0.5, roomGlow: 0.9, lamps: 0.9, glow: 0.4,
            grade: { contrast: 1.06, saturation: 1.04, lift: 0.03, warm: [1.05, 1.0, 0.92], cool: [0.94, 0.97, 1.05], vignette: 0.25 }, ground: 0xe8dcc4, fogDensity: 0.003, elev: 8, turbidity: 6, rayleigh: 2.6 },
  night:  { elev: 28, sunAz: 300, sun: 0x8ea6ff, sunI: 3.5, env: 5, bg: 1, exposure: 0.75, roomEnv: 0.08, window: [0x9fb2ff, 0.3], roomGlow: 1.4, grade: { contrast: 1.04, vignette: 0.3 }, lamps: 1.6, glow: 1.0, ground: 0x6f7f66, fog: 0x141a28, fogDensity: 0.0045, night: true },
};

export function createEnvironment(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  // Indoors the outdoor sky is the wrong reflection/ambient light (it tints walls blue and is far too even), so rooms
  // use a neutral "studio room" environment instead (three.js RoomEnvironment: soft white panels, like Nagoya Hill).
  const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // ---- fallbacks: procedural sky (day) and painted night sky ----
  const skyScene = new THREE.Scene();
  const sky = new Sky();
  sky.scale.setScalar(1000);
  skyScene.add(sky);
  const nightSphere = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.MeshBasicMaterial({ map: nightTexture(), side: THREE.BackSide, depthWrite: false }));
  skyScene.add(nightSphere);
  // 256 per face = the same environment-map size the 1k sky photos produce (1024 / 4), so the shaders compiled with
  // this stand-in sky stay valid when the photo arrives (a different size would rebuild every shader once)
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 2000, cubeRT);
  skyScene.add(cubeCam);

  // ---- HDRI skies: each one is downloaded the first time its time of day is chosen (the site opens in daytime, so the
  // golden-hour sky, 2.8 MB, is only fetched if someone picks it); until it arrives the procedural sky stands in ----
  const hdris = {}, requested = new Set();
  const loader = new RGBELoader();
  let onReady = null;
  function requestHdri(name) {
    const t = TIMES[name];
    if (!t?.hdri || requested.has(name)) return;
    requested.add(name);
    loader.load(t.hdri, (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const a = analyse(tex);
      hdris[name] = { tex, ...a, ...paleSky(tex, t, a) };
      if (current === name) onReady?.(name);
    });
  }

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const fill = new THREE.HemisphereLight(0xfff4e6, 0x9a8a72, 0.25); // small warm bounce so deep shade isn't dead
  scene.add(fill);

  const sunDir = new THREE.Vector3();
  let current = null, radius = 30;
  function set(name, r = radius) {
    radius = r;
    const t = TIMES[name]; current = name;
    requestHdri(name);
    const h = hdris[name];
    envRT?.dispose();
    if (h) {
      // turn the sky so the photo's sun sits at the azimuth we want
      const rot = THREE.MathUtils.degToRad(t.sunAz) - h.az;
      scene.background = h.bgTex ?? h.tex;
      scene.backgroundRotation.set(0, rot, 0);
      scene.environmentRotation.set(0, rot, 0);
      envRT = pmrem.fromEquirectangular(h.tex);
      scene.environment = envRT.texture;
      const elev = t.sunElev != null ? THREE.MathUtils.degToRad(t.sunElev) : Math.max(h.elev, THREE.MathUtils.degToRad(6));
      sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, THREE.MathUtils.degToRad(t.sunAz));
      scene.fog = new THREE.FogExp2(h.hazeFog ?? h.horizon, t.fogDensity);
    } else {
      sky.visible = !t.night; nightSphere.visible = !!t.night;
      sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - t.elev), THREE.MathUtils.degToRad(t.sunAz));
      if (!t.night) {
        const u = sky.material.uniforms;
        u.turbidity.value = t.turbidity; u.rayleigh.value = t.rayleigh; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
        u.sunPosition.value.copy(sunDir);
      }
      const prevTM = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
      cubeCam.update(renderer, skyScene);
      renderer.toneMapping = prevTM;
      envRT = pmrem.fromCubemap(cubeRT.texture);
      scene.background = cubeRT.texture;
      scene.backgroundRotation.set(0, 0, 0); scene.environmentRotation.set(0, 0, 0);
      scene.environment = envRT.texture;
      scene.fog = new THREE.FogExp2(t.fog ?? 0xc4d2dc, t.fogDensity);
    }
    scene.backgroundIntensity = h ? t.bg ?? 1 : 1;
    renderer.toneMapping = t.neutral ? THREE.NeutralToneMapping : THREE.AgXToneMapping;
    sun.color.set(t.sun);
    sun.position.copy(sunDir).multiplyScalar(radius * 3);
    if (t.fill) { fill.color.set(t.fill[0]); fill.groundColor.set(t.fill[1]); }
    else { fill.color.set(0xfff4e6); fill.groundColor.set(0x9a8a72); }
    applyLevels();
    return t;
  }
  // Light levels per time of day. A TIMES entry may add `inside: { sunI, env, fill, exposure }` to override them while
  // walking / inside a room (none needed now that ambient occlusion works properly).
  let inside = false, plain = 0;
  const PLAIN = { env: 0.9, fill: 1.35, exposure: 1.0, sky: new THREE.Color(0xffffff), ground: new THREE.Color(0xd8d4cc) };
  const baseSky = new THREE.Color(), baseGround = new THREE.Color();
  function applyLevels() {
    const t = TIMES[current]; if (!t) return;
    const o = inside ? t.inside ?? {} : {};
    const roomLight = (inside && t.roomEnv) || plain > 0.5;
    scene.environment = roomLight ? roomEnv : envRT?.texture ?? null;
    const env0 = inside && t.roomEnv ? t.roomEnv : o.env ?? t.env;
    scene.environmentIntensity = THREE.MathUtils.lerp(env0, PLAIN.env, plain);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(o.exposure ?? t.exposure, PLAIN.exposure, plain);
    sun.intensity = (o.sunI ?? t.sunI) * (1 - plain);
    fill.intensity = THREE.MathUtils.lerp(o.fill ?? (t.fill ? t.fill[2] : t.night ? 0.12 : 0.25), PLAIN.fill, plain);
    baseSky.set(t.fill ? t.fill[0] : 0xfff4e6); baseGround.set(t.fill ? t.fill[1] : 0x9a8a72);
    fill.color.copy(baseSky).lerp(PLAIN.sky, plain); fill.groundColor.copy(baseGround).lerp(PLAIN.ground, plain);
  }
  function setInside(on) { if (on !== inside) { inside = on; applyLevels(); } }
  // Plain "studio" light for the floor / room / walk views: no sun (so no sun shadows), an even white sky light and a
  // neutral room reflection. k blends from the time-of-day light (0) to plain light (1), for the fade while flying.
  function setPlain(k) { if (k !== plain) { plain = k; applyLevels(); } }
  return {
    sun, fill, set, setInside, setPlain, get plain() { return plain; },
    get current() { return current; }, get time() { return TIMES[current]; },
    // called when a sky photo finishes loading after the time was already chosen
    onHdriReady(cb) { onReady = cb; },
    get hasHdri() { return !!hdris[current]; },
  };
}

// Find the sun (brightest pixel) and the average horizon colour in an equirectangular HDR.
function analyse(tex) {
  const { data, width: w, height: h } = tex.image;
  const half = data instanceof Uint16Array;
  const px = (i) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const ch = data.length / (w * h);
  let best = -1, bi = 0;
  for (let y = 0; y < h / 2; y += 2) for (let x = 0; x < w; x += 2) { // the sun disc is ~10 px wide: every 2nd row is enough
    const i = (y * w + x) * ch, l = px(i) * 0.2126 + px(i + 1) * 0.7152 + px(i + 2) * 0.0722;
    if (l > best) { best = l; bi = y * w + x; }
  }
  const x = bi % w, y = Math.floor(bi / w);
  const u = (x + 0.5) / w, v = 1 - (y + 0.5) / h; // texture is flipped vertically when sampled
  const lon = (u - 0.5) * 2 * Math.PI, lat = (v - 0.5) * Math.PI;
  const dir = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  // horizon colour: average a band just above the horizon, toned down for fog
  const c = [0, 0, 0]; let n = 0;
  const y0 = Math.floor(h * 0.47), y1 = Math.floor(h * 0.49);
  for (let yy = y0; yy < y1; yy++) for (let xx = 0; xx < w; xx += 8) { const i = (yy * w + xx) * ch; c[0] += px(i); c[1] += px(i + 1); c[2] += px(i + 2); n++; }
  const col = new THREE.Color(c[0] / n, c[1] / n, c[2] / n);
  const m = Math.max(col.r, col.g, col.b) || 1;
  col.multiplyScalar(0.85 / m);
  return { az: Math.atan2(dir.x, dir.z), elev: Math.asin(dir.y), horizon: col };
}

// A paler copy of the sky photo for display only (the original still lights the scene): colours are partly
// desaturated and the band near the horizon fades into a bright, slightly warm haze, like a hazy tropical morning.
// Returns the texture plus a matching fog colour so distant trees melt into the same haze.
function paleSky(tex, t, a) {
  const desat = t.skyDesat ?? 0, haze = t.skyHaze ?? 0;
  if (!desat && !haze) return {};
  const { data, width: w, height: h } = tex.image;
  const half = data instanceof Uint16Array;
  const ch = data.length / (w * h);
  const get = (i) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  // The displayed sky is at most 1024 wide (a 2k photo is sampled every 2nd pixel and row): these are cloudless
  // "pure sky" photos, so it looks the same on screen and the per-pixel work stays small.
  const step = w > 1024 ? 2 : 1;
  const W = w / step, H = h / step;
  const out = new data.constructor(W * H * ch);
  // clamp: the sun in the photo can exceed what a 16-bit float holds (it would become "infinity")
  const put = half ? (i, v) => (out[i] = THREE.DataUtils.toHalfFloat(Math.min(v, 30000))) : (i, v) => (out[i] = Math.min(v, 30000));
  // haze colour: horizon brightness, nearly white with a hint of warmth
  const hb = (() => { let s = 0, n = 0; const y = Math.floor(h * 0.48); for (let x = 0; x < w; x += 8) { const i = (y * w + x) * ch; s += get(i) * 0.2126 + get(i + 1) * 0.7152 + get(i + 2) * 0.0722; n++; } return (s / n) * 1.25; })();
  const hz = [hb * 1.6, hb * 1.68, hb * 1.75]; // brighter than the photo's horizon, very slightly blue-white
  const avg = (x, y, c) => get((y * step * w + x * step) * ch + c);
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI; // radians above the horizon
    const k = lat <= 0 ? haze : haze * Math.exp(-lat / 0.22); // fades out by ~25° up
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * ch;
      let r = avg(x, y, 0), g = avg(x, y, 1), b = avg(x, y, 2);
      const L = r * 0.2126 + g * 0.7152 + b * 0.0722;
      r += (L - r) * desat; g += (L - g) * desat; b += (L - b) * desat;
      put(o, r + (hz[0] - r) * k); put(o + 1, g + (hz[1] - g) * k); put(o + 2, b + (hz[2] - b) * k);
      if (ch === 4) out[o + 3] = data[(y * step * w + x * step) * ch + 3];
    }
  }
  const bg = new THREE.DataTexture(out, W, H, tex.format, tex.type);
  bg.mapping = THREE.EquirectangularReflectionMapping;
  bg.colorSpace = tex.colorSpace; bg.flipY = tex.flipY;
  bg.minFilter = bg.magFilter = THREE.LinearFilter; bg.generateMipmaps = false;
  bg.needsUpdate = true;
  // fog: the haze colour, scaled into display range (fog is mixed after lighting)
  const fogCol = new THREE.Color(0.86, 0.89, 0.92).lerp(a.horizon, 0.25);
  return { bgTex: bg, hazeFog: fogCol };
}

function nightTexture() {
  const w = 2048, h = 1024, c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#03050c"); grad.addColorStop(0.42, "#0b1430"); grad.addColorStop(0.5, "#24304f"); grad.addColorStop(0.53, "#1a2233"); grad.addColorStop(1, "#0c0f16");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const x = r() * w, y = r() * h * 0.46, a = r();
    g.fillStyle = `rgba(255,255,255,${0.25 + a * 0.7})`;
    g.fillRect(x, y, a > 0.92 ? 2 : 1, a > 0.92 ? 2 : 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
