// The director: a pure function from film time to a complete frame description. Every camera move,
// light change, particle morph and stone in the reel is authored here.
import { key, ease, clamp, seg, m4, v3, DEG, latLon, slerp, quat } from './math.js';
import { S } from './shapes.js';
import { GLOBE, STONE, DUBAI, CITIES, FIELD, ARCH, ARCH_T, TOPO, archStones, routePath3D } from './world.js';
import { PART_STRIDE } from './parts.js';

export const DURATION = 40;
export const CHAPTERS = [
  { t: 0, label: 'Horizon' },
  { t: 4, label: 'Reach' },
  { t: 8, label: 'Investment' },
  { t: 12, label: 'Insights' },
  { t: 16, label: 'Implementation' },
  { t: 20, label: 'What we do' },
  { t: 24.5, label: 'Four stages' },
  { t: 28, label: 'Skystone' },
];

// ---------------------------------------------------------------- colour
const lin = (h, k = 1) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2) * k);
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

const PAL = {
  dusk: {
    zenith: lin('#0A1130'), mid: lin('#3A3B62'), horizon: lin('#E8955A'), glow: lin('#FFAE62', 1.25), anti: lin('#C38C98'),
    ground: lin('#2A1E16'), sunCol: lin('#FFD6A6', 1.35), amb: lin('#8190B8', 0.5), fog: lin('#C98A5E'),
  },
  golden: {
    zenith: lin('#10193A'), mid: lin('#4A4C72'), horizon: lin('#F0A868'), glow: lin('#FFB468', 1.3), anti: lin('#CF97A0'),
    ground: lin('#3A2A1D'), sunCol: lin('#FFD2A0', 1.7), amb: lin('#8C98C0', 0.55), fog: lin('#D29A6C'),
  },
  night: {
    zenith: lin('#02040B'), mid: lin('#0A1228'), horizon: lin('#27304A'), glow: lin('#9FB4E0', 0.25), anti: lin('#161C33'),
    ground: lin('#06070B'), sunCol: lin('#AFC0E6', 0.35), amb: lin('#56669A', 0.42), fog: lin('#101528'),
  },
  deep: {
    zenith: lin('#010207'), mid: lin('#060913'), horizon: lin('#11152A'), glow: lin('#FF9A55', 0.0), anti: lin('#0C0F1E'),
    ground: lin('#030407'), sunCol: lin('#D8C6AE', 0.8), amb: lin('#46527A', 0.5), fog: lin('#090B14'),
  },
};
function pal(a, b, t = 0) {
  const A = PAL[a], B = PAL[b || a], o = {};
  for (const k in A) o[k] = mix3(A[k], B[k], t);
  return o;
}

export const COLORS = {
  apricot: lin('#F2A65E'),
  apricotHot: lin('#FFC98C', 2.2),
  bone: lin('#F4F2EE'),
  sand: lin('#E4D3B6'),
};

// ---------------------------------------------------------------- matrices
const M = {
  T: (x, y, z) => { const m = m4.create(); m[12] = x; m[13] = y; m[14] = z; return m; },
  S: (x, y, z) => { const m = m4.create(); m[0] = x; m[5] = y === undefined ? x : y; m[10] = z === undefined ? x : z; return m; },
  RX: (a) => { const m = m4.create(); const c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
  RY: (a) => { const m = m4.create(); const c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
  mul: (...ms) => ms.reduce((acc, m) => m4.multiply(m4.create(), acc, m)),
};
const I4 = m4.create();

function globeMatrix(camPos, lat, lon) {
  const c = GLOBE.center;
  const d = v3.norm(v3.sub(camPos, c));
  const yaw = Math.atan2(d[0], d[2]);
  const pitch = -Math.asin(clamp(d[1], -1, 1));
  return M.mul(M.T(c[0], c[1], c[2]), M.RY(yaw), M.RX(pitch), M.RX(lat * DEG), M.RY(-lon * DEG), M.S(GLOBE.radius));
}

const DUB_V = latLon(DUBAI.lat, DUBAI.lon);
const CITY_V = CITIES.map((c) => latLon(c.lat, c.lon));

const orbit = (theta, r, h, cx = 0, cz = 0) => [cx + Math.sin(theta) * r, h, cz + Math.cos(theta) * r];
const sunFrom = (azDeg, elDeg) => {
  const a = azDeg * DEG, e = elDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};
const QY = (a) => quat.axisAngle([0, 1, 0], a);
const QZ = (a) => quat.axisAngle([0, 0, 1], a);
const QX = (a) => quat.axisAngle([1, 0, 0], a);
const Q0 = [0, 0, 0, 1];

// ---------------------------------------------------------------- the director
export function createDirector({ wordAspect }) {
  const partData = [0, 1, 2].map(() => new Float32Array(256 * PART_STRIDE));
  const counts = [0, 0, 0];
  let aspect = 16 / 9;
  const pushPart = (mesh, p, s, q, kind, seed, reveal = 1, hot = 0) => {
    if (reveal <= 0 || s[1] <= 0.005) return;
    const o = counts[mesh] * PART_STRIDE;
    const d = partData[mesh];
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
    d[o + 3] = s[0]; d[o + 4] = s[1]; d[o + 5] = s[2];
    d[o + 6] = q[0]; d[o + 7] = q[1]; d[o + 8] = q[2]; d[o + 9] = q[3];
    d[o + 10] = kind; d[o + 11] = seed; d[o + 12] = reveal; d[o + 13] = hot; d[o + 14] = 0; d[o + 15] = 0;
    counts[mesh]++;
  };

  function base(t) {
    const P = PAL.dusk;
    return {
      time: t,
      shot: '',
      chapter: 0,
      camera: { pos: [0, 2, 6], target: [0, 2, -60], up: [0, 1, 0], fov: 36, roll: 0, portraitFov: null },
      sky: {
        amt: 1, zenith: P.zenith, mid: P.mid, horizon: P.horizon, glow: P.glow, anti: P.anti, sunDir: sunFrom(0, 0.9), fogDark: 0,
        stars: 0, haze: 1, ground: P.ground, sunCol: P.sunCol, gridColor: [0, 0, 0],
        dune: 1, grid: 0, gridScale: 4, fog: 0.008, horizonLine: 0, lineSpan: 1, lineCol: COLORS.apricotHot, blob: [0, 0, 1, 0],
      },
      dunes: { visible: false, sand: lin('#B8946C', 0.9), sunCol: P.sunCol, amb: P.amb, light: 1 },
      topo: {
        visible: false, base: lin('#1A2440'), line: lin('#F2A65E', 1.6), moonDir: v3.norm([-0.5, 0.75, 0.35]), fogCol: lin('#0E1426'),
        origin: [TOPO.plateau[0], TOPO.plateau[2]], reveal: 0, interval: 2.2, fog: 0.0016, amt: 1, lineAmt: 1,
      },
      particles: {
        visible: true, from: S.DESERT, to: S.DESERT, fromM: I4, toM: I4, fromS: 1, toS: 1,
        progress: 1, stagger: 0, staggerMode: 0, ease: 0, staggerOrigin: [0, 0, 0], staggerRange: 100,
        noise: 0, lift: 0, swirl: 0, swirlCenter: [0, 0, 0], size: 1, drift: 0, vortexSpin: 0, flowSpeed: 1,
        groupFade: [1, 1, 1, 1], fog: 0.004, minPx: 1.2, sunCol: P.sunCol, ambCol: P.amb, rimCol: scale3(P.glow, 0.25),
        fogCol: P.fog, base: COLORS.sand, hiCol: COLORS.apricot, emissive: 0, light: 1, hiEmissive: 0.4,
        lightDir: sunFrom(0, 12), fraction: 1, intensity: 1, transitGrow: 0, transmit: 0.9,
      },
      parts: { data: partData, counts },
      material: {
        sunCol: P.sunCol, ambTop: scale3(P.amb, 0.8), ambBottom: lin('#5A4331', 0.35), fogCol: P.fog, fog: 0.004,
        light: 1, hotCol: lin('#FFB36B', 1.6),
      },
      shadow: { on: false, center: [0, 0, 0], radius: 30, bias: 0.0012 },
      globe: { visible: false, amt: 0, model: I4, body: lin('#0B1024'), rim: lin('#3B4A7A', 0.6), atmo: lin('#7F9BE0', 0.35) },
      lines: [],
      billboards: [],
      stone: { visible: false, model: I4, reveal: 0, edgeCol: lin('#FFB36B', 2.0), fogCol: P.fog, fog: 0.004, light: 1 },
      post: {
        bloom: 0.45, bloomThreshold: 0.95, exposure: 1.1, ca: 0, vignette: 0.42, grain: 0.04,
        flash: 0, flashCol: [1, 0.93, 0.84], fade: 0, blur: 0, blurDir: [1, 0], zoomBlur: 0,
        shadowTint: [0.1, 0.25, 0.45], highTint: [0.6, 0.35, 0.1], lift: 0.0, saturation: 1.0, rays: 0,
      },
      anchors: {},
      hud: {},
    };
  }
  function useSky(f, P) {
    const s = f.sky;
    s.zenith = P.zenith; s.mid = P.mid; s.horizon = P.horizon; s.glow = P.glow; s.anti = P.anti; s.ground = P.ground; s.sunCol = P.sunCol;
    f.dunes.sunCol = P.sunCol; f.dunes.amb = P.amb;
    const p = f.particles;
    p.sunCol = P.sunCol; p.ambCol = P.amb; p.fogCol = P.fog;
    const m = f.material;
    m.sunCol = P.sunCol; m.ambTop = scale3(P.amb, 0.8); m.fogCol = P.fog;
  }

  // ---------------------------------------------------------- A: horizon (0-4)
  function shotHorizon(f, t) {
    f.shot = 'horizon'; f.chapter = 0;
    const c = f.camera;
    c.pos = key(t, [[0, [0, 1.5, 6.2]], [4, [0, 1.62, 3.4], 'inOutSine']]);
    c.target = key(t, [[0, [0, 2.3, -60]], [4, [0, 2.7, -60], 'inOutSine']]);
    c.fov = 34; c.portraitFov = 58;
    c.roll = key(t, [[0, 0], [4, 0.6 * DEG]]);
    const s = f.sky;
    s.amt = key(t, [[0, 0], [0.35, 0], [3.1, 1, 'inOutCubic']]);
    s.horizonLine = key(t, [[0, 0], [0.12, 1.6, 'outExpo'], [3.0, 1.0], [4, 0.55]]);
    s.lineSpan = key(t, [[0.05, 0], [1.3, 1.02, 'outExpo']]);
    s.stars = 0.12;
    f.dunes.visible = true;
    f.dunes.light = key(t, [[0, 0.3], [3, 1]]);
    const p = f.particles;
    p.from = S.HORIZON; p.to = S.DESERT;
    p.progress = key(t, [[0.4, 0], [3.7, 1, 'linear']]);
    p.ease = 3; p.stagger = 0.55; p.staggerMode = 5; p.staggerOrigin = [0, 1.6, 5]; p.staggerRange = 90;
    p.noise = 0.25; p.drift = 0.1;
    p.light = key(t, [[0, 0.35], [3, 1]]);
    p.lightDir = sunFrom(0, 8);
    p.rimCol = scale3(PAL.dusk.glow, 0.32);
    p.hiEmissive = 2.2; p.intensity = 1.4; p.transmit = 1.6;
    f.post.vignette = 0.5;
    f.post.rays = key(t, [[0.6, 0], [3, 0.35]]);
    f.hud = { place: 'Dubai' };
  }

  // ---------------------------------------------------------- B: reach (4-8)
  function shotReach(f, t) {
    f.shot = 'reach'; f.chapter = 1;
    const c = f.camera;
    c.pos = key(t, [[4, [0, 1.62, 3.4]], [5.7, [0, 6.5, -2], 'inOutCubic'], [7.6, [2.0, 20.5, -10.5], 'inOutCubic'], [8, [0.8, 25.5, -33], 'inQuart']]);
    c.target = key(t, [[4, [0, 2.7, -60]], [5.7, [0, 22, -62], 'inOutCubic'], [7.6, [0, 29.5, -62], 'inOutCubic']]);
    c.fov = key(t, [[4, 34], [7.6, 42], [8, 30, 'inQuart']]);
    c.portraitFov = key(t, [[4, 58], [7.6, 68]]);
    c.roll = key(t, [[4, 0.6 * DEG], [5.8, -3.5 * DEG], [7.6, 1.5 * DEG]]);
    const s = f.sky;
    s.horizonLine = key(t, [[4, 0.55], [5.5, 0.2]]);
    s.stars = key(t, [[4, 0.12], [6.5, 0.7]]);
    f.dunes.visible = t < 6.2;

    const lat = key(t, [[4, 10], [6.0, DUBAI.lat + 6, 'outCubic'], [8, DUBAI.lat + 2]]);
    const lon = key(t, [[4, DUBAI.lon - 70], [6.0, DUBAI.lon + 4, 'outCubic'], [7.8, DUBAI.lon + 8, 'inOutSine'], [8, DUBAI.lon, 'inQuad']]);
    const G = globeMatrix(c.pos, lat, lon);
    f.globe.visible = true;
    f.globe.model = G;
    f.globe.amt = key(t, [[5.0, 0], [6.3, 1]]);

    const p = f.particles;
    p.from = S.DESERT; p.to = S.GLOBE; p.toM = G; p.toS = GLOBE.radius;
    p.progress = key(t, [[4.0, 0], [6.9, 1, 'linear']]);
    p.ease = 0; p.stagger = 0.42; p.staggerMode = 1; p.staggerOrigin = [0, 1.6, 3.4]; p.staggerRange = 140;
    p.noise = 7; p.lift = 16; p.swirl = 3.4; p.swirlCenter = [0, 0, -40];
    p.transitGrow = 2.5; p.intensity = 1.2; p.transmit = 1.2;
    p.lightDir = v3.norm([0.35, 0.55, 1.0]);
    p.hiEmissive = key(t, [[5.5, 0.3], [6.6, 1.6]]);
    p.emissive = 0.05;
    p.rimCol = scale3(PAL.dusk.glow, 0.15);
    p.fog = 0.002;

    f.lines.push({ set: 'grat', model: G, width: 1, color: scale3(COLORS.bone, 0.12), alpha: key(t, [[5.2, 0], [6.4, 0.55]]), trimA: 0, trimB: 1, additive: true });
    f.lines.push({
      set: 'arcs', model: G, width: 2.4, color: scale3(COLORS.apricotHot, 1.0), head: [4, 3.4, 2.8], headAmt: 2.6,
      alpha: 1, mode: 1, progress: key(t, [[5.85, 0], [7.75, 1, 'linear']]), dur: 0.42, additive: true,
    });
    f.anchors.dubai = m4.transformPoint(G, DUB_V);
    f.anchors.cities = CITY_V.map((v) => m4.transformPoint(G, v));
    f.anchors.globe = GLOBE.center;
    f.hud = { place: 'Dubai' };
    f.post.zoomBlur = key(t, [[7.7, 0], [8, 0.22, 'inQuad']]);
    f.post.ca = key(t, [[7.7, 0], [8, 0.35, 'inQuad']]);
  }

  // ---------------------------------------------------------- stones
  function field(t, t0, spanT, dur, stepped = 0) {
    for (const st of FIELD.stones) {
      let g = ease.outExpo(seg(t, t0 + st.delay * spanT, t0 + dur + st.delay * spanT));
      if (stepped) g = Math.round(g * stepped) / stepped;
      const hot = g > 0 && g < 1 ? Math.pow(1 - g, 0.7) * 0.6 : 0;
      pushPart(0, [st.x, 0, st.z], [st.w, st.h * g, st.d], QY(st.rotY), st.kind, st.seed, 1, hot);
    }
  }
  function arch(t, { tIn, first, step, key: tKey, piers }) {
    const [cx, cy, cz] = ARCH.center;
    const pw = ARCH.pier;
    const xs = [cx - (ARCH.ri + ARCH.ro) / 2, cx + (ARCH.ri + ARCH.ro) / 2];
    xs.forEach((x, i) => {
      const g = ease.outExpo(seg(t, piers[i] - 0.45, piers[i]));
      const hot = t > piers[i] ? Math.exp(-(t - piers[i]) * 6) : 0;
      pushPart(0, [x, 0, cz], [pw.w, pw.h * g, pw.d], Q0, 1, 0.37 + i * 0.11, 1, hot);
    });
    archStones().forEach((s, k) => {
      const ts = s.key ? tKey : first + k * step;
      const snap = s.key ? ease.inQuad(seg(t, ts - 0.22, ts)) : ease.outBack(seg(t, ts - 0.24, ts + 0.02));
      const rv = ease.outCubic(seg(t, tIn + k * 0.04, tIn + 0.7 + k * 0.04));
      const e = 1 - snap;
      const radial = [Math.cos(s.angle), Math.sin(s.angle), 0];
      const off = s.key ? [0, 7.5 * e, 0] : v3.add(v3.scale(radial, 5.5 * e), [0, 2.4 * e, ((k % 3) - 1) * 1.6 * e]);
      const q = quat.mul(quat.mul(QZ(s.angle - Math.PI / 2), QZ((s.side || 1) * 0.42 * e)), QX(0.35 * e * (k % 2 ? 1 : -1)));
      const hot = t > ts ? Math.exp(-(t - ts) * (s.key ? 3 : 6)) * (s.key ? 1.6 : 1) : 0;
      pushPart(s.key ? 2 : 1, [cx + off[0], cy + off[1], cz + off[2]], [1, 1, 1], q, 1, 0.5 + k * 0.03, rv, hot);
    });
  }

  // ---------------------------------------------------------- C: investment (8-12)
  const FC = FIELD.center;
  const INV_THETA = 4 * DEG;
  function shotInvestment(f, t) {
    f.shot = 'investment'; f.chapter = 2;
    const nightT = key(t, [[11.35, 0], [12, 0.85, 'inQuad']]);
    useSky(f, pal('golden', 'night', nightT));
    f.sky.sunDir = sunFrom(24, 5.5);
    f.sky.stars = nightT;
    f.sky.fog = 0.0045;
    f.dunes.visible = true;
    f.dunes.light = 1 - nightT * 0.6;
    const c = f.camera;
    c.pos = key(t, [[8, [-25, 2.1, -29]], [10.6, [4, 3.0, -22.5], 'inOutSine'], [11.4, [8, 4.2, -21]]]);
    // the final beat tilts up into the sky: the cut to the night landscape hides in it
    const tilt = ease.inOutCubic(seg(t, 11.3, 12));
    c.target = v3.lerp(key(t, [[8, [-9, 3.6, -50]], [10.6, [3, 6.2, -53], 'inOutSine'], [11.4, [4, 7.5, -53]]]), v3.add(c.pos, [0, 120, -18]), tilt);
    c.fov = 38; c.portraitFov = 66;
    c.roll = key(t, [[8, -2 * DEG], [11.4, 0]]);

    field(t, 8.35, 1.5, 0.7);
    f.shadow = { on: true, center: [FC[0], 5, FC[2] - 2], radius: 30, bias: 0.0012 };

    const p = f.particles;
    p.from = S.SCATTER; p.to = S.DESERT; p.fromM = M.T(0, 40, -40);
    p.progress = key(t, [[8.0, 0], [9.2, 1, 'linear']]);
    p.ease = 3; p.stagger = 0.4; p.noise = 3; p.drift = 0.35;
    p.lightDir = f.sky.sunDir; p.rimCol = scale3(PAL.golden.glow, 0.3);
    p.intensity = key(t, [[8, 1.1], [9.5, 0.8]]); p.hiEmissive = 1.6; p.transmit = 1.0;

    const asp = wordAspect('investment');
    const H = 8.5 * Math.min(1, Math.max(0.7, aspect * 1.6));
    const back = 44;
    // centre-left above the rising stones on wide screens, centred on tall ones
    const side = -3 + 6 * Math.min(1, Math.max(0, (1.3 - aspect) / 0.8));
    const bx = FC[0] + side - Math.sin(INV_THETA) * back, bz = FC[2] - Math.cos(INV_THETA) * back;
    const y = key(t, [[8.5, 15], [10.2, 23, 'outExpo']]);
    f.billboards.push({
      word: 'investment', model: M.mul(M.T(bx, y, bz), M.RY(INV_THETA), M.S(asp * H, H, 1)),
      color: scale3(COLORS.bone, 1.1), fogCol: PAL.golden.fog, alpha: key(t, [[8.5, 0], [9.0, 1], [11.3, 1], [11.8, 0]]),
      reveal: key(t, [[8.6, 0], [9.9, 1.08, 'outExpo']]), fog: 0.002, glow: 0.12,
    });
    f.post.flash = key(t, [[8.0, 0.85], [8.22, 0, 'outQuad']]);
    f.post.ca = key(t, [[8.0, 0.3], [8.4, 0]]);
    f.hud = { place: 'Dubai' };
  }

  // ---------------------------------------------------------- D: insights (12-16)
  const PL = TOPO.plateau;
  function shotInsights(f, t) {
    f.shot = 'insights'; f.chapter = 3;
    useSky(f, pal('night'));
    f.sky.stars = 1;
    f.sky.sunDir = sunFrom(200, -20);
    const c = f.camera;
    const down = ease.inOutCubic(seg(t, 12, 13.2));
    const posA = [-24, 104, 150], posB = [-18, 150, 62], posC = [-14, 176, 36];
    c.pos = key(t, [[12, posA], [13.2, posB, 'inOutCubic'], [16, posC, 'inOutSine']]);
    const look = key(t, [[12.6, [PL[0], 0, PL[2] + 6]], [16, [PL[0] + 4, 0, PL[2]]]]);
    c.target = v3.lerp(v3.add(c.pos, [0, 120, -10]), look, down);
    const yaw = key(t, [[13.2, 0], [16, 12 * DEG, 'inOutSine']]);
    const upT = key(t, [[12.8, 0], [14.6, 0.85, 'inOutCubic']]);
    c.up = v3.norm(v3.lerp([0, 1, 0], [Math.sin(yaw), 0, -Math.cos(yaw)], upT));
    c.fov = 40; c.portraitFov = 70;

    const T = f.topo;
    T.visible = true;
    T.amt = key(t, [[12.2, 0], [13.0, 1]]);
    T.reveal = key(t, [[13.3, 0], [15.6, 190, 'outCubic']]);

    const p = f.particles;
    p.from = S.SCATTER; p.to = S.TERRAIN; p.fromM = M.T(0, 90, 0);
    p.progress = key(t, [[12.2, 0], [13.7, 1, 'linear']]);
    p.ease = 3; p.stagger = 0.5; p.staggerMode = 0; p.noise = 5;
    p.intensity = key(t, [[12.2, 1.0], [14.2, 0.9], [15.4, 0.25]]);
    p.base = lin('#C9D6F2'); p.hiCol = COLORS.apricot; p.hiEmissive = 1.8; p.emissive = 0.35; p.light = 0.4; p.fog = 0.0012;
    p.lightDir = v3.norm([-0.5, 0.75, 0.35]);

    f.lines.push({
      set: 'route', model: I4, width: 2.2, color: scale3(COLORS.apricotHot, 0.9), head: [3.4, 3.0, 2.6], headAmt: 2.4,
      alpha: 1, trimA: 0, trimB: key(t, [[13.9, 0], [15.7, 1, 'inOutCubic']]), additive: true,
    });
    const asp = wordAspect('insights');
    const H = 13;
    f.billboards.push({
      word: 'insights', model: M.mul(M.T(PL[0], TOPO.plateauH + 0.25, PL[2]), M.RX(-Math.PI / 2), M.S(asp * H, H, 1)),
      color: scale3(COLORS.bone, 1.3), fogCol: PAL.night.fog, alpha: key(t, [[13.9, 0], [14.6, 1]]),
      reveal: key(t, [[13.95, 0], [15.1, 1.08, 'inOutCubic']]), fog: 0.0008, glow: 0.5,
    });
    f.post.bloom = key(t, [[12, 0.45], [14, 0.65]]);
    f.post.bloomThreshold = 0.85;
    f.post.zoomBlur = key(t, [[15.72, 0], [16, 0.2, 'inQuad']]);
    f.hud = { place: '' };
  }

  // ---------------------------------------------------------- E: implementation (16-20)
  const AC = ARCH.center;
  function shotImplementation(f, t) {
    f.shot = 'implementation'; f.chapter = 4;
    useSky(f, pal('dusk'));
    f.sky.sunDir = sunFrom(0, 2.6);
    f.sky.horizonLine = 0.5;
    f.sky.fog = 0.0065;
    f.dunes.visible = true;
    const c = f.camera;
    c.pos = key(t, [[16, [-40, 11, -60]], [17.6, [-17, 5.2, -68], 'outCubic'], [19.35, [-3, 3.4, -69], 'inOutSine'], [20, [0, 3.2, -68.5], 'outSine']]);
    c.target = key(t, [[16, [0, 6, AC[2]]], [17.6, [0, 6.2, AC[2]]], [20, [0, 5.6, AC[2]]]]);
    c.fov = key(t, [[16, 36], [17.6, 40], [20, 42]]);
    c.portraitFov = 68;
    arch(t, { tIn: 16.35, first: ARCH_T.first, step: ARCH_T.step, key: ARCH_T.key, piers: ARCH_T.piers });
    f.shadow = { on: true, center: [0, 6, AC[2]], radius: 22, bias: 0.0012 };

    const p = f.particles;
    p.from = S.BURST_A; p.to = S.BURST_A;
    p.lightDir = f.sky.sunDir; p.rimCol = scale3(PAL.dusk.glow, 0.3); p.transmit = 1.4;
    p.intensity = 0.5; p.hiEmissive = 0.25; p.base = lin('#D9C2A0'); p.size = 1.5; p.fraction = 0.4;

    f.post.flash = key(t, [[16.0, 0.8], [16.2, 0, 'outQuad'], [19.45, 0], [19.5, 0.28], [19.75, 0]]);
    f.post.rays = key(t, [[16.2, 0.25], [19.4, 0.3], [19.6, 0.75], [20, 0.55]]);
    f.anchors.keystone = [AC[0], AC[1] + ARCH.ro + ARCH.keyRise, AC[2]];
    f.hud = { place: 'Dubai' };
  }

  // ---------------------------------------------------------- F: what we do (20-24.5)
  function shotWhatWeDo(f, t) {
    f.shot = 'services'; f.chapter = 5;
    const c = f.camera;
    if (t < 21) {
      // investment advisory: the stone spiral climbs back in stepped bursts
      useSky(f, pal('golden'));
      f.sky.sunDir = sunFrom(24, 5.5);
      f.dunes.visible = true;
      c.pos = key(t, [[20, [16, 1.2, -38]], [21, [11, 1.6, -30], 'outExpo']]);
      c.target = key(t, [[20, [-6, 7, -52]], [21, [-2, 6, -52], 'outExpo']]);
      c.fov = 46; c.portraitFov = 72;
      c.roll = key(t, [[20, 6 * DEG], [21, 0, 'outExpo']]);
      field(t, 20.0, 0.6, 0.35, 6);
      f.shadow = { on: true, center: [FC[0], 5, FC[2] - 2], radius: 30, bias: 0.0012 };
      const p = f.particles;
      p.drift = 0.35; p.intensity = 0.9; p.lightDir = f.sky.sunDir;
      f.post.flash = key(t, [[20, 0.7], [20.18, 0]]);
      f.post.ca = key(t, [[20, 0.4], [20.35, 0]]);
      f.post.blur = key(t, [[20, 0.06], [20.35, 0]]);
    } else if (t < 22) {
      // management consulting: the landscape read end to end
      useSky(f, pal('night'));
      f.sky.stars = 1;
      f.sky.sunDir = sunFrom(200, -20);
      c.pos = key(t, [[21, [70, 38, 60]], [22, [30, 30, 72], 'outCubic']]);
      c.target = [-6, 4, -8];
      c.fov = 44; c.portraitFov = 72;
      const T = f.topo;
      T.visible = true; T.reveal = 400;
      const p = f.particles;
      p.from = S.TERRAIN; p.to = S.TERRAIN; p.intensity = 0.3; p.base = lin('#C9D6F2'); p.hiEmissive = 1.6; p.light = 0.4;
      f.lines.push({ set: 'route', model: I4, width: 2.2, color: scale3(COLORS.apricotHot, 0.9), alpha: 1, trimA: 0, trimB: key(t, [[21, 0.2], [21.8, 1, 'outCubic']]), head: [3.4, 3, 2.6], headAmt: 2.4, additive: true });
      f.post.flash = key(t, [[21, 0.45], [21.15, 0]]);
      f.post.bloom = 0.65; f.post.bloomThreshold = 0.85;
    } else {
      // the cards cover the frame; keep something calm underneath
      useSky(f, pal('deep'));
      c.pos = [0, 30, 38]; c.target = [STONE.center[0], STONE.center[1], STONE.center[2]];
      f.particles.visible = false;
    }
    f.hud = { place: '' };
  }

  // ---------------------------------------------------------- G: four stages + build (24.5-28)
  function shotStages(f, t) {
    f.shot = 'stages'; f.chapter = 6;
    useSky(f, pal('deep'));
    const s = f.sky;
    s.dune = 0; s.fog = 0.02; s.fogDark = 1; s.stars = 0.4;
    const V = M.mul(M.T(STONE.center[0], STONE.center[1], STONE.center[2]), M.RX(key(t, [[24.5, 0.5], [28, 0.25]])));
    const c = f.camera;
    c.pos = key(t, [[24.5, [0, 30, 38]], [26.5, [5, 24, 29], 'inOutSine'], [28, [0, 13, 11], 'inCubic']]);
    c.target = [STONE.center[0], STONE.center[1], STONE.center[2]];
    c.fov = key(t, [[24.5, 44], [28, 52, 'inCubic']]);
    c.portraitFov = 72;
    c.roll = key(t, [[26.5, 0], [28, 12 * DEG, 'inCubic']]);
    const p = f.particles;
    p.from = S.VORTEX; p.to = S.VORTEX; p.fromM = V; p.toM = V;
    p.vortexSpin = 0.35;
    p.emissive = 0.2; p.hiEmissive = key(t, [[24.5, 0.8], [28, 1.8]]);
    p.fog = 0.004; p.light = 0.8;
    p.intensity = key(t, [[24.5, 0.5], [26.4, 0.55], [27.2, 0.62], [28, 0.8]]);
    p.lightDir = v3.norm([0.3, 1, 0.4]);
    p.spinTime = vortexAngle(t);
    f.post.bloom = key(t, [[24.5, 0.6], [28, 1.0]]);
    f.post.bloomThreshold = 0.7;
    f.post.ca = key(t, [[27.3, 0], [28, 0.18, 'inCubic']]);
    f.post.zoomBlur = key(t, [[27.2, 0], [28, 0.12, 'inCubic']]);
    f.hud = { place: '' };
  }
  function vortexAngle(t) {
    const b = 26.5, e = 29.4;
    if (t <= b) return t;
    const x = Math.min(t, e) - b, L = e - b;
    let v = b + x + (7 * x * x * x) / (3 * L * L);
    if (t > e) v += (t - e) * 8;
    return v;
  }

  // ---------------------------------------------------------- H: collapse + skystone (28-40)
  function shotStone(f, t) {
    f.shot = t < 30.5 ? 'collapse' : 'stone'; f.chapter = 7;
    const center = STONE.center;
    const Cm = M.T(center[0], center[1], center[2]);
    const c = f.camera;
    const s = f.sky;
    const p = f.particles;
    if (t < 30.5) {
      useSky(f, pal('deep'));
      s.dune = 0; s.fog = 0.02; s.fogDark = 1;
      s.amt = key(t, [[28, 1], [29.3, 0, 'inCubic']]);
      s.stars = 0.4;
      c.pos = key(t, [[28, [0, 13, 11]], [29.4, [0, 5.2, 5.5], 'outCubic'], [30.5, [3.4, 2.0, 11.2], 'inOutCubic']]);
      c.target = key(t, [[28, center], [30.5, [0, 1.95, -6]]]);
      c.fov = key(t, [[28, 52], [29.4, 40, 'outCubic'], [30.5, 34]]);
      c.portraitFov = 66;
      c.roll = key(t, [[28, 12 * DEG], [29.4, 0, 'outCubic']]);
      const V = M.mul(Cm, M.RX(0.25));
      p.from = S.VORTEX; p.to = S.POINT; p.fromM = V; p.toM = Cm;
      p.spinTime = vortexAngle(t);
      p.vortexSpin = 0.35;
      p.progress = key(t, [[28, 0], [29.45, 1, 'linear']]);
      p.ease = 2; p.stagger = 0.35; p.staggerMode = 4; p.staggerOrigin = center; p.staggerRange = 50;
      p.swirl = 5.0; p.swirlCenter = center;
      const beat = (x) => Math.exp(-Math.pow((t - x) / 0.07, 2));
      p.size = 1 + 1.6 * beat(29.5) + 1.2 * beat(30.0) - 0.6 * seg(t, 30.2, 30.5);
      p.emissive = 0.4; p.hiEmissive = 2.0; p.light = 0.5;
      p.intensity = key(t, [[28, 0.7], [29.4, 0.14]]);
      p.fraction = key(t, [[28.5, 1], [29.4, 0.3]]);
      f.post.bloom = key(t, [[28, 0.8], [29.5, 1.1]]);
      f.post.bloomThreshold = 0.6;
      f.post.ca = key(t, [[28, 0.18], [28.6, 0]]);
      f.post.flash = key(t, [[30.38, 0], [30.5, 1, 'inQuad']]);
      f.hud = { place: '' };
      return;
    }
    const P = PAL.dusk;
    useSky(f, P);
    s.sunDir = sunFrom(0, 1.6);
    s.amt = key(t, [[30.5, 0.2], [31.5, 1, 'outCubic']]);
    s.horizonLine = key(t, [[30.5, 0], [32, 0.7]]);
    s.stars = 0.15;
    f.dunes.visible = true;
    f.dunes.light = key(t, [[30.5, 0.3], [31.6, 1]]);
    c.pos = key(t, [[30.5, [3.4, 2.0, 11.2]], [40, [-3.0, 1.9, 10.2], 'inOutSine']]);
    c.target = key(t, [[30.5, [0, 1.95, -6]], [40, [0, 1.75, -6], 'inOutSine']]);
    c.fov = 34; c.portraitFov = 58;
    p.from = S.POINT; p.to = S.FINAL; p.fromM = Cm; p.toM = I4;
    p.progress = key(t, [[30.5, 0], [32.3, 1, 'linear']]);
    p.ease = 1; p.stagger = 0.3; p.staggerMode = 0; p.noise = 5;
    p.groupFade = [1, key(t, [[31.9, 1], [33.0, 0]]), 1, 1];
    p.drift = 0.08;
    p.lightDir = sunFrom(0, 10);
    p.rimCol = scale3(P.glow, 0.34);
    p.hiEmissive = key(t, [[30.5, 2.4], [32.5, 1.8]]);
    p.intensity = key(t, [[30.5, 0.35], [32.2, 0.6], [33.2, 1.25]]); p.transmit = 1.6; p.transitGrow = 0.8;
    f.stone.visible = true;
    f.stone.model = M.T(center[0], center[1], center[2]);
    f.stone.reveal = key(t, [[31.3, 0], [32.8, 1, 'inOutCubic']]);
    f.stone.fogCol = P.fog;
    f.shadow = { on: t > 31.2, center: [0, 1.5, -5], radius: 9, bias: 0.001 };
    f.post.flash = key(t, [[30.5, 1], [30.8, 0, 'outQuad']]);
    f.post.bloom = key(t, [[30.5, 0.9], [33, 0.5]]);
    f.post.rays = key(t, [[31.2, 0], [33, 0.45]]);
    f.post.fade = key(t, [[38.7, 0], [39.92, 1, 'inOutSine']]);
    f.hud = { place: 'Dubai' };
  }

  return {
    evaluate(tIn, frameAspect = 16 / 9) {
      aspect = frameAspect;
      const t = ((tIn % DURATION) + DURATION) % DURATION;
      const f = base(t);
      counts[0] = counts[1] = counts[2] = 0;
      if (t < 4) shotHorizon(f, t);
      else if (t < 8) shotReach(f, t);
      else if (t < 12) shotInvestment(f, t);
      else if (t < 16) shotInsights(f, t);
      else if (t < 20) shotImplementation(f, t);
      else if (t < 24.5) shotWhatWeDo(f, t);
      else if (t < 28) shotStages(f, t);
      else shotStone(f, t);
      return f;
    },
  };
}

// ---------------------------------------------------------------- static line sets
export function lineSets() {
  const sets = {};
  // arcs from Dubai to each city on the unit sphere, drawn one after another
  sets.arcs = {
    edges: CITY_V.map((cv, k) => {
      const pts = [];
      const ang = Math.acos(clamp(v3.dot(DUB_V, cv), -1, 1));
      const lift = 0.06 + 0.2 * (ang / Math.PI);
      for (let i = 0; i <= 90; i++) {
        const tt = i / 90;
        const p = slerp(DUB_V, cv, tt);
        const h = 1.006 + lift * Math.sin(Math.PI * tt);
        pts.push([p[0] * h, p[1] * h, p[2] * h]);
      }
      return { pts, delay: k * 0.13, seed: k * 0.21 };
    }),
  };
  const grat = [];
  for (let lat = -60; lat <= 75; lat += 15) {
    const ring = [];
    for (let lon = -180; lon <= 180; lon += 4) ring.push(latLon(lat, lon).map((v) => v * 1.003));
    grat.push(ring);
  }
  for (let lon = -180; lon < 180; lon += 15) {
    const ring = [];
    for (let lat = -80; lat <= 80; lat += 4) ring.push(latLon(lat, lon).map((v) => v * 1.003));
    grat.push(ring);
  }
  sets.grat = { polylines: grat };
  sets.route = { polyline: routePath3D(0.7) };
  return sets;
}
