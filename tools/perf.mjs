// Render cost of the film at a few moments, in milliseconds per frame (GPU-synchronised), for three device
// profiles. The frame budget is 16.7 ms; the page also lowers its resolution on its own when frames run long.
//
// Usage: node tools/perf.mjs [base-url]
import { base, launch } from './lib.mjs';

const MOMENTS = [0.9, 1.6, 2.6, 3.6, 4.4, 5.6, 6.8, 7.6, 8.6, 9.6, 10.8, 11.8, 12.2, 13.5];
const PROFILES = [
  { name: 'laptop (Retina)', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  { name: 'desktop 1080p', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  { name: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];

const server = await base(process.argv[2]);
const browser = await launch();
for (const p of PROFILES) {
  const { name, ...opts } = p;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(`${server.url}/?pause&t=0`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__film && window.__film.ready, null, { timeout: 60000 });
  const r = await page.evaluate((times) => {
    const f = window.__film.film, gl = f.gl, px = new Uint8Array(4);
    const out = {};
    for (const t of times) {
      for (let i = 0; i < 5; i++) { f.render(t); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      const s = performance.now();
      for (let i = 0; i < 20; i++) { f.render(t + i * 0.001); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      out[t] = +((performance.now() - s) / 20).toFixed(1);
    }
    return { size: f.size, tier: f.tier, particles: f.particles, out };
  }, MOMENTS);
  const v = Object.values(r.out);
  console.log(`${name.padEnd(16)} ${r.size.join('x').padEnd(10)} ${r.tier.padEnd(6)} ${String(r.particles).padStart(7)} particles  ` +
    `avg ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)} ms  worst ${Math.max(...v).toFixed(1)} ms`);
  console.log('  ' + Object.entries(r.out).map(([t, ms]) => `${t}s ${ms}`).join(' · '));
  await ctx.close();
}
await browser.close();
await server.close();
