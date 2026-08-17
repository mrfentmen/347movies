import assert from "node:assert/strict";
import { test } from "node:test";
import { CACHE_TTL_SECONDS, cacheGet, cacheKey, cachePut, type CacheBackend } from "../lib/cache.ts";

/** In-memory KV shim for unit tests (the real KVNamespace matches this shape structurally). */
class MemoryKV implements CacheBackend {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const ttl = options?.expirationTtl ?? CACHE_TTL_SECONDS;
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }
}

test("cacheKey composes validated inputs", () => {
  assert.equal(cacheKey("search", ["noir", 2]), "search:noir:2");
  assert.equal(cacheKey("movie", ["it-1927"]), "movie:it-1927");
  assert.equal(cacheKey("browse", ["", "", "recent", 1]), "browse:::recent:1");
});

test("cachePut/cacheGet round-trip JSON values", async () => {
  const kv = new MemoryKV();
  await cachePut(kv, "k1", { hello: "world", n: 42 });
  const raw = await cacheGet(kv, "k1");
  assert.ok(raw !== null);
  assert.deepEqual(JSON.parse(raw), { hello: "world", n: 42 });
});

test("cacheGet misses return null", async () => {
  const kv = new MemoryKV();
  assert.equal(await cacheGet(kv, "missing"), null);
});

test("cache helpers no-op safely without a binding", async () => {
  assert.equal(await cacheGet(null, "k"), null);
  assert.equal(await cacheGet(undefined, "k"), null);
  await cachePut(null, "k", { x: 1 });
  await cachePut(undefined, "k", { x: 1 });
});

test("expired entries are treated as misses", async () => {
  const kv = new MemoryKV();
  await kv.put("k", "v", { expirationTtl: 0 });
  assert.equal(await kv.get("k"), null);
});
