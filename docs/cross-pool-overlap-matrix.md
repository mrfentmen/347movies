# Cross-Pool Overlap Matrix

**Date:** 2026-08-21 (updated 2026-08-22 with the footage pool)
**Method:** Each pool's exact gate clause (from `lib/archive.ts`) intersected with every other pool's clause via archive.org's Solr API (`advancedsearch.php`, `numFound`). 153 pairs for the original 18 pools (18 × 17 / 2); the footage pool (added 2026-08-22) was measured separately against the films union (445 = 445, 100%).

## Pool sizes (live, 2026-08-21)

| Pool | Items |
|---|---|
| films | 18,487 |
| audiobooks | 18,348 |
| documentaries | 8,420 |
| govfilms | 5,947 |
| records | 5,038 |
| sports | 3,625 |
| ted | 2,933 |
| otr | 2,309 |
| tv | 2,512 |
| shorts | 1,858 |
| publictv | 1,653 |
| cartoons | 1,308 |
| music | 1,456 |
| silents | 729 |
| space | 719 |
| ephemera | 412 |
| science | 257 |
| anime | 24 |

## Overlapping pairs (9 of 153)

| Pool A | Pool B | Shared | % of A | % of B | Relationship |
|---|---|---|---|---|---|
| films | shorts | 1,858 | 10.1% | 100.0% | **Curated view** (shorts ⊂ films) |
| films | silents | 729 | 3.9% | 100.0% | **Curated view** (silents ⊂ films) |
| films | footage | 445 | 2.4% | 100.0% | **Curated view** (footage ⊂ films) — added 2026-08-22 |
| documentaries | ted | 2,933 | 34.8% | 100.0% | **Curated view** (ted ⊂ documentaries) |
| documentaries | science | 257 | 3.1% | 100.0% | **Curated view** (science ⊂ documentaries) — NEW finding |
| films | tv | 6 | 0.0% | 0.2% | Negligible (cross-tagged uploads) |
| films | cartoons | 15 | 0.1% | 1.1% | Negligible (cross-tagged uploads) |
| films | ephemera | 1 | 0.0% | 0.2% | Negligible (1 item) |
| cartoons | silents | 11 | 0.8% | 1.5% | Negligible (cross-tagged uploads) |
| shorts | silents | 229 | 12.3% | 31.4% | Partial (short silent films in both collections) |

## Curated views (4 total)

A curated view is a pool where 100% of its items also appear in a parent pool. The curated-view count in the smoke suite must match this list.

| Curated view | Parent pool | Shared items | Curated-view % |
|---|---|---|---|
| shorts | films | 1,858 | 100% |
| silents | films | 729 | 100% |
| ted | documentaries | 2,933 | 100% |
| science | documentaries | 257 | 100% |

**Note:** science was discovered as a curated view of documentaries in this matrix measurement (2026-08-21). It was not labeled as such previously — see the action item below.

## Disjoint pools (no overlap with any other pool)

| Pool | Overlaps with | Status |
|---|---|---|
| anime | (none) | Fully disjoint |
| music | (none) | Fully disjoint (different mediatype: etree) |
| otr | (none) | Fully disjoint (mediatype: audio) |
| publictv | (none) | Fully disjoint (aapb* identifier prefix) |
| govfilms | (none) | Fully disjoint |
| audiobooks | (none) | Fully disjoint (mediatype: audio) |
| records | (none) | Fully disjoint (mediatype: audio) |
| space | (none) | Fully disjoint |

## Negligible cross-tagging (not curated views)

These pairs share a tiny number of items due to archive.org cross-tagging (uploaders adding items to multiple collections), but 99%+ of each pool is exclusive. No curated-view label is warranted.

| Pair | Shared | Explanation |
|---|---|---|
| films ∩ tv | 6 | Cross-tagged uploads |
| films ∩ cartoons | 15 | Cross-tagged uploads |
| films ∩ ephemera | 1 | Single cross-tagged item |
| cartoons ∩ silents | 11 | Silent cartoons in both collections |
| shorts ∩ silents | 229 | Short silent films in both collections (partial, not 100%) |

## Action items

1. **science → curated view of documentaries:** The matrix revealed that all 257 science items also sit in `culturalandacademicfilms`. This is a 4th curated view (after shorts, silents, TED). The smoke curated-view count (currently 3) needs updating to 4, and the `/science` landing page needs the curated-view disclosure (hero badge, meta description, JSON-LD `isPartOf` → `/documentaries`, sitemap annotation).
2. **shorts ∩ silents (229 items):** This is a partial overlap (12.3% of shorts, 31.4% of silents) — short silent films that belong to both collections. Neither is a curated view of the other (both are curated views of films, not of each other). No action needed beyond documenting it here.
