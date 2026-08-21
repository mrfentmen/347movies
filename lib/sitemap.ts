/**
 * Sitemap index + per-pool sub-sitemaps (lib).
 *
 * The catalog outgrew the sitemap protocol's hard ceiling: one file may list at most
 * 50,000 URLs, and the union of all pools is ~64k+ (measured 2026-08-19: 63,419 URLs).
 * Beyond the limit search engines silently truncate — audiobooks (18k) and government
 * films (6k) were being dropped from indexing. The fix is the standard one: `/sitemap.xml`
 * becomes a sitemap INDEX pointing at one small sub-sitemap per pool
 * (`/sitemap/static.xml`, `/sitemap/films.xml`, …), each far under the limit and able to
 * grow independently as its pool grows.
 *
 * Both entry points live in functions/: `functions/sitemap.xml.ts` serves the index, and
 * `functions/sitemap/[[slug]].xml.ts` (the catch-all) serves one pool's sub-sitemap. This
 * module holds the shared URL-building so the two never drift.
 */
import type { IndexVariant } from "./archive.ts";
import { getCatalogIndex } from "./catalog-index.ts";
import { escapeHtml } from "./html.ts";
import { addedDateOf } from "./normalize.ts";

/** The pools each get their own sub-sitemap (the films union + every curated pool). */
export const SITEMAP_POOLS: IndexVariant[] = [
  "films",
  "tv",
  "anime",
  "cartoons",
  "otr",
  "music",
  "documentaries",
  "ted",
  "sports",
  "shorts",
  "silents",
  "publictv",
  "science",
  "govfilms",
  "audiobooks",
  "records",
  "ephemera",
  "space",
];

/** Static pages that live in their own sub-sitemap (no lastmod — they're evergreen). */
export const STATIC_PATHS = [
  "/",
  "/about",
  "/privacy",
  "/terms",
  "/advertise",
  "/browse",
  "/search",
  "/genre",
  "/tv",
  "/anime",
  "/cartoons",
  "/otr",
  "/music",
  "/documentaries",
  "/ted",
  "/sports",
  "/shorts",
  "/silents",
  "/publictv",
  "/science",
  "/govfilms",
  "/audiobooks",
  "/records",
  "/ephemera",
  "/space",
  "/collections",
];

/**
 * Shorts/silents are curated views of /browse (100% subsets of the films union — measured
 * 2026-08-18: 0 exclusive items), so the static sub-sitemap annotates that relationship.
 * The sitemap protocol has no description field, so this is an XML comment for readers; the
 * search-engine-visible disclosure lives in each page's meta description.
 */
const CURATED_VIEW_NOTE: Record<string, string> = {
  "/shorts": "curated view of /browse (Films): every title here also appears there",
  "/silents": "curated view of /browse (Films): every title here also appears there",
  "/ted": "curated view of /documentaries: every title here also appears there",
};

/** The static sub-sitemap's <url> lines (with the curated-view annotations). */
export function staticUrlLines(site: string): string[] {
  return STATIC_PATHS.map((p) => {
    const url = `  <url><loc>${escapeHtml(site + p)}</loc></url>`;
    return CURATED_VIEW_NOTE[p] ? `${url}\n  <!-- ${CURATED_VIEW_NOTE[p]} -->` : url;
  });
}

/**
 * One pool's movie <url> lines: every identifier in that pool's edge-cached index, each
 * with a <lastmod> from addeddate when present. Throws when the index build fails — the
 * caller (functions/sitemap/[[slug]].xml.ts) maps that to an honest 502, never a broken
 * sitemap.
 */
export async function poolUrlLines(
  variant: IndexVariant,
  site: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const docs = await getCatalogIndex(fetchImpl, variant);
  return docs.map((doc) => {
    const lastmod = addedDateOf(String(doc.addeddate ?? ""));
    return `  <url><loc>${escapeHtml(site + `/movie/${encodeURIComponent(doc.identifier)}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  });
}

/** Wrap <url> lines in a urlset document. */
export function renderUrlset(lines: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</urlset>`;
}

/**
 * The sitemap index document: one <sitemap> entry per sub-sitemap (static + every pool).
 * Static — no data fetch, so it always serves and never fails.
 */
export function renderSitemapIndex(site: string): string {
  const entries = [
    "static",
    ...SITEMAP_POOLS.map((pool) => `${pool}`),
  ];
  const lines = entries.map(
    (name) => `  <sitemap><loc>${escapeHtml(`${site}/sitemap/${name}.xml`)}</loc></sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</sitemapindex>`;
}
