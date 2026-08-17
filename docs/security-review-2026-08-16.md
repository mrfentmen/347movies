# Security review — 2026-08-16

**Scope:** the site's full attacker-controlled surface — every Pages Function route
(`/api/*`, SSR `/movie/*`, `/sitemap.xml`), the middleware (headers/rate limiting), the
client bundle (`public/js/app.js`), and the shared libs (validation, normalization, SSR
layout, archive.org client, catalog index). Methodology: security-review skill —
trace every external input end-to-end, verify upstream validation/sanitization/framework
mitigations, report HIGH-confidence exploitable findings only.

## Summary

- **Findings: 0** (0 Critical / 0 High / 0 Medium)
- **Risk Level:** Low
- **Confidence:** High (after live exploitability probes, not pattern matching)
- **Verdict: No high-confidence vulnerabilities identified.**

This is a deliberately hardened surface — the T6.8 STRIDE pass, T6.9 API→DOM audit, the
constitution §6 validation discipline, and the smoke guards that pin escaping/400-behavior
all predate this review. The review confirms those defenses hold end-to-end and found no
new path.

## Attack surface traced

| Input | Entry | Validation upstream | Verdict |
|---|---|---|---|
| `q` (search/browse) | `/api/search`, `/api/browse` | `validateQuery`/`validateKeyword`: ≤80 chars, strips Solr/URL-injection chars, fail-closed empty | Safe — Solr clause is `(<sanitized>)` ANDed with the fixed legal gate; cannot escape parens (stripped) |
| `identifier` | `/movie/<id>`, `/api/movie/<id>` | `validateIdentifier` `^[A-Za-z0-9._-]{1,120}$` before ANY upstream call (`lib/catalog.ts`); `encodeURIComponent` at render | Safe — verified live: `..%2F..%2Fetc` → 400, no upstream call |
| `genre`, `decade`, `from/to`, `sort`, `page`, `tv`, `films` | `/api/browse` | Whitelists (`GENRE_SUBJECTS`, `ALLOWED_DECADES`, `SORT_KEYS`), `\d{1,3}` page, flag enum | Safe — verified live: `<script>` genre → 400 `invalid_genre` |
| Host header | canonical/og:url/sitemap | `SITE_URL` pinned in `wrangler.jsonc` (wins); fallback charset-validated (`^[a-z0-9.-]+$`), https-forced, safe default | Safe — production canonical never derives from Host; verified live |
| archive.org metadata (title/year/description/…) | SSR + API + client | `escapeHtml` at every render (server + client); `stripHtml` on descriptions; JSON-LD block escapes `< > &` as unicode | Safe — no stored/reflected XSS |
| Watchlist import file | client | Shape-validated, every field escaped at render, `encodeURIComponent` in hrefs | Safe — a malicious import file cannot XSS |
| `CF-Connecting-IP` | rate limiter | Trusted edge header; rate limiting is DoS mitigation, not an auth boundary | Safe |

## Live probes (dev server, 127.0.0.1:8787)

- `/movie/..%2F..%2Fetc%2Fpasswd` → **400** `{"error":"invalid","message":"Invalid film identifier."}` — no upstream call.
- `/api/search?q=<script>alert(1)</script>` → response `query` is the **sanitized** `script alert 1 script`; results returned normally — the raw payload never appears.
- `/api/search?q=" OR 1=1 --` → **controlled 502** `upstream_error` (archive.org rejects it) — not a 500, no crash, no data leak.
- `/api/browse?genre=<script>` → **400** `invalid_genre`.
- Security headers present on function responses: CSP (`script-src 'self'`, no inline), HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `X-Robots-Tag: noindex` on `/api/*`; static pages get the same CSP via `public/_headers`.
- SSR `/movie/it-1927`: only the external `app.js` script + the `application/ld+json` data block (escaped) — no inline executable scripts.
- Secrets: no hardcoded keys/tokens in repo (Lighthouse-report and package-lock hits are false positives); `.env` is gitignored; env bindings are documented, allowlist-gated (`lib/ad.ts` allowlist is empty → ad loader structurally dormant).

## Evaluated and resolved (not findings)

- **Solr word-operators survive `sanitizeQuery`** (`+`, `-`, `OR`, `^` are not stripped):
  they only reshape archive.org's public query semantics from inside the parenthesized
  clause (parens/colons/quotes are stripped, so the legal gate clause cannot be escaped);
  worst case is a 502 from archive.org, never an effect on our data or a 500. Verified live.
- **In-memory per-isolate rate limiter** and **KV-cache disabled**: documented
  availability/scale tradeoffs, not vulnerabilities (per-IP window is exact for a single
  isolate; the changelog flags the Durable-Objects move if concurrency grows).
- **Host-header canonical fallback** (`resolveSiteUrl`): unreachable in production
  (`SITE_URL` pinned), charset-validated, https-forced, and Cloudflare Pages only routes
  configured domains — defense-in-depth already implemented, not exploitable.

## ui-prototype review (sandbox, not deployed)

The shadcn/React sandbox (`ui-prototype/`) was reviewed for the same classes:

- **No XSS:** zero dangerous sinks (`dangerouslySetInnerHTML`, `eval`, `innerHTML`,
  `document.write` all absent); every JSX interpolation is React-auto-escaped; the movie
  data is static sample records (`src/data/movies.ts`), and live API data would still be
  escaped by React.
- **No injection / no secrets / no external fetches** beyond archive.org embeds mirroring
  the live site.
- **Supply chain:** `npm audit` → **0 vulnerabilities** across its real dependency tree
  (React 19, radix-ui, Vite, Tailwind v4).
- Internal hash-route links only; no `target="_blank"` surfaces.

Verdict: clean. The prototype is a comparison artifact only — never served by the site —
so even its dependency surface has no production impact, but it is kept audit-clean.

## Supply-chain pass (2026-08-16, hardening skill follow-up)

- **Registry signatures verified on both trees:** `npm audit signatures` — root 44
  packages signed / 25 attestations; ui-prototype 164 signed / 115 attestations. All
  resolved from `registry.npmjs.org`.
- **Dependency-script policy reviewed end to end:** both trees install frozen (`npm ci`),
  no `--ignore-scripts` overrides anywhere. The only install scripts in either lockfile
  are the three canonical native-binary postinstalls — `esbuild` (`postinstall: node
  install.js` → downloads its platform binary), `workerd` (Cloudflare runtime binary),
  `fsevents` (macOS watcher, optional). All three are first-party, signature-verified,
  and the script bodies were inspected. Policy + approval table documented in
  LAUNCH-RUNBOOK.md → "Dependency policy".
- **Audits:** `npm audit --audit-level=high` → 0 vulnerabilities on both trees.

## Coverage note

Test files were not reviewed (skill rule). No site code was changed — this was a
read-only review; the only additions are this report, the scheduled re-review gate
below, and the dependency policy in the runbook.

## Scheduled re-review (the cadence gate)

The health battery now carries a security re-review staleness step
(`scripts/security-review-due.sh`): it fails when the last dated `## YYYY-MM-DD — Security
review` changelog entry is older than the cadence (default 90 days;
`SECURITY_REVIEW_MAX_AGE_DAYS=30` for a strict monthly gate), so the scheduled battery
flags "re-review due" and stays red until a fresh review is recorded in the ledger. The
review record IS the gate key — performing a review and documenting it are the same act.
Wiring and procedure: LAUNCH-RUNBOOK.md → "Scheduled health battery" → "Security
re-review gate".
