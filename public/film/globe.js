// The globe's body (a dark, depth-writing sphere so the far side of the dots is hidden) and its
// atmosphere (a larger back-faced shell, additive, glowing at the limb).
import { createProgram, createBuffer, createVAO } from './gl.js';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj, uModel;
uniform float uScale;
out vec3 vWorld;
out vec3 vNormal;
void main(){
  vec4 w = uModel * vec4(aPos * uScale, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(uModel) * aPos);
  gl_Position = uViewProj * w;
}`;

const BODY_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uCamPos, uBody, uRim;
uniform float uAmt;
out vec4 o;
void main(){
  vec3 v = normalize(uCamPos - vWorld);
  float f = 1.0 - max(dot(normalize(vNormal), v), 0.0);
  vec3 c = uBody * (0.55 + 0.45 * f) + uRim * pow(f, 4.0);
  o = vec4(c * uAmt, 1.0);
}`;

const ATMO_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uCamPos, uRim;
uniform float uAmt;
out vec4 o;
void main(){
  vec3 v = normalize(uCamPos - vWorld);
  float d = abs(dot(normalize(vNormal), v));
  float g = pow(smoothstep(0.0, 0.5, d), 2.4) * 0.55;
  o = vec4(uRim * g * uAmt, 1.0);
}`;

function sphere(lat = 48, lon = 72) {
  const P = [], I = [];
  for (let i = 0; i <= lat; i++) {
    const t = (i / lat) * Math.PI;
    for (let j = 0; j <= lon; j++) {
      const p = (j / lon) * Math.PI * 2;
      P.push(Math.sin(t) * Math.sin(p), Math.cos(t), Math.sin(t) * Math.cos(p));
    }
  }
  const row = lon + 1;
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    I.push(a, c, b, b, c, d);
  }
  return { P: new Float32Array(P), I: new Uint16Array(I) };
}

export function createGlobe(gl) {
  const g = sphere();
  const body = createProgram(gl, VS, BODY_FS, 'globe-body');
  const atmo = createProgram(gl, VS, ATMO_FS, 'globe-atmo');
  const pb = createBuffer(gl, g.P);
  const ib = createBuffer(gl, g.I, gl.ELEMENT_ARRAY_BUFFER);
  const vao = createVAO(gl, [{ buffer: pb, loc: 0, size: 3 }], ib);
  return {
    draw(frame, cam) {
      const G = frame.globe;
      if (!G.visible || G.amt <= 0) return;
      gl.bindVertexArray(vao);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      body.use().setAll({ uViewProj: cam.viewProj, uModel: G.model, uScale: 0.985, uCamPos: cam.pos, uBody: G.body, uRim: G.rim, uAmt: G.amt });
      gl.drawElements(gl.TRIANGLES, g.I.length, gl.UNSIGNED_SHORT, 0);
      gl.cullFace(gl.FRONT);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      atmo.use().setAll({ uViewProj: cam.viewProj, uModel: G.model, uScale: 1.12, uCamPos: cam.pos, uRim: G.atmo, uAmt: G.amt });
      gl.drawElements(gl.TRIANGLES, g.I.length, gl.UNSIGNED_SHORT, 0);
      gl.cullFace(gl.BACK);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    },
  };
}
