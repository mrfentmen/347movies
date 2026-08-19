# 347movies — First-week launch runbook

For the founder after launch. The site is live at https://347movies.pages.dev and fully
verified (see `changelog.md`); this runbook covers the first week of running it. Two partner
docs: `FOUNDER-CHECKLIST.md` (account/zone items) and `README.md` (commands).

---

## Daily (2 minutes)

```bash
npm run smoke        # full live health check — 376 checks, exits 0/1
```

Expected: **376/376 passed, no warnings**. If a check fails:

| Check | Likely cause | Action |
|---|---|---|
| Any GET → 5xx | Cloudflare or archive.org hiccup | Re-run once; if persistent, see "Archive.org is slow/down" below |
| Sitemap < 18,000 URLs | Edge-cache TTL after a deploy | Re-run in up to 1h (self-heals); then set `SMOKE_MIN_SITEMAP_URLS=18000` |
| Movie page canonical stale | Same TTL lag after a deploy | Re-run in ≤5 min (new entries are 300s TTL) |
| API search/browse slow | Cold edge cache + archive.org | Expected on first hits after a deploy; warm in seconds |

Also open the site once a day in a normal browser: home, one search, one movie page. Watch
for console errors (View → Developer → Console). The expected console state is **empty**.

## After every deploy

1. **Deploy with `npm run deploy`** — it pins the production branch (`main`) and verifies via
   the Pages API that the created deployment's `environment` is `production`, failing loudly
   on a preview (the lesson of 2026-08-15: `--branch=production` silently creates a preview
   here). The final line must read `ok deployment <id> verified: environment = production`.
2. `npm run smoke` — all green (376/376).
3. `npm run warmup` — hits the popular pages + a bounded set of real movie pages so the
   edge cache and metadata records are warm before viewers arrive (fail-soft: warnings are
   fine; 0 failures expected on a healthy deploy).
4. Open `/`, `/search?q=caligari`, `/movie/it-1927`, `/watchlist` in a browser.
5. Wait ≤5 minutes before judging the movie page — canonical URLs lag a deploy by the
   edge-cache TTL, then self-heal (documented in `changelog.md`; no action needed).

## Archive.org is slow or down

The site degrades gracefully by design: search/browse return a friendly 502 JSON, the UI
shows an error box with a retry button, and cached responses keep serving. Since deploy #17
the archive client also retries once (250 ms backoff) on transient 5xx/network failures
before giving up — verified live: 3 transient 502s during a sweep all recovered on retry.
What to check:

1. `curl -sI https://archive.org/` — if this hangs, it's archive.org, not us.
2. `npm run smoke` — if only search/browse fail but `/` works, it's upstream.
3. Do nothing else: content self-recovers when archive.org recovers. No manual cache purge
   is possible for the Cache API anyway (documented), and none is needed.

## Rate-limit awareness

- The per-IP limiter is in-memory per worker isolate (60 req/min per path class). Under
  normal traffic it never binds. If you ever see unexpected 429s on real users, the fix is
  moving to Durable Objects (needs a KV-scoped token — `FOUNDER-CHECKLIST.md` item 1).
- **Dev-only self-exhaustion (verified 2026-08-16):** `wrangler pages dev` runs ONE
  isolate, so the full smoke suite (~50 rate-limited requests per run) sits right at the
  60/min boundary and repeated runs within the window trip the limiter — a wall of 429s
  that reads like a regression. Production spreads across many isolates, so the canonical
  smoke never binds. If the dev smoke fails with a cluster of 429s: wait out the window
  (≈75 s with no requests) or restart the dev server for a fresh isolate, then re-run
  once. Do NOT raise the limit for tests — the boundary is a feature, not a bug.
- The sitemap build makes ONE no-page request for the entire legal catalog (~18.5k docs,
  ~1.4 MB, ~7 s) when its cache is cold — well within archive.org's tolerance. The
  cold-cache cost is bounded by the edge-cache TTL (1 h) and, once KV is bound, the 24 h
  KV TTL.

## Crawl pressure (Google indexing the full catalog)

When Search Console is live, Google will crawl the 64,088 sitemap URLs (all fourteen pools). What to expect and
what protects the site:

- **First-wave cost:** the crawl hits `/sitemap.xml` (served from the local catalog index —
  no upstream) and ~18.5k movie URLs. Each movie URL is an edge-cache miss on its first
  fetch, so a cold full crawl means ~18.5k metadata calls to archive.org. Google starts new
  sites slow and ramps over days-to-weeks, so this load is spread out, not a burst.
- **In place already:** per-IP rate limiting (Googlebot's per-IP rate is low, so it won't
  bind), one automatic retry per metadata fetch on transient 5xx (rescues archive.org's
  throttling pattern), 300 s edge caching (repeat crawls hit the cache), honest fail-closed
  502/404 pages for the ~0.03% genuinely-hanging items, and a 404 for unverifiable items.
- **Browse/sitemap/random no longer touch archive.org per request** (deploy #37): the local
  catalog index is built once per 24h and edge-cached; only first-fetch movie pages and
  live search queries hit upstream.
- **What KV would add (honest scope):** the first fetch of each movie URL needs archive.org
  regardless of KV; KV absorbs *revisits* (same identifier within 24 h) and sitemap/index
  rebuilds. With the index in place, that residual load is small — the KV binding (founder
  checklist item 1) is now a nice-to-have rather than the single biggest mitigation.
- **What to watch in Search Console:** after submitting the sitemap, check *Crawl stats*
  and *Page indexing* weekly. A spike of 5xx on movie URLs is archive.org throttling under
  the first-wave crawl — it self-recovers; verify with `curl -sI https://archive.org/`
  (if archive.org is fine, re-run `npm run smoke` and re-check indexing the next week).
- **Quantifying the hangers (founder tool):** `node scripts/scan-longtail.mjs` (see README)
  scans the catalog against the metadata endpoint with gentle pacing and writes a resumable
  JSONL + `--report` markdown of the hanger set. Run it in chunks over a few sessions before
  deciding whether to trim the sitemap or just keep watching them; the default 12 s timeout
  matches the site's documented cutoff — shorter timeouts over-flag throttling transients.

## Enabling the KV cache (one pass, when you have a KV-scoped token)

The founder checklist (item 1) has the steps; this is the one-pass sequence with
verification so a future session can complete it without re-deriving anything. The
blocker today: the deployed token is Pages-scoped only (verified: `wrangler kv namespace
create/list` → auth error 10000). Everything below runs with a token that has **Workers KV
Storage: Edit** (plus Pages: Edit so deploys keep working).

1. **Create the namespace:**
   ```bash
   npx wrangler kv namespace create MOVIES_KV
   ```
   Copy the returned `id`. (Same command works for a fresh `preview_id`, or reuse the id.)
2. **Wire `wrangler.jsonc`:** uncomment/insert the block in the file (instructions are inline):
   ```jsonc
   "kv_namespaces": [{ "binding": "MOVIES_KV", "id": "<id>", "preview_id": "<id>" }]
   ```
3. **Deploy + verify the environment:** `npm run deploy` must print
   `verified: environment = production` (the deploy #40 lesson — a preview deployment
   silently never reaches the live origin).
4. **Confirm the binding is live:** the canonical smoke suite passes unchanged (KV is
   optional by design — no guard asserts it, deliberately). Verify KV directly:
   ```bash
   npx wrangler kv namespace list          # shows MOVIES_KV with its id
   ```
   then fetch a movie page twice (`curl -sI https://347movies.pages.dev/movie/it-1927`),
   wait a moment for the first-fetch write, and check a key landed:
   ```bash
   npx wrangler kv key get --namespace-id <id> "movie:it-1927"
   ```
   A JSON record (not "Key not found") proves the write path. Cache keys are
   `movie:<identifier>`, `search:<query>:<page>` (`lib/cache.ts`).
5. **Record it honestly:** changelog entry (deploy #N + the kv namespace id, never the
   token), founder checklist item 1 checked, and this runbook's crawl-pressure section
   updated (KV is a nice-to-have on top of the index — its real effect is absorbing
   movie-metadata *revisits* within 24h).
6. **Rollback:** delete the `kv_namespaces` block from `wrangler.jsonc` and redeploy. The
   code's `cacheGet`/`cachePut` no-op on a missing binding (`lib/catalog.ts`), so the site
   is unchanged without KV — that's by design, not a bug.

## Scheduled health battery (weekly regression, no human in the loop)

The health battery (`npm run health` → `scripts/health-battery.sh`) runs the full suite —
typecheck, unit tests, dependency audit, **security re-review gate**, browser battery
(E2E/keyboard/mobile/axe, which starts its own dev server), and the canonical smoke against
the **live production** site — then appends an **honest dated entry** to `changelog.md`
(pass/fail per step, failing-step output quoted, never a claim). Exit code 0 = all passed;
1 = any failed (the entry is written either way so a failure is auditable).

Wiring the schedule (external to the repo — pick the mechanism that fits your host):

- **macOS (launchd), weekly on Monday 06:00:**
  ```bash
  mkdir -p ~/Library/LaunchAgents
  cat > ~/Library/LaunchAgents/com.347movies.health.plist <<'EOF'
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>Label</key><string>com.347movies.health</string>
    <key>ProgramArguments</key><array>
      <string>/bin/bash</string>
      <string>-lc</string>
      <string>cd /Users/del/Desktop/347movies \&\& npm run health \&\& /usr/bin/tail -n 0</string>
    </array>
    <key>StartCalendarInterval</key><dict>
      <key>Weekday</key><integer>2</integer><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer>
    </dict>
    <key>StandardOutPath</key><string>/tmp/347movies-health.log</string>
    <key>StandardErrorPath</key><string>/tmp/347movies-health.log</string>
  </dict></plist>
  EOF
  launchctl load ~/Library/LaunchAgents/com.347movies.health.plist
  ```
- **Linux / CI:** `cron`: `0 6 * * 1 cd /path/to/347movies && npm run health`; or a GitHub
  Action / scheduled job that runs `npm run health` and posts the changelog diff.
- **On failure:** the changelog entry names the failing step; diagnose per this runbook
  (rate-limit awareness, archive.org-down checks). A failed battery does not mean the site
  is down — the smoke step is the authoritative live check.
- **Verification after wiring:** run `npm run health` once manually; the changelog gets a
  "Scheduled health battery" entry dated today.

### Security re-review gate (scheduled, dated, recurring)

`scripts/security-review-due.sh` (a battery step, "security re-review current") fails when
the most recent dated **"Security review"** entry in `changelog.md` is older than the
cadence — default **90 days** (`SECURITY_REVIEW_MAX_AGE_DAYS=30` for a strict monthly
gate). The ledger entry is the review record, so satisfying the gate is the same act as
performing the review:

1. Re-run the security-review pass (the skill + `docs/security-review-2026-08-16.md` as the
   baseline; verify the existing guards still hold, probe the live surface, check
   `npm audit` and the secret scan).
2. Commit the findings — even "no new findings" — as a dated `## YYYY-MM-DD — Security
   review: …` changelog entry (with the report refreshed in `docs/`).
3. The next battery run goes green; the gate trips again when the cadence elapses.

A tripped gate makes the battery red until step 2 happens — that is the forcing function,
not a site outage (the smoke step is the authoritative live check).

### Dependency policy (supply chain, verified 2026-08-16)

Both trees install **frozen** (`npm ci` — root + `ui-prototype`, CI and locally), and the
only packages with install scripts are the three canonical native-binary postinstalls:

| Package | Script | Why it's approved |
|---|---|---|
| `esbuild` | `postinstall: node install.js` | Downloads the platform binary (dev-time bundler, used by wrangler) |
| `workerd` | `postinstall: node install.js` | Cloudflare's runtime binary (wrangler pages dev) |
| `fsevents` | native binding | macOS-only file watcher (optional dependency of chokidar) |

All three resolve from `registry.npmjs.org` with **verified registry signatures**
(`npm audit signatures`: root 44 packages signed / 25 attestations; ui-prototype 164
signed / 115 attestations), and `npm audit` reports **0 vulnerabilities** on both trees.

**Policy:** a dependency that runs an install script beyond the three above is a review
gate — inspect the script source (the lockfile `scripts`/`hasInstallScript` + the package's
`install.js`/`postinstall`), confirm it only fetches that package's own platform binary,
and note the approval in the changelog before merging. Never blanket-approve scripts, never
run `npm audit fix --force`, and re-run `npm audit signatures` after any dependency bump.

## Week-one checklist

- [ ] `FOUNDER-CHECKLIST.md` items 1–3: KV token + namespace, zone WAF/TLS, Search Console.
- [ ] Submit `https://347movies.pages.dev/sitemap.xml` in Search Console and check the
      sitemap report after a few days (expected: 64,088 URLs, no errors).
- [ ] Decide on an ad network (item 4) — slots + advertiser contact are live already.
- [ ] Optional: `AMAZON_TAG` env var (item 5) for the affiliate mechanism.
- [ ] After a week: review `changelog.md`'s "unverified" list; nothing should remain except
      what still needs your account access.

## Escalation

- Site unreachable: check the Pages project (dashboard → Workers & Pages → 347movies →
  Deployments). Every deploy is listed; roll back to the last green one if needed.
- Anything else: the answer is usually "wait for the edge-cache TTL" or "archive.org is
  flaky" — both self-heal. If something genuinely regresses, the smoke test names it.
