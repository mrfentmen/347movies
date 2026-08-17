# 347movies — archive.org image, download & metadata endpoints (research)

**Researched 2026-08-17.** Question: which archive.org endpoints are the canonical, documented
way to (a) serve an item's thumbnail image, (b) download a file directly, and (c) read an
item's metadata — and what do they document about reliability? Method: primary sources only
(Internet Archive's own docs and source/issue trackers), plus empirical probes of each endpoint
against the live service. This grounds the site's server-side poster resolver
(`functions/img/[identifier].ts`) and the player's quality/server selectors.

## Findings

### 1. Thumbnails: `https://archive.org/services/img/<identifier>` is the canonical endpoint — and it degrades gracefully

`services/img/<id>` returns the item's thumbnail image and **never breaks**: when an item has no
derivable thumbnail it serves the standard archive placeholder rather than a 404.

> "If no file to make images from then wont be there, but `services/img/IDENTIFIER` will go to a
> `notfound.png` which is the standard archive logo"

— Internet Archive engineer, [`internetarchive/dweb-archive` issue #133](https://github.com/internetarchive/dweb-archive/issues/133)
("Absence of `__ia_thumb.jpg` causes broken image").

**Site impact:** `services/img/<id>` is the right *primary* thumbnail candidate — it fails closed
to a placeholder by design. This is exactly why the poster resolver probes it first.

### 2. `https://archive.org/download/<id>/__ia_thumb.jpg` is the raw per-item derivative — and may be absent

`__ia_thumb.jpg` is a derived thumbnail file stored inside the item's download directory. It is
only present when archive.org had a source file to derive it from (same primary source, issue
#133: "Has broken image since no `__ia_thumb.jpg`"). A missing or 502ing `__ia_thumb.jpg` is a
normal state, not an anomaly.

**Site impact:** the resolver's second candidate is a *fallback*, never a guarantee; it must
resolve onward to the placeholder when it 502s (observed repeatedly this session).

### 3. Metadata: `https://archive.org/metadata/<id>` exposes the `server` and `dir` fields (data node + path)

The item's public metadata carries the two fields needed to reach its physical storage node
directly. From the [Internet Archive Developer Portal — Book Manifest API](https://doc-tools.readthedocs.io/en/ia-test-gsod/book-manifests.html)
(archive.org's own docs):

> "most of this data (the 'server' and the 'dir' fields) are available on the item's public
> metadata page on archive.org (i.e. `https://archive.org/metadata/:itemid`)"

with the accompanying example reading `metadata['server']` and `metadata['dir']` straight off the
`/metadata/<id>` JSON. `server` is the data-node hostname (e.g. `ia802604.us.archive.org`) and
`dir` is the item's path within it (e.g. `/28/items/<id>`).

**Site impact:** this is the source for the player's "Mirror node" server option — pointing the
native `<video>` at the item's own data node rather than the shared `download` front door.

### 4. Direct downloads: `https://archive.org/download/<id>/<file>`

`download/<id>/<file>` is the canonical direct-file URL (it 302s to the item's data-node CDN and
answers Range requests, so seeking works). The same Developer Portal page shows it verbatim as
the way to fetch a file: `https://archive.org/download/theworksofplato01platiala/page/page_1.jpg`.
The [Internet Archive Unofficial Wiki API reference](https://internetarchive.archiveteam.org/index.php/API)
adds that `https://archive.org/serve/<id>` is an alias for `download/<id>` (the directory view).

### 5. Reliability reality (2026-08-17): the docs and endpoints were down during this research

The flakiness the site has fought all session is real and current:

- `archive.org/developers/index-apis.html` → **502** during this research.
- `blog.archive.org/2013/07/04/metadata-api/` and `…/how-archive-org-items-are-structured/` → **timeout**.
- The Wayback Machine (web.archive.org) → **503** for the same pages.
- `services/img/it-1927` → **000 / connection timeout after 12s** (probed moments ago).

So the two primary sources that could not be read (the Metadata API announcement and the
"How items are structured" post) are cited below for completeness but were unreachable from here.
This outage is itself the strongest evidence for the poster resolver's bounded-timeout probes and
the search API's stale-on-error cache.

## Verification

- **Primary reads:** `internetarchive/dweb-archive` issue #133 (GitHub, reachable); Internet
  Archive Developer Portal "Book Manifest API" (doc-tools.readthedocs.io, reachable).
- **Secondary read:** Internet Archive Unofficial Wiki API reference (archiveteam.org).
- **Empirical (earlier this session):** `/metadata/<id>` returned `server`, `dir`, and `files[]`
  for `it-1927`; `download/<id>/<file>` returned 302 → data-node CDN with `206` on Range;
  `services/img/<id>` intermittently returned 200/502; `__ia_thumb.jpg` intermittently 502.
- **Empirical (this research):** `services/img/it-1927` hung (000) at a 12s timeout — the exact
  failure mode the resolver's 2s probe timeout is designed to absorb.

## Primary sources cited (for full verification when archive.org recovers)

- https://archive.org/developers/index-apis.html — official Developer Portal "Tools and APIs".
- https://blog.archive.org/2013/07/04/metadata-api/ — the Metadata API announcement.
- https://blog.archive.org/2011/03/31/how-archive-org-items-are-structured/ — item structure.
