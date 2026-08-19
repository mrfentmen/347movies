import type { PagesFunction } from "@cloudflare/workers-types";
import type { IndexVariant } from "../../lib/archive.ts";
import { enrichAudioCardMeta } from "../../lib/audio-meta.ts";
import { searchArchive } from "../../lib/archive.ts";
import { cacheGet, cacheKey, cachePut } from "../../lib/cache.ts";
import { withStaleOnErrorResponse } from "../../lib/edge-cache.ts";
import type { Env } from "../../lib/env.ts";
import { headHandler } from "../_head.ts";
import { jsonResponse } from "../../lib/http.ts";
import { normalizeSearchDoc } from "../../lib/normalize.ts";
import { routeError } from "../../lib/route-error.ts";
import { ApiError, validateFlag, validatePage, validateQuery } from "../../lib/validate.ts";

const ROWS = 24;
const MAX_PAGES = 100;

/** GET /api/search?q=&page= — full-text search over the legal catalog (task T2.1). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const urlString = request.url;
  try {
    // tv=1 / anime=1 / cartoons=1 / otr=1 search their pool (same license gate). An empty
    // query is allowed there: it returns the pool newest-first — the "Search TV shows"
    // shortcut lands on something useful instead of a 400. At most one may be set.
    const tv = validateFlag(url.searchParams.get("tv"));
    const anime = validateFlag(url.searchParams.get("anime"));
    const cartoons = validateFlag(url.searchParams.get("cartoons"));
    const otr = validateFlag(url.searchParams.get("otr"));
    const music = validateFlag(url.searchParams.get("music"));
    const documentaries = validateFlag(url.searchParams.get("documentaries"));
    const sports = validateFlag(url.searchParams.get("sports"));
    const shorts = validateFlag(url.searchParams.get("shorts"));
    const silents = validateFlag(url.searchParams.get("silents"));
    const publictv = validateFlag(url.searchParams.get("publictv"));
    const science = validateFlag(url.searchParams.get("science"));
    if ([tv, anime, cartoons, otr, music, documentaries, sports, shorts, silents, publictv, science].filter(Boolean).length > 1) {
      throw new ApiError(400, "invalid_catalog", "Use only one of tv, anime, cartoons, otr, music, documentaries, sports, shorts, silents, publictv, science.");
    }
    const variant: IndexVariant = tv ? "tv" : anime ? "anime" : cartoons ? "cartoons" : otr ? "otr" : music ? "music" : documentaries ? "documentaries" : sports ? "sports" : shorts ? "shorts" : silents ? "silents" : publictv ? "publictv" : science ? "science" : "films";
    const serialized = variant !== "films";
    const q = validateQuery(url.searchParams.get("q"), serialized);
    const page = validatePage(url.searchParams.get("page"));

    // NOTE: must be awaited inside the try — returning the promise directly would let a
    // rejection (ArchiveError from archive.org) escape this catch and surface as a generic
    // middleware 500 instead of the intended 502 upstream_error (root-caused 2026-08-16:
    // q="a\" OR 1=1 --" sanitized to "a OR 1=1 --" is rejected by archive.org's Solr, and
    // the 502 mapping was dead code).
    // Stale-on-error: a 300s fresh copy serves the hot path; a 3600s last-known-good copy
    // is served (marked STALE) when archive.org 502s, so a transient outage stops flaking
    // the UI and the browser battery instead of surfacing as upstream_error. This layer is
    // the production resilience path — KV is not yet bound (the deploy token is Pages-scoped
    // only), so the 24h KV cache is a no-op until that permission lands.
    return await withStaleOnErrorResponse(urlString, 300, 3600, async () => {
      const cacheKey_ = cacheKey("search", [q, page, variant]);
      const cached = await cacheGet(env.MOVIES_KV, cacheKey_);
      if (cached !== null) {
        try {
          return jsonResponse(JSON.parse(cached), 200, { "Cache-Control": "public, max-age=300" });
        } catch {
          // corrupt cache entry: refetch from archive.org
        }
      }

      // filmsOnly is catalog policy, not a UI preference: the same episode+trailer exclusion
      // browse/home/random apply, so search never surfaces "Episode 18" or "X trailer" as a
      // film (verified live: a top "noir" hit used to be "Nightmare Alley trailer").
      const { numFound, docs } = await searchArchive({
        query: q,
        page,
        rows: ROWS,
        filmsOnly: !serialized,
        variant,
        // Empty serialized-pool query = the pool newest-first (the search shortcut's
        // landing view).
        sort: serialized && !q ? "recent" : undefined,
      });
      const results = docs.map(normalizeSearchDoc);
      // Audio pools (otr/music) get an episode count + series tag from per-item metadata
      // (edge-cached 24h); non-audio variants are a no-op inside. lib/audio-meta.ts.
      await enrichAudioCardMeta(results, variant);
      const body = {
        query: q,
        page,
        rows: ROWS,
        total: numFound,
        pages: Math.min(Math.max(1, Math.ceil(numFound / ROWS)), MAX_PAGES),
        results,
      };
      await cachePut(env.MOVIES_KV, cacheKey_, body);
      return jsonResponse(body, 200, { "Cache-Control": "public, max-age=300" });
    });
  } catch (err) {
    return routeError(err);
  }
};

export const onRequestHead = headHandler(onRequestGet);
