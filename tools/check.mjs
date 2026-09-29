// Functional checks for the site and the film, in a real browser. Run against the local build or the live site.
//
// Usage: node tools/check.mjs [base-url]     e.g. node tools/check.mjs https://skystone.co
// Terms that must never appear on the page can be added, one per line, to tools/banned.local.txt (not committed).
import fs from 'node:fs';
import { base, launch } from './lib.mjs';

const server = await base(process.argv[2]);
const BASE = server.url;
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const errors = [];
const ready = (page) => page.waitForFunction(() => window.__film && window.__film.ready, null, { timeout: 60000 });
const filmT = (page) => page.evaluate(() => window.__film.t);

const banned = ['construction', 'real estate', 'China', 'manufacturing'];
const local = new URL('./banned.local.txt', import.meta.url);
if (fs.existsSync(local)) banned.push(...fs.readFileSync(local, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));

const browser = await launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await ready(page);

  const t1 = await filmT(page);
  await page.waitForTimeout(2500);
  const t2 = await filmT(page);
  ok(t2 - t1 > 1.5, `autoplay advances the film (${t1.toFixed(2)} -> ${t2.toFixed(2)})`);
  ok(await page.evaluate(() => !document.querySelector('.player').hidden), 'player visible');

  await page.click('[data-play]');
  const p1 = await filmT(page);
  await page.waitForTimeout(800);
  ok(Math.abs((await filmT(page)) - p1) < 0.05, 'pause holds the frame');
  ok(await page.getAttribute('[data-play]', 'aria-label') === 'Play film', 'pause button relabels to Play film');
  await page.click('[data-play]');

  const box = await page.locator('[data-track]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  const s = await filmT(page);
  ok(s > 10.5 && s < 12, `track click seeks (t=${s.toFixed(2)})`);
  await page.focus('[data-track]');
  await page.keyboard.press('Home');
  ok((await filmT(page)) < 0.5, 'Home key seeks to the start');

  await page.click('[data-sound]');
  await page.waitForTimeout(1200);
  ok(await page.getAttribute('[data-sound]', 'aria-pressed') === 'true', 'sound toggles on');
  const a1 = await filmT(page);
  await page.waitForTimeout(1000);
  const a2 = await filmT(page);
  ok(a2 - a1 > 0.7 && a2 - a1 < 1.4, `audio clock drives the film (${(a2 - a1).toFixed(2)}s per 1s)`);
  await page.click('[data-sound]');
  ok(await page.getAttribute('[data-sound]', 'aria-pressed') === 'false', 'sound toggles off');

  // the page title stays up through the chapters and steps aside for the mark
  const quiet = async (t) => {
    await page.evaluate((x) => window.__film.seek(x), t);
    await page.waitForTimeout(200);
    return page.evaluate(() => document.querySelector('.hero-lockup').classList.contains('is-quiet'));
  };
  const q1 = await quiet(5), q2 = await quiet(13.2);
  ok(!q1 && q2, `page title stays up for the chapters and yields to the mark (${q1}, ${q2})`);

  const titles = [];
  for (const t of [2.5, 4.5, 6.5, 8.5, 10.5]) {
    await page.evaluate((x) => window.__film.seek(x), t);
    await page.waitForTimeout(120);
    titles.push(await page.evaluate(() => [...document.querySelectorAll('.ft-chapter')]
      .filter((e) => e.style.display !== 'none').map((e) => e.innerText.replace(/\s+/g, ' ').trim()).join('|')));
  }
  ok(titles.every((x) => x) && /Investment Advisory/.test(titles[0]) && /Strategic Insights/.test(titles[4]), `chapter titles: ${titles.join(' / ')}`);

  await page.evaluate(() => document.querySelector('#services').scrollIntoView());
  await page.waitForTimeout(600);
  await page.click('.svc-still[data-seek="9.5"]');
  await page.waitForTimeout(1500);
  const j = await page.evaluate(() => ({ t: window.__film.t, y: scrollY }));
  ok(j.t >= 9.5 && j.t < 11.5 && j.y < 5, `"Watch in the film" jumps to its chapter and scrolls up (t=${j.t.toFixed(2)}, y=${j.y})`);

  await page.evaluate(() => window.scrollTo(0, document.querySelector('#practice').offsetTop + 400));
  await page.waitForTimeout(500);
  const c1 = await filmT(page);
  await page.waitForTimeout(800);
  ok(Math.abs((await filmT(page)) - c1) < 0.05, 'film stops rendering once the practice section covers it');

  const office = await page.textContent('[data-office]');
  ok(/Open now|Closed/.test(office), `office status: "${office.trim()}"`);
  await page.evaluate(() => document.querySelector('#contact').scrollIntoView());
  await page.click('[data-copy]');
  await page.waitForTimeout(200);
  const cs = await page.textContent('.copy-status');
  ok(/Copied|contact@skystone\.co/.test(cs), `copy address feedback "${cs}"`);

  const text = await page.evaluate(() => document.body.innerText + ' ' + document.head.innerHTML);
  const hits = banned.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`, 'i').test(text));
  ok(hits.length === 0, `no retired or excluded terms on the page (${banned.length} checked${hits.length ? ': ' + hits.join(', ') : ''})`);
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
  ok(fonts.includes('Geist') && fonts.includes('Geist Mono'), `fonts loaded: ${[...new Set(fonts)].join(', ')}`);
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('mobile: ' + e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await ready(page);
  await page.tap('.nav-menu');
  await page.waitForTimeout(400);
  ok(await page.getAttribute('.nav-menu', 'aria-expanded') === 'true', 'mobile menu opens');
  await page.tap('.nav-links a[href="#process"]');
  await page.waitForTimeout(900);
  ok(await page.getAttribute('.nav-menu', 'aria-expanded') === 'false', 'mobile menu closes after navigating');
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await ready(page);
  const r1 = await filmT(page);
  await page.waitForTimeout(1200);
  ok(r1 === (await filmT(page)) && r1 > 13 && r1 < 14.3, `reduced motion holds the end-card still (t=${r1})`);
  ok(await page.getAttribute('[data-play]', 'aria-label') === 'Play film', 'reduced motion offers Play');
  const res = await page.goto(BASE + '/privacy/', { waitUntil: 'networkidle' });
  const h1 = await page.textContent('h1');
  ok(res.status() === 200 && /Privacy/.test(h1), `privacy page (${res.status()}, "${h1.trim()}")`);
  const missing = await page.goto(BASE + '/no-such-page', { waitUntil: 'networkidle' });
  ok(missing.status() === 404, `unknown paths are a 404 (${missing.status()})`);
  await ctx.close();
}
await browser.close();
{
  const b = await launch({ args: ['--disable-webgl', '--disable-webgl2'] });
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const fb = await page.evaluate(() => ({ fallback: document.getElementById('film').classList.contains('is-fallback'), hidden: document.querySelector('.player').hidden }));
  ok(fb.fallback && fb.hidden, 'no WebGL: poster fallback, player hidden');
  await b.close();
}
await server.close();
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
if (failed || errors.length) process.exit(1);
