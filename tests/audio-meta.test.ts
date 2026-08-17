/**
 * UNIT tests for the audio-card enrichment (lib/audio-meta.ts): episode/track counting
 * from the metadata files array and series-tag derivation. Mocked fetch — fast and
 * deterministic; the edge cache is a no-op under Node (edgeCacheMatch returns null), so
 * these tests exercise the pure derivation paths plus the fetch-through enrichment loop.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichAudioCardMeta, episodeCountFromFiles, seriesTagFromMeta } from "../lib/audio-meta.ts";

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

test("episodeCountFromFiles counts a single-episode item as 1", () => {
  assert.equal(episodeCountFromFiles([{ name: "TheThirdMan13-06-07.mp3", format: "VBR MP3" }, { name: "TheThirdMan13-06-07.ogg", format: "Ogg Vorbis" }]), 1);
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

  const otrRecords: Array<{ identifier: string; title: string; episodeCount?: number | null; seriesTag?: string | null }> = [
    { identifier: "suspense-series", title: "Suspense - Single Episodes" },
    { identifier: "third-man", title: "The Third Man" },
  ];
  await enrichAudioCardMeta(otrRecords, "otr", fetchImpl);

  assert.equal(otrRecords[0]?.episodeCount, 2);
  assert.equal(otrRecords[0]?.seriesTag, "Suspense");
  assert.equal(otrRecords[1]?.episodeCount, 1);
  assert.equal(otrRecords[1]?.seriesTag, null, "no separator -> no series tag");

  const musicRecords: Array<{ identifier: string; title: string; episodeCount?: number | null; seriesTag?: string | null }> = [
    { identifier: "david-gans", title: "Live Show" },
  ];
  await enrichAudioCardMeta(musicRecords, "music", fetchImpl);

  assert.equal(musicRecords[0]?.episodeCount, 1, "_64kb duplicate skipped");
  assert.equal(musicRecords[0]?.seriesTag, "David Gans");
  assert.equal(calls.length, 3, "one metadata fetch per identifier");
});

test("enrichAudioCardMeta survives an upstream failure (best-effort, never rejects)", async () => {
  const fetchImpl = async (): Promise<Response> => {
    throw new Error("upstream down");
  };
  const records: Array<{ identifier: string; title: string; episodeCount?: number | null; seriesTag?: string | null }> = [
    { identifier: "whatever", title: "Whatever" },
  ];
  await enrichAudioCardMeta(records, "otr", fetchImpl);
  assert.equal(records[0]?.episodeCount, null);
  assert.equal(records[0]?.seriesTag, null);
});
