# Sitemap URL Inspection Checklist

**Date:** 2026-08-21
**Sitemap index URL:** `https://347movies.pages.dev/sitemap.xml`
**Status:** ✅ Passes all automated checks. Search Console submission requires owner access.

## What was verified

### 1. Sitemap index serves correctly
- [x] HTTP 200 on `/sitemap.xml`
- [x] `Content-Type: application/xml; charset=utf-8`
- [x] Valid XML — parses as `<sitemapindex>` with correct namespace
- [x] 19 sub-sitemaps listed (static + 18 pools)

### 2. All sub-sitemaps parse and serve
- [x] All 19 sub-sitemaps return 200 and parse as valid `<urlset>` XML
- [x] **75,821 total URLs** across all sub-sitemaps
- [x] Per-pool breakdown:

| Sub-sitemap | URLs |
|---|---|
| static.xml | 26 |
| films.xml | 18,490 |
| tv.xml | 2,512 |
| anime.xml | 24 |
| cartoons.xml | 1,308 |
| otr.xml | 2,066 |
| music.xml | 1,455 |
| documentaries.xml | 8,420 |
| ted.xml | 2,933 |
| sports.xml | 3,625 |
| shorts.xml | 1,858 |
| silents.xml | 729 |
| publictv.xml | 1,653 |
| science.xml | 257 |
| govfilms.xml | 5,948 |
| audiobooks.xml | 18,346 |
| records.xml | 5,039 |
| ephemera.xml | 413 |
| space.xml | 719 |

### 3. robots.txt references the sitemap
- [x] `/robots.txt` serves 200 (`text/plain`)
- [x] Contains `Sitemap: https://347movies.pages.dev/sitemap.xml`

### 4. Sample URLs are reachable
- [x] 3 sample movie URLs from `films.xml` all return HTTP 200
- [x] URLs follow the canonical `https://347movies.pages.dev/movie/<identifier>` pattern

### 5. Homepage is indexable
- [x] No `<meta name="robots" content="noindex">` on the homepage
- [x] Homepage returns 200

### 6. Google sitemap ping
- [x] Note: Google deprecated the `/ping?sitemap=` endpoint in 2023 (returns 404).
  Submission is now via Search Console only.

## What still needs the owner (requires Search Console access)

The following steps require verified ownership of `347movies.pages.dev` in
[Google Search Console](https://search.google.com/search-console). No code can
close these — they are manual actions in the Google UI.

1. **Verify ownership** — add the property, verify via DNS TXT record or HTML meta tag.
2. **Submit the sitemap** — Sitemaps → Enter `sitemap.xml` → Submit.
3. **Run URL inspection** — pick a sample URL (e.g. `/movie/it-1927`) → URL
   Inspection → confirm "URL is on Google" and "Coverage: Indexed".
4. **Check for errors** — Sitemaps tab will show "Discovered URLs" and any
   crawl errors. Fix any issues Google reports.
5. **Request indexing for key pages** — the static landing pages (`/`, `/browse`,
   `/tv`, `/records`, etc.) can be individually submitted for faster indexing.

## No Google credentials in this session

`gcloud` is installed but no account is authenticated (`No credentialed accounts`).
The Search Console API (`searchconsole.googleapis.com`) is not enabled on any
project. To run the URL inspection programmatically:

1. `gcloud auth login`
2. Enable the Search Console API on a GCP project
3. Add the site as a property (requires DNS verification)
4. Use the `urlInspection.index.inspect` endpoint

Until then, the manual Search Console UI is the path.
