import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../lib/env.ts";
import { recordPageView } from "../../lib/views.ts";

/**
 * POST /api/view?path=/… — privacy-respecting page-view report (vow 5 / constitution §5).
 *
 * The client fires one of these per page load, carrying only the pathname. The server maps
 * the path onto a bounded daily bucket and increments it — nothing else is stored: no IP,
 * no user agent, no cookie, no identifier, and the raw path is never kept (only the bucket
 * it collapsed to). The response is always an empty 204, so the endpoint is a pure counter:
 * it leaks nothing, amplifies nothing, and returns nothing an attacker would want.
 *
 * Input handling: the path may arrive as a query param or a JSON body. Anything that does
 * not validate (wrong shape, unknown page, path traversal attempts, oversized strings) is
 * silently ignored — still 204, never counted, never logged, never echoed. The per-IP
 * middleware rate limiter applies, so flooding the counter is bounded to the same 60/min
 * window as every other API route. `Cache-Control: no-store` on both the response and the
 * POST itself (POSTs are never edge-cached) keeps the counter live.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  let path = url.searchParams.get("path") ?? "";

  if (!path) {
    // Body form (accept but do not require): `{ "path": "/browse" }`.
    try {
      const body = (await context.request.json()) as { path?: unknown };
      if (typeof body?.path === "string") path = body.path;
    } catch {
      /* body is optional — an empty report is simply ignored below */
    }
  }

  await recordPageView(context.env, path);
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
};
