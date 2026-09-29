// The void the film plays in: ink, never flat. A slow haze, a warm glow wherever the light is, and a faint
// band through it where the horizon will be.
import { createProgram, FULLSCREEN_VS } from './gl.js';

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes, uGlowUv;
uniform float uTime, uAmt, uHaze, uGlowAmt, uGlowSize, uBandAmt;
uniform vec3 uTop, uBottom, uGlowCol;
out vec4 o;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float r = 0.0;
  float n000 = dot(hash33(i) * 2.0 - 1.0, f);
  float n100 = dot(hash33(i + vec3(1, 0, 0)) * 2.0 - 1.0, f - vec3(1, 0, 0));
  float n010 = dot(hash33(i + vec3(0, 1, 0)) * 2.0 - 1.0, f - vec3(0, 1, 0));
  float n110 = dot(hash33(i + vec3(1, 1, 0)) * 2.0 - 1.0, f - vec3(1, 1, 0));
  float n001 = dot(hash33(i + vec3(0, 0, 1)) * 2.0 - 1.0, f - vec3(0, 0, 1));
  float n101 = dot(hash33(i + vec3(1, 0, 1)) * 2.0 - 1.0, f - vec3(1, 0, 1));
  float n011 = dot(hash33(i + vec3(0, 1, 1)) * 2.0 - 1.0, f - vec3(0, 1, 1));
  float n111 = dot(hash33(i + vec3(1, 1, 1)) * 2.0 - 1.0, f - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

void main() {
  float asp = uRes.x / uRes.y;
  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
  vec2 d = (vUv - uGlowUv) * vec2(asp, 1.0);
  float r2 = dot(d, d);
  float s2 = uGlowSize * uGlowSize;
  col += uGlowCol * uGlowAmt * (exp(-r2 / s2) + 0.22 * exp(-r2 / (s2 * 9.0)));
  col += uGlowCol * uBandAmt * exp(-abs(vUv.y - uGlowUv.y) * 38.0) * exp(-abs(d.x) * 0.8);
  vec2 q = vec2(vUv.x * asp, vUv.y) * 1.5;
  float n = gnoise(vec3(q, uTime * 0.04)) + 0.5 * gnoise(vec3(q * 2.1 + 3.1, uTime * 0.05 + 7.0));
  col *= 1.0 + n * uHaze;
  o = vec4(max(col, 0.0) * uAmt, 1.0);
}`;

export function createBackdrop(gl) {
  const prog = createProgram(gl, FULLSCREEN_VS, FS, 'backdrop');
  const vao = gl.createVertexArray();
  return {
    draw(frame, cam) {
      const B = frame.backdrop;
      prog.use().setAll({
        uRes: cam.res, uGlowUv: B.glowUv || [0.5, 0.5], uTime: frame.time, uAmt: B.amt, uHaze: B.haze,
        uGlowAmt: B.glowUv ? B.glowAmt : 0, uGlowSize: B.glowSize, uBandAmt: B.glowUv ? B.bandAmt : 0,
        uTop: B.top, uBottom: B.bottom, uGlowCol: B.glowCol,
      });
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.depthMask(false);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    },
  };
}
