# 347movies — institutional-licensed archive.org collections beyond the mark flood (research)

**Researched 2026-08-19.** Question: beyond the already-registered institutional pools (AAPB →
`publictv`, Wellcome → `science`, FedFlix → `govfilms`, LibriVox → `audiobooks`, Great 78 →
`records`), are there other archive.org collections where the license marks come from the
institution/curator rather than self-declared uploaders — and are any worth registering?
Method: the site's own license gate (`licenseurl:creativecommons.org*`) run against each
candidate collection via the advancedsearch API, then item-level sampling (uploader, license,
year, title) for every candidate that cleared the gate.

## Verdict

**One collection clears the institutional bar: `avgeeks` (413 gated movies) — worth registering.**
Everything else either fails the gate (0 marks), is books/texts rather than video, or is a
junk drawer of self-declared marks.

## Candidates that pass the gate

### 1. `avgeeks` — REGISTER (recommended)

- **413 license-marked movies** of 2,349 raw (mediatype:movies).
- **Provenance:** single curator — Skip Elsheimer's AV Geeks (`skip@avgeeks.com`,
  `skipe@mindspring.com` on item metadata). This is the same trust model as AAPB/Wellcome: the
  marks are the archivist's, applied to films he digitized, not fan uploads.
- **Content:** the classic American educational/industrial/ephemeral film canon — Private SNAFU
  (1943), Gateways to the Mind (1958), Joy of Living With Fragrance, Great American Chocolate
  Factory, Medical Quackery PSAs, U.S. Army/AT&T/NASA/Erpi Classroom Films productions.
- **License distribution:** all public-domain marks (`publicdomain/mark/1.0`,
  `licenses/publicdomain`).
- **Year metadata is unreliable but content is old:** yearless = 95, ≤1950 = 66, 1951–1980 = 238,
  1981+ = 14. The "2026" year values are re-upload dates (e.g. `TheThief1968` = the 1960 film
  "Thief"). The yearless band is the same classic canon (sampled: fragrance/chocolate factory
  films, 1950s PSAs) — **no year cutoff needed**, unlike anime/records.
- **Fit:** pairs naturally with the documentaries/shorts pools; the honest label is
  "ephemeral & sponsored films" or "classic educational films".
- **Suggested gate:** `licenseurl:creativecommons* AND collection:avgeeks AND mediatype:movies` —
  exactly the films-pool trust model, no extra bounds.

### 2. `europeanlibraries` — NOT a fit (books)

- 328,941 gated, but **320,113 are texts (books)**; the site streams video/audio.
- Audio slice (1,268) is Italian academic conference recordings (BY-NC-ND 4.0, lectures).
- Movie slice (271) is dominated by Wellcome Library films — **already in the `science` pool**.
- Verdict: real institutional marks, wrong content type for this site.

### 3. `smithsonian` — NOT a fit (books)

- 259 gated, all texts. No movies/audio. Verdict: books only.

## Candidates that fail the gate (0 license marks)

`georgeblood` (187k raw — George Blood's 78rpm digitizations), `usnationalarchives`,
`nasaimages`, `nasafoia`, `smithsonianlibraries`, `metpublicart`, `nationalfilmboard`,
`pathe`, `newsreels`, `travelfilms`, `cylinder_records`, `edison`, `cdl`,
`universityofcalifornia`, `harvard`, `yale`, `mit`, `pbs`, `PBSNewsHour`, `newshour`, `wnet`,
`publicresourceorg`, `govdocs`, `congressional`, `cspan`, `biodiversitylibrary`,
`biodivlibrary`, `documentaryfilms`, `educationalfilms` (10 gated — same honest-rejection
rationale as the docs pool), `scifi`, `artfilm`, `comedy_films`.

Notable: `georgeblood` is age-safe content (pre-1923 cylinders) but carries **no licenseurl
marks at all**, so it cannot pass the site's mark-based gate — including it would require the
age-only relaxation the site has deliberately avoided. The licensed `78rpm` subset (the
`records` pool) already covers the same Great 78 digitizations.

## Junk drawer that cleared the gate but is NOT institutional

- **`audio_music`** — 73,758 gated audio, but mixed: some genuinely old PD-by-age recordings
  (1921 Edison symphony) alongside modern self-declared-mark uploads (Bull of Heaven ambient
  project, Gathacol Radio compilations). Same failure mode as `opensource_audio`; the marks are
  not institutional. Rejected.

## Bottom line

The licensed-content ceiling holds except for one genuine addition: **`avgeeks` (413 films)**.
Registering it is a small, honest win — same gate, same trust model, no new bounds — and brings
the classic educational/sponsored-film canon to a pool that currently only reaches it
secondhand through `moviesandfilms`. The 15-pool register is otherwise confirmed complete.
