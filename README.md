# 347movies

**Free movies. No interruptions. Ever.**

347movies is a free movie website: watch full films in the browser with zero cost, zero
accounts, and zero ads interrupting the movie. It streams **public domain and Creative
Commons films embedded from the Internet Archive** — video is never hosted or stored by us
($0 storage by design). Monetization is transparent: labeled sidebar/leaderboard ad slots
(never over or inside the player) and disclosed affiliate links for films that aren't freely
watchable (never shown for the free catalog). An optional **watchlist** saves films to your
own browser's local storage — no account, nothing ever sent to a server.

Built entirely on Cloudflare: **Pages** (static front end), **Pages Functions** (API),
**KV** (24h catalog cache), and the Cloudflare edge (CDN/TLS/WAF).

## Governance

This project is governed by non-negotiable rules:

- [`constitution.md`](constitution.md) — the rules (legal-only content, verification over
  self-reporting, no mock/placeholder code, ads never interrupt the movie, privacy by
  default, security-first, $0 storage, Cloudflare-only, no silent scope expansion, affiliate
  honesty, leave no errors behind).
- [`vows.md`](vows.md) — the eleven founding promises to viewers.
- [`specs.md`](specs.md) — the living spec and phase tracker.
- [`tasks.md`](tasks.md) — the phased task list with acceptance criteria.
- [`changelog.md`](changelog.md) — the honest decision/evidence ledger.
- [`FOUNDER-CHECKLIST.md`](FOUNDER-CHECKLIST.md) — dashboard steps that need account access.
- [`LAUNCH-RUNBOOK.md`](LAUNCH-RUNBOOK.md) — first-week operations: checks, deploys, outages.

## Architecture

| Layer | Technology | Role |
|---|---|---|
| Front end | Static HTML/CSS/vanilla JS in `public/` | Fast, cacheable, no build step; progressively enhanced |
| API | Pages Functions (`functions/`) | Search, browse, movie records, sitemap — server-side fetch + validation + rate limiting |
| Catalog | Local index (`lib/catalog-index.ts`) | Full legal catalog (~18.5k films) built once per 24h, edge-cached; browse/random query it through the `queryCatalog` seam, sitemap reads the raw union (zero per-request upstream calls; search stays live for relevance); the films-only policy lives in `lib/film-policy.ts` |
| Cache | Edge response cache + in-isolate copies | Normalized results and the catalog index; KV (`MOVIES_KV`) optional 24h layer |
| Edge | Cloudflare CDN + WAF + bot fight mode | TLS, caching, attack filtering |
| Video | Internet Archive (embedded iframe) | The only place video lives — we never store or proxy film bytes |

### Data flow

1. Browser requests `/api/search?q=...&page=N`, `/api/browse?genre=&decade=&sort=&page=`,
   `/api/movie/<identifier>`, or the SSR page `/movie/<identifier>`.
2. The worker validates every input (query ≤ 80 chars and sanitized, identifiers
   `^[A-Za-z0-9._-]{1,120}$`, page 1–100, genre/decade/sort whitelists), checks KV, and on a
   miss calls archive.org's public APIs:
   - `advancedsearch.php` — filtered to the curated film collections
     (`feature_films` OR `prelinger` OR `moviesandfilms`) + `mediatype:movies` + a declared
     license (`licenseurl` = creativecommons.org PD mark or CC license).
   - `metadata/<identifier>` — the full record.
3. Results are normalized into the typed movie record (specs.md §4), cached in KV (24h),
   and returned as JSON (or rendered into HTML for the film page).
4. No user data is stored, ever. The only write paths are KV cache population keyed by
   validated inputs and the privacy-respecting page-view counter — one aggregate daily
   number per validated page bucket, no IPs/identifiers/cookies, disclosed on the privacy
   page, consumed by the advertise page's audience stats (`POST /api/view`, `GET
   /api/views`).

### Legality policy

Every search/browse result must carry a declared license in archive.org's own metadata
(`licenseurl` PD mark / CC license) and sit in one of archive.org's curated film collections
(`feature_films`, `prelinger`, `moviesandfilms` — union ≈ 15,920 legal-marked films, measured
live). The catalog is **fifteen pools**: films, classic TV, anime, cartoons, old time radio,
music & concerts, documentaries, sports, shorts, silent films, public broadcasting, science &
medicine, government films (FedFlix), audiobooks (LibriVox), and vintage records (the Great
78 Project) — every pool under the same license gate (`lib/archive.ts`). The detail path re-verifies the license from full metadata (with a search-index
fallback) and **fails closed**: unverifiable films return 404 and never appear. Dark/removed
items are excluded. The home showcase additionally passes `films=1` to exclude non-film
uploads (serial-episode installments + trailers — Solr-identical, verified 2026-08-15;
search and random apply the same policy server-side). See `lib/archive.ts` and
`lib/catalog.ts`.

## Quick start

```bash
npm install        # pinned dev deps only (wrangler, typescript, workers-types, node types)
npm test           # 115 tests incl. live archive.org integration tests (marked [integration])
npm run typecheck  # tsc -p tsconfig.json + tsconfig.test.json --noEmit
npm run audit      # npm audit (currently 0 vulnerabilities)
npm run smoke      # live smoke test: GET/HEAD matrix, headers, player, API shape, sitemap (+lastmod)
npm run health     # scheduled health battery: typecheck + tests + audit + browser battery +
                    #   production smoke, appends an honest dated pass/fail entry to changelog.md
                    #   (wire to cron/launchd/CI per LAUNCH-RUNBOOK.md)
npm run test:browser  # real-browser battery (Playwright + system Chrome; needs dev server on :8787):
                    #   e2e user flows 24/24, keyboard-only walkthrough 14/14, mobile/notch
                    #   audit 15/15, axe-core WCAG A+AA audit (0 violations)
npm run dev        # wrangler pages dev (local, with KV emulation) on :8787

# Long-tail hanger scanner (founder deliverable, dependency-free, resumable):
# flags catalog items whose archive.org metadata hangs — the ~0.03% served an
# honest 502. Runs in chunks across sessions; see the header for all options.
node scripts/scan-longtail.mjs --limit 200 --timeout 12 --pacing 800
node scripts/scan-longtail.mjs --report KNOWN-HANGERS.md   # after a run
npm run deploy     # wrangler pages deploy public --branch main
```

### KV namespace (required before production deploy)

Create the real KV namespace and paste its id into `wrangler.jsonc`:

```bash
npx wrangler kv namespace create MOVIES_KV
```

### Env bindings

- `MOVIES_KV` — KV namespace (cache). Required in production; local dev emulates it.
- `SITE_URL` — public origin for canonical/OG/sitemap URLs (default `https://347movies.pages.dev`).
- `AMAZON_TAG` — optional Amazon Associates tag. When unset, no affiliate links are rendered.

## API

| Route | Description |
|---|---|
| `GET /api/health` | Liveness: `{"ok":true,...}` |
| `GET /api/search?q=&page=` | Full-text search over the legal catalog (live archive.org relevance, license-gated) |
| `GET /api/browse?genre=&decade=&sort=&page=&films=` | Browse by genre/decade, sort recent/title/oldest; `films` **defaults to 1** (the films-only catalog — episodes, trailers, teasers, music videos, serial chapters/parts excluded → 15,917 films); pass `films=0` to include everything; served from the local catalog index via the `queryCatalog` seam — the **whole catalog is pageable** (no 100-page cap) |
| `GET /api/movie/<identifier>` | Full normalized record (license-verified) |
| `GET /api/random` | 302 to a random catalog film page ("Surprise me") |
| `GET /api/ad-config` | Ad loader config gate (Decision 001): `{ "enabled": false }` until a real network is allowlisted + configured — then the client bootstrap injects its async script; fail-closed, edge-cached 300s |
| `GET /movie/<identifier>` | Server-rendered film page: archive.org embed, OG tags, JSON-LD VideoObject, save-to-watchlist button |
| `GET /watchlist` | Your saved films — rendered from your browser's local storage (no server) |
| `GET /sitemap.xml` | Sitemap index: 23 static pages + every catalog item across all fifteen pools, split into one sub-sitemap per pool (~72k URLs, built from the local catalog indexes) |

### Surprise me (`/api/random`)

The home and browse pages offer a "Surprise me" link that redirects to a random film. The
endpoint fetches our own edge-cached sitemap (never archive.org when warm), parses the movie
URLs, picks one at random, and 302-redirects — uniform over every item in all fifteen pools
(the sitemap lists every catalog item). One random per request; rate-limited
like every `/api/*` route; `noindex` via middleware. See `changelog.md` for the
verification record (6/6 random landings playable in the stress test).

All dynamic routes — `/api/*`, SSR `/movie/*`, and `/sitemap.xml` — are per-IP rate limited
(60 req/min window; 429 on exceed), validate all inputs (400 on invalid, never a crash or
unvalidated upstream call), and set hardened security headers. Static CDN assets are never
throttled. API responses also carry `X-Robots-Tag: noindex`. Responses are JSON (or HTML/XML for the render routes).

## Security

- Hardened headers everywhere: CSP (`frame-src https://archive.org` only, no inline
  scripts/styles), HSTS (+preload), `nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy`, `Permissions-Policy` (no camera/mic/geolocation).
- Input validation on every parameter (see above); fail closed on unknown input.
- Rate limiting on all API routes; in-memory per-isolate window (see changelog for the
  Durable Objects note if the site grows).
- No secrets in the browser; the only env-bound values are documented above.
- No debug routes, no admin endpoints, no back doors; `npm audit` clean; deps pinned exact.

## Verification evidence

**Live at https://347movies.pages.dev** (deployed 2026-08-15). `npm run smoke` re-verifies the
whole site against the live URL in one command (status matrix for GET and HEAD, security
headers, player embed, API shape, sitemap floor). Lighthouse (headless Chrome) scores
against the live site: home/about 100×4, movie 99-100/100/96-100/100, browse 98/100/100,
search 100/100/100 — accessibility 100 everywhere, CLS 0 everywhere (see changelog,
deploys #35–#36). End-to-end verification was
performed against the live archive.org APIs and the production URL (raw output in
`changelog.md`): real searches return real legal films (catalog expanded to fifteen
pools across the archive's curated collections), edge cache hits cut
response time from ~0.63 s to ~0.13 s (local: 0.65 s → 0.004 s; `cf-cache-status: HIT`),
edge cases (empty/huge queries, traversal, invalid identifiers, out-of-bounds pagination,
rate-limit bursts) behave per spec, security headers verified on every page and API response,
the sitemap covers 71,992 URLs (all fifteen pools, split into per-pool sub-sitemaps, with `<lastmod>`),
ad slots carry the advertiser contact (contactae2000@gmail.com), and the archive.org embed
plays a real public domain film (It, 1927) ad-free. Browser-level rendering was verified
locally against the identical code (screenshots + clean console).

## KV cache status

The deployed API token is scoped to Cloudflare Pages only and **cannot create/manage Workers
KV** (verified: auth error 10000). The site runs with a Cloudflare-native **edge response
cache** (`lib/edge-cache.ts`, Cache API — no namespace or permissions needed) plus the local
catalog index (deploy #37), which together remove nearly all per-request upstream calls. KV
is now an optional 24h layer for movie-metadata revisits (see the runbook's crawl-pressure
section for the honest scope). To add it, run with a token that has Workers KV permissions:

```bash
npx wrangler kv namespace create MOVIES_KV
```

paste the id into `wrangler.jsonc` (instructions are in the file), and redeploy. The code
uses KV automatically when the binding exists.

## Notes

- The `347movies/` folder is currently ignored by the parent workspace repository's
  `.gitignore`; initialize git inside this folder if you want it tracked.
- Cloudflare Pages serves clean URLs automatically: `/browse.html` → `/browse` (308). All
  internal links use the canonical extensionless forms.
