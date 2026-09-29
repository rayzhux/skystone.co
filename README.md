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
    main.js             # boots the film, player controls, visibility, adaptive resolution
    film.js             # engine: GL context, renderers, camera, motion blur, long-exposure stills
    director.js         # the timeline: film time -> complete frame description
    field.js            # the light field: GPU particles whose positions are pure functions of time
    backdrop.js         # the void the film plays in
    lines.js            # hairlines that draw on (horizon, orbits, lattice, strands, signal)
    post.js             # bloom, light shafts, grade; HDR accumulation for stills
    overlay.js          # titles and the mark, keyed to the same clock
    audio.js            # the score: WebAudio synthesis, live + offline render
    gl.js math.js       # thin WebGL2 + math helpers
    poster.jpg og.jpg   # no-WebGL fallback still and social card, rendered from the film
  stills/               # long-exposure renders of the film's forms, used as the site's imagery
  privacy/index.html    # privacy policy
  404.html              # not-found page
wrangler.jsonc          # Cloudflare Worker config
```

## How the film works

Fifteen seconds at 120 BPM, abstract forms only: a point of light draws a horizon; then one form per
discipline, two seconds each (a spiral galaxy for Investment Advisory, tangled threads combed straight for
Management Consulting, seven orbits falling into one plane for Programme Management, a lattice locking
together under a scan for Implementation & Oversight, a noise field resolving into a signal for Strategic
Insights); everything gathers back into the point and the horizon returns under the mark.

One clock drives everything. `director.evaluate(t)` is a pure function from film time to a frame (camera,
particle forms and morph, lines, backdrop, grade), and `overlay.update(t)` does the same for the DOM
typography. That is what makes the film pausable, scrubbable, loopable and exportable frame-exact.

- Up to a million particles. Each frame the GPU evaluates every particle's position twice, now and a
  shutter-interval earlier, and draws it as a motion-blurred, depth-of-field streak of light.
- Stills are long exposures: many sub-frames summed in HDR before the grade, from a camera of their own.
- Quality tiers by device, plus adaptive resolution that sheds pixels when frames run long.
- `prefers-reduced-motion`: no autoplay; the end card holds as a still with a Play button.
- No WebGL2: `film/poster.jpg` stands in and the player is hidden.
- Sound only after a click; the film follows the audio clock while sound is on.

Dev helpers: `/?t=6.5&pause` opens on a given frame; `K` play/pause, `J`/`L` ±5 s, `M` sound.
`/?export&w=1920&h=1080&n=768` exposes `window.__film.seek(t)`, `window.__film.still(t, opts)` and
`window.__film.audio()` for frame-exact capture (hides all page chrome; `n` sets particles per side).

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
