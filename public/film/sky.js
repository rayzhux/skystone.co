// Sky dome + ground plane, drawn as one full-screen pass behind everything.
import { createProgram, FULLSCREEN_VS, GLSL_NOISE } from './gl.js';

// Shared by the sky pass and anything that reflects the sky (the stone).
export const GLSL_SKY = `
uniform vec3 uZenith, uMid, uHorizon, uGlow, uSunDir, uAnti;
uniform float uStars, uHaze, uTime;
vec3 skyColor(vec3 rd){
  float e = max(rd.y, 0.0);
  float h = pow(e, 0.75);
  // the anti-sun side of a dusk sky: a rose band over a dusky blue earth shadow
  vec2 az = normalize(rd.xz + 1e-5), saz = normalize(uSunDir.xz + 1e-5);
  float anti = pow(max(-dot(az, saz), 0.0), 1.5);
  float band = smoothstep(0.02, 0.09, e) * (1.0 - smoothstep(0.1, 0.3, e));
  vec3 hz = mix(uHorizon, mix(uMid, uAnti, 0.55), anti * 0.75);
  vec3 col = mix(hz, uMid, smoothstep(0.0, 0.16, h));
  col = mix(col, uAnti, band * anti * 0.7);
  col = mix(col, uZenith, smoothstep(0.1, 0.72, h));
  float sd = max(dot(rd, uSunDir), 0.0);
  col += uGlow * (0.05 * pow(sd, 4.0) + 0.22 * pow(sd, 42.0) + 1.1 * pow(sd, 700.0) + 7.0 * pow(sd, 9000.0));
  col += uGlow * uHaze * 0.16 * exp(-e * 34.0) * (0.3 + 0.7 * pow(sd, 2.0));
  return col;
}
`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uAmt;
uniform vec3 uGround, uSunCol, uGridColor;
uniform float uDune, uGrid, uGridScale, uFogDensity, uHorizonLine, uLineSpan, uFogDark;
uniform vec3 uLineCol;
uniform vec4 uBlob;
${GLSL_NOISE}
${GLSL_SKY}

float duneH(vec2 q){
  return 0.55 * sin(q.x * 0.09 + q.y * 0.05) + 0.32 * sin(q.x * 0.21 - q.y * 0.13 + 1.3) + 0.18 * sin(q.y * 0.31 + q.x * 0.07 + 2.1);
}
vec2 duneGrad(vec2 q){
  float dx = 0.55 * 0.09 * cos(q.x * 0.09 + q.y * 0.05) + 0.32 * 0.21 * cos(q.x * 0.21 - q.y * 0.13 + 1.3) + 0.18 * 0.07 * cos(q.y * 0.31 + q.x * 0.07 + 2.1);
  float dz = 0.55 * 0.05 * cos(q.x * 0.09 + q.y * 0.05) - 0.32 * 0.13 * cos(q.x * 0.21 - q.y * 0.13 + 1.3) + 0.18 * 0.31 * cos(q.y * 0.31 + q.x * 0.07 + 2.1);
  return vec2(dx, dz);
}

vec3 stars(vec3 rd){
  if (rd.y <= 0.0 || uStars <= 0.0) return vec3(0.0);
  vec2 sp = vec2(atan(rd.x, rd.z) * 90.0, asin(rd.y) * 90.0);
  vec2 id = floor(sp), f = fract(sp) - 0.5;
  float h = hash12(id);
  vec2 off = (vec2(hash12(id + 7.1), hash12(id + 3.3)) - 0.5) * 0.6;
  float d = length(f - off);
  float s = step(0.955, h) * smoothstep(0.16, 0.0, d);
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
  float fade = smoothstep(0.02, 0.35, rd.y);
  return vec3(0.95, 0.92, 1.0) * s * tw * fade * uStars * (0.4 + 1.6 * fract(h * 97.0));
}

void main(){
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(wp.xyz / wp.w - uCamPos);
  vec3 col;
  if (rd.y >= 0.0) {
    col = skyColor(rd) + stars(rd);
  } else {
    float t = -uCamPos.y / min(rd.y, -1e-5);
    vec3 p = uCamPos + rd * t;
    vec2 g = duneGrad(p.xz) * uDune;
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    float diff = max(dot(n, uSunDir), 0.0);
    float back = pow(max(dot(normalize(vec3(rd.x, 0.0, rd.z)), vec3(uSunDir.x, 0.0, uSunDir.z)), 0.0), 6.0);
    vec3 ground = uGround * (0.4 + 1.25 * diff * uSunCol) + uGlow * 0.04 * back * uDune;
    // grain in the sand
    ground *= 0.9 + 0.2 * hash12(floor(p.xz * 24.0));
    // drafting grid for the city shots
    if (uGrid > 0.0) {
      vec2 q = p.xz / uGridScale;
      vec2 w = fwidth(q);
      vec2 a = abs(fract(q - 0.5) - 0.5) / max(w, 1e-4);
      float line = 1.0 - min(min(a.x, a.y), 1.0);
      vec2 q5 = q / 5.0;
      vec2 w5 = fwidth(q5);
      vec2 a5 = abs(fract(q5 - 0.5) - 0.5) / max(w5, 1e-4);
      float major = 1.0 - min(min(a5.x, a5.y), 1.0);
      float fadeGrid = exp(-t * 0.006);
      ground += uGridColor * (line * 0.35 + major * 0.8) * uGrid * fadeGrid;
    }
    // soft contact shadow
    if (uBlob.w > 0.0) {
      vec2 d = (p.xz - uBlob.xy) / uBlob.z;
      ground *= 1.0 - uBlob.w * exp(-dot(d, d) * 1.6);
    }
    vec3 hor = skyColor(normalize(vec3(rd.x, 0.0005, rd.z)));
    float fog = 1.0 - exp(-t * uFogDensity);
    col = mix(ground, mix(hor * 0.82, uGround * 1.4, uFogDark), fog);
  }
  col *= uAmt;
  // thin incandescent horizon, drawn out from the centre of frame
  float span = 1.0 - smoothstep(uLineSpan - 0.02, uLineSpan, abs(vUv.x - 0.5) * 2.0);
  col += uLineCol * uHorizonLine * span * (exp(-abs(rd.y) * 1400.0) + exp(-abs(rd.y) * 110.0) * 0.08);
  o = vec4(col, 1.0);
}`;

export function createSky(gl) {
  const prog = createProgram(gl, FULLSCREEN_VS, FS, 'sky');
  const vao = gl.createVertexArray();
  return {
    prog,
    draw(frame, cam) {
      const s = frame.sky;
      prog.use();
      prog.setAll({
        uInvViewProj: cam.invViewProj,
        uCamPos: cam.pos,
        uAmt: s.amt,
        uZenith: s.zenith, uMid: s.mid, uHorizon: s.horizon, uGlow: s.glow, uSunDir: s.sunDir, uAnti: s.anti,
        uStars: s.stars, uHaze: s.haze, uTime: frame.time,
        uGround: s.ground, uSunCol: s.sunCol, uGridColor: s.gridColor,
        uDune: s.dune, uGrid: s.grid, uGridScale: s.gridScale, uFogDensity: s.fog,
        uHorizonLine: s.horizonLine, uLineSpan: s.lineSpan, uFogDark: s.fogDark ?? 0, uLineCol: s.lineCol, uBlob: s.blob,
      });
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
