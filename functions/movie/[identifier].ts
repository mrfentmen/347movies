import type { PagesFunction } from "@cloudflare/workers-types";
import { getMovieRecord } from "../../lib/catalog.ts";
import { withEdgeCachedResponse } from "../../lib/edge-cache.ts";
import { headHandler } from "../_head.ts";
import type { Env } from "../../lib/env.ts";
import { renderMovieNoVideo, renderMoviePage, renderMovieUnavailable } from "../../lib/layout.ts";
import { resolveSiteUrl } from "../../lib/site-url.ts";

/**
 * GET /movie/<identifier> — server-rendered movie detail page with the archive.org embed,
 * real metadata, per-film Open Graph tags (task T3.3, T6.1). No JavaScript required.
 */
export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const identifier = String(params.identifier);
  // Request-host resolution (or SITE_URL override): canonicals, og:url and JSON-LD follow
  // the host visitors use — a custom domain needs zero config.
  const siteUrl = resolveSiteUrl(request, env);
  const urlString = request.url;

  // Unavailable/no-video/error variants carry no-store, so withEdgeCachedResponse only ever
  // caches the 200 playable page (bounded 300s).
  return await withEdgeCachedResponse(urlString, 300, async () => {
    const result = await getMovieRecord(identifier, env.MOVIES_KV);

    if (!result.ok) {
      const body = renderMovieUnavailable(result.status, siteUrl, identifier);
      return new Response(body, {
        status: result.status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // A legal catalog item with no playable video OR audio derivative gets an honest
    // no-video page instead of a dead player embed (verified live: `mrs.-pumpkin`). Old
    // Time Radio items are mediatype:audio — they render the same page with an audio
    // player. Still cached (bounded), still noindex, and the source link keeps the viewer
    // unblocked.
    const playable = result.record.hasVideo || result.record.hasAudio;
    const html = playable
      ? renderMoviePage(result.record, siteUrl, env.AMAZON_TAG)
      : renderMovieNoVideo(result.record, siteUrl);
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
    });
  });
};

export const onRequestHead = headHandler(onRequestGet);
