/**
 * Edge response cache via the Cloudflare Cache API (caches.default). No namespace, no
 * permissions, $0 — a Cloudflare-native layer that works today while the KV namespace awaits
 * a token with Workers KV permissions (the deployed token is Pages-scoped only). KV remains
 * the primary 24h upstream-dedup cache; this adds fast edge response caching on top.
 *
 * The cache is an optimization only: a miss, eviction, or failure never breaks the site
 * (upstream archive.org is always the source of truth). TTLs travel on the stored copy's
 * Cache-Control header.
 */
export interface EdgeCacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function edgeCache(): EdgeCacheLike | null {
  // Access via globalThis so this module also type-checks/runs in Node (returns null there).
  const cachesGlobal = (globalThis as { caches?: { default?: EdgeCacheLike } }).caches;
  const cache = cachesGlobal && cachesGlobal.default;
  return cache ?? null;
}

export async function edgeCacheMatch(url: string): Promise<Response | null> {
  try {
    const cache = edgeCache();
    if (!cache) return null;
    const cached = await cache.match(new Request(url));
    return cached ?? null;
  } catch (err) {
    console.warn("edge cache match failed", err);
    return null;
  }
}

export async function edgeCachePut(url: string, response: Response, ttlSeconds: number): Promise<void> {
  try {
    const cache = edgeCache();
    if (!cache) return;
    const clone = response.clone();
    const headers = new Headers(clone.headers);
    headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
    const copy = new Response(clone.body, {
      status: clone.status,
      statusText: clone.statusText,
      headers,
    });
    await cache.put(new Request(url), copy);
  } catch (err) {
    console.warn("edge cache put failed", err);
  }
}

/**
 * Read-through helper for edge-cached responses: serve the cached copy when present, else
 * build, store, and return. The cache stays an optimization only — a miss, eviction, or
 * failure always falls through to the build path, so a broken cache never breaks the site.
 *
 * A response that declares `Cache-Control: no-store` is never stored — the caller signals
 * cacheability on the response it builds (error pages, unavailable films, fallback 502s all
 * carry no-store), so this one helper serves every caller: the JSON routes that always cache
 * AND the page routes that must not cache their error variants. The match/put choreography
 * lives here, not in the adapters.
 */
export async function withEdgeCachedResponse(
  url: string,
  ttlSeconds: number,
  build: () => Promise<Response>,
): Promise<Response> {
  const cached = await edgeCacheMatch(url);
  if (cached) return cached;
  const response = await build();
  if (!response.headers.get("Cache-Control")?.includes("no-store")) {
    await edgeCachePut(url, response, ttlSeconds);
  }
  return response;
}

/**
 * Cache key for the long-lived fallback copy. Appending a private query param keeps the
 * fresh and stale copies as two distinct Cache API entries with independent TTLs.
 */
export function staleCacheUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("__stale_fallback", "1");
  return u.toString();
}

/**
 * Stale-on-error read-through (RFC 5861's `stale-if-error`, implemented explicitly so it is
 * deterministic and testable — never a bet on opaque CDN behavior). The fast path serves a
 * short-TTL fresh copy; on an upstream failure it falls back to a long-TTL last-known-good
 * copy instead of surfacing the error. This is what makes archive.org's transient 502s
 * (and the long outages that have plagued the search API) non-user-visible for queries that
 * have succeeded recently. The cache stays an optimization only: with no stale copy, the
 * error still propagates; a broken cache never breaks the site.
 */
export async function withStaleOnErrorResponse(
  url: string,
  freshTtlSeconds: number,
  staleTtlSeconds: number,
  build: () => Promise<Response>,
): Promise<Response> {
  const fresh = await edgeCacheMatch(url);
  if (fresh) return fresh;

  try {
    const response = await build();
    if (!response.headers.get("Cache-Control")?.includes("no-store")) {
      await edgeCachePut(url, response, freshTtlSeconds);
      await edgeCachePut(staleCacheUrl(url), response, staleTtlSeconds);
    }
    return response;
  } catch (err) {
    const stale = await edgeCacheMatch(staleCacheUrl(url));
    if (stale) return markStale(stale);
    throw err;
  }
}

/** Tag a served fallback and shorten its client TTL so a recovered origin is seen soon. */
function markStale(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Cache-Status", "STALE");
  headers.set("Cache-Control", "public, max-age=60");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
