import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMovieNoVideo, renderMoviePage, renderMovieUnavailable } from "../lib/layout.ts";
import type { MovieRecord } from "../lib/normalize.ts";

const RECORD: MovieRecord = {
  identifier: "it-1927",
  title: "It (1927)",
  year: 1927,
  addeddate: "2025-01-17",
  description: "A silent classic.",
  genres: ["Romance"],
  subjects: ["Silent Films"],
  creators: ["Clarence G. Badger"],
  thumbnails: {
    small: "https://archive.org/download/it-1927/__ia_thumb.jpg",
    medium: "https://archive.org/services/img/it-1927",
    large: "https://archive.org/services/img/it-1927?width=1200",
  },
  runtime: "1:12:00",
  runtimeSeconds: 4320,
  license: "publicdomain",
  source_url: "https://archive.org/details/it-1927",
  hasVideo: true,
  videoFiles: [],
  hasAudio: false,
  audioFiles: [],
  server: null,
  dir: null,
  episodeCount: null,
  seriesTag: null,
};

test("renderMoviePage embeds the archive.org player for playable items", () => {
  const html = renderMoviePage(RECORD, "https://347movies.pages.dev", undefined);
  assert.ok(html.includes('src="https://archive.org/embed/it-1927"'), "player iframe present");
  assert.ok(html.includes("Public Domain"), "license chip shown");
});

test("renderMoviePage renders quality + server playback controls when derivatives exist", () => {
  const withFiles = {
    ...RECORD,
    videoFiles: [
      { name: "It  (1927).mp4", format: "h.264", label: "480p · HD · h.264 · 447 MB", size: 468262609, width: 618, height: 480, path: "It%20%20%281927%29.mp4" },
      { name: "It  (1927).mkv", format: "Matroska", label: "720p · Original · MKV · 877 MB", size: 919691750, width: 928, height: 720, path: "It%20%20%281927%29.mkv" },
    ],
    server: "dn600208.us.archive.org",
    dir: "/0/items/it-1927",
  };
  const html = renderMoviePage(withFiles, "https://347movies.pages.dev", undefined);
  assert.ok(html.includes('id="player-quality"'), "quality select present");
  assert.ok(html.includes("480p · HD · h.264"), "quality label shows resolution + size");
  assert.ok(html.includes('id="player-server"'), "server select present");
  assert.ok(html.includes('value="mirror"'), "mirror option present");
  assert.ok(html.includes('data-mirror="https://dn600208.us.archive.org/0/items/it-1927"'), "mirror base present");
  assert.ok(html.includes('data-path="It%20%20%281927%29.mp4"'), "default path present");
});

test("renderMoviePage omits quality select for a single derivative and mirror without server info", () => {
  const single = {
    ...RECORD,
    videoFiles: [
      { name: "It  (1927).mp4", format: "h.264", label: "480p · HD · h.264 · 447 MB", size: 468262609, width: 618, height: 480, path: "It%20%20%281927%29.mp4" },
    ],
  };
  const html = renderMoviePage(single, "https://347movies.pages.dev", undefined);
  assert.ok(!html.includes('id="player-quality"'), "no quality select for a single file");
  assert.ok(html.includes('id="player-server"'), "server select still present");
  assert.ok(!html.includes('value="mirror"'), "no mirror option without server/dir");
});

test("renderMoviePage renders no playback controls when there are no derivatives", () => {
  const html = renderMoviePage(RECORD, "https://347movies.pages.dev", undefined);
  assert.ok(!html.includes("player-tools"), "no controls without video files");
});

function videoNode(html: string): Record<string, unknown> {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("JSON-LD data block missing");
  const parsed = JSON.parse(m[1] as string) as { "@graph"?: Array<Record<string, unknown>> };
  const node = parsed["@graph"]?.find((n) => n["@type"] === "VideoObject");
  if (!node) throw new Error("VideoObject node missing from @graph");
  return node;
}

test("renderMoviePage emits honest VideoObject + BreadcrumbList JSON-LD with real data", () => {
  const html = renderMoviePage(RECORD, "https://347movies.pages.dev", undefined);
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, "JSON-LD data block present");
  const parsed = JSON.parse(m![1] as string) as { "@graph"?: Array<Record<string, unknown>> };
  const types = parsed["@graph"]?.map((n) => n["@type"]);
  assert.deepEqual(types, ["BreadcrumbList", "VideoObject"]);
  const video = videoNode(html);
  assert.equal(video["embedUrl"], "https://archive.org/embed/it-1927");
  assert.equal(video["uploadDate"], "2025-01-17");
  assert.equal(video["duration"], "PT1H12M");
  assert.equal(video["thumbnailUrl"], "https://archive.org/services/img/it-1927?width=1200");
  const crumb = parsed["@graph"]!.find((n) => n["@type"] === "BreadcrumbList") as { itemListElement?: Array<Record<string, unknown>> };
  assert.equal(crumb.itemListElement?.[0]?.["name"], "Home");
  assert.equal(crumb.itemListElement?.[1]?.["item"], "https://347movies.pages.dev/movie/it-1927");
});

test("renderMoviePage omits uploadDate/duration when the data is unavailable (never fabricates)", () => {
  const sparse = { ...RECORD, addeddate: null, runtimeSeconds: null };
  const html = renderMoviePage(sparse, "https://347movies.pages.dev", undefined);
  const video = videoNode(html);
  assert.equal(video["uploadDate"], undefined, "no fabricated upload date");
  assert.equal(video["duration"], undefined, "no fabricated duration");
});

test("renderMovieNoVideo explains honestly, links the source, and never embeds a player", () => {
  const noVideo = { ...RECORD, hasVideo: false };
  const html = renderMovieNoVideo(noVideo, "https://347movies.pages.dev");
  assert.ok(!html.includes("archive.org/embed/"), "no dead player iframe");
  assert.ok(html.includes("No playable video"), "honest heading");
  assert.ok(html.includes("https://archive.org/details/it-1927"), "source link present");
  assert.ok(html.includes('name="robots" content="noindex, follow"'), "noindex for search engines");
  assert.ok(html.includes('class="breadcrumb"'), "breadcrumb way out");
});

test("renderMovieUnavailable is noindex and shows the status", () => {
  const html = renderMovieUnavailable(404, "https://347movies.pages.dev");
  assert.ok(html.includes("<h1>404</h1>"), "status shown");
  assert.ok(html.includes('name="robots" content="noindex, follow"'), "noindex");
});

test("renderMovieUnavailable 502 explains an upstream outage honestly, never a legality problem", () => {
  const html = renderMovieUnavailable(502, "https://347movies.pages.dev", "chevrolet");
  assert.ok(html.includes("<h1>502</h1>"), "status shown");
  assert.ok(html.includes("upstream outage"), "calls it an outage");
  assert.ok(!html.includes("legally free"), "does not blame the license");
  assert.ok(html.includes("https://archive.org/details/chevrolet"), "source link as a way out");
  assert.ok(html.includes("Temporarily unavailable"), "honest title");
});

test("renderMovieUnavailable 404 keeps the legality message", () => {
  const html = renderMovieUnavailable(404, "https://347movies.pages.dev", "some-dark-item");
  assert.ok(html.includes("could not verify that it is legally free"), "404 explains the legal gate");
});

test("visible breadcrumb mirrors the JSON-LD BreadcrumbList (site-architecture pass)", () => {
  const html = renderMoviePage(RECORD, "https://347movies.pages.dev", undefined);
  // Visible trail: Home / <title>, with the current page marked aria-current.
  assert.ok(html.includes('<nav class="breadcrumb" aria-label="Breadcrumb">'), "breadcrumb nav present");
  assert.ok(html.includes('<a href="/">Home</a>'), "Home link present");
  assert.ok(html.includes('aria-current="page">It (1927)'), "current page marked with aria-current");
  // Structured data declares the same two-level trail (Home > It (1927)).
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const root = JSON.parse(m?.[1] ?? "{}") as { "@graph"?: Array<Record<string, unknown>> };
  const graph = (root["@graph"] ?? []) as Array<Record<string, unknown>>;
  const trail = graph.find((n) => n["@type"] === "BreadcrumbList");
  assert.ok(trail, "BreadcrumbList node present");
  const items = trail?.["itemListElement"] as Array<Record<string, unknown>>;
  assert.equal(items.length, 2, "two levels: Home + film");
});

test("hostile archive.org metadata is escaped — year cannot inject HTML (stored-XSS class, fixed 2026-08-16)", () => {
  // year is raw archive.org metadata (untrusted third-party input). It is rendered in
  // two places on the SSR page (year chip + year suffix); both must escape it.
  const hostile = "<img src=x onerror=alert(1)>";
  // Cast through unknown: the runtime must survive even a hostile non-numeric year
  // (normalize coerces to number today; the renderer guards the boundary regardless).
  const html = renderMoviePage(
    { ...RECORD, year: hostile as unknown as number },
    "https://347movies.pages.dev",
    undefined,
  );
  assert.ok(!html.includes(hostile), "raw hostile year never reaches the page HTML");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "escaped form present");
  assert.ok(!/<img[^>]*onerror/i.test(html), "no img element carries an executable onerror");
});
