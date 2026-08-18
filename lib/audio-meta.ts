/**
 * Card enrichment for the audio pools (Old Time Radio, Music & Concerts): an episode/track
 * count and a series tag shown on grid cards. The honest numbers live ONLY in per-item
 * metadata — the bulk search/index APIs expose no playable-file count (`files_count` counts
 * every file: covers, spectrograms, torrents, metadata — a 13-episode item reports 45), so
 * this module reads `fetchMetadata` per identifier exactly like the detail page does, and
 * caches the tiny result per identifier in the edge Cache API (24h TTL) so the first page
 * load pays the fetches and every later one is free.
 *
 * Everything here is best-effort and never fails the page: a fetch failure or a cache
 * hiccup leaves the card without a chip rather than breaking the grid (the same
 * optimization-not-source-of-truth philosophy as lib/views.ts). The non-audio pools
 * (films/tv/anime/cartoons) are a no-op by construction — callers pass their `IndexVariant`
 * and this module ignores anything that isn't otr/music.
 */
import { fetchMetadata } from "./archive.ts";
import { edgeCacheMatch, edgeCachePut } from "./edge-cache.ts";
import { asString } from "./normalize.ts";
import type { IndexVariant } from "./archive.ts";
import type { MovieRecord } from "./normalize.ts";

/** Synthetic edge-cache key base (never served to the public). */
const CACHE_BASE = "https://347movies.internal/audio-meta/v1/";
/** 24h per-identifier cache TTL. */
const CACHE_TTL_SECONDS = 24 * 60 * 60;
/**
 * Parallel metadata fetches per enrichment batch. Each `fetchMetadata` call is individually
 * bounded (15s request timeout + one retry), so the wall-clock deadline below is what keeps
 * the whole pass from stacking waves of slow fetches into a minute-plus page hold.
 */
const MAX_CONCURRENT = 12;
/**
 * Wall-clock deadline for one enrichment pass. The chip is an enhancement; the grid is the
 * content — so the page must never be held for it. Measured 2026-08-17 with a truly cold
 * page (both caches empty, archive.org degraded): 24 fetches took 14.2s and chipped only
 * 10/24 cards, i.e. the last ~6s bought almost nothing. A healthy fleet resolves all 24 in
 * ~2-4s, so the 8s cap never binds on a good day; on a bad one it stops launching new
 * fetches at 8s and whatever completed gets attached (and cached per identifier). The rest
 * stay null and self-heal on a later load as the per-identifier cache warms.
 */
const ENRICH_DEADLINE_MS = 8000;

/**
 * A promise that resolves after ms — with a `clear` that cancels its timer. The deadline
 * race below needs this: Promise.race leaves the LOSING timer armed, so a fast pass that
 * wins in 11ms would otherwise hold an 8s timeout (and the test process with it) until it
 * fires. Clearing on the way out keeps a finished pass timer-free.
 */
function deadlineTimer(ms: number): { promise: Promise<void>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return {
    promise,
    clear: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

export interface AudioCardMeta {
  /** Number of playable episodes/tracks (mp3/ogg derivatives), or null when unknown. */
  episodeCount: number | null;
  /** Series/artist tag for the card chip, or null when nothing honest is derivable. */
  seriesTag: string | null;
}

/** Count playable audio derivatives of one extension, skipping low-bitrate duplicates. */
function countDerivatives(files: unknown[], extension: "mp3" | "ogg"): number {
  let count = 0;
  const suffix = new RegExp(`\\.${extension}$`, "i");
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const name = String((f as Record<string, unknown>)["name"] ?? "");
    if (!suffix.test(name)) continue;
    if (/64kb/i.test(name)) continue; // "_64kb.mp3" is a low-bitrate copy of the same episode
    count += 1;
  }
  return count;
}

/**
 * Episode/track count from the raw metadata `files` array. Each episode has exactly one VBR
 * MP3 (plus Ogg/PNG/spectrogram siblings — same episode, other formats), so counting `.mp3`
 * names gives the episode count; items without mp3s (rare ogg-only uploads) fall back to
 * `.ogg`. Returns null when nothing playable is derivable (e.g. a video-only item inside the
 * music pool) — the chip is then honestly absent.
 */
export function episodeCountFromFiles(files: unknown[] | undefined): number | null {
  if (!Array.isArray(files)) return null;
  const mp3 = countDerivatives(files, "mp3");
  const count = mp3 > 0 ? mp3 : countDerivatives(files, "ogg");
  return count > 0 ? count : null;
}

/**
 * Series tag for the card chip.
 *  - Old Time Radio: the `series` metadata field when present, else the title up to its
 *    first " - " separator ("Suspense - Single Episodes" -> "Suspense"); null when the
 *    title has no separator (the title IS the series — the card already shows it).
 *  - Music: the artist/band (`creator`), which is the series tag for a live recording.
 */
export function seriesTagFromMeta(
  meta: Record<string, unknown> | undefined,
  title: string,
  variant: IndexVariant,
): string | null {
  if (!meta) return null;
  const fromSeries = asString(meta["series"]);
  if (fromSeries) return fromSeries;
  if (variant === "music") {
    const creator = asString(meta["creator"]);
    return creator ?? null;
  }
  // OTR: "Suspense - Single Episodes" -> "Suspense". Only when a separator exists.
  const separator = title.search(/\s+[-–—]\s+/);
  if (separator <= 0) return null;
  const prefix = title.slice(0, separator).trim();
  return prefix.length > 0 && prefix.length < title.length ? prefix : null;
}

/**
 * Read one identifier's cached enrichment, or null on miss/failure.
 */
async function cacheRead(identifier: string): Promise<AudioCardMeta | null> {
  try {
    const res = await edgeCacheMatch(CACHE_BASE + encodeURIComponent(identifier));
    if (!res) return null;
    const body = (await res.json()) as Record<string, unknown>;
    // A cached {null, null} is a real result ("looked, nothing playable/taggable") — return
    // it so a video-only music item isn't refetched on every page load. The record's fields
    // are explicitly nulled, which the caller already defaults, so this is safe.
    return {
      episodeCount:
        typeof body["episodeCount"] === "number" && Number.isFinite(body["episodeCount"])
          ? (body["episodeCount"] as number)
          : null,
      seriesTag: typeof body["seriesTag"] === "string" ? (body["seriesTag"] as string) : null,
    };
  } catch {
    return null;
  }
}

async function cacheWrite(identifier: string, meta: AudioCardMeta): Promise<void> {
  try {
    const res = new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } });
    await edgeCachePut(CACHE_BASE + encodeURIComponent(identifier), res, CACHE_TTL_SECONDS);
  } catch {
    /* cache is an optimization; a failure never matters */
  }
}

/**
 * Enrich a list of card records for the audio pools: attach `episodeCount` and `seriesTag`
 * to each record, fetched per identifier (edge-cached 24h) with a bounded concurrency cap
 * and a wall-clock deadline. Best-effort: a failure leaves the fields null and never rejects.
 * Any non-audio variant (films, tv, anime, cartoons, documentaries, sports, shorts, silents) is a no-op.
 */
export async function enrichAudioCardMeta(
  records: Array<Pick<MovieRecord, "identifier" | "title"> & Partial<Pick<MovieRecord, "episodeCount" | "seriesTag">>>,
  variant: IndexVariant,
  fetchImpl: typeof fetch = fetch,
  deadlineMs: number = ENRICH_DEADLINE_MS,
): Promise<void> {
  if (variant !== "otr" && variant !== "music") return;
  if (records.length === 0) return;
  const deadline = Date.now() + deadlineMs;
  let index = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, records.length) }, async () => {
    while (true) {
      if (Date.now() > deadline) return; // bound the total pass; leftover cards stay null
      const i = index;
      index += 1;
      const record = records[i];
      if (!record) return;
      // Default to null so a failed fetch leaves an explicit "unknown" rather than undefined.
      if (record.episodeCount === undefined) record.episodeCount = null;
      if (record.seriesTag === undefined) record.seriesTag = null;
      try {
        const cached = await cacheRead(record.identifier);
        if (cached) {
          record.episodeCount = cached.episodeCount;
          record.seriesTag = cached.seriesTag;
          continue;
        }
        const meta = await fetchMetadata(record.identifier, fetchImpl);
        const result: AudioCardMeta = {
          episodeCount: episodeCountFromFiles(meta.files),
          seriesTag: seriesTagFromMeta(meta.metadata, record.title, variant),
        };
        record.episodeCount = result.episodeCount;
        record.seriesTag = result.seriesTag;
        await cacheWrite(record.identifier, result);
      } catch {
        // best-effort: no chip for this card, never fail the page
      }
    }
  });
  // Bound the PASS, not just the launches. Each fetchMetadata call carries its own ~15s
  // timeout + retry, so an in-flight fetch that started just before the deadline could
  // otherwise hold the response for 30s+ after it. Racing the whole pass against the
  // deadline makes ENRICH_DEADLINE_MS a hard cap on added latency: the response goes out
  // on time and the abandoned workers keep running in the background — their results still
  // land in the per-identifier cache, so the next load is warm. (The loop's launch gate
  // above stays: it stops STARTING fetches that the race would abandon anyway.) The
  // timer is cleared when the pass wins so a fast, fully-enriched pass leaves no handle.
  const cap = deadlineTimer(deadlineMs);
  await Promise.race([Promise.all(workers), cap.promise]);
  cap.clear();
}
