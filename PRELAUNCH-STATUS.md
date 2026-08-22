# 347movies — Pre-launch status (one page)**Last updated 2026-08-22 after 78 verified deploys.** The site is production-ready within
 every constraint that does not require your Cloudflare account access. This page is the
2-minute summary; the evidence ledger is `changelog.md`, the operations guide is
`LAUNCH-RUNBOOK.md`, and the account-access checklist is `FOUNDER-CHECKLIST.md`.

## State at a glance

| Area | Status |
|---|---|
| Live site | ✅ https://347movies.pages.dev — every route verified 200/400/404 |
| Catalog | ✅ **17 pools** (~73k items in the sitemap): films (15,920), TV (2,514), anime (24), cartoons (1,308), radio (2,309), music (1,455), documentaries (8,417), sports (3,625), shorts (1,858), silents (729), public broadcasting (1,653), science (257), government films (5,947), audiobooks (18,344), vintage records (5,038), ephemeral films (413), space & NASA (719) — all license-gated at build, fail-closed |
| Browse | ✅ 15,917 films (episode+trailer+teaser+music-video+serial-chapter/part exclusion, Solr-identical — verified live 2026-08-16: 15,917 = 15,917, and the observed music-video identifier is gone from films-only search); genre/decade/sort filters incl. **`sort=newest` as the default (release-year descending)** and a **`q=` title-keyword filter** (ANY token ≥3 chars, fail-closed on empty) plus a **From-year filter** (`from=1920…2020&to=2020`, mutually exclusive with decade); **whole catalog pageable** (664 pages — old 100-page cap gone), served from the index with zero per-request upstream calls |
| Classic TV | ✅ `tv=1` serves the curated **`classic_tv`** pool under the SAME license gate — **2,514 legal-marked items** (Twilight Zone, Bonanza, The Lone Ranger, The Beverly Hillbillies, Fleischer cartoons…; episodes ARE the content, so no films-only filter); Classic TV + **1960s TV** home sections, /browse?tv=1 chip with decade/sort/q filters, **search TV (`/search?q=X&tv=1`)**; separate index — films/sitemap/random untouched; `tv=banana` → 400 |
| Search | ✅ Live archive.org relevance search (license-gated, same films-only policy), edge-cached per query |
| Watchlist | ✅ Browser-local only (no server data), Save buttons on cards + film pages |
| Player | ✅ archive.org embed verified playing a real film in a browser |
| Surprise me | ✅ `/api/random` → random film; on home + browse |
| Poster fallbacks | ✅ Broken thumbs auto-swap to initials tiles (cards + film pages) |
| Sitemap | ✅ **73,125 URLs** — a sitemap index (`/sitemap.xml`) pointing at one sub-sitemap per pool (18 files, each under the 50k protocol limit) with `<lastmod>`, canonical self-heals |
| SEO/social | ✅ OG tags + `og:image` on home, noindex on API, robots.txt; visible breadcrumbs (Home / Title) now mirror the JSON-LD BreadcrumbList on every movie page (deploy #54); full IA audit in docs/site-architecture.md |
| Security | ✅ CSP/HSTS/nosniff, input validation, rate limiting, no back doors; threat-model passes 2026-08-16 closed a stored-XSS class (archive.org `year` was unescaped in the SSR year chip + client cards — now escaped everywhere, regression-tested), audited the full API→DOM field surface (client renders only title/year/thumb/id, all escaped), and hardened the ad boundary (client independently requires https; server allowlist + fail-closed); both fixes CI-enforced in smoke; `npm audit` 0 vulnerabilities (zero runtime deps by design); secrets sweep clean; identifier charset validated pre-upstream (no SSRF) |
| Tests | ✅ **214/214** unit+integration, typecheck clean, **smoke 487/487 live checks** (incl. design-system integrity: DESIGN.md↔CSS hex parity + computed WCAG contrast on the 4 critical text pairs — worst 6.17:1, audit in `docs/contrast-audit.md` — plus the /genre landing page structure/theme guards (fail-closed API guards + ad-slot contract guards + ad-loader dormant-state guards + perf-contract guards + privacy-disclosure guard + constitution↔guard audit incl. the `media-src` §7/vow-4 guard — see `docs/guard-audit.md` + WCAG guards: `lang="en"` per page, player iframe `title`, poster `alt` + canonical=pinned `SITE_URL` origin/og:url match + web-interface-guidelines guards: `color-scheme: dark`, touch-action/tap-highlight, safe areas, text-wrap balance, Clear-watchlist confirmation, theme-color, `role=status` counts, skip-link focus target `tabindex=-1`, JS-driven cross-origin player focus ring + hostile-input guards: Solr/traversal/script payloads sanitize to 200, upstream-rejected query → honest 502 never 500, oversized/traversal identifiers → 400 pre-upstream); `npm run deploy` verifies the production environment itself; `npm run test:browser` runs the real-browser battery — E2E user flows 27/27, keyboard-only walkthrough 15/15 (every tab stop ring-verified), mobile/notch audit 22/22 (375px + 667x375 landscape + 640px 200%-zoom reflow), axe-core WCAG 2.0/2.1/2.2 A+AA audit (0 violations) |
| Lighthouse | ✅ Home 99-100/100/100/100 (FCP 1.3s, LCP 1.9s, CLS 0), movie 75-99/100/96/100 (best-practices 96 = only archive.org's own iframe-cookie flag; LCP spread is archive.org image-server latency), browse 98/100/100, search 100/100/100, about/privacy/terms/watchlist 100×4 (SEO 66/63 on dynamic noindex pages = deliberate) |
| Ads | ⏳ Slots + advertiser contact live; **loader mechanism built + tested and provably dormant** (`enabled:false`, zero third-party scripts on every page — Decision 001); privacy-page ad disclosure + network acceptance checklist live (T4.4); **no network renders** until a real contract passes the checklist and enables T4.5 |
| Affiliates | ⏳ Mechanism ready; renders only for non-free films (never happens) |
| KV cache | ⏳ Edge cache active; 24h KV needs a KV-scoped token |
| Zone WAF/TLS | ⏳ Needs zone access (the `.pages.dev` origin is behind Cloudflare edge protections) |

## What still needs YOU (all in `FOUNDER-CHECKLIST.md`, no code needed)

1. **KV namespace + token** — one command + paste an id into `wrangler.jsonc` (24h cache).
2. **Zone access** — WAF / bot fight / custom-domain TLS.
3. **Search Console** — verify the domain, submit the sitemap index (73,125 URLs across 18 sub-sitemaps).
4. **Ad network contract** — slots and the advertiser email are live; nothing fake renders.
5. **`AMAZON_TAG`** env var (optional) for the affiliate mechanism.
6. ~~**Lighthouse**~~ — **done**: headless Chrome runs against the live site (home/about 100×4, movie
   and browse/search ≥ 96 best-practices, CLS 0 everywhere). Only remaining flags are the
   deliberate `noindex` on dynamic pages (SEO 66, by design) and archive.org's own third-party
   iframe cookies.

## Verified end-to-end (evidence in `changelog.md`)

- Full viewer walk in a real browser: home → search → film → play → save → watchlist. The walk
  caught and fixed a real bug (film-page Save button was dead; now functional + smoke-guarded).
- Every interactive control works: search, browse filters, pagination, watchlist toggles,
  Surprise me, poster fallbacks, skip-to-content, HEAD parity, no-JS home fallback.
- All input validation probes correct (empty/oversized/out-of-range → 400, never a crash).
- Honest error paths: 502 = upstream outage (with source link), 404 = legal gate / removed,
  no-video = clear explanation. Verified live.
- Live license drill (2026-08-15): 40 real items sampled across the catalog (recent + title-
  spread pages) — every one verified 200 with a declared license through the movie API; zero
  legality failures, zero 502s. Excluded serial chapters/trailers still verify as licensed
  films by direct URL (the films-only policy trims catalog views, never the site).
- Hanger scanner (`scripts/scan-longtail.mjs`): resumable, dependency-free, tested end-to-end
  against the live catalog (fetch ~3s, id-based resume verified); quantifies the ~0.03%
  metadata-hanging items so the founder can decide sitemap trimming vs. just watching.
- Post-deploy warm-up (`npm run warmup`): warms the popular pages + a bounded set of real
  movie pages (identifiers from the live catalog, never guessed) so first viewers don't pay
  cold-build latency; fail-soft; verified 23/23 on the canonical. Part of the runbook's
  post-deploy checklist.
- Catalog index (deploy #37): browse/sitemap/random serve from one edge-cached copy of the
  full catalog (one archive.org call per 24h per colocation; warm browse 0.36s; genre
  filter verified 177 = Solr 177 exact).

## Constitution & vows compliance (audited 2026-08-15)

All 12 constitution rules and all 11 vows were read in full and checked against the deployed
site — **no violations**. Fresh evidence for the audit: no secrets in any client code, and
the only external reference in client code is the archive.org player iframe (no third-party
scripts). Highlights: legal-only gate fail-closed and verified live, ads never interrupt
(sidebar/leaderboard only), privacy by default (no accounts, watchlist local-only, no
trackers), $0 storage (embeds only), Cloudflare-only (Pages + Functions), no mock code (the
reserved ad slots are real labeled elements, not fake ads), no errors left behind (every
found error root-cause fixed), viewer first (acceptance walk). The one outstanding item is
zone-level WAF/TLS (constitution §6), which needs your account access and stays marked
**unverified** — not a violation, a flagged item (item 2 above).

## Go / no-go

**Go:** everything above is green and `npm run smoke` reports 376/376 with no warnings.
**Launch extras:** do items 1–3 above before heavy promotion (Search Console indexing matters
most). Items 4–6 can follow at your pace — the site is complete and honest without them.
