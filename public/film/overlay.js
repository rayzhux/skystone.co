// The film's typography, keyed to the same clock as the picture, so the whole film can pause, scrub and export
// frame-exact. One two-line title per discipline, lower left; the mark at the end.
import { clamp, ease, lerp } from './math.js';

const E = ease;

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** A line of text split into letters inside a masking line box. */
function lettersLine(parent, text, cls = '') {
  const line = el('span', 'fl-line ' + cls, parent);
  const inner = el('span', 'fl-inner', line);
  const letters = [];
  for (const ch of text) letters.push(el('span', 'fl-ch', inner, ch === ' ' ? ' ' : ch));
  return { line, inner, letters };
}

const TITLES = [
  { n: '01', a: 'Investment', b: 'Advisory', start: 1.62, end: 3.4 },
  { n: '02', a: 'Management', b: 'Consulting', start: 3.62, end: 5.4 },
  { n: '03', a: 'Programme', b: 'Management', start: 5.62, end: 7.4 },
  { n: '04', a: 'Implementation', b: '& Oversight', start: 7.62, end: 9.4 },
  { n: '05', a: 'Strategic', b: 'Insights', start: 9.62, end: 11.4 },
];

export function createOverlay(root) {
  root.innerHTML = '';
  const layer = el('div', 'film-titles', root);

  // the name, once, as the light comes up (shown in the exported film; the page has its own title)
  const open = el('div', 'ft ft-open', layer, 'Skystone Partners');
  open.style.display = 'none';

  const titles = TITLES.map((T) => {
    const box = el('div', 'ft ft-chapter', layer);
    const count = el('div', 'ft-count', box);
    el('span', 'ft-count-n', count, T.n);
    el('span', 'ft-count-of', count, ' / 05');
    const lines = [lettersLine(box, T.a, 't-ch t-ch-a'), lettersLine(box, T.b, 't-ch t-ch-b')];
    const rule = el('i', 'ft-rule', box);
    box.style.display = 'none';
    return { ...T, box, count, lines, rule, shown: false };
  });

  const endCard = el('div', 'endcard', layer);
  const wordmark = el('div', 'endcard-mark', endCard);
  const mark = lettersLine(wordmark, 'Skystone', 'mark-line');
  const sun = el('span', 'endcard-sun', wordmark);
  const endLine = el('div', 'endcard-line', endCard, 'Investment. Insights. Implementation.');
  const endMeta = el('div', 'endcard-meta', endCard, 'Advisory · Dubai');
  endCard.style.display = 'none';

  const vis = (node, on) => {
    const v = on ? '' : 'none';
    if (node.style.display !== v) node.style.display = v;
  };
  const rise = (y) => `translate3d(0, ${y.toFixed(2)}%, 0)`;

  function update(t) {
    // the opening name
    const openOn = t >= 0.45 && t < 1.45;
    vis(open, openOn);
    if (openOn) {
      const a = E.outCubic(clamp((t - 0.45) / 0.5)) * (1 - E.inCubic(clamp((t - 1.15) / 0.3)));
      open.style.opacity = a.toFixed(3);
      open.style.letterSpacing = `${lerp(0.5, 0.32, E.outCubic(clamp((t - 0.45) / 1.0))).toFixed(3)}em`;
    }

    // chapter titles: letters rise in on the downbeat and lift out just before the next one
    for (const T of titles) {
      const on = t >= T.start && t < T.end;
      if (T.shown !== on) { vis(T.box, on); T.shown = on; }
      if (!on) continue;
      const inT = t - T.start, outT = t - (T.end - 0.3);
      let k = 0;
      T.lines.forEach((L, li) => {
        L.letters.forEach((s) => {
          const a = E.outExpo(clamp((inT - li * 0.07 - k * 0.016) / 0.75));
          const b = E.inExpo(clamp((outT - k * 0.008) / 0.3));
          s.style.transform = rise((1 - a) * 105 - b * 105);
          k++;
        });
      });
      T.count.style.opacity = (E.outCubic(clamp(inT / 0.4)) * (1 - clamp(outT / 0.2))).toFixed(3);
      T.rule.style.transform = `scaleX(${clamp((t - T.start) / (T.end - T.start)).toFixed(4)})`;
      T.rule.style.opacity = (1 - clamp(outT / 0.25)).toFixed(3);
    }

    // the mark
    const endOn = t >= 12.5 && t < 14.99;
    vis(endCard, endOn);
    if (endOn) {
      const n = mark.letters.length;
      mark.letters.forEach((s, i) => {
        const a = E.outExpo(clamp((t - 12.55 - i * 0.045) / 1.0));
        const b = E.inCubic(clamp((t - 14.3 - (n - i) * 0.015) / 0.5));
        s.style.transform = rise((1 - a) * 105 + b * 30);
        s.style.opacity = (1 - b).toFixed(3);
      });
      const sp = E.outBack(clamp((t - 13.05) / 0.45));
      sun.style.transform = `scale(${(sp * (1 - clamp((t - 14.4) / 0.4))).toFixed(3)})`;
      const up = E.outExpo(clamp((t - 13.2) / 0.9));
      endLine.style.opacity = (up * (1 - clamp((t - 14.3) / 0.45))).toFixed(3);
      endLine.style.transform = `translate3d(0, ${((1 - up) * 14).toFixed(2)}px, 0)`;
      endMeta.style.opacity = (E.outExpo(clamp((t - 13.5) / 0.9)) * (1 - clamp((t - 14.3) / 0.45))).toFixed(3);
    }
  }

  return { resize() {}, update, root };
}
