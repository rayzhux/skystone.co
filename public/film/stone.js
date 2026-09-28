// The Skystone: a polished standing stone that carries the sky on its skin.
import { createProgram, createBuffer, createVAO, GLSL_NOISE } from './gl.js';
import { GLSL_SKY } from './sky.js';
import { buildStoneMesh } from './world.js';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj, uModel;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vObj;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vObj = aPos;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProj * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vObj;
uniform vec3 uCamPos, uSunCol, uEdgeCol, uFogCol;
uniform float uReveal, uFogDensity, uLight;
out vec4 o;
${GLSL_NOISE}
${GLSL_SKY}
void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCamPos - vWorld);

  float edge = 0.0;
  if (uReveal < 0.999) {
    float nz = vnoise(vObj * 2.3 + 4.0) * 0.7 + vnoise(vObj * 9.0) * 0.3;
    float th = uReveal * 1.12;
    if (nz > th) discard;
    edge = 1.0 - smoothstep(0.0, 0.06, th - nz);
  }

  // micro-relief: a honed basalt with faint mineral veins
  float vein = smoothstep(0.02, 0.0, abs(fbm3(vObj * vec3(1.6, 0.7, 1.6) + 2.0) - 0.5));
  float speck = step(0.985, hash13(floor(vObj * 180.0)));
  vec3 base = mix(vec3(0.030, 0.028, 0.026), vec3(0.055, 0.050, 0.044), fbm3(vObj * 3.0));
  base += vec3(0.16, 0.12, 0.08) * vein * 0.35 + vec3(0.5, 0.42, 0.3) * speck * 0.25;

  vec3 r = reflect(-v, n);
  vec3 env = r.y > 0.0 ? skyColor(r) : mix(uFogCol * 0.35, skyColor(normalize(vec3(r.x, 0.001, r.z))), exp(r.y * 6.0));
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  float diff = max(dot(n, uSunDir), 0.0);
  float spec = pow(max(dot(r, uSunDir), 0.0), 260.0);
  vec3 col = base * (0.25 + uSunCol * diff * 0.8);
  col += env * mix(0.18, 1.0, fres);
  col += uSunCol * spec * 6.0;
  // rim: the dusk catches the silhouette
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += uGlow * rim * 0.35;
  col *= uLight;
  float d = length(vWorld - uCamPos);
  col = mix(col, uFogCol, 1.0 - exp(-d * uFogDensity));
  col += uEdgeCol * edge * 3.5;
  o = vec4(col, 1.0);
}`;

const DEPTH_FS = `#version 300 es
precision highp float;
void main(){}`;

export function createStone(gl) {
  const mesh = buildStoneMesh();
  const prog = createProgram(gl, VS, FS, 'stone');
  const depth = createProgram(gl, VS, DEPTH_FS, 'stone-depth');
  const pb = createBuffer(gl, mesh.pos);
  const nb = createBuffer(gl, mesh.nrm);
  const ib = createBuffer(gl, mesh.idx, gl.ELEMENT_ARRAY_BUFFER);
  const vao = createVAO(gl, [{ buffer: pb, loc: 0, size: 3 }, { buffer: nb, loc: 1, size: 3 }], ib);
  return {
    drawDepth(frame, lightViewProj) {
      const s = frame.stone;
      if (!s.visible || s.reveal < 0.5) return;
      depth.use().setAll({ uViewProj: lightViewProj, uModel: s.model });
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    },
    draw(frame, cam) {
      const s = frame.stone;
      if (!s.visible) return;
      const sky = frame.sky;
      prog.use();
      prog.setAll({
        uViewProj: cam.viewProj, uModel: s.model, uCamPos: cam.pos,
        uZenith: sky.zenith, uMid: sky.mid, uHorizon: sky.horizon, uGlow: sky.glow, uSunDir: sky.sunDir, uAnti: sky.anti,
        uStars: 0, uHaze: sky.haze, uTime: frame.time,
        uSunCol: sky.sunCol, uEdgeCol: s.edgeCol, uFogCol: s.fogCol,
        uReveal: s.reveal, uFogDensity: s.fog, uLight: s.light,
      });
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    },
  };
}
