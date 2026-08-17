/**
 * UNIT TESTS for the movie-detail fail-closed path (lib/catalog.ts) — the constitution's
 * core guarantee (legal-only, verified, never guessed). Tests cross the same seam callers
 * use: getMovieRecord(identifier, cache, fetchImpl) with an injected routing fetch mock.
 *
 * Fixtures are grounded in the live API (probed 2026-08-15):
 *  - a missing item returns HTTP 200 with body {}          -> not_available
 *  - a dark item returns HTTP 200 with is_dark: true       -> not_available
 *  - a valid item returns { metadata, files, is_dark }     -> ok
 *
 * The `not_found` branch (an ArchiveError with status 404) is deliberately NOT tested:
 * through the real seam it is unreachable today. fetchWithRetry (lib/archive.ts) returns
 * any HTTP < 500 response untouched, so a 404 response body parses normally, and archive.org
 * responds 200 {} for missing items anyway. The branch stays as defensively correct
 * behavior if the upstream API ever starts returning real 404s.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getMovieRecord } from "../lib/catalog.ts";
import type { CacheBackend } from "../lib/cache.ts";
import { ARCHIVE_METADATA_URL, ARCHIVE_SEARCH_URL } from "../lib/archive.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface MockOptions {
  /** Called with the decoded identifier; default: missing-item shape (200 {}). */
  metadata?: (id: string) => Response;
  /** Default: empty search response. */
  search?: () => Response;
  count?: { calls: string[] };
}

/** Fetch mock that routes metadata vs search by URL prefix, like the real client. */
function makeFetch(opts: MockOptions = {}): typeof fetch {
  return async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    opts.count?.calls.push(url);
    if (url.startsWith(ARCHIVE_METADATA_URL)) {
      const id = decodeURIComponent(url.slice(ARCHIVE_METADATA_URL.length + 1));
      if (opts.metadata) return opts.metadata(id);
      return jsonResponse({});
    }
    if (url.startsWith(ARCHIVE_SEARCH_URL)) {
      if (opts.search) return opts.search();
      return jsonResponse({ response: { docs: [] } });
    }
    throw new Error(`mock received unexpected URL: ${url}`);
  };
}

/** In-memory KV shim (the real KVNamespace matches this shape structurally). */
class MemoryKV implements CacheBackend {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

/** Realistic it-1927-shaped metadata (probed live 2026-08-15: title/licenseurl/addeddate/files). */
const VALID_METADATA = {
  metadata: {
    identifier: "it-1927",
    title: "It (1927)",
    licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/",
    addeddate: "2025-07-27 02:59:04",
    description: "A silent romance classic.",
    genre: ["Silent Films"],
    subject: ["silent", "romance"],
    creator: ["Clarence G. Badger"],
  },
  files: [
    { name: "It (1927).mp4", format: "h.264" },
    { name: "__ia_thumb.jpg", format: "Item Tile" },
  ],
  is_dark: false,
};

test("invalid identifiers -> 400 invalid with zero upstream calls", async () => {
  const calls: string[] = [];
  const fetchImpl = makeFetch({ count: { calls } });
  for (const bad of ["bad id", "../traversal", "", "has space", "bad;chars"]) {
    const result = await getMovieRecord(bad, null, fetchImpl);
    assert.deepEqual(result, { ok: false, status: 400, reason: "invalid" }, `identifier: ${JSON.stringify(bad)}`);
  }
  assert.equal(calls.length, 0, "validation must fail before any upstream call");
});

test("missing item (real shape: HTTP 200 {}) -> 404 not_available", async () => {
  const result = await getMovieRecord("missing-item", null, makeFetch());
  assert.deepEqual(result, { ok: false, status: 404, reason: "not_available" });
});

test("dark/removed item -> 404 not_available", async () => {
  const result = await getMovieRecord("night_of_the_living_dead", null, makeFetch({
    metadata: () => jsonResponse({ is_dark: true }),
  }));
  assert.deepEqual(result, { ok: false, status: 404, reason: "not_available" });
});

test("no license anywhere (metadata + search fallback) -> 404 not_legal, fail closed", async () => {
  const calls: string[] = [];
  const result = await getMovieRecord("no-license-item", null, makeFetch({
    metadata: () => jsonResponse({ metadata: { identifier: "no-license-item", title: "No License" } }),
    search: () => jsonResponse({ response: { docs: [{ identifier: "no-license-item", title: "No License" }] } }),
    count: { calls },
  }));
  assert.deepEqual(result, { ok: false, status: 404, reason: "not_legal" });
  assert.ok(
    calls.some((u) => u.startsWith(ARCHIVE_SEARCH_URL)),
    "the search-index fallback must be consulted before failing closed",
  );
});

test("search-index fallback recovers a license the metadata omits", async () => {
  const result = await getMovieRecord("meta-no-license", null, makeFetch({
    metadata: () => jsonResponse({ metadata: { identifier: "meta-no-license", title: "X" } }),
    search: () => jsonResponse({
      response: { docs: [{ identifier: "meta-no-license", licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/" }] },
    }),
  }));
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.record.license, "publicdomain");
    assert.equal(result.fromCache, false);
  }
});

test("license via rights statement when licenseurl is absent", async () => {
  const result = await getMovieRecord("rights-film", null, makeFetch({
    metadata: () => jsonResponse({ metadata: { identifier: "rights-film", title: "R", rights: "Public domain" } }),
  }));
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) assert.equal(result.record.license, "publicdomain");
});

test("success: full record with license, video flag, and cache write", async () => {
  const kv = new MemoryKV();
  const result = await getMovieRecord("it-1927", kv, makeFetch({ metadata: () => jsonResponse(VALID_METADATA) }));
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.fromCache, false);
    assert.equal(result.record.identifier, "it-1927");
    assert.equal(result.record.title, "It (1927)");
    assert.equal(result.record.license, "publicdomain");
    assert.equal(result.record.hasVideo, true, "h.264 file must set hasVideo");
    assert.equal(result.record.addeddate, "2025-07-27");
    assert.ok(result.record.thumbnails.small.startsWith("https://archive.org/"));
  }
  const cached = await kv.get("movie:it-1927");
  assert.ok(cached !== null, "the record must be written to the cache");
  assert.equal(JSON.parse(cached as string).identifier, "it-1927");
});

test("cache hit serves the record with zero upstream calls", async () => {
  const kv = new MemoryKV();
  await kv.put("movie:cached-film", JSON.stringify({ identifier: "cached-film", title: "Cached Film" }));
  const calls: string[] = [];
  const result = await getMovieRecord("cached-film", kv, makeFetch({
    metadata: () => {
      throw new Error("cache hit must not reach the upstream");
    },
    count: { calls },
  }));
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.fromCache, true);
    assert.equal(result.record.title, "Cached Film");
  }
  assert.equal(calls.length, 0, "a warm cache must not call archive.org");
});

test("corrupt cache entry falls through and refetches from the source of truth", async () => {
  const kv = new MemoryKV();
  await kv.put("movie:it-1927", "{this is not valid json!!!");
  const result = await getMovieRecord("it-1927", kv, makeFetch({ metadata: () => jsonResponse(VALID_METADATA) }));
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.fromCache, false);
    assert.equal(result.record.identifier, "it-1927");
  }
});

test("cache entry for a different identifier is ignored", async () => {
  const kv = new MemoryKV();
  await kv.put("movie:it-1927", JSON.stringify({ identifier: "some-other-film", title: "Wrong" }));
  const result = await getMovieRecord("it-1927", kv, makeFetch({ metadata: () => jsonResponse(VALID_METADATA) }));
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.fromCache, false);
    assert.equal(result.record.identifier, "it-1927");
  }
});

test("persistent upstream 5xx -> 502 upstream, with exactly one automatic retry", async () => {
  let attempts = 0;
  const result = await getMovieRecord("flaky", null, makeFetch({
    metadata: () => {
      attempts++;
      return new Response("boom", { status: 503 });
    },
  }));
  assert.deepEqual(result, { ok: false, status: 502, reason: "upstream" });
  assert.equal(attempts, 2, "the client retries transient 5xx once before failing closed");
});

test("network failure -> 502 upstream, with exactly one automatic retry", async () => {
  let attempts = 0;
  const result = await getMovieRecord("flaky-net", null, makeFetch({
    metadata: () => {
      attempts++;
      throw new TypeError("fetch failed");
    },
  }));
  assert.deepEqual(result, { ok: false, status: 502, reason: "upstream" });
  assert.equal(attempts, 2, "the client retries network errors once before failing closed");
});
