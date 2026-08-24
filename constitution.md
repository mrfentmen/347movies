# 347movies — Constitution

This file defines the non-negotiable rules for any AI agent working on the 347movies codebase. It changes rarely and must be re-read at the start of every work session. If any instruction elsewhere conflicts with this file, this file wins.

---

## 1. Legal-only content — never piracy

347movies streams only films that are **public domain**, **Creative Commons licensed**, or otherwise **explicitly legal to redistribute**. This is the entire foundation of the business: a free movie site that can never be shut down for infringement.

- Never embed, link to, or scrape unauthorized streams, pirate mirrors, torrent sources, or "123movies-style" content.
- Every film must trace to a verified legal source, with the Internet Archive as the primary host.
- A film's legal status is checked at catalog-ingestion time (archive.org license and rights metadata) and recorded on the film record.
- If a film's legal status cannot be verified, it is **excluded**, never included on a guess.
- Adding any new content source is governed by `docs/content-sourcing-policy.md` — every source must be expressible as a license gate; never pull from unlicensed sites.

## 2. Verification over self-reporting

An agent's status report is a claim, not proof. Every "done" claim must be backed by raw, inspectable output — actual command output, actual file diffs, actual test results, actual deploy logs. If a task cannot be verified end-to-end (blocked by a network restriction, missing credential, or external outage), the agent must say so explicitly and mark that item **unverified**, never as done. Never report something as "confirmed" or "working" unless it was actually run and its raw output was shown.

## 3. No mock, placeholder, or pseudo code

All code must be real, working, and complete — never a stand-in pretending to be finished. No mock functions, no `TODO`/empty stubs, no pseudocode, no hardcoded fake data presented as real output, no silently skipped steps. If a task genuinely can't be completed (missing credentials, blocked dependency), the agent says so and labels it incomplete — never fills the gap with something fake to make the task look finished.

## 4. Ads never interrupt the movie

The viewing experience is sacred. Ads may appear **only** in sidebar or leaderboard slots that never overlay, pause, or precede the player.

- No pre-roll, mid-roll, post-roll, overlay, pop-over, or interstitial ads on the movie player.
- The embedded player is never wrapped in ad containers, never resized by ads, never covered by ads.
- Any ad slot added later must be reviewed against this rule before it ships.

## 5. Privacy by default

- No accounts required to watch anything. No sign-up walls, no email gates.
- No selling, renting, or sharing of user data. Ever.
- No browser fingerprinting, no hidden trackers, no third-party scripts beyond the chosen ad network and affiliate links.
- Analytics, if added, must be privacy-respecting (no cross-site tracking) and disclosed on the privacy page.

## 6. Security-first — no back doors

- Hardened response headers on every page: Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy.
- No secrets in client code. Secrets live only in Cloudflare Workers bindings (env vars, KV, or Secrets) — never in committed files, never in the browser.
- Every external input is validated: search queries length-limited and stripped, archive.org identifiers restricted to a safe character set, pagination bounded. No injection, no path traversal, no open redirects.
- All API endpoints are rate-limited. Unknown or malformed input fails closed with a safe default — it never crashes, never leaks, never reveals internals.
- Cloudflare WAF, bot fight mode, and security settings are enabled on the deployed zone. The site has no debug endpoints, no admin back doors, no hidden routes, and no default credentials anywhere.

## 7. The $0 storage rule

347movies **never hosts video bytes**. Video is embedded from the Internet Archive, which serves the files — our storage and bandwidth costs for video are zero by design.

- No video files in the repo, no R2 uploads of film footage, no proxying of video streams through our Worker.
- Catalog metadata (titles, descriptions, thumbnails, genres) may be cached in Cloudflare KV or D1, but video content itself is never stored or relayed.

## 8. Cloudflare-only deployment

Production runs exclusively on Cloudflare: **Pages** for the static front end, **Workers / Pages Functions** for the API, **KV or D1** for cache, Cloudflare edge for CDN, TLS, and WAF. No other hosting provider, no VPS, no external origin for the site itself. If a Cloudflare feature is missing, the task is to find the Cloudflare-native way, not to bolt on another provider.

## 9. No silent scope expansion

Work only within the phase currently marked active in `specs.md`. Do not build auth systems, user accounts, payment processing, or new revenue systems unless the active phase explicitly calls for it. If a task seems to require stepping outside the current phase, stop and flag it as a decision for the human — do not build the workaround unilaterally.

## 10. Affiliate honesty

Affiliate links are a core revenue stream and must be disclosed and legitimate.

- Affiliate links are marked as such (a visible disclosure near the link).
- Only legitimate programs are used (Amazon Associates and similar). No fake referral tricks, no link manipulation, no cloaking, no cookie-stuffing.
- The free movie always comes first: an affiliate link never replaces a free watch.

## 11. Leave no errors behind

Every error encountered — build failures, failing tests, console errors, broken pages, dead links, failed deploys — must be fixed before a task is marked done. A task is not complete while any known error remains. Fix the root cause; never paper over it, never silence it, never skip it.

## 12. When in doubt, stop and ask

Ambiguity is not license to guess. If a step is unclear, or a decision has downstream consequences (cost, legal, security, scope), surface the question — **unless** the active loop prompt explicitly grants autonomous decision-making (AFK mode), in which case the agent makes the most sensible choice, documents it in the changelog, and moves on.
