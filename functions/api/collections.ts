import type { PagesFunction } from "@cloudflare/workers-types";
import type { IndexVariant } from "../../lib/archive.ts";
import { filterIndex, getCatalogIndex } from "../../lib/catalog-index.ts";
import { withEdgeCachedResponse } from "../../lib/edge-cache.ts";
import type { Env } from "../../lib/env.ts";
import { jsonResponse } from "../../lib/http.ts";
import { routeError } from "../../lib/route-error.ts";
import { headHandler } from "../_head.ts";

/**
 * GET /api/collections — live item counts for every pool the Collections hub lists, in one
 * request (the hub page would otherwise fire ten /api/browse calls and re-create the
 * cold-start storm that once blanked the home page).
 *
 * Each count is exactly what that pool's default browse view presents: the films pool is
 * films-only (never "Episode 18" or a trailer), every other pool is drawn as-is (episodes
 * ARE the content there). Counts come from the same edge-cached indexes /api/browse reads —
 * no upstream call when warm — and the response is edge-cached 300s so a wave of hub
 * visitors shares one computation.
 */
const POOLS: Array<{ variant: IndexVariant; filmsOnly: boolean }> = [
  { variant: "films", filmsOnly: true },
  { variant: "tv", filmsOnly: false },
  { variant: "anime", filmsOnly: false },
  { variant: "cartoons", filmsOnly: false },
  { variant: "otr", filmsOnly: false },
  { variant: "music", filmsOnly: false },
  { variant: "documentaries", filmsOnly: false },
  { variant: "ted", filmsOnly: false },
  { variant: "sports", filmsOnly: false },
  { variant: "shorts", filmsOnly: false },
  { variant: "silents", filmsOnly: false },
  { variant: "publictv", filmsOnly: false },
  { variant: "science", filmsOnly: false },
  { variant: "govfilms", filmsOnly: false },
  { variant: "audiobooks", filmsOnly: false },
  { variant: "records", filmsOnly: false },
  { variant: "ephemera", filmsOnly: false },
  { variant: "space", filmsOnly: false },
];

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const urlString = request.url;
  try {
    return await withEdgeCachedResponse(urlString, 300, async () => {
      // Parallel: each variant's index is single-flighted and edge-cached 24h, so a cold
      // edge pays max(build times), not the sum (same as the home page's concurrent browse).
      const counts = await Promise.all(
        POOLS.map(async ({ variant, filmsOnly }) => {
          const docs = await getCatalogIndex(undefined, variant);
          const count = filmsOnly ? filterIndex(docs, { filmsOnly: true }).length : docs.length;
          return [variant, count] as const;
        }),
      );
      const pools: Record<string, number> = {};
      for (const [variant, count] of counts) pools[variant] = count;
      return jsonResponse({ pools }, 200, { "Cache-Control": "public, max-age=300" });
    });
  } catch (err) {
    return routeError(err);
  }
};

export const onRequestHead = headHandler(onRequestGet);
