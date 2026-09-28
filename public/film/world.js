// Deterministic world data shared by the renderers, the particle targets and the director.
import { mulberry32, v3 } from './math.js';

// ---------------------------------------------------------------- places
export const DUBAI = { lat: 25.2048, lon: 55.2708 };
export const SHANGHAI = { lat: 31.2304, lon: 121.4737 };
export const ROUTE_KM = 6428; // great-circle distance, Dubai to Shanghai

// ---------------------------------------------------------------- globe
export const GLOBE = { center: [0, 30, -62], radius: 13 };

// ---------------------------------------------------------------- city
// A grid city with one wide boulevard along x (|z| < 10) and a project site at the origin.
export const CITY = buildCity();

function buildCity() {
  const rnd = mulberry32(20240);
  const towers = [];
  const pitch = 16, block = 12;
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      if (j === 0) continue; // the boulevard
      const cx = i * pitch, cz = j * pitch;
      const r = Math.hypot(cx, cz * 1.15);
      const edge = Math.max(Math.abs(i), Math.abs(j));
      if (edge === 3 && rnd() < 0.25) continue; // ragged outskirts
      const split = rnd();
      const lots = split < 0.34 ? [[0, 0, 1, 1]] : split < 0.72 ? [[-0.25, 0, 0.5, 1], [0.25, 0, 0.5, 1]] : [
        [-0.25, -0.25, 0.5, 0.5], [0.25, -0.25, 0.5, 0.5], [-0.25, 0.25, 0.5, 0.5], [0.25, 0.25, 0.5, 0.5],
      ];
      for (const [ox, oz, sx, sz] of lots) {
        const setback = 0.8 + rnd() * 1.4;
        const w = block * sx - setback * 2 * (0.6 + rnd() * 0.4);
        const d = block * sz - setback * 2 * (0.6 + rnd() * 0.4);
        if (w < 2.5 || d < 2.5) continue;
        const hMax = 9 + 52 * Math.exp(-Math.pow(r / 40, 2)) + (Math.abs(j) === 1 ? 10 : 0);
        let h = hMax * (0.42 + 0.58 * rnd());
        if (rnd() < 0.08) h *= 0.5; // podium blocks
        towers.push({
          x: cx + ox * block, z: cz + oz * block, w, d, h: Math.max(4, h),
          seed: rnd(), r,
        });
      }
    }
  }
  // Three supertalls flanking the boulevard near the centre.
  const supers = [[-9, -16, 7, 7, 86], [14, 17, 6.5, 6.5, 74], [-26, 16.5, 6, 6.5, 64]];
  for (const [x, z, w, d, h] of supers) {
    for (let k = towers.length - 1; k >= 0; k--) {
      const t = towers[k];
      if (Math.abs(t.x - x) < (t.w + w) / 2 + 1.5 && Math.abs(t.z - z) < (t.d + d) / 2 + 1.5) towers.splice(k, 1);
    }
    towers.push({ x, z, w, d, h, seed: rnd(), r: Math.hypot(x, z), super: true });
  }
  for (const t of towers) {
    t.delay = Math.min(1, t.r / 60) * 0.55 + rnd() * 0.18;
    // setbacks and crowns: [y0, y1] as fractions of height, then footprint scales
    if (t.super) t.tiers = [[0, 0.74, 1, 1], [0.74, 0.88, 0.72, 0.72], [0.88, 0.96, 0.46, 0.46], [0.96, 1.12, 0.07, 0.07]];
    else if (t.h > 32 && rnd() < 0.75) { const a = 0.6 + rnd() * 0.16; t.tiers = [[0, a, 1, 1], [a, 1, 0.6 + rnd() * 0.22, 0.6 + rnd() * 0.22]]; }
    else if (t.h > 20 && rnd() < 0.35) t.tiers = [[0, 0.86, 1, 1], [0.86, 1, 0.5, 0.72]];
    else t.tiers = [[0, 1, 1, 1]];
  }
  return { towers };
}

/** City data network: nodes on tall rooftops, nearest-neighbour edges plus a few long links. */
export const NETWORK = buildNetwork();

function buildNetwork() {
  const rnd = mulberry32(88);
  const nodes = CITY.towers.filter((t) => t.h > 22).map((t) => [t.x, t.h + 0.6, t.z]);
  const edges = [];
  const seen = new Set();
  const add = (a, b) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || seen.has(k)) return;
    seen.add(k);
    edges.push([a, b]);
  };
  nodes.forEach((p, i) => {
    const near = nodes
      .map((q, j) => [j, Math.hypot(p[0] - q[0], p[2] - q[2])])
      .filter(([j]) => j !== i)
      .sort((x, y) => x[1] - y[1]);
    add(i, near[0][0]);
    add(i, near[1][0]);
    if (rnd() < 0.5) add(i, near[2][0]);
  });
  for (let k = 0; k < 10; k++) add(Math.floor(rnd() * nodes.length), Math.floor(rnd() * nodes.length));
  const cx = 0, cz = 0;
  const lens = edges.map(([a, b]) => Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][2] - nodes[b][2]));
  const delays = edges.map(([a, b]) => {
    const m = [(nodes[a][0] + nodes[b][0]) / 2, (nodes[a][2] + nodes[b][2]) / 2];
    return Math.min(1, Math.hypot(m[0] - cx, m[1] - cz) / 60);
  });
  return { nodes, edges, lens, delays };
}

// ---------------------------------------------------------------- the project tower (exploded axonometric)
export const PROJECT = { floors: 14, floorH: 3.6, w: 15, d: 11, core: 4.6 };

// ---------------------------------------------------------------- neural cloud (AI)
export const BRAIN = buildBrain();

function buildBrain() {
  const rnd = mulberry32(512);
  const nodes = [];
  const n = 84;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) * (2 / n);
    const rad = Math.sqrt(1 - y * y);
    const phi = i * 2.399963;
    const R = 12.5 * (0.86 + rnd() * 0.22);
    nodes.push([Math.cos(phi) * rad * R, y * R * 0.82, Math.sin(phi) * rad * R]);
  }
  for (let i = 0; i < 22; i++) {
    const d = v3.norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
    const R = 3 + rnd() * 5;
    nodes.push([d[0] * R, d[1] * R * 0.8, d[2] * R]);
  }
  const edges = [];
  const seen = new Set();
  nodes.forEach((p, i) => {
    const near = nodes.map((q, j) => [j, v3.len(v3.sub(p, q))]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]);
    for (let k = 0; k < 3; k++) {
      const j = near[k][0];
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) { seen.add(key); edges.push([i, j]); }
    }
  });
  return { nodes, edges };
}

// ---------------------------------------------------------------- the stone
export const STONE = { center: [0, 3.1, -6], radii: [1.28, 3.1, 0.66], exp: 0.56 };

/** Superellipsoid mesh with a whisper of organic noise. Returns interleaved-free arrays. */
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
      // a standing stone, not a capsule: heavier at the foot, a leaning shoulder, soft lumps
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
  // smooth normals by accumulating face normals
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
  // weld the seam and poles: average normals of coincident vertices
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
/** Dune height field shared by particle targets (JS) and the ground shader (GLSL mirror). */
export function dune(x, z) {
  return (
    0.55 * Math.sin(x * 0.09 + z * 0.05) +
    0.32 * Math.sin(x * 0.21 - z * 0.13 + 1.3) +
    0.18 * Math.sin(z * 0.31 + x * 0.07 + 2.1)
  );
}
