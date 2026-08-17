# 347movies — Dark-mode contrast audit (WCAG 2.2)

**Date:** 2026-08-16 · **Method:** computed, not eyeballed — every ratio below is calculated
from the shipped `public/css/style.css` tokens by `node scripts/contrast.mjs` (same math the
smoke suite uses). Rerun that script after any token change.

**Scope:** every color pair the site actually renders — text pairs derived from the live CSS
rules (body, prose, muted labels, cards, chips, buttons, links, destructive hover), plus the
non-text UI boundaries that WCAG 1.4.11 covers. `DESIGN.md` is the documented source of
truth for these values; the smoke suite enforces that DESIGN.md and the stylesheet never
drift (design-system integrity section) and locks the four critical text pairs at ≥4.5:1.

## Token map (from `:root`)

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0c0d11` | Page background |
| `--surface` | `#14161c` | Cards, chips, inputs, slots |
| `--surface-2` | `#1c1f27` | Watch buttons, skeletons, placeholders |
| `--border` | `#272b36` | Hairline borders |
| `--text` | `#ede9df` | Primary text |
| `--muted` | `#a29ca9` | Secondary text |
| `--accent` | `#f2a93b` | The single accent (links, focus, buttons) |
| `--accent-ink` | `#1a1206` | Text on amber |
| *(rule literals)* | `#cfcbd8` | Prose/movie-description text |
| | `#e07a7a` | Destructive hover (Clear watchlist) |
| | `#000000` | Player screen |

## Text pairs — ALL PASS WCAG 2.2 AA

Thresholds: normal text ≥4.5:1 (AA), ≥7:1 (AAA).

| Pair | Ratio | AA | AAA |
|---|---|---|---|
| Warm Screen White `#ede9df` on Cold Black Wall `#0c0d11` (body copy) | **16.02:1** | ✓ | ✓ |
| `#ede9df` on True Black `#000000` (player screen reference) | **17.32:1** | ✓ | ✓ |
| Card titles `#ede9df` on Raised Slate `#14161c` | **14.92:1** | ✓ | ✓ |
| Watch-button hover `#ede9df` on Deep Slate `#1c1f27` | **13.59:1** | ✓ | ✓ |
| Prose paragraphs `#cfcbd8` on `#0c0d11` | **12.20:1** | ✓ | ✓ |
| Tungsten Amber `#f2a93b` on page bg (links, eyebrows, 404, footer tag) | **9.72:1** | ✓ | ✓ |
| Amber Ink `#1a1206` on Tungsten Amber `#f2a93b` (primary buttons, skip-link) | **9.28:1** | ✓ | ✓ |
| Tungsten Amber on Raised Slate (chip hover, license chip, slot links) | **9.05:1** | ✓ | ✓ |
| Muted `#a29ca9` on page bg (nav, hero-sub, footer, pagination) | **7.27:1** | ✓ | ✓ |
| Fade Red `#e07a7a` on page bg (Clear-watchlist hover) | **6.69:1** | ✓ | AA-only |
| Muted on Raised Slate (genre chips, card years, ad-slot notes) | **6.77:1** | ✓ | AA-only |
| Muted on Deep Slate (watch buttons, film-slate labels) — **worst pair** | **6.17:1** | ✓ | AA-only |

**Worst text pair: 6.17:1 — comfortably above the 4.5:1 AA bar; no text fails anywhere on
the site.** The three AA-only pairs are all secondary/label text; none dips below 6:1.

## Non-text UI boundaries (WCAG 1.4.11, ≥3:1) — known gap, documented

| Boundary | Ratio | Verdict |
|---|---|---|
| Focus ring — Tungsten Amber on page bg | **9.72:1** | ✓ PASS |
| Hairline Border `#272b36` on page bg | **1.37:1** | ✗ FAIL |
| Hairline Border on Raised Slate | **1.28:1** | ✗ FAIL |
| Hairline Border on Deep Slate | **1.17:1** | ✗ FAIL |
| Raised Slate surface vs page bg (card boundary by fill) | **1.07:1** | ✗ FAIL |

**This is the site's one contrast gap — and it is a deliberate design choice, not an
oversight.** The hairlines are meant to read as "the edge of the dark": visible but whisper-
subtle (`#272b36` on `#0c0d11`). The strict 1.4.11 reading fails because the border is the
*only* boundary cue. The practical exposure is limited — every component is also identified
by non-color cues (card surface fill + poster + title, inputs by placeholder text, buttons
by their label), and no interactive state relies on the border alone (focus uses the amber
ring at 9.72:1).

**Options for the owner, if compliance is wanted:**
1. **Lighten `--border` to ≈ `#565e70`** — hits 3.0:1 on the page background, but it is a
   visibly chunkier gray that changes the "edge of the dark" aesthetic on every card and
   input (and still lands ~2.5:1 on surfaces). A real design decision.
2. **Accept + document** (current state): hairlines are decorative in practice; component
   identification doesn't depend on them; text (the WCAG priority) is fully compliant and
   guarded.
3. **Boundary by fill instead of stroke**: brighten `--surface`/`--surface-2` so the
   surface-vs-bg difference reaches 3:1 — larger visual change than (1).

Per the review-reception discipline this decision belongs to the owner: the audit reports
the gap with exact numbers and options rather than silently redesigning the site's hairlines
in an unattended pass.

## Guarded invariants (enforced by `npm run smoke`)

The smoke suite's design-system integrity section recomputes — from the **live served
tokens**, never a hardcoded ratio — and fails if any drop below AA:

- muted on surface-2 ≥ 4.5:1 (the worst text pair) — currently **6.17:1**
- accent on page bg ≥ 4.5:1 (amber links) — currently **9.72:1**
- accent-ink on accent ≥ 4.5:1 (button text) — currently **9.28:1**
- text on page bg ≥ 4.5:1 (body) — currently **16.02:1**

A coordinated token change (e.g. both sides of a pair darkened together) is still judged —
the ratio is computed from the current values, so a drift that breaks contrast fails the
guard even if DESIGN.md is kept in sync.

## Re-running

```bash
node scripts/contrast.mjs   # full table + exit 0/1 by the AA + 1.4.11 bars
npm run smoke               # guards (parity + the four critical pairs) against dev or prod
```
