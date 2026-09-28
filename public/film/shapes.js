// Particle target shapes. Every shape stores, per particle: position (xyz) + size (w), and an RGBA8
// attribute: r = highlight, g = brightness jitter, b = group, a = spare.
import { mulberry32, latLon, v3, DEG } from './math.js';
import { STONE, DUBAI, CITIES, TOPO, topoH, dune, buildStoneMesh, archEvents } from './world.js';

export const S = {
  SCATTER: 0, HORIZON: 1, DESERT: 2, GLOBE: 3, TERRAIN: 4, BURST_A: 5, BURST_B: 6, VORTEX: 7, POINT: 8, FINAL: 9,
};
export const SHAPE_COUNT = 10;

function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The insight landscape sampled on a grid (the mesh and the scan points both use it). */
export function buildTopoGrid(n = 201) {
  const size = TOPO.size;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      heights[j * n + i] = topoH(-size / 2 + (i / (n - 1)) * size, -size / 2 + (j / (n - 1)) * size);
    }
  }
  return { n, size, heights };
}
function sampleGrid(g, x, z) {
  const { n, size, heights } = g;
  const fx = ((x + size / 2) / size) * (n - 1), fz = ((z + size / 2) / size) * (n - 1);
  const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz)));
  const u = fx - i, v = fz - j;
  const h = (a, b) => heights[b * n + a];
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

/** mask: { w, h, data: Uint8Array } equirectangular land mask (1 = land) */
export function buildShapes(side, mask) {
  const N = side * side;
  const pos = new Float32Array(N * 4 * SHAPE_COUNT);
  const attr = new Uint8Array(N * 4 * SHAPE_COUNT);
  const put = (shape, i, x, y, z, size, hi = 0, bright = 200, group = 0) => {
    const o = (shape * N + i) * 4;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; pos[o + 3] = size;
    attr[o] = hi; attr[o + 1] = bright; attr[o + 2] = group; attr[o + 3] = 0;
  };
  const topoGrid = buildTopoGrid();

  // --- SCATTER: a loose volume of dust
  {
    const rnd = mulberry32(1);
    for (let i = 0; i < N; i++) {
      put(S.SCATTER, i, (rnd() * 2 - 1) * 90, rnd() * 70 + 2, (rnd() * 2 - 1) * 90 - 20, 0.1, 0, 120 + rnd() * 135);
    }
  }

  // --- DESERT + HORIZON: log-distributed through the view frustum, riding the dunes
  const desert = (rnd, i, shape, group = 0, extra = 1, z0 = 5) => {
    const u = rnd();
    const d = Math.exp(Math.log(1.4) + (Math.log(260) - Math.log(1.4)) * Math.pow(u, 0.92));
    const x = (rnd() * 2 - 1) * (0.95 * d + 5) * extra;
    const z = z0 - d;
    const y = dune(x, z) + 0.02;
    const size = (0.006 + 0.011 * rnd()) * (1 + d * 0.04);
    const glint = rnd() < 0.035 ? 255 : 0;
    put(shape, i, x, y, z, size, glint, 110 + rnd() * 145, group);
    return [x, d];
  };
  {
    const rnd = mulberry32(2);
    const far = 420;
    for (let i = 0; i < N; i++) {
      const [x, d] = desert(rnd, i, S.DESERT);
      put(S.HORIZON, i, (x * far) / Math.max(d, 1.4), 0.0, 5 - far, 0.26 + rnd() * 0.16, 0, 255);
    }
  }

  // --- GLOBE (unit sphere): land dots, sparse ocean; Dubai and the five cities glow
  {
    const rnd = mulberry32(3);
    const land = (lat, lon) => {
      const x = Math.floor(((lon + 180) / 360) * mask.w) % mask.w;
      const y = Math.min(mask.h - 1, Math.floor(((90 - lat) / 180) * mask.h));
      return mask.data[y * mask.w + x] === 1;
    };
    const hubs = [DUBAI, ...CITIES].map((c) => latLon(c.lat, c.lon));
    let i = 0;
    const oceanAccept = 0.045;
    while (i < N) {
      const zz = rnd() * 2 - 1, ph = rnd() * Math.PI * 2;
      const rr = Math.sqrt(1 - zz * zz);
      const p = [rr * Math.sin(ph), zz, rr * Math.cos(ph)];
      const lat = Math.asin(p[1]) / DEG;
      const lon = Math.atan2(p[0], p[2]) / DEG;
      const isLand = land(lat, lon);
      if (!isLand && rnd() > oceanAccept) continue;
      let near = 180;
      for (const hb of hubs) near = Math.min(near, Math.acos(Math.min(1, v3.dot(p, hb))) / DEG);
      const hi = isLand && near < 3.5 ? 255 : isLand && near < 7 ? 90 : 0;
      const s = isLand ? 1.0 : 0.994;
      put(S.GLOBE, i, p[0] * s, p[1] * s, p[2] * s, isLand ? 0.0042 + rnd() * 0.0026 : 0.0032, hi, isLand ? 150 + rnd() * 105 : 60);
      i++;
    }
  }

  // --- TERRAIN: scan points over the insight landscape
  {
    const rnd = mulberry32(4);
    const half = TOPO.size * 0.47;
    for (let i = 0; i < N; i++) {
      const x = (rnd() * 2 - 1) * half, z = (rnd() * 2 - 1) * half;
      put(S.TERRAIN, i, x, sampleGrid(topoGrid, x, z) + 0.35, z, 0.16 + rnd() * 0.08, rnd() < 0.02 ? 255 : 0, 140 + rnd() * 115);
    }
  }

  // --- BURSTS: dust kicked up where each arch stone lands (A = origin + time, B = velocity + life)
  {
    const rnd = mulberry32(5);
    const ev = archEvents();
    for (let i = 0; i < N; i++) {
      const e = ev[i % ev.length];
      const a = rnd() * Math.PI * 2, el = rnd() * 0.9;
      const sp = (0.6 + rnd() * 2.2) * e.spread;
      const vx = Math.cos(a) * Math.cos(el) * sp, vz = Math.sin(a) * Math.cos(el) * sp * 0.6, vy = Math.sin(el) * sp * 0.7 + 0.2;
      const oA = (S.BURST_A * N + i) * 4, oB = (S.BURST_B * N + i) * 4;
      pos[oA] = e.pos[0] + gauss(rnd) * 0.4 * e.spread; pos[oA + 1] = e.pos[1] + gauss(rnd) * 0.25; pos[oA + 2] = e.pos[2] + gauss(rnd) * 0.5;
      pos[oA + 3] = e.t + rnd() * 0.05;
      pos[oB] = vx; pos[oB + 1] = vy; pos[oB + 2] = vz; pos[oB + 3] = 0.7 + rnd() * 1.1;
      attr[oA] = attr[oB] = rnd() < 0.08 ? 255 : 0;
      attr[oA + 1] = attr[oB + 1] = 150 + rnd() * 105;
    }
  }

  // --- VORTEX (stored as r, y, theta0, size; spun in the shader)
  {
    const rnd = mulberry32(8);
    for (let i = 0; i < N; i++) {
      const r = 2.2 + 57 * Math.pow(rnd(), 1.6);
      const arm = rnd() < 0.5 ? 0 : Math.PI;
      const th = arm + 2.4 * Math.log(r) + gauss(rnd) * (0.28 + 0.1 * Math.log(r + 1));
      const y = gauss(rnd) * (0.18 + 1.1 * Math.exp(-r / 5));
      const hi = r < 9 ? 255 : r < 20 ? 90 : 0;
      put(S.VORTEX, i, r, y, th, 0.07 + rnd() * 0.1, hi, 130 + rnd() * 125);
    }
  }

  // --- POINT: the singularity
  {
    const rnd = mulberry32(9);
    for (let i = 0; i < N; i++) {
      put(S.POINT, i, gauss(rnd) * 0.05, gauss(rnd) * 0.05, gauss(rnd) * 0.05, 0.02, 255, 255);
    }
  }

  // --- FINAL: the stone's skin (group 1) standing in the desert (group 0)
  {
    const rnd = mulberry32(11);
    const mesh = buildStoneMesh(48, 64);
    const tris = [];
    let total = 0;
    for (let f = 0; f < mesh.idx.length; f += 3) {
      const a = mesh.idx[f] * 3, b = mesh.idx[f + 1] * 3, c = mesh.idx[f + 2] * 3;
      const A = [mesh.pos[a], mesh.pos[a + 1], mesh.pos[a + 2]];
      const B = [mesh.pos[b], mesh.pos[b + 1], mesh.pos[b + 2]];
      const C = [mesh.pos[c], mesh.pos[c + 1], mesh.pos[c + 2]];
      const area = v3.len(v3.cross(v3.sub(B, A), v3.sub(C, A))) / 2;
      total += area;
      tris.push([A, B, C, total]);
    }
    for (let i = 0; i < N; i++) {
      if (rnd() < 0.36) {
        const r = rnd() * total;
        let lo = 0, hi = tris.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m][3] < r) lo = m + 1; else hi = m; }
        const [A, B, C] = tris[lo];
        let u = rnd(), v = rnd();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const p = [A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * v, A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * v, A[2] + (B[2] - A[2]) * u + (C[2] - A[2]) * v];
        const c = STONE.center;
        put(S.FINAL, i, p[0] * 1.012 + c[0], p[1] * 1.012 + c[1], p[2] * 1.012 + c[2], 0.03 + rnd() * 0.02, 180, 230, 1);
      } else {
        // starts behind the closing camera so the glitter never ends in a hard line
        desert(rnd, i, S.FINAL, 0, 1.15, 12.5);
      }
    }
  }

  return { pos, attr, N, side, topoGrid };
}

/** Decode a 1-bit land-mask image into a byte array. */
export function readMask(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const data = new Uint8Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = d[i * 4] > 127 ? 1 : 0;
  return { w: c.width, h: c.height, data };
}
