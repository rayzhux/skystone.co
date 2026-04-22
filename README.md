# skystone.co

Marketing site for **Skystone Partners** — private real estate advisory in Dubai.

Deployed as a Cloudflare Worker with Static Assets. Pure HTML + CSS, no build step.

## Structure

```
public/
  index.html        # one-pager
  styles.css        # design tokens + responsive layout
  images/           # self-hosted photography
wrangler.jsonc      # Cloudflare Worker config
package.json
```

## Local development

```bash
npm install
npm run dev        # wrangler dev — serves public/ on localhost
```

Or just open `public/index.html` directly in a browser.

## Deploy

```bash
npm run deploy     # wrangler deploy
```

CI/CD is wired to Cloudflare Workers Builds — pushes to `main` on GitHub
trigger a production deploy automatically.

## Design

Direction C — "Moody Gallery": full-bleed cinematic photography, Instrument
Serif display, single ochre accent. See the original handoff bundle for
tokens, copy, and rationale.
