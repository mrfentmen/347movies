# Decision 002 — Curated-view canonical: shorts/silents stay self-canonical

- **Date**: 2026-08-21
- **Status**: Approved
- **Question**: Should `/shorts` and `/silents` point `rel=canonical` at `/browse` (the
  Films catalog) because every title there also appears in the films union, or stay
  self-canonical landing pages?
- **References**: specs.md Phase 6 (SEO); scripts/smoke.mjs (curated-view disclosure
  guard, "measured 2026-08-18: 0 exclusive items"); lib/archive.ts (SHORTS/SILENTS gates);
  public/shorts.html + public/silents.html (self-canonical tags, hero note, meta
  description, JSON-LD `isPartOf` → /browse); docs/decisions/001 (decision-record format)

## Decision

**Stay self-canonical.** `/shorts` and `/silents` keep `<link rel="canonical"
href="https://347movies.pages.dev/shorts|silents">` — they are distinct landing pages,
NOT duplicates of `/browse`, and must never point canonical at it.

## Context

Shorts and silents are 100% subsets of the films union (measured 2026-08-18: 0 exclusive
items). That overlap is real and is disclosed on every channel that exists for it. The
question is only which URL should be "canonical" — the one crawlers treat as authoritative.

## Why not canonical → /browse

1. **Canonical means duplication, not hierarchy.** `rel=canonical` tells crawlers "these
   two URLs serve the same content; index only the canonical one." Shorts/silents are not
   byte-identical to /browse: each carries its own title, meta description, hero copy,
   curated-view badge, genre chips, and JSON-LD. They are legitimate category landing
   pages targeting different queries ("short films free", "silent films online").
2. **It would de-index the landing pages.** A canonical signal is a strong consolidation
   instruction: Google would attribute the pages' signals to /browse and typically drop
   /shorts and /silents from the index. That removes their rankings, their SERP
   disclosure (meta description), and their curated-view UX as an entry point.
3. **The relationship is already machine-readable on the right channel.** The JSON-LD
   `CollectionPage` expresses the subset via `isPartOf` → /browse — schema.org's
   vocabulary for "this is a curated view of that catalog." Canonical would conflate
   hierarchy with duplication and contradict that signal.
4. **No duplicate-URL sprawl exists to fix.** Item-level dedup is already handled at the
   detail URL: a movie lives at `/movie/<identifier>` regardless of which pool you
   arrived from, so there is exactly one canonical URL per item. The landing pages are
   the only surface where shorts/silents add distinct value.
5. **Site convention is uniform self-canonical.** All 20+ static pages carry a
   self-referencing canonical. Repointing only these two would flag them as duplicates —
   the opposite of the disclosure intent — and set a confusing precedent for any future
   subset pool.

## Consequences

- Both pages keep their existing self-canonical tags (verified present).
- The smoke suite guards the decision: assertions pin that `/shorts` and `/silents`
  canonical URLs point at themselves, so a future change that repoints them to /browse
  fails CI with the reasoning in this record.
- The overlap remains disclosed on the four channels that are correct for it: visible
  hero note, SERP meta description, JSON-LD `isPartOf`, and the sitemap annotation
  ("curated view of /browse" on the shorts/silents sub-sitemaps).
