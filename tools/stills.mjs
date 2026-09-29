// Render the site's imagery from the film: the five discipline stills, the contact plate, the poster and the
// social card. Each is a long exposure (many sub-frames summed in HDR) from its own camera, rendered at 2x and
// downsampled. Jobs live in tools/stills.json.
//
// Usage: node tools/stills.mjs [name ...]      renders every job, or only the named ones
// Needs: Playwright (see tools/lib.mjs), ffmpeg and cwebp on PATH.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PUBLIC, base, launch, openFilm } from './lib.mjs';

const spec = JSON.parse(fs.readFileSync(new URL('./stills.json', import.meta.url), 'utf8'));
const only = process.argv.slice(2);
const jobs = spec.jobs.filter((j) => !only.length || only.includes(j.name));
if (!jobs.length) { console.error(`no such job: ${only.join(', ')}`); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skystone-stills-'));
const server = await base(process.env.BASE);
const browser = await launch();

for (const j of jobs) {
  const [w, h] = j.size;
  const { keepGrade, ...opts } = j.opts;
  opts.post = keepGrade ? opts.post : { ...spec.grade, ...opts.post };
  const { page, context } = await openFilm(browser, server.url, {
    w, h, scale: j.scale || spec.scale, particles: j.particles || spec.particles, clean: j.clean !== false,
  });
  await page.evaluate(([t, o]) => window.__film.still(t, o), [j.t, opts]);
  const raw = path.join(tmp, `${j.name}.png`);
  const sized = path.join(tmp, `${j.name}-out.png`);
  await page.screenshot({ path: raw });
  await context.close();

  const out = path.join(PUBLIC, j.out);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-vf', `scale=${j.outSize[0]}:${j.outSize[1]}:flags=lanczos`, sized]);
  if (out.endsWith('.webp')) execFileSync('cwebp', ['-quiet', '-q', String(j.quality || 82), '-m', '6', sized, '-o', out]);
  else execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', sized, '-q:v', '3', out]);
  console.log(`${j.name.padEnd(26)} ${j.out.padEnd(38)} ${Math.round(fs.statSync(out).size / 1024)} KB`);
}

await browser.close();
await server.close();
fs.rmSync(tmp, { recursive: true, force: true });
