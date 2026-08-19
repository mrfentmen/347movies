/**
 * Privacy-respecting page-view counting (vow 5 / constitution §5: analytics, if added, must
 * be privacy-respecting — no cross-site tracking — and disclosed on the privacy page).
 *
 * The counter keeps ONE thing: an aggregate daily number per page bucket. It stores no IP,
 * no user agent, no cookie, no identifier, and no raw path — a view is a validated pathname
 * mapped onto a bounded set of buckets (all `/movie/*` paths collapse to one bucket, so an
 * unbounded set of paths can never grow the store). The numbers feed the advertise page's
 * audience stats and are deliberately approximate:
 *   - a view = one JavaScript-enabled page load that reported its path (no-JS visitors and
 *     bots that don't run the bundle aren't counted),
 *   - the store is a three-layer stack: an in-isolate memory Map (exact per-isolate, resets
 *     on redeploy), the Cloudflare edge Cache API (the default cross-isolate layer — one
 *     tiny key per day, ~31-day TTL, no permissions needed, works today), and MOVIES_KV
 *     (optional when the binding exists). Every layer is written best-effort with a
 *     read-modify-write, so increments can be lost under concurrency — fine for an
 *     approximate counter; reads take the larger of the layers so no reported view is ever
 *     double-counted and a layer that missed a race never undercounts the final total.
 * The privacy page discloses all of this (public/privacy.html, "The page-view counter").
 */
import type { KVNamespace } from "@cloudflare/workers-types";
import type { Env } from "./env.ts";
import { edgeCacheMatch, edgeCachePut } from "./edge-cache.ts";

/** KV key prefix — bump the version to reset the counter intentionally. */
const KV_PREFIX = "views:v1:";
/** Edge-cache key base (synthetic internal URL, never served to the public). */
const CACHE_BASE = "https://347movies.internal/views/v1/";
/** Edge-cache TTL: 31 days so the full 30-day stats window survives. */
const CACHE_TTL_SECONDS = 31 * 24 * 60 * 60;
/** Cap on a reported pathname before validation (query/hash stripped first). */
const MAX_PATH_LEN = 200;

/**
 * The bounded set of counted page buckets. Anything not in this set (about, privacy, terms,
 * unknown routes, unroutable junk) is NOT counted — deliberately: privacy pages and the
 * advertise page's own stats stay out of the audience numbers, and an attacker can only
 * ever bump one of these twenty-one keys, never an arbitrary string.
 *
 * Every catalog destination is a bucket: the audience stats on the advertise page must
 * reflect traffic to all fourteen pools, not just the original six. Added 2026-08-19:
 * /documentaries, /sports, /shorts, /silents, /publictv, /science, /govfilms, /audiobooks,
 * and /collections.
 */
export const COUNTED_PATHS = [
  "/",
  "/browse",
  "/search",
  "/genre",
  "/watchlist",
  "/tv",
  "/anime",
  "/cartoons",
  "/otr",
  "/music",
  "/documentaries",
  "/sports",
  "/shorts",
  "/silents",
  "/publictv",
  "/science",
  "/govfilms",
  "/audiobooks",
  "/records",
  "/ephemera",
  "/collections",
  "/advertise",
  "/movie",
] as const;
export type CountedPath = (typeof COUNTED_PATHS)[number];

/**
 * Map a raw pathname onto a counted bucket, or "" when it must not be counted.
 * Strips the query and hash, collapses trailing slashes, and collapses every movie detail
 * path (`/movie/<identifier>`) into the single "/movie" bucket.
 */
export function normalizeCountedPath(pathname: string): CountedPath | "" {
  if (typeof pathname !== "string") return "";
  let path = (pathname.split("?")[0] ?? "").split("#")[0] ?? "";
  if (path.length === 0 || path.length > MAX_PATH_LEN) return "";
  if (!path.startsWith("/")) return "";
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "/movie" || path.startsWith("/movie/")) return "/movie";
  return (COUNTED_PATHS as readonly string[]).includes(path) ? (path as CountedPath) : "";
}

/** UTC calendar day key (YYYY-MM-DD) — the daily bucket granularity. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** In-memory store: date -> (bucket -> count). Per-isolate; resets on redeploy. */
const memory = new Map<string, Map<string, number>>();

function memoryDay(date: string): Map<string, number> {
  let day = memory.get(date);
  if (!day) {
    day = new Map();
    memory.set(date, day);
  }
  return day;
}

/** Test-only seam: clears the in-memory layer (never called by production code). */
export function _resetViewsForTests(): void {
  memory.clear();
}

/** Best-effort KV increment (read-modify-write; a lost race is an acceptable approximate error). */
async function kvBump(kv: KVNamespace, key: string): Promise<void> {
  const raw = await kv.get(key);
  const prev = raw ? parseInt(raw, 10) : 0;
  await kv.put(key, String(Number.isFinite(prev) ? prev + 1 : 1));
}

/** One day's counted buckets as a map (the shared payload shape across layers). */
type DayCounts = Map<CountedPath, number>;

/** Read one day from the edge Cache API (one key per day holds the whole day as JSON). */
async function cacheReadDay(date: string): Promise<DayCounts | null> {
  try {
    const res = await edgeCacheMatch(CACHE_BASE + date);
    if (!res) return null;
    const body = (await res.json()) as Record<string, unknown>;
    const out: DayCounts = new Map();
    for (const bucket of COUNTED_PATHS) {
      const raw = body[bucket];
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
      if (Number.isFinite(n) && n > 0) out.set(bucket, Math.trunc(n));
    }
    return out.size > 0 ? out : null;
  } catch {
    return null; // a cache miss/failure is an optimization miss, never an error
  }
}

/** Best-effort edge-cache increment of one day's bucket (read-modify-write). */
async function cacheBumpDay(date: string, bucket: CountedPath): Promise<void> {
  try {
    const cur = (await cacheReadDay(date)) ?? new Map();
    cur.set(bucket, (cur.get(bucket) ?? 0) + 1);
    const payload: Record<string, number> = {};
    for (const [b, c] of cur) payload[b] = c;
    const res = new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
    await edgeCachePut(CACHE_BASE + date, res, CACHE_TTL_SECONDS);
  } catch {
    /* counters are approximate; a cache hiccup never fails the request */
  }
}

/** Read a KV counter, or null when the binding is absent or the read fails. */
async function kvRead(kv: KVNamespace | undefined, key: string): Promise<number | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Record one page view. Returns true when the pathname was counted (validated + bucketed),
 * false when it was ignored. Never throws: a KV failure is swallowed (the counter is
 * approximate by design, and a report must never fail a page load).
 */
export async function recordPageView(env: Env, pathname: string, now: Date = new Date()): Promise<boolean> {
  const bucket = normalizeCountedPath(pathname);
  if (!bucket) return false;
  const date = dayKey(now);

  // Memory first: the exact per-isolate count.
  const day = memoryDay(date);
  day.set(bucket, (day.get(bucket) ?? 0) + 1);

  // Best-effort persistence: the edge Cache API (default, works without KV permissions)
  // and, when the binding exists, KV. Both are fire-and-forget — a hiccup never fails a
  // page load, and a lost race is an acceptable approximate error.
  await cacheBumpDay(date, bucket);
  if (env.MOVIES_KV) {
    try {
      await kvBump(env.MOVIES_KV, `${KV_PREFIX}d:${date}`);
      await kvBump(env.MOVIES_KV, `${KV_PREFIX}p:${date}:${bucket}`);
    } catch {
      /* counters are approximate; a KV hiccup never fails the request */
    }
  }
  return true;
}

export interface ViewStats {
  /** The requested window (clamped 1–30). */
  windowDays: number;
  /** Per-day totals, oldest first. */
  days: Array<{ date: string; views: number }>;
  /** Sum over the window. */
  total: number;
  /** Per-bucket totals over the window (only buckets with views). */
  byPath: Record<string, number>;
}

/**
 * Read the last `days` days of aggregate counts (clamped 1–30). For each date/bucket the
 * larger of the three layers wins — memory is exact per-isolate, the edge cache is the
 * cross-isolate view, KV is the optional extra — and any layer may exceed another (lost
 * RMW races, unbound KV, evicted cache), so max() preserves the most counts without ever
 * double-counting a single report.
 */
export async function getViewStats(env: Env, days = 7, now: Date = new Date()): Promise<ViewStats> {
  const n = Math.min(Math.max(1, Math.trunc(days)), 30);
  const stats: ViewStats = { windowDays: n, days: [], total: 0, byPath: {} };

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const date = dayKey(d);

    const mem = memory.get(date);
    const cached = await cacheReadDay(date);
    let dayTotal = 0;
    for (const bucket of COUNTED_PATHS) {
      const memCount = mem?.get(bucket) ?? 0;
      const cacheCount = cached?.get(bucket) ?? 0;
      const kvCount = await kvRead(env.MOVIES_KV, `${KV_PREFIX}p:${date}:${bucket}`);
      const count = Math.max(memCount, cacheCount, kvCount ?? 0);
      if (count > 0) {
        dayTotal += count;
        stats.byPath[bucket] = (stats.byPath[bucket] ?? 0) + count;
      }
    }
    // The daily total is the sum of the buckets (KV's `d:` key is redundant bookkeeping kept
    // for simple KV-side inspection, not read here — the buckets are the source of truth).
    stats.days.push({ date, views: dayTotal });
    stats.total += dayTotal;
  }
  return stats;
}
