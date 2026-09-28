// The score: synthesised live with WebAudio and locked to the film clock. 120 BPM, D minor, resolving
// to D major when the stone forms. Loaded only when someone turns the sound on.
import { DURATION } from './director.js';

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const midi = (s) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(s); return 12 * (+m[2] + 1) + NOTE[m[1]]; };
const hz = (s) => 440 * Math.pow(2, (midi(s) - 69) / 12);
const BEAT = 0.5;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- graph
function buildGraph(ac) {
  const master = ac.createGain();
  master.gain.value = 0.8;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.006; comp.release.value = 0.22;
  master.connect(comp).connect(ac.destination);

  const r = rng(7);
  const len = Math.floor(ac.sampleRate * 3.2);
  const ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 200 ? i / 200 : 1);
  }
  const verb = ac.createConvolver();
  verb.buffer = ir;
  const verbIn = ac.createGain();
  verbIn.gain.value = 0.55;
  const verbTone = ac.createBiquadFilter();
  verbTone.type = 'lowpass'; verbTone.frequency.value = 5200;
  verbIn.connect(verbTone).connect(verb).connect(master);

  const nlen = ac.sampleRate * 2;
  const noise = ac.createBuffer(1, nlen, ac.sampleRate);
  const nd = noise.getChannelData(0);
  const rn = rng(11);
  for (let i = 0; i < nlen; i++) nd[i] = rn() * 2 - 1;

  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }

  return { master, verbIn, noise, curve };
}

// ---------------------------------------------------------------- instruments (all take a destination bus)
function out(ac, G, bus, when, { gain = 1, pan = 0, send = 0.2 } = {}) {
  const g = ac.createGain();
  g.gain.value = gain;
  const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
  if (p) { p.pan.value = pan; g.connect(p).connect(bus.dry); } else g.connect(bus.dry);
  if (send > 0) {
    const s = ac.createGain();
    s.gain.value = send;
    g.connect(s).connect(bus.wet);
  }
  return g;
}
function noiseSrc(ac, G, when, dur) {
  const n = ac.createBufferSource();
  n.buffer = G.noise;
  n.loop = true;
  n.start(when, Math.random() * 1.5);
  n.stop(when + dur + 0.05);
  return n;
}

const I = {
  pad(ac, G, bus, when, off, dur, notes, { cutoff = 1600, level = 0.05, attack = 1.4, release = 2.2, send = 0.5, wave = 'sawtooth' } = {}) {
    const d = dur - off;
    if (d <= 0.05) return;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 0.6;
    f.frequency.setValueAtTime(cutoff * 0.6, when);
    f.frequency.linearRampToValueAtTime(cutoff, when + Math.min(d, 2.5));
    const g = ac.createGain();
    const a = off > 0 ? 0.3 : attack;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + a);
    g.gain.setValueAtTime(level, when + Math.max(a, d - release));
    g.gain.exponentialRampToValueAtTime(0.0001, when + d);
    f.connect(g).connect(out(ac, G, bus, when, { gain: 1, send }));
    notes.forEach((n, i) => {
      [-8, 0, 8].forEach((det, k) => {
        const o = ac.createOscillator();
        o.type = wave;
        o.frequency.value = hz(n);
        o.detune.value = det + (i % 2 ? 3 : -3);
        const pg = ac.createGain();
        pg.gain.value = k === 1 ? 0.5 : 0.35;
        const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
        if (p) { p.pan.value = (k - 1) * 0.45; o.connect(pg).connect(p).connect(f); } else o.connect(pg).connect(f);
        o.start(when);
        o.stop(when + d + 0.1);
      });
    });
  },
  sub(ac, G, bus, when, off, dur, n, { level = 0.22, attack = 0.01, release = 0.25 } = {}) {
    const d = dur - off;
    if (d <= 0.02) return;
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz(n);
    const ws = ac.createWaveShaper();
    ws.curve = G.curve;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + (off > 0 ? 0.05 : attack));
    g.gain.setValueAtTime(level, when + Math.max(0.02, d - release));
    g.gain.exponentialRampToValueAtTime(0.0001, when + d);
    o.connect(ws).connect(g).connect(out(ac, G, bus, when, { send: 0 }));
    o.start(when);
    o.stop(when + d + 0.05);
  },
  pluck(ac, G, bus, when, n, { level = 0.07, decay = 0.32, pan = 0, bright = 3200, send = 0.35 } = {}) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(bright, when);
    f.frequency.exponentialRampToValueAtTime(420, when + decay);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay + 0.05);
    [['triangle', 1], ['square', 0.25]].forEach(([type, lv]) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = hz(n);
      const og = ac.createGain();
      og.gain.value = lv;
      o.connect(og).connect(f);
      o.start(when);
      o.stop(when + decay + 0.1);
    });
    f.connect(g).connect(out(ac, G, bus, when, { pan, send }));
  },
  kick(ac, G, bus, when, { level = 0.9 } = {}) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(155, when);
    o.frequency.exponentialRampToValueAtTime(44, when + 0.13);
    const g = ac.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
    o.connect(g).connect(out(ac, G, bus, when, { send: 0.04 }));
    o.start(when);
    o.stop(when + 0.55);
    const n = noiseSrc(ac, G, when, 0.02);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3500;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(level * 0.12, when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.015);
    n.connect(hp).connect(ng).connect(out(ac, G, bus, when, { send: 0 }));
  },
  clap(ac, G, bus, when, { level = 0.28 } = {}) {
    const n = noiseSrc(ac, G, when, 0.3);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1350; bp.Q.value = 1.1;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    [0, 0.011, 0.023].forEach((o) => {
      g.gain.setValueAtTime(level, when + o);
      g.gain.exponentialRampToValueAtTime(level * 0.2, when + o + 0.009);
    });
    g.gain.setValueAtTime(level * 0.7, when + 0.034);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    n.connect(bp).connect(g).connect(out(ac, G, bus, when, { send: 0.45, pan: 0.05 }));
  },
  hat(ac, G, bus, when, { level = 0.07, decay = 0.045, pan = 0.25 } = {}) {
    const n = noiseSrc(ac, G, when, decay + 0.02);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7600;
    const g = ac.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    n.connect(hp).connect(g).connect(out(ac, G, bus, when, { pan, send: 0.08 }));
  },
  whoosh(ac, G, bus, when, dur, { from = 300, to = 5200, level = 0.22, panFrom = -0.7, panTo = 0.7 } = {}) {
    const n = noiseSrc(ac, G, when, dur);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(from, when);
    bp.frequency.exponentialRampToValueAtTime(to, when + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + dur * 0.65);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
    const o = out(ac, G, bus, when, { send: 0.5 });
    if (p) {
      p.pan.setValueAtTime(panFrom, when);
      p.pan.linearRampToValueAtTime(panTo, when + dur);
      n.connect(bp).connect(g).connect(p).connect(o);
    } else n.connect(bp).connect(g).connect(o);
  },
  riser(ac, G, bus, when, dur, { level = 0.16 } = {}) {
    I.whoosh(ac, G, bus, when, dur, { from: 200, to: 9000, level: level * 1.2, panFrom: 0, panTo: 0 });
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, when);
    o.frequency.exponentialRampToValueAtTime(880, when + dur);
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, when);
    f.frequency.exponentialRampToValueAtTime(6000, when + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level * 0.5, when + dur * 0.98);
    g.gain.linearRampToValueAtTime(0.0001, when + dur + 0.01);
    o.connect(f).connect(g).connect(out(ac, G, bus, when, { send: 0.3 }));
    o.start(when);
    o.stop(when + dur + 0.05);
  },
  impact(ac, G, bus, when, { level = 0.9, size = 1 } = {}) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(78, when);
    o.frequency.exponentialRampToValueAtTime(30, when + 1.3 * size);
    const g = ac.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.7 * size);
    const ws = ac.createWaveShaper();
    ws.curve = G.curve;
    o.connect(ws).connect(g).connect(out(ac, G, bus, when, { send: 0.2 }));
    o.start(when);
    o.stop(when + 1.8 * size);
    const n = noiseSrc(ac, G, when, 1.6 * size);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, when);
    lp.frequency.exponentialRampToValueAtTime(500, when + 1.2 * size);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(level * 0.38, when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 1.4 * size);
    n.connect(lp).connect(ng).connect(out(ac, G, bus, when, { send: 0.85 }));
    I.kick(ac, G, bus, when, { level: level * 0.8 });
  },
  ping(ac, G, bus, when, n, { level = 0.08, pan = 0, decay = 0.5, ratio = 2.01, index = 1.2 } = {}) {
    const f0 = hz(n);
    const c = ac.createOscillator();
    c.type = 'sine';
    c.frequency.value = f0;
    const m = ac.createOscillator();
    m.type = 'sine';
    m.frequency.value = f0 * ratio;
    const mg = ac.createGain();
    mg.gain.setValueAtTime(f0 * index, when);
    mg.gain.exponentialRampToValueAtTime(1, when + decay);
    m.connect(mg).connect(c.frequency);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    c.connect(g).connect(out(ac, G, bus, when, { pan, send: 0.6 }));
    c.start(when); m.start(when);
    c.stop(when + decay + 0.05); m.stop(when + decay + 0.05);
  },
  bell(ac, G, bus, when, n, { level = 0.12, decay = 3.2 } = {}) {
    I.ping(ac, G, bus, when, n, { level, decay, ratio: 3.5, index: 3.2 });
    I.ping(ac, G, bus, when, n, { level: level * 0.5, decay: decay * 0.6, ratio: 1.0, index: 0.3, pan: 0.2 });
  },
  tick(ac, G, bus, when, { level = 0.035, f = 3200 } = {}) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.018);
    o.connect(g).connect(out(ac, G, bus, when, { send: 0.05, pan: 0.3 }));
    o.start(when);
    o.stop(when + 0.03);
  },
  tom(ac, G, bus, when, { level = 0.7, f = 118 } = {}) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, when);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, when + 0.35);
    const g = ac.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.7);
    o.connect(g).connect(out(ac, G, bus, when, { send: 0.45 }));
    o.start(when);
    o.stop(when + 0.75);
    const n = noiseSrc(ac, G, when, 0.12);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(level * 0.3, when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
    n.connect(lp).connect(ng).connect(out(ac, G, bus, when, { send: 0.3 }));
  },
  clack(ac, G, bus, when, { level = 0.22, pitch = 0 } = {}) {
    const n = noiseSrc(ac, G, when, 0.05);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2400 + pitch * 90; bp.Q.value = 7;
    const g = ac.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    n.connect(bp).connect(g).connect(out(ac, G, bus, when, { send: 0.25, pan: (pitch % 3 - 1) * 0.3 }));
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(620 + pitch * 22, when);
    o.frequency.exponentialRampToValueAtTime(380 + pitch * 14, when + 0.03);
    const og = ac.createGain();
    og.gain.setValueAtTime(level * 0.5, when);
    og.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.connect(og).connect(out(ac, G, bus, when, { send: 0.2 }));
    o.start(when);
    o.stop(when + 0.06);
  },
  swell(ac, G, bus, when, dur, { level = 0.22 } = {}) {
    const n = noiseSrc(ac, G, when, dur);
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, when);
    f.frequency.exponentialRampToValueAtTime(9000, when + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + dur);
    g.gain.linearRampToValueAtTime(0.0001, when + dur + 0.012);
    n.connect(f).connect(g).connect(out(ac, G, bus, when, { send: 0.4 }));
  },
  air(ac, G, bus, when, off, dur, { level = 0.05 } = {}) {
    const d = dur - off;
    if (d <= 0.05) return;
    const n = noiseSrc(ac, G, when, d);
    const f = ac.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.4;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + Math.min(2.5, d * 0.5));
    g.gain.linearRampToValueAtTime(0.0001, when + d);
    n.connect(f).connect(g).connect(out(ac, G, bus, when, { send: 0.3 }));
  },
};

// ---------------------------------------------------------------- the cue sheet
const CHORDS = {
  Dm9: ['D3', 'F3', 'A3', 'C4', 'E4'],
  Bbmaj7: ['Bb2', 'D3', 'F3', 'A3', 'D4'],
  Gm9: ['G2', 'Bb2', 'D3', 'F3', 'A3'],
  Fmaj7: ['F2', 'A2', 'C3', 'E3', 'A3'],
  A7sus: ['A2', 'D3', 'E3', 'G3', 'C4'],
  A7: ['A2', 'C#3', 'E3', 'G3', 'C#4'],
  Dmaj9: ['A2', 'D3', 'F#3', 'A3', 'C#4', 'E4'],
};
const ROOT = { Dm9: 'D2', Bbmaj7: 'Bb1', Gm9: 'G1', Fmaj7: 'F1', A7sus: 'A1', A7: 'A1', Dmaj9: 'D2' };
const ARP = {
  Dm9: ['D4', 'F4', 'A4', 'C5', 'E5', 'C5', 'A4', 'F4'],
  Bbmaj7: ['Bb3', 'D4', 'F4', 'A4', 'D5', 'A4', 'F4', 'D4'],
  Gm9: ['G3', 'Bb3', 'D4', 'F4', 'A4', 'F4', 'D4', 'Bb3'],
  Fmaj7: ['F3', 'A3', 'C4', 'E4', 'A4', 'E4', 'C4', 'A3'],
  A7sus: ['A3', 'D4', 'E4', 'G4', 'C5', 'G4', 'E4', 'D4'],
  A7: ['A3', 'C#4', 'E4', 'G4', 'C#5', 'G4', 'E4', 'C#4'],
};

function buildCues() {
  const cues = [];
  const at = (t, dur, fn) => cues.push({ t, dur, fn });
  const hit = (t, fn) => at(t, 0.01, fn);

  // ---- 0-4 horizon
  at(0.0, 4.4, (ac, G, b, w, o) => I.air(ac, G, b, w, o, 4.4, { level: 0.045 }));
  at(0.1, 1.6, (ac, G, b, w, o) => I.pad(ac, G, b, w, o, 1.6, ['D5', 'A5'], { cutoff: 2600, level: 0.012, attack: 0.9, release: 0.6, wave: 'triangle', send: 0.8 }));
  at(1.3, 3.0, (ac, G, b, w, o) => I.pad(ac, G, b, w, o, 3.0, CHORDS.Dm9, { cutoff: 1300, level: 0.03, attack: 1.4, release: 1.0 }));
  at(1.3, 2.9, (ac, G, b, w, o) => I.sub(ac, G, b, w, o, 2.9, 'D2', { level: 0.075, attack: 1.0, release: 0.8 }));
  hit(1.32, (ac, G, b, w) => I.pluck(ac, G, b, w, 'D5', { level: 0.05, decay: 1.1, bright: 2400, send: 0.7 }));
  hit(2.17, (ac, G, b, w) => { I.pluck(ac, G, b, w, 'A4', { level: 0.05, decay: 1.2, bright: 2200, send: 0.7 }); I.pluck(ac, G, b, w, 'E5', { level: 0.035, decay: 1.2, bright: 2600, send: 0.7, pan: 0.3 }); });
  const r = rng(3);
  for (let k = 0; k < 9; k++) {
    const t = 1.6 + r() * 2.3;
    const n = ['A5', 'D6', 'E6', 'F6', 'A6'][Math.floor(r() * 5)];
    hit(t, (ac, G, b, w) => I.ping(ac, G, b, w, n, { level: 0.014, decay: 0.9, pan: r() * 1.6 - 0.8, ratio: 3.01, index: 0.4 }));
  }

  // ---- 4-8 the route
  at(4.0, 1.9, (ac, G, b, w) => I.whoosh(ac, G, b, w, 1.9, { from: 250, to: 4200, level: 0.16 }));
  at(4.0, 4.2, (ac, G, b, w, o) => I.pad(ac, G, b, w, o, 4.2, CHORDS.Bbmaj7, { cutoff: 1500, level: 0.03, attack: 0.9 }));
  at(4.0, 4.0, (ac, G, b, w, o) => I.sub(ac, G, b, w, o, 4.0, 'Bb1', { level: 0.075, attack: 0.6, release: 0.5 }));
  hit(5.9, (ac, G, b, w) => I.ping(ac, G, b, w, 'A5', { level: 0.07, decay: 1.2, pan: -0.35 }));
  hit(7.58, (ac, G, b, w) => I.ping(ac, G, b, w, 'D6', { level: 0.07, decay: 1.2, pan: 0.35 }));
  for (let t = 5.95; t < 7.7; t += BEAT / 4) hit(t, (ac, G, b, w) => I.tick(ac, G, b, w, { level: 0.02, f: 2800 + (t - 5.95) * 500 }));
  for (let t = 6.0, i = 0; t < 8.0; t += BEAT / 2, i++) hit(t, (ac, G, b, w) => I.pluck(ac, G, b, w, ARP.Bbmaj7[i % 8], { level: 0.03, decay: 0.28, bright: 1800 + i * 90, pan: i % 2 ? 0.35 : -0.35 }));
  at(7.0, 1.0, (ac, G, b, w) => I.riser(ac, G, b, w, 1.0, { level: 0.16 }));

  // ---- 8-20 groove: investment, insights, implementation
  const bars = [[8, 'Gm9'], [10, 'Gm9'], [12, 'Fmaj7'], [14, 'Fmaj7'], [16, 'A7sus'], [18, 'A7sus']];
  hit(8.0, (ac, G, b, w) => I.impact(ac, G, b, w, { level: 0.85 }));
  for (const [t0, ch] of bars) {
    const night = t0 >= 12 && t0 < 16;
    at(t0, 2.05, (ac, G, b, w, o) => I.pad(ac, G, b, w, o, 2.05, CHORDS[ch], { cutoff: night ? 900 : 1700, level: 0.028, attack: 0.25, release: 0.35 }));
    for (let k = 0; k < 4; k++) {
      const t = t0 + k * BEAT;
      if (k % 2 === 0 && !(t0 === 8 && k === 0)) hit(t, (ac, G, b, w) => I.kick(ac, G, b, w, { level: 0.62 }));
      hit(t + BEAT / 2, (ac, G, b, w) => I.hat(ac, G, b, w, { level: night ? 0.035 : 0.05 }));
      at(t, BEAT * 0.9, (ac, G, b, w, o) => I.sub(ac, G, b, w, o, BEAT * 0.9, ROOT[ch], { level: 0.16, release: 0.1 }));
    }
    for (let i = 0; i < 16; i++) {
      const t = t0 + i * (BEAT / 4);
      if (night && i % 2) continue;
      hit(t, (ac, G, b, w) => I.pluck(ac, G, b, w, ARP[ch][i % 8], { level: night ? 0.022 : 0.028, decay: 0.22, bright: night ? 1400 : 2600, pan: i % 2 ? 0.4 : -0.4, send: 0.3 }));
    }
  }
  hit(8.62, (ac, G, b, w) => { I.bell(ac, G, b, w, 'A5', { level: 0.05, decay: 2.2 }); I.bell(ac, G, b, w, 'E6', { level: 0.03, decay: 2.2 }); });
  at(8.55, 1.6, (ac, G, b, w) => I.whoosh(ac, G, b, w, 1.6, { from: 180, to: 2600, level: 0.1, panFrom: -0.3, panTo: 0.3 }));
  at(12.0, 1.8, (ac, G, b, w) => I.whoosh(ac, G, b, w, 1.8, { from: 3600, to: 300, level: 0.1, panFrom: 0.5, panTo: -0.5 }));
  const pr = rng(19);
  for (let k = 0; k < 14; k++) {
    const t = 13.2 + Math.floor(pr() * 16) * (BEAT / 2);
    const n = ['E6', 'A5', 'C6', 'G6'][Math.floor(pr() * 4)];
    hit(t, (ac, G, b, w) => I.ping(ac, G, b, w, n, { level: 0.03, decay: 0.7, pan: pr() * 1.6 - 0.8, ratio: 2.76, index: 0.9 }));
  }
  at(16.0, 1.1, (ac, G, b, w) => I.whoosh(ac, G, b, w, 1.1, { from: 2600, to: 160, level: 0.14 }));
  for (let i = 0; i < 14; i++) hit(17.55 + i * 0.125, (ac, G, b, w) => I.clack(ac, G, b, w, { level: 0.2, pitch: i }));
  at(19.0, 1.0, (ac, G, b, w) => I.riser(ac, G, b, w, 1.0, { level: 0.18 }));
  for (let t = 19.0, i = 0; t < 20; t += i < 4 ? BEAT / 4 : BEAT / 8, i++) hit(t, (ac, G, b, w) => I.clap(ac, G, b, w, { level: 0.05 + i * 0.012 }));

  // ---- 20-28 the drop
  const drop = [[20, 'Dm9'], [22, 'Bbmaj7'], [24, 'Gm9'], [26, 'A7']];
  for (const [t0, ch] of drop) {
    at(t0, 2.05, (ac, G, b, w, o) => I.pad(ac, G, b, w, o, 2.05, CHORDS[ch], { cutoff: 2600, level: 0.03, attack: 0.05, release: 0.3 }));
    for (let k = 0; k < 4; k++) {
      const t = t0 + k * BEAT;
      if (t >= 27.5) continue;
      if (!(t === 20)) hit(t, (ac, G, b, w) => I.kick(ac, G, b, w, { level: 0.75 }));
      if (k % 2 === 1) hit(t, (ac, G, b, w) => I.clap(ac, G, b, w, { level: 0.24 }));
      hit(t + BEAT / 2, (ac, G, b, w) => I.hat(ac, G, b, w, { level: 0.07, decay: 0.07 }));
      hit(t + BEAT / 4, (ac, G, b, w) => I.hat(ac, G, b, w, { level: 0.03, pan: -0.3 }));
      at(t, BEAT / 2 * 0.9, (ac, G, b, w, o) => I.sub(ac, G, b, w, o, BEAT / 2 * 0.9, ROOT[ch], { level: 0.2 }));
      at(t + BEAT / 2, BEAT / 2 * 0.9, (ac, G, b, w, o) => I.sub(ac, G, b, w, o, BEAT / 2 * 0.9, ROOT[ch], { level: 0.14 }));
    }
    for (let i = 0; i < 16; i++) {
      const t = t0 + i * (BEAT / 4);
      if (t >= 27.5) continue;
      hit(t, (ac, G, b, w) => I.pluck(ac, G, b, w, ARP[ch][i % 8], { level: 0.03, decay: 0.2, bright: 3800, pan: i % 2 ? 0.45 : -0.45, send: 0.28 }));
    }
  }
  hit(20.0, (ac, G, b, w) => I.impact(ac, G, b, w, { level: 0.9 }));
  [21.0, 22.0].forEach((t) => hit(t, (ac, G, b, w) => I.impact(ac, G, b, w, { level: 0.45, size: 0.6 })));
  [23.0, 23.5, 24.0].forEach((t, i) => hit(t, (ac, G, b, w) => {
    I.tom(ac, G, b, w, { level: 0.5, f: 150 - i * 15 });
    CHORDS[i === 1 ? 'Bbmaj7' : 'Gm9'].forEach((n) => I.pluck(ac, G, b, w, n.replace(/\d/, (d) => String(+d + 1)), { level: 0.03, decay: 0.35, bright: 4200, send: 0.4 }));
  }));
  [24.5, 25.0, 25.5, 26.0].forEach((t, i) => hit(t, (ac, G, b, w) => {
    I.tom(ac, G, b, w, { level: 0.85, f: 96 - i * 6 });
    I.ping(ac, G, b, w, ['D5', 'F5', 'A5', 'D6'][i], { level: 0.05, decay: 1.4, ratio: 3.5, index: 1.5 });
  }));
  [26.5, 27.0, 27.5].forEach((t, i) => hit(t, (ac, G, b, w) => I.bell(ac, G, b, w, ['A4', 'C#5', 'E5'][i], { level: 0.06, decay: 1.8 })));
  for (let t = 26.5, i = 0; t < 27.9; t += i < 8 ? BEAT / 4 : BEAT / 8, i++) hit(t, (ac, G, b, w) => I.clap(ac, G, b, w, { level: 0.04 + i * 0.008 }));
  at(26.2, 1.75, (ac, G, b, w) => I.riser(ac, G, b, w, 1.75, { level: 0.2 }));

  // ---- 28-30.5 collapse, silence, heartbeat
  at(28.0, 1.35, (ac, G, b, w) => I.swell(ac, G, b, w, 1.35, { level: 0.24 }));
  hit(29.5, (ac, G, b, w) => I.sub(ac, G, b, w, 0, 0.22, 'D1', { level: 0.5, release: 0.18 }));
  hit(30.0, (ac, G, b, w) => I.sub(ac, G, b, w, 0, 0.22, 'D1', { level: 0.42, release: 0.18 }));
  at(30.15, 0.35, (ac, G, b, w) => I.swell(ac, G, b, w, 0.35, { level: 0.2 }));

  // ---- 30.5-40 the stone
  hit(30.5, (ac, G, b, w) => I.impact(ac, G, b, w, { level: 1.0, size: 1.4 }));
  at(30.5, 9.4, (ac, G, b, w, o) => I.pad(ac, G, b, w, o, 9.4, CHORDS.Dmaj9, { cutoff: 2200, level: 0.034, attack: 1.8, release: 3.4 }));
  at(30.5, 9.2, (ac, G, b, w, o) => I.sub(ac, G, b, w, o, 9.2, 'D2', { level: 0.085, attack: 1.5, release: 3.0 }));
  ['D6', 'F#6', 'A6', 'E6', 'C#6', 'A5'].forEach((n, i) => hit(31.3 + i * 0.25, (ac, G, b, w) => I.ping(ac, G, b, w, n, { level: 0.03, decay: 1.6, pan: (i % 3 - 1) * 0.5, ratio: 3.01, index: 0.5 })));
  hit(33.56, (ac, G, b, w) => I.bell(ac, G, b, w, 'A5', { level: 0.1, decay: 4.0 }));
  hit(33.9, (ac, G, b, w) => { I.pluck(ac, G, b, w, 'D3', { level: 0.06, decay: 2.4, bright: 1600, send: 0.6 }); I.pluck(ac, G, b, w, 'A3', { level: 0.045, decay: 2.4, bright: 1600, send: 0.6 }); });
  at(34.0, 5.8, (ac, G, b, w, o) => I.air(ac, G, b, w, o, 5.8, { level: 0.03 }));

  cues.sort((a, b) => a.t - b.t);
  return cues;
}

// ---------------------------------------------------------------- live player
export function createScore() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC({ latencyHint: 'interactive' });
  const G = buildGraph(ac);
  const cues = buildCues();
  let bus = null;
  let playing = false;
  let t0Ctx = 0, t0Film = 0;
  let until = 0;
  let timer = 0;

  function newBus() {
    const dry = ac.createGain();
    const wet = ac.createGain();
    dry.connect(G.master);
    wet.connect(G.verbIn);
    return { dry, wet };
  }
  function killBus() {
    if (!bus) return;
    const b = bus;
    const now = ac.currentTime;
    [b.dry, b.wet].forEach((g) => {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + 0.06);
    });
    setTimeout(() => { b.dry.disconnect(); b.wet.disconnect(); }, 120);
    bus = null;
  }
  const filmNow = () => t0Film + (ac.currentTime - t0Ctx);

  function pump() {
    if (!playing) return;
    const horizon = filmNow() + 0.25;
    while (until < horizon) {
      const loop = Math.floor(until / DURATION);
      const local = until - loop * DURATION;
      const end = Math.min(horizon, (loop + 1) * DURATION) - loop * DURATION;
      for (const c of cues) {
        if (c.t >= local && c.t < end) {
          const when = t0Ctx + (loop * DURATION + c.t - t0Film);
          try { c.fn(ac, G, bus, Math.max(when, ac.currentTime), 0); } catch (e) { /* a voice failing must never stop the film */ }
        }
      }
      until = loop * DURATION + end;
    }
    timer = setTimeout(pump, 60);
  }

  return {
    time() { return playing ? filmNow() % DURATION : t0Film % DURATION; },
    play(t) {
      if (ac.state === 'suspended') ac.resume();
      killBus();
      clearTimeout(timer);
      bus = newBus();
      playing = true;
      t0Ctx = ac.currentTime + 0.03;
      t0Film = t;
      until = t;
      // sustained voices already under way at t: start them mid-flight
      for (const c of cues) {
        // only voices that understand an offset (pads, sub, air) can join mid-flight
        if (c.fn.length >= 5 && c.t < t && c.t + c.dur > t + 0.1) {
          try { c.fn(ac, G, bus, t0Ctx, t - c.t); } catch (e) { /* ignore */ }
        }
      }
      pump();
    },
    pause() {
      if (playing) t0Film = filmNow();
      playing = false;
      clearTimeout(timer);
      killBus();
    },
    seek(t, keepPlaying) {
      if (keepPlaying) this.play(t);
      else { this.pause(); t0Film = t; }
    },
    stop() { this.pause(); },
  };
}

// ---------------------------------------------------------------- offline render (for the MP4 export)
export async function renderOffline(duration = DURATION) {
  const rate = 48000;
  const ac = new OfflineAudioContext(2, Math.ceil(rate * duration), rate);
  const G = buildGraph(ac);
  const dry = ac.createGain(), wet = ac.createGain();
  dry.connect(G.master); wet.connect(G.verbIn);
  const bus = { dry, wet };
  for (const c of buildCues()) if (c.t < duration) c.fn(ac, G, bus, c.t, 0);
  const buf = await ac.startRendering();
  // 16-bit PCM WAV, base64
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  const n = buf.length;
  const bytes = new Uint8Array(44 + n * 4);
  const dv = new DataView(bytes.buffer);
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 4, true);
  let o = 44, peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[0][i]), Math.abs(ch[1][i]));
  const norm = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const v = Math.max(-1, Math.min(1, ch[c][i] * norm));
      dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return { base64: btoa(bin), peak };
}
