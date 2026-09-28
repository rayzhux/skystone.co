// Site behaviour outside the film: nav, reveals, counters, clocks, office hours, process playhead,
// the frame strip and the contact plate. One rAF-throttled scroll handler drives everything scroll-linked.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------- nav
const nav = $('[data-nav]');
const menuBtn = $('.nav-menu');
menuBtn?.addEventListener('click', () => {
  const open = !nav.classList.contains('is-open');
  nav.classList.toggle('is-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.textContent = open ? 'Close' : 'Menu';
});
$$('.nav-links a').forEach((a) => a.addEventListener('click', () => {
  if (!nav.classList.contains('is-open')) return;
  nav.classList.remove('is-open');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.textContent = 'Menu';
}));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && nav.classList.contains('is-open')) menuBtn.click();
});

// ---------------------------------------------------------------- reveals + counters
const countUp = (el) => {
  const target = +el.dataset.count;
  if (reduce || !target) return;
  const start = performance.now(), dur = 1400;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const tick = (now) => {
    const k = clamp((now - start) / dur);
    const e = k >= 1 ? 1 : 1 - Math.pow(2, -10 * k);
    el.textContent = fmt(target * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  el.textContent = '0';
  requestAnimationFrame(tick);
};
const reveals = $$('.reveal');
const groups = new Map();
reveals.forEach((el) => {
  const p = el.parentElement;
  const i = groups.get(p) || 0;
  groups.set(p, i + 1);
  el.style.setProperty('--d', `${Math.min(i, 6) * 90}ms`);
});
if ('IntersectionObserver' in window && !reduce) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      $$('[data-count]', en.target).forEach(countUp);
      io.unobserve(en.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
  reveals.forEach((el) => io.observe(el));
  // never strand content: anything still hidden after a long idle gets shown
  setTimeout(() => reveals.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) el.classList.add('is-in');
  }), 2500);
} else {
  reveals.forEach((el) => el.classList.add('is-in'));
}
window.addEventListener('beforeprint', () => reveals.forEach((el) => el.classList.add('is-in')));

// ---------------------------------------------------------------- clocks + office hours (Dubai, GST)
const timeIn = (tz) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { hm: `${get('hour')}:${get('minute')}`, h: +get('hour'), m: +get('minute'), wd: get('weekday') };
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function tickClocks() {
  $$('[data-clock]').forEach((el) => { el.textContent = timeIn(el.dataset.clock).hm; });
  const office = $('[data-office]');
  if (!office) return;
  const d = timeIn('Asia/Dubai');
  const day = DAYS.indexOf(d.wd);
  const mins = d.h * 60 + d.m;
  const workday = day >= 0 && day <= 4;
  const open = workday && mins >= 9 * 60 && mins < 18 * 60;
  office.classList.toggle('is-open', open);
  if (open) {
    office.textContent = `Open now · ${d.hm} in Dubai`;
  } else {
    let next = 'tomorrow';
    if (workday && mins < 9 * 60) next = 'today';
    else if (day === 4 || day === 5) next = 'Sunday';
    else if (day === 6) next = 'tomorrow';
    office.textContent = `Closed · ${d.hm} in Dubai · opens ${next} 09:00`;
  }
}
tickClocks();
setInterval(tickClocks, 20000);

// ---------------------------------------------------------------- copy address
const copyBtn = $('[data-copy]');
const copyStatus = $('.copy-status');
copyBtn?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(copyBtn.dataset.copy);
    copyStatus.textContent = 'Copied.';
  } catch {
    copyStatus.textContent = copyBtn.dataset.copy;
  }
  setTimeout(() => { copyStatus.textContent = ''; }, 2600);
});

// ---------------------------------------------------------------- scroll-linked: nav, process playhead, strip, plate
const practice = $('#practice');
const process = $('[data-process]');
const timeline = $('.timeline');
const stages = $$('.tl-stage');
const strip = $('[data-strip]');
const stripTrack = $('[data-strip-track]');
const contact = $('#contact');
if (coarse && strip) { strip.style.overflowX = 'auto'; strip.style.scrollSnapType = 'x mandatory'; }

let queued = false;
function onScroll() {
  queued = false;
  const vh = innerHeight;
  // nav turns solid once the sand has reached it
  if (practice) nav.classList.toggle('is-solid', practice.getBoundingClientRect().top <= 72);

  if (timeline && process) {
    const r = timeline.getBoundingClientRect();
    const p = clamp((vh * 0.82 - r.top) / (vh * 0.55));
    process.style.setProperty('--tl', p.toFixed(4));
    const idx = Math.min(3, Math.floor(p * 4 - 0.001));
    stages.forEach((s, i) => {
      s.classList.toggle('is-on', p > 0 && i <= Math.max(0, idx));
      s.classList.toggle('is-now', p > 0 && i === Math.max(0, idx));
    });
  }
  if (strip && stripTrack && !coarse && !reduce) {
    const r = strip.getBoundingClientRect();
    const max = Math.max(0, stripTrack.scrollWidth - strip.clientWidth);
    const p = clamp((vh - r.top) / (vh + r.height));
    stripTrack.style.setProperty('--strip', (p * max).toFixed(1));
  }
  if (contact && !reduce) {
    const r = contact.getBoundingClientRect();
    contact.style.setProperty('--plate', clamp((vh - r.top) / (vh + r.height)).toFixed(4));
  }
}
addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(onScroll); } }, { passive: true });
addEventListener('resize', onScroll);
onScroll();
