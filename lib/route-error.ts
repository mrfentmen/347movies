/**
 * Route error mapping — the single home for "how does a route turn a thrown error into a
 * JSON response". A deep seam: callers pass the caught error and never learn the error
 * taxonomy (ApiError vs ArchiveError vs unexpected). Both /api/search and /api/browse used
 * to carry byte-identical catch blocks that had drifted apart on the fallback (search
 * returned 500 directly, browse rethrew for the middleware to catch — same wire result,
 * two behaviors). One function, one behavior.
 */
import { ArchiveError } from "./archive.ts";
import { jsonError } from "./http.ts";
import { ApiError } from "./validate.ts";

/** Map any thrown error to the JSON error response the route should return. */
export function routeError(err: unknown): Response {
  if (err instanceof ApiError) return jsonError(err.status, err.code, err.message);
  if (err instanceof ArchiveError) {
    return jsonError(502, "upstream_error", "The film catalog is temporarily unavailable. Please try again shortly.");
  }
  return jsonError(500, "internal_error", "Something went wrong. Please try again.");
}
