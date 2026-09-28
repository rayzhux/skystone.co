// The film's typography and vector layer. Every element is a pure function of film time, like the
// WebGL scene underneath, so the whole reel can pause, scrub and export frame-exact.
import { clamp, ease, lerp } from './math.js';
import { ROUTE_KM } from './world.js';

const E = ease;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Split a line of text into letter spans inside a masking line box. */
function lettersLine(parent, text, cls = '') {
  const line = el('span', 'fl-line ' + cls, parent);
  const inner = el('span', 'fl-inner', line);
  const letters = [];
  for (const ch of text) {
    const s = el('span', 'fl-ch', inner, ch === ' ' ? ' ' : ch);
    letters.push(s);
  }
  return { line, inner, letters };
}

// Titles: [start, end, lines, class, position]
const TITLES = [
  { id: 'two', start: 1.3, end: 3.9, lines: ['Two skies.'], cls: 't-serif t-xl', pos: 'pos-horizon-1' },
  { id: 'one', start: 2.15, end: 3.9, lines: ['One standard.'], cls: 't-serif t-xl t-italic', pos: 'pos-horizon-2' },
  { id: 'sub-inv', start: 9.3, end: 11.85, kicker: '01 — Investment', lines: ['Capital deployment, underwriting, structuring.'], cls: 't-sub', pos: 'pos-sub', mode: 'wipe' },
  { id: 'sub-ins', start: 14.3, end: 15.9, kicker: '02 — Insights', lines: ['Position papers, partner shortlists, a clear go / no-go.'], cls: 't-sub', pos: 'pos-sub', mode: 'wipe' },
  { id: 'impl', start: 17.4, end: 19.95, lines: ['IMPLEMENTATION'], cls: 't-caps t-caps-xl', pos: 'pos-impl', mode: 'drop' },
  { id: 'sub-imp', start: 18.9, end: 19.95, kicker: '03 — Implementation', lines: ['Owner’s representation, first agreement to delivery.'], cls: 't-sub', pos: 'pos-sub', mode: 'wipe' },
  { id: 'd1', start: 20.02, end: 20.97, lines: ['REAL ESTATE', '& CONSTRUCTION'], cls: 't-caps t-caps-xl', pos: 'pos-left', mode: 'slam', count: '01' },
  { id: 'd2', start: 21.02, end: 21.97, lines: ['Artificial', 'Intelligence'], cls: 't-serif t-xl t-italic', pos: 'pos-center', mode: 'rise', count: '02' },
  { id: 'd3', start: 22.02, end: 22.97, lines: ['ADVANCED', 'MANUFACTURING'], cls: 't-caps t-caps-wide', pos: 'pos-bottom', mode: 'track', count: '03' },
  { id: 'w1', start: 26.5, end: 27.92, lines: ['Investment.'], cls: 't-serif t-l', pos: 'pos-stack-1', mode: 'pop' },
  { id: 'w2', start: 27.0, end: 27.92, lines: ['Insights.'], cls: 't-serif t-l t-italic', pos: 'pos-stack-2', mode: 'pop' },
  { id: 'w3', start: 27.5, end: 27.92, lines: ['Implementation.'], cls: 't-serif t-l', pos: 'pos-stack-3', mode: 'pop' },
];

const CARDS = [
  { start: 23.0, end: 23.5, lines: ['Investment', 'Advisory'], cls: 'card-bone', text: 't-serif t-xl', count: '04' },
  { start: 23.5, end: 24.0, lines: ['IMPLEMENTATION', '& OVERSIGHT'], cls: 'card-apricot', text: 't-caps t-caps-xl', count: '05' },
  { start: 24.0, end: 24.5, lines: ['Strategic', 'Insights'], cls: 'card-ink', text: 't-serif t-xl t-italic', count: '06' },
];

const STAGES = [
  { n: 'I', name: 'Initial consultation', note: '90 minutes. No charge.' },
  { n: 'II', name: 'Position paper', note: 'Opportunity, structure, shortlist, go / no-go.' },
  { n: 'III', name: 'Diligence & partner engagement', note: 'Partners in early, terms locked.' },
  { n: 'IV', name: 'Implementation & oversight', note: 'On the ground, through delivery.' },
];

export function createOverlay(root) {
  root.innerHTML = '';
  const vector = el('canvas', 'film-vector', root);
  const g = vector.getContext('2d');
  const titlesEl = el('div', 'film-titles', root);
  const cardsEl = el('div', 'film-cards', root);

  // titles
  const titles = TITLES.map((T) => {
    const box = el('div', `ft ${T.cls} ${T.pos}`, titlesEl);
    let kicker = null;
    if (T.kicker) kicker = el('div', 'ft-kicker', box, T.kicker);
    // wiped subtitles stay real text so they can wrap; everything else is split into letters
    const lines = T.mode === 'wipe' ? (T.lines.forEach((l) => el('div', 'ft-plain', box, l)), []) : T.lines.map((l) => lettersLine(box, l));
    let count = null;
    if (T.count) {
      count = el('div', 'ft-count', box);
      el('span', 'ft-count-n', count, T.count);
      el('span', 'ft-count-of', count, ' / 06');
    }
    box.style.display = 'none';
    return { ...T, box, kicker, lines, count, shown: false };
  });

  // full-frame cards
  const cards = CARDS.map((C) => {
    const box = el('div', `fcard ${C.cls}`, cardsEl);
    const inner = el('div', `fcard-text ${C.text}`, box);
    const lines = C.lines.map((l) => lettersLine(inner, l));
    const count = el('div', 'ft-count', box);
    el('span', 'ft-count-n', count, C.count);
    el('span', 'ft-count-of', count, ' / 06');
    box.style.display = 'none';
    return { ...C, box, inner, lines, shown: false };
  });

  // route labels + counter
  const labDubai = el('div', 'anchor-label', titlesEl);
  el('div', 'al-name', labDubai, 'Dubai');
  el('div', 'al-coord', labDubai, '25.2048° N · 55.2708° E');
  const labSha = el('div', 'anchor-label al-right', titlesEl);
  el('div', 'al-name', labSha, 'Shanghai');
  el('div', 'al-coord', labSha, '31.2304° N · 121.4737° E');
  const counter = el('div', 'route-counter', titlesEl);
  const counterNum = el('div', 'rc-num', counter, '0');
  el('div', 'rc-unit', counter, 'km, Dubai to Shanghai');
  const counterPlus = el('div', 'rc-plus', counter, 'Shanghai runs four hours ahead.');
  [labDubai, labSha, counter].forEach((x) => (x.style.display = 'none'));

  // stages
  const stageBox = el('div', 'stages', titlesEl);
  const stageNum = el('div', 'stage-num', stageBox);
  const stageName = el('div', 'stage-name', stageBox);
  const stageNote = el('div', 'stage-note', stageBox);
  const stageKicker = el('div', 'stage-kicker', stageBox, 'Four stages');
  stageBox.style.display = 'none';

  // six disciplines rail
  const rail = el('div', 'disc-rail', titlesEl);
  el('div', 'disc-rail-label', rail, 'Six disciplines');
  const railBar = el('div', 'disc-rail-bar', rail);
  const railSegs = Array.from({ length: 6 }, () => el('i', '', railBar));
  rail.style.display = 'none';

  // the end card
  const endCard = el('div', 'endcard', titlesEl);
  const wordmark = el('div', 'endcard-mark', endCard);
  const markLetters = lettersLine(wordmark, 'Skystone', 'mark-line');
  const sun = el('span', 'endcard-sun', wordmark);
  const endLine = el('div', 'endcard-line t-serif t-italic', endCard, 'Investment. Insights. Implementation.');
  const endMeta = el('div', 'endcard-meta', endCard, 'Private China–Gulf advisory · Dubai');
  endCard.style.display = 'none';

  let W = 1, H = 1, dpr = 1;
  function resize(w, h, d) {
    W = w; H = h; dpr = Math.min(d || 1, 2);
    vector.width = Math.round(w * dpr);
    vector.height = Math.round(h * dpr);
  }

  const show = (o, on) => {
    if (o.shown !== on) {
      (o.box || o).style.display = on ? '' : 'none';
      o.shown = on;
    }
  };
  const vis = (node, on) => {
    const v = on ? '' : 'none';
    if (node.style.display !== v) node.style.display = v;
  };

  // letter animation modes
  function animLetters(T, t) {
    const inT = t - T.start, outT = t - (T.end - 0.32);
    const mode = T.mode || 'rise';
    let idx = 0;
    T.lines.forEach((L, li) => {
      const n = L.letters.length;
      L.letters.forEach((s, i) => {
        const k = idx++;
        let y = 0, o = 1, sc = 1, extra = '';
        if (mode === 'rise' || mode === 'pop') {
          const a = E.outExpo(clamp((inT - k * 0.028 - li * 0.08) / 0.9));
          y = (1 - a) * 105;
          if (mode === 'pop') { sc = lerp(1.18, 1, E.outBack(clamp(inT / 0.35))); y = (1 - E.outExpo(clamp(inT / 0.3))) * 40; }
          const b = E.inExpo(clamp((outT - k * 0.012) / 0.32));
          y -= b * 105;
        } else if (mode === 'slam') {
          const a = E.outExpo(clamp((inT - li * 0.06 - k * 0.008) / 0.4));
          y = (1 - a) * 105;
          const b = clamp((outT - 0.2) / 0.1);
          o = 1 - b;
        } else if (mode === 'track') {
          const a = E.outExpo(clamp((inT - k * 0.012) / 0.6));
          o = a;
          extra = `translateX(${(1 - a) * (i - n / 2) * 0.35}em)`;
          const b = clamp((outT - 0.2) / 0.1);
          o *= 1 - b;
        } else if (mode === 'drop') {
          // each letter lands with its floor slab
          const ts = 17.55 + k * 0.125 - T.start;
          const a = E.outBack(clamp((inT - ts) / 0.24));
          y = (1 - a) * -120;
          o = clamp((inT - ts) / 0.06);
          const b = E.inExpo(clamp((outT - k * 0.01) / 0.3));
          y += b * 105;
        } else if (mode === 'wipe') {
          y = 0;
        }
        s.style.transform = `translate3d(0, ${y.toFixed(2)}%, 0) ${extra} scale(${sc.toFixed(3)})`;
        s.style.opacity = o.toFixed(3);
      });
    });
    if (mode === 'wipe') {
      const a = E.outExpo(clamp(inT / 0.9));
      const b = E.inExpo(clamp(outT / 0.32));
      T.box.style.clipPath = `inset(0 ${((1 - a) * 100).toFixed(2)}% 0 ${(b * 100).toFixed(2)}%)`;
    }
    if (T.kicker) {
      const a = E.outExpo(clamp(inT / 0.6));
      T.kicker.style.opacity = a.toFixed(3);
    }
  }

  function update(t, frame, film) {
    // ---- titles
    for (const T of titles) {
      const on = t >= T.start && t < T.end;
      show(T, on);
      if (on) animLetters(T, t);
    }
    // ---- cards
    for (const C of cards) {
      const on = t >= C.start && t < C.end;
      show(C, on);
      if (on) {
        const k = E.outExpo(clamp((t - C.start) / 0.22));
        C.inner.style.transform = `scale(${lerp(1.12, 1, k).toFixed(4)})`;
        C.lines.forEach((L, li) => L.letters.forEach((s, i) => {
          const a = E.outExpo(clamp((t - C.start - li * 0.04 - i * 0.006) / 0.3));
          s.style.transform = `translate3d(0, ${((1 - a) * 100).toFixed(1)}%, 0)`;
        }));
      }
    }
    // ---- route labels + counter
    const routeOn = t >= 5.7 && t < 8.0;
    vis(labDubai, routeOn && frame.anchors.dubai);
    vis(labSha, routeOn && t >= 7.35 && frame.anchors.shanghai);
    vis(counter, routeOn);
    if (routeOn) {
      const pd = frame.anchors.dubai && film.project(frame.anchors.dubai);
      if (pd) {
        labDubai.style.transform = `translate(${(pd[0] * W).toFixed(1)}px, ${(pd[1] * H).toFixed(1)}px)`;
        labDubai.style.opacity = E.outExpo(clamp((t - 5.85) / 0.5)).toFixed(3);
      }
      const ps = frame.anchors.shanghai && film.project(frame.anchors.shanghai);
      if (ps) {
        labSha.style.transform = `translate(${(ps[0] * W).toFixed(1)}px, ${(ps[1] * H).toFixed(1)}px)`;
        labSha.style.opacity = E.outExpo(clamp((t - 7.4) / 0.4)).toFixed(3);
      }
      const tr = frame.hud.trim ?? 0;
      counterNum.textContent = fmt(ROUTE_KM * tr);
      counter.style.opacity = (E.outExpo(clamp((t - 5.8) / 0.4)) * (1 - clamp((t - 7.85) / 0.15))).toFixed(3);
      counterPlus.style.opacity = E.outExpo(clamp((t - 7.1) / 0.5)).toFixed(3);
    }
    // ---- stages
    const stOn = t >= 24.5 && t < 26.5;
    vis(stageBox, stOn);
    if (stOn) {
      const i = Math.min(3, Math.floor((t - 24.5) / 0.5));
      const S = STAGES[i];
      if (stageNum.textContent !== S.n) {
        stageNum.textContent = S.n; stageName.textContent = S.name; stageNote.textContent = S.note;
      }
      const lt = (t - 24.5) - i * 0.5;
      const a = E.outExpo(clamp(lt / 0.22));
      stageNum.style.transform = `scale(${lerp(1.3, 1, a).toFixed(4)})`;
      stageNum.style.opacity = a.toFixed(3);
      stageName.style.opacity = E.outExpo(clamp((lt - 0.05) / 0.25)).toFixed(3);
      stageNote.style.opacity = E.outExpo(clamp((lt - 0.1) / 0.25)).toFixed(3);
    }
    // ---- disciplines rail
    const railOn = t >= 20 && t < 24.5;
    vis(rail, railOn);
    if (railOn) {
      const k = Math.floor((t - 20) < 3 ? (t - 20) : 3 + (t - 23) / 0.5);
      railSegs.forEach((s, i) => s.classList.toggle('on', i <= k));
      rail.classList.toggle('on-card', t >= 23);
    }
    // ---- end card
    const endOn = t >= 32.8 && t < 39.6;
    vis(endCard, endOn);
    if (endOn) {
      const n = markLetters.letters.length;
      markLetters.letters.forEach((s, i) => {
        const a = E.outExpo(clamp((t - 32.85 - i * 0.055) / 1.1));
        const b = E.inCubic(clamp((t - 38.6 - (n - i) * 0.02) / 0.6));
        s.style.transform = `translate3d(0, ${((1 - a) * 105 + b * 30).toFixed(2)}%, 0)`;
        s.style.opacity = (1 - b).toFixed(3);
      });
      const sp = E.outBack(clamp((t - 33.55) / 0.5));
      const sb = clamp((t - 38.7) / 0.5);
      sun.style.transform = `scale(${(sp * (1 - sb)).toFixed(3)})`;
      endLine.style.opacity = (E.outExpo(clamp((t - 33.9) / 0.9)) * (1 - clamp((t - 38.5) / 0.5))).toFixed(3);
      endLine.style.transform = `translate3d(0, ${((1 - E.outExpo(clamp((t - 33.9) / 0.9))) * 14).toFixed(2)}px, 0)`;
      endMeta.style.opacity = (E.outExpo(clamp((t - 34.4) / 0.9)) * (1 - clamp((t - 38.5) / 0.5))).toFixed(3);
    }

    drawVector(t, frame, film);
  }

  // ---------------------------------------------------------------- vector layer
  const BONE = 'rgba(243,238,230,', APR = 'rgba(246,169,100,';
  function ring(x, y, r, a, w = 1, col = BONE) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.strokeStyle = col + a + ')';
    g.lineWidth = w;
    g.stroke();
  }
  function drawVector(t, frame, film) {
    const s = dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, vector.width, vector.height);
    g.setTransform(s, 0, 0, s, 0, 0);
    const P = (p) => { const q = film.project(p); return q ? [q[0] * W, q[1] * H] : null; };

    // route markers
    if (t >= 5.7 && t < 8.0) {
      const draw = (anchor, t0) => {
        const q = anchor && P(anchor);
        if (!q || t < t0) return;
        const k = clamp((t - t0) / 1.0);
        ring(q[0], q[1], 3, 0.95, 1.5, APR);
        ring(q[0], q[1], 6 + E.outExpo(k) * 26, (1 - k) * 0.8, 1, APR);
        ring(q[0], q[1], 10, 0.5 * E.outExpo(clamp((t - t0) / 0.4)), 1);
      };
      draw(frame.anchors.dubai, 5.9);
      draw(frame.anchors.shanghai, 7.55);
    }

    // dimension line on the project tower
    const tw = frame.anchors.tower;
    if (tw && t >= 17.2 && t < 20.0) {
      const a = E.outExpo(clamp((t - 17.3) / 0.6)) * (1 - clamp((t - 19.8) / 0.2));
      const x = tw.w / 2 + 4.5;
      const base = P([x, 0, tw.d / 2]);
      const top = P([x, tw.height, tw.d / 2]);
      if (base && top) {
        g.strokeStyle = BONE + (0.7 * a) + ')';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(base[0], base[1]); g.lineTo(top[0], top[1]); g.stroke();
        g.font = `500 ${Math.max(9, Math.round(H / 90))}px "JetBrains Mono", ui-monospace, monospace`;
        g.textBaseline = 'middle';
        let done = 0;
        (tw.floors || []).forEach((f, i) => {
          if (f <= 0) return;
          done = i + 1;
          const q = P([x, (i + 1) * tw.floorH, tw.d / 2]);
          if (!q) return;
          g.strokeStyle = APR + (0.9 * a * f) + ')';
          g.beginPath(); g.moveTo(q[0] - 5, q[1]); g.lineTo(q[0] + 5, q[1]); g.stroke();
          if (i % 2 === 1 || i === tw.floors.length - 1) {
            g.fillStyle = BONE + (0.75 * a * f) + ')';
            g.fillText(`+${((i + 1) * tw.floorH).toFixed(2)}`, q[0] + 10, q[1]);
          }
        });
        if (done) {
          const q = P([x, done * tw.floorH, tw.d / 2]);
          if (q) {
            g.fillStyle = APR + a + ')';
            g.font = `600 ${Math.max(11, Math.round(H / 64))}px "JetBrains Mono", ui-monospace, monospace`;
            g.fillText(`${(done * tw.floorH).toFixed(2)} m`, q[0] + 10, q[1] - Math.max(14, H / 40));
          }
        }
      }
    }

    // gear rings for advanced manufacturing
    if (t >= 22.0 && t < 23.0 && frame.anchors.tower) {
      const c = P([0, 22, 0]);
      if (c) {
        const a = E.outExpo(clamp((t - 22.0) / 0.3)) * (1 - clamp((t - 22.9) / 0.1));
        const R = Math.min(W, H) * 0.34;
        [[1, 60, 1], [0.8, 36, -1.6], [0.62, 24, 2.4]].forEach(([k, n, sp]) => {
          const r = R * k;
          ring(c[0], c[1], r, 0.45 * a);
          const rot = (t - 22) * sp;
          g.strokeStyle = APR + (0.8 * a) + ')';
          g.beginPath();
          for (let i = 0; i < n; i++) {
            const ang = rot + (i / n) * Math.PI * 2;
            const r2 = r + (i % 5 === 0 ? 9 : 5);
            g.moveTo(c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r);
            g.lineTo(c[0] + Math.cos(ang) * r2, c[1] + Math.sin(ang) * r2);
          }
          g.stroke();
        });
      }
    }

    // four-stage track
    if (t >= 24.5 && t < 26.6) {
      const a = E.outExpo(clamp((t - 24.5) / 0.3)) * (1 - clamp((t - 26.45) / 0.15));
      const x0 = W * 0.18, x1 = W * 0.82, y = H * 0.8;
      const seg4 = (x1 - x0) / 4;
      for (let i = 0; i < 4; i++) {
        const on = t >= 24.5 + i * 0.5;
        g.fillStyle = (on ? APR : BONE) + ((on ? 0.9 : 0.18) * a) + ')';
        g.fillRect(x0 + i * seg4 + 2, y - 3, seg4 - 4, 6);
      }
      const ph = x0 + (x1 - x0) * clamp((t - 24.5) / 2);
      g.fillStyle = BONE + a + ')';
      g.fillRect(ph - 0.5, y - 16, 1, 32);
      g.font = `500 ${Math.max(10, Math.round(H / 80))}px "JetBrains Mono", ui-monospace, monospace`;
      g.textBaseline = 'top';
      ['I', 'II', 'III', 'IV'].forEach((n, i) => {
        g.fillStyle = BONE + (0.6 * a) + ')';
        g.fillText(n, x0 + i * seg4 + 2, y + 12);
      });
    }
  }

  return { resize, update, root };
}
