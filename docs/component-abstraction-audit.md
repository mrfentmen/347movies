# Component-abstraction audit — the vanilla design system (read-only, 2026-08-16)

**Scope:** analysis only — no code changed. The question: *if* the site ever adopted a
framework (React + Tailwind + shadcn/ui), which current vanilla patterns in
`public/js/app.js` + `public/css/style.css` would genuinely benefit from component
abstraction, and which would not. Companion artifact: the standalone prototype in
`ui-prototype/` that re-implements two surfaces with shadcn components.

## The current shape (facts)

- `public/js/app.js` — 642 lines, one IIFE, six page inits (`initHome`, `initSearch`,
  `initBrowse`, `initGenre`, `initMovie`, `initWatchlist`) dispatched off
  `document.body.dataset.page`.
- Reused building blocks (already de-duplicated, shared across pages): `cardShell`/
  `movieCard` (one card builder), `renderGrid`, `renderError`, `renderResults`,
  `paginationHtml`, `watchBtnHtml` + the watchlist module, `apiFetch`, `escapeHtml`.
- `public/css/style.css` — 1206 lines, CSS custom properties for every token, class
  names are also JS hooks and smoke-suite contracts (renaming a class is a breaking
  change by design).

## Would benefit from component abstraction (if adopted)

1. **The card family** — `cardShell`/`movieCard`/`watchCardHtml` + the `.card` CSS block
   (poster, body, title/year, watch-save bar, skeleton, empty state). This is the single
   most-reused composite on the site (home feeds, search, browse, genre, watchlist).
   In a framework it becomes one `<MovieCard>` with props + variants. This is the
   pattern the prototype re-implements with shadcn `Card` + `Button` — it is the *right*
   abstraction candidate because it has real multiplicity (6+ render sites).
2. **The film-slate meta chip** (`.chip` + eyebrow + uppercase mono treatment) — appears
   as year, runtime, genre, license, section eyebrow, pagination. One `<Chip>`/
   `<Eyebrow>` variant component maps cleanly onto shadcn `Badge`.
3. **The fetch → head/count/grid/nav → error lifecycle** — handwritten five times
   (`initSearch` ×2 branches, `initGenre`, `initBrowse`, `loadHomeSection`). A shared
   `loadCatalogPage` module (already analyzed in `docs/client-seam-design.md`) is the
   deepest refactor; in a framework this becomes a `useCatalogPage` hook + a
   `<CatalogPage>` component. This is the highest-leverage abstraction.
4. **Form controls** — search inputs, selects, buttons share pill geometry and one focus
   treatment. shadcn `Input`/`Select`/`Button` would centralize the interactive-layer
   family (the DESIGN.md "one family" rule).

## Would NOT benefit (keep as-is even in a framework)

5. **The ad-slot boundary** — deliberately dormant server-rendered placeholders with a
   fail-closed contract; abstraction adds nothing, and the CSP/`connect-src` discipline
   is a server concern, not a component concern.
6. **The SSR movie page** (`lib/layout.ts`) — SEO/OG/JSON-LD/no-iframe-noscript are
   server-rendered and must stay so (crawlers, no-JS). A client component framework
   would *duplicate* this surface, not simplify it.
7. **The player embed** — one cross-origin iframe; a `<Player>` wrapper is a pass-through
   (the deletion test: complexity vanishes). Keep as markup.
8. **The watchlist storage** — pure localStorage logic with a 200-item cap; a hook is a
   rename, not an abstraction with leverage.

## The measured price (from the prototype)

The minimal two-surface shadcn prototype ships **239 KB JS / 75 KB gzip** — before any
real feature (search, browse, watchlist, genres, ad slots, TV variant, SSR SEO).
The live site's entire client is **29 KB unminified**. The audit's verdict: the
abstraction candidates above are real, but their value must clear that ~10x client-js
cost plus the dependency/supply-chain surface (the site's zero-runtime-deps posture is a
documented security property, PRELAUNCH-STATUS §Security). That is the owner's call to
make deliberately — nothing here changes the live site.

## Bottom line

If a migration is ever pursued, the order of value is: (3) the catalog-page lifecycle,
(1) the card family, (4) the form family, (2) chips/eyebrows. Everything else stays
server-rendered or plain. The prototype demonstrates (1) + (2) in isolation.
