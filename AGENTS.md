# AGENTS.md — 347movies

Learnings from past sessions that cannot be recovered by reading the code.

## Tooling & commands
- Smoke suite (300 checks) must run against a dedicated high-limit server, not the 8787 dev server: `wrangler pages dev public --port 8788 --compatibility-date=2024-09-23 --binding RATE_LIMIT=10000` under launchd (plain nohup gets reaped), then `SMOKE_BASE_URL=http://localhost:8788 npm run smoke`. The default limit is 60 req/60s per IP — repeated runs against 8787 fail with 429s, which is a rate limit, not a code bug.
- Wrangler `--binding` takes `KEY=VALUE`. The colon form (`KEY:VALUE`, the old `--var` syntax, now dropped) silently binds nothing — the rate limiter falls back to 60/60s and smoke fails with 429s. The global wrangler install is gone; use `node_modules/wrangler/bin/wrangler.js`.
- `npm run warmup` is manual (not part of deploy) and must be run post-deploy: it pre-fills the OTR/music audio-card enrichment so the first visitors don't pay the cold per-item metadata cost.
- Adding a static page requires bumping the sitemap static-path count in `scripts/smoke.mjs` (exact-number assertion — has caused repeated off-by-one failures).

## Files that must change together
- The site header/footer live in TWO places: `lib/layout.ts` (SSR movie pages) AND each static page's own markup (`public/*.html`, ~15 files). Adding or renaming a nav item means editing all of them plus `lib/layout.ts` — the static pages are NOT rendered from the layout.
- `enrichAudioCardMeta` (lib/audio-meta.ts) is called only from `functions/api/browse.ts` and `functions/api/search.ts`; identifiers there come from archive.org's index/Solr, never user input. The `/movie/{id}` path is user-controlled and must not feed enrichment.

## lib/audio-meta.ts (audio-card enrichment)
- The launch-gate deadline does NOT bound response time by itself: in-flight `fetchMetadata` calls (15s timeout + retry ≈ 30s) hold `Promise.all(workers)` past the gate. The pass-level `Promise.race` against a timer is what actually caps latency — keep that race.
- `Promise.race` leaves the losing timer armed: a fast pass keeps a `setTimeout` alive until it fires (8s in prod; hangs test processes that long). The race timer must be clearable and cleared on the winning path (`deadlineTimer().clear()`).
- Cold audio-pool pages cost up to the 8s deadline when archive.org is degraded (measured 14.2s before bounding); chips self-heal on later loads via the 24h per-identifier cache.

## Testing quirks
- `fetchWithRetry` retries network errors and 5xx, never 4xx (1s backoff). Mocks that need a fast-settling "straggler" should return a 404 — a throwing fetch triggers retry+backoff (slows the suite), and a never-settling fetch leaves the internal 15s timeout timer armed, hanging the test process until it fires.
- Suite is ~4s warm, ~13s on a cold first run (module-cache warm-up, not a failure). The "upstream failure" test costs ~1s by design (retry backoff).

## Configuration facts
- CSP already allowlists `pagead2.googlesyndication.com` — the ad slots are dormant (ad-config reports disabled) and enabling a network needs no CSP change.
- Two lockfiles: root `package-lock.json` is the real boundary; `ui-prototype/` is an independent project (no root workspaces field).

## User preferences
- Never add photos from the user's personal files (Downloads/Desktop) to the site without explicit per-photo approval — a personal ID photo once ended up in the site rotation and the user reacted very strongly.
- Standing convention for completed work: commit → push → PR → merge → deploy. The user prefers autonomous execution and repeats "push and deploy changes each time" / "im afk, ask no questions".
