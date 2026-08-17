# Movie page — performance measurement (Lighthouse, 2026-08-16)

**What was measured:** the movie page (`/movie/it-1927`) on production after the
perf pass (PR #16: eager high-priority player + poster preload + Plex Mono 500
preload) and the follow-up (deploy #76: `fetchpriority="high"` on the poster
preload itself).

## Results (Chrome headless, Lighthouse 13.4.1, mobile-emulation)

| Metric | Baseline (documented) | After (warm path) |
|--------|----------------------|-------------------|
| Performance | 75–99 (spread) | **98** |
| Accessibility | 100 | **100** |
| Best practices | 96 (archive.org iframe flag) | **96** (unchanged) |
| SEO | 100 | **100** |
| LCP | spread blamed on archive.org image latency | **1.8–2.2s** |
| TBT | — | **0 ms** |
| CLS | 0 | **0** |
| FCP | — | **1.8s** |
| Speed Index | — | **1.8–2.7s** |

## LCP breakdown (warm, run with the poster preload live)

- Time to first byte: ~100 ms (edge-cached — see below)
- Resource load delay: **4–7 ms** (the preload means the poster fetch starts at
  parse time; there is no discovery delay)
- Resource load duration: 590–800 ms (archive.org image transfer)
- Element render delay: ~25–38 ms
- LCP element confirmed: `div.movie > div.movie-main > div.movie-body > img.movie-poster`

Lighthouse's LCP discovery checklist: **all three pass** after deploy #76 —
`fetchpriority=high` applied (poster request traced at `High` priority), request
discoverable in the initial document, and no `loading="lazy"` on the LCP
resource.

## Edge caching and TTFB (probe, production)

- Cold path (cache-busted URL → origin → archive.org metadata fetch): TTFB
  **2.3s**, and it can spike to **12.4s** when archive.org metadata is slow (a
  Lighthouse cold run caught it).
- Warm path (canonical URL, edge HIT): TTFB **80–90 ms**, `cf-cache-status:
  HIT`, `cache-control: public, max-age=300`.
- Every real visitor after the first per-5-minute window hits the warm path —
  the 12s cold case is a cache-miss-only tail, not the visitor experience.

## Early Hints (103) — already enabled, no code needed

- Cloudflare's Pages blog and Workers docs: **Early Hints (with automatic HTML
  `<link>` → `Link:` header parsing) is enabled automatically for all
  `pages.dev` domains** — this site is `347movies.pages.dev`.
- Cloudflare caches the preload/preconnect `Link` headers from a 200 and sends
  them as a **103 Early Hints** response on subsequent requests, so the browser
  starts fetching the poster/fonts while waiting for the HTML. This is exactly
  the resource set the perf pass added (`<link rel="preload" as="image">` for
  the poster, preconnect to archive.org, the three font preloads).
- No Worker code can (or needs to) emit 103 itself — Cloudflare synthesizes it
  at the CDN from the Link headers. The one manual caveat: a custom domain
  would need the Early Hints toggle on in the dashboard (Speed → Content
  Optimization); the pages.dev domain already has it.

## Report artifacts

- `docs/reports/movie.json` — cold-path run (cache-busted URL)
- `docs/reports/movie-warm.json` — first warm run (98, LCP 1.8s)
- `docs/reports/movie-final.json` — final warm run after deploy #76 (98, LCP
  2.2s, priority checklist all-green)
