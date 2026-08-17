/**
 * KV cache helpers. The cache is an optimization only — a cache miss or cache failure never
 * blocks the site (the upstream archive.org call is always the source of truth).
 */
export interface CacheBackend {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Spec: results cached with a 24h TTL. */
export const CACHE_TTL_SECONDS = 60 * 60 * 24;

/** Cache keys are built from validated inputs only (constitution §6). */
export function cacheKey(type: string, parts: Array<string | number>): string {
  return `${type}:${parts.map((p) => String(p)).join(":")}`;
}

export async function cacheGet(
  cache: CacheBackend | null | undefined,
  key: string,
): Promise<string | null> {
  if (!cache) return null;
  try {
    return await cache.get(key);
  } catch (err) {
    console.warn(`cache get failed for ${key}`, err);
    return null;
  }
}

export async function cachePut(
  cache: CacheBackend | null | undefined,
  key: string,
  value: unknown,
  ttlSeconds: number = CACHE_TTL_SECONDS,
): Promise<void> {
  if (!cache) return;
  try {
    await cache.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch (err) {
    console.warn(`cache put failed for ${key}`, err);
  }
}
