// Final colour grade, applied to the finished (display-ready) image, like a light Lightroom preset:
// contrast around mid-grey, saturation, warm highlights / cool shadows (split toning) and a soft vignette.
// Values per time of day live in TIMES[...].grade (js/environment.js).
import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// gain = white point: 0.95 makes pure white come out as ~#F2F2F2 (keeps sunlit plaster from clipping)
export const GRADE_DEFAULT = { gain: 1, contrast: 1, saturation: 1, lift: 0, warm: [1, 1, 1], cool: [1, 1, 1], vignette: 0 };

export function createGradePass() {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      contrast: { value: 1 }, saturation: { value: 1 }, lift: { value: 0 },
      warm: { value: new THREE.Vector3(1, 1, 1) }, cool: { value: new THREE.Vector3(1, 1, 1) },
      vignette: { value: 0 }, aspect: { value: 1 }, gain: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float contrast, saturation, lift, vignette, aspect, gain;
      uniform vec3 warm, cool;
      varying vec2 vUv;
      void main() {
        vec4 tex = texture2D(tDiffuse, vUv);
        vec3 c = tex.rgb;
        float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // split toning: shadows lean toward 'cool', highlights toward 'warm'
        c *= mix(cool, warm, smoothstep(0.15, 0.85, L));
        // contrast (S-curve around mid-grey) and shadow lift
        c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
        c = c + lift * (1.0 - c) * (1.0 - smoothstep(0.0, 0.5, c));
        // saturation
        float L2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(L2), c, saturation);
        // vignette: r = 0 at the centre, 1 in the corners (whatever the screen shape); only the outer edge darkens
        float r = length((vUv - 0.5) * vec2(aspect, 1.0)) / length(vec2(aspect * 0.5, 0.5));
        c *= 1.0 - vignette * smoothstep(0.6, 1.0, r);
        gl_FragColor = vec4(clamp(c * gain, 0.0, 1.0), tex.a);
      }`,
  });
  pass.setGrade = (g = GRADE_DEFAULT) => {
    const u = pass.uniforms, v = { ...GRADE_DEFAULT, ...g };
    u.gain.value = v.gain; u.contrast.value = v.contrast; u.saturation.value = v.saturation; u.lift.value = v.lift; u.vignette.value = v.vignette;
    u.warm.value.set(...v.warm); u.cool.value.set(...v.cool);
  };
  pass.setAspect = (a) => (pass.uniforms.aspect.value = a);
  return pass;
}
