# 347movies — Vows

The founding promises of 347movies. These are non-negotiable. Every line of code, every deployment, and every future feature must honor these vows. If a feature would break a vow, the feature does not ship. Re-read this file at the start of every work session.

---

## Vow 1 — Free forever

Every movie on 347movies is free to watch, no exceptions, no paywall, no premium tier that hides movies. The site earns money from ads and affiliate links — never from charging viewers. A movie that can't be free doesn't go on the site; a user who can't pay is never turned away. Free is the product, not a trial.

## Vow 2 — Ads never interrupt the movie

The movie is sacred. No ad may ever pause, overlay, precede, or interrupt the player. Ads live only in sidebar and leaderboard slots, quiet and off to the side, the way a newspaper has ads next to the article — not inside it. If an advertiser ever demands an interrupting placement, the answer is no. We would rather earn less than break the viewing experience. This is the vow that makes the site worth visiting at all.

## Vow 3 — Legal-only, always

347movies streams only public domain, Creative Commons, and explicitly licensed films. We will never embed, link to, or profit from pirated content — no unauthorized mirrors, no scraped streams, no "123movies-style" sources. Legal-only is not a constraint we work around; it is the business model. A site that streams stolen films gets shut down, sued, and abandoned by its ad network. A site that streams free legal films gets to exist for years. Every film's legal status is verified at ingestion and recorded on its record.

## Vow 4 — Zero storage, by design

We never host a single video byte. Films are embedded from the Internet Archive, which stores and serves the files. Our storage and bandwidth costs for video are literally $0, and that keeps the site free forever. If we ever host video ourselves, we must be able to prove the cost is justified — until then, embed, don't host.

## Vow 5 — Private by default

No accounts. No sign-up walls. No data selling. No fingerprinting. No hidden trackers. What you watch is your business and stays on your side of the screen. If the site collects anything, it is the minimum needed to serve the page, it is disclosed on the privacy page, and it is never sold. Privacy is not a feature to bolt on later — it is the default state of the site.

## Vow 6 — Real code, no fakes

No mock code, no pseudocode, no placeholder functions, no stub responses, no dummy data pretending to be real. Every function actually does its job. Every API call actually happens. Every page actually renders. If something can't be done for real, we say so — we never fake it. A partially-done task reported honestly is acceptable; a finished-looking task that's secretly fake is not. This vow applies to code, tests, status reports, and documentation alike.

## Vow 7 — No errors left behind

Every error — build failure, failing test, console error, broken page, dead link, failed deploy — is fixed before we call the work done. We fix root causes, not symptoms. We never silence errors, never hide them, never ship with known breakage. An error found during testing is a gift; it means we found the bug before a viewer did.

## Vow 8 — Transparent monetization

Ads and affiliate links pay for the site, and we never hide that. Affiliate links carry a visible disclosure. Ad slots are labeled. We are honest about how the site makes money, in the about page and in the codebase. We will never use dark patterns, fake download buttons, or deceptive placements to earn a click. If a viewer can't tell an ad from the site, we've failed this vow.

## Vow 9 — Secure by default, no back doors

The site is hardened against attack: strict headers, validated input, rate-limited APIs, no secrets in the browser, no admin back doors, no hidden routes, no debug endpoints in production. Security is not a checklist item done at the end — it is built into every endpoint, every page, and every deployment from day one. Fail closed: when something is unknown, the safe answer wins.

## Vow 10 — Build in public, report honestly

Status reports are claims, not proof. Every "done" is backed by raw output — real command output, real test results, real deploy logs. Unverified is marked unverified. We document decisions in the changelog as they happen. We never claim something works unless we watched it work. The project's history is an honest ledger anyone can audit.

## Vow 11 — The viewer comes first

Every design decision starts with the person watching: fast page loads, clean layout, a player that just works, captions when available, movies that are actually free. If a choice serves revenue but hurts the viewer, the viewer wins. The site should feel like it was made for movie lovers, because it was.

---

These vows are the contract between 347movies and its viewers, and between the project and every agent who works on it. When in doubt about a decision, ask: *does this honor the vows?* If the answer is no, don't do it.
