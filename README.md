# skystone.co

Marketing site for **Skystone Partners**: investment advisory and management consulting, Dubai.

The hero is a 40-second brand film rendered live in the browser with WebGL2 — no video file, no
libraries, no build step. Everything else on the page is cut from the same footage.

Deployed as a Cloudflare Worker with Static Assets. Pushes to `main` deploy to production.

## Structure

```
public/
  index.html            # the one-pager
  styles.css            # Geist type, three colours (ink, paper, one accent), film overlay, sections
  site.js               # nav, reveals, office hours, copy address, process playhead, contact plate
  film/
    main.js             # boots the reel, player controls, visibility, adaptive resolution
    film.js             # engine: GL context, renderers, camera rig, render order
    director.js         # the shot list: film time -> complete frame description
    overlay.js          # typography + vector layer, keyed to the same clock
    audio.js            # the score: WebAudio synthesis, live + offline render
    shapes.js           # particle target shapes (built in shapes-worker.js)
    world.js            # places, the monolith field, the arch, the landscape, the stone
    parts.js            # instanced stone parts (blocks, voussoirs, keystone), fake bevels, materials
    terrain.js          # dunes and the contour landscape
    shadow.js           # sun shadow map (PCF), fitted per shot
    sky.js particles.js lines.js billboards.js globe.js stone.js post.js
    gl.js math.js       # thin WebGL2 + math helpers
    land.png            # 1-bit land mask for the globe (Natural Earth 1:50m)
    poster.jpg og.jpg   # no-WebGL fallback still and social card, rendered from the film
  stills/               # frames rendered from the film, used as the site's imagery
  privacy/index.html    # privacy policy
wrangler.jsonc          # Cloudflare Worker config
```

## How the film works

One clock drives everything. `director.evaluate(t)` is a pure function from film time to a frame
(camera, sky, terrain, particle morph, stone parts, shadows, lines, words-in-the-world, stone, post), and `overlay.update(t)`
does the same for the DOM typography. That is what makes the reel pausable, scrubbable, loopable and
exportable frame-exact.

- 65k GPU particles morph between shapes stored in a float texture (desert → globe → landscape →
  dust bursts → vortex → a single point → the stone).
- Chapters: Horizon, Reach (globe network from Dubai), Investment (seven monoliths rising),
  Insights (a contour landscape drawing itself at night), Implementation (an arch assembled stone by
  stone until the keystone locks), what we do, four stages, Skystone.
- Stone is instanced geometry with bevels, polished basalt / honed travertine and a real shadow map.
- Post: MSAA, dual-filter bloom, god rays from the sun, exponential tone map, split-tone grade, grain,
  whip/zoom blur.
- Quality tiers by device, plus adaptive resolution that sheds pixels when frames run long.
- `prefers-reduced-motion`: no autoplay; the end card holds as a still with a Play button.
- No WebGL2: `film/poster.jpg` stands in and the player is hidden.
- Sound only after a click; the score follows the film clock (or the film follows the audio clock
  while sound is on).

Dev helpers: `/?t=12.5&pause` opens on a given frame; `K` play/pause, `J`/`L` ±5 s, `M` sound.
`/?export&w=1920&h=1080` exposes `window.__film.seek(t)` and `window.__film.audio()` for frame-exact
capture (hides all page chrome).

## Local development

```bash
npm install
npm run dev        # wrangler dev — serves public/ on localhost
```

ES modules need a server; opening `index.html` from disk will not run the film.

## Deploy

```bash
npm run deploy     # wrangler deploy
```

CI/CD: pushes to `main` trigger `.github/workflows/deploy.yml` (Cloudflare Workers).
