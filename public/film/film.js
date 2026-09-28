// The film engine: owns the GL context and every renderer, and turns a director frame into pixels.
import { createContext } from './gl.js';
import { m4, clamp, lerp, DEG } from './math.js';
import { buildShapes, readMask } from './shapes.js';
import { createSky } from './sky.js';
import { createParticles } from './particles.js';
import { createBoxes } from './boxes.js';
import { createLines, createLineSet, polylineSegs } from './lines.js';
import { createBillboards } from './billboards.js';
import { createStone } from './stone.js';
import { createGlobe } from './globe.js';
import { createPost } from './post.js';
import { createDirector, lineSets, DURATION } from './director.js';

const SERIF = '"Bodoni Moda", "Bodoni 72", Didot, Georgia, serif';
const WORDS = [
  { id: 'investment', text: 'INVESTMENT', style: 'normal 500', tracking: 0.06 },
  { id: 'insights', text: 'Insights', style: 'italic 400', tracking: 0 },
];

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// particle targets are built in a worker so the page stays responsive while the film boots
function buildShapesAsync(side, mask) {
  return new Promise((resolve) => {
    let w;
    try {
      w = new Worker(new URL('./shapes-worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      resolve(buildShapes(side, mask));
      return;
    }
    const fallback = () => { w.terminate(); resolve(buildShapes(side, mask)); };
    const timer = setTimeout(fallback, 8000);
    w.onmessage = (e) => { clearTimeout(timer); w.terminate(); resolve(e.data); };
    w.onerror = () => { clearTimeout(timer); fallback(); };
    w.postMessage({ side, mask });
  });
}

export function detectTier() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  if (coarse || cores <= 4 || mem <= 4) return 'low';
  if (cores <= 8) return 'medium';
  return 'high';
}

const TIERS = {
  high: { side: 256, samples: 4, maxDpr: 1.75, maxPixels: 2.5e6 },
  medium: { side: 192, samples: 4, maxDpr: 1.5, maxPixels: 1.9e6 },
  low: { side: 136, samples: 0, maxDpr: 1.6, maxPixels: 1.25e6 },
  export: { side: 256, samples: 4, maxDpr: 1, maxPixels: 1e9 },
};

export async function createFilm(canvas, { tier = detectTier(), landUrl = '/film/land.png', fixedSize = null } = {}) {
  const gl = createContext(canvas);
  if (!gl) throw new Error('webgl2-unavailable');
  const T = TIERS[tier] || TIERS.medium;

  const mask = readMask(await loadImage(landUrl));
  const shapes = await buildShapesAsync(T.side, mask);

  const sky = createSky(gl);
  const globe = createGlobe(gl);
  const particles = createParticles(gl, shapes);
  const boxes = createBoxes(gl, 600);
  const lines = createLines(gl);
  const billboards = createBillboards(gl);
  const stone = createStone(gl);
  const post = createPost(gl);

  // static line sets
  const L = lineSets();
  lines.add('route', createLineSet(gl, polylineSegs(L.route.polyline)));
  lines.add('grat', createLineSet(gl, L.grat.polylines.flatMap((pl, i) => polylineSegs(pl, 0, i * 0.37))));
  lines.add('network', createLineSet(gl, L.network.edges.flatMap((e) => polylineSegs(e.pts, e.delay, e.seed))));
  lines.add('brain', createLineSet(gl, L.brain.edges.flatMap((e) => polylineSegs(e.pts, e.delay, e.seed))));
  {
    // crane strokes are independent; order them so the draw-on climbs the mast, then runs out along the jib
    const strokes = L.crane.segments
      .map(([a, b]) => ({ a, b, k: Math.min(a[1], b[1]) * 10 + (a[0] + b[0]) * 0.5 }))
      .sort((p, q) => p.k - q.k);
    const n = strokes.length;
    lines.add('crane', createLineSet(gl, strokes.map((s, i) => [...s.a, ...s.b, i / n, (i + 1) / n, 0, 0])));
  }

  const rasterize = () => WORDS.forEach((w) => billboards.addWord(w.id, w.text, w.style, SERIF, { tracking: w.tracking }));
  rasterize();
  const fontsReady = Promise.all([
    document.fonts.load('500 120px "Bodoni Moda"'),
    document.fonts.load('italic 400 120px "Bodoni Moda"'),
  ]).then(() => rasterize()).catch(() => {});

  const director = createDirector({ wordAspect: (id) => billboards.aspect(id) });

  const cam = {
    view: m4.create(), proj: m4.create(), viewProj: m4.create(), invViewProj: m4.create(),
    pos: [0, 0, 0], res: [1, 1], pointScale: 1, pxScale: 1, sunDirView: [0, 0, 1], fov: 36, aspect: 1,
  };
  const roll = m4.create();

  let width = 1, height = 1, renderScale = 1;
  function resize(cssW, cssH, dpr = window.devicePixelRatio || 1) {
    let w, h;
    if (fixedSize) {
      [w, h] = fixedSize;
    } else {
      const d = Math.min(dpr, T.maxDpr) * renderScale;
      w = Math.max(2, Math.round(cssW * d));
      h = Math.max(2, Math.round(cssH * d));
      const px = w * h;
      if (px > T.maxPixels) {
        const k = Math.sqrt(T.maxPixels / px);
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    width = w;
    height = h;
    post.resize(w, h, T.samples);
  }

  function computeCamera(frame) {
    const c = frame.camera;
    const aspect = width / height;
    let fov = c.fov;
    if (c.portraitFov) {
      const k = clamp((1.6 - aspect) / 1.1);
      fov = lerp(c.fov, c.portraitFov, Math.pow(k, 1.1));
    }
    cam.fov = fov;
    cam.aspect = aspect;
    m4.perspective(cam.proj, fov * DEG, aspect, 0.1, 3000);
    m4.lookAt(cam.view, c.pos, c.target, c.up);
    if (c.roll) {
      m4.identity(roll);
      const cs = Math.cos(c.roll), sn = Math.sin(c.roll);
      roll[0] = cs; roll[1] = sn; roll[4] = -sn; roll[5] = cs;
      m4.multiply(cam.view, roll, cam.view);
    }
    m4.multiply(cam.viewProj, cam.proj, cam.view);
    m4.invert(cam.invViewProj, cam.viewProj);
    cam.pos = c.pos;
    cam.res = [width, height];
    cam.pointScale = height / (2 * Math.tan((fov * DEG) / 2));
    cam.pxScale = height / 1080;
    const l = frame.particles.lightDir, v = cam.view;
    cam.sunDirView = [v[0] * l[0] + v[4] * l[1] + v[8] * l[2], v[1] * l[0] + v[5] * l[1] + v[9] * l[2], v[2] * l[0] + v[6] * l[1] + v[10] * l[2]];
    return cam;
  }

  function render(t) {
    const frame = director.evaluate(t);
    computeCamera(frame);
    post.begin();
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    sky.draw(frame, cam);
    gl.depthMask(true);
    globe.draw(frame, cam);
    boxes.draw(frame, cam, frame.boxData, frame.boxCount);
    stone.draw(frame, cam);
    particles.draw(frame, cam, post.samples > 0);
    billboards.draw(frame, cam);
    lines.draw(frame, cam);
    post.end(frame);
    return frame;
  }

  return {
    gl, cam, render, resize, fontsReady, duration: DURATION,
    get size() { return [width, height]; },
    get tier() { return tier; },
    get renderScale() { return renderScale; },
    set renderScale(v) { renderScale = clamp(v, 0.5, 1); },
    project(p) {
      // world -> CSS-relative [0..1] screen coords + visibility
      const v = m4.transform4(cam.viewProj, p);
      if (v[3] <= 0.001) return null;
      return [v[0] / v[3] * 0.5 + 0.5, 0.5 - v[1] / v[3] * 0.5, v[3]];
    },
  };
}
