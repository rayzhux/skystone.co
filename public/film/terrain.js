// Two landscapes. The desert: a polar mesh of dunes around the camera, with wind ripples, backlit crests
// and sun shadows. The insight landscape: a night relief whose contour lines draw themselves outward.
import { createProgram, createBuffer, createVAO, GLSL_NOISE } from './gl.js';
import { GLSL_SKY } from './sky.js';
import { GLSL_SHADOW } from './shadow.js';
import { dune, DESERT_ORIGIN, TOPO } from './world.js';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
void main(){
  vWorld = aPos;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const SAND_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uCamPos, uSand, uSunCol, uAmb;
uniform float uFogDensity, uLight, uAmt;
out vec4 o;
${GLSL_NOISE}
${GLSL_SKY}
${GLSL_SHADOW}
void main(){
  vec3 n = normalize(vNormal);
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  // wind ripples, fading out before they can alias
  vec2 q = vWorld.xz;
  float fade = 1.0 - smoothstep(18.0, 70.0, dist);
  float rip = sin(dot(q, vec2(0.93, 0.37)) * 6.5 + vnoise(vec3(q * 0.3, 0.0)) * 7.0);
  n = normalize(n + vec3(0.93, 0.0, 0.37) * rip * 0.07 * fade);
  float sh = shadowAt(vWorld, n);
  float ndl = dot(n, uSunDir);
  vec3 albedo = uSand * (0.88 + 0.24 * vnoise(vWorld * 0.7) + 0.08 * hash13(floor(vWorld * 40.0)) * fade);
  vec3 col = albedo * (uAmb * (0.55 + 0.45 * n.y) + uSunCol * max(ndl, 0.0) * sh * 1.25) * uLight;
  // crests glow when the sun sits behind them
  float back = pow(max(dot(-v, uSunDir), 0.0), 5.0) * smoothstep(-0.15, 0.35, ndl);
  col += uGlow * back * 0.09 * sh * uLight;
  vec3 rd = -v;
  vec3 hor = skyColor(normalize(vec3(rd.x, 0.0005, rd.z)));
  float fog = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, hor * 0.82, fog);
  o = vec4(col * uAmt, 1.0);
}`;

const TOPO_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
uniform vec3 uCamPos, uBase, uLine, uMoonDir, uFogCol;
uniform vec2 uOrigin;
uniform float uReveal, uInterval, uFogDensity, uAmt, uLineAmt;
out vec4 o;
${GLSL_NOISE}
float iso(float f, float px){
  float w = fwidth(f) * px;
  return 1.0 - smoothstep(0.0, max(w, 1e-4), abs(fract(f + 0.5) - 0.5));
}
void main(){
  vec3 n = normalize(vNormal);
  float h = vWorld.y;
  float shade = max(dot(n, uMoonDir), 0.0);
  float slope = 1.0 - n.y;
  vec3 col = uBase * (0.28 + 1.05 * shade) * (1.0 - slope * 0.35);
  col *= 0.92 + 0.16 * vnoise(vWorld * 0.35);
  float minor = iso(h / uInterval, 1.1);
  float major = iso(h / (uInterval * 5.0), 1.8);
  float rd = length(vWorld.xz - uOrigin);
  float rev = 1.0 - smoothstep(uReveal - 24.0, uReveal, rd);
  float frontier = exp(-pow((rd - uReveal) / 7.0, 2.0)) * step(0.001, uReveal);
  col += uLine * (minor * 0.38 + major * 1.05) * rev * uLineAmt;
  col += uLine * (minor + major) * frontier * 0.8 * uLineAmt;
  float d = length(vWorld - uCamPos);
  col = mix(col, uFogCol, 1.0 - exp(-d * uFogDensity));
  o = vec4(col * uAmt, 1.0);
}`;

const DEPTH_FS = `#version 300 es
precision highp float;
void main(){}`;

function duneMesh(rings, segs, growth) {
  const [ox, oz] = DESERT_ORIGIN;
  const P = [], N = [], I = [];
  const e = 0.35;
  for (let i = 0; i <= rings; i++) {
    const r = i === 0 ? 0 : 0.6 * Math.pow(growth, i);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = ox + Math.cos(a) * r, z = oz + Math.sin(a) * r;
      const y = dune(x, z);
      const dx = dune(x + e, z) - dune(x - e, z), dz = dune(x, z + e) - dune(x, z - e);
      const nx = -dx, ny = 2 * e, nz = -dz;
      const l = Math.hypot(nx, ny, nz);
      P.push(x, y, z);
      N.push(nx / l, ny / l, nz / l);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      I.push(a, b, c, b, d, c);
    }
  }
  return { P: new Float32Array(P), N: new Float32Array(N), I: new Uint32Array(I) };
}

/** grid: { n, size, heights: Float32Array(n*n) } built in the worker. */
function topoMesh(grid) {
  const { n, size, heights } = grid;
  const P = new Float32Array(n * n * 3), N = new Float32Array(n * n * 3);
  const step = size / (n - 1);
  const H = (i, j) => heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      P[k] = -size / 2 + i * step;
      P[k + 1] = H(i, j);
      P[k + 2] = -size / 2 + j * step;
      const nx = H(i - 1, j) - H(i + 1, j), nz = H(i, j - 1) - H(i, j + 1), ny = 2 * step;
      const l = Math.hypot(nx, ny, nz);
      N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l;
    }
  }
  const I = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      I[o++] = a; I[o++] = c; I[o++] = b; I[o++] = b; I[o++] = c; I[o++] = d;
    }
  }
  return { P, N, I };
}

export function createTerrain(gl, { topoGrid, quality = 'high' }) {
  const sand = createProgram(gl, VS, SAND_FS, 'sand');
  const topo = createProgram(gl, VS, TOPO_FS, 'topo');
  const depth = createProgram(gl, VS, DEPTH_FS, 'terrain-depth');
  const dm = quality === 'low' ? duneMesh(120, 180, 1.058) : duneMesh(170, 300, 1.041);
  const tm = topoMesh(topoGrid);
  const make = (m) => {
    const vao = createVAO(gl, [
      { buffer: createBuffer(gl, m.P), loc: 0, size: 3 },
      { buffer: createBuffer(gl, m.N), loc: 1, size: 3 },
    ], createBuffer(gl, m.I, gl.ELEMENT_ARRAY_BUFFER));
    return { vao, count: m.I.length };
  };
  const dunes = make(dm), relief = make(tm);
  void TOPO;

  return {
    drawDepth(frame, lightViewProj) {
      if (!frame.dunes.visible) return;
      depth.use().set('uViewProj', lightViewProj);
      gl.bindVertexArray(dunes.vao);
      gl.drawElements(gl.TRIANGLES, dunes.count, gl.UNSIGNED_INT, 0);
    },
    draw(frame, cam, shadow) {
      const s = frame.sky;
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      if (frame.dunes.visible) {
        const D = frame.dunes;
        sand.use().setAll({
          uViewProj: cam.viewProj, uCamPos: cam.pos,
          uZenith: s.zenith, uMid: s.mid, uHorizon: s.horizon, uGlow: s.glow, uSunDir: s.sunDir, uAnti: s.anti,
          uStars: 0, uHaze: s.haze, uTime: frame.time,
          uSand: D.sand, uSunCol: D.sunCol, uAmb: D.amb, uFogDensity: s.fog, uLight: D.light, uAmt: s.amt,
        });
        shadow.bind(sand, frame);
        gl.bindVertexArray(dunes.vao);
        gl.drawElements(gl.TRIANGLES, dunes.count, gl.UNSIGNED_INT, 0);
      }
      if (frame.topo.visible) {
        const T = frame.topo;
        topo.use().setAll({
          uViewProj: cam.viewProj, uCamPos: cam.pos, uBase: T.base, uLine: T.line, uMoonDir: T.moonDir,
          uFogCol: T.fogCol, uOrigin: T.origin, uReveal: T.reveal, uInterval: T.interval,
          uFogDensity: T.fog, uAmt: T.amt, uLineAmt: T.lineAmt,
        });
        gl.bindVertexArray(relief.vao);
        gl.drawElements(gl.TRIANGLES, relief.count, gl.UNSIGNED_INT, 0);
      }
    },
  };
}
