import type { PagesFunction } from "@cloudflare/workers-types";
import { queryCatalog } from "../../lib/catalog-index.ts";
import { withEdgeCachedResponse } from "../../lib/edge-cache.ts";
import type { Env } from "../../lib/env.ts";
import { headHandler } from "../_head.ts";
import { resolveSiteUrl } from "../../lib/site-url.ts";

/** "YYYY-MM-DD" (addeddate) -> RFC 822 ("Mon, 02 Jan 2006 00:00:00 GMT"), the RSS pubDate format. */
function rfc822Date(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toUTCString();
}

/**
 * GET /api/rss.xml — "new this week": the 20 most recently added films from the legal
 * catalog index (same edge-cached index as browse — no per-request upstream calls), as an
 * RSS 2.0 feed with per-item pubDate (addeddate) and a link to the movie page. Served
 * noindex (feeds are data, not destinations) and edge-cached like the other catalog routes.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const siteUrl = resolveSiteUrl(request, env);
  const urlString = request.url;
  return await withEdgeCachedResponse(urlString, 300, async () => {
    const { results } = await queryCatalog({ sort: "recent", page: 1, rows: 20 });
    const base = siteUrl.replace(/\/$/, "");
    const items = results
      .map((r) => {
        const title = String(r.title || r.identifier).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const link = `${base}/movie/${encodeURIComponent(r.identifier)}`;
        const desc = r.description
          ? r.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          : `Watch ${title} free on 347movies — public domain or Creative Commons, embedded from the Internet Archive.`;
        const pubDate = r.addeddate ? rfc822Date(r.addeddate) : "";
        const year = r.year ? ` (${r.year})` : "";
        return `    <item>\n      <title>${title}${year}</title>\n      <link>${link}</link>\n      <guid isPermaLink="true">${link}</guid>\n      <description>${desc}</description>\n      <pubDate>${pubDate}</pubDate>\n    </item>`;
      })
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>347movies — new additions</title>\n    <link>${base}/</link>\n    <description>Recently added free public domain and Creative Commons films on 347movies.</description>\n${items}\n  </channel>\n</rss>\n`;
    return new Response(xml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "X-Robots-Tag": "noindex",
      },
    });
  });
};

export const onRequestHead = headHandler(onRequestGet);