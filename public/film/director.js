// The director: a pure function from film time to a complete frame description. Fifteen seconds at 120 BPM:
// a point of light on a horizon, one abstract form for each of the five disciplines, then the mark.
import { key, ease, clamp, seg, m4, quat, DEG } from './math.js';
import { FORM, EASE, STAGGER } from './field.js';

export const DURATION = 15;
export const CHAPTERS = [
  { t: 0, label: 'Horizon' },
  { t: 1.5, label: 'Investment Advisory' },
  { t: 3.5, label: 'Management Consulting' },
  { t: 5.5, label: 'Programme Management' },
  { t: 7.5, label: 'Implementation & Oversight' },
  { t: 9.5, label: 'Strategic Insights' },
  { t: 11.5, label: 'Skystone' },
];

// ---------------------------------------------------------------- colour (linear)
const lin = (h, k = 1) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2) * k);
};
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const COLORS = { paper: lin('#F4F2EE'), accent: lin('#F2A65E'), hot: lin('#FFD2A0') };

// ---------------------------------------------------------------- matrices
const M = {
  T: (x, y, z) => { const m = m4.create(); m[12] = x; m[13] = y; m[14] = z; return m; },
  S: (x, y, z) => { const m = m4.create(); m[0] = x; m[5] = y === undefined ? x : y; m[10] = z === undefined ? x : z; return m; },
  RX: (a) => { const m = m4.create(); const c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
  RY: (a) => { const m = m4.create(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
  RZ: (a) => { const m = m4.create(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
  mul: (...ms) => ms.reduce((acc, m) => m4.multiply(m4.create(), acc, m)),
};
const I4 = m4.create();
const quatMat3 = ([x, y, z, w]) => [
  1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
  2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
  2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
];
const mat3To4 = (r, s = 1) => {
  const m = m4.create();
  m[0] = r[0] * s; m[1] = r[1] * s; m[2] = r[2] * s;
  m[4] = r[3] * s; m[5] = r[4] * s; m[6] = r[5] * s;
  m[8] = r[6] * s; m[9] = r[7] * s; m[10] = r[8] * s;
  return m;
};
const nlerpQ = (a, b, t) => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => a[i] + (b[i] * s - a[i]) * t);
  const l = Math.hypot(...q) || 1;
  return q.map((v) => v / l);
};

// ---------------------------------------------------------------- the forms
export const SPIRAL = { R: 8.5, coneH: 1.8, spin: 0.45, arms: 2, tight: 3.1, thick: 0.5 };
export const FLOW = { L: 15, W: 3.4, speed: 7.5, lanes: 64, frontW: 1.6, amp: 3.2, freq: 0.14, twist: 2.2 };
export const RINGS = { R: 7.2, speed: 1.0 };
export const LATTICE = { S: 6.2, n: 9, crop: 1.02 };
export const FIELD = { X: 34, Z: 22, nf: 0.16, sigW: 0.55, phase: 0.6 };
export const HORIZON = { L: 26, thick: 0.035, sunFrac: 0.005, sunR: 0.13 };

const par = (...v) => { const a = new Float32Array(16); v.forEach((x, i) => { a[i] = x; }); return a; };
const flowFront = (t) => key(t, [[3.95, -FLOW.L - 2.5], [5.05, FLOW.L + 2.5, 'inOutSine']]);
const ringAlign = (t) => key(t, [[6.0, 0], [7.0, 1, 'inOutCubic']]);
const fieldNoise = (t) => key(t, [[9.7, 1.35], [11.1, 0.1, 'inOutCubic']]);
const fieldSignal = (t) => key(t, [[10.0, 0], [11.0, 1, 'inOutCubic']]);

const flowMat = M.mul(M.RZ(-9 * DEG), M.RY(8 * DEG));
const latticeMat = (t) => M.mul(M.RY(0.3 + t * 0.22), M.RX(35.26 * DEG), M.RZ(45 * DEG));
const fieldMat = M.mul(M.T(0, -2.2, 0), M.RY(-12 * DEG));

// seven orbits: spread like an armillary sphere, then brought into one plane
const RING_Q = Array.from({ length: 7 }, (_, j) => quat.mul(quat.axisAngle([0, 1, 0], (j * Math.PI) / 7), quat.axisAngle([1, 0, 0], (62 + (j % 3) * 9) * DEG)));
const Q_FLAT = [0, 0, 0, 1];
function ringFrames(t) {
  const a = ringAlign(t);
  const spin = quat.axisAngle([0, 1, 0], t * 0.35);
  const rots = RING_Q.map((q) => quatMat3(quat.mul(spin, nlerpQ(q, Q_FLAT, a))));
  const flat = new Float32Array(63);
  rots.forEach((r, j) => flat.set(r, j * 9));
  const radii = rots.map((_, j) => RINGS.R * ((1 - 0.015 * j) * (1 - a) + (0.4 + 0.1 * j) * a));
  return { flat, rots, radii };
}

function formDef(form, t) {
  switch (form) {
    case FORM.HORIZON: return { par: par(HORIZON.L, HORIZON.thick, HORIZON.sunFrac, HORIZON.sunR, 0.38), mat: I4 };
    case FORM.SPIRAL: return { par: par(SPIRAL.R, SPIRAL.coneH, SPIRAL.spin, SPIRAL.arms, SPIRAL.tight, SPIRAL.thick), mat: I4 };
    case FORM.FLOW: return { par: par(FLOW.L, FLOW.W, FLOW.speed, FLOW.lanes, flowFront(t), FLOW.frontW, FLOW.amp, FLOW.freq, FLOW.twist), mat: flowMat };
    case FORM.RINGS: return { par: par(RINGS.R, 0, RINGS.speed, ringAlign(t)), mat: I4 };
    case FORM.LATTICE: return { par: par(LATTICE.S, LATTICE.n, LATTICE.crop), mat: latticeMat(t) };
    case FORM.FIELD: return { par: par(FIELD.X, FIELD.Z, fieldNoise(t), FIELD.nf, fieldSignal(t), FIELD.sigW, FIELD.phase), mat: fieldMat };
    default: return { par: par(key(t, [[0.3, 0.02], [1.1, 0.05], [11.9, 0.05], [12.1, 0.03]]), 0.02, 0.5), mat: I4 };
  }
}

// the morphs, each timed so it lands on a beat
const SEQ = [
  { t0: 1.15, t1: 2.45, A: FORM.POINT, B: FORM.SPIRAL, ease: EASE.outExpo, stagger: 0.6, mode: STAGGER.toB, range: SPIRAL.R, noise: 0.25, swirl: 0.9 },
  { t0: 3.05, t1: 3.9, A: FORM.SPIRAL, B: FORM.FLOW, ease: EASE.inOutCubic, stagger: 0.45, mode: STAGGER.alongB, origin: [-FLOW.L, 0, 0], range: FLOW.L * 2, noise: 1.3, swirl: -1.6 },
  { t0: 5.05, t1: 5.85, A: FORM.FLOW, B: FORM.RINGS, ease: EASE.inOutCubic, stagger: 0.35, mode: STAGGER.random, noise: 0.8, swirl: 2.4 },
  { t0: 7.05, t1: 7.95, A: FORM.RINGS, B: FORM.LATTICE, ease: EASE.outBack, stagger: 0.55, mode: STAGGER.heightB, origin: [0, -LATTICE.S, 0], range: LATTICE.S * 2, noise: 0.35 },
  { t0: 9.05, t1: 9.85, A: FORM.LATTICE, B: FORM.FIELD, ease: EASE.inOutCubic, stagger: 0.4, mode: STAGGER.fromA, range: LATTICE.S * 1.2, noise: 0.6, lift: -2.5 },
  { t0: 11.25, t1: 12.1, A: FORM.FIELD, B: FORM.POINT, ease: EASE.inExpo, stagger: 0.4, mode: STAGGER.fromA, range: 20, swirl: 3.2 },
  { t0: 12.15, t1: 13.3, A: FORM.POINT, B: FORM.HORIZON, ease: EASE.outExpo, stagger: 0.35, mode: STAGGER.toB, range: HORIZON.L },
];

// ---------------------------------------------------------------- camera: one continuous move through the whole film
const CAM = [
  [0.0, [0, 0.3, 16]],
  [1.35, [0, 0.45, 13.2], 'inOutSine'],
  [2.7, [0.5, 19.5, 9.5], 'inOutCubic'],
  [3.45, [8, 10, 14], 'inOutSine'],
  [4.5, [1.5, 1.6, 19], 'inOutCubic'],
  [5.35, [-2.5, 2.4, 17.5], 'linear'],
  [6.4, [-11, 5.5, 12], 'inOutCubic'],
  [7.2, [-2, 15, 6], 'inOutCubic'],
  [8.35, [14, 11, 14.5], 'inOutCubic'],
  [9.35, [13.5, 5, 9], 'inOutSine'],
  [10.3, [-9, 2.6, 13], 'inOutCubic'],
  [11.3, [-4, 1.9, 11], 'inOutSine'],
  [12.1, [0, 0.35, 8.5], 'inOutCubic'],
  [13.2, [0, 0.4, 14], 'outCubic'],
  [15.0, [0, 0.42, 12.8], 'inOutSine'],
];
const TGT = [
  [0, [0, 0, 0]], [1.35, [0, 0, 0]], [2.7, [0, 0.2, 0]], [3.45, [0, 0.5, 0]], [4.5, [0, 0.4, 0]], [5.35, [0, 0.3, 0]],
  [6.4, [0, 0, 0]], [7.2, [0, 0, 0]], [8.35, [0, 0.2, 0]], [9.35, [0, 0, 0]], [10.3, [2, -1.4, -3]], [11.3, [1, -1, -2]],
  [12.1, [0, 0, 0]], [13.2, [0, 0.25, 0]], [15, [0, 0.25, 0]],
];
const FOV = [[0, 30], [1.35, 32], [2.7, 40], [3.45, 38], [4.5, 34], [6.4, 38], [7.2, 42], [8.35, 34], [9.35, 36], [10.3, 42], [11.3, 40], [12.1, 36], [13.2, 30], [15, 30]];
const ROLL = [[0, 0], [2.7, 0], [3.45, 4], [4.5, -2], [5.35, 0], [6.4, 3], [7.2, 0], [8.35, -3], [9.35, 0], [10.3, 2], [11.3, 0], [12.1, 0]];

// ---------------------------------------------------------------- lines (static geometry; the director only moves and trims them)
export function lineSets() {
  const horizon = Array.from({ length: 161 }, (_, i) => [-40 + i * 0.5, 0, 0]);
  const ring = Array.from({ length: 257 }, (_, i) => { const a = (i / 256) * Math.PI * 2; return [Math.cos(a), 0, Math.sin(a)]; });
  const { S, n, crop } = LATTICE;
  const sp = (2 * S) / (n - 1);
  const c = (i) => (i - (n - 1) / 2) * sp;
  const lattice = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let u = 0; u < n - 1; u++) {
    for (let axis = 0; axis < 3; axis++) {
      const p0 = axis === 0 ? [c(u), c(a), c(b)] : axis === 1 ? [c(a), c(u), c(b)] : [c(a), c(b), c(u)];
      const p1 = axis === 0 ? [c(u + 1), c(a), c(b)] : axis === 1 ? [c(a), c(u + 1), c(b)] : [c(a), c(b), c(u + 1)];
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
      if (Math.hypot(...mid) > S * crop * 0.9) continue;
      lattice.push([...p0, ...p1, 0, 1, ((mid[1] + S) / (2 * S)) * 0.7, 0]);
    }
  }
  const strands = [];
  for (let lane = 2; lane < FLOW.lanes; lane += 4) {
    const ln = (lane + 0.5) / FLOW.lanes;
    strands.push(Array.from({ length: 121 }, (_, i) => {
      const x = -FLOW.L + (i / 120) * 2 * FLOW.L;
      const ang = (FLOW.twist * x) / FLOW.L + (ln - 0.5) * 2.4;
      return [x, (ln - 0.5) * FLOW.W * 0.9 + Math.sin(ang) * FLOW.W * 0.3, Math.cos(ang) * FLOW.W * 0.45];
    }));
  }
  const wave = Array.from({ length: 161 }, (_, i) => {
    const x = -FIELD.X / 2 + (i / 160) * FIELD.X;
    return [x, 1.2, Math.sin(x * 0.28 + FIELD.phase) * 2.4 + Math.sin(x * 0.63 + 1.7) * 0.6];
  });
  return { horizon, ring, lattice, strands, wave };
}

// ---------------------------------------------------------------- the director
export function createDirector() {
  function base(t) {
    return {
      time: t,
      chapter: 0,
      camera: { pos: [0, 0.3, 16], target: [0, 0, 0], up: [0, 1, 0], fov: 32, roll: 0, portraitFov: 64 },
      backdrop: {
        amt: 1, top: lin('#0C0D12'), bottom: lin('#07070A'), glowCol: COLORS.accent, glowAmt: 0, glowSize: 0.32,
        bandAmt: 0, glowWorld: [0, 0, 0], haze: 0.08,
      },
      field: {
        formA: FORM.POINT, formB: FORM.POINT, matA: I4, matB: I4, parA: par(0.03), parB: par(0.03),
        progress: 0, stagger: 0, staggerMode: 0, ease: 0, staggerOrigin: [0, 0, 0], staggerRange: 10,
        noise: 0, swirl: 0, swirlCenter: [0, 0, 0], lift: 0, rings: ringFrames(t).flat, scan: [0, 1, 0, 0],
        dust: [0, 34, 1.4, 0.028], paper: COLORS.paper, accent: COLORS.accent, intensity: 1, size: 0.021, energy: 1,
        focus: 16, aperture: 0, maxStreak: 90, shutter: 1 / 48, fraction: 1,
      },
      lines: [],
      post: {
        bloom: 0.42, bloomThreshold: 0.8, exposure: 1.15, ca: 0, vignette: 0.5, grain: 0.035,
        flash: 0, flashCol: [1, 0.93, 0.84], fade: 0, blur: 0, blurDir: [1, 0], zoomBlur: 0,
        shadowTint: [0.08, 0.14, 0.3], highTint: [0.55, 0.32, 0.1], lift: 0, saturation: 1, rays: 0, raysDecay: 0.955,
      },
      anchors: { sun: null },
    };
  }

  function morph(f, t) {
    const F = f.field;
    let form = FORM.POINT;
    for (const s of SEQ) {
      if (t < s.t0) break;
      if (t >= s.t1) { form = s.B; continue; }
      const a = formDef(s.A, t), b = formDef(s.B, t);
      Object.assign(F, {
        formA: s.A, formB: s.B, parA: a.par, parB: b.par, matA: a.mat, matB: b.mat,
        progress: seg(t, s.t0, s.t1), stagger: s.stagger, staggerMode: s.mode, ease: s.ease,
        staggerOrigin: s.origin || [0, 0, 0], staggerRange: s.range || 10, noise: s.noise || 0, swirl: s.swirl || 0, lift: s.lift || 0,
      });
      return;
    }
    const d = formDef(form, t);
    Object.assign(F, { formA: form, formB: form, parA: d.par, parB: d.par, matA: d.mat, matB: d.mat, progress: 0 });
  }

  function camera(f, t) {
    const c = f.camera;
    c.pos = key(t, CAM);
    c.target = key(t, TGT);
    c.fov = key(t, FOV);
    c.roll = key(t, ROLL) * DEG;
    c.shift = key(t, [[1.3, [0, 0]], [2.2, [0.06, 0.03]], [3.3, [0.06, 0.03]], [4.0, [0.1, 0.08]], [11.3, [0.1, 0.08]], [12.0, [0, 0]]]);
    f.field.focus = Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2]);
  }

  function look(f, t) {
    const F = f.field, P = f.post, B = f.backdrop;
    // the point of light has to stay a point, not a flare
    F.intensity = key(t, [[0.28, 0], [0.6, 0.6, 'outQuad'], [1.15, 1]]);
    F.dust[0] = key(t, [[0.4, 0], [1.6, 1], [11.5, 1], [12.1, 0.4], [13, 0.8]]);
    F.aperture = key(t, [[1.2, 0], [2.3, 1.4], [3.3, 2], [4.5, 1.2], [6.3, 1.8], [8.3, 1.5], [10.2, 2.4], [11.3, 2], [12.2, 0.8], [15, 1]]);
    F.shutter = key(t, [[0, 1 / 60], [3.8, 1 / 60], [4.2, 1 / 20], [5.0, 1 / 20], [5.4, 1 / 60], [11.4, 1 / 60], [11.9, 1 / 18], [12.15, 1 / 60]]);
    F.size = key(t, [[0, 0.016], [9.8, 0.016], [10.3, 0.014], [11.3, 0.014], [12, 0.016]]);
    // the scan rising through the lattice
    const sy = key(t, [[8.05, -LATTICE.S * 1.05], [9.1, LATTICE.S * 1.05, 'inOutSine']]);
    const samt = key(t, [[8.0, 0], [8.2, 1], [8.95, 1], [9.15, 0]]);
    F.scan = [sy, 0.45, samt, 0];

    B.glowAmt = key(t, [[0.3, 0], [1.1, 0.035], [2.0, 0.015], [11.3, 0.012], [12.1, 0.04], [13.3, 0.035], [15, 0.03]]);
    B.glowSize = key(t, [[0, 0.22], [2, 0.42], [11, 0.42], [12.1, 0.2], [13.3, 0.3]]);
    B.bandAmt = key(t, [[0.4, 0], [1.3, 0.018], [1.9, 0], [12.2, 0], [13.2, 0.02]]);

    // impacts brighten the light that is there rather than washing the frame
    const pulse = (t0, amt, dur) => key(t, [[t0 - 0.03, 0], [t0, amt, 'linear'], [t0 + dur, 0, 'outQuad']]);
    P.exposure = 1.15 + pulse(1.5, 0.7, 0.4) + pulse(12.1, 1.6, 0.5);
    const tr = (a, b, c, amt) => key(t, [[a, 0], [b, amt, 'inQuad'], [c, 0, 'outQuad']]);
    P.zoomBlur = Math.max(tr(3.2, 3.5, 3.8, 0.08), tr(5.2, 5.5, 5.8, 0.07), tr(7.2, 7.5, 7.8, 0.06), tr(9.2, 9.5, 9.8, 0.06), tr(11.6, 12.08, 12.3, 0.22));
    P.ca = Math.max(tr(3.3, 3.5, 3.7, 0.25), tr(5.3, 5.5, 5.7, 0.2), tr(7.3, 7.5, 7.7, 0.2), tr(9.3, 9.5, 9.7, 0.2), tr(11.9, 12.1, 12.4, 0.35));
    P.rays = Math.max(key(t, [[0.3, 0], [0.8, 0.22], [1.3, 0.15], [1.8, 0]]), key(t, [[12.3, 0], [13.0, 0.2], [15, 0.16]]));
    P.bloom = key(t, [[0, 0.6], [2, 0.42], [11.3, 0.42], [12.1, 0.7], [13.3, 0.45]]);
    P.fade = key(t, [[14.35, 0], [14.97, 1, 'inOutSine']]);
    if (P.rays > 0.001) f.anchors.sun = [0, 0, 0];
  }

  function lines(f, t) {
    const L = f.lines;
    const push = (o) => { if (o.alpha > 0.002) L.push(o); };
    const accent = COLORS.accent, paper = COLORS.paper;
    // the horizon: drawn out from the point, and again at the end, under the mark
    const early = t < 6;
    const hs = early ? ease.outExpo(seg(t, 0.35, 1.35)) : ease.outExpo(seg(t, 12.15, 13.1));
    const ha = early ? key(t, [[0.35, 0], [0.5, 0.9], [1.35, 0.9], [1.9, 0]]) : key(t, [[12.15, 0], [12.3, 1]]);
    push({ set: 'horizon', model: I4, color: scale3(accent, 0.7), alpha: ha, width: 1.1, trimA: 0.5 - hs * 0.5, trimB: 0.5 + hs * 0.5, additive: true });
    // flow: the strands appear behind the ordering front
    const fa = key(t, [[3.95, 0], [4.2, 0.28], [5.0, 0.28], [5.45, 0]]);
    if (fa > 0) {
      const u = clamp((flowFront(t) + FLOW.L) / (2 * FLOW.L));
      push({ set: 'strands', model: flowMat, color: scale3(paper, 0.9), alpha: fa, width: 1.0, trimA: 0, trimB: u, additive: true, head: scale3(accent, 3), headAmt: 1 });
    }
    // the orbits
    const ra = key(t, [[5.6, 0], [6.0, 0.22], [7.0, 0.3], [7.25, 0]]);
    if (ra > 0) {
      const R = ringFrames(t);
      R.rots.forEach((r, j) => push({ set: 'ring', model: mat3To4(r, R.radii[j]), color: scale3(paper, 0.8), alpha: ra, width: 1.0, additive: true }));
    }
    // the lattice, built from the ground up; then the scan ring rises through it
    const la = key(t, [[7.55, 0], [7.8, 0.22], [9.05, 0.22], [9.4, 0]]);
    if (la > 0) push({ set: 'lattice', model: latticeMat(t), color: scale3(paper, 0.8), alpha: la, width: 1.0, mode: 1, progress: key(t, [[7.5, 0], [8.4, 1, 'outCubic']]), dur: 0.3, additive: true });
    const sa = f.field.scan[2];
    if (sa > 0) {
      const y = f.field.scan[0];
      const r = Math.sqrt(Math.max(0, (LATTICE.S * LATTICE.crop) ** 2 - y * y));
      push({ set: 'ring', model: M.mul(M.T(0, y, 0), M.S(r)), color: scale3(accent, 2.2), alpha: sa * 0.85, width: 1.6, additive: true });
    }
    // the signal through the settled field
    const wa = key(t, [[10.05, 0], [10.4, 0.8], [11.25, 0.8], [11.6, 0]]);
    if (wa > 0) {
      const s = fieldSignal(t);
      push({ set: 'wave', model: M.mul(fieldMat, M.S(1, Math.max(s, 0.001), 1)), color: scale3(accent, 2.4), alpha: wa, width: 1.5, trimA: 0, trimB: ease.outCubic(seg(t, 10.05, 11.0)), additive: true, head: scale3(COLORS.hot, 6), headAmt: 1 });
    }
  }

  return {
    evaluate(t) {
      const f = base(t);
      f.chapter = CHAPTERS.reduce((a, c, i) => (t >= c.t ? i : a), 0);
      morph(f, t);
      camera(f, t);
      look(f, t);
      lines(f, t);
      return f;
    },
  };
}
