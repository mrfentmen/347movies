import assert from "node:assert/strict";
import { test } from "node:test";
import { searchCreativeCommonsVideos } from "../lib/youtube.ts";

test("searchCreativeCommonsVideos normalizes a CC search response into embeddable videos", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            id: { videoId: "abc123" },
            snippet: {
              title: "A Short Film",
              channelTitle: "Indie Channel",
              publishedAt: "2020-01-01T00:00:00Z",
              thumbnails: { medium: { url: "https://i.ytimg.com/vi/abc123/mqdefault.jpg" } },
            },
          },
          {
            // Item with no videoId is skipped (playlists/channels don't match type=video,
            // but the client stays defensive).
            id: { playlistId: "PLxyz" },
            snippet: { title: "Not a video" },
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const videos = await searchCreativeCommonsVideos("test-key", "short film", fetchImpl);
  assert.equal(videos.length, 1);
  const v = videos[0]!;
  assert.equal(v.id, "abc123");
  assert.equal(v.title, "A Short Film");
  assert.equal(v.channel, "Indie Channel");
  assert.equal(v.embedUrl, "https://www.youtube-nocookie.com/embed/abc123");
});

test("searchCreativeCommonsVideos returns [] on upstream failure (never throws)", async () => {
  const failFetch = (async () => new Response("rate limited", { status: 403 })) as typeof fetch;
  assert.deepEqual(await searchCreativeCommonsVideos("key", "q", failFetch), []);

  const throwFetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  assert.deepEqual(await searchCreativeCommonsVideos("key", "q", throwFetch), []);
});

test("searchCreativeCommonsVideos returns [] on malformed JSON", async () => {
  const badJson = (async () =>
    new Response("not json", { headers: { "Content-Type": "application/json" } })) as typeof fetch;
  assert.deepEqual(await searchCreativeCommonsVideos("key", "q", badJson), []);
});
