import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../lib/env.ts";
import { headHandler } from "../_head.ts";
import { jsonResponse } from "../../lib/http.ts";
import { withEdgeCachedResponse } from "../../lib/edge-cache.ts";
import { adsenseConfig } from "../../lib/ad.ts";

/**
 * GET /api/ad-config — the ad loader's config gate (Decision 001, T4.3, enabled per T4.5).
 *
 * The client bootstrap fetches this on every page view, so it is edge-cached (300s) and
 * fail-closed: unless AD_NETWORK_SCRIPT is an allowlisted AdSense loader URL with a client
 * id AND AD_SLOT_IDS has at least one valid slot id, it returns `{ enabled: false }` and the
 * client injects nothing — the reserved slots keep their note. When enabled it returns the
 * loader URL, the publisher id, and the slot-id map so the client can render units into the
 * marked containers. The values are public configuration (they appear in the HTML once
 * enabled), so serving them from a public endpoint is not a secret disclosure.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  // Awaited for consistency with the other edge-cached routes (the build cannot throw
  // today, but an un-awaited rejection would bypass this handler's error handling).
  return await withEdgeCachedResponse(url.pathname, 300, async () => {
    const config = adsenseConfig(context.env.AD_NETWORK_SCRIPT, context.env.AD_SLOT_IDS);
    const body = config
      ? { enabled: true, scriptUrl: config.scriptUrl, clientId: config.clientId, slots: config.slots }
      : { enabled: false };
    return jsonResponse(body, 200, { "Cache-Control": "public, max-age=300" });
  });
};

export const onRequestHead = headHandler(onRequestGet);
