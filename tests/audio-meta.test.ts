/**
 * UNIT tests for the audio-card enrichment (lib/audio-meta.ts): episode/track counting
 * from the metadata files array, series-tag derivation, and the fetch-through enrichment
 * loop (including the non-audio no-op). Mocked fetch — fast and deterministic; the edge
 * cache is a no-op under Node (edgeCacheMatch returns null), so these tests exercise the
 * pure derivation paths plus the fetch-through enrichment loop.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichAudioCardMeta, episodeCountFromFiles, seriesTagFromMeta } from "../lib/audio-meta.ts";

/** The minimal record shape the enrichment accepts (identifier + title). */
type CardRecord = { identifier: string; title: string; episodeCount?: number | null; seriesTag?: string | null };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/* A realistic OTR metadata `files` array: one episode = one VBR MP3 + Ogg + PNG siblings,
   plus the low-bitrate _64kb duplicates and container files. */
const OTR_FILES = [
  { name: "Suspense_ep01.mp3", format: "VBR MP3" },
  { name: "Suspense_ep01.ogg", format: "Ogg Vorbis" },
  { name: "Suspense_ep01.png", format: "PNG" },
  { name: "Suspense_ep01_64kb.mp3", format: "64Kbps MP3" },
  { name: "Suspense_ep02.mp3", format: "VBR MP3" },
  { name: "Suspense_ep02.ogg", format: "Ogg Vorbis" },
  { name: "Suspense_ep02_64kb.mp3", format: "64Kbps MP3" },
  { name: "Suspense_archive.torrent", format: "Archive BitTorrent" },
  { name: "Suspense_meta.xml", format: "Metadata" },
  { name: "__ia_thumb.jpg", format: "Item Tile" },
];

test("episodeCountFromFiles counts VBR MP3s and skips _64kb duplicates + non-audio files", () => {
  assert.equal(episodeCountFromFiles(OTR_FILES), 2);
  assert.equal(episodeCountFromFiles([{ name: "x_64kb.mp3", format: "64Kbps MP3" }]), null, "only low-bitrate: no playable count");
  assert.equal(episodeCountFromFiles([{ name: "cover.png", format: "PNG" }, { name: "x.torrent", format: "Archive BitTorrent" }]), null, "no audio at all");
  assert.equal(episodeCountFromFiles(undefined), null);
  assert.equal(episodeCountFromFiles([]), null);
});

test("episodeCountFromFiles skips _128kb duplicates too (LibriVox carries VBR+128kb+64kb per chapter)", () => {
  // LibriVox: one chapter = VBR + 128kb + 64kb mp3s. Counting only VBR gives the real chapter count.
  const LIBRIVOX_CHAPTERS = [
    { name: "book_00_preface.mp3", format: "VBR MP3" },
    { name: "book_00_preface_128kb.mp3", format: "128Kbps MP3" },
    { name: "book_00_preface_64kb.mp3", format: "64Kbps MP3" },
    { name: "book_01_chapter.mp3", format: "VBR MP3" },
    { name: "book_01_chapter_128kb.mp3", format: "128Kbps MP3" },
    { name: "book_01_chapter_64kb.mp3", format: "64Kbps MP3" },
  ];
  assert.equal(episodeCountFromFiles(LIBRIVOX_CHAPTERS), 2, "three derivatives per chapter count as one");
  // OTR/music items never carry the 128kb suffix, so the extra skip is a no-op for them.
  assert.equal(episodeCountFromFiles(OTR_FILES), 2, "OTR VBR+64kb pattern still counts correctly");
});

test("episodeCountFromFiles counts a single-episode item as 1", () => {
  assert.equal(episodeCountFromFiles([{ name: "TheThirdMan13-06-07.mp3", format: "VBR MP3" }, { name: "TheThirdMan13-06-07.ogg", format: "Ogg Vorbis" }]), 1);
});

test("episodeCountFromFiles falls back to ogg derivatives when an item has no mp3s", () => {
  const oggOnly = [
    { name: "show_ep01.ogg", format: "Ogg Vorbis" },
    { name: "show_ep01.png", format: "PNG" },
    { name: "show_ep02.ogg", format: "Ogg Vorbis" },
    { name: "show_archive.torrent", format: "Archive BitTorrent" },
  ];
  assert.equal(episodeCountFromFiles(oggOnly), 2);
  assert.equal(episodeCountFromFiles([{ name: "video_only.mp4", format: "h.264" }]), null, "video-only item: no chip");
});

test("seriesTagFromMeta: OTR prefers the series field", () => {
  const meta = { series: "Suspense", title: "Suspense - Single Episodes" };
  assert.equal(seriesTagFromMeta(meta, "Suspense - Single Episodes", "otr"), "Suspense");
});

test("seriesTagFromMeta: OTR falls back to the title prefix before the first separator", () => {
  assert.equal(seriesTagFromMeta({}, "Suspense - Single Episodes", "otr"), "Suspense");
  assert.equal(seriesTagFromMeta({}, "The Lone Ranger - Single Episodes", "otr"), "The Lone Ranger");
  // No separator: the title IS the series — return null so the card doesn't duplicate it.
  assert.equal(seriesTagFromMeta({}, "The Third Man", "otr"), null);
  // An empty prefix (title starts with a dash) is not a useful tag.
  assert.equal(seriesTagFromMeta({}, "- Something", "otr"), null);
});

test("seriesTagFromMeta: music uses the creator (artist)", () => {
  assert.equal(seriesTagFromMeta({ creator: "David Gans" }, "David Gans Live at David's Home Studio", "music"), "David Gans");
  assert.equal(seriesTagFromMeta({ series: "Grateful Dead" }, "Some Show", "music"), "Grateful Dead", "series wins over creator");
  assert.equal(seriesTagFromMeta({}, "No Creator", "music"), null);
});

test("enrichAudioCardMeta fetches per item and attaches episodeCount + seriesTag", async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url.includes("/metadata/suspense-series")) {
      return jsonResponse({ metadata: { title: "Suspense - Single Episodes", series: "Suspense" }, files: OTR_FILES });
    }
    if (url.includes("/metadata/third-man")) {
      return jsonResponse({ metadata: { title: "The Third Man" }, files: [{ name: "TheThirdMan13-06-07.mp3", format: "VBR MP3" }] });
    }
    if (url.includes("/metadata/david-gans")) {
      return jsonResponse({ metadata: { title: "Live Show", creator: "David Gans" }, files: [{ name: "track01.mp3", format: "VBR MP3" }, { name: "track01_64kb.mp3", format: "64Kbps MP3" }] });
    }
    return jsonResponse({ metadata: {}, files: [] });
  };

  const otrRecords: CardRecord[] = [
    { identifier: "suspense-series", title: "Suspense - Single Episodes" },
    { identifier: "third-man", title: "The Third Man" },
  ];
  await enrichAudioCardMeta(otrRecords, "otr", fetchImpl);

  assert.equal(otrRecords[0]?.episodeCount, 2);
  assert.equal(otrRecords[0]?.seriesTag, "Suspense");
  assert.equal(otrRecords[1]?.episodeCount, 1);
  assert.equal(otrRecords[1]?.seriesTag, null, "no separator -> no series tag");

  const musicRecords: CardRecord[] = [
    { identifier: "david-gans", title: "Live Show" },
  ];
  await enrichAudioCardMeta(musicRecords, "music", fetchImpl);

  assert.equal(musicRecords[0]?.episodeCount, 1, "_64kb duplicate skipped");
  assert.equal(musicRecords[0]?.seriesTag, "David Gans");
  assert.equal(calls.length, 3, "one metadata fetch per identifier");
});

test("enrichAudioCardMeta is a no-op for non-audio variants (no fetches, fields stay null)", async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return jsonResponse({ metadata: { title: "A Film" }, files: [] });
  };
  const records: CardRecord[] = [
    { identifier: "some-film", title: "A Film" },
    { identifier: "some-tv-show", title: "A TV Show" },
  ];
  for (const variant of ["films", "tv", "anime", "cartoons"] as const) {
    await enrichAudioCardMeta(records, variant, fetchImpl);
  }
  assert.equal(calls.length, 0, "non-audio variants never touch archive.org");
  assert.equal(records[0]?.episodeCount, undefined, "fields untouched for non-audio variants");
  assert.equal(records[1]?.seriesTag, undefined);
});

test("enrichAudioCardMeta survives an upstream failure (best-effort, never rejects)", async () => {
  const fetchImpl = async (): Promise<Response> => {
    throw new Error("upstream down");
  };
  const records: CardRecord[] = [
    { identifier: "whatever", title: "Whatever" },
  ];
  await enrichAudioCardMeta(records, "otr", fetchImpl);
  assert.equal(records[0]?.episodeCount, null);
  assert.equal(records[0]?.seriesTag, null);
});

test("enrichAudioCardMeta is bounded by the deadline even when fetches run past it (the pass races the deadline)", async () => {
  // A straggler that settles at ~400ms. A 404 (never retried, per fetchWithRetry) keeps it
  // fast: without the pass-level race, Promise.all would hold the caller for the full
  // 400ms; the race must return at ~deadlineMs (100ms) instead. The straggler settles
  // quickly enough that its internal timers are cleared — no leaked handles slow the suite.
  const fetchImpl = async (): Promise<Response> => {
    await new Promise((r) => setTimeout(r, 400));
    return jsonResponse({}, 404);
  };
  const records: CardRecord[] = [
    { identifier: "slow-1", title: "Slow 1" },
    { identifier: "slow-2", title: "Slow 2" },
  ];
  const started = Date.now();
  await enrichAudioCardMeta(records, "otr", fetchImpl, 100);
  const elapsed = Date.now() - started;
  // 100ms deadline, 400ms stragglers: a bounded pass returns <300ms; an unbounded one
  // (waiting for the straggler + retry) would take ~1s.
  assert.ok(elapsed < 300, `enrichment returned after ${elapsed}ms — the deadline did not bound the pass`);
  // In-flight fetches were abandoned, so nothing was attached; fields stay explicitly null.
  assert.equal(records[0]?.episodeCount, null);
  assert.equal(records[0]?.seriesTag, null);
  assert.equal(records[1]?.episodeCount, null);
});
