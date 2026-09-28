// Particle target shapes. Every shape stores, per particle: position (xyz) + size (w), and an RGBA8
// attribute: r = highlight, g = brightness jitter, b = group, a = spare.
import { mulberry32, latLon, v3, DEG } from './math.js';
import { CITY, NETWORK, BRAIN, STONE, DUBAI, SHANGHAI, dune, buildStoneMesh } from './world.js';

export const S = {
  SCATTER: 0, HORIZON: 1, DESERT: 2, GLOBE: 3, RAIN: 4, TOWERS: 5,
  FLOW_A: 6, FLOW_B: 7, BRAIN: 8, VORTEX: 9, POINT: 10, GRID: 11, FINAL: 12,
};
export const SHAPE_COUNT = 13;

function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
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

  // --- SCATTER: a loose volume of dust
  {
    const rnd = mulberry32(1);
    for (let i = 0; i < N; i++) {
      put(S.SCATTER, i, (rnd() * 2 - 1) * 90, rnd() * 70 + 2, (rnd() * 2 - 1) * 90 - 20, 0.1, 0, 120 + rnd() * 135);
    }
  }

  // --- DESERT + HORIZON: log-distributed through the view frustum, so density reads even on screen
  const desert = (rnd, i, shape, group = 0, extra = 1) => {
    const u = rnd();
    const d = Math.exp(Math.log(1.4) + (Math.log(260) - Math.log(1.4)) * Math.pow(u, 0.92));
    const x = (rnd() * 2 - 1) * (0.95 * d + 5) * extra;
    const z = 5 - d;
    const flat = Math.min(1, Math.max(0, (d - 2) / 12));
    const y = (dune(x, z) + 0.6) * 0.55 * flat + 0.01;
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
      // matching horizon position: same screen column, pushed out to the vanishing line
      put(S.HORIZON, i, (x * far) / Math.max(d, 1.4), 0.0, 5 - far, 0.26 + rnd() * 0.16, 0, 255);
    }
  }

  // --- GLOBE (unit sphere): land dots, sparse ocean, Gulf + East China highlighted
  {
    const rnd = mulberry32(3);
    const land = (lat, lon) => {
      const x = Math.floor(((lon + 180) / 360) * mask.w) % mask.w;
      const y = Math.min(mask.h - 1, Math.floor(((90 - lat) / 180) * mask.h));
      return mask.data[y * mask.w + x] === 1;
    };
    const dub = latLon(DUBAI.lat, DUBAI.lon), sha = latLon(SHANGHAI.lat, SHANGHAI.lon);
    let i = 0;
    const oceanAccept = 0.045; // roughly 8% of the dots sit on the oceans
    while (i < N) {
      const zz = rnd() * 2 - 1, ph = rnd() * Math.PI * 2;
      const rr = Math.sqrt(1 - zz * zz);
      const p = [rr * Math.sin(ph), zz, rr * Math.cos(ph)];
      const lat = Math.asin(p[1]) / DEG;
      const lon = Math.atan2(p[0], p[2]) / DEG;
      const isLand = land(lat, lon);
      if (!isLand && rnd() > oceanAccept) continue;
      const dd = Math.acos(Math.min(1, v3.dot(p, dub))) / DEG;
      const ds = Math.acos(Math.min(1, v3.dot(p, sha))) / DEG;
      const hi = isLand && (dd < 8 || ds < 10) ? 255 : isLand && (dd < 13 || ds < 16) ? 110 : 0;
      const s = isLand ? 1.0 : 0.994;
      put(S.GLOBE, i, p[0] * s, p[1] * s, p[2] * s, isLand ? 0.0042 + rnd() * 0.0026 : 0.0032, hi, isLand ? 150 + rnd() * 105 : 60);
      i++;
    }
  }

  // --- RAIN: above the city
  {
    const rnd = mulberry32(4);
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 70;
      put(S.RAIN, i, Math.cos(a) * r, 50 + rnd() * 110, Math.sin(a) * r, 0.14, 0, 150 + rnd() * 105);
    }
  }

  // --- TOWERS: area-weighted points on every facade and roof
  {
    const rnd = mulberry32(5);
    const faces = [];
    let total = 0;
    for (const t of CITY.towers) {
      const areas = [t.w * t.h, t.w * t.h, t.d * t.h, t.d * t.h, t.w * t.d];
      for (let f = 0; f < 5; f++) { total += areas[f]; faces.push([t, f, total]); }
    }
    for (let i = 0; i < N; i++) {
      const r = rnd() * total;
      let lo = 0, hi = faces.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (faces[m][2] < r) lo = m + 1; else hi = m; }
      const [t, f] = faces[lo];
      const u = rnd() - 0.5, v = rnd();
      const o = 0.06;
      let x, y, z;
      if (f === 0) { x = t.x + u * t.w; y = v * t.h; z = t.z + t.d / 2 + o; }
      else if (f === 1) { x = t.x + u * t.w; y = v * t.h; z = t.z - t.d / 2 - o; }
      else if (f === 2) { x = t.x + t.w / 2 + o; y = v * t.h; z = t.z + u * t.d; }
      else if (f === 3) { x = t.x - t.w / 2 - o; y = v * t.h; z = t.z + u * t.d; }
      else { x = t.x + u * t.w; y = t.h + o; z = t.z + (v - 0.5) * t.d; }
      put(S.TOWERS, i, x, y, z, 0.13, 0, 150 + rnd() * 105);
    }
  }

  // --- FLOW: data moving along the rooftop network (A = start + speed, B = end + size)
  {
    const rnd = mulberry32(6);
    const { nodes, edges, lens } = NETWORK;
    const cum = [];
    let total = 0;
    lens.forEach((l) => { total += l; cum.push(total); });
    for (let i = 0; i < N; i++) {
      const r = rnd() * total;
      let k = cum.findIndex((c) => c >= r);
      if (k < 0) k = edges.length - 1;
      let [a, b] = edges[k];
      if (rnd() < 0.5) [a, b] = [b, a];
      const A = nodes[a], B = nodes[b];
      const j = () => gauss(rnd) * 0.22;
      const oA = (i * 4 + (S.FLOW_A * N) * 4), oB = (i * 4 + (S.FLOW_B * N) * 4);
      pos[oA] = A[0] + j(); pos[oA + 1] = A[1] + j(); pos[oA + 2] = A[2] + j(); pos[oA + 3] = 0.05 + rnd() * 0.16;
      pos[oB] = B[0] + j(); pos[oB + 1] = B[1] + j(); pos[oB + 2] = B[2] + j(); pos[oB + 3] = 0.16 + rnd() * 0.12;
      attr[oA] = attr[oB] = 255;
      attr[oA + 1] = attr[oB + 1] = 160 + rnd() * 95;
    }
  }

  // --- BRAIN: clustered at neurons, strung along synapses
  {
    const rnd = mulberry32(7);
    const { nodes, edges } = BRAIN;
    for (let i = 0; i < N; i++) {
      if (rnd() < 0.42) {
        const n = nodes[Math.floor(rnd() * nodes.length)];
        const s = 0.32;
        put(S.BRAIN, i, n[0] + gauss(rnd) * s, n[1] + gauss(rnd) * s, n[2] + gauss(rnd) * s, 0.09 + rnd() * 0.07, 255, 200 + rnd() * 55);
      } else {
        const [a, b] = edges[Math.floor(rnd() * edges.length)];
        const t = rnd();
        const A = nodes[a], B = nodes[b];
        const j = 0.045;
        put(S.BRAIN, i, A[0] + (B[0] - A[0]) * t + gauss(rnd) * j, A[1] + (B[1] - A[1]) * t + gauss(rnd) * j, A[2] + (B[2] - A[2]) * t + gauss(rnd) * j, 0.05, 30, 90 + rnd() * 90);
      }
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

  // --- GRID: a dotted drafting lattice on the ground
  {
    const rnd = mulberry32(10);
    const step = 2.4, ext = 62;
    const lines = Math.floor(ext / step);
    for (let i = 0; i < N; i++) {
      const k = Math.floor(rnd() * (lines * 2 + 1)) - lines;
      const along = (rnd() * 2 - 1) * ext;
      const major = k % 5 === 0;
      const vertical = rnd() < 0.5;
      const x = vertical ? k * step : along;
      const z = vertical ? along : k * step;
      put(S.GRID, i, x, 0.02, z, major ? 0.075 : 0.05, major ? 200 : 0, major ? 255 : 150);
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
    const shellShare = 0.36;
    for (let i = 0; i < N; i++) {
      if (rnd() < shellShare) {
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
        desert(rnd, i, S.FINAL, 0, 1.15);
      }
    }
  }

  return { pos, attr, N, side };
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
