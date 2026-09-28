// Deterministic world data shared by the renderers, the particle targets and the director.
// Everything in the film is made of two materials: stone and sky.
import { mulberry32, v3 } from './math.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- places
export const DUBAI = { name: 'Dubai', lat: 25.2048, lon: 55.2708 };
export const CITIES = [
  { name: 'London', lat: 51.5072, lon: -0.1276 },
  { name: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Shanghai', lat: 31.2304, lon: 121.4737 },
  { name: 'New York', lat: 40.7128, lon: -74.006 },
];

// ---------------------------------------------------------------- globe
export const GLOBE = { center: [0, 30, -62], radius: 13 };

// ---------------------------------------------------------------- materials and meshes for the stone parts
export const MESH = { BOX: 0, VOUSSOIR: 1, KEYSTONE: 2 };
export const KIND = { BASALT: 0, TRAVERTINE: 1 };

// ---------------------------------------------------------------- investment: seven monoliths, each taller than the last
export const FIELD = (() => {
  const center = [0, 0, -48];
  const heights = [2.9, 4.0, 5.3, 6.9, 8.8, 11.1, 13.8];
  const stones = heights.map((h, i) => {
    const u = i - 3;
    return {
      x: center[0] + u * 4.7,
      z: center[2] - u * u * 0.4 - u * 1.4,
      w: 2.35, d: 0.95, h,
      rotY: -0.1 - u * 0.06,
      delay: i / 6,
      kind: KIND.BASALT,
      seed: 0.13 + i * 0.071,
    };
  });
  return { center, radius: 22, stones };
})();

// ---------------------------------------------------------------- the arch (implementation): fifteen stones, one key
export const ARCH = { center: [0, 5.2, -96], ri: 6, ro: 7.8, depth: 2.5, count: 15, keyRise: 0.7, pier: { w: 1.8, h: 5.2, d: 2.5 } };
ARCH.span = Math.PI / ARCH.count;
/** Order of placement: springers first, alternating sides, the keystone last. */
export function archStones() {
  const out = [];
  const half = (ARCH.count - 1) / 2;
  for (let i = 0; i < half; i++) {
    out.push({ side: -1, i, angle: Math.PI - (i + 0.5) * ARCH.span });
    out.push({ side: 1, i, angle: (i + 0.5) * ARCH.span });
  }
  out.push({ side: 0, i: half, angle: Math.PI / 2, key: true });
  return out;
}

// ---------------------------------------------------------------- the landscape (insights): mountains, a valley route, a plateau
export const TOPO = { size: 230, plateau: [-20, 0, -26], plateauR: 22, plateauH: 12.1 };
const ROUTE_KNOTS = [[-118, 62], [-78, 44], [-44, 46], [-14, 24], [10, 8], [36, -2], [62, -30], [118, -52]];
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}
export const ROUTE2D = (() => {
  const pts = [];
  const K = ROUTE_KNOTS;
  for (let i = 0; i < K.length - 1; i++) {
    const p0 = K[Math.max(0, i - 1)], p1 = K[i], p2 = K[i + 1], p3 = K[Math.min(K.length - 1, i + 2)];
    for (let s = 0; s < 16; s++) pts.push(catmull(p0, p1, p2, p3, s / 16));
  }
  pts.push(K[K.length - 1]);
  return pts;
})();
function distToRoute(x, z) {
  let best = 1e9;
  for (let i = 1; i < ROUTE2D.length; i++) {
    const [ax, az] = ROUTE2D[i - 1], [bx, bz] = ROUTE2D[i];
    const vx = bx - ax, vz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
  }
  return best;
}
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
/** Height of the insight landscape. Baked into the mesh on the CPU, so the GLSL never needs a copy. */
export function topoH(x, z) {
  let f = 0, amp = 1, freq = 1 / 58, sum = 0;
  for (let o = 0; o < 5; o++) {
    const n = vnoise2(x * freq + o * 17.1, z * freq - o * 9.3);
    const r = 1 - Math.abs(n * 2 - 1);
    f += (o < 2 ? n : r * r) * amp;
    sum += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  let h = (f / sum) * 38 - 8;
  const dv = distToRoute(x, z);
  h -= 10 * Math.exp(-(dv * dv) / (15 * 15));
  const [px, , pz] = TOPO.plateau;
  const pd = Math.hypot(x - px, z - pz) * (1 + 0.12 * Math.sin(Math.atan2(z - pz, x - px) * 3 + 0.7));
  const k = smoothstep(TOPO.plateauR + 22, TOPO.plateauR, pd);
  h = h * (1 - k) + TOPO.plateauH * k;
  // the land falls away to a round edge, like a model on a table
  const e = smoothstep(TOPO.size * 0.5, TOPO.size * 0.34, Math.hypot(x, z));
  return h * e - 5 * (1 - e);
}
/** The route, lifted onto the landscape. */
export function routePath3D(lift = 0.6) {
  return ROUTE2D.map(([x, z]) => [x, topoH(x, z) + lift, z]);
}

// ---------------------------------------------------------------- the skystone
export const STONE = { center: [0, 3.1, -6], radii: [1.28, 3.1, 0.66], exp: 0.56 };

/** Superellipsoid mesh with a whisper of organic noise. */
export function buildStoneMesh(latSeg = 72, lonSeg = 96) {
  const { radii, exp } = STONE;
  const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const P = [];
  for (let i = 0; i <= latSeg; i++) {
    const u = -Math.PI / 2 + (Math.PI * i) / latSeg;
    for (let j = 0; j <= lonSeg; j++) {
      const v = -Math.PI + (2 * Math.PI * j) / lonSeg;
      const cu = Math.cos(u), su = Math.sin(u);
      let x = radii[0] * sgnPow(cu, exp) * sgnPow(Math.cos(v), exp);
      let y = radii[1] * sgnPow(su, exp);
      let z = radii[2] * sgnPow(cu, exp) * sgnPow(Math.sin(v), exp);
      const yn = y / radii[1];
      const taper = 1 + 0.09 * (-yn) - 0.06 * Math.max(0, yn) * yn;
      const lump = 1 + 0.03 * Math.sin(v * 3 + u * 2 + 0.4) + 0.022 * Math.sin(u * 5 + 1.3) + 0.015 * Math.sin(v * 5 - u * 3);
      x *= taper * lump;
      z *= taper * lump * (1 + 0.08 * Math.sin(v * 2 + 0.9) * cu);
      x += 0.16 * Math.max(0, yn) * Math.max(0, yn);
      y += 0.06 * Math.sin(v + 1.1) * cu * cu;
      P.push([x, y, z]);
    }
  }
  const row = lonSeg + 1;
  const pos = new Float32Array(P.length * 3);
  const nrm = new Float32Array(P.length * 3);
  P.forEach((p, k) => pos.set(p, k * 3));
  const idx = [];
  for (let i = 0; i < latSeg; i++) {
    for (let j = 0; j < lonSeg; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let f = 0; f < idx.length; f += 3) {
    const a = P[idx[f]], b = P[idx[f + 1]], c = P[idx[f + 2]];
    const n = v3.cross(v3.sub(b, a), v3.sub(c, a));
    for (let q = 0; q < 3; q++) {
      const o = idx[f + q] * 3;
      nrm[o] += n[0]; nrm[o + 1] += n[1]; nrm[o + 2] += n[2];
    }
  }
  const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
  const groups = new Map();
  P.forEach((p, k) => {
    const kk = key(p);
    if (!groups.has(kk)) groups.set(kk, []);
    groups.get(kk).push(k);
  });
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const s = [0, 0, 0];
    for (const k of g) { s[0] += nrm[k * 3]; s[1] += nrm[k * 3 + 1]; s[2] += nrm[k * 3 + 2]; }
    for (const k of g) { nrm[k * 3] = s[0]; nrm[k * 3 + 1] = s[1]; nrm[k * 3 + 2] = s[2]; }
  }
  for (let k = 0; k < P.length; k++) {
    const o = k * 3;
    const l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1;
    nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l;
  }
  return { pos, nrm, idx: new Uint32Array(idx), count: idx.length };
}

// ---------------------------------------------------------------- desert
export const DESERT_ORIGIN = [0, 8];
const FLAT = [
  [FIELD.center[0], FIELD.center[2], FIELD.radius + 4, FIELD.radius + 16],
  [ARCH.center[0], ARCH.center[2], 15, 30],
  [STONE.center[0], STONE.center[2], 3, 12],
];
/** Dune height: flat where the camera stands and where the stones stand, rolling crests elsewhere. */
export function dune(x, z) {
  const d = Math.hypot(x - DESERT_ORIGIN[0], z - DESERT_ORIGIN[1]);
  let amp = smoothstep(5, 50, d);
  for (const [cx, cz, r0, r1] of FLAT) amp *= smoothstep(r0, r1, Math.hypot(x - cx, z - cz));
  const far = smoothstep(140, 300, d);
  const h =
    1.25 * Math.sin(x * 0.045 + z * 0.028) +
    0.8 * Math.sin(x * 0.11 - z * 0.075 + 1.3) +
    0.38 * Math.sin(z * 0.21 + x * 0.05 + 2.1) +
    0.18 * Math.sin(x * 0.37 + z * 0.19 + 0.5);
  return (h + 1.2) * amp * (1 - 0.6 * far);
}

// ---------------------------------------------------------------- timing shared by the director, the dust and the score
export const ARCH_T = { piers: [16.95, 17.12], first: 17.55, step: 0.125, key: 19.45 };
/** Every moment a stone lands, with where it lands (world space). */
export function archEvents() {
  const ev = [];
  const [cx, cy, cz] = ARCH.center;
  ev.push({ t: ARCH_T.piers[0], pos: [cx - (ARCH.ri + ARCH.ro) / 2, 0.2, cz], spread: 1.6 });
  ev.push({ t: ARCH_T.piers[1], pos: [cx + (ARCH.ri + ARCH.ro) / 2, 0.2, cz], spread: 1.6 });
  archStones().forEach((s, k) => {
    const t = s.key ? ARCH_T.key : ARCH_T.first + k * ARCH_T.step;
    const r = (ARCH.ri + ARCH.ro) / 2;
    ev.push({ t, pos: [cx + Math.cos(s.angle) * r, cy + Math.sin(s.angle) * r, cz], spread: s.key ? 2.4 : 1.1 });
  });
  return ev;
}
