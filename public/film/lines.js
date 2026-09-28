// Screen-space thick lines, instanced per segment. Each set (route, network, synapses, crane) is a static
// buffer; trim, pulses and colour are uniforms, so lines "draw on" like trim paths.
import { createProgram, createBuffer, createVAO } from './gl.js';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;    // x: 0..1 along, y: -1..1 across
layout(location=1) in vec3 iA;
layout(location=2) in vec3 iB;
layout(location=3) in vec4 iMeta;      // u0, u1, delay, seed
uniform mat4 uViewProj, uModel;
uniform vec2 uRes;
uniform float uWidth;
out float vU;
out float vLocal;
out float vSide;
flat out vec4 vMeta;
void main(){
  vec4 ca = uViewProj * uModel * vec4(iA, 1.0);
  vec4 cb = uViewProj * uModel * vec4(iB, 1.0);
  // keep both ends in front of the camera
  if (ca.w < 0.01) ca = mix(ca, cb, (0.01 - ca.w) / (cb.w - ca.w));
  if (cb.w < 0.01) cb = mix(cb, ca, (0.01 - cb.w) / (ca.w - cb.w));
  vec2 sa = ca.xy / ca.w, sb = cb.xy / cb.w;
  vec2 dir = (sb - sa) * uRes;
  float l = length(dir);
  dir = l > 1e-5 ? dir / l : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = mix(ca, cb, aCorner.x);
  c.xy += nrm * aCorner.y * uWidth / uRes * c.w;
  gl_Position = c;
  vU = mix(iMeta.x, iMeta.y, aCorner.x);
  vLocal = aCorner.x;
  vSide = aCorner.y;
  vMeta = iMeta;
}`;

const FS = `#version 300 es
precision highp float;
in float vU;
in float vLocal;
in float vSide;
flat in vec4 vMeta;
uniform vec3 uColor, uHead;
uniform float uAlpha, uTrimA, uTrimB, uProgress, uDur, uPulse, uPulseW, uPulseAmt, uTime, uHeadAmt;
uniform int uMode;
out vec4 o;
void main(){
  float a = uAlpha;
  float head = 0.0;
  if (uMode == 0) {
    if (vU < uTrimA || vU > uTrimB) discard;
    head = exp(-pow((uTrimB - vU) / 0.012, 2.0)) * step(uTrimB, 0.999);
  } else {
    float local = clamp((uProgress - vMeta.z) / uDur, 0.0, 1.0);
    if (vU > local) discard;
    head = exp(-pow((local - vU) / 0.05, 2.0)) * step(local, 0.999);
  }
  float pulse = 0.0;
  if (uPulseAmt > 0.0) {
    float ph = fract(uTime * uPulse + vMeta.w);
    pulse = exp(-pow((vU - ph) / uPulseW, 2.0)) * uPulseAmt;
  }
  float aa = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
  vec3 c = uColor * (1.0 + pulse * 2.5) + uHead * head * uHeadAmt;
  o = vec4(c * a * aa, a * aa);
}`;

/** segs: array of [ax, ay, az, bx, by, bz, u0, u1, delay, seed] */
export function createLineSet(gl, segs) {
  const data = new Float32Array(segs.length * 10);
  segs.forEach((s, i) => data.set(s, i * 10));
  return { data, count: segs.length };
}

/** Polyline -> segments with cumulative u in 0..1. */
export function polylineSegs(points, delay = 0, seed = 0) {
  let total = 0;
  const lens = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    lens.push(l);
    total += l;
  }
  const segs = [];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    segs.push([a[0], a[1], a[2], b[0], b[1], b[2], acc / total, (acc + lens[i - 1]) / total, delay, seed]);
    acc += lens[i - 1];
  }
  return segs;
}

export function createLines(gl) {
  const prog = createProgram(gl, VS, FS, 'lines');
  const corners = createBuffer(gl, new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]));
  const sets = new Map();
  return {
    add(name, set) {
      const buf = createBuffer(gl, set.data);
      const B = 40;
      const vao = createVAO(gl, [
        { buffer: corners, loc: 0, size: 2 },
        { buffer: buf, loc: 1, size: 3, stride: B, offset: 0, divisor: 1 },
        { buffer: buf, loc: 2, size: 3, stride: B, offset: 12, divisor: 1 },
        { buffer: buf, loc: 3, size: 4, stride: B, offset: 24, divisor: 1 },
      ]);
      sets.set(name, { vao, count: set.count });
    },
    draw(frame, cam) {
      const list = frame.lines;
      if (!list || !list.length) return;
      prog.use();
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const L of list) {
        const s = sets.get(L.set);
        if (!s || L.alpha <= 0) continue;
        prog.setAll({
          uViewProj: cam.viewProj, uModel: L.model, uRes: cam.res, uWidth: L.width * cam.pxScale,
          uColor: L.color, uHead: L.head || L.color, uAlpha: L.alpha, uTrimA: L.trimA ?? 0, uTrimB: L.trimB ?? 1,
          uProgress: L.progress ?? 1, uDur: L.dur ?? 1, uPulse: L.pulse ?? 0, uPulseW: L.pulseW ?? 0.05,
          uPulseAmt: L.pulseAmt ?? 0, uTime: frame.time, uHeadAmt: L.headAmt ?? 0, uMode: L.mode ?? 0,
        });
        if (L.additive) gl.blendFunc(gl.ONE, gl.ONE);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(s.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.count);
      }
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    },
  };
}
