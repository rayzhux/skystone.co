# Design

skystone.co is a one-page site for Skystone Partners, an advisory firm in Dubai. A fifteen-second film of
abstract light is the hero (see [FILM.md](FILM.md)), and everything else is quiet, readable and built from
three colours.

## Positioning and voice

- **What the firm does.** Investment advisory and management consulting. The page presents five disciplines:
  Investment Advisory, Management Consulting, Programme Management, Implementation & Oversight, and Strategic
  Insights. The line is *Investment. Insights. Implementation.*
- **Voice.** Plain, senior and calm. Short sentences, no jargon, and not too technical. Say what we do and
  how; avoid adjectives about ourselves.
- **Language.** English only.

### Content rules

- **No names.** Never name clients, counterparties, programmes or individuals, and make no partnership or
  affiliation claims with named firms.
- **Legal copy stays verbatim.** That covers the footer disclaimer, the privacy page, `© 2024–2026`, and the
  legal name *Skystone Partners L.L.C-FZ* in the footer and structured data.
- **Retired positioning stays gone.** Construction, real estate and the earlier regional framing no longer
  describe the firm and must not come back.
- **The check guards this.** `npm run check` fails if retired terms appear on the page. Private terms can be
  added to `tools/banned.local.txt`, which is not committed.

## Type

One family: **Geist**, with **Geist Mono** for figures. Both are loaded from Google Fonts, Geist at weights
300–800.

| Role | Size | Weight | Notes |
| --- | --- | --- | --- |
| Display (section titles) | `clamp(44px, 6.2vw, 108px)` | 600 | Tracking −0.045em. The second clause is set in **300** and a second colour instead of italics (Geist has none). |
| Lede | `clamp(22px, 2.2vw, 34px)` | 400 | Tracking −0.025em |
| Body | 17px / 1.65 | 400 | 16px on phones |
| Kicker | 14px | 500 | Mono index number (`01`), a short rule, then the label |
| Hero title (h1) | `clamp(20px, 1.6vw, 26px)` | 500 | Modest on purpose: the film is the hero |
| Film chapter titles | `clamp(34px, 4.6vw, 92px)` | 600 / 300 | Two lines, lower left, with a mono counter and an accent rule |
| End card mark | `clamp(54px, 8.4vw, 168px)` | 600 | Tracking −0.055em, with the accent dot |

Tall frames (phones and the vertical film cut) step the film's type up; see `@media (max-aspect-ratio: 4/5)`.

## Colour

Three colours, plus alpha steps of the first two.

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#0B0C10` | Page background and dark sections; text on paper |
| `--paper` | `#F4F2EE` | Light sections; text on ink (`--paper-88/72/56` for secondary text, `-24/-14` for rules) |
| `--accent` | `#F2A65E` | The sun dot, primary button, kicker numbers and emphasis on ink, and light in the film |

On paper sections, emphasis uses `--ink-60`, never the accent: accent text fails contrast on paper. Secondary
text never drops below `--paper-72` on ink or `--ink-72` on paper. There are no coloured glows; shadows are
neutral ink.

## Layout

In order down the page:

1. **Hero:** the film is full-bleed and sticky, with the page title at top left and the player along the
   bottom. As the next section slides over, the film scales back slightly and dims.
2. **01 Practice:** on paper. Display title, lede, two columns and four facts.
3. **02 Services:** on ink. Five disciplines, each with a still from the film that jumps to its chapter; two
   large items, then three.
4. **03 Process:** on paper. Four stages with a playhead that follows the scroll.
5. **04 Clients:** on ink. Four client types.
6. **05 Contact:** on ink. The horizon image has its own band at the top, so no line of light runs behind
   text. Below it sit the email button, copy button, office, hours (with live open or closed status) and
   languages.
7. **Footer:** wordmark, line, disclaimer, legal name and privacy link.

The gutter is `clamp(20px, 4.2vw, 72px)` and the maximum width is 1440px. The phone breakpoint is 760px; at
1100px the grids collapse to two columns.

## Motion

- **Site:** reveals rise 24px and fade in over 1.1 s on `cubic-bezier(0.16, 1, 0.3, 1)`, staggered 90ms
  within a group. The film scales under the practice section, the process playhead scrubs with scroll, and the
  contact plate eases in scale. Only transform and opacity animate.
- **Film:** see [FILM.md](FILM.md).
- **Reduced motion:** reveals are static, the film holds its end card, and scroll-linked transforms are off.

## Imagery

- **Abstract light only.** Every image is rendered from the film's forms as a long exposure: the galaxy,
  combed threads, aligning orbits, lattice and scan, and the signal through noise, plus the horizon. No stock
  photography and no literal objects.
- **The look.** A deep ink void, crisp particles, a few bright highlights, warm accent on heads and signals,
  and restrained bloom.
- **Sizes.** Images are 1600×1000 WebP (16:10); the contact plate is 2400×1350. They are decorative
  (`alt=""`), because the adjacent headings carry the meaning.
- **Adding or replacing one.** Edit `tools/stills.json` and run `npm run stills`.

## Accessibility

- A skip link, visible focus (accent on ink, ink on paper), and ARIA on the player (a slider with value text,
  and pressed state on the sound button).
- The film has a screen-reader description (`#film-description`). The overlay and canvas are `aria-hidden`.
- There are fallbacks for reduced motion, no WebGL and no JavaScript (see [FILM.md](FILM.md)).
