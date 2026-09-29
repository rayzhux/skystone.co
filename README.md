# skystone.co

Marketing site for **Skystone Partners**: investment advisory and management consulting, Dubai.

The hero is a fifteen-second film of abstract light, rendered live in the browser with WebGL2: no video file,
no libraries, no build step. It has one form for each of the five disciplines. The site's imagery and the
exported MP4s are rendered by the same code.

It is deployed as a Cloudflare Worker with static assets; pushes to `main` deploy to production.

- [docs/FILM.md](docs/FILM.md): how the film works, its timeline, and how to change, render and export it
- [docs/DESIGN.md](docs/DESIGN.md): positioning and content rules, type, colour, layout, motion and imagery

## Quick start

```bash
npm install
npm run dev        # wrangler dev: the site as the Worker serves it
npm run serve      # or a plain static server for public/ on http://127.0.0.1:8765
```

ES modules need a server; opening `index.html` from disk will not run the film.

Dev helpers:
- `/?t=6.5&pause` opens on a given frame.
- Keys: `K` play or pause, `J`/`L` ±5 s, `M` sound.
- `/?export&w=1920&h=1080&n=768` hides the page chrome and exposes `window.__film.seek(t)`,
  `window.__film.still(t, opts)` and `window.__film.audio()` for frame-exact capture. `n` sets the particle
  count as particles per side.

## Structure

```
public/                 # everything the Worker serves
  index.html            # the one-pager
  styles.css            # Geist type, three colours (ink, paper, one accent), film overlay, sections
  site.js               # nav, reveals, office hours, copy address, process playhead, contact plate
  film/
    main.js             # boots the film, player controls, visibility, adaptive resolution, export API
    film.js             # engine: GL context, renderers, camera, motion blur, long-exposure stills
    director.js         # the timeline: film time -> complete frame description
    field.js            # the light field: GPU particles whose positions are pure functions of time
    backdrop.js         # the void the film plays in
    lines.js            # hairlines that draw on (horizon, orbits, lattice, strands, signal)
    post.js             # bloom, light shafts, grade; HDR accumulation for stills
    overlay.js          # chapter titles and the mark, keyed to the same clock
    audio.js            # the score: WebAudio synthesis, live and offline
    gl.js math.js       # thin WebGL2 and math helpers
    poster.jpg og.jpg   # no-WebGL fallback and social card, rendered from the film
  stills/               # long-exposure renders of the film's forms, used as the site's imagery
  privacy/index.html    # privacy policy
  404.html              # not-found page
  _headers              # caching and security headers
tools/                  # render, export and check tooling (not deployed)
docs/                   # FILM.md, DESIGN.md
wrangler.jsonc          # Cloudflare Worker config
```

## Tools

These run the real site in headless Chromium with the GPU on. Each starts its own local server for `public/`
unless given a URL.

| Command | What it does |
| --- | --- |
| `npm run check [-- https://skystone.co]` | Runs the functional checks: player, chapters, fallbacks, reduced motion, 404, content rules. Exits non-zero on failure. |
| `npm run perf` | Reports render cost per moment of the film on laptop, desktop and phone profiles. |
| `npm run stills [-- name …]` | Renders the site's imagery from `tools/stills.json` into `public/`. |
| `npm run export [-- wide\|tall]` | Exports the film to MP4 in `exports/` (4K, 1080p and vertical, with the score). |

Requirements:
- Playwright is intentionally not a dependency, so CI never installs it. Install it with
  `npm i --no-save playwright && npx playwright install chromium`, or set `PLAYWRIGHT_PATH` to an existing
  install. `CHROMIUM_PATH` selects a specific browser build.
- `stills` needs `ffmpeg` and `cwebp`; `export` needs `ffmpeg`.
- The check reads extra excluded terms from `tools/banned.local.txt`, which is not committed.

## Deploy

Push to `main`. `.github/workflows/deploy.yml` deploys to Cloudflare Workers. To deploy by hand, run
`npm run deploy`.

Caching (`public/_headers`):
- HTML, CSS, JS and film modules revalidate on every load (ETag 304s), so a deploy is never half-applied in a
  returning visitor's browser.
- Images under `/stills/` are cached for a week. Give a replaced image a new filename or a `?v=` query.
