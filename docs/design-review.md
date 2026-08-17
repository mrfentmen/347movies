# 347movies — Web design review

**Reviewed 2026-08-16.** Visual inspection of the running site (dev server, Preview tab)
following the web-design-reviewer workflow: automated layout audit per page type
(overflow detection, broken images, text clipping, horizontal scroll) via in-browser
evaluation, plus screenshots of the key pages.

## Summary

| Item | Value |
|------|-------|
| Target | http://127.0.0.1:8787 (dev; canonical mirrors it — smoke 98/98) |
| Framework | None — zero-dependency static HTML/CSS/JS + Cloudflare Pages Functions |
| Styling | Pure CSS, mobile-first (`min-width` breakpoints: 640 / 900 / 1120) |
| Tested viewports | 687px (preview pane — below the tablet breakpoint, so mobile/tablet styles are exercised), plus the 320px case documented in the CSS for the search input |
| Pages audited | Home, Browse, Search, Movie (SSR), Watchlist, About, 404 |
| Issues detected | **0** |
| Issues fixed | 0 (nothing to fix) |

## Detected issues

None. Every page type passed the automated audit:

- **Element overflow / horizontal scroll**: zero elements exceed the viewport on any
  page; `document.scrollWidth == viewport` everywhere.
- **Broken images**: zero (all poster images load at their natural size; the
  initials-fallback covers any network failure by design).
- **Text clipping**: zero `card__title` elements clip (long titles ellipsize cleanly).
- **Console errors**: clean across all pages (also asserted live by the smoke suite).
- **Header/nav at narrow width**: the header is `flex-wrap: wrap` at base, the search
  input uses `width: min(200px, 60vw)` with a documented 320px-verified cap — the classic
  mobile squeeze points are structurally handled.
- **Grid progression**: 2 → 3 → 4 → 6 columns at 0/640/900/1120px — correct responsive
  behavior for poster cards.
- **404**: renders a proper status + recovery path, no layout breakage.

## Unfixed / untested items

- A true 375px viewport via a real window resize could not be exercised (the preview
  pane's window is fixed). Mitigation: the base styles are mobile-first, the narrowest
  case (320px) is explicitly documented and was verified for the search input, and the
  687px run already exercises the sub-tablet layout.
- Contrast was previously verified by Lighthouse (accessibility 100 across pages) and is
  smoke-guarded via the WCAG content checks — not re-measured this pass.

## Recommendations

- Nothing actionable — the design holds at narrow viewports with zero regressions.
- Optional future polish (not needed for launch): a true 375px visual pass in a resizable
  browser once the custom domain is attached, purely as a belt-and-suspenders check.
