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

## Re-verification 2026-08-21 (after PR #32)

Re-probed ~120 candidate collections through the license gate (four rounds: wide sweep, film
subtypes, TV siblings, radio/audio variants). **No new institutional pools exist; the
registered 17 are complete.** Evidence:

- **`opensource_movies` (402,714 gated) — REJECTED.** The only large collection that clears
  the gate, but it is the community junk drawer with self-declared marks, same failure mode
  as `audio_music`/`opensource_audio`. Even the pre-1928 PD-by-age band (2,745 gated) is
  unreliable: top item by downloads tagged `year=1919` is a 2013 music video; "NFL REPLAYS"
  tagged 720; the 120k-item yearless band is pure junk. Unlike `78rpm` (institutional Great 78
  metadata) or `anime` (year bound verified against samples), `opensource_movies` year data is
  uploader garbage, so an age-bound gate there would leak modern uploads. Zero overlap with
  the films union confirms it is a separate population.
- **`television` (17,744 gated) — already captured.** Only 1,653 are the AAPB `aapb*`
  subset (the `publictv` pool); the remaining 16,091 are modern community rips excluded by
  the identifier bound, as documented in lib/archive.ts.
- **`tvarchive` = 1 item.** All other TV siblings (`classic_television`, `old_tv`,
  `tv_programs`, `kinescope`, `golden_age_tv`, …) = 0 gated.
- **Gate counts re-measured live: identical to registration** for all 16 non-film gates
  (e.g. classic_tv 2,514, 78rpm 5,039, FedFlix 5,948, nasa 719, avgeeks 413). No organic
  growth to harvest; the curated collections are not accumulating new license-marked items.

**Conclusion:** the catalog ceiling (~73k items / 17 pools) is confirmed complete for a
third time. Adding content beyond it requires either a new institutional archive.org
collection appearing upstream (re-probe periodically) or relaxing the license gate, which
the constitution forbids.
