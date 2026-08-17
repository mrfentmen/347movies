import assert from "node:assert/strict";
import { test } from "node:test";
import { staleCacheUrl, withEdgeCachedResponse, withStaleOnErrorResponse } from "../lib/edge-cache.ts";

/** Install an in-memory fake Cache API (globalThis.caches) and return its store. */
function installFakeCache(): { store: Map<string, Response>; uninstall: () => void } {
  const store = new Map<string, Response>();
  const cache = {
    async match(request: Request): Promise<Response | undefined> {
      const hit = store.get(request.url);
      return hit ? hit.clone() : undefined;
    },
    async put(request: Request, response: Response): Promise<void> {
      store.set(request.url, response.clone());
    },
  };
  const prev = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = { default: cache };
  return {
    store,
    uninstall: () => {
      if (prev === undefined) delete (globalThis as { caches?: unknown }).caches;
      else (globalThis as { caches?: unknown }).caches = prev;
    },
  };
}

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

test("withEdgeCachedResponse: cold call builds, stores, and returns the response", async () => {
  const { store, uninstall } = installFakeCache();
  try {
    let builds = 0;
    const res = await withEdgeCachedResponse("https://x.test/r", 300, async () => {
      builds += 1;
      return json({ n: 1 });
    });
    assert.equal(builds, 1);
    assert.deepEqual(await res.json(), { n: 1 });
    assert.equal(store.size, 1);
    const stored = store.get("https://x.test/r");
    assert.ok(stored, "response stored");
    assert.equal(stored?.headers.get("Cache-Control"), "public, max-age=300");
  } finally {
    uninstall();
  }
});

test("withEdgeCachedResponse: warm call serves the cache and skips the build", async () => {
  const { store, uninstall } = installFakeCache();
  try {
    store.set("https://x.test/warm", json({ from: "cache" }));
    let builds = 0;
    const res = await withEdgeCachedResponse("https://x.test/warm", 300, async () => {
      builds += 1;
      return json({ from: "build" });
    });
    assert.equal(builds, 0, "build must not run on a cache hit");
    assert.deepEqual(await res.json(), { from: "cache" });
  } finally {
    uninstall();
  }
});

test("withEdgeCachedResponse: a cache failure falls through to the build (optimization only)", async () => {
  const prev = (globalThis as { caches?: unknown }).caches;
  // Cache present but match/put throw: the helper must still serve the build.
  (globalThis as { caches?: unknown }).caches = {
    default: {
      match: async () => {
        throw new Error("cache boom");
      },
      put: async () => {
        throw new Error("put boom");
      },
    },
  };
  try {
    let builds = 0;
    const res = await withEdgeCachedResponse("https://x.test/broken", 300, async () => {
      builds += 1;
      return json({ ok: true });
    });
    assert.equal(builds, 1);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    if (prev === undefined) delete (globalThis as { caches?: unknown }).caches;
    else (globalThis as { caches?: unknown }).caches = prev;
  }
});

test("withEdgeCachedResponse: a no-store response is served but never stored", async () => {
  const { store, uninstall } = installFakeCache();
  try {
    let builds = 0;
    const res = await withEdgeCachedResponse("https://x.test/nostore", 300, async () => {
      builds += 1;
      return new Response("error", {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      });
    });
    assert.equal(builds, 1);
    assert.equal(res.status, 502);
    assert.equal(store.size, 0, "a no-store response must not be cached");
    // A second call rebuilds (nothing was stored), still not cached.
    const res2 = await withEdgeCachedResponse("https://x.test/nostore", 300, async () => {
      builds += 1;
      return new Response("error", {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      });
    });
    assert.equal(builds, 2);
    assert.equal(res2.status, 502);
    assert.equal(store.size, 0);
  } finally {
    uninstall();
  }
});

test("withEdgeCachedResponse: no Cache API at all still serves the build", async () => {
  const prev = (globalThis as { caches?: unknown }).caches;
  delete (globalThis as { caches?: unknown }).caches;
  try {
    let builds = 0;
    const res = await withEdgeCachedResponse("https://x.test/none", 300, async () => {
      builds += 1;
      return json({ served: true });
    });
    assert.equal(builds, 1);
    assert.deepEqual(await res.json(), { served: true });
  } finally {
    if (prev !== undefined) (globalThis as { caches?: unknown }).caches = prev;
  }
});

test("staleCacheUrl appends a private param and preserves the original query", () => {
  assert.equal(
    staleCacheUrl("https://x.test/api/search?q=noir&page=2"),
    "https://x.test/api/search?q=noir&page=2&__stale_fallback=1",
  );
});

test("withStaleOnErrorResponse: cold call builds and stores BOTH a fresh and a stale copy", async () => {
  const { store, uninstall } = installFakeCache();
  try {
    let builds = 0;
    const res = await withStaleOnErrorResponse("https://x.test/r", 300, 3600, async () => {
      builds += 1;
      return json({ n: 1 });
    });
    assert.equal(builds, 1);
    assert.deepEqual(await res.json(), { n: 1 });
    assert.equal(store.size, 2, "fresh + stale copies stored");
    assert.ok(store.has("https://x.test/r"), "fresh copy stored");
    assert.ok(store.has(staleCacheUrl("https://x.test/r")), "stale copy stored");
    assert.equal(store.get("https://x.test/r")?.headers.get("Cache-Control"), "public, max-age=300");
    assert.equal(store.get(staleCacheUrl("https://x.test/r"))?.headers.get("Cache-Control"), "public, max-age=3600");
  } finally {
    uninstall();
  }
});

test("withStaleOnErrorResponse: warm fresh copy serves without rebuilding", async () => {
  const { store, uninstall } = installFakeCache();
  try {
    store.set("https://x.test/warm", json({ from: "cache" }));
    let builds = 0;
    const res = await withStaleOnErrorResponse("https://x.test/warm", 300, 3600, async () => {
      builds += 1;
      return json({ from: "build" });
    });
    assert.equal(builds, 0, "build must not run on a fresh hit");
    assert.deepEqual(await res.json(), { from: "cache" });
  } finally {
    uninstall();
  }
});

test("withStaleOnErrorResponse: serves a marked stale copy when the build throws", async () => {
  const { store, uninstall } = installFakeCache();
  try {
    // Prime only the stale copy — simulates a prior success whose fresh entry has expired.
    store.set(staleCacheUrl("https://x.test/flaky"), json({ from: "last-good" }));
    let builds = 0;
    const res = await withStaleOnErrorResponse("https://x.test/flaky", 300, 3600, async () => {
      builds += 1;
      throw new Error("archive.org 502");
    });
    assert.equal(builds, 1, "the build was attempted before falling back");
    assert.deepEqual(await res.json(), { from: "last-good" }, "stale body served");
    assert.equal(res.headers.get("X-Cache-Status"), "STALE");
    assert.equal(res.headers.get("Cache-Control"), "public, max-age=60");
  } finally {
    uninstall();
  }
});

test("withStaleOnErrorResponse: rethrows when the build fails and no stale copy exists", async () => {
  const { store, uninstall } = installFakeCache();
  try {
    await assert.rejects(
      () =>
        withStaleOnErrorResponse("https://x.test/nostale", 300, 3600, async () => {
          throw new Error("archive.org 502");
        }),
      /archive.org 502/,
    );
    assert.equal(store.size, 0);
  } finally {
    uninstall();
  }
});

test("withStaleOnErrorResponse: a no-store response is served but never stored (fresh or stale)", async () => {
  const { store, uninstall } = installFakeCache();
  try {
    let builds = 0;
    const res = await withStaleOnErrorResponse("https://x.test/nostore", 300, 3600, async () => {
      builds += 1;
      return new Response("error", { status: 502, headers: { "Cache-Control": "no-store" } });
    });
    assert.equal(builds, 1);
    assert.equal(res.status, 502);
    assert.equal(store.size, 0, "no-store must not be cached fresh or stale");
  } finally {
    uninstall();
  }
});
