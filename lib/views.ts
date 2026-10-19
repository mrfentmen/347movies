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
 *     (optional when the binding exists, one JSON day-blob per day). Every layer is written
 *     best-effort with a read-modify-write, so increments can be lost under concurrency —
 *     fine for an approximate counter; reads take the larger of the layers so no reported
 *     view is ever double-counted and a layer that missed a race never undercounts the
 *     final total.
 * The privacy page discloses all of this (public/privacy.html, "The page-view counter").
 */
import type { KVNamespace } from "@cloudflare/workers-types";
import type { Env } from "./env.ts";
import { edgeCacheMatch, edgeCachePut } from "./edge-cache.ts";

/**
 * KV key prefix — bump the version to reset the counter intentionally.
 *
 * v2 (2026-10-19) is the day-blob layout: ONE key per day holding every bucket as JSON.
 * v1 wrote one key per day AND one per (day, bucket) and read them back one at a time, so
 * a GET /api/views?days=7 did 189 sequential KV reads (~8s, and ~30s for the 30-day
 * window) — slow enough that the endpoint timed out under the smoke suite. v1 keys are
 * ignored, not migrated: the counter is approximate by design and the doc above says a
 * prefix bump is how a reset is made intentional.
 */
const KV_PREFIX = "views:v2:";
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
  "/ted",
  "/sports",
  "/shorts",
  "/silents",
  "/publictv",
  "/science",
  "/govfilms",
  "/audiobooks",
  "/records",
  "/ephemera",
  "/space",
  "/footage",
  "/shortfilms",
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

/** One day's counted buckets as a map (the shared payload shape across layers). */
type DayCounts = Map<CountedPath, number>;

/** Parse a JSON object of bucket -> count into a DayCounts map (shared by the KV layer). */
function dayCountsFromJson(body: Record<string, unknown>): DayCounts {
  const out: DayCounts = new Map();
  for (const bucket of COUNTED_PATHS) {
    const raw = body[bucket];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (Number.isFinite(n) && n > 0) out.set(bucket, Math.trunc(n));
  }
  return out;
}

/** Read one day from the edge Cache API (one key per day holds the whole day as JSON). */
async function cacheReadDay(date: string): Promise<DayCounts | null> {
  try {
    const res = await edgeCacheMatch(CACHE_BASE + date);
    if (!res) return null;
    const out = dayCountsFromJson((await res.json()) as Record<string, unknown>);
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

/** Read one day's bucket counts from KV, or null when the binding is absent or the read fails. */
async function kvReadDay(kv: KVNamespace | undefined, date: string): Promise<DayCounts | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(`${KV_PREFIX}d:${date}`);
    if (raw === null) return null;
    const out = dayCountsFromJson(JSON.parse(raw) as Record<string, unknown>);
    return out.size > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort KV increment of one day (read-modify-write of the day blob; a lost race is an
 * acceptable approximate error). One read + one write per report — the same as the cache
 * layer, so the two layers cost the same.
 */
async function kvBumpDay(kv: KVNamespace, date: string, bucket: CountedPath): Promise<void> {
  const cur = (await kvReadDay(kv, date)) ?? new Map<CountedPath, number>();
  cur.set(bucket, (cur.get(bucket) ?? 0) + 1);
  const payload: Record<string, number> = {};
  for (const [b, c] of cur) payload[b] = c;
  await kv.put(`${KV_PREFIX}d:${date}`, JSON.stringify(payload));
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
      await kvBumpDay(env.MOVIES_KV, date, bucket);
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

  // One cache read and one KV read per day, fetched in parallel — the loops below are pure
  // arithmetic. Awaiting per (day, bucket) instead is what made this endpoint time out:
  // the default 7-day window cost 189 sequential KV round-trips (~8s) and a 30-day window
  // 810 (~30s), measured 2026-10-19 against the production KV namespace.
  const dates = Array.from({ length: n }, (_, i) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return dayKey(d);
  });
  const layers = await Promise.all(
    dates.map(async (date) => ({
      date,
      cached: await cacheReadDay(date),
      kv: await kvReadDay(env.MOVIES_KV, date),
    })),
  );

  for (const { date, cached, kv } of layers) {
    const mem = memory.get(date);
    let dayTotal = 0;
    for (const bucket of COUNTED_PATHS) {
      const count = Math.max(
        mem?.get(bucket) ?? 0,
        cached?.get(bucket) ?? 0,
        kv?.get(bucket) ?? 0,
      );
      if (count > 0) {
        dayTotal += count;
        stats.byPath[bucket] = (stats.byPath[bucket] ?? 0) + count;
      }
    }
    stats.days.push({ date, views: dayTotal });
    stats.total += dayTotal;
  }
  return stats;
}
