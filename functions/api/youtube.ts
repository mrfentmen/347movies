import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../lib/env.ts";
import { withEdgeCachedResponse } from "../../lib/edge-cache.ts";
import { jsonResponse } from "../../lib/http.ts";
import { routeError } from "../../lib/route-error.ts";
import { ApiError, MAX_QUERY_LENGTH, sanitizeQuery } from "../../lib/validate.ts";
import { headHandler } from "../_head.ts";
import { searchCreativeCommonsVideos } from "../../lib/youtube.ts";

/**
 * GET /api/youtube?q=… — CC-filtered YouTube short-film search behind the /shortfilms page.
 *
 * Dormant until YOUTUBE_API_KEY is configured (same pattern as the ad network): without a
 * key it returns { enabled: false } and the page shows an honest pending state. With a key
 * it searches the YouTube Data API v3 for Creative Commons-licensed, embeddable,
 * medium-length videos (lib/youtube.ts) — the YouTube equivalent of the site's archive.org
 * license gate, so only legally reusable shorts are surfaced. The query is validated and
 * sanitized like every other catalog query (constitution §6). Edge-cached 300s; rate-limited
 * by middleware like every /api/* route.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const urlString = request.url;
  try {
    return await withEdgeCachedResponse(urlString, 300, async () => {
      if (!env.YOUTUBE_API_KEY) {
        return jsonResponse(
          { enabled: false, reason: "youtube_key_missing" },
          200,
          { "Cache-Control": "public, max-age=300" },
        );
      }
      const raw = url.searchParams.get("q") ?? "short film";
      if (raw.length > MAX_QUERY_LENGTH) {
        throw new ApiError(400, "invalid_query", `Query too long (max ${MAX_QUERY_LENGTH} chars).`);
      }
      const q = sanitizeQuery(raw) || "short film";
      const results = await searchCreativeCommonsVideos(env.YOUTUBE_API_KEY, q);
      return jsonResponse({ enabled: true, q, results }, 200, {
        "Cache-Control": "public, max-age=300",
      });
    });
  } catch (err) {
    return routeError(err);
  }
};

export const onRequestHead = headHandler(onRequestGet);
