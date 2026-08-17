import type { PagesFunction } from "@cloudflare/workers-types";
import { getMovieRecord } from "../../../lib/catalog.ts";
import { withEdgeCachedResponse } from "../../../lib/edge-cache.ts";
import type { Env } from "../../../lib/env.ts";
import { headHandler } from "../../_head.ts";
import { jsonError, jsonResponse } from "../../../lib/http.ts";

const NOT_OK_MESSAGES: Record<string, string> = {
  invalid: "Invalid film identifier.",
  not_found: "This film does not exist in our catalog.",
  not_available: "This film is no longer available on the Internet Archive.",
  not_legal: "We could not verify this film's license, so it is not available on 347movies.",
  upstream: "The catalog is temporarily unavailable. Please try again shortly.",
};

/** GET /api/movie/<identifier> — full normalized record with license verification (task T2.2). */
export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const identifier = String(params.identifier);
  const urlString = request.url;

  // Error responses carry no-store, so withEdgeCachedResponse never caches them (only the
  // 200 record is stored).
  return await withEdgeCachedResponse(urlString, 3600, async () => {
    const result = await getMovieRecord(identifier, env.MOVIES_KV);
    if (!result.ok) {
      return jsonError(result.status, result.reason, NOT_OK_MESSAGES[result.reason] ?? "Film unavailable.");
    }
    return jsonResponse(result.record, 200, { "Cache-Control": "public, max-age=3600" });
  });
};

export const onRequestHead = headHandler(onRequestGet);
