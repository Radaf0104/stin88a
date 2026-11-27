// (M2) Which renderer this page runs. index.html maps "three" either to the classic r170 build (WebGLRenderer) or,
// with ?renderer=webgpu / ?renderer=webgl2, to the WebGPU build of three 0.186.1 (WebGPURenderer + TSL). Modules ask
// GPU to choose the node-material version of their shader tweaks; TSL is the node library (null on the classic path).
// FORCE_WEBGL: the new renderer on its WebGL 2 backend (what browsers without WebGPU get automatically).
import * as THREE from "three";

export const GPU = !!THREE.WebGPURenderer;
export const FORCE_WEBGL = GPU && /[?&]renderer=webgl2\b/.test(location.search);
export const TSL = GPU ? await import("three/tsl") : null;
