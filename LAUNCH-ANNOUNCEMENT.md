# 347movies is live — free movies, no interruptions, ever

**Watch at https://347movies.pages.dev**

347movies is a free movie website: **18,489 full public domain and Creative Commons films,
streamed free in your browser — no accounts, no paywall, and ads never interrupt the film.**

## What you get

- **Real movies, legally free.** Every film on the site carries a declared public domain or
  Creative Commons license, verified from archive.org's own license metadata before it
  appears. Films whose legal status can't be verified are excluded — never included on a
  guess.
- **Silents, noir, westerns, sci-fi, horror, and more.** Browse by genre, decade, or sort;
  search any title, actor, or genre; or hit **Surprise me** and jump to a random film.
- **A player that just works.** Films play in an embedded player served by the Internet
  Archive. We never host, store, or proxy a single video byte — the archive does, which is
  why the site is free forever.
- **No interruptions, ever.** Ads live only in clearly labeled sidebar and leaderboard
  slots. They never pause, overlay, or precede a film. The movie is sacred.
- **Private by default.** No accounts, no tracking, no data selling. Your watchlist is saved
  only in your browser and never sent to any server.

## How it's built

- **Stack:** Cloudflare Pages + Pages Functions, with the Internet Archive as the film
  source. Catalog, search, and browse are powered by our own API over archive.org's public
  catalog.
- **Verified, not claimed.** Every route, every filter, every error path was exercised in a
  real browser — including the full viewer walk (search → play → save → watchlist). A live
  smoke test re-checks the entire site in one command (`npm run smoke`, 72 checks).
- **Secure by default:** hardened headers, validated inputs, rate-limited APIs, no secrets
  in the browser, no back doors.

## How we make money (transparently)

Two honest revenue streams, neither of which touches the viewing experience:

1. **Display ads** in the labeled sidebar and leaderboard slots — never over, inside, or
   before the player. Slots are live and reserved; advertiser contact:
   **contactae2000@gmail.com**.
2. **Affiliate links** on films that are *not* freely watchable, always visibly disclosed.
   Because every catalog film is freely watchable, no affiliate link is currently shown.

## Our promises

Free forever · legal-only, always · zero storage · private by default · real code, no fakes
· no errors left behind · secure by default · built in public (full evidence ledger at
`changelog.md`) · **the viewer comes first**.

Grab some popcorn — the movies are waiting.
