# 347movies — institutional-licensed archive.org collections beyond the mark flood (research)

**Update 2026-08-24 — aggregation method broke the "ceiling is dry" conclusion.** Prior
sweeps guessed collection NAMES and repeatedly hit 0; this round instead sampled the top
10,000 licensed movies by downloads and aggregated their real `collection` fields, surfacing
collections nobody had named. Three registrations followed:

- **`wwIIarchive` (2,821 gated movies) — REGISTERED as the `wwii` pool.** US government WWII
  films (The Last Bomb 1945, Education for Death 1943, The New Spirit 1942), all
  `publicdomain/mark/1.0` institutional marks, year range 1936–1986, fully disjoint from the
  films union. NOTE: Solr collection names are case-sensitive — `collection:wwIIarchive`
  returns 2,821 while `collection:wwiiarchive` returns 0.
- **`universal_newsreels` (595 gated movies) — REGISTERED as the `newsreels` pool.**
  Universal Newsreels 1933–1967, all `publicdomain` marks, disjoint from films (distinct from
  the home page's Prelinger keyword feed).
- **`usgovfilms` (12,583 gated movies) — the `govfilms` gate WIDENED** from
  `collection:FedFlix` to `collection:(FedFlix OR usgovfilms)`. FedFlix (5,947) is 100%
  inside usgovfilms; the 6,636-item remainder is institutional (House/Senate floor
  proceedings, NRC hearings, FDA films). Index cache key bumped to `govfilms-index-v2` to
  force a rebuild past the 24h edge TTL.

Still rejected: `childrenstelevision` (1,616 — self-declared marks on Blue's Clues/Wild
Kratts "Full Series"), `artsandmusicvideos` (6,002), `frank-moore-archives` (1,502 NSFW
by-nc-nd), `mit_ocw` (463 coursework), `ElectricSheep` (819 generative art), `vhsvault`
(12,382 VHS rips), and the junk drawers. `Comedy_Films`/`SciFi_Horror`/`Film_Noir`/
`film_scifi`/`TheVideoCellarCollection`/`cinemocracy` are 100% films-union overlap (genre
views, not new content).

## Method: aggregation-based probing (use this instead of guessing names)

Every pre-2026-08-24 sweep worked by *naming* candidate collections
(`collection:oldtv`, `collection:newsreels`, …) and asking "how many licensed movies does
THIS one hold?" — which repeatedly returned 0 because the interesting collections weren't
on the guessed list. The reliable method is the reverse: enumerate the licensed population
and let archive.org tell you which collections actually hold it.

1. **Sample the licensed population, not a guess list.** Fetch the site's legal gate
   (`LEGAL_CLAUSE` + `mediatype:movies`) sorted by `downloads desc`, `rows=10000`, several
   pages deep (downloads-desc surfaces the collections real viewers use, unlike an
   arbitrary guess). Request `fl=identifier,collection,title`.
2. **Aggregate the `collection` field** across the sampled docs. It is multi-valued and
   polluted with `fav-*` favorites noise — drop any value starting `fav-` plus the
   `community`/`ourmedia` junk-drawer markers before counting.
3. **Rank the result.** The collections nobody guessed (e.g. `wwIIarchive`, `universal_newsreels`,
   `usgovfilms`) rise to the top by their real item count.
4. **Gate + overlap-check each candidate** with three exact counts: the gate alone
   (`LEGAL_CLAUSE AND collection:X AND mediatype:movies`), the films-union overlap (add
   `AND collection:(feature_films OR prelinger OR moviesandfilms)`), and the exclusive
   remainder. 100% overlap = a curated/genre view of an existing pool, not new content;
   disjoint = genuinely new.
5. **Sample provenance before registering.** Item-level `fl=identifier,title,year,licenseurl`
   (downloads-desc) distinguishes institutional/curator marks (NARA, FedFlix, AAPB, the
   `wwIIarchive` `publicdomain/mark/1.0` set) from self-declared-mark junk (`childrenstelevision`,
   `opensource_movies`). Reject the latter regardless of count.

Two gotchas this method exposed: (a) **Solr collection names are case-sensitive**
(`collection:wwIIarchive` = 2,821 vs `collection:wwiiarchive` = 0) — always copy the exact
name from the aggregation output, never normalize it; (b) the `advancedsearch` `facets[]`
parameter is not supported (returns `UNSUPPORTED_VALUE`) — aggregate client-side from a
sample instead.

---

**Researched 2026-08-19.** Question: beyond the already-registered institutional pools (AAPB →
`publictv`, Wellcome → `science`, FedFlix → `govfilms`, LibriVox → `audiobooks`, Great 78 →
`records`), are there other archive.org collections where the license marks come from the
institution/curator rather than self-declared uploaders — and are any worth registering?
Method: the site's own license gate — the `LEGAL_CLAUSE` constant in `lib/archive.ts`, which
gates both declared-mark scheme arms (`licenseurl:https://creativecommons.org*` OR
`licenseurl:http://creativecommons.org*`) — run against each candidate collection via the
advancedsearch API, then item-level sampling (uploader, license, year, title) for every
candidate that cleared the gate. (Note: a scheme-less `licenseurl:creativecommons.org*`
returns 0 and silently invalidates any probe — always reference the constant, see the
2026-08-22 update below.)

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
- **Suggested gate:** `LEGAL_CLAUSE AND collection:avgeeks AND mediatype:movies` (the
  `lib/archive.ts` constant — never the scheme-less `licenseurl:creativecommons*` form) —
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

## Update 2026-08-22 — footage pool (curated view of Films)

Re-probe after the 2026-08-21 matrix confirmed the licensed well dry for new movies/TV. Two
collections newly cleared the license gate but are NOT institutional: `stock_footage` (1,927
licensed movies) and `home_movies` (495). Both are mixed bags — the modern slice is
royalty-free HD stock loops (fireplaces, baking-cookie clips from Beachfront Productions) and
contemporary home video, so a gate over the whole collection would be a junk drawer. But the
**pre-1970 band is genuine archival footage**: 445 license-marked movies (year distribution:
≤1909 = 25, 1910s = 2, 1920s = 19, 1930s = 117, 1940s = 94, 1950s = 81, 1960s = 107) —
Coney Island boardwalk crowd 1940, Hindenburg over NYC 1937, 1939 NY World's Fair home
movies, early 20th-century street scenes. Measured overlap: ALL 445 also sit in
`moviesandfilms` (the films union) — so the footage pool is a **curated view of Films**
(like shorts/silents), registered 2026-08-22 with the pre-1970 year bound (same pattern as
anime/records: the yearless band ≈ modern uploads and is excluded).

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

## Re-verification 2026-08-22 (8th sweep, after the footage pool)

Probed ~90 more candidates with the corrected license clause — the site's exact gate,
mirroring the `LEGAL_CLAUSE` constant in `lib/archive.ts`
(`(licenseurl:https://creativecommons.org* OR licenseurl:http://creativecommons.org*)`,
the single source of truth — a scheme-less `licenseurl:creativecommons.org*` returns 0
and silently invalidates any sweep; the first pass of this round hit that, caught by a
known-good sanity check before trusting results). **No new movie/TV pools exist; the
registered 18 are complete.**

- **51 collection-name probes** (`featurefilms`, `cinema`, `classicmovies`, `broadcasting`,
  `publicaccess`, `newsfilm`, `classroomfilms`, `ww2films`, `animationarchive`,
  `radioarchive`, …): **all 0 licensed movies**.
- **~35 more** (`prelingerarchives`, `silentcinema`, `kino`, `opencourseware`, `toons`, …):
  **all 0**.
- **Identifier-prefix probes — REJECTED as junk.** `identifier:disney*` (843), `identifier:loc*`
  (294), `identifier:abc*` (241), `identifier:paramount*` (108) look large but are prefix
  collisions with fan uploads: "loc*" → Lock Up episodes, "abc*" → ABC For Kids DVD rips,
  "disney*" → promotional DVD compilations, "paramount*" → fan-made compilations
  ("Down and Dirty Duck (Fanmad)"). Same self-declared-mark failure mode as
  `opensource_movies`; the site's institutional trust model (curator-applied marks) rejects them.
- **Pool growth re-measured: flat.** films 18,491 (matrix 18,487, +4 organic), tv 2,513,
  documentaries 8,420, sports 3,625, shorts 1,858, silents 729, publictv 1,653, science 257,
  govfilms 5,948, ephemera 413, space 719, footage 445, anime 24 — all identical to
  registration within noise. The curated collections are not accumulating new license-marked
  items.

**Conclusion (4th confirmation): the catalog ceiling (~75k items / 18 pools) is complete.**
Adding content requires either a new institutional collection appearing upstream (re-probe
periodically) or relaxing the license gate, which the constitution forbids.

## Re-verification 2026-08-22 (audio-side deep probe, after the 8th video sweep)

Deep-probed the audio side (~110 candidates through the same legal gate, both
`mediatype:audio` and `mediatype:etree`) since prior rounds focused on movies/TV.
**No new audio pools exist; the four registered (otr, music, audiobooks, records) are
complete.**

- **~100 collection-name probes** (radio drama: `radioshows`, `radio_programs`,
  `classicradio`, `radioplays`, `oldtime radio2`; music: `live_music`, `rockconcerts`,
  `orchestral`, `swing`, `bigband`, `bluegrass`, `gospel`, `netlabels`; audiobooks:
  `openaudiobooks`, `audio_books`, `publicdomainbooks`, `librivox`; records:
  `78rpmrecords`, `shellac`, `gramophone`, `victor_records`, `edison_records`,
  `cylinders`; podcasts/other): **all 0**.
- **Institutional identifier probes** (bbc, npr, voa, rfi, cbc, nhk, deutschewelle,
  ucla/berkeley/stanford/harvard/yale/mit/loc/congress, london_symphony, philharmonic,
  metopera): **all 0** licensed audio.
- **`radio` (21) — REJECTED.** Modern 2020 Spanish-language local radio programs with
  public-domain marks; 21 items, no institutional provenance.
- **`podcasts` (286,871) — REJECTED.** The self-declared-mark community flood: college
  course lectures (BY-NC), MLK speeches, Mahabharata readings, Tagalog mass podcasts.
  Same failure mode as `opensource_audio`; year data confirms modern uploads
  (112,680 in 2010-2019 alone).
- **`radioprograms` (185,539) — REJECTED, with a useful confirmation.** The curated OTR
  pool (`oldtimeradio`, 2,309) is **100% inside** radioprograms — the existing pool already
  captures the good curated subset. The remaining ~183k are fan-upload radio dramas
  (Gunsmoke/Johnny Dollar/Suspense "single episodes" uploaded 2015-2020, BY-NC marks) plus
  modern podcasts; no institutional provenance.
- **`netlabels` (61,143) — REJECTED.** Modern free-music netlabel releases (BY-NC
  electronic), the `opensource_audio` failure mode.

**Conclusion (5th confirmation): the audio ceiling holds too (~27k audio items / 4 pools).**
The catalog's ~76k-item total across 18 pools is complete on both the video and audio sides.
