// Export the film to MP4: the score rendered offline, then every frame captured frame-exact at 2x and encoded.
//   exports/skystone-film-3840x2160.mp4   4K master
//   exports/skystone-film-1920x1080.mp4   1080p, downsampled from the 4K frames
//   exports/skystone-film-1080x1920.mp4   vertical cut (the film recomposes itself for tall frames)
//
// Usage: node tools/export.mjs [wide|tall]    both cuts by default
// Needs: Playwright (see tools/lib.mjs) and ffmpeg on PATH. Takes a few minutes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, base, launch, openFilm } from './lib.mjs';

const FPS = 30;
const PARTICLES = 1024;
const OUT = path.join(ROOT, 'exports');
const CUTS = {
  wide: {
    size: [1920, 1080],
    encodes: [
      { file: 'skystone-film-3840x2160.mp4', vf: null, maxrate: '45M' },
      { file: 'skystone-film-1920x1080.mp4', vf: 'scale=1920:1080:flags=lanczos', maxrate: '16M' },
    ],
  },
  tall: {
    size: [1080, 1920],
    encodes: [{ file: 'skystone-film-1080x1920.mp4', vf: 'scale=1080:1920:flags=lanczos', maxrate: '16M' }],
  },
};
const which = process.argv[2] ? [process.argv[2]] : Object.keys(CUTS);

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skystone-export-'));
const server = await base(process.env.BASE);
const browser = await launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// the score, rendered offline with the same cue sheet the site plays live
const wav = path.join(tmp, 'score.wav');
{
  const { page, context } = await openFilm(browser, server.url, { w: 640, h: 360, particles: 64 });
  const r = await page.evaluate(() => window.__film.audio());
  fs.writeFileSync(wav, Buffer.from(r.base64, 'base64'));
  await context.close();
  console.log('score rendered');
}

for (const name of which) {
  const cut = CUTS[name];
  const [w, h] = cut.size;
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  const { page, context } = await openFilm(browser, server.url, { w, h, scale: 2, particles: PARTICLES });
  const n = Math.round((await page.evaluate(() => window.__film.duration)) * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.__film.seek(t), i / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
    if (i % 90 === 0) console.log(`${name}: frame ${i}/${n}`);
  }
  await context.close();
  for (const e of cut.encodes) {
    const out = path.join(OUT, e.file);
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, 'f%05d.jpg'), '-i', wav,
      ...(e.vf ? ['-vf', e.vf] : []),
      '-c:v', 'libx264', '-preset', 'slow', '-tune', 'film', '-crf', '18', '-maxrate', e.maxrate, '-bufsize', `${parseInt(e.maxrate, 10) * 2}M`,
      '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out,
    ]);
    console.log(`wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1e6).toFixed(0)} MB)`);
  }
}

await browser.close();
await server.close();
fs.rmSync(tmp, { recursive: true, force: true });
