# 347movies — Founder checklist (things that need your Cloudflare account)

The site is **live at https://347movies.pages.dev** and fully functional. Everything below is
the short list of items that need **your Cloudflare account/zone access** — the deployment
token used during the build is scoped to Cloudflare Pages only and cannot do these. Each item
is the exact step; the code is already written and waiting for it.

---

## 0. Rotate the leaked Pages deploy token — do this FIRST (URGENT)

On 2026-08-16 the live Cloudflare Pages deploy token was found hardcoded in
tests/deploy.test.ts, committed, and pushed on the `operational-hardening` branch of the
public repo. Any credential that reaches a remote is assumed compromised — it is already
in the public git history and can be extracted by anyone who has ever fetched the repo.

The value was purged from the branch tip and a whole-tree CI scan now fails if it (or any
`cfut_`-shaped string) reappears, but **only you can retire the value itself**:

1. In Cloudflare dashboard → My Profile → API Tokens, locate the token used for Pages
deploys (the one in `.env` as `CLOUDFLARE_API_TOKEN`) and **Roll** (or delete + recreate).
2. Update `.env` with the new token. It stays gitignored — never commit it.
3. Verify a deploy still works: `npm run deploy`.
4. Optionally purge the old value from history with `git filter-repo`/BFG + force-push
(the branch tip is already clean; this is belt-and-braces once rotation is done).

---

## 1. KV cache (24h catalog cache) — needs a KV-scoped token

The site already runs a Cloudflare-native edge response cache (Cache API, verified
`cf-cache-status: HIT`). KV adds the spec'd 24h cache so popular archive.org results aren't
re-fetched as often.

1. Create an API token with **Workers KV Storage: Edit** (and Pages: Edit, so deploys keep working):
   Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"
   template, then add the **Workers KV Storage: Edit** permission (account-scoped).
   (Re-verified 2026-08-16: the current deploy token returns `Authentication error [code: 10000]`
   on `wrangler kv namespace list` — the KV permission is genuinely missing until this step.)
2. In the project folder, run:
   ```bash
   npx wrangler kv namespace create MOVIES_KV
   ```
3. Copy the returned `id` into the commented-out `kv_namespaces` block in `wrangler.jsonc`
   (set both `"id"` and `"preview_id"`).
4. Deploy:
   ```bash
   npm run deploy
   ```
The code uses KV automatically when the binding exists — no other changes needed.

## 2. Zone settings (WAF, bot fight mode, TLS) — needs the domain on Cloudflare

The `*.pages.dev` origin is behind Cloudflare's shared edge protections and TLS already, but
custom tuning lives on your own zone. Either:

- **Keep the free `347movies.pages.dev` URL** (fine for launch), or
- **Add a custom domain** in Pages → project → Custom domains, then move the zone to
  Cloudflare and in the zone dashboard enable: **WAF** (managed rules), **Bot fight mode**
  (Security → Bots), and **Always Use HTTPS** + HSTS (SSL/TLS). Add an `A`/`CNAME` record to
  `347movies.pages.dev` if prompted.

**When you attach a custom domain, also update the canonical pin** — one line in
`wrangler.jsonc`, then redeploy (`npm run deploy`):

```jsonc
"vars": { "SITE_URL": "https://yourdomain.com" }
```

This `SITE_URL` var is what canonical/OG tags, the sitemap, JSON-LD, and `/api/random`
redirects point at (lib/site-url.ts: the var wins; request-host resolution is the fallback
for environments without it). Leaving it at `347movies.pages.dev` after adding a domain
would pin every canonical and every sitemap URL to the old host — the new domain would be
seen as duplicate content instead of the primary site.

## 3. Search Console (SEO) — needs a verified site owner

1. Go to https://search.google.com/search-console and add the property
   `https://347movies.pages.dev` (or your custom domain).
2. Verify ownership (DNS TXT record from your Cloudflare zone, or HTML tag).
3. Submit the sitemap index: `https://347movies.pages.dev/sitemap.xml` (currently 71,992 URLs
   across 16 per-pool sub-sitemaps, all fifteen pools).

## 4. Real ad network rendering — needs a contract

The ad slots (sidebar + leaderboard on every content page, labeled "Advertisement", **never
over or inside the player**) are live as marked containers with the contact
`contactae2000@gmail.com` (also listed on `/about#advertise`). The **loader mechanism is
built and dormant** (Decision 001 / T4.3: `lib/ad.ts` + `/api/ad-config` + the client
bootstrap — `enabled:false` until a network is configured, smoke-guarded). The privacy-page
advertising disclosure is in place (T4.4). To actually render ads:

1. Sign up with a compliant ad network. **Run it against this acceptance checklist first**
   (Decision 001):
   - **Legal-only compatible** — accepts public-domain/CC films and archive.org embedding.
   - **Placement** — supports sidebar/leaderboard slots only; we will not integrate
     pre/mid/post-roll, overlays, or interstitials on the player (constitution §4).
   - **No auto-playing audio** in their creatives.
   - **Brand-safety controls** (category/site blocking) available.
   - **CSP-compatible tag** — no `unsafe-inline`/`unsafe-eval` requirement; they can give
     the exact script host(s) for our `script-src` allowlist.
   - **Privacy disclosure** — their tag's cookies/tracking are documented on their policy
     page (constitution §5: disclosed before any ad renders).
2. If it passes, wire it in as the ONE reviewed change (T4.5): add the network's host to
   `AD_NETWORK_ALLOWLIST` in `lib/ad.ts`, set the `AD_NETWORK_SCRIPT` env var in Cloudflare
   Pages, relax `script-src` in `functions/_middleware.ts` + `public/_headers` to the exact
   host(s) (never `unsafe-inline`; `frame-src` stays archive.org-only), and name the network
   + link its privacy policy in `public/privacy.html` (the disclosure is already written
   and waiting).
3. Verify live: ads render in exactly the two slot types, never in/over the player, page
   unaffected when the network is down (the fail-closed test), Lighthouse a11y 100 + CLS 0
   unchanged.

No fake ad code was added during the build — per the constitution, nothing renders until a
real network is configured and passes the checklist above.

## 5. Affiliate links — needs an Amazon Associates tag

Set the `AMAZON_TAG` environment variable on the Pages project (Settings → Environment
variables). The affiliate mechanism is built and unit-tested; links only ever render for
films that are NOT freely watchable — which, under the legal-only catalog, never happens by
design (the free watch always comes first).

## 6. Lighthouse check (optional)

Not runnable from the build environment. When convenient, run Lighthouse on
`https://347movies.pages.dev/` in Chrome DevTools (mobile preset). Current manual numbers to
beat: home page 5.2 KB / ~90 ms TTFB, CSS 10.1 KB, JS 7.7 KB, lazy-loaded posters.

---

## Verify anytime

Run the full live health check with one command (no credentials needed):

```bash
npm run smoke
```

It asserts the whole GET/HEAD status matrix, security headers, the player embed, the API
shape, and the sitemap against `https://347movies.pages.dev`. Two warnings are expected until
the edge-cache TTL rolls over after a deploy (canonical URLs lag a deploy by up to the TTL,
then self-heal — see `changelog.md`). Point it at another deployment with
`SMOKE_BASE_URL=https://... npm run smoke`, and tighten the sitemap floor with
`SMOKE_MIN_SITEMAP_URLS=18000` once the canonical sitemap has rebuilt.

## Quick status

| Item | Status |
|---|---|
| Live site | ✅ https://347movies.pages.dev |
| Deploy token | 🔴 leaked 2026-08-16 — purge from tip done, CI scan added; **rotate now (item 0)** |
| Catalog | ✅ 15 pools, license-verified, fail-closed (films + TV/anime/cartoons/radio/music/documentaries/sports/shorts/silents/publictv/science/govfilms/audiobooks/records) |
| Tests | ✅ 55/55, typecheck clean, `npm audit` 0 |
| Edge caching | ✅ live (`cf-cache-status: HIT`) |
| KV 24h cache | ⏳ item 1 above |
| WAF / bot fight / zone TLS | ⏳ item 2 above |
| Search Console + sitemap | ⏳ item 3 above |
| Real ad rendering | ⏳ item 4 above (slots + contact live) |
| Affiliate payouts | ⏳ item 5 above (mechanism ready) |

Full evidence ledger: `changelog.md`. Tasks and status: `tasks.md` / `specs.md`.
Day-to-day operations: `LAUNCH-RUNBOOK.md` (daily checks, post-deploy steps, outage
handling).
