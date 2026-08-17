# RFC: admitting unmarked-but-public-domain collections (`classic_films`, `SilentEra`, `publicdomainmovies`)

**Status: DECISION SPACE — no implementation.** This document is the owner's decision
aid, not a plan. Nothing here changes code; changing the legality gate is a constitution
amendment only the owner can make.

**Date:** 2026-08-16 · **Author:** catalog scan pass + deploy #17 audit + the standing
legality policy (`lib/archive.ts`, `constitution.md`, `specs.md`).

## 1. The problem

The site's catalog is gated by two conditions on every item: it must sit in one of
archive.org's three curated movie collections (`feature_films`, `prelinger`,
`moviesandfilms`) **and** carry a declared license mark (`licenseurl` pointing at a CC or
public-domain URL). That gate yields the current ~18,488 legal-marked items (≈15,920 films
after the films-only policy).

Collections like `classic_films`, `SilentEra`, and `publicdomainmovies` contain
thousands of films that are *very likely* public domain — their collection names are the
claim — but archive.org never wrote a `licenseurl` on them. Measured live 2026-08-16:
**zero** items in those three collections carry a license mark, so the current gate
excludes them entirely. The catalog is therefore smaller than the legitimate pool.

## 2. What admitting them would buy — measured

The scan also quantified the nearby candidates that DO carry license marks:

| Collection | Legal-marked | Verdict from the 2026-08-15 audit |
|---|---|---|
| `silent_films` | 729 | Real silent films — but silent-era, the opposite of the modern-content ask |
| `short_films` | 1,858 | Serial chapters + newsreels (films-only policy drops most); a few genuine shorts |
| `animationandcartoons` | 1,308 | Mostly fan-made Warrior Cats MAP projects; a few legit items |
| `classic_films`, `SilentEra`, `publicdomainmovies` | **0** | Need a *second trust path* — the licenseurl gate can't see them at all |
| `opensource_movies` | 401,350 | Uncurated upload dump — quality regression, rejected (deploy #17) |
| `newsandpublicaffairs` | 178,229 | Uncurated — same |

Union-exclusive of the three license-marked candidates beyond the current gate: **~1,293
items** — overwhelmingly old/short/fan-made. The three unmarked collections would add
more (their totals are unmeasurable under the license gate), but what they hold is old
film: silents and classic-era features. None of this is the modern content the owner
asked for; the modern wave arrives via organic CC uploads and is already flowing in.

## 3. Options

**Option A — do nothing (status quo).** The gate stays: licenseurl mark + curated
collection + per-film verification on the detail page. Predictable, fail-closed, no new
legal surface. The catalog keeps growing organically (2026 added hundreds of films).

**Option B — per-item verification pipeline for unmarked collections.** Admit a bounded
set of unmarked items after an automated check: archive.org `rights`/`date` fields, a US
public-domain rule-of-thumb (publication ≤1963 with no renewal, or pre-1930), and a
curator sample. This replaces "licenseurl presence" with "verification outcome" as the
gate for these collections — a **new legal trust model**, not a config change.

**Option C — manual curation.** A human reviews a bounded batch (e.g. 500 titles) and
admits each explicitly. Highest confidence, lowest volume, real maintenance cost.

## 4. What each option requires from the constitution

The legality gate is a core vow (`constitution.md` §1, `specs.md` data model, `vows.md`):
today it is *mechanically enforced* by the licenseurl check. Options B/C change the
mechanism, so they require:

- A constitution amendment defining the new verification standard and who owns it.
- `lib/archive.ts` / `lib/catalog.ts` changes (the gate becomes a pipeline; detail-page
  verification gains the new path).
- A quality bar decision — the curated-collections rationale exists because the wider
  legal pool is dominated by uncurated uploads (deploy #17 measured 577k → 1.15M items,
  the extra ~99% junk).

## 5. Red lines (non-negotiable)

- **Fail closed:** anything uncertain stays out; a "maybe PD" is a no.
- **No relaxation for the uncurated pools:** `opensource_movies` / `newsandpublicaffairs`
  remain excluded regardless — this RFC is about *curated* collections only.
- **No claims beyond the law:** the site's honesty rules (no fabricated metadata, honest
  unavailable pages) apply to any admitted item.
- **Not a path to modern films:** even fully executed, this adds old film. If the goal is
  "more modern movies," the lever is organic CC uploads (already working), not this RFC.

## 6. Recommendation

**Defer (Option A).** The evidence: the marked candidates add ~1,293 items that are
mostly old/short/fan-made; the unmarked collections are old film by definition; the
modern-content goal is served by the organic channel already in place; and Options B/C
open a new legal trust model that only the owner should commission. If the owner ever
wants the old-film catalog maximized, the next step is a **bounded pilot** (Option C or a
small Option B batch, e.g. 500 titles, manually verified) rather than a wholesale gate
change.

## 7. Decisions needed (owner)

1. Is the old-film catalog worth a constitution amendment at all? (Recommendation: not now.)
2. If yes: Option B (automated pipeline) or C (manual curation), and who verifies?
3. What quality bar do unmarked items need to meet vs. the curated collections today?

Nothing in this document has been implemented.
