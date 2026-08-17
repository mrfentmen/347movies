import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Regression test for the un-awaited `withEdgeCachedResponse` bug (fixed 2026-08-16):
 * returning the promise directly let a rejection (ArchiveError from archive.org) escape
 * the route's try/catch, so the intended `502 upstream_error` mapping was dead code and
 * real upstream failures surfaced as a generic 500. Root-caused live: a search for
 * `a" OR 1=1 --` sanitizes to `a OR 1=1 --`, which archive.org's Solr rejects with HTTP
 * 200 + `{"error": "a reserved character appears at an unexpected position ..."}` — the
 * route must map that to 502 upstream_error, never 500.
 *
 * The routes are loaded via a variable dynamic import on purpose: `functions/**` needs
 * `@cloudflare/workers-types`, which the test tsconfig (node types) must not mix with
 * undici's Response/Headers (the `_head.ts` convention). A variable specifier keeps the
 * functions modules out of the type-checked program while still executing the real routes.
 */
type RouteCtx = {
  request: Request;
  env: Record<string, never>;
  params: Record<string, never>;
  data: Record<string, never>;
};

/** archive.org's actual response shape for a rejected query: HTTP 200 with an error body. */
const ARCHIVE_ERROR_BODY = {
  error: 'a reserved character appears at an unexpected position (near char "-" at position 14)',
};

function installFakeFetch(archiveResponse: unknown): { uninstall: () => void } {
  const prev = (globalThis as { fetch?: unknown }).fetch;
  (globalThis as { fetch: unknown }).fetch = async () =>
    new Response(JSON.stringify(archiveResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    uninstall: () => {
      if (prev === undefined) delete (globalThis as { fetch?: unknown }).fetch;
      else (globalThis as { fetch: unknown }).fetch = prev;
    },
  };
}

const EMPTY_ENV: Record<string, never> = {}; // MOVIES_KV absent: cacheGet/cachePut no-op safely

test("search route: archive.org query rejection -> 502 upstream_error (never 500)", async () => {
  const spec: string = "../functions/api/search.ts";
  const searchModule = (await import(spec)) as {
    onRequestGet: (ctx: RouteCtx) => Promise<Response>;
  };
  const { uninstall } = installFakeFetch(ARCHIVE_ERROR_BODY);
  try {
    const res = await searchModule.onRequestGet({
      request: new Request("https://347movies.pages.dev/api/search?q=a%22%20OR%201%3D1%20--"),
      env: EMPTY_ENV,
      params: {},
      data: {},
    });
    assert.equal(res.status, 502, "must map the ArchiveError to 502, not a generic 500");
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "upstream_error");
  } finally {
    uninstall();
  }
});

test("search route: unexpected-shape response -> 502 upstream_error", async () => {
  const spec: string = "../functions/api/search.ts";
  const searchModule = (await import(spec)) as {
    onRequestGet: (ctx: RouteCtx) => Promise<Response>;
  };
  const { uninstall } = installFakeFetch({ unexpected: "shape" });
  try {
    const res = await searchModule.onRequestGet({
      request: new Request("https://347movies.pages.dev/api/search?q=noir"),
      env: EMPTY_ENV,
      params: {},
      data: {},
    });
    assert.equal(res.status, 502, "unexpected response shape is an upstream failure");
  } finally {
    uninstall();
  }
});

test("browse route: upstream ArchiveError -> 502 upstream_error (same un-awaited bug class)", async () => {
  const spec: string = "../functions/api/browse.ts";
  const browseModule = (await import(spec)) as {
    onRequestGet: (ctx: RouteCtx) => Promise<Response>;
  };
  const { uninstall } = installFakeFetch(ARCHIVE_ERROR_BODY);
  try {
    const res = await browseModule.onRequestGet({
      request: new Request("https://347movies.pages.dev/api/browse?genre=film-noir"),
      env: EMPTY_ENV,
      params: {},
      data: {},
    });
    assert.equal(res.status, 502, "browse must map upstream failures to 502, never 500");
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "upstream_error");
  } finally {
    uninstall();
  }
});
