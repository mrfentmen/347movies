# 347movies — shadcn/ui prototype (sandbox)

A **standalone** React + Tailwind + shadcn/ui prototype re-implementing two surfaces of the
live 347movies design system ("The Projection Booth"): the home poster-card grid and the
movie page header (player embed, eyebrow → title → meta chips → save button).

**This is a sandbox, not the site.** The live site (`public/`) stays vanilla
HTML/CSS/JS with zero runtime dependencies by design (constitution / PRELAUNCH-STATUS).
This directory exists purely to let the design system be evaluated side-by-side in a
component-library form — to see what a framework migration would look like, cost, and
trade.

## Why it exists

The shadcn-ui skill's target stack (React 18+, Tailwind, Radix, a build step) does not
exist in the live site and the site's constitution forbids silently introducing it. This
prototype is the honest alternative: the same DESIGN.md tokens, rendered with shadcn
components, in its own directory, untouched by the live deploy (`wrangler pages deploy
public` ships only `public/`; CI typecheck covers only `functions/` and `lib/`).

## Run it

```bash
cd ui-prototype
npm install
npm run dev      # http://localhost:5174
```

## What's here

- `src/index.css` — Tailwind v4 theme mapping the exact DESIGN.md hex values to shadcn
  CSS variables (`--background`, `--primary` = Tungsten Amber `#f2a93b`, etc.), plus the
  three-font role system (Limelight display / Plex Sans body / Plex Mono film-slate).
- `src/components/movie-card.tsx` — poster card on shadcn `Card`, save bar, hover lift,
  amber border warm-up (mirrors `.card` in the live CSS).
- `src/components/movie-header.tsx` — the movie page header on shadcn `Button`/`Badge`:
  archive.org player iframe, "NOW SHOWING" eyebrow, title, year/runtime/genre/license
  chips, Save.
- `src/data/movies.ts` — sample catalog items with real archive.org identifiers.
- `src/App.tsx` — hash-routed home grid ↔ movie page.

## Measured cost of the stack (for the record)

The production build of this minimal two-surface prototype ships **239 KB of JS (75 KB
gzip)** — before any of the site's real features (search, browse, watchlist, genres,
ad slots, TV variant, SSR SEO/OG/JSON-LD). The live site's entire client script is
**29 KB (unminified)**. That delta is the concrete price of the framework; the audit
(`docs/component-abstraction-audit.md`) is the analysis of what it buys.
