# The film

The hero of skystone.co is a fifteen-second film rendered live in the browser with WebGL2: no video file, no
libraries, no build step. The same code renders the site's imagery and the exported MP4s.

It is made of abstract light only. There are no buildings, objects or landscapes, by design.

## Timeline

120 BPM, so one beat is 0.5 s and one bar is 2 s. Each discipline gets one bar, and every morph lands on a beat.

| Time | Chapter | Form | What happens |
| --- | --- | --- | --- |
| 0.0–1.5 | Horizon | `POINT` | A point of light ignites at 0.3 s and draws a horizon out from itself. The exported film also shows the name. |
| 1.5–3.5 | Investment Advisory | `SPIRAL` | The point bursts into a spiral galaxy (1.15–2.45): two beaded arms and a golden-angle core that turns faster at its heart. The camera cranes up over it. |
| 3.5–5.5 | Management Consulting | `FLOW` | The galaxy unspools into 64 tangled threads (3.05–3.9). A front then combs them into parallel strands (3.95–5.05); one strand in six is gold. |
| 5.5–7.5 | Programme Management | `RINGS` | The threads curl into seven orbits at different tilts (5.05–5.85). They fall into one plane, and their bright heads line up (6.0–7.0). |
| 7.5–9.5 | Implementation & Oversight | `LATTICE` | The orbits snap into a lattice from the bottom up, with overshoot (7.05–7.95). A scan ring then rises through it (8.05–9.1). |
| 9.5–11.5 | Strategic Insights | `FIELD` | The lattice drops into a field of points (9.05–9.85). The noise settles (9.7–11.1) as a single signal rises through it (10.0–11.0). |
| 11.5–15.0 | Skystone | `POINT` → `HORIZON` | Everything collapses into the point (11.25–12.1), with an impact at 12.1. The horizon spreads again (12.15–13.3) and the mark appears (12.55–14.3). The frame fades to black by 14.97, so the loop is seamless. |

On the site, the page title (top left) stays up through the chapters and steps aside for the mark. Discipline
titles sit lower left, over a soft scrim.

## How it works

One clock drives everything. `director.evaluate(t)` is a pure function from film time to a complete frame
description: camera, particle forms and morph, lines, backdrop and grade. `overlay.update(t)` does the same for
the DOM typography. Nothing accumulates between frames, which is what makes the film pausable, scrubbable,
loopable and exportable frame-exact.

```
director.js  evaluate(t) ─► frame { camera, field, lines, backdrop, post, anchors }
film.js      render(t): evaluate(t) and evaluate(t − shutter), then
             field.simulate ─► backdrop ─► lines ─► field.draw ─► post
overlay.js   update(t): titles and the mark (DOM, letter by letter)
main.js      the player: clock, controls, visibility, adaptive resolution, export API
audio.js     the score: WebAudio synthesis on the same clock, live or rendered offline
```

### The light field (`field.js`)

- **Simulation.** A full-screen pass over a `side × side` float texture computes each particle's position,
  size and colour.
  - Positions come from analytic forms (see below) of particle id, hashed randoms and time.
  - A morph mixes two forms, with per-particle stagger, easing, noise, swirl and lift.
  - The last 10% of particles are ambient dust.
  - About one particle in seventy is a twinkling sparkle.
  - A world-space scan plane can light up whatever it passes through.
- **Motion blur.** The simulation runs twice per frame, at `t` and at `t − shutter`. The draw pass stretches
  each particle into a streak between its two screen positions. Because both positions are pure functions of
  time, blur is exact and independent of frame rate.
- **Draw.** One instanced quad per particle, a gaussian capsule with additive blending into an HDR target.
  - Depth of field widens each disc by its circle of confusion.
  - A particle's light is conserved, spread over its disc and along its streak, so defocus and speed dim it
    rather than brighten it.
- **Particle budgets.** 65k particles on phones, 147k on mid-range machines, 262k on fast desktops and up to
  1M for stills and exports.
  - Energy and size scale with the count, so every tier looks the same.
  - Per-particle energy scales with the render height, so every resolution looks the same.

### Forms

Each form is a GLSL function in `field.js`. Its parameters are set in `director.js` (`formDef`).

| Form | Parameters (`director.js`) | Notes |
| --- | --- | --- |
| `POINT` | radius, lit fraction, brightness | Only 2% of particles are lit while gathered here, so the point never flares. The rest are born as they leave it. |
| `HORIZON` | `HORIZON` half-length, thickness, sun fraction, sun radius | A band brightest at its centre, with a small sun on it. |
| `SPIRAL` | `SPIRAL` R, cone height, spin, arms, tightness, thickness | Three populations by index range: arms (spine, envelope, knots), golden-angle seeds, and a halo. Rotation is differential. |
| `FLOW` | `FLOW` length, width, speed, lanes, front, front width, tangle amplitude, frequency, twist | Tangle noise runs along each thread, so a tangled thread is still a line. The front moves via `flowFront(t)`. |
| `RINGS` | `RINGS` radius, speed, alignment | Ring orientations are `uRing[7]` matrices from `ringFrames(t)`, and the line layer uses the same matrices. |
| `LATTICE` | `LATTICE` half-size, nodes per axis, spherical crop | Transformed by `latticeMat(t)`; the matching line set is built in `lineSets()`. |
| `FIELD` | `FIELD` size, noise amplitude, noise frequency, signal amplitude, width, phase | A grid of points; `fieldNoise(t)` and `fieldSignal(t)` drive the story. |

### The rest of the frame

- **`lines.js`**: hairlines with trim and draw-on. They cover the horizon, the orbit rings, the lattice edges,
  the combed strands and the signal. The geometry is static; the director only moves, scales and trims it.
- **`backdrop.js`**: the void. It is ink with a slow haze, a warm glow wherever the light is, and a faint
  horizon band.
- **`post.js`**:
  - Dual-filter bloom, light shafts from the sun position, and an exponential tone map.
  - Split tone, vignette and grain.
  - Zoom blur and chromatic aberration, used only on transitions.
  - Impacts are exposure pulses, not white flashes, so the frame never washes grey.
- **Composition**: `camera.shift` is a lens shift. It moves the forms up and right while a title is on screen,
  and up only on tall frames.

## Changing the film

- **Retime or add a chapter.** Keep these in step:
  - `CHAPTERS`, `SEQ`, `CAM`/`TGT`/`FOV`/`ROLL` and the `look()` keys in `director.js`.
  - `TITLES` in `overlay.js`.
  - The bars in `audio.js`.
  - The `is-quiet` window and `POSTER_T` in `main.js`.
  - The `data-seek` values on the service images in `index.html`.
  - The expectations in `tools/check.mjs`.
- **A new form.** Write the GLSL function, give it a `FORM` id, add its parameters to `formDef` and add a
  morph to `SEQ`.
  - Every segment must start exactly where the previous one ended, or particles pop.
  - Check continuity by rendering frames at ±20 ms around each boundary.
- **The look.** Most tuning lives in `look()` in `director.js`:
  - intensity, dust, aperture (depth of field) and shutter (motion blur);
  - the scan, the backdrop glow, and exposure pulses;
  - zoom blur, chromatic aberration, light shafts, bloom and the end fade.
- **Copy.** Chapter titles and the end card are in `overlay.js`. The screen-reader description of the film is
  in `index.html` (`#film-description`).

## Stills, poster and social card

`film.renderStill(t, opts)` makes a long exposure:
- It renders `samples` sub-frames across `span` seconds, each with a shutter covering exactly its slice, so
  trails are continuous.
- It sums them in HDR, adds the last sub-frame again (`head`) for crisp particle heads, and grades once.
- A still can frame its own shot. `camera`, `field` and `post` overrides apply to every sub-frame, and
  `lines: false` drops the line layer.

`tools/stills.json` holds every image on the site and its exact settings. Each still is rendered at 2× with a
million particles, then downsampled:
- the five discipline images;
- the contact horizon, lifted into the upper third;
- `film/poster.jpg`, the fallback when the live film cannot run;
- `film/og.jpg`, the social card.

```bash
npm run stills                           # all of them
node tools/stills.mjs horizon poster     # just some
```

Rendering is deterministic: re-rendering an unchanged job reproduces the same file.

## Exports

```bash
npm run export          # exports/skystone-film-3840x2160.mp4, -1920x1080.mp4, -1080x1920.mp4
node tools/export.mjs tall
```

The export works in three steps:
1. The score is rendered offline from the same cue sheet the site plays live.
2. Every frame is captured frame-exact at 2×, with a million particles.
3. The frames are encoded with H.264 (CRF 18) and AAC audio.

The vertical cut recomposes itself: wider field of view, lens shift upward and larger type.

## Fallbacks and accessibility

- **`prefers-reduced-motion`**: no autoplay. The end card holds as a still, with a Play button.
- **No WebGL2, float render targets unavailable, or the context is lost**: the poster stands in and the
  player hides. The poster is only fetched in that case.
- **No JavaScript**: a `<noscript>` poster is shown.
- **Sound**: only after a click. While sound is on, the film follows the audio clock.
- **Off-screen**: the film stops rendering when the practice section covers it, or when the tab is hidden.

## Performance

These are render costs (GPU-synchronised, ms per frame) measured with `npm run perf` on an Apple-silicon
laptop. Each range spans the machine idle and cool, and the same machine under sustained load.

| Profile | Resolution | Particles | Average | Slowest moment |
| --- | --- | --- | --- | --- |
| Laptop (Retina) | 2040×1275 | 262k | 8–15 ms | 12–34 ms (the lattice-to-field morph, 9.6 s) |
| Desktop 1080p | 1920×1080 | 262k | 8–13 ms | 13–19 ms |
| Phone profile | 624×1350 | 65k | 4–7 ms | 6–9 ms |

The budget is 16.7 ms. When frames run long, the page lowers its render scale (down to 50%) and raises it again
when there is headroom, so slower machines trade resolution, not frame rate. Numbers on other GPUs will
differ; run `npm run perf` there.
