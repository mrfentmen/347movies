import type { PagesFunction } from "@cloudflare/workers-types";
import { fetchSitemapCatalog } from "../lib/archive.ts";
import { getCatalogIndex } from "../lib/catalog-index.ts";
import { withEdgeCachedResponse } from "../lib/edge-cache.ts";
import type { Env } from "../lib/env.ts";
import { escapeHtml } from "../lib/html.ts";
import { addedDateOf } from "../lib/normalize.ts";
import { resolveSiteUrl } from "../lib/site-url.ts";
import { headHandler } from "./_head.ts";

/**
 * GET /sitemap.xml — real sitemap: static pages plus the FULL legal catalog film pages
 * (~18,489 films), built from the shared local catalog index (lib/catalog-index.ts) — the
 * same edge-cached copy /api/browse and /api/random read, so no archive.org call happens
 * per sitemap build (the index refreshes at most once per 24h). Every catalog film is a
 * movie page in the sitemap, so Google indexes the whole library and Surprise me is uniform
 * over all of it.
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
      const docs = await getCatalogIndex();
      entries = docs.map((doc) => [doc.identifier, String(doc.addeddate ?? "")]);
    } catch {
      // Index unavailable (fully cold + upstream down): fall back to a direct one-shot
      // catalog fetch. If that also fails, serve an honest 502 rather than a broken sitemap.
      try {
        entries = (await fetchSitemapCatalog()).slice(0, 50000);
      } catch {
        return new Response("Sitemap temporarily unavailable.", {
          status: 502,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
    }

    const staticPaths = ["/", "/about", "/privacy", "/terms", "/browse", "/search", "/genre", "/tv", "/anime", "/cartoons", "/otr", "/music"];
    const movieUrls = entries.map(([id, added]) => {
      const lastmod = addedDateOf(added);
      return `  <url><loc>${escapeHtml(site + `/movie/${encodeURIComponent(id)}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
    });
    const staticUrls = staticPaths.map((p) => `  <url><loc>${escapeHtml(site + p)}</loc></url>`);
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
