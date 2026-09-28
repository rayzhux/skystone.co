// Instanced architectural boxes: towers, podiums, floor slabs. Instances are written by the director each
// frame (cheap: a few hundred boxes), so growth, sinking and assembly can use any easing per box.
// Towers are dark glass that mirrors the dusk; slabs are bone-white model board.
import { createProgram, createBuffer, createVAO, GLSL_NOISE } from './gl.js';
import { GLSL_SKY } from './sky.js';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 iPos;   // x, y0, z
layout(location=3) in vec3 iSize;  // w, h, d
layout(location=4) in vec4 iMisc;  // seed, rotY, kind, reveal
layout(location=5) in vec2 iHot;   // top glow, spare
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
flat out vec4 vMisc;
flat out vec3 vSize;
flat out vec2 vHot;
void main(){
  float c = cos(iMisc.y), s = sin(iMisc.y);
  vec3 l = aPos * iSize;
  vec3 p = vec3(c * l.x + s * l.z, l.y, -s * l.x + c * l.z) + iPos;
  vNormal = vec3(c * aNormal.x + s * aNormal.z, aNormal.y, -s * aNormal.x + c * aNormal.z);
  vWorld = p;
  vLocal = l;
  vMisc = iMisc;
  vSize = iSize;
  vHot = iHot;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
flat in vec4 vMisc;
flat in vec3 vSize;
flat in vec2 vHot;
uniform vec3 uCamPos, uSunCol, uAmbCol, uFogCol, uStone, uStone2, uWinCol, uEdgeCol, uSlab;
uniform float uFogDensity, uWindows, uNight, uLight, uEdgeGlow, uReflect;
out vec4 o;
${GLSL_NOISE}
${GLSL_SKY}
void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCamPos - vWorld);
  float seed = vMisc.x;
  float kind = vMisc.z;
  float reveal = vMisc.w;

  // materialise with an incandescent frontier (skipped once a box is whole)
  float edge = 0.0;
  if (reveal < 0.999) {
    float nz = vnoise(vWorld * 0.42 + seed * 17.0) * 0.75 + vnoise(vWorld * 1.7) * 0.25;
    float th = reveal * 1.12;
    if (nz > th) discard;
    edge = 1.0 - smoothstep(0.0, 0.035, th - nz);
  }

  float diff = max(dot(n, uSunDir), 0.0);
  float up = 0.5 + 0.5 * n.y;
  vec3 col;
  bool side = abs(n.y) < 0.5;

  if (kind > 1.5 && kind < 2.5) {
    // floor slab: bone model board with a crisp lit lip
    col = uSlab * (uAmbCol * (0.55 + 0.45 * up) + uSunCol * diff * 0.9) * uLight;
    float lip = 1.0 - smoothstep(0.0, 0.05, min(vLocal.y, vSize.y - vLocal.y));
    col += uEdgeCol * lip * 0.06;
    col += uEdgeCol * vHot.x * (0.35 + 0.65 * lip);
  } else if (kind > 2.5) {
    // concrete core
    col = uStone2 * 0.55 * (uAmbCol * up + uSunCol * diff * 0.8) * uLight;
    col *= 0.85 + 0.15 * step(0.5, fract(vLocal.y / 3.6));
  } else {
    // glass tower: mostly the sky it reflects
    vec3 base = mix(uStone, uStone2, fract(seed * 13.7));
    vec3 body = base * (uAmbCol * (0.3 + 0.7 * up) + uSunCol * diff * 0.16) * uLight;
    col = body;
    float yRel = clamp(vWorld.y / 70.0, 0.0, 1.0);
    if (side) {
      float along = abs(n.x) > 0.5 ? vLocal.z : vLocal.x;
      float fl = vWorld.y / 3.4;
      float fi = floor(fl), fy = fract(fl);
      float u = along / 1.9;
      float ui = floor(u), fx = fract(u);
      float glass = step(0.09, fx) * step(fx, 0.93) * step(0.12, fy) * step(fy, 0.93);
      float ph = hash13(vec3(fi, ui, seed * 31.0));
      vec3 jit = (vec3(ph, hash13(vec3(ui, fi, seed * 7.0)), hash13(vec3(fi * 3.1, ui, seed))) - 0.5) * 0.07;
      vec3 nn = normalize(n + jit);
      vec3 r = reflect(-v, nn);
      r.y = max(r.y, 0.0) * 0.85 + 0.012;
      float fres = 0.14 + 0.86 * pow(1.0 - max(dot(n, v), 0.0), 3.0);
      vec3 env = skyColor(normalize(r)) * (0.45 + 0.95 * ph * ph) * uLight;
      vec3 pane = mix(body * 0.55, env, fres * (1.0 - uNight * 0.7));
      col = mix(body * 0.42, pane, glass);
      // upper floors catch the last sun; the street stays in shadow
      col += uSunCol * diff * smoothstep(0.45, 1.0, yRel) * 0.1 * uLight;
      col *= mix(0.55, 1.0, smoothstep(0.0, 0.35, yRel));
      // lit windows after dark
      float lit = step(hash13(vec3(fi, ui, seed * 97.0 + (abs(n.x) > 0.5 ? 3.0 : 0.0) + sign(n.x + n.z))), uWindows * 0.62);
      col += glass * lit * uWinCol * max(uNight, 0.22) * (0.55 + 0.7 * hash13(vec3(ui, fi, seed)));
    } else if (n.y > 0.5) {
      // roofs: dark, with a warm lit parapet
      float lipd = min(min(vLocal.x + vSize.x * 0.5, vSize.x * 0.5 - vLocal.x), min(vLocal.z + vSize.z * 0.5, vSize.z * 0.5 - vLocal.z));
      col = base * 0.3 * uLight + uSunCol * 0.06 * uLight;
      col += uEdgeCol * (1.0 - smoothstep(0.0, 0.2, lipd)) * 0.1 * uLight;
      col += uEdgeCol * vHot.x * 1.6;
    }
    // contact occlusion at street level
    col *= mix(0.35, 1.0, smoothstep(0.0, 12.0, vWorld.y));
  }

  float d = length(vWorld - uCamPos);
  col = mix(col, uFogCol, 1.0 - exp(-d * uFogDensity));
  col += uEdgeCol * edge * uEdgeGlow;
  o = vec4(col, 1.0);
}`;

function boxGeometry() {
  // x,z in [-0.5, 0.5], y in [0, 1]
  const P = [], N = [], I = [];
  const faces = [
    [[0, 0, 1], [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]]],
    [[0, 0, -1], [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]]],
    [[1, 0, 0], [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5]]],
    [[-1, 0, 0], [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5]]],
    [[0, 1, 0], [[-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5]]],
    [[0, -1, 0], [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]]],
  ];
  for (const [n, vs] of faces) {
    const b = P.length / 3;
    for (const v of vs) { P.push(...v); N.push(...n); }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint16Array(I) };
}

export const BOX_STRIDE = 12; // floats per instance: x y0 z | w h d | seed rotY kind reveal | hot spare

export function createBoxes(gl, maxInstances = 512) {
  const g = boxGeometry();
  const prog = createProgram(gl, VS, FS, 'boxes');
  const pb = createBuffer(gl, g.P);
  const nb = createBuffer(gl, g.N);
  const ib = createBuffer(gl, g.I, gl.ELEMENT_ARRAY_BUFFER);
  const inst = createBuffer(gl, new Float32Array(maxInstances * BOX_STRIDE), gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
  const B = BOX_STRIDE * 4;
  const vao = createVAO(gl, [
    { buffer: pb, loc: 0, size: 3 },
    { buffer: nb, loc: 1, size: 3 },
    { buffer: inst, loc: 2, size: 3, stride: B, offset: 0, divisor: 1 },
    { buffer: inst, loc: 3, size: 3, stride: B, offset: 12, divisor: 1 },
    { buffer: inst, loc: 4, size: 4, stride: B, offset: 24, divisor: 1 },
    { buffer: inst, loc: 5, size: 2, stride: B, offset: 40, divisor: 1 },
  ], ib);
  return {
    max: maxInstances,
    draw(frame, cam, instances, count) {
      if (!count) return;
      const b = frame.boxes;
      const sky = frame.sky;
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances, 0, count * BOX_STRIDE);
      prog.use();
      prog.setAll({
        uViewProj: cam.viewProj, uCamPos: cam.pos,
        uZenith: sky.zenith, uMid: sky.mid, uHorizon: sky.horizon, uGlow: sky.glow, uSunDir: sky.sunDir, uAnti: sky.anti,
        uStars: 0, uHaze: sky.haze, uTime: frame.time,
        uSunCol: b.sunCol, uAmbCol: b.ambCol, uFogCol: b.fogCol, uStone: b.stone, uStone2: b.stone2, uSlab: b.slab,
        uWinCol: b.winCol, uEdgeCol: b.edgeCol, uReflect: b.reflect,
        uFogDensity: b.fog, uWindows: b.windows, uNight: b.night, uLight: b.light, uEdgeGlow: b.edgeGlow,
      });
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      gl.bindVertexArray(vao);
      gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, count);
      gl.disable(gl.CULL_FACE);
    },
  };
}
