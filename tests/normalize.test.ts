import assert from "node:assert/strict";
import { test } from "node:test";
import {
  audioFilesFrom,
  hasAudioFiles,
  hasVideoFiles,
  licenseFromRights,
  licenseFromUrl,
  normalizeMetadata,
  normalizeSearchDoc,
  parseRuntimeSeconds,
  stripHtml,
  toList,
  toYear,
  videoFilesFrom,
} from "../lib/normalize.ts";

test("licenseFromUrl detects PD mark, CC licenses, and unknown", () => {
  assert.equal(licenseFromUrl("https://creativecommons.org/publicdomain/mark/1.0/"), "publicdomain");
  assert.equal(licenseFromUrl("https://creativecommons.org/licenses/publicdomain/"), "publicdomain");
  assert.equal(licenseFromUrl("https://creativecommons.org/licenses/by/4.0/"), "creativecommons");
  assert.equal(licenseFromUrl("https://creativecommons.org/licenses/by-nc-sa/3.0/"), "creativecommons");
  assert.equal(licenseFromUrl(null), null);
  assert.equal(licenseFromUrl(""), null);
  assert.equal(licenseFromUrl("https://example.com/license"), null);
  assert.equal(licenseFromUrl(undefined), null);
});

test("licenseFromRights detects public domain and CC statements", () => {
  assert.equal(licenseFromRights("This item is in the public domain"), "publicdomain");
  assert.equal(licenseFromRights("Public Domain"), "publicdomain");
  assert.equal(licenseFromRights("No known copyright"), "publicdomain");
  assert.equal(licenseFromRights("Creative Commons Attribution 4.0"), "creativecommons");
  assert.equal(licenseFromRights(null), null);
  assert.equal(licenseFromRights("All rights reserved"), null);
});

test("stripHtml removes markup and decodes entities", () => {
  assert.equal(stripHtml("<div>Hello</div> <p>world</p>"), "Hello world");
  assert.equal(stripHtml("a &amp; b &quot;c&quot;"), 'a & b "c"');
  assert.equal(stripHtml("plain text"), "plain text");
});

test("toYear parses numbers and date strings", () => {
  assert.equal(toYear(1927), 1927);
  assert.equal(toYear("1927"), 1927);
  assert.equal(toYear("1927-05-01"), 1927);
  assert.equal(toYear("n/a"), null);
  assert.equal(toYear(42), null);
  assert.equal(toYear(null), null);
  assert.equal(toYear(3000), null);
});

test("toList coerces strings and arrays, dedupes, splits newlines/commas", () => {
  assert.deepEqual(toList("a\nb"), ["a", "b"]);
  assert.deepEqual(toList("Clarence G. Badger, Elinor Glyn, Hope Loring"), [
    "Clarence G. Badger",
    "Elinor Glyn",
    "Hope Loring",
  ]);
  assert.deepEqual(toList(["a", "a", "b"]), ["a", "b"]);
  assert.deepEqual(toList(42), ["42"]);
  assert.deepEqual(toList(null), []);
  assert.deepEqual(toList("  "), []);
});

test("parseRuntimeSeconds handles H:MM:SS, MM:SS, and minutes", () => {
  assert.equal(parseRuntimeSeconds("1:36:00"), 5760);
  assert.equal(parseRuntimeSeconds("01:36:00"), 5760);
  assert.equal(parseRuntimeSeconds("96:00"), 5760);
  assert.equal(parseRuntimeSeconds("96 min"), 5760);
  assert.equal(parseRuntimeSeconds("96 minutes"), 5760);
  assert.equal(parseRuntimeSeconds("96m"), 5760);
  assert.equal(parseRuntimeSeconds("96"), 5760);
  assert.equal(parseRuntimeSeconds("abc"), null);
  assert.equal(parseRuntimeSeconds(null), null);
  assert.equal(parseRuntimeSeconds("1:99:00"), null);
});

test("hasVideoFiles detects video derivatives", () => {
  const files = [
    { name: "a.mp4", format: "h.264 IA" },
    { name: "b.txt", format: "Text" },
  ];
  assert.equal(hasVideoFiles(files), true);
  assert.equal(hasVideoFiles([{ name: "a.txt", format: "Text" }]), false);
  assert.equal(hasVideoFiles([{ name: "a.mkv", format: "Matroska" }]), true);
  assert.equal(hasVideoFiles([{ name: "a.mov" }]), true, "extension fallback");
  assert.equal(hasVideoFiles([]), false);
  assert.equal(hasVideoFiles(null), false);
  assert.equal(hasVideoFiles("not an array"), false);
});

test("videoFilesFrom sorts h.264 first then largest, dedupes, and encodes paths", () => {
  const files = [
    { name: "big.mkv", format: "Matroska", size: "900000000", width: 928, height: 720 },
    { name: "small.mp4", format: "h.264", size: 1048576, width: 400, height: 300 },
    { name: "small.mp4", format: "h.264", size: 1048576, width: 400, height: 300 },
    { name: "a.txt", format: "Text" },
    { name: "film (1927).mp4", format: "h.264", size: "2000000", width: 618, height: 480 },
    { name: "tiny.webm", format: "WebM", width: 160, height: 120 },
  ];
  const out = videoFilesFrom(files);
  assert.equal(out.length, 4, "dedupes + drops non-video");
  assert.equal(out[0]?.name, "film (1927).mp4", "largest h.264 first");
  assert.equal(out[0]?.path, "film%20(1927).mp4", "exact URL-encoding");
  assert.equal(out[1]?.name, "small.mp4", "second h.264");
  assert.equal(out[2]?.name, "big.mkv", "non-h.264 last");
  assert.equal(out[0]?.label, "480p · HD · h.264 · 2 MB", "resolution shorthand + size");
  assert.equal(out[1]?.label, "240p · HD · h.264 · 1 MB", "height 300 maps to the 240p tier");
  assert.equal(out[2]?.label, "720p · Original · MKV · 858 MB");
  assert.equal(out[3]?.label, "160×120 · WebM", "sub-240 frame size falls back to WxH, no size shown");
  assert.equal(out[0]?.width, 618, "width extracted from metadata");
  assert.equal(out[0]?.height, 480, "height extracted from metadata");
});

test("videoFilesFrom keeps label useful when resolution or size is missing", () => {
  const out = videoFilesFrom([{ name: "a.mp4", format: "h.264" }]);
  assert.equal(out[0]?.label, "HD · h.264", "no size, no resolution → format only");
  const withSize = videoFilesFrom([{ name: "b.mp4", format: "h.264", size: 500000000 }]);
  assert.equal(withSize[0]?.label, "HD · h.264 · 477 MB", "size without resolution still shows");
  assert.equal(withSize[0]?.width, null);
  assert.equal(withSize[0]?.height, null);
});

test("videoFilesFrom returns [] for non-arrays", () => {
  assert.deepEqual(videoFilesFrom(null), []);
  assert.deepEqual(videoFilesFrom("x"), []);
});

test("audioFilesFrom picks mp3/ogg, sorts MP3 first then largest, dedupes, encodes paths", () => {
  const files = [
    { name: "ep2.ogg", format: "Ogg Vorbis", size: "5000000" },
    { name: "ep1.mp3", format: "VBR MP3", size: 3000000 },
    { name: "ep1.mp3", format: "VBR MP3", size: 3000000 },
    { name: "ep3.mp3", format: "128Kbps MP3", size: "8000000" },
    { name: "cover.jpg", format: "JPEG" },
  ];
  const out = audioFilesFrom(files);
  assert.equal(out.length, 3, "dedupes + drops non-audio");
  assert.equal(out[0]?.name, "ep3.mp3", "largest MP3 first");
  assert.equal(out[1]?.name, "ep1.mp3", "second MP3");
  assert.equal(out[2]?.name, "ep2.ogg", "ogg last (mp3 preferred for compatibility)");
  assert.equal(out[0]?.path, "ep3.mp3", "simple names encode cleanly");
  assert.equal(out[0]?.label, "MP3 · 8 MB");
  assert.equal(out[2]?.label, "Ogg Vorbis · 5 MB");
  assert.ok(hasAudioFiles(files), "hasAudioFiles true when audio present");
  assert.ok(!hasAudioFiles([{ name: "a.txt", format: "Text" }]), "hasAudioFiles false without audio");
});

test("audioFilesFrom returns [] for non-arrays", () => {
  assert.deepEqual(audioFilesFrom(null), []);
  assert.deepEqual(audioFilesFrom("x"), []);
});

test("normalizeSearchDoc builds a typed record", () => {
  const record = normalizeSearchDoc({
    identifier: "it-1927",
    title: "It (1927)",
    year: 1927,
    description: "<p>A silent classic</p>",
    creator: "Clarence G. Badger, Elinor Glyn",
    subject: ["Romance", "Silent Films"],
    genre: "Romance",
    licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/",
    runtime: "1:12:00",
  });
  assert.equal(record.identifier, "it-1927");
  assert.equal(record.title, "It (1927)");
  assert.equal(record.year, 1927);
  assert.equal(record.description, "A silent classic");
  assert.deepEqual(record.creators, ["Clarence G. Badger", "Elinor Glyn"]);
  assert.deepEqual(record.subjects, ["Romance", "Silent Films"]);
  assert.equal(record.license, "publicdomain");
  assert.equal(record.runtimeSeconds, 4320);
  assert.equal(record.source_url, "https://archive.org/details/it-1927");
  assert.ok(record.thumbnails.small.includes("__ia_thumb.jpg"));
});

test("normalizeMetadata falls back to rights text and marks hasVideo", () => {
  const record = normalizeMetadata(
    {
      identifier: "some-film",
      title: "Some Film",
      description: ["Line one", "Line two"],
      year: "1950",
      rights: "Public Domain",
      runtime: "80 min",
    },
    [{ name: "x.mp4", format: "h.264 IA" }],
  );
  assert.equal(record.title, "Some Film");
  assert.equal(record.year, 1950);
  assert.equal(record.description, "Line one Line two");
  assert.equal(record.license, "publicdomain");
  assert.equal(record.hasVideo, true);
  assert.equal(record.runtimeSeconds, 4800);
});

test("normalizeMetadata leaves unknown license null (caller fails closed)", () => {
  const record = normalizeMetadata({ identifier: "x", title: "X" }, []);
  assert.equal(record.license, null);
  assert.equal(record.hasVideo, false);
});
