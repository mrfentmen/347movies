import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../lib/env.ts";
import { headHandler } from "../_head.ts";
import { jsonResponse } from "../../lib/http.ts";
import { withEdgeCachedResponse } from "../../lib/edge-cache.ts";
import { adConfig } from "../../lib/ad.ts";

/**
 * GET /api/ad-config — the ad loader's config gate (Decision 001, T4.3).
 *
 * The client bootstrap fetches this on every page view, so it is edge-cached (300s) and
 * fail-closed: unless AD_NETWORK_SCRIPT is an https URL on the allowlist, it returns
 * `{ enabled: false }` and the client injects nothing — the reserved slots keep their note.
 * The script URL is public configuration (it would appear in the HTML once enabled), so
 * serving it from a public endpoint is not a secret disclosure. The CSP allowlist change
 * that lets the network's script actually run is T4.5 — applied only with a real contract.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  // Awaited for consistency with the other edge-cached routes (the build cannot throw
  // today, but an un-awaited rejection would bypass this handler's error handling).
  return await withEdgeCachedResponse(url.pathname, 300, async () => {
    const config = adConfig(context.env.AD_NETWORK_SCRIPT);
    const body = config
      ? { enabled: true, scriptUrl: config.scriptUrl }
      : { enabled: false };
    return jsonResponse(body, 200, { "Cache-Control": "public, max-age=300" });
  });
};

export const onRequestHead = headHandler(onRequestGet);
