/**
 * Per-IP rate limiter (in-memory, per worker isolate). A sliding window keyed by client IP.
 *
 * Design note (recorded in changelog): KV-backed rate limiting would bill a KV write per
 * request; an in-memory window is $0 and exact for a single isolate, which is the right
 * trade-off for this site's scale. If the site ever runs many isolates concurrently this
 * should move to Durable Objects — flagged in the changelog.
 */
export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { limit: 60, windowMs: 60_000 };

/**
 * Resolve the limiter config from an optional env override. The smoke suite intentionally
 * issues well over 60 rate-limited requests per run (it is the project's full health check),
 * so a single-isolate dev/CI server at the production default 429s mid-run and the suite
 * misreads it as a regression. Production stays at the default (60/min, CDN absorbs most
 * traffic); dev/CI pass `RATE_LIMIT` (e.g. wrangler pages dev --var RATE_LIMIT:10000) so the
 * health gate never trips the very limiter it tests. Garbage/non-positive values fail safe
 * to the default — an operator error must not weaken production rate limiting.
 */
export function rateLimitConfig(raw: string | undefined): RateLimitConfig {
  if (raw === undefined || raw.trim() === "") return DEFAULT_RATE_LIMIT;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1) return DEFAULT_RATE_LIMIT;
  return { limit: n, windowMs: DEFAULT_RATE_LIMIT.windowMs };
}

/**
 * Paths that trigger per-IP rate limiting: every route that can hit the origin/upstream
 * (archive.org) on a cache miss. Static assets (pages, css, js, images) are served from the
 * CDN and are NOT rate-limited.
 */
export const RATE_LIMITED_PATH_PREFIXES = ["/api/", "/movie/"];
export const RATE_LIMITED_PATH_EXACT = ["/sitemap.xml"];

export function isRateLimitedPath(pathname: string): boolean {
  return (
    RATE_LIMITED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    RATE_LIMITED_PATH_EXACT.includes(pathname)
  );
}

interface Bucket {
  count: number;
  windowStart: number;
}

const MAX_BUCKETS = 2000;

export class MemoryRateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  allow(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.config.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      this.prune(now);
      return true;
    }
    if (bucket.count >= this.config.limit) return false;
    bucket.count += 1;
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(now: number): void {
    if (this.buckets.size <= MAX_BUCKETS) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.config.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
