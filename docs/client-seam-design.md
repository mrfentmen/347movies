# Client seam design pass (public/js/app.js)

**2026-08-16.** Deep-module analysis (codebase-design vocabulary) of the client seam — the
single external script that drives every page (`data-page` boot dispatch). The goal:
name what is already deep, find the shallow spots, and identify the **deepest refactor**
that would cut the duplicated fetch/render logic. Report only — nothing here changed code.

## What is already deep (keep)

- **`apiFetch`** — one fetch wrapper owning the whole error surface (network → friendly
  message with `status: 0`; non-OK → message extraction + 429 copy). Every page crosses the
  same seam; callers never touch `fetch` or `Response` handling.
- **`cardShell` / `movieCard`** — the single card builder (markup + field escaping + watch
  button state), shared by every grid: home, search, browse, genre, watchlist. The tidy pass
  already unified this.
- **`renderGrid`** — grid render + empty state + `aria-busy` + poster-fallback binding +
  watch-button binding behind one call.
- **`renderError`** — error box + `role=alert` announcement + retry wiring behind one call.
- **`renderResults`** — count line (with the honest paging-cap copy) + grid + pagination,
  shared by browse and genre.
- **The watchlist module** — load/save/toggle/export/import, cohesive and encapsulated
  behind `WATCH_KEY`/`WATCH_MAX`.

## The shallow spots

1. **The fetch → head/count/grid/nav → error lifecycle is handwritten five times**:
   `initSearch` (both branches), `initGenre`, `initBrowse`, and `loadHomeSection` (grid +
   retry only). Each repeats `apiFetch(...).then(render...).catch(renderError)`, count
   pluralization, and `paginationHtml(makeUrl)` with small copy differences.
2. **The page-number parse** — `parseInt(params.get("page") || "1", 10)` +
   `Number.isFinite(...) && >= 1 ? ... : 1` is duplicated in `initSearch`, `initGenre`,
   and `initBrowse`.
3. **Count-line copy drift** — search says "N films found"; `renderResults` says "N films"
   or "N films · showing the first M". Same shape, different words, two implementations.

## The deepest refactor (if implemented)

A single **`loadCatalogPage`** module that owns the whole lifecycle behind a small options
object:

```
loadCatalogPage({
  path,          // /api/browse?... or /api/search?...
  grid, count, nav,   // DOM targets (nav optional)
  headText,      // optional static head
  makePageUrl,   // (p) => next-page URL
  noun,          // "films" | "shows" — count-line pluralization
  emptyMessage,  // optional no-results state
  retry,         // optional retry callback
})
```

Behind it: `apiFetch` + `renderResults` (extended to take the `found`/`noun` count copy) +
`renderError` + `paginationHtml`. This absorbs `initGenre` entirely, both `initSearch`
branches, `loadHomeSection`, and most of `initBrowse` — the browse head composition and the
filter-select navigation stay in `initBrowse` (they are URL/protocol logic, not rendering).

**Why it is deep:** one call exercises fetch → busy state → grid → count → pagination →
error → retry. A future catalog page (a new curated row, a TV genre page) becomes a
~10-line init instead of a fifth copy of the lifecycle.

**Why it was not done in this pass:** it touches every init on deployed, 220-check-guarded
client code, and the per-page differences (browse's filter-line head, search's no-results
message, home's retry) are real — they need option plumbing, making this a medium-size
refactor with a genuine regression surface. Reported for an owner call; the smoke suite +
browser battery would guard the implementation.

## Accepted, not changing

- The hidden-input TV injection in `initSearch` — route protocol (keeps a TV search on the
  TV pool), minimal and self-contained.
- `initBrowse`'s two URL builders (filter-select navigation vs the fetch URL) — different
  outputs, kept separate deliberately.
- The one-line ternaries at the URL seam (`tv ? "tv" : "films"`-style) — URL protocol
  knowledge, correctly at the routes.

## Recommended order (if implementing)

1. Extract `pageFromParams(params)` — three copies → one, trivially safe.
2. Then `loadCatalogPage` — the deep cut above, guarded by the smoke suite.
