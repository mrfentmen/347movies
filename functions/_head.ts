import type { PagesFunction } from "@cloudflare/workers-types";

/**
 * Pages Functions routes only export onRequestGet by default, so HEAD requests to function
 * routes return 404 (observed live on /api/*, /movie/*, /sitemap.xml). HEAD-based tools
 * (wget --spider, some uptime monitors, cache validators) would then report those URLs as
 * broken. Export `onRequestHead = headHandler(onRequestGet)` on any route to serve HEAD with
 * the same status/headers as GET and an empty body.
 *
 * Kept in `functions/` (not `lib/`) because it needs @cloudflare/workers-types types, which
 * the test tsconfig (node types) must not mix with undici's Response/Headers.
 */
export function headHandler<E>(get: PagesFunction<E>): PagesFunction<E> {
  return async (context) => {
    const response = await get(context);
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
