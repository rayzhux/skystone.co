// Boots the reel: engine + overlay + player controls. Renders only while the hero is on screen.
import { createFilm, detectTier } from './film.js';
import { createOverlay } from './overlay.js';
import { CHAPTERS, DURATION } from './director.js';

const FPS = 24;
const POSTER_T = 35.4;
const params = new URLSearchParams(location.search);
const EXPORT = params.has('export');
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

const root = document.getElementById('film');
if (root) boot().catch((e) => fail(e));

function fail(e) {
  console.warn('[film]', e && e.message ? e.message : e);
  root.classList.add('is-fallback');
  document.querySelector('.player')?.setAttribute('hidden', '');
  window.__film = { ready: true, failed: true };
}

async function boot() {
  const hero = root.closest('.hero');
  const canvas = root.querySelector('.film-canvas');
  const overlayRoot = root.querySelector('.film-overlay');
  const player = hero.querySelector('.player');
  const lockup = hero.querySelector('.hero-lockup');
  const practice = document.getElementById('practice');
  const q = (s) => player.querySelector(s);
  const btnPlay = q('[data-play]');
  const btnSound = q('[data-sound]');
  const soundLabel = btnSound.querySelector('.pl-sound-label');
  const track = q('[data-track]');
  const chaptersEl = q('[data-chapters]');
  const nowEl = q('[data-now]');
  const chapterEl = q('[data-chapter]');
  const coordsEl = q('[data-coords]');

  if (EXPORT) document.documentElement.classList.add('is-export');
  if (params.has('clean')) document.documentElement.classList.add('is-clean');

  const fixed = EXPORT ? [+(params.get('w') || 1920), +(params.get('h') || 1080)] : null;
  const film = await createFilm(canvas, { tier: EXPORT ? 'export' : detectTier(), fixedSize: fixed });
  const overlay = createOverlay(overlayRoot);

  let t = params.has('t') ? +params.get('t') : 0;
  let playing = !reduceMQ.matches && !params.has('pause') && !EXPORT;
  let inView = true, covered = false, docVisible = !document.hidden;
  let raf = 0, lastNow = 0, dirty = true;
  let audio = null, soundOn = false;
  let dragging = false;
  let slow = 0, fast = 0;
  let lastSecond = -1, lastChapter = -1;

  // chapter ticks
  CHAPTERS.forEach((c, i) => {
    const end = i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].t : DURATION;
    const seg = document.createElement('i');
    seg.style.setProperty('--d', (end - c.t).toFixed(2));
    const lab = document.createElement('span');
    lab.textContent = c.label;
    seg.appendChild(lab);
    chaptersEl.appendChild(seg);
  });
  const segs = [...chaptersEl.children];

  const tc = (sec) => {
    const s = Math.floor(sec), f = Math.floor((sec - s) * FPS);
    return `00:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };
  const chapterAt = (sec) => {
    let i = 0;
    for (let k = 0; k < CHAPTERS.length; k++) if (sec >= CHAPTERS[k].t) i = k;
    return i;
  };

  function size() {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    film.resize(w, h, window.devicePixelRatio || 1);
    overlay.resize(w, h, window.devicePixelRatio || 1);
    dirty = true;
    kick();
  }

  function updateUI(frame) {
    player.style.setProperty('--p', (t / DURATION).toFixed(4));
    nowEl.textContent = tc(t);
    const ci = chapterAt(t);
    if (ci !== lastChapter) {
      lastChapter = ci;
      chapterEl.textContent = `${String(ci + 1).padStart(2, '0')} · ${CHAPTERS[ci].label}`;
      segs.forEach((s, i) => s.classList.toggle('is-now', i === ci));
    }
    coordsEl.textContent = frame.hud.coords || 'Skystone Partners · Dubai';
    const sec = Math.floor(t);
    if (sec !== lastSecond) {
      lastSecond = sec;
      track.setAttribute('aria-valuenow', String(sec));
      track.setAttribute('aria-valuetext', `${sec} seconds, ${CHAPTERS[ci].label}`);
    }
    lockup.classList.toggle('is-quiet', t >= 32.5 && t < 39.7);
    document.documentElement.classList.toggle('film-light', t >= 23 && t < 24 && !covered);
  }

  // compile every pipeline during the calm opening seconds, one shot per frame, so no cut ever hitches
  const warm = EXPORT ? [] : [6.5, 9.5, 14.5, 18.5, 21.5, 22.5, 25.5, 29.0, 31.8, 34.0];
  function draw() {
    if (warm.length && t < 3.6) film.render(warm.shift());
    const frame = film.render(t);
    overlay.update(t, frame, film);
    if (!EXPORT) updateUI(frame);
    dirty = false;
    root.classList.add('is-live');
  }

  const active = () => inView && !covered && docVisible;

  function loop(now) {
    raf = 0;
    if (!active()) { lastNow = 0; return; }
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (playing && !dragging) {
      if (soundOn && audio) t = audio.time();
      else t = (t + dt) % DURATION;
      dirty = true;
    }
    if (dirty) draw();
    if (playing && dt > 0) adapt(dt);
    if (playing || dirty) raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf && active()) raf = requestAnimationFrame(loop);
  }

  // hold ~60fps: shed resolution when frames run long, win it back slowly
  function adapt(dt) {
    if (EXPORT) return;
    if (dt > 1 / 38) { slow++; fast = 0; } else if (dt < 1 / 55) { fast++; slow = Math.max(0, slow - 1); }
    if (slow > 40 && film.renderScale > 0.55) {
      film.renderScale = film.renderScale - 0.12;
      slow = 0;
      size();
    } else if (fast > 240 && film.renderScale < 1) {
      film.renderScale = film.renderScale + 0.06;
      fast = 0;
      size();
    }
  }

  // ---------------------------------------------------------------- controls
  function setPlaying(p) {
    playing = p;
    player.classList.toggle('is-paused', !p);
    btnPlay.setAttribute('aria-label', p ? 'Pause film' : 'Play film');
    root.classList.remove('is-poster');
    if (audio && soundOn) (p ? audio.play(t) : audio.pause());
    lastNow = 0;
    kick();
  }
  function seek(sec, { play } = {}) {
    t = ((sec % DURATION) + DURATION) % DURATION;
    if (audio && soundOn) audio.seek(t, playing && !dragging);
    root.classList.remove('is-poster');
    dirty = true;
    if (play !== undefined && play !== playing) setPlaying(play);
    kick();
  }
  btnPlay.addEventListener('click', () => setPlaying(!playing));

  btnSound.addEventListener('click', async () => {
    if (!soundOn) {
      btnSound.setAttribute('aria-busy', 'true');
      if (!audio) {
        const mod = await import('./audio.js');
        audio = mod.createScore();
      }
      soundOn = true;
      btnSound.removeAttribute('aria-busy');
      if (!playing) setPlaying(true);
      audio.play(t);
    } else {
      soundOn = false;
      audio.stop();
    }
    btnSound.setAttribute('aria-pressed', String(soundOn));
    soundLabel.textContent = soundOn ? 'Sound on' : 'Sound off';
  });

  const tAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return Math.min(DURATION - 0.001, Math.max(0, ((clientX - r.left) / r.width) * DURATION));
  };
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.classList.add('is-drag');
    track.setPointerCapture(e.pointerId);
    if (audio && soundOn) audio.pause();
    seek(tAt(e.clientX));
  });
  track.addEventListener('pointermove', (e) => { if (dragging) seek(tAt(e.clientX)); });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('is-drag');
    if (audio && soundOn && playing) audio.play(t);
    lastNow = 0;
    kick();
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('keydown', (e) => {
    const map = { ArrowLeft: -1, ArrowRight: 1, PageDown: -5, PageUp: 5 };
    if (e.key in map) { seek(t + map[e.key]); e.preventDefault(); }
    else if (e.key === 'Home') { seek(0); e.preventDefault(); }
    else if (e.key === 'End') { seek(DURATION - 0.05); e.preventDefault(); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || !inView || covered) return;
    const k = e.key.toLowerCase();
    if (k === 'k') setPlaying(!playing);
    else if (k === 'j') seek(t - 5);
    else if (k === 'l') seek(t + 5);
    else if (k === 'm') btnSound.click();
  });

  // links elsewhere on the page that jump into the film
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seek]');
    if (!b) return;
    const to = parseFloat(b.dataset.seek);
    window.scrollTo({ top: 0, behavior: reduceMQ.matches ? 'auto' : 'smooth' });
    seek(to, { play: true });
    btnPlay.focus({ preventScroll: true });
  });

  // ---------------------------------------------------------------- visibility + the practice section sliding over
  new IntersectionObserver((es) => { inView = es[0].isIntersecting; if (inView) { lastNow = 0; kick(); } }, { threshold: 0 }).observe(hero);
  document.addEventListener('visibilitychange', () => {
    docVisible = !document.hidden;
    if (audio && soundOn) (docVisible && playing ? audio.play(t) : audio.pause());
    lastNow = 0;
    kick();
  });
  let scrollQueued = false;
  function onScroll() {
    scrollQueued = false;
    if (!practice || EXPORT) return;
    const top = practice.getBoundingClientRect().top;
    const vh = window.innerHeight || 1;
    const cover = Math.min(1, Math.max(0, 1 - top / vh));
    root.style.setProperty('--cover', cover.toFixed(4));
    const was = covered;
    covered = top <= 0.5;
    if (was && !covered) { lastNow = 0; kick(); }
    if (audio && soundOn) {
      if (covered && !was) audio.pause();
      else if (!covered && was && playing) audio.play(t);
    }
  }
  window.addEventListener('scroll', () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  // if the GPU drops the context (driver reset, backgrounded tab on a phone), fall back to the still
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    playing = false;
    if (audio && soundOn) audio.pause();
    root.classList.add('is-fallback');
    player.hidden = true;
  });

  new ResizeObserver(size).observe(root);
  size();

  if (EXPORT) {
    await film.fontsReady;
    draw();
    window.__film = {
      ready: true,
      duration: DURATION,
      seek(sec) {
        t = sec;
        draw();
        film.gl.finish();
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
      },
      async audio() {
        const mod = await import('./audio.js');
        return mod.renderOffline(DURATION);
      },
    };
    return;
  }

  player.hidden = false;
  if (!playing) {
    // reduced motion (or ?pause): hold the end card as a still until someone presses play
    t = params.has('t') ? t : POSTER_T;
    player.classList.add('is-paused');
    btnPlay.setAttribute('aria-label', 'Play film');
  }
  dirty = true;
  lastNow = 0;
  kick();
  reduceMQ.addEventListener?.('change', (e) => { if (e.matches && playing) setPlaying(false); });
  window.__film = { ready: true, seek: (s) => seek(s), play: () => setPlaying(true), pause: () => setPlaying(false), get t() { return t; }, film };
}
