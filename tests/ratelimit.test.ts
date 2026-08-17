import assert from "node:assert/strict";
import { test } from "node:test";
import { isRateLimitedPath, MemoryRateLimiter, rateLimitConfig } from "../lib/ratelimit.ts";

test("allows requests up to the limit, then blocks", () => {
  const limiter = new MemoryRateLimiter({ limit: 3, windowMs: 60_000 });
  assert.equal(limiter.allow("1.2.3.4"), true);
  assert.equal(limiter.allow("1.2.3.4"), true);
  assert.equal(limiter.allow("1.2.3.4"), true);
  assert.equal(limiter.allow("1.2.3.4"), false);
  assert.equal(limiter.allow("1.2.3.4"), false);
});

test("different IPs have independent buckets", () => {
  const limiter = new MemoryRateLimiter({ limit: 2, windowMs: 60_000 });
  limiter.allow("a");
  limiter.allow("a");
  assert.equal(limiter.allow("a"), false);
  assert.equal(limiter.allow("b"), true);
  assert.equal(limiter.allow("b"), true);
  assert.equal(limiter.allow("b"), false);
});

test("window resets after the window elapses", async () => {
  const limiter = new MemoryRateLimiter({ limit: 1, windowMs: 200 });
  assert.equal(limiter.allow("ip"), true);
  assert.equal(limiter.allow("ip"), false);
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(limiter.allow("ip"), true);
});

test("reset clears all buckets", () => {
  const limiter = new MemoryRateLimiter({ limit: 1, windowMs: 60_000 });
  limiter.allow("ip");
  assert.equal(limiter.allow("ip"), false);
  limiter.reset();
  assert.equal(limiter.allow("ip"), true);
});

test("rateLimitConfig: absent/garbage falls back to the production default", () => {
  assert.deepEqual(rateLimitConfig(undefined), { limit: 60, windowMs: 60_000 });
  assert.deepEqual(rateLimitConfig(""), { limit: 60, windowMs: 60_000 });
  assert.deepEqual(rateLimitConfig("abc"), { limit: 60, windowMs: 60_000 });
  assert.deepEqual(rateLimitConfig("0"), { limit: 60, windowMs: 60_000 });
  assert.deepEqual(rateLimitConfig("-5"), { limit: 60, windowMs: 60_000 });
  assert.deepEqual(rateLimitConfig("60.5"), { limit: 60, windowMs: 60_000 });
});

test("rateLimitConfig: valid positive integer overrides the limit, same window", () => {
  assert.deepEqual(rateLimitConfig("10000"), { limit: 10000, windowMs: 60_000 });
  assert.deepEqual(rateLimitConfig("120"), { limit: 120, windowMs: 60_000 });
});

test("isRateLimitedPath covers dynamic upstream routes only", () => {
  // Dynamic routes that can hit the origin/upstream on a cache miss: rate limited.
  assert.equal(isRateLimitedPath("/api/health"), true);
  assert.equal(isRateLimitedPath("/api/search?q=x"), true);
  assert.equal(isRateLimitedPath("/api/movie/it-1927"), true);
  assert.equal(isRateLimitedPath("/movie/it-1927"), true);
  assert.equal(isRateLimitedPath("/sitemap.xml"), true);
  // Static assets served from the CDN: never throttled.
  assert.equal(isRateLimitedPath("/"), false);
  assert.equal(isRateLimitedPath("/about"), false);
  assert.equal(isRateLimitedPath("/css/style.css"), false);
  assert.equal(isRateLimitedPath("/js/app.js"), false);
  assert.equal(isRateLimitedPath("/favicon.svg"), false);
  assert.equal(isRateLimitedPath("/robots.txt"), false);
});
