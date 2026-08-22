# 347movies — Living Spec

This file tracks what 347movies is and its actual project status. It is a living document: update it as phases complete and decisions get made. It always reflects ground truth, not intentions — if something is unverified, it is marked unverified, not done.

Governed by `constitution.md` — read that first; it doesn't change. This file does.

---

## 1. What 347movies is

347movies is a **free movie website**: watch full films in the browser with zero cost, zero accounts, and zero ads interrupting the movie. It streams **public domain and Creative Commons films** embedded from the Internet Archive, so storage and bandwidth for video cost nothing. The site earns money from **non-intrusive sidebar/leaderboard ads** and **disclosed affiliate links** (rental/purchase links for popular films that are not free anywhere). It is legal-only by constitution: no pirated content, ever.

The name is a nod to the free-movie sites people actually want ("123movies" energy) without any of the piracy. Same promise — free movies, no interruptions — but built to last.

## 2. Core experience

- **Home** — featured and recent public-domain films, genre chips, search bar.
- **Search** — full-text search over the catalog (title, year, genre, description, actors).
- **Browse** — filter by genre (film noir, western, sci-fi, horror, silent, comedy, drama) and decade.
- **Movie detail** — poster, synopsis, year, runtime, genre, director/creators, and the embedded player (ad-free, from archive.org). Sidebar holds display ads and, where relevant, an affiliate rental link with disclosure.
- **Watchlist** — optional, privacy-first: save films with a Save/Saved toggle on every card
  and the film page; saved films live only in the visitor's browser `localStorage` (no
  accounts, never sent to any server). Cleared with one button or browser site data.
- **Static pages** — about, privacy, terms, 404. Fast, clean, mobile-first.

The movie player is an iframe to the Internet Archive embed (`https://archive.org/embed/<identifier>`). Archive.org serves the video bytes; we serve only the page around it.

## 3. Architecture (Cloudflare-only)

| Layer | Technology | Role |
|---|---|---|
| Front end | Static HTML/CSS/vanilla JS on **Cloudflare Pages** | Fast, cacheable, no build step heavier than needed; progressively enhanced |
| API | **Cloudflare Pages Functions** (Workers runtime) | Catalog search, movie metadata, genre lists — server-side fetch + validation + rate limiting |
| Cache | **Cloudflare KV** | Cache normalized archive.org results (TTL 24h) so repeated hits don't re-hit archive.org |
| Edge | Cloudflare CDN + WAF + bot fight mode | TLS, caching, attack filtering |
| Video | **Internet Archive** (external, embedded) | The only place video lives — we never store or proxy film bytes |

### Data flow

1. Browser requests `GET /api/browse?...`, `GET /api/search?q=...&page=N`, `GET /api/movie/<identifier>`, `/sitemap.xml`, or `/api/random`.
2. Worker validates inputs (query length ≤ 80 chars, identifier matches `^[A-Za-z0-9._-]{1,120}$`).
3. **Catalog paths read the local catalog index** (`lib/catalog-index.ts`): one edge-cached
   copy per pool — seventeen indexes (films, tv, anime, cartoons, otr, music, documentaries,
   sports, shorts, silents, publictv, science, govfilms, audiobooks, records, ephemera, space), each built once per
   24h per colocation from a single no-page `advancedsearch.php` request, in-isolate 30-min
   copy, stale-serve on refresh failure. `/api/browse` filters/sorts/pages it in-memory
   (whole catalog pageable — the old 100-page/2,400-film cap is gone); `/sitemap.xml` and
   `/api/random` read them too. Zero archive.org calls per request on these paths.
4. **Search stays live on archive.org** (`advancedsearch.php`, license-gated): relevance/
   stemming/full-text beats a local substring match, so quality is preserved.
5. **Movie detail** calls `metadata/<identifier>` (full record: title, description, creators,
   year, genres, subjects, thumbnails, runtime) with one retry on transient 5xx; results are
   normalized into a typed record and rendered as SSR HTML with the archive.org player embed.
6. Results are normalized into a typed movie record, edge-cached, and returned.

No user data is stored. No accounts exist. The only write paths are cache population, keyed by safe, validated inputs, and aggregate daily page-view counts (validated path buckets only — no IPs, identifiers, cookies, or user agents; disclosed on the privacy page and consumed by the advertise page).

## 4. Movie record

`{ identifier, title, year, description, genres[], creators[], subjects[], thumbnails{}, runtime, license, source_url }`. License is recorded at ingestion from archive.org metadata and must be public domain or Creative Commons for inclusion (constitution rule 1).

## 5. Security model (hardened by design)

- **Headers on every response:** `Content-Security-Policy` (allow self, `frame-src https://archive.org` for the embed, `img-src` for posters, no inline scripts unless unavoidable and then hashed), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (no geolocation, camera, mic).
- **Input validation:** all query params length-bounded and pattern-checked; identifiers whitelisted; pagination bounded; JSON responses only.
- **No secrets in the browser.** No API keys client-side. Archive.org needs no key; any future key lives in a Worker binding.
- **Rate limiting** on every route that can hit the origin/upstream on a cache miss —
  `/api/*`, SSR `/movie/*`, `/sitemap.xml` (per-IP window, 429 on exceed). Static assets
  served from the CDN are never throttled. Limiter is in-memory per isolate (documented
  caveat: move to Durable Objects if the site ever runs many isolates).
- **No debug routes, no admin endpoints, no back doors** in production. Fail closed on unknown input.
- **Cloudflare WAF + bot fight mode** enabled; TLS enforced (HSTS preload target).
- **Dependency hygiene:** zero or minimal npm dependencies; pinned versions; `npm audit` clean.

## 6. Monetization

1. **Display ads** — one sidebar slot and one leaderboard slot, never over or in the player (vow 2). Ad code lives in clearly marked containers so placement stays reviewable.
2. **Affiliate links** — Amazon Associates (and similar) rental/purchase links on film pages where the film is not freely watchable; always disclosed (vow 8).

## 7. Non-goals

No user accounts, no comments/social, no paywalls, no premium tier, no self-hosted video, no piracy-adjacent sources, no data selling, no app stores in the first release.

## 8. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **1 — Foundation** | Repo scaffold, Cloudflare Pages project, Worker stub, security headers, deploy pipeline | Site deploys to Cloudflare; headers verified live |
| **2 — Catalog** | archive.org API integration, normalization, KV cache, ingestion script | Real films searchable from archive.org, cache hit verified |
| **3 — Pages** | Home, search, browse, movie detail with embedded player, static pages | All pages render from real API data; player plays a real PD film |
| **4 — Monetization** | Sidebar/leaderboard ad slots, affiliate links with disclosure | Ads and affiliate slots live, non-intrusive, verified |
| **5 — Hardening** | Rate limits, CSP audit, WAF, tests, error handling, 404s | Security checklist green; tests pass; no console errors |
| **6 — SEO & polish** | Meta tags, sitemap, robots, Open Graph, performance pass, mobile check | Lighthouse green on mobile; sitemap valid |
| **7 — Production launch** | Final deploy, live verification, changelog entry | Site live on Cloudflare, verified end-to-end |

## 9. Current status

**LIVE at https://347movies.pages.dev (deployed 2026-08-15).** Phases 1–6 are built and
verified; Phase 7 (production launch) is deployed and verified end-to-end on the live URL.
All claims are backed by raw proof in `changelog.md` and `tasks.md`.

**Known production gaps (unverified, not faked):**
- **KV namespace** could not be created — the deployed API token is Pages-scoped (auth error
  10000 on KV operations). A Cloudflare-native **edge response cache** (Cache API,
  `cf-cache-status: HIT` verified) substitutes now; KV is the documented 24h upgrade path.
- **WAF / bot fight mode / zone TLS settings (T1.5)** need zone-level access the token lacks.
- **Real ad network rendering and live affiliate links** — nothing configured, nothing
  renders, by constitution §4/§12 and vow 8.
- **Lighthouse** — done (2026-08-15, headless Chrome against the live site): home/about 100×4,
  movie 99-100/100/96/100, browse 98/100/100, search 100/100/100; accessibility 100 everywhere;
  CLS 0 everywhere (0.021 search). The only remaining flags are the deliberate `noindex` on
  dynamic pages (SEO 66) and archive.org's own third-party iframe cookies.

Phase status detail:

| Phase | Status | Evidence |
|---|---|---|
| 1 — Foundation | Deployed & verified | `npm install` clean, headers verified live via `curl -I`, `/api/health` 200 live; WAF/bot-fight settings blocked on token scope |
| 2 — Catalog | Deployed & verified | Local catalog index (18,488 legal-marked films) serves browse/sitemap/random with zero per-request upstream calls (verified live: film-noir 177 = Solr 177 exact, warm browse 0.36s, whole catalog pageable); search stays live on archive.org for relevance; fuzz/edge cases return 400/404/429 live |
| 3 — Pages | Deployed & verified | Home/search/browse/detail/static pages render from real API data; It (1927) plays in the archive.org embed ad-free; 404 returns 404 live |
| 4 — Monetization | Slots live; loader mechanism built + dormant; rendering pending a real network contract | Marked sidebar/leaderboard slots live (never over player) with a real advertiser contact (contactae2000@gmail.com) + `/about#advertise`; ad loader mechanism built + tested (lib/ad.ts + /api/ad-config + client bootstrap, Decision 001) and provably dormant — `enabled:false`, zero third-party scripts on every page; affiliate mechanism unit-tested; nothing fake renders (constitution §4) |
| 5 — Hardening | Deployed & verified | 55/55 tests, `npm audit` 0, header/CSP audit, back-door grep sweep clean |
| 6 — SEO & polish | Deployed & Lighthouse-verified | Per-film OG/canonical verified live, sitemap.xml (full catalog — one sub-sitemap per pool under a sitemap index) + robots.txt live, `/api/*` carry `X-Robots-Tag: noindex`, structured data live (VideoObject+BreadcrumbList, WebSite/SearchAction, Organization, CollectionPage with `isPartOf` for curated views); Lighthouse green on every page type (see current status); the 0.72 CLS on browse/search was fixed with skeleton grids; curated-view canonical strategy documented (Decision 002) |
| 7 — Production launch | **DEPLOYED & verified live** | `wrangler pages deploy` succeeded; live walkthrough: all routes 200, player embed present, headers verified, 404 works |

**Catalog size (live, verified 2026-08-22):** nineteen pools, all under the same license gate:
films (18,491) + TV (2,513) + anime (24) + cartoons (1,308) + radio (2,309) + music (1,456) +
documentaries (8,420) + TED (2,933) + sports (3,625) + shorts (1,858) + silents (729) + public
broadcasting (1,653) + science (257) + government films (5,948) + audiobooks (18,349) +
vintage records (5,039) + ephemeral films (413) + space & NASA (719) + vintage footage (445)
≈ **76k items** across the sitemap. The `films=1` view (episodes + trailers + teasers + music
videos + serial chapters/parts excluded — Solr-identical, verified 2026-08-16) serves the
feature-film subset; 138 film-noir; 533 in the 1920s decade. The sitemap deliberately lists
every pool's items, split into one sub-sitemap per pool under a sitemap index (every playable
legal page, including trailers/episodes reachable by direct URL, and each file under the 50k
protocol ceiling).

### Curated-view canonical strategy (Decision 002)

Some pool landing pages are 100% subsets of another pool — every item in `/shorts` and
`/silents` also appears in the films union (`/browse`), and every item in `/ted` also appears
in `/documentaries`. These are **curated views**: distinct category landing pages that target
different queries ("short films free", "silent films online", "TED talks free") but share
their items with a parent catalog.

**Canonical decision: stay self-canonical.** Curated-view pages keep
`<link rel="canonical" href="…/shorts|silents|ted">` — they do **not** point canonical
at their parent (`/browse` or `/documentaries`). Canonical means duplication, not
hierarchy; pointing it at the parent would de-index the landing pages and kill their SERP
rankings. The subset relationship is expressed on the correct channels instead:

1. **JSON-LD `isPartOf`** → the parent catalog's `CollectionPage` (schema.org's vocabulary
   for "curated view of that catalog" — machine-readable hierarchy, not duplication).
2. **Visible hero note** — a "Curated view" badge on the landing page heading.
3. **SERP meta description** — the disclosure appears in the search snippet.
4. **Sitemap annotation** — the sub-sitemap carries the curated-view relationship.

The smoke suite guards all four channels (the disclosure guard block asserts that the
curated-view count is exactly 3 — shorts, silents, TED — and that each page's canonical
points at itself, not at the parent).

**Pools measured as fully disjoint** (documentaries, sports — 0 items also in the films
union, re-verified 2026-08-21) carry no curated-view label; every title is unique to its
own pool. The measurement is recorded at the gate definitions in `lib/archive.ts` so a
future session won't re-measure or mislabel them.

See `docs/decisions/002-curated-view-canonical.md` for the full decision record.

### YouTube short films (/shortfilms)

A second content source beyond archive.org: Creative Commons short films streamed
**embedded from YouTube** (privacy-enhanced `youtube-nocookie.com` player — the site never
hosts or stores video). The page keyword-targets "short film / short films / small film /
indie film / small films" in its title, meta description, hero copy, and keyword chips.

**License gate (YouTube equivalent of the archive gate):** the search is filtered server-side
to `videoLicense=creativeCommon` + `videoEmbeddable=true` + `type=video` +
`videoDuration=medium` (4–20 min, the short-film sweet spot) + `safeSearch=strict`
(`lib/youtube.ts`), so every embed is legally reusable content — never a pirated rip.

**Dormant until configured** (same pattern as the ad network): `YOUTUBE_API_KEY` is a
server-side secret (never rendered to the browser). Until it's set, `/api/youtube` returns
`{ enabled: false }` and the page shows an honest pending note linking to the archive's
shorts. When set, the CSP relaxations (youtube-nocookie frame-src, i.ytimg img-src) apply
conditionally in the middleware; the static `_headers` CSP carries the hosts inertly, exactly
like the ad hosts.

**How to enable:** create a YouTube Data API v3 key in Google Cloud Console (enable the
"YouTube Data API v3"), then add it as a Pages secret `YOUTUBE_API_KEY` (never in the repo
or `_headers`).
