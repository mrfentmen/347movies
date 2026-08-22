import type { PagesFunction } from "@cloudflare/workers-types";
import { routeError } from "../../lib/route-error.ts";
import { toWebVtt } from "../../lib/subtitles.ts";
import { ApiError, validateIdentifier } from "../../lib/validate.ts";

const MAX_SUBTITLE_BYTES = 2_000_000;

/**
 * GET /api/subtitle?identifier=<id>&file=<name> — same-origin proxy for the native player's
 * captions track.
 *
 * The archive.org download endpoint sends NO CORS headers (verified live), so a
 * cross-origin <track> cannot render and a client-side fetch is blocked. This route is the
 * site's one browser-visible path to archive.org content, following the existing rule that
 * all catalog data flows through our own /api routes (the app.js header contract). It
 * fetches the subtitle text server-side and serves it same-origin as WebVTT — .srt files
 * are converted (the browser's <track> needs WebVTT; archive.org's ASR .srt is the
 * reliably-populated derivative, its .vtt sibling is often empty).
 *
 * Hardened like every external input: the identifier is charset-validated (the same
 * validator as the movie route) and the file name must match a strict pattern, so the
 * upstream URL can only ever point at archive.org/download/<valid-id>/<valid-file> — no
 * path traversal, no arbitrary fetch (SSRF boundary, constitution §6).
 */
export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  try {
    const identifier = validateIdentifier(url.searchParams.get("identifier"));
    const file = url.searchParams.get("file") ?? "";
    // Strict filename shape: archive.org file names are [A-Za-z0-9._-] and subtitles are
    // .srt or .vtt. Anything else fails closed before any upstream call.
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(srt|vtt)$/i.test(file)) {
      throw new ApiError(400, "invalid_subtitle_file", "Invalid subtitle file name.");
    }
    const isSrt = /\.srt$/i.test(file);
    const upstream = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file)}`;
    const res = await fetch(upstream, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "347movies/1.0 (captions proxy)" },
    });
    if (res.status === 404) {
      // The item exists but the named file does not — an honest not-found, not a 502.
      return new Response("Subtitle not found.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (!res.ok) {
      throw new ApiError(502, "upstream_error", "archive.org could not serve that subtitle.");
    }
    // Size cap: a legitimate subtitle is < ~2MB; anything larger is upstream garbage.
    const declared = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (declared > MAX_SUBTITLE_BYTES) {
      throw new ApiError(502, "subtitle_too_large", "That subtitle file is unexpectedly large.");
    }
    const text = await res.text();
    if (text.length > MAX_SUBTITLE_BYTES) {
      throw new ApiError(502, "subtitle_too_large", "That subtitle file is unexpectedly large.");
    }
    const body = isSrt ? toWebVtt(text) : text;
    // text/vtt lets the browser's track loader parse cues; the caption text is archive.org
    // derived, cached briefly like the movie page (captions can be re-derived upstream).
    return new Response(body, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return routeError(err);
  }
};
