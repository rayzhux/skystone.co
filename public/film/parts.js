// Instanced stone parts: plinths, piers and the voussoirs of the arch. Each instance carries a position,
// a scale and a quaternion, so any stone can fly, turn and land. Two stones: polished basalt and honed
// travertine, with bevelled edges that catch the light, mortar-dark joints and real sun shadows.
import { createProgram, createBuffer, createVAO, GLSL_NOISE } from './gl.js';
import { GLSL_SKY } from './sky.js';
import { GLSL_SHADOW } from './shadow.js';
import { ARCH, MESH } from './world.js';

export const PART_STRIDE = 16; // pos3 scale3 quat4 | kind seed reveal hot | spare2

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 iPos;
layout(location=3) in vec3 iScale;
layout(location=4) in vec4 iQuat;
layout(location=5) in vec4 iMisc;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vLoc;
out vec3 vNLoc;
flat out vec4 vQuat;
flat out vec4 vMisc;
flat out vec3 vScale;
vec3 qrot(vec4 q, vec3 v){ vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
void main(){
  vec3 l = aPos * iScale;
  vec3 w = qrot(iQuat, l) + iPos;
  vWorld = w;
  vLoc = l;
  vNLoc = aNormal;
  vQuat = iQuat;
  vMisc = iMisc;
  vScale = iScale;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vLoc;
in vec3 vNLoc;
flat in vec4 vQuat;
flat in vec4 vMisc;
flat in vec3 vScale;
uniform vec3 uCamPos, uSunCol, uAmbTop, uAmbBottom, uFogCol, uHotCol;
uniform float uFogDensity, uLight;
uniform int uMesh;
uniform vec4 uArch; // ri, ro, depth, half-span
uniform float uKeyRise;
out vec4 o;
${GLSL_NOISE}
${GLSL_SKY}
${GLSL_SHADOW}
vec3 qrot(vec4 q, vec3 v){ vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }

void main(){
  float kind = vMisc.x, seed = vMisc.y, reveal = vMisc.z, hot = vMisc.w;
  vec3 nL = normalize(vNLoc);
  // ---- fake bevel: tilt the normal toward the nearest edge, darken the joint itself
  float bevel = 0.07, edgeD = 1e3;
  vec3 tilt = vec3(0.0);
  if (uMesh == 0) {
    vec3 he = vScale * 0.5;
    vec3 p = vec3(vLoc.x, vLoc.y - he.y, vLoc.z);
    vec3 d = he - abs(p);
    vec3 an = abs(nL);
    vec3 m = vec3(an.x < 0.5 ? d.x : 1e3, an.y < 0.5 ? d.y : 1e3, an.z < 0.5 ? d.z : 1e3);
    if (m.x < m.y && m.x < m.z) { edgeD = m.x; tilt = vec3(sign(p.x), 0.0, 0.0); }
    else if (m.y < m.z) { edgeD = m.y; tilt = vec3(0.0, sign(p.y), 0.0); }
    else { edgeD = m.z; tilt = vec3(0.0, 0.0, sign(p.z)); }
  } else {
    float ri = uArch.x, ro = uArch.y + (uMesh == 2 ? uKeyRise : 0.0), hd = uArch.z * 0.5, hs = uArch.w;
    float r = length(vLoc.xy);
    float th = atan(vLoc.y, vLoc.x) - 1.5707963;
    vec3 radial = vec3(vLoc.xy / max(r, 1e-4), 0.0);
    vec3 tang = vec3(-radial.y, radial.x, 0.0);
    float dIn = r - ri, dOut = ro - r, dTh = (hs - abs(th)) * r, dZ = hd - abs(vLoc.z);
    bool faceZ = abs(nL.z) > 0.5;
    bool faceR = !faceZ && abs(dot(nL, radial)) > 0.7;
    float a = 1e3, b = 1e3, c = 1e3;
    vec3 ta = vec3(0.0), tb = vec3(0.0), tc = vec3(0.0);
    if (faceZ) { a = min(dIn, dOut); ta = dIn < dOut ? -radial : radial; b = dTh; tb = tang * sign(th); }
    else if (faceR) { a = dTh; ta = tang * sign(th); b = dZ; tb = vec3(0.0, 0.0, sign(vLoc.z)); }
    else { a = min(dIn, dOut); ta = dIn < dOut ? -radial : radial; b = dZ; tb = vec3(0.0, 0.0, sign(vLoc.z)); }
    if (a < b) { edgeD = a; tilt = ta; } else { edgeD = b; tilt = tb; }
  }
  float bk = 1.0 - smoothstep(0.0, bevel, edgeD);
  vec3 nB = normalize(nL + tilt * bk * 1.4);
  vec3 n = normalize(qrot(vQuat, nB));
  vec3 v = normalize(uCamPos - vWorld);

  // ---- materialise (dissolve) with a warm frontier
  float front = 0.0;
  if (reveal < 0.999) {
    float nz = vnoise(vWorld * 0.9 + seed * 17.0) * 0.7 + vnoise(vWorld * 3.1) * 0.3;
    float th = reveal * 1.12;
    if (nz > th) discard;
    front = 1.0 - smoothstep(0.0, 0.05, th - nz);
  }

  // ---- stone
  vec3 q = vLoc * 0.9 + seed * 31.0;
  vec3 albedo;
  float polish, rough;
  if (kind < 0.5) {
    // polished basalt: near-black, fine mineral fleck, faint warm veining
    albedo = vec3(0.042, 0.040, 0.038) * (0.85 + 0.3 * fbm3(q * 1.3));
    float vein = smoothstep(0.018, 0.0, abs(fbm3(q * vec3(0.5, 0.9, 0.5)) - 0.5));
    albedo += vec3(0.13, 0.10, 0.07) * vein * 0.5;
    albedo += vec3(0.35, 0.33, 0.30) * step(0.992, hash13(floor(vLoc * 70.0 + seed * 5.0))) * 0.4;
    polish = 1.0; rough = 0.08;
  } else {
    // honed travertine: warm, banded, pitted
    float band = sin(vWorld.y * 5.2 + fbm3(q * 0.6) * 6.0) * 0.5 + 0.5;
    albedo = mix(vec3(0.46, 0.37, 0.27), vec3(0.58, 0.49, 0.38), band);
    albedo *= 0.9 + 0.2 * fbm3(q * 2.2);
    float pore = smoothstep(0.78, 0.9, vnoise(vLoc * vec3(9.0, 26.0, 9.0) + seed * 7.0));
    albedo *= 1.0 - pore * 0.45;
    polish = 0.35; rough = 0.45;
  }

  float sh = shadowAt(vWorld, n);
  float ndl = dot(n, uSunDir);
  float diff = max(ndl, 0.0) * sh;
  vec3 amb = mix(uAmbBottom, uAmbTop, n.y * 0.5 + 0.5) * 1.25;
  vec3 col = albedo * (amb + uSunCol * diff * 1.15) * uLight;
  // reflections: sharp on basalt, broad on travertine
  vec3 r = reflect(-v, n);
  vec3 rr = normalize(mix(r, n, rough));
  // the sun disc is clamped out of the reflection so polished faces never read as a second sun
  vec3 env = min(skyColor(vec3(rr.x, max(rr.y, 0.0) * 0.9 + 0.02, rr.z)), vec3(0.9));
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  col += env * fres * polish * uLight * (0.55 + 0.45 * sh);
  float spec = pow(max(dot(r, uSunDir), 0.0), mix(380.0, 60.0, rough));
  col += uSunCol * min(spec * sh * polish * 0.7, 0.35) * uLight;
  // bevel glint: edges facing the sun catch it, joints read as a hairline
  col += uSunCol * bk * max(ndl, 0.0) * sh * 0.25 * uLight;
  col *= 1.0 - (1.0 - smoothstep(0.0, 0.012, edgeD)) * 0.6;
  // contact occlusion where stone meets sand
  col *= mix(0.45, 1.0, smoothstep(0.0, 1.1, vWorld.y));

  float d = length(vWorld - uCamPos);
  col = mix(col, uFogCol, 1.0 - exp(-d * uFogDensity));
  col += uHotCol * (hot * bk * 0.4 + front * 2.5);
  o = vec4(col, 1.0);
}`;

const DEPTH_FS = `#version 300 es
precision highp float;
void main(){}`;

// ------------------------------------------------------------------ meshes
function boxMesh() {
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

/** An arch stone in canonical position: centred on the crown (90 degrees), local units are metres. */
function voussoirMesh(ri, ro, depth, half, seg = 6) {
  const P = [], N = [], I = [];
  const hz = depth / 2;
  const quad = (a, b, c, d, n) => {
    const k = P.length / 3;
    for (const p of [a, b, c, d]) { P.push(...p); N.push(...n); }
    I.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const at = (r, t, z) => [Math.cos(t) * r, Math.sin(t) * r, z];
  const t0 = Math.PI / 2 - half, t1 = Math.PI / 2 + half;
  for (let s = 0; s < seg; s++) {
    const a = t0 + ((t1 - t0) * s) / seg, b = t0 + ((t1 - t0) * (s + 1)) / seg;
    const m = (a + b) / 2;
    // extrados (outer) and intrados (inner), smooth radial normals
    quad(at(ro, a, hz), at(ro, a, -hz), at(ro, b, -hz), at(ro, b, hz), [Math.cos(m), Math.sin(m), 0]);
    quad(at(ri, b, hz), at(ri, b, -hz), at(ri, a, -hz), at(ri, a, hz), [-Math.cos(m), -Math.sin(m), 0]);
    // front and back
    quad(at(ri, a, hz), at(ro, a, hz), at(ro, b, hz), at(ri, b, hz), [0, 0, 1]);
    quad(at(ro, a, -hz), at(ri, a, -hz), at(ri, b, -hz), at(ro, b, -hz), [0, 0, -1]);
  }
  // joints
  quad(at(ri, t0, -hz), at(ro, t0, -hz), at(ro, t0, hz), at(ri, t0, hz), [Math.sin(t0), -Math.cos(t0), 0]);
  quad(at(ri, t1, hz), at(ro, t1, hz), at(ro, t1, -hz), at(ri, t1, -hz), [-Math.sin(t1), Math.cos(t1), 0]);
  return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint16Array(I) };
}

export function createParts(gl, maxInstances = 256) {
  const prog = createProgram(gl, VS, FS, 'parts');
  const depthProg = createProgram(gl, VS, DEPTH_FS, 'parts-depth');
  const half = ARCH.span / 2;
  const meshes = [boxMesh(), voussoirMesh(ARCH.ri, ARCH.ro, ARCH.depth, half), voussoirMesh(ARCH.ri, ARCH.ro + ARCH.keyRise, ARCH.depth, half)];
  const B = PART_STRIDE * 4;
  const buckets = meshes.map((m) => {
    const pb = createBuffer(gl, m.P), nb = createBuffer(gl, m.N), ib = createBuffer(gl, m.I, gl.ELEMENT_ARRAY_BUFFER);
    const inst = createBuffer(gl, new Float32Array(maxInstances * PART_STRIDE), gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    const vao = createVAO(gl, [
      { buffer: pb, loc: 0, size: 3 },
      { buffer: nb, loc: 1, size: 3 },
      { buffer: inst, loc: 2, size: 3, stride: B, offset: 0, divisor: 1 },
      { buffer: inst, loc: 3, size: 3, stride: B, offset: 12, divisor: 1 },
      { buffer: inst, loc: 4, size: 4, stride: B, offset: 24, divisor: 1 },
      { buffer: inst, loc: 5, size: 4, stride: B, offset: 40, divisor: 1 },
    ], ib);
    return { vao, inst, count: m.I.length };
  });

  function upload(frame) {
    const P = frame.parts;
    buckets.forEach((bk, mi) => {
      const n = P.counts[mi];
      if (!n) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, bk.inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, P.data[mi], 0, n * PART_STRIDE);
    });
  }
  function drawAll(p, frame, withMeshUniform) {
    const P = frame.parts;
    buckets.forEach((bk, mi) => {
      const n = P.counts[mi];
      if (!n) return;
      if (withMeshUniform) p.set('uMesh', mi);
      gl.bindVertexArray(bk.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, bk.count, gl.UNSIGNED_SHORT, 0, n);
    });
  }
  return {
    hasAny: (frame) => frame.parts && frame.parts.counts.some((c) => c > 0),
    upload,
    drawDepth(frame, lightViewProj) {
      if (!this.hasAny(frame)) return;
      depthProg.use().set('uViewProj', lightViewProj);
      drawAll(depthProg, frame, false);
    },
    draw(frame, cam, shadow) {
      if (!this.hasAny(frame)) return;
      const s = frame.sky, M = frame.material;
      prog.use();
      prog.setAll({
        uViewProj: cam.viewProj, uCamPos: cam.pos,
        uZenith: s.zenith, uMid: s.mid, uHorizon: s.horizon, uGlow: s.glow, uSunDir: s.sunDir, uAnti: s.anti,
        uStars: 0, uHaze: s.haze, uTime: frame.time,
        uSunCol: M.sunCol, uAmbTop: M.ambTop, uAmbBottom: M.ambBottom, uFogCol: M.fogCol, uFogDensity: M.fog,
        uLight: M.light, uHotCol: M.hotCol,
        uArch: [ARCH.ri, ARCH.ro, ARCH.depth, ARCH.span / 2], uKeyRise: ARCH.keyRise,
      });
      shadow.bind(prog, frame);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      drawAll(prog, frame, true);
      gl.disable(gl.CULL_FACE);
    },
  };
}
export { MESH };
