import type { PagesFunction } from "@cloudflare/workers-types";
import type { IndexVariant } from "../../lib/archive.ts";
import { enrichAudioCardMeta } from "../../lib/audio-meta.ts";
import { queryCatalog } from "../../lib/catalog-index.ts";
import { withEdgeCachedResponse } from "../../lib/edge-cache.ts";
import type { Env } from "../../lib/env.ts";
import { GENRE_SUBJECTS } from "../../lib/genres.ts";
import { headHandler } from "../_head.ts";
import { jsonResponse } from "../../lib/http.ts";
import { routeError } from "../../lib/route-error.ts";
import {
  ApiError,
  validateDecade,
  validateDecadeRange,
  validateFlag,
  validateGenre,
  validateKeyword,
  validatePage,
  validateSort,
  validateSubject,
} from "../../lib/validate.ts";

const ROWS = 24;

/**
 * GET /api/browse?genre=&decade=&from=&to=&q=&sort=&page=&films=&tv=&anime=&cartoons= —
 * browse + home sections (task T3.2). tv=1 switches to the classic-TV catalog, anime=1 to
 * the anime pool, cartoons=1 to the animation pool (each the same license gate over its
 * collection); in all three, episodes ARE the content, so films-only does not apply. At
 * most one of tv/anime/cartoons may be set.
 * from/to is a decade range (decade starts, both required,
 * mutually exclusive with decade) mapped to year bounds — from=2000&to=2020 means years
 * 2000–2029, the "Modern picks" home feed. q is a title-keyword filter (ANY token,
 * >=3 chars, case-insensitive substring) — the "Hong Kong action" home feed.
 * sort=newest orders by release year descending.
 * served from the local catalog index (lib/catalog-index.ts): one edge-cached copy of the
 * full legal catalog, filtered/sorted/paged in-memory. No archive.org call per request; the
 * upstream fetch happens at most once per 24h. The old 100-page/2,400-film paging cap is
 * gone — the whole catalog (~18,489 films) is pageable.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const url = new URL(request.url);
  const urlString = request.url;
  try {
    const genre = validateGenre(url.searchParams.get("genre"));
    const decade = validateDecade(url.searchParams.get("decade"));
    // Decade range (from/to) is an alternative to a single decade; the two must not mix.
    const range = validateDecadeRange(url.searchParams.get("from"), url.searchParams.get("to"));
    if (decade !== null && (range.from !== null || range.to !== null)) {
      throw new ApiError(400, "invalid_decade_range", "Use either decade or from/to, not both.");
    }
    const keyword = validateKeyword(url.searchParams.get("q"));
    // subject= is a raw subject phrase ("More like this" on detail pages), bypassing the
    // curated genre map — any archive.org subject tag works.
    const subject = validateSubject(url.searchParams.get("subject"));
    const sort = validateSort(url.searchParams.get("sort"));
    // The index makes the whole catalog pageable (768 pages at 24/page, and growing) — the
    // old 100-page cap applied to the archive-backed paging. Bound is generous and fail-closed.
    const page = validatePage(url.searchParams.get("page"), 1000);
    // Absent films= means the catalog policy default (films-only); "0" opts into everything.
    const filmsParam = url.searchParams.get("films");
    const films = filmsParam === null ? undefined : validateFlag(filmsParam);
    // tv=1 / anime=1 / cartoons=1 / otr=1 switch the browse surface to the classic-TV,
    // anime, animation, or Old Time Radio catalog (each the same license gate over its
    // collection). At most one may be set. In all four, episodes ARE the content, so the
    // films-only policy does not apply.
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
    const govfilms = validateFlag(url.searchParams.get("govfilms"));
    const audiobooks = validateFlag(url.searchParams.get("audiobooks"));
    const records = validateFlag(url.searchParams.get("records"));
    const ephemera = validateFlag(url.searchParams.get("ephemera"));
    if ([tv, anime, cartoons, otr, music, documentaries, sports, shorts, silents, publictv, science, govfilms, audiobooks, records, ephemera].filter(Boolean).length > 1) {
      throw new ApiError(400, "invalid_catalog", "Use only one of tv, anime, cartoons, otr, music, documentaries, sports, shorts, silents, publictv, science, govfilms, audiobooks, records, ephemera.");
    }
    const variant: IndexVariant = tv ? "tv" : anime ? "anime" : cartoons ? "cartoons" : otr ? "otr" : music ? "music" : documentaries ? "documentaries" : sports ? "sports" : shorts ? "shorts" : silents ? "silents" : publictv ? "publictv" : science ? "science" : govfilms ? "govfilms" : audiobooks ? "audiobooks" : records ? "records" : ephemera ? "ephemera" : "films";
    const serialized = variant !== "films";

    // Must be awaited inside the try (same bug class as search.ts, fixed 2026-08-16): an
    // un-awaited rejection escapes this catch and becomes a middleware 500 instead of the
    // intended 502 upstream_error.
    return await withEdgeCachedResponse(urlString, 300, async () => {
      const genreSubject = subject ?? (genre ? GENRE_SUBJECTS[genre] : null);
      const { results, total, pages } = await queryCatalog({
        genreSubject,
        decadeFrom: range.from !== null ? range.from : decade,
        decadeTo: range.to !== null ? range.to + 9 : decade !== null ? decade + 9 : null,
        keyword,
        sort,
        page,
        rows: ROWS,
        filmsOnly: serialized ? false : films,
        variant,
      });
      // Audio pools (otr/music) get an episode count + series tag from per-item metadata
      // (edge-cached 24h); non-audio variants are a no-op inside. lib/audio-meta.ts.
      await enrichAudioCardMeta(results, variant);

      const body = {
        genre,
        decade,
        from: range.from,
        to: range.to,
        q: keyword,
        subject,
        sort,
        page,
        rows: ROWS,
        total,
        pages,
        // tv/anime/cartoons responses must not claim the films catalog: the flag identifies
        // which pool the results came from, and a serialized response is not films-only
        // (episodes ARE content).
        films: serialized ? undefined : (films ?? true) || undefined,
        results,
      };
      return jsonResponse(body, 200, { "Cache-Control": "public, max-age=300" });
    });
  } catch (err) {
    return routeError(err);
  }
};

export const onRequestHead = headHandler(onRequestGet);
