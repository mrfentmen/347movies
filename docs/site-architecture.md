# 347movies — Site architecture

**Audited 2026-08-16** (site-architecture skill pass; second pass — first was the
T6.10 audit). Site type: single-purpose streaming destination — one catalog, one deep
page type, no accounts. The architecture is deliberately flat; this pass confirms the
flatness is correct, documents the full IA in the skill's deliverable format, and
fixes one genuine defect the first audit missed: **`/genre` was an orphan page.**

## 1. Page hierarchy (ASCII tree)

```
Homepage (/)                                       L0
├── Browse (/browse)                               L1  — whole catalog, filters as query
│   └── Movie page (/movie/<identifier>)           L2  — ×15,917 films (only deep type)
├── Genre destination (/genre)                     L1  — branded Film Noir showcase
│   └── Movie page (/movie/<identifier>)           L2  — live noir grid on the page
├── Search (/search?q=…)                           L1  — archive.org relevance, license-gated
│   └── Movie page (/movie/<identifier>)           L2
├── Watchlist (/watchlist)                         L1  — client-side (localStorage), no account
├── About (/about)                                 L1  — incl. /about#advertise anchor
├── Privacy (/privacy)                             L1
├── Terms (/terms)                                 L1
└── 404 (/definitely-not-a-page)                   — friendly unknown-route surface
```

L0 home → L1 sections → L2 film pages: **two levels of real depth** — the correct shape
for one catalog with one content type. A genre-hub layer (`/genre/<genre>`) would add
depth without adding user value: every genre filter already lives in `/browse` as a
query, and the single branded genre page (`/genre`, Film Noir) is a curated showcase,
not the start of a taxonomy. Any film is ≤2 clicks from home.

## 2. Visual sitemap

```mermaid
graph TD
    subgraph Header Nav
        HOME["Home (/)"] --> BROWSE["Browse (/browse)"]
        HOME --> WL["Watchlist (/watchlist)"]
        HOME --> ABOUT["About (/about)"]
        HOME --> SEARCH["Search box (GET /search?q=…)"]
    end

    subgraph Home Sections (hub-and-spoke into the catalog)
        HOME --> GENRES["Genre pills → /browse?genre=… (7)"]
        HOME --> NOIRPILL["Film Noir pill → /genre"]
        HOME --> ROWS["Curated rows → filtered /browse + /search (SEE ALL)"]
        HOME --> SURPRISE["Surprise me → /api/random (302 to a film)"]
    end

    BROWSE --> MOVIE["Movie page (/movie/<identifier>)"]
    GENRES --> MOVIE
    ROWS --> MOVIE
    SEARCH --> MOVIE
    GENRE["Genre destination (/genre)"] --> MOVIE

    NOIRPILL --> GENRE
    GENRE --> NOIRFULL["See all → /browse?genre=film-noir"]

    subgraph Footer Nav
        ABOUT --> ADVERTISE["Advertise (/about#advertise)"]
        ABOUT2["About"] --> PRIV["Privacy (/privacy)"]
        ABOUT2 --> TERMS["Terms (/terms)"]
    end
```

## 3. URL map table

| Page | URL | Parent | Nav location | Priority |
|------|-----|--------|-------------|----------|
| Homepage | `/` | — | Header (logo/brand) | High |
| Browse | `/browse` | Homepage | Header | High |
| Genre destination | `/genre` | Homepage | Home Film Noir pill | Medium |
| Search | `/search?q=…` | — | Header search box (every page) | High |
| Movie page | `/movie/<identifier>` | Browse / genre / search / home cards | Card links, breadcrumb (Home) | High |
| Movie variants | `/movie/<id>/no-video`, `/movie/<id>/unavailable` | Movie page | Internal error navigation | Low |
| Watchlist | `/watchlist` | Homepage | Header + Footer | Medium |
| About | `/about` | Homepage | Header + Footer | Medium |
| Advertise | `/about#advertise` | About | Footer | Low |
| Privacy | `/privacy` | — | Footer | Low |
| Terms | `/terms` | — | Footer | Low |
| 404 | `/definitely-not-a-page` | — | Not linked (failure surface) | — |
| Surprise me | `/api/random` | Home hero, /genre hero | Hero link (302 → film) | Low |
| API data | `/api/browse`, `/api/search`, `/api/movie/*`, `/api/ad-config`, `/api/health` | — | Data, not pages (`robots.txt` Disallow + `X-Robots-Tag: noindex`) | — |
| Sitemap | `/sitemap.xml` | — | Referenced from `robots.txt` | — |

URL rules, all passing: human-readable (archive.org identifiers are descriptive);
hyphens not underscores; URLs mirror the flat hierarchy; no dates; no trailing slashes
(smoke-guarded); lowercase static paths (identifiers keep archive.org's native case);
query params are filters (`q`, `genre`, `decade`, `from`/`to`, `sort`, `page`, `films`,
`tv`), never content locators. The one deliberate non-standard — movie identifiers as
URLs instead of rewritten slugs — is correct: rewriting would create two URL systems
and break direct links from archive.org; the identifier is the stable primary key.

## 4. Navigation spec

- **Header** (3 items + search — within the skill's 4–7 max): logo `347movies` → home;
  `Browse`, `Watchlist`, `About`; search box (GET form → `/search`, labeled input
  WCAG 3.3.2). No dropdowns — flat nav matches the depth.
- **Home sections**: hero (`Surprise me` → `/api/random`); genre pills ×7 — **Film Noir
  → `/genre`** (the branded destination), the other six → `/browse?genre=…`; curated
  rows (Modern picks `/browse?from=2000&to=2020`, Hong Kong action
  `/browse?q=dubbed+subtitled+kung+shaolin+wong`, Classic TV `/browse?tv=1`, Recently
  added `/browse`, Film noir `/browse?genre=film-noir`, Silent era `/browse?decade=1920`)
  each with a `SEE ALL →` link into the filtered catalog — the hub-and-spoke model.
- **Footer** (utility links): About, Watchlist, Advertise (`/about#advertise`), Privacy,
  Terms — every static page reachable from every page.
- **Breadcrumbs**: `Home / <Title>` on the movie page family (incl. no-video /
  unavailable variants), `aria-current="page"`, **mirroring the JSON-LD BreadcrumbList**
  (deploy #54; UI and structured data agree, regression-tested). Browse/search are one
  level deep — a breadcrumb there would duplicate the header nav, so none (deliberate).

## 5. Internal linking plan + link audit checklist

| Checklist item | Status |
|---|---|
| Every page has ≥1 inbound internal link | ✅ **after this pass** — see the `/genre` fix below |
| No broken internal links (404s) | ✅ smoke guards + E2E cover the static set; movie pages are catalog-backed |
| Descriptive anchor text, no "click here" | ✅ card titles, `SEE ALL →`, `SURPRISE ME`, `View on archive.org` (smoke guard asserts the JS never introduces "click here") |
| Important pages most-linked | ✅ home/browse in header on every page; movie pages from cards everywhere + sitemap |
| Breadcrumbs on all deep pages | ✅ movie page family |
| Related-content / hub-and-spoke links | ✅ curated home rows → filtered browse views; `/genre` ↔ `/browse?genre=film-noir` |
| Cross-section links | ✅ about ↔ advertise anchor; genre chips ↔ browse filters |

**The finding this pass fixed — `/genre` was an orphan.** The page (a full branded Film
Noir showcase: hero, live grid, pagination, ad slot) was in the sitemap and indexed,
but the only internal link to it was from its own page — a self-link doesn't count as an
inbound link. Nothing in the header, footer, or home pointed at it. It was reachable by
URL and from Google, but not by any user navigating the site — a dead-end destination
that also wasted crawl budget on a page Google would see as unlinked.

Fix (site change, no deploy yet — see ledger):
- **Home Film Noir pill → `/genre`** (was `/browse?genre=film-noir`). The pill is the
  highest-visibility placement and semantically exact — it is literally the Film Noir
  destination. `/genre` cross-links back to the full catalog
  (`See all → /browse?genre=film-noir`, twice on the page), completing the
  hub-and-spoke cycle. The other six pills stay on `/browse?genre=…` — consistent,
  since `/genre` is the one branded genre page.
- **Regression guard added to `scripts/smoke.mjs`**: the home page must link to
  `/genre` (orphan rule). The first audit's "no orphans" claim was wrong — the smoke
  suite treated `/genre` as a first-class page (structure, canonical pin, id-scan,
  no-auth) but never asserted an inbound link, which is exactly how the orphan slipped
  through. The guard closes that hole.

Why adopt rather than delete: the page is a designed destination with unique copy and a
live noir catalog — it earns its place once linked. Deleting it would have needed a 301
(`/genre` → `/browse?genre=film-noir`) plus sitemap surgery for a page that only needed
one link.

## 6. Verification

- Smoke suite (dev + canonical) with the new orphan guard; unit tests; typecheck.
- The change is a single href + one guard; no route, data, or API surface touched.

## 7. What changed since the T6.10 audit

- **Fixed:** home Film Noir pill → `/genre`; orphan guard added to the smoke suite.
- **New since T6.10:** `/genre` page itself (post-dates the first audit — that's why the
  orphan was missed), plus the Modern picks / Hong Kong action / Classic TV curated rows
  and their SEE ALL links, all folded into this document's hierarchy and URL map.
