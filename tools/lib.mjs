// Shared plumbing for the tools: a static server for public/ and a headless Chromium with the real GPU on,
// so WebGL renders exactly as it does in a browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC = path.join(ROOT, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain',
};

/** Serve public/ the way the Worker does (index.html for directories, 404.html for misses), without caching. */
export function startServer(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let file = path.join(PUBLIC, decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': TYPES['.html'] });
          res.end(fs.readFileSync(path.join(PUBLIC, '404.html')));
          return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

/** A base URL to work against: the one given, or a throwaway local server for public/. */
export async function base(given) {
  if (given) return { url: given.replace(/\/$/, ''), close: async () => {} };
  const { server, url } = await startServer(0);
  return { url, close: () => new Promise((r) => server.close(r)) };
}

/** Playwright is deliberately not a project dependency (CI never needs it). */
export function playwright() {
  const require = createRequire(import.meta.url);
  for (const id of [process.env.PLAYWRIGHT_PATH, 'playwright', 'playwright-core'].filter(Boolean)) {
    try { return require(id); } catch { /* try the next one */ }
  }
  console.error('These tools need Playwright:\n  npm i --no-save playwright && npx playwright install chromium\n(or set PLAYWRIGHT_PATH to an existing install)');
  process.exit(1);
}

export function launch({ args = [] } = {}) {
  const gpu = process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--enable-gpu', '--ignore-gpu-blocklist'];
  // CHROMIUM_PATH points at a specific Chromium build when Playwright's default one is not installed
  return playwright().chromium.launch({ headless: true, args: [...gpu, ...args], executablePath: process.env.CHROMIUM_PATH || undefined });
}

/** Open the film in export mode (page chrome hidden, fixed pixel size) and wait until it is ready. */
export async function openFilm(browser, url, { w, h, scale = 1, particles = 1024, clean = false }) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  const q = `export&w=${Math.round(w * scale)}&h=${Math.round(h * scale)}&n=${particles}${clean ? '&clean' : ''}`;
  await page.goto(`${url}/?${q}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__film && window.__film.ready, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  return { page, context };
}
