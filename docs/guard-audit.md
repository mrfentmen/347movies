# 347movies — Guard audit: constitution & vows ↔ automated checks

**Audited 2026-08-15.** Method: re-read `constitution.md` and `vows.md` in full, enumerated
every check in `npm run smoke` (92) and every test in the 109-test suite, and mapped each
rule/vow to the checks that guard it. Coverage legend:

- **Live** — asserted by `npm run smoke` against the production site on every run.
- **Unit** — asserted by the deterministic test suite (module-level, mocked where needed).
- **Structural** — enforced by architecture (a CSP directive, the deploy script, an absent
  feature); the listed checks verify the structure holds.
- **Ops/process** — enforced by the runbook + changelog discipline, not a runtime assertion.
- **N/A** — process rule or absence-of-feature; no meaningful runtime assertion exists.

## Constitution

| Rule | Coverage | Guards |
|---|---|---|
| §1 Legal-only, never piracy | **Live + Unit + Structural** | Live: movie API fails closed (missing/dark → `not_available`, invalid → 400), dark item page 404, no-video honest message + source link, catalog-policy contract (films-only default; no trailer/episode/serial titles in browse or search). Unit: `catalog.test.ts` (license verification, `not_legal`, search-doc fallback), `archive-unit.test.ts` (license gate pinned in the base clause), `film-policy.test.ts`. Structural: player is an archive.org embed only (CSP `frame-src`). |
| §2 Verification over self-reporting | **Ops/process** | The changelog ledger, this audit, and the deploy script's own environment verification (`ok deployment … verified: environment = production`, `deploy.test.ts`). No runtime assertion is meaningful — this rule governs how work is reported, not how the site behaves. |
| §3 No mock/placeholder code | **Live + Unit** | Live: ad loader dormant (`enabled:false`, **zero third-party scripts** on every slot page), no speculation rules shipped, ad slots labeled with a real contact. Unit: `ad.test.ts` (dormant-by-structure: the allowlist is empty). |
| §4 Ads never interrupt the movie | **Live + Structural** | Live: movie-page ad slot provably outside the player wrap, exactly one leaderboard per list page, exactly one sidebar on the movie page, ad loader dormant. Structural: CSP `frame-src` archive.org-only — no ad iframe can ever wrap or cover the player. |
| §5 Privacy by default | **Live + Structural** | Live: privacy page carries the ad-network standing disclosure; ad loader dormant (zero third-party scripts = no hidden trackers). Structural: no accounts/sign-up (feature absent), watchlist localStorage-only (never sent to a server). |
| §6 Security-first, no back doors | **Live + Unit** | Live: CSP (`frame-src`, `script-src` no-`unsafe-inline`, `connect-src`, `media-src`), HSTS preload, `nosniff`, `X-Frame-Options`, `/api/health` JSON, `X-Robots-Tag: noindex` on API, invalid input → 400, unknown routes → 404. Unit: `validate.test.ts`, `ratelimit.test.ts` (all API endpoints rate-limited — triggering 429 in smoke would need 60 requests, so the limiter is unit-tested), `catalog.test.ts` (no upstream call on invalid input). |
| §7 The $0 storage rule | **Live + Structural** | Live: CSP `media-src` archive.org-only, no dead player iframe, JSON-LD `embedUrl` matches the real archive.org embed. Structural: no video in the repo, no proxy/video routes (unknown routes 404). |
| §8 Cloudflare-only | **Ops** | `wrangler.jsonc` + `scripts/deploy.ts` pin Pages/Workers; no other provider is configured. Not a runtime assertion. |
| §9 No silent scope expansion | **Ops/process** | `tasks.md` phases + changelog decisions (e.g. Decision 001's explicit scope cuts). N/A at runtime. |
| §10 Affiliate honesty | **Unit** | `affiliate.test.ts`: visible disclosure, `rel="sponsored noopener"`, env-gated tag, only for non-free films. No live guard by design — every catalog film is free, so links never render (vow 8: free comes first). |
| §11 Leave no errors behind | **Live + Ops** | Live: status matrix (every route's expected status), HEAD parity, no dead iframe, canonical self-heal warnings. Ops: every found error root-caused in the changelog (e.g. the preview-branch deploy incident, the speculation-rules console error). |
| §12 When in doubt, stop and ask | **Ops/process** | AFK-mode delegation in the loop prompt; decisions documented in the changelog. N/A at runtime. |

## Vows

| Vow | Coverage | Guards |
|---|---|---|
| 1 — Free forever | **Structural** | No paywall/payment routes or tiers exist; every film is free. Absence-of-feature. |
| 2 — Ads never interrupt | **Live + Structural** | Same as §4 (ad-slot placement, loader dormant, `frame-src`). |
| 3 — Legal-only, always | **Live + Unit + Structural** | Same as §1. |
| 4 — Zero storage, by design | **Live + Structural** | Same as §7 (`media-src` guard, embed-only player). |
| 5 — Private by default | **Live + Structural** | Same as §5. |
| 6 — Real code, no fakes | **Live + Unit** | Same as §3, plus the whole 109-test suite running real code paths. |
| 7 — No errors left behind | **Live + Ops** | Same as §11. |
| 8 — Transparent monetization | **Live + Unit** | Live: slots labeled “Advertisement”, advertiser email on every slot + the about page, privacy disclosure. Unit: affiliate disclosure mechanics. |
| 9 — Secure by default | **Live + Unit** | Same as §6. |
| 10 — Build in public, report honestly | **Ops** | The changelog is the auditable ledger (every deploy, every error, every decision); this audit is part of it. N/A at runtime. |
| 11 — The viewer comes first | **Live + Periodic** | Live: WCAG guards (focus clearance, ≥24px targets, `role=alert` error box, busy-state tracking), CLS skeleton-grid guards, structural guards (1 h1, skip link, one main). Periodic: Lighthouse runs (home 99-100/100/100/100, CLS 0 everywhere) + the warm-up script (first viewers don't pay cold-build latency). |

## Verdict

Every constitution rule and every vow maps to at least one guard or to an explicit
structural/process reason why no runtime guard applies. One gap found and fixed during this
audit: **§7/vow 4's structural guard (`media-src` archive.org-only) was not asserted by the
smoke suite** — it is now check 92. No other rule is unguarded.
