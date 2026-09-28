# skystone.co

Marketing site for **Skystone Partners** — private China–Gulf advisory in Dubai.

The hero is a 40-second brand film rendered live in the browser with WebGL2 — no video file, no
libraries, no build step. Everything else on the page is cut from the same footage.

Deployed as a Cloudflare Worker with Static Assets. Pushes to `main` deploy to production.

## Structure

```
public/
  index.html            # the one-pager
  styles.css            # dusk palette, type system, film overlay, sections
  site.js               # nav, reveals, clocks + office hours, process playhead, frame strip
  film/
    main.js             # boots the reel, player controls, visibility, adaptive resolution
    film.js             # engine: GL context, renderers, camera rig, render order
    director.js         # the shot list: film time -> complete frame description
    overlay.js          # typography + vector layer, keyed to the same clock
    audio.js            # the score: WebAudio synthesis, live + offline render
    shapes.js           # particle target shapes (built in shapes-worker.js)
    world.js            # deterministic city, network, neural cloud, globe, stone
    sky.js particles.js boxes.js lines.js billboards.js globe.js stone.js post.js
    gl.js math.js       # thin WebGL2 + math helpers
    land.png            # 1-bit land mask for the globe (Natural Earth 1:50m)
    stills/             # frames rendered from the film, used as the site's imagery
    poster.jpg og.jpg   # no-WebGL fallback still and social card, also rendered from the film
wrangler.jsonc          # Cloudflare Worker config
```

## How the film works

One clock drives everything. `director.evaluate(t)` is a pure function from film time to a frame
(camera, sky, particle morph, boxes, lines, words-in-the-world, stone, post), and `overlay.update(t)`
does the same for the DOM typography. That is what makes the reel pausable, scrubbable, loopable and
exportable frame-exact.

- 65k GPU particles morph between shapes stored in a float texture (desert → globe → site plan →
  data network → neural cloud → galaxy → a single point → the stone).
- Towers are instanced boxes that mirror the dusk sky; floors assemble with overshoot on 16th notes.
- Post: MSAA, dual-filter bloom, exponential tone map, split-tone grade, grain, whip/zoom blur.
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
