import type { PagesFunction } from "@cloudflare/workers-types";
import { withEdgeCachedResponse } from "../../lib/edge-cache.ts";
import type { Env } from "../../lib/env.ts";
import { resolveSiteUrl } from "../../lib/site-url.ts";
import { poolUrlLines, renderUrlset, SITEMAP_POOLS, staticUrlLines } from "../../lib/sitemap.ts";
import { headHandler } from "../_head.ts";

/**
 * GET /sitemap/<pool>.xml — one pool's sub-sitemap (the pieces /sitemap.xml's index points
 * at). The catalog outgrew the 50,000-URL single-file sitemap limit (63,419 URLs measured
 * 2026-08-19), so each pool gets its own small file — every one stays far under the ceiling
 * and can grow independently. `static` is the evergreen pages file; any other slug must be
 * one of SITEMAP_POOLS (unknown slugs 404). Each file is built from the same edge-cached
 * catalog index /api/browse reads — no archive.org call when warm — and edge-cached 3600s.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const site = resolveSiteUrl(request, env);
  const raw = String(params["slug"] ?? "");
  const slug = raw.endsWith(".xml") ? raw.slice(0, -4) : raw;
  const urlString = request.url;

  if (slug === "static") {
    return await withEdgeCachedResponse(urlString, 3600, async () => {
      const xml = renderUrlset(staticUrlLines(site));
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    });
  }

  if (!(SITEMAP_POOLS as readonly string[]).includes(slug)) {
    return new Response("Not found.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  return await withEdgeCachedResponse(urlString, 3600, async () => {
    // A failed index build (fully cold + upstream down) serves an honest 502 with no-store,
    // so only a real sub-sitemap is ever cached — never the failure.
    const lines = await poolUrlLines(slug as never, site);
    const xml = renderUrlset(lines);
    return new Response(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  });
};

export const onRequestHead = headHandler(onRequestGet);
