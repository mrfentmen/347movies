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
 * optimization-not-source-of-truth philosophy as lib/views.ts).
 */
import { fetchMetadata } from "./archive.ts";
import { edgeCacheMatch, edgeCachePut } from "./edge-cache.ts";
import { asString } from "./normalize.ts";
import type { IndexVariant } from "./archive.ts";

/** Synthetic edge-cache key base (never served to the public). */
const CACHE_BASE = "https://347movies.internal/audio-meta/v1/";
/** 24h per-identifier cache TTL. */
const CACHE_TTL_SECONDS = 24 * 60 * 60;
/** Parallel metadata fetches per enrichment batch — bounded so a cold page stays quick. */
const MAX_CONCURRENT = 6;

export interface AudioCardMeta {
  /** Number of playable episodes/tracks (.mp3 derivatives), or null when unknown. */
  episodeCount: number | null;
  /** Series/artist tag for the card chip, or null when nothing honest is derivable. */
  seriesTag: string | null;
}

/**
 * Episode/track count from the raw metadata `files` array: count of `.mp3` names, skipping
 * the low-bitrate `_64kb` duplicates (each episode has one VBR MP3; the Ogg/PNG/spectrogram
 * siblings are the same episode in other formats). Returns null when no playable count is
 * derivable (no mp3s — e.g. a video-only item inside the music pool).
 */
export function episodeCountFromFiles(files: unknown[] | undefined): number | null {
  if (!Array.isArray(files)) return null;
  let count = 0;
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const name = String((f as Record<string, unknown>)["name"] ?? "");
    if (!/\.mp3$/i.test(name)) continue;
    if (/64kb/i.test(name)) continue;
    count += 1;
  }
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
    const episodeCount =
      typeof body["episodeCount"] === "number" && Number.isFinite(body["episodeCount"])
        ? (body["episodeCount"] as number)
        : null;
    const seriesTag = typeof body["seriesTag"] === "string" ? (body["seriesTag"] as string) : null;
    if (episodeCount === null && seriesTag === null) return null;
    return { episodeCount, seriesTag };
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
 * to each record, fetched per identifier (edge-cached 24h) with a bounded concurrency cap.
 * Best-effort: a failure leaves the fields null and never rejects.
 */
export async function enrichAudioCardMeta(
  records: Array<{ identifier: string; title: string; episodeCount?: number | null; seriesTag?: string | null }>,
  variant: "otr" | "music",
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (records.length === 0) return;
  let index = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, records.length) }, async () => {
    while (true) {
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
  await Promise.all(workers);
}
