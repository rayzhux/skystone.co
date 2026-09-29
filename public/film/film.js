// The film engine: owns the GL context and every renderer, and turns director frames into pixels. Each frame is
// evaluated twice, now and a shutter-interval earlier, so every particle is drawn with true motion blur.
import { createContext } from './gl.js';
import { m4, clamp, lerp, DEG } from './math.js';
import { createField } from './field.js';
import { createBackdrop } from './backdrop.js';
import { createLines, createLineSet, polylineSegs } from './lines.js';
import { createPost } from './post.js';
import { createDirector, lineSets, DURATION } from './director.js';

export function detectTier() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  if (coarse || cores <= 4 || mem <= 4) return 'low';
  if (cores <= 8) return 'medium';
  return 'high';
}

const TIERS = {
  high: { side: 512, maxDpr: 1.75, maxPixels: 2.6e6 },
  medium: { side: 384, maxDpr: 1.5, maxPixels: 2.0e6 },
  low: { side: 256, maxDpr: 1.6, maxPixels: 1.3e6 },
  export: { side: 768, maxDpr: 1, maxPixels: 1e9 },
};

export async function createFilm(canvas, { tier = detectTier(), fixedSize = null, side = null } = {}) {
  const gl = createContext(canvas);
  if (!gl) throw new Error('webgl2-unavailable');
  if (!gl.ext.floatRT && !gl.ext.halfRT) throw new Error('float-targets-unavailable');
  const T = TIERS[tier] || TIERS.medium;

  const backdrop = createBackdrop(gl);
  const field = createField(gl, { side: side || T.side });
  const lines = createLines(gl);
  const post = createPost(gl);
  const L = lineSets();
  lines.add('horizon', createLineSet(gl, polylineSegs(L.horizon)));
  lines.add('ring', createLineSet(gl, polylineSegs(L.ring)));
  lines.add('lattice', createLineSet(gl, L.lattice));
  lines.add('strands', createLineSet(gl, L.strands.flatMap((pl, i) => polylineSegs(pl, 0, i * 0.37))));
  lines.add('wave', createLineSet(gl, polylineSegs(L.wave)));
  const director = createDirector();

  const mkCam = () => ({
    view: m4.create(), proj: m4.create(), viewProj: m4.create(), invViewProj: m4.create(),
    pos: [0, 0, 0], res: [1, 1], pointScale: 1, pxScale: 1, fov: 36, aspect: 1,
  });
  const cam = mkCam(), camPrev = mkCam();
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
    post.resize(w, h);
  }

  function computeCamera(frame, c) {
    const k = frame.camera;
    const aspect = width / height;
    let fov = k.fov;
    if (k.portraitFov) fov = lerp(k.fov, k.portraitFov, Math.pow(clamp((1.6 - aspect) / 1.1), 1.1));
    c.fov = fov;
    c.aspect = aspect;
    m4.perspective(c.proj, fov * DEG, aspect, 0.1, 500);
    // composition: a lens shift that makes room for the titles (up and right on wide frames, up on tall ones)
    if (k.shift) {
      const wide = clamp((aspect - 0.7) / 0.9);
      c.proj[8] -= k.shift[0] * wide;
      c.proj[9] -= k.shift[1] * (1 + (1 - wide) * 1.4);
    }
    m4.lookAt(c.view, k.pos, k.target, k.up);
    if (k.roll) {
      m4.identity(roll);
      const cs = Math.cos(k.roll), sn = Math.sin(k.roll);
      roll[0] = cs; roll[1] = sn; roll[4] = -sn; roll[5] = cs;
      m4.multiply(c.view, roll, c.view);
    }
    m4.multiply(c.viewProj, c.proj, c.view);
    m4.invert(c.invViewProj, c.viewProj);
    c.pos = k.pos;
    c.res = [width, height];
    c.pointScale = height / (2 * Math.tan((fov * DEG) / 2));
    c.pxScale = height / 1080;
    return c;
  }
  const uvOf = (p, c) => {
    const v = m4.transform4(c.viewProj, p);
    if (v[3] <= 0.001) return null;
    return [(v[0] / v[3]) * 0.5 + 0.5, (v[1] / v[3]) * 0.5 + 0.5];
  };

  function draw(frame, prev) {
    computeCamera(frame, cam);
    computeCamera(prev, camPrev);
    frame.post.sunUv = frame.anchors.sun ? uvOf(frame.anchors.sun, cam) : null;
    frame.backdrop.glowUv = uvOf(frame.backdrop.glowWorld, cam);
    field.simulate(frame, prev);
    post.begin();
    backdrop.draw(frame, cam);
    lines.draw(frame, cam);
    field.draw(frame, cam, camPrev);
  }
  const pair = (t, shutter = null) => {
    const frame = director.evaluate(t);
    return [frame, director.evaluate(t - (shutter ?? frame.field.shutter))];
  };

  function render(t) {
    const [frame, prev] = pair(t);
    draw(frame, prev);
    post.end(frame);
    return frame;
  }

  // a long exposure for stills: many sub-frames summed in HDR (the trails), plus the last one again (the heads).
  // A still can frame its own shot: camera, field and grade overrides apply to every sub-frame.
  function renderStill(t, { span = 0.25, samples = 24, head = 0.55, camera = null, field = null, post: grade = null, lines: keepLines = true } = {}) {
    const dress = (f) => {
      if (!keepLines) f.lines = [];
      if (camera) Object.assign(f.camera, camera);
      if (field) Object.assign(f.field, field);
      if (grade) Object.assign(f.post, grade);
      return f;
    };
    post.accumReset();
    let last = null;
    // each sub-frame's shutter covers exactly its slice of the exposure, so trails are continuous
    for (let i = 0; i < samples; i++) {
      const [frame, prev] = pair(t - span + (span * (i + 1)) / samples, span / samples).map(dress);
      draw(frame, prev);
      post.accumAdd((1 - head) / samples);
      last = frame;
    }
    post.accumAdd(head);
    post.endAccum(last);
    return last;
  }

  return {
    gl, cam, render, renderStill, resize, duration: DURATION,
    fontsReady: document.fonts ? document.fonts.ready : Promise.resolve(),
    particles: field.N,
    get size() { return [width, height]; },
    get tier() { return tier; },
    get renderScale() { return renderScale; },
    set renderScale(v) { renderScale = clamp(v, 0.5, 1); },
    project(p) {
      const v = m4.transform4(cam.viewProj, p);
      if (v[3] <= 0.001) return null;
      return [(v[0] / v[3]) * 0.5 + 0.5, 0.5 - (v[1] / v[3]) * 0.5, v[3]];
    },
  };
}
