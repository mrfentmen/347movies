import type { PagesFunction } from "@cloudflare/workers-types";
import { fetchSitemapCatalog } from "../lib/archive.ts";
import { getCatalogIndex, RANDOM_VARIANTS } from "../lib/catalog-index.ts";
import { withEdgeCachedResponse } from "../lib/edge-cache.ts";
import type { Env } from "../lib/env.ts";
import { escapeHtml } from "../lib/html.ts";
import { addedDateOf } from "../lib/normalize.ts";
import { resolveSiteUrl } from "../lib/site-url.ts";
import { headHandler } from "./_head.ts";

/**
 * GET /sitemap.xml — real sitemap: static pages plus every catalog item across all twelve
 * pools (films + tv/anime/cartoons/otr/music/documentaries/sports/shorts/silents/publictv/
 * science/govfilms/audiobooks), built
 * from the shared local catalog indexes (lib/catalog-index.ts) — the same edge-cached copies
 * /api/browse and /api/random read, so no archive.org call happens per sitemap build (each
 * index refreshes at most once per 24h). Identifiers dedupe across pools, so every URL is
 * unique and the union stays under the 50k sitemap ceiling. /api/random's degraded fallback
 * parses this sitemap, so Surprise me can reach any pool even during an outage.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  // Resolved from the request host (or SITE_URL override) so a custom domain attached in
  // Cloudflare needs zero config — the sitemap lists the host visitors actually use.
  const site = resolveSiteUrl(request, env);
  const urlString = request.url;

  // The fallback 502 carries no-store, so withEdgeCachedResponse only ever caches a real
  // sitemap (bounded 3600s), never the failure.
  return await withEdgeCachedResponse(urlString, 3600, async () => {
    let entries: Array<[string, string]> = [];
    try {
      // List all twelve pools, not just the films union: the serial/audio pools (tv/anime/cartoons/
      // otr/music/audiobooks) are disjoint from films, so /api/random's sitemap fallback can reach them
      // during an outage too. Loads run in parallel (each pool is edge-cached 24h and
      // single-flighted), so a cold edge pays max(build), not the sum. Identifiers dedupe
      // across pools (shorts/silents are 100% subsets of films; docs/sports overlap), keeping
      // the sitemap's unique-URL guarantee — the union stays under the 50k ceiling.
      const pools = await Promise.all(RANDOM_VARIANTS.map((variant) => getCatalogIndex(fetch, variant)));
      const seen = new Set<string>();
      for (const docs of pools) {
        for (const doc of docs) {
          if (doc.identifier && !seen.has(doc.identifier)) {
            seen.add(doc.identifier);
            entries.push([doc.identifier, String(doc.addeddate ?? "")]);
          }
        }
      }
    } catch {
      // Index unavailable (fully cold + upstream down): fall back to a direct one-shot
      // films-union fetch. If that also fails, serve an honest 502 rather than a broken sitemap.
      try {
        entries = (await fetchSitemapCatalog()).slice(0, 50000);
      } catch {
        return new Response("Sitemap temporarily unavailable.", {
          status: 502,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
    }

    const staticPaths = ["/", "/about", "/privacy", "/terms", "/advertise", "/browse", "/search", "/genre", "/tv", "/anime", "/cartoons", "/otr", "/music", "/documentaries", "/sports", "/shorts", "/silents", "/publictv", "/science", "/govfilms", "/audiobooks", "/collections"];
    const movieUrls = entries.map(([id, added]) => {
      const lastmod = addedDateOf(added);
      return `  <url><loc>${escapeHtml(site + `/movie/${encodeURIComponent(id)}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
    });
    // Shorts/silents are curated views of /browse (100% subsets of the films union — measured
    // 0 exclusive items), so the sitemap annotates that relationship. The sitemap protocol has
    // no description field, so this is an XML comment for readers; the search-engine-visible
    // disclosure lives in each page's meta description.
    const curatedViewNote: Record<string, string> = {
      "/shorts": "curated view of /browse (Films): every title here also appears there",
      "/silents": "curated view of /browse (Films): every title here also appears there",
    };
    const staticUrls = staticPaths.map((p) => {
      const url = `  <url><loc>${escapeHtml(site + p)}</loc></url>`;
      return curatedViewNote[p] ? `${url}\n  <!-- ${curatedViewNote[p]} -->` : url;
    });
    const urls = [...staticUrls, ...movieUrls].join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  });
};

export const onRequestHead = headHandler(onRequestGet);
