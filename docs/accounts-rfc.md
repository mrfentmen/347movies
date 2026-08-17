# RFC: User accounts for 347movies?

**Status:** For owner consideration only — no code. **Date:** 2026-08-16
**Context:** The better-auth skill was reviewed and declined (changelog 2026-08-16) because
constitution.md §5/§9, vows.md Vow 5, and specs.md ("zero accounts") all forbid accounts
unless the owner explicitly amends the constitution. This RFC lays out the decision space so
that amendment — if it ever happens — is informed and deliberate, not reactive.

---

## The question

347movies's founding promise is *"zero accounts."* What would accounts actually buy, what
would they cost, and what would have to change to ship them without breaking the project's
own rules?

## 1. What accounts would buy

| Feature | Today (server-free) | With accounts |
|---|---|---|
| Watchlist | localStorage — one browser, one device | Synced across devices |
| Saved watchlist survives clearing site data / switching browsers | No | Yes |
| New-film alerts (e.g. "new noirs this month") | Not possible | Email, opt-in |
| Saved searches / favorite genres | Not possible | Yes, per user |
| Continue-watching position | Not possible (player is an archive.org iframe) | Possible in principle, awkward (cross-origin player) |
| Film ratings / reviews | Not possible | Community layer — but see constitution §3/§9 scope |

The honest list is short: the site is a catalog + player, and the player is a cross-origin
archive.org iframe. The genuinely valuable account features are **cross-device watchlist
sync** and **opt-in email alerts**. Everything else (ratings, reviews, social) is a product
expansion well beyond the current scope.

## 2. What it would cost — the constitution amendments

Each of these is a deliberate, owner-made change to a non-negotiable rule. An agent must not
make any of them unilaterally (constitution §12: "When in doubt, stop and ask" — and §9's
explicit prohibition on building auth unless the active phase calls for it).

1. **constitution.md §5 ("No accounts required to watch anything")** → rephrase to "no
   accounts *required* — watching stays free and anonymous; accounts are optional." This is
   the *least* invasive reading: anon viewing survives, accounts become an opt-in layer.
   Vow 5's "No accounts" must be amended the same way.
2. **specs.md data model ("No user data is stored. No accounts exist.")** → add a users
   table + sessions to the data model, with a privacy scope: *what* is stored (email hash,
   watchlist ids), *what is not* (viewing history — see below), retention, deletion.
3. **constitution §9** — an accounts phase must be added to the phase table and made the
   active phase before any implementation work.
4. **privacy.html** — full rewrite of the privacy promise: accounts mean collecting an
   email and syncing watchlist data. The current page says "we collect nothing about you"
   and "no sign-in required to watch anything" — both stay true for anonymous viewers but
   the page needs the account opt-in spelled out.
5. **CSP + cookie surface** — the strict `script-src 'self'` CSP can stay, but the site
   currently sets *zero* cookies; auth adds session cookies (httpOnly, Secure, SameSite)
   and a CSRF/origin story. New surface = new smoke guards.

## 3. What it would cost — architecture

- **A database.** The site is deliberately database-free today (metadata in edge cache;
  the KV namespace isn't even enabled — the token is Pages-scoped). Accounts need durable
  storage: D1 (Cloudflare-native, per constitution §8) with a users/sessions schema.
- **Better Auth** (or equivalent) on Pages Functions: `auth.ts`, adapter, migrations, the
  `/api/auth/*` route surface, `BETTER_AUTH_SECRET` + `BETTER_AUTH_URL` env bindings.
- **Watchlist migration.** Today the watchlist is localStorage-only (privacy page promise:
  "never sent to any server"). An account layer would *add* server sync while keeping the
  local-first behavior — a careful migration, not a replacement.
- **Rate limiting / abuse surface.** Auth endpoints are prime brute-force targets; the
  existing limiter discipline extends to them (login attempts, signup, password reset).

## 4. The privacy red line (non-negotiable even WITH accounts)

Accounts must not become a tracking vehicle. Recommended hard rules if accounts ever ship:

- **No viewing history stored.** Ever. What you watch stays on your side of the screen
  (Vow 5's spirit). Accounts store the watchlist and email only.
- **Email only for opt-in alerts**, with an obvious unsubscribe; no email for anything else.
- **Anonymous viewing stays first-class** — no "login to continue," no gating, no nag.
  An account is an optional convenience for people who want it (Vow 1, Vow 11).
- **Data portability**: export (this pass already ships a server-free watchlist export —
  the account version must export at least as much), and account deletion deletes the
  server copy.

## 5. Recommendation

**Do not build accounts now.** The constitution is the product's identity ("zero accounts"
is in the site's first sentence on the home page and the privacy page's first line), the
feature set it would unlock is small, and every alternative below is achievable today:

| Want | Do instead (no constitution change) |
|---|---|
| Cross-device watchlist | Manual export/import (shipping 2026-08-16) or browser-sync via the browser's own account |
| Backup / portability | Watchlist export file (shipping 2026-08-16) |
| "New films" discovery | The browse/sitemap surfaces + genre landing pages (2026-08-16) |

If the site's audience later demonstrably wants sync or alerts, this RFC is the checklist
for that decision: amend §5/§9 + Vow 5 + specs.md deliberately, add the D1 + Better Auth
phase, rewrite the privacy page, and guard the new surface with the existing smoke
discipline. Until the owner makes that call, the no-accounts promise stays guarded by the
smoke suite (see the no-accounts vow guard, smoke 2026-08-16).
