import type { PagesFunction } from "@cloudflare/workers-types";
import { withEdgeCachedResponse } from "../lib/edge-cache.ts";
import type { Env } from "../lib/env.ts";
import { resolveSiteUrl } from "../lib/site-url.ts";
import { renderSitemapIndex } from "../lib/sitemap.ts";
import { headHandler } from "./_head.ts";

/**
 * GET /sitemap.xml — sitemap INDEX pointing at one sub-sitemap per pool.
 *
 * The catalog outgrew the sitemap protocol's 50,000-URL single-file ceiling (63,419 URLs
 * measured 2026-08-19 — beyond it, search engines silently truncate, dropping audiobooks
 * and government films from indexing). So this file now serves a `<sitemapindex>` listing
 * `/sitemap/static.xml` and one `/sitemap/<pool>.xml` per pool, each built by
 * functions/sitemap/[[slug]].ts from the same edge-cached catalog indexes /api/browse
 * reads. /api/random's degraded fallback follows the index, so Surprise me still reaches
 * any pool during an outage.
 *
 * The index is static (no data fetch) — it always serves, and is edge-cached 3600s.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const site = resolveSiteUrl(request, env);
  return await withEdgeCachedResponse(request.url, 3600, async () => {
    const xml = renderSitemapIndex(site);
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  });
};

export const onRequestHead = headHandler(onRequestGet);
