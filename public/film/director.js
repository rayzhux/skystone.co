// The director: a pure function from film time to a complete frame description. Every camera move,
// light change, particle morph and box animation in the reel is authored here.
import { key, ease, clamp, seg, lerp, m4, v3, DEG, latLon, slerp } from './math.js';
import { S } from './shapes.js';
import { CITY, GLOBE, PROJECT, STONE, DUBAI, SHANGHAI, NETWORK, BRAIN } from './world.js';
import { BOX_STRIDE } from './boxes.js';

export const DURATION = 40;
export const CHAPTERS = [
  { t: 0, label: 'Horizon' },
  { t: 4, label: 'The route' },
  { t: 8, label: 'Investment' },
  { t: 12, label: 'Insights' },
  { t: 16, label: 'Implementation' },
  { t: 20, label: 'Six disciplines' },
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
  city: {
    zenith: lin('#0B1234'), mid: lin('#394269'), horizon: lin('#E39A6A'), glow: lin('#FFA95E', 1.1), anti: lin('#D39AA4'),
    ground: lin('#121318'), sunCol: lin('#FFCB94', 1.7), amb: lin('#8594C2', 0.62), fog: lin('#8A7A8C'),
  },
  night: {
    zenith: lin('#02040B'), mid: lin('#0A1228'), horizon: lin('#2A2940'), glow: lin('#FF9A55', 0.3), anti: lin('#1A1D33'),
    ground: lin('#06070B'), sunCol: lin('#AFC0E6', 0.35), amb: lin('#56669A', 0.42), fog: lin('#141626'),
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
  apricot: lin('#F6A964'),
  apricotHot: lin('#FFC98C', 2.2),
  bone: lin('#F3EEE6'),
  sand: lin('#E4D3B6'),
  ember: lin('#E0703A'),
};

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

/** Globe model: the point (lat, lon) faces the camera. */
function globeMatrix(camPos, lat, lon) {
  const c = GLOBE.center;
  const d = v3.norm(v3.sub(camPos, c));
  const yaw = Math.atan2(d[0], d[2]);
  const pitch = -Math.asin(clamp(d[1], -1, 1));
  return M.mul(M.T(c[0], c[1], c[2]), M.RY(yaw), M.RX(pitch), M.RX(lat * DEG), M.RY(-lon * DEG), M.S(GLOBE.radius));
}

const DUB_V = latLon(DUBAI.lat, DUBAI.lon);
const SHA_V = latLon(SHANGHAI.lat, SHANGHAI.lon);
const MID_V = slerp(DUB_V, SHA_V, 0.5);
const MID = { lat: Math.asin(MID_V[1]) / DEG, lon: Math.atan2(MID_V[0], MID_V[2]) / DEG };

const orbit = (theta, r, h, cx = 0, cz = 0) => [cx + Math.sin(theta) * r, h, cz + Math.cos(theta) * r];
const sunFrom = (azDeg, elDeg) => {
  const a = azDeg * DEG, e = elDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};

// ---------------------------------------------------------------- the director
export function createDirector({ wordAspect }) {
  const boxData = new Float32Array(600 * BOX_STRIDE);
  let boxCount = 0;
  const pushBox = (x, y0, z, w, h, d, seed, rotY, kind, reveal, hot = 0) => {
    if (h <= 0.01 || reveal <= 0) return;
    const o = boxCount * BOX_STRIDE;
    boxData[o] = x; boxData[o + 1] = y0; boxData[o + 2] = z;
    boxData[o + 3] = w; boxData[o + 4] = h; boxData[o + 5] = d;
    boxData[o + 6] = seed; boxData[o + 7] = rotY; boxData[o + 8] = kind; boxData[o + 9] = reveal;
    boxData[o + 10] = hot; boxData[o + 11] = 0;
    boxCount++;
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
        stars: 0, haze: 1, ground: P.ground, sunCol: P.sunCol, gridColor: scale3(COLORS.apricot, 0.18),
        dune: 1, grid: 0, gridScale: 4, fog: 0.012, horizonLine: 0, lineSpan: 1, lineCol: COLORS.apricotHot, blob: [0, 0, 1, 0],
      },
      particles: {
        visible: true, from: S.DESERT, to: S.DESERT, fromM: I4, toM: I4, fromS: 1, toS: 1,
        progress: 1, stagger: 0, staggerMode: 0, ease: 0, staggerOrigin: [0, 0, 0], staggerRange: 100,
        noise: 0, lift: 0, swirl: 0, swirlCenter: [0, 0, 0], size: 1, drift: 0, vortexSpin: 0, flowSpeed: 1,
        groupFade: [1, 1, 1, 1], fog: 0.004, minPx: 1.2, sunCol: P.sunCol, ambCol: P.amb, rimCol: scale3(P.glow, 0.25),
        fogCol: P.fog, base: COLORS.sand, hiCol: COLORS.apricot, emissive: 0, light: 1, hiEmissive: 0.4,
        lightDir: sunFrom(0, 12), fraction: 1, intensity: 1, transitGrow: 0, transmit: 0.9,
      },
      boxes: {
        sunCol: P.sunCol, ambCol: P.amb, fogCol: P.fog, stone: lin('#1C2030'), stone2: lin('#34353F'), slab: lin('#ECE4D6'),
        winCol: lin('#FFC47E', 2.2), edgeCol: lin('#FFB36B', 2.2), fog: 0.0024, windows: 0.18, night: 0, light: 1, edgeGlow: 0.9, reflect: 1,
      },
      boxData, boxCount: 0,
      globe: { visible: false, amt: 0, model: I4, body: lin('#0B1024'), rim: lin('#3B4A7A', 0.6), atmo: lin('#7F9BE0', 0.35) },
      lines: [],
      billboards: [],
      stone: { visible: false, model: I4, reveal: 0, edgeCol: lin('#FFB36B', 2.0), fogCol: P.fog, fog: 0.004, light: 1 },
      post: {
        bloom: 0.45, bloomThreshold: 0.95, exposure: 1.1, ca: 0, vignette: 0.42, grain: 0.04,
        flash: 0, flashCol: [1, 0.93, 0.84], fade: 0, blur: 0, blurDir: [1, 0], zoomBlur: 0,
        shadowTint: [0.1, 0.25, 0.45], highTint: [0.6, 0.35, 0.1], lift: 0.0, saturation: 1.0,
      },
      anchors: {},
      hud: {},
    };
  }

  // ---------------------------------------------------------- shot A: horizon (0-4)
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
    const p = f.particles;
    p.from = S.HORIZON; p.to = S.DESERT;
    p.progress = key(t, [[0.4, 0], [3.7, 1, 'linear']]);
    p.ease = 3; p.stagger = 0.55; p.staggerMode = 5; p.staggerOrigin = [0, 1.6, 5]; p.staggerRange = 90;
    p.noise = 0.25; p.drift = 0.1;
    p.light = key(t, [[0, 0.35], [3, 1]]);
    p.lightDir = sunFrom(0, 8);
    p.rimCol = scale3(PAL.dusk.glow, 0.32);
    p.hiEmissive = 2.2; p.intensity = 1.5; p.transmit = 1.6;
    f.post.vignette = 0.5;
    f.post.fade = 0;
    f.hud = { coords: '25.2048° N · 55.2708° E', place: 'Dubai', local: 'GST' };
  }

  // ---------------------------------------------------------- shot B: the route (4-8)
  function shotRoute(f, t) {
    f.shot = 'route'; f.chapter = 1;
    const c = f.camera;
    c.pos = key(t, [[4, [0, 1.62, 3.4]], [5.7, [0, 6.5, -2], 'inOutCubic'], [7.6, [2.5, 21.5, -9.5], 'inOutCubic'], [8, [1.2, 26.5, -30], 'inQuart']]);
    c.target = key(t, [[4, [0, 2.7, -60]], [5.7, [0, 22, -62], 'inOutCubic'], [7.6, [0, 29, -62], 'inOutCubic']]);
    c.fov = key(t, [[4, 34], [7.6, 40], [8, 30, 'inQuart']]);
    c.portraitFov = key(t, [[4, 58], [7.6, 64]]);
    c.roll = key(t, [[4, 0.6 * DEG], [5.8, -3.5 * DEG], [7.6, 1.5 * DEG]]);

    const s = f.sky;
    s.horizonLine = key(t, [[4, 0.55], [5.5, 0.2]]);
    s.stars = key(t, [[4, 0.12], [6.5, 0.7]]);

    // globe orientation: spin in to Dubai, then drift to the middle of the route
    const lat = key(t, [[4, 18], [6.0, DUBAI.lat, 'outCubic'], [7.7, MID.lat - 4, 'inOutCubic'], [8, SHANGHAI.lat]]);
    const lon = key(t, [[4, DUBAI.lon - 70], [6.0, DUBAI.lon, 'outCubic'], [7.7, MID.lon, 'inOutCubic'], [8, SHANGHAI.lon, 'inQuad']]);
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
    p.hiEmissive = key(t, [[5.5, 0.3], [6.6, 1.5]]);
    p.emissive = 0.05;
    p.rimCol = scale3(PAL.dusk.glow, 0.15);
    p.fog = 0.002;

    const trim = key(t, [[5.9, 0], [7.7, 1, 'inOutCubic']]);
    f.lines.push({
      set: 'grat', model: G, width: 1, color: scale3(COLORS.bone, 0.12), alpha: key(t, [[5.2, 0], [6.4, 0.55]]), trimA: 0, trimB: 1, additive: true,
    });
    f.lines.push({
      set: 'route', model: G, width: 3.2, color: scale3(COLORS.apricotHot, 1.2), head: [4, 3.4, 2.8], headAmt: 3.0,
      alpha: trim > 0 ? 1 : 0, trimA: 0, trimB: trim, additive: true,
    });
    f.anchors.dubai = m4.transformPoint(G, DUB_V);
    f.anchors.shanghai = m4.transformPoint(G, SHA_V);
    f.anchors.globe = GLOBE.center;
    f.anchors.globeR = GLOBE.radius;
    f.hud = { coords: routeCoords(trim), place: trim < 0.5 ? 'Dubai' : 'Shanghai', trim };
    f.post.zoomBlur = key(t, [[7.7, 0], [8, 0.2, 'inQuad']]);
    f.post.ca = key(t, [[7.7, 0], [8, 0.4, 'inQuad']]);
  }
  function routeCoords(tr) {
    const p = slerp(DUB_V, SHA_V, tr);
    const la = Math.asin(p[1]) / DEG, lo = Math.atan2(p[0], p[2]) / DEG;
    return `${la.toFixed(4)}° N · ${lo.toFixed(4)}° E`;
  }

  // ---------------------------------------------------------- city helpers
  function tower(tw, g, reveal = 1, hot = 0) {
    const H = tw.h * g;
    if (H <= 0.01) return;
    for (const [a, b, ws, ds] of tw.tiers) {
      pushBox(tw.x, a * H, tw.z, tw.w * ws, (b - a) * H, tw.d * ds, tw.seed, 0, tw.super ? 1 : 0, reveal, b >= 1 ? hot : 0);
    }
  }
  function city(f, heightOf, revealOf) {
    for (const tw of CITY.towers) tower(tw, heightOf ? heightOf(tw) : 1, revealOf ? revealOf(tw) : 1);
  }
  function cityLook(f, palA, palB, mixT, sunAz = 158) {
    const P = pal(palA, palB, mixT);
    const s = f.sky;
    s.zenith = P.zenith; s.mid = P.mid; s.horizon = P.horizon; s.glow = P.glow; s.anti = P.anti; s.ground = P.ground; s.sunCol = P.sunCol;
    s.dune = 0; s.grid = 0.5; s.gridScale = 4; s.fog = 0.0024; s.fogDark = 0.55;
    s.sunDir = sunFrom(sunAz, 6);
    const b = f.boxes;
    b.sunCol = P.sunCol; b.ambCol = P.amb; b.fogCol = P.fog;
    const p = f.particles;
    p.sunCol = P.sunCol; p.ambCol = P.amb; p.fogCol = P.fog; p.lightDir = s.sunDir;
    return P;
  }
  function cityGrow(f, t, t0, spanT, dur, stepped = 0) {
    for (const tw of CITY.towers) {
      let g = ease.outExpo(seg(t, t0 + tw.delay * spanT, t0 + dur + tw.delay * spanT));
      if (stepped) g = Math.round(g * stepped) / stepped;
      const hot = g > 0 && g < 1 ? Math.pow(1 - g, 0.6) : 0;
      tower(tw, g, 1, hot);
    }
  }

  // ---------------------------------------------------------- shot C: investment (8-12)
  const INV_THETA_MID = -24 * DEG;
  function shotInvestment(f, t) {
    f.shot = 'investment'; f.chapter = 2;
    cityLook(f, 'city');
    const th = key(t, [[8, -34 * DEG], [12, -16 * DEG, 'outCubic']]);
    const r = key(t, [[8, 182], [12, 150, 'outCubic']]);
    const h = key(t, [[8, 6], [12, 11]]);
    const c = f.camera;
    c.pos = orbit(th, r, h);
    c.target = key(t, [[8, [0, 36, 0]], [12, [0, 45, 0]]]);
    c.fov = 40; c.portraitFov = 70;
    c.roll = key(t, [[8, -2 * DEG], [12, 0]]);

    // the globe's dots fall and become the site plan; the towers climb out of it
    const p = f.particles;
    p.from = S.SCATTER; p.to = S.GRID;
    p.fromM = M.T(0, 60, 0);
    p.progress = key(t, [[8.0, 0], [9.3, 1, 'linear']]);
    p.ease = 3; p.stagger = 0.5; p.staggerMode = 5; p.staggerOrigin = [0, 0, 0]; p.staggerRange = 70;
    p.noise = 3; p.swirl = 0.6; p.swirlCenter = [0, 0, 0];
    p.intensity = key(t, [[8, 1.2], [10.5, 0.55]]); p.hiEmissive = 1.4; p.transmit = 0.3;
    cityGrow(f, t, 8.55, 1.25, 1.15);

    const asp = wordAspect('investment');
    const H = 30;
    const back = 60;
    const bx = -Math.sin(INV_THETA_MID) * back, bz = -Math.cos(INV_THETA_MID) * back;
    const y = key(t, [[8.5, 84], [10.4, 100, 'outExpo']]);
    f.billboards.push({
      word: 'investment', model: M.mul(M.T(bx, y, bz), M.RY(INV_THETA_MID), M.S(asp * H, H, 1)),
      color: scale3(COLORS.bone, 1.15), fogCol: PAL.city.fog, alpha: key(t, [[8.5, 0], [9.0, 1], [11.55, 1], [12, 0]]),
      reveal: key(t, [[8.6, 0], [9.9, 1.08, 'outExpo']]), fog: 0.0015, glow: 0.15,
    });
    f.post.flash = key(t, [[8.0, 0.9], [8.22, 0, 'outQuad']]);
    f.post.ca = key(t, [[8.0, 0.35], [8.45, 0]]);
    f.hud = { coords: '31.2304° N · 121.4737° E', place: 'Shanghai' };
  }

  // ---------------------------------------------------------- shot D: insights (12-16)
  function shotInsights(f, t) {
    f.shot = 'insights'; f.chapter = 3;
    const nightT = key(t, [[12, 0], [13.8, 1]]);
    cityLook(f, 'city', 'night', nightT);
    f.sky.stars = nightT;
    f.sky.grid = key(t, [[12, 0.5], [14, 0.75]]);
    f.sky.fog = 0.0028;
    const c = f.camera;
    const a0 = orbit(-16 * DEG, 150, 11);
    c.pos = key(t, [[12, a0], [13.1, [-40, 84, 92], 'inOutCubic'], [14.1, [2, 120, 12], 'inOutCubic'], [16, [-5, 104, 9], 'inOutSine']]);
    c.target = key(t, [[12, [0, 45, 0]], [13.1, [0, 12, 0], 'inOutCubic'], [14.1, [0, 0, -1], 'inOutCubic'], [16, [0, 0, 0]]]);
    const yaw = key(t, [[14.1, 0], [16, 14 * DEG, 'inOutSine']]);
    const upT = key(t, [[12.6, 0], [14.1, 1, 'inOutCubic']]);
    c.up = v3.norm(v3.lerp([0, 1, 0], [Math.sin(yaw), 0, -Math.cos(yaw)], upT));
    c.fov = 40; c.portraitFov = 70;

    const b = f.boxes;
    b.night = nightT;
    b.windows = key(t, [[12.4, 0], [14.3, 1]]);
    b.light = key(t, [[12, 1], [13.8, 0.35]]);
    city(f);

    const p = f.particles;
    p.from = S.GRID; p.to = S.FLOW_A;
    p.progress = key(t, [[12.8, 0], [14.3, 1, 'linear']]);
    p.stagger = 0.45; p.staggerMode = 0; p.noise = 3; p.lift = 9; p.transitGrow = 1.5;
    p.emissive = 0.15; p.hiEmissive = 1.1; p.flowSpeed = 1.3; p.light = 0.5; p.size = key(t, [[12.8, 1], [14.3, 0.55]]);
    p.intensity = key(t, [[12, 0.55], [14.3, 0.38]]);

    f.lines.push({
      set: 'network', model: I4, width: 1.0, color: scale3(COLORS.apricot, 0.22), head: [2.2, 1.8, 1.3], headAmt: 1.4,
      alpha: 1, mode: 1, progress: key(t, [[13.1, 0], [15.3, 1, 'linear']]), dur: 0.35,
      pulse: 0.5, pulseW: 0.06, pulseAmt: key(t, [[14, 0], [14.6, 1.6]]), additive: true,
    });
    const asp = wordAspect('insights');
    const H = 15;
    f.billboards.push({
      word: 'insights', model: M.mul(M.T(0, 0.35, 0), M.RX(-Math.PI / 2), M.S(asp * H, H, 1)),
      color: scale3(COLORS.bone, 1.25), fogCol: PAL.night.fog, alpha: key(t, [[13.8, 0], [14.5, 1]]),
      reveal: key(t, [[13.85, 0], [15.0, 1.08, 'inOutCubic']]), fog: 0.0008, glow: 0.4,
    });
    f.post.bloom = key(t, [[12, 0.45], [14, 0.6]]);
    f.post.bloomThreshold = 0.9;
    f.hud = { coords: '31.2304° N · 121.4737° E', place: 'Shanghai' };
  }

  // ---------------------------------------------------------- the project tower
  function project(f, t, { tIn, tSnap, step, spread = 1, reveal = 1, kindCore = 3 }) {
    const { floors, floorH, w, d, core } = PROJECT;
    const coreH = floors * floorH;
    const cg = ease.outExpo(seg(t, tIn + 0.35, tIn + 1.0));
    pushBox(0, 0, 0, core, coreH * cg, core, 0.31, 0, kindCore, reveal);
    for (let i = 0; i < floors; i++) {
      const seedA = Math.sin(i * 12.9898) * 43758.5453;
      const rA = seedA - Math.floor(seedA);
      const ts = tSnap + i * step;
      const k = seg(t, ts, ts + 0.24);
      const snap = ease.outBack(k);
      const arrive = ease.outExpo(seg(t, tIn + i * 0.03, tIn + 0.9 + i * 0.03));
      const exY = i * floorH + (i + 1) * 5.0 * spread + 12 * spread;
      const y = lerp(exY + 46 * (1 - arrive), i * floorH, snap);
      const x = lerp((rA - 0.5) * 8 * spread, 0, snap);
      const z = lerp((0.5 - rA) * 6 * spread, 0, snap);
      const rot = lerp((rA - 0.5) * 16 * DEG * spread, 0, snap);
      const rv = Math.min(reveal, ease.outCubic(seg(t, tIn + i * 0.03, tIn + 0.5 + i * 0.03)));
      const hot = k > 0 ? Math.exp(-k * 5) * 1.4 : 0;
      pushBox(x, y, z, w, 0.6, d, 0.5 + i * 0.01, rot, 2, rv, hot);
    }
    return coreH;
  }

  // ---------------------------------------------------------- shot E: implementation (16-20)
  function shotImplementation(f, t) {
    f.shot = 'implementation'; f.chapter = 4;
    const nightT = key(t, [[16, 1], [17.4, 0.25]]);
    cityLook(f, 'city', 'night', nightT, 205);
    f.sky.grid = key(t, [[16, 0.75], [17.4, 1.1]]);
    f.sky.gridColor = scale3(COLORS.apricot, 0.22);
    f.sky.fog = 0.0022; f.sky.fogDark = 0.85;
    f.sky.stars = nightT * 0.6;
    const c = f.camera;
    const yaw = 14 * DEG;
    c.pos = key(t, [[16, [-5, 104, 9]], [17.4, [-62, 48, 56], 'inOutCubic'], [20, [-46, 13, 42], 'inOutSine']]);
    c.target = key(t, [[16, [0, 0, 0]], [17.4, [0, 20, 0], 'inOutCubic'], [20, [0, 29, 0], 'inOutSine']]);
    const upT = key(t, [[16, 0], [17.4, 1, 'inOutCubic']]);
    c.up = v3.norm(v3.lerp([Math.sin(yaw), 0, -Math.cos(yaw)], [0, 1, 0], upT));
    c.fov = key(t, [[16, 40], [17.4, 30, 'inOutCubic'], [20, 40, 'inOutSine']]);
    c.portraitFov = key(t, [[16, 70], [17.4, 54], [20, 66]]);

    const b = f.boxes;
    b.night = nightT; b.windows = key(t, [[16, 1], [17, 0]]); b.light = key(t, [[16, 0.35], [17.4, 1]]);
    // the city sinks away, edges first
    city(f, (tw) => 1 - ease.inCubic(seg(t, 16.0 + (1 - tw.delay) * 0.55, 16.55 + (1 - tw.delay) * 0.55)));
    const coreH = project(f, t, { tIn: 16.6, tSnap: 17.55, step: 0.125 });

    const p = f.particles;
    p.from = S.FLOW_A; p.to = S.GRID;
    p.progress = key(t, [[16.0, 0], [17.3, 1, 'linear']]);
    p.stagger = 0.3; p.noise = 2.2; p.hiEmissive = 0.9; p.emissive = 0.1; p.intensity = 0.55;

    f.lines.push({
      set: 'crane', model: M.mul(M.T(14, 0, -11), M.RY(key(t, [[16.8, 0.6], [20, -0.25]]))), width: 1.2,
      color: scale3(COLORS.bone, 0.62), alpha: key(t, [[16.9, 0], [17.6, 0.95]]), trimA: 0, trimB: key(t, [[16.9, 0], [18.3, 1, 'inOutCubic']]),
      head: COLORS.apricotHot, headAmt: 1.2, additive: false,
    });
    const asp = wordAspect('insights');
    f.billboards.push({
      word: 'insights', model: M.mul(M.T(0, 0.35, 0), M.RX(-Math.PI / 2), M.S(asp * 15, 15, 1)),
      color: scale3(COLORS.bone, 1.25), fogCol: PAL.night.fog, alpha: key(t, [[16, 1], [16.45, 0]]), fog: 0.0008, glow: 0.4,
    });
    const floorsDone = [];
    for (let i = 0; i < PROJECT.floors; i++) floorsDone.push(seg(t, 17.55 + i * 0.125, 17.55 + i * 0.125 + 0.24));
    f.anchors.tower = { base: [0, 0, 0], height: coreH, w: PROJECT.w, d: PROJECT.d, floors: floorsDone, floorH: PROJECT.floorH };
    f.post.bloom = 0.5;
    f.hud = { coords: '25.2048° N · 55.2708° E', place: 'Dubai' };
  }

  // ---------------------------------------------------------- shot F: six disciplines (20-24.5)
  function shotDisciplines(f, t) {
    f.shot = 'disciplines'; f.chapter = 5;
    const c = f.camera;
    if (t < 21) {
      // F1 real estate & construction: the skyline climbs back in stepped bursts
      cityLook(f, 'city');
      const th = key(t, [[20, 32 * DEG], [21, 96 * DEG, 'outExpo']]);
      c.pos = orbit(th, 92, 5);
      c.target = [0, 26, 0];
      c.fov = 44; c.portraitFov = 72;
      c.roll = key(t, [[20, 7 * DEG], [21, 0, 'outExpo']]);
      cityGrow(f, t, 20.0, 0.5, 0.55, 8);
      const p = f.particles;
      p.from = S.GRID; p.to = S.GRID; p.intensity = 0.5; p.hiEmissive = 1.2;
      f.post.flash = key(t, [[20, 0.7], [20.18, 0]]);
      f.post.ca = key(t, [[20, 0.45], [20.35, 0]]);
      f.post.blur = key(t, [[20, 0.06], [20.35, 0]]);
      f.post.blurDir = [1, 0];
    } else if (t < 22) {
      // F2 artificial intelligence: a neural cloud assembles out of the dark
      const P = pal('deep');
      const s = f.sky;
      s.zenith = P.zenith; s.mid = P.mid; s.horizon = P.horizon; s.glow = P.glow; s.anti = P.anti; s.ground = P.ground; s.dune = 0; s.fog = 0.02; s.fogDark = 1;
      s.stars = 0.5;
      const spin = key(t, [[21, 0], [22, 0.9]]);
      const B = M.mul(M.T(0, 22, 0), M.RY(spin), M.RX(0.25));
      c.pos = orbit(key(t, [[21, -20 * DEG], [22, 36 * DEG, 'outCubic']]), key(t, [[21, 46], [22, 33]]), 27);
      c.target = [0, 22, 0];
      c.fov = 42; c.portraitFov = 70;
      const p = f.particles;
      p.from = S.SCATTER; p.to = S.BRAIN; p.toM = B;
      p.progress = key(t, [[21, 0], [21.55, 1, 'linear']]);
      p.ease = 1; p.stagger = 0.25; p.noise = 4; p.swirl = 1.2; p.swirlCenter = [0, 22, 0];
      p.emissive = 0.1; p.hiEmissive = 2.2; p.light = 0.5; p.intensity = 0.5; p.size = 0.75;
      p.sunCol = P.sunCol; p.ambCol = P.amb; p.fogCol = P.fog; p.fog = 0.006;
      p.lightDir = v3.norm([0.4, 0.8, 0.5]);
      f.lines.push({
        set: 'brain', model: B, width: 1.2, color: scale3(COLORS.apricot, 0.75), head: [2.4, 2.0, 1.7], headAmt: 1.6, alpha: 1,
        mode: 1, progress: key(t, [[21.02, 0], [21.6, 1, 'linear']]), dur: 0.25, pulse: 1.4, pulseW: 0.1, pulseAmt: 1.4, additive: true,
      });
      f.post.bloom = 0.8; f.post.bloomThreshold = 0.7;
      f.post.flash = key(t, [[21, 0.45], [21.15, 0]]);
    } else {
      // F3 advanced manufacturing: the exploded tower snaps together at double time
      cityLook(f, 'city', 'night', 0.3, 205);
      f.sky.grid = 1.1; f.sky.gridColor = scale3(COLORS.apricot, 0.22); f.sky.fog = 0.0022; f.sky.fogDark = 0.85;
      c.pos = orbit(key(t, [[22, 138 * DEG], [23, 152 * DEG]]), 92, 58);
      c.target = [0, 22, 0];
      c.fov = 28; c.portraitFov = 52;
      project(f, t, { tIn: 21.95, tSnap: 22.25, step: 0.045, spread: 0.8 });
      const p = f.particles;
      p.from = S.GRID; p.to = S.GRID; p.hiEmissive = 0.9; p.intensity = 0.55;
      f.lines.push({
        set: 'crane', model: M.mul(M.T(14, 0, -11), M.RY(key(t, [[22, -0.6], [23, 0.2]]))), width: 1.2,
        color: scale3(COLORS.bone, 0.6), alpha: 0.9, trimA: 0, trimB: 1, additive: false,
      });
      f.anchors.tower = { base: [0, 0, 0], height: PROJECT.floors * PROJECT.floorH, w: PROJECT.w, d: PROJECT.d, floors: null, floorH: PROJECT.floorH };
      f.post.flash = key(t, [[22, 0.45], [22.15, 0]]);
    }
    f.hud = { coords: '', place: '' };
  }

  // ---------------------------------------------------------- shot G: four stages + build (24.5-28)
  function shotStages(f, t) {
    f.shot = 'stages'; f.chapter = 6;
    const P = pal('deep');
    const s = f.sky;
    s.zenith = P.zenith; s.mid = P.mid; s.horizon = P.horizon; s.glow = P.glow; s.anti = P.anti; s.ground = P.ground; s.dune = 0; s.fog = 0.02; s.fogDark = 1; s.stars = 0.4;
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
    p.sunCol = P.sunCol; p.ambCol = P.amb; p.fogCol = P.fog; p.fog = 0.004; p.light = 0.8;
    p.intensity = key(t, [[24.5, 0.5], [26.4, 0.55], [27.2, 0.62], [28, 0.8]]);
    p.lightDir = v3.norm([0.3, 1, 0.4]);
    // spin accelerates through the build: integrate a ramp so the angle stays continuous
    p.spinTime = vortexAngle(t);
    f.post.bloom = key(t, [[24.5, 0.6], [28, 1.0]]);
    f.post.bloomThreshold = 0.7;
    f.post.ca = key(t, [[27.3, 0], [28, 0.18, 'inCubic']]);
    f.post.zoomBlur = key(t, [[27.2, 0], [28, 0.12, 'inCubic']]);
    f.hud = { coords: '', place: '' };
  }
  // angle-time for the vortex so spin speed can ramp without jumps: d(angle)/dt = 1 + 7 * ramp^2
  function vortexAngle(t) {
    const a = 24.5, b = 26.5, e = 29.4;
    if (t <= b) return t;
    const x = Math.min(t, e) - b, L = e - b;
    // integral of 1 + 7 (x/L)^2 dx
    let v = b + x + (7 * x * x * x) / (3 * L * L);
    if (t > e) v += (t - e) * 8;
    void a;
    return v;
  }

  // ---------------------------------------------------------- shot H: collapse + skystone (28-40)
  function shotStone(f, t) {
    f.shot = t < 30.5 ? 'collapse' : 'stone'; f.chapter = 7;
    const center = STONE.center;
    const Cm = M.T(center[0], center[1], center[2]);
    const c = f.camera;
    const s = f.sky;
    const p = f.particles;
    if (t < 30.5) {
      const P = pal('deep');
      s.zenith = P.zenith; s.mid = P.mid; s.horizon = P.horizon; s.glow = P.glow; s.anti = P.anti; s.ground = P.ground; s.dune = 0; s.fog = 0.02; s.fogDark = 1;
      s.amt = key(t, [[28, 1], [29.3, 0, 'inCubic']]);
      s.stars = 0.4;
      c.pos = key(t, [[28, [0, 13, 11]], [29.4, [0, 5.2, 5.5], 'outCubic'], [30.5, [3.4, 2.0, 11.2], 'inOutCubic']]);
      c.target = key(t, [[28, center], [30.5, [0, 1.9, -6]]]);
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
      f.hud = { coords: '', place: '' };
      return;
    }
    // the stone
    const P = PAL.dusk;
    s.sunDir = sunFrom(0, 1.6);
    s.amt = key(t, [[30.5, 0.2], [31.5, 1, 'outCubic']]);
    s.horizonLine = key(t, [[30.5, 0], [32, 0.7]]);
    s.stars = 0.15;
    s.blob = [center[0], center[2], 2.4, key(t, [[31.4, 0], [32.6, 0.6]])];
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
    f.post.flash = key(t, [[30.5, 1], [30.8, 0, 'outQuad']]);
    f.post.bloom = key(t, [[30.5, 0.9], [33, 0.5]]);
    f.post.fade = key(t, [[38.7, 0], [39.92, 1, 'inOutSine']]);
    f.anchors.stone = { top: [center[0], center[1] + STONE.radii[1], center[2]], base: [center[0], 0, center[2]] };
    f.hud = { coords: '25.2048° N · 55.2708° E', place: 'Dubai' };
  }

  return {
    evaluate(tIn) {
      const t = ((tIn % DURATION) + DURATION) % DURATION;
      const f = base(t);
      boxCount = 0;
      if (t < 4) shotHorizon(f, t);
      else if (t < 8) shotRoute(f, t);
      else if (t < 12) shotInvestment(f, t);
      else if (t < 16) shotInsights(f, t);
      else if (t < 20) shotImplementation(f, t);
      else if (t < 24.5) shotDisciplines(f, t);
      else if (t < 28) shotStages(f, t);
      else shotStone(f, t);
      f.boxCount = boxCount;
      return f;
    },
  };
}

// ---------------------------------------------------------------- static line sets
export function lineSets() {
  const sets = {};
  // route arc on the unit sphere
  const arc = [];
  {
    const n = 120;
    for (let i = 0; i <= n; i++) {
      const tt = i / n;
      const p = slerp(DUB_V, SHA_V, tt);
      const h = 1.006 + 0.17 * Math.sin(Math.PI * tt);
      arc.push([p[0] * h, p[1] * h, p[2] * h]);
    }
  }
  sets.route = { polyline: arc };
  // graticule
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
  // rooftop network, each edge a shallow arc
  const net = [];
  NETWORK.edges.forEach(([a, b], k) => {
    const A = NETWORK.nodes[a], B = NETWORK.nodes[b];
    const L = Math.hypot(A[0] - B[0], A[2] - B[2]);
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      pts.push([lerp(A[0], B[0], u), lerp(A[1], B[1], u) + Math.sin(Math.PI * u) * L * 0.12, lerp(A[2], B[2], u)]);
    }
    net.push({ pts, delay: NETWORK.delays[k] * 0.62, seed: (k * 0.618) % 1 });
  });
  sets.network = { edges: net };
  // synapses of the neural cloud
  sets.brain = {
    edges: BRAIN.edges.map(([a, b], k) => ({ pts: [BRAIN.nodes[a], BRAIN.nodes[b]], delay: ((k * 0.381966) % 1) * 0.7, seed: (k * 0.618) % 1 })),
  };
  // a luffing tower crane, drawn as lattice (mast at the local origin)
  const crane = [];
  const H = 62, m = 0.7;
  const corners = [[-m, -m], [m, -m], [m, m], [-m, m]];
  for (const [x, z] of corners) crane.push([[x, 0, z], [x, H, z]]);
  for (let y = 0; y < H; y += 2.2) {
    crane.push([[-m, y, m], [m, y + 2.2, m]]);
    crane.push([[m, y, -m], [-m, y + 2.2, -m]]);
    crane.push([[m, y, m], [m, y + 2.2, -m]]);
  }
  const jibL = 34, cjL = 11, jy = H;
  crane.push([[-cjL, jy, -m], [jibL, jy, -m]], [[-cjL, jy, m], [jibL, jy, m]], [[-cjL, jy + 1.6, 0], [jibL, jy + 1.2, 0]]);
  for (let x = -cjL; x < jibL; x += 2) {
    crane.push([[x, jy, -m], [x + 1, jy + 1.5, 0]], [[x + 1, jy + 1.5, 0], [x + 2, jy, m]]);
  }
  crane.push([[0, H, 0], [0, H + 8, 0]], [[0, H + 8, 0], [jibL * 0.72, jy + 1.3, 0]], [[0, H + 8, 0], [-cjL, jy + 1.6, 0]]);
  crane.push([[-cjL + 1, jy - 2.4, -m], [-cjL + 4, jy - 2.4, m]], [[-cjL + 1, jy - 2.4, -m], [-cjL + 1, jy, -m]]);
  crane.push([[21, jy, 0], [21, jy - 22, 0]], [[20.2, jy - 22, 0], [21.8, jy - 22, 0]]);
  sets.crane = { segments: crane };
  return sets;
}

