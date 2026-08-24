# 347movies — content-sourcing policy

**The hard rule:** no new catalog source is added unless it can be expressed as a **license gate** — a check that every item it exposes carries a *verifiable* public-domain or Creative Commons declaration, or (for official rights-holder channels) a curated channel allowlist whose identity *is* the declaration. If a license cannot be verified, the item is excluded. Never guess, never include on trust alone (constitution §1).

This rule is what keeps 347movies a "free movie site that can never be shut down for infringement" instead of another 123movies. It applies to every future source — not just archive.org.

## The gate is one constant

`LEGAL_CLAUSE` in `lib/archive.ts` is the single source of truth for the archive.org gate text. Every query-builder — search, browse, catalog index, sitemap, license-sweep, scan-longtail — derives from it (or from `BASE_CLAUSE` / the per-pool `*_BASE_CLAUSE` wrappers). Never hardcode a clone: a change to the clause must land in one place. The unit suite pins this with drift guards; do not weaken those tests.

## Three accepted trust models

1. **Declared-mark gate (archive.org, Wikimedia Commons).** The source's structured metadata carries a license field: archive.org `licenseurl`, Commons `extmetadata.License`. The gate asks "does the field carry a CC/PD URL?" — the `LEGAL_CLAUSE` shape.

2. **Institution/curator marks (archive.org collections).** AAPB (`publictv`), Wellcome (`science`), FedFlix (`govfilms`), AV Geeks (`ephemera`), LibriVox (`audiobooks`), Great 78 (`records`). The marks are applied by the institution or a named archivist, not fan uploaders — same gate, higher trust. Probes must distinguish these from self-declared-mark floods.

3. **Channel-identity gate (YouTube).** For official rights-holder channels (NARA, NASA, Library of Congress, Prelinger, British Pathé), the curated channel allowlist *is* the gate. YouTube's per-video `videoLicense` flag is the wrong signal for public-domain government works (usually marked "Standard"), so broad "free movie" YouTube searches are never a source. Only allowlisted channels; never search YouTube at large.

## Fail closed, always

- Cannot verify → exclude (`not_legal` on the detail path).
- Metadata missing or ambiguous → exclude.
- A collection whose marks are all self-declared fan uploads (modern anime rips, etc.) → exclude or bound by an honest year/curator cutoff (see the anime/records precedents documented in `lib/archive.ts`).

## Never allowed (non-negotiable)

- Pirate/aggregator sites (123movies-style), unlicensed mirrors, torrent or index sources.
- "Free movie" sites with no license metadata to gate on.
- Scraping or downloading video bytes (constitution §7 — $0 storage: embed only, never host or proxy).

## Honest labeling is part of the gate

A source with a *different trust basis* must say so in the UI:

- Curated-view pools (shorts/silents/footage/TED) disclose their overlap with the films union.
- YouTube channel results carry a `basis` label — "public domain" (NARA/NASA/LoC/Prelinger) vs "rights-holder" (British Pathé, which licenses footage but does not dedicate it to the public domain).

Never stamp "public domain" on content that isn't.

## Checklist for any candidate source

Before registering a new source, answer each:

- [ ] **Gate:** can it be expressed as a query/check over structured metadata, or a finite channel allowlist?
- [ ] **Provenance:** are the marks institutional/curator-applied, or self-declared? Probe live — don't assume.
- [ ] **Single source:** does the gate derive from `LEGAL_CLAUSE` (or a new exported constant with its own drift-guard test)?
- [ ] **Embed vs host:** does it embed from the source's own CDN (no storage, no proxy)?
- [ ] **CSP:** are the needed hosts added to `functions/_middleware.ts` (and `public/_headers`) minimally, gated on config?
- [ ] **Honesty:** does the UI disclose the trust basis where it differs from plain PD/CC?

## Related

- `docs/institutional-collections-research.md` — the live-probe method and results.
- `lib/archive.ts` — `LEGAL_CLAUSE` and the per-pool gate constants.
- `constitution.md` §1 (legal-only) and §7 ($0 storage).
