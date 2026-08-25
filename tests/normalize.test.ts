import assert from "node:assert/strict";
import { test } from "node:test";
import {
  audioFilesFrom,
  episodesFrom,
  hasAudioFiles,
  hasVideoFiles,
  licenseFromRights,
  licenseFromUrl,
  normalizeMetadata,
  normalizeSearchDoc,
  parseRuntimeSeconds,
  pickSubtitle,
  poolFromCollections,
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

test("episodesFrom collapses a single film's quality variants into one episode", () => {
  // Real shape: `electromagnetism` has h.264 + MPEG2 + Ogg + a _512kb size variant — one
  // film, four files. The MPEG2 (.mpeg) is intentionally excluded like every other
  // non-browser-playable derivative (isVideoFileEntry), so three playable files remain.
  // Without derivative stripping the _512kb variant would split the film into two fake
  // episodes and wrongly trigger episode mode on every Prelinger film.
  const out = episodesFrom([
    { name: "electromagnetism.mp4", format: "h.264", size: 65250004 },
    { name: "electromagnetism.mpeg", format: "MPEG2", size: 293818372 },
    { name: "electromagnetism.ogv", format: "Ogg Video", size: 44771323 },
    { name: "electromagnetism_512kb.mp4", format: "512Kb MPEG4", size: 45604415 },
  ]);
  assert.equal(out.length, 1, "one content stem → one episode");
  assert.equal(out[0]?.label, "electromagnetism", "label is the cleaned stem");
  assert.equal(out[0]?.path, "electromagnetism.mp4", "primary is the h.264 derivative");
  assert.equal(out[0]?.files.length, 3, "the playable derivatives survive as quality options");
  assert.equal(out[0]?.files[0]?.name, "electromagnetism.mp4", "h.264 leads the quality list");
  assert.equal(out[0]?.files[1]?.name, "electromagnetism_512kb.mp4", "_512kb collapsed into the same episode");
  assert.equal(out[0]?.files[2]?.name, "electromagnetism.ogv");
});

test("episodesFrom groups a 52-episode bundle naturally with per-episode derivatives", () => {
  // Real shape: `fantomascompleto52ep_202112` — each episode has a `.ia.mp4` (h.264 IA)
  // and a plain `.mp4` (MPEG4) derivative. All 52 episodes, ordered 01..52, each with its
  // own quality list led by the h.264 file.
  const files = [];
  for (let i = 1; i <= 52; i++) {
    const n = String(i).padStart(2, "0");
    const stem = `${n} - Episodio ${i}`;
    files.push({ name: `${stem}.ia.mp4`, format: "h.264 IA", size: 90000000 + i });
    files.push({ name: `${stem}.mp4`, format: "MPEG4", size: 90000000 + i });
  }
  const out = episodesFrom(files);
  assert.equal(out.length, 52);
  assert.equal(out[0]?.label, "01 - Episodio 1", ".ia derivative stripped from the label");
  assert.equal(out[1]?.label, "02 - Episodio 2");
  assert.equal(out[10]?.label, "11 - Episodio 11", "natural (numeric) order — 11 after 10, not after 1");
  assert.equal(out[51]?.label, "52 - Episodio 52");
  assert.equal(out[0]?.files.length, 2, "per-episode derivatives");
  assert.equal(out[0]?.files[0]?.name, "01 - Episodio 1.ia.mp4", "h.264 leads each episode");
  assert.equal(out[0]?.path, "01%20-%20Episodio%201.ia.mp4", "primary path is URL-encoded");
});

test("episodesFrom handles .ia-only pairs and non-arrays", () => {
  // A Hollywood Detour (1942): `Name.ia.mp4` + `Name.mp4` → one episode.
  const detour = episodesFrom([
    { name: "A Hollywood Detour (1942).ia.mp4", format: "h.264 IA", size: 38182003 },
    { name: "A Hollywood Detour (1942).mp4", format: "MPEG4", size: 38182003 },
  ]);
  assert.equal(detour.length, 1);
  assert.equal(detour[0]?.label, "A Hollywood Detour (1942)");
  assert.deepEqual(episodesFrom(null), []);
  assert.deepEqual(episodesFrom("x"), []);
  assert.deepEqual(episodesFrom([{ name: "a.txt", format: "Text" }]), []);
});

test("episodesFrom caps the record and UI to a bounded list", () => {
  const files = Array.from({ length: 300 }, (_, i) => ({ name: `ep${i + 1}.mp4`, format: "h.264" }));
  assert.equal(episodesFrom(files).length, 100, "default cap");
  assert.equal(episodesFrom(files, 5).length, 5, "explicit smaller cap");
});

test("pickSubtitle prefers the .srt over a possibly-empty .vtt sibling", () => {
  // Real archive.org ASR shape: `iron_mask` has iron_mask.asr.srt (populated) and often an
  // EMPTY iron_mask.asr.vtt sibling (verified live: 0 bytes). The .srt must win.
  const out = pickSubtitle([
    { name: "iron_mask.asr.vtt", format: "Web Video Text Tracks" },
    { name: "iron_mask.asr.srt", format: "SubRip" },
  ]);
  assert.deepEqual(out, { name: "iron_mask.asr.srt", path: "iron_mask.asr.srt", kind: "srt" });
});

test("pickSubtitle falls back to a .vtt when no .srt exists", () => {
  const out = pickSubtitle([{ name: "film.en.vtt", format: "Web Video Text Tracks" }]);
  assert.deepEqual(out, { name: "film.en.vtt", path: "film.en.vtt", kind: "vtt" });
});

test("pickSubtitle returns null for items without subtitles and non-arrays", () => {
  assert.equal(pickSubtitle([{ name: "film.mp4", format: "h.264" }]), null);
  assert.equal(pickSubtitle(null), null);
  assert.equal(pickSubtitle("x"), null);
  assert.equal(pickSubtitle([]), null);
});

test("normalizeMetadata records the picked subtitle on the detail path", () => {
  const rec = normalizeMetadata(
    { identifier: "iron_mask", title: "Iron Mask", collection: ["feature_films"] },
    [{ name: "iron_mask.asr.srt", format: "SubRip" }],
  );
  assert.deepEqual(rec.subtitle, { name: "iron_mask.asr.srt", path: "iron_mask.asr.srt", kind: "srt" });
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

test("poolFromCollections maps archive.org collections to the specific pool, films last", () => {
  assert.equal(poolFromCollections(["short_films", "moviesandfilms"]), "shorts");
  assert.equal(poolFromCollections(["silent_films", "feature_films"]), "silents");
  assert.equal(poolFromCollections("sports"), "sports");
  assert.equal(poolFromCollections(["culturalandacademicfilms", "something-else"]), "documentaries");
  assert.equal(poolFromCollections(["tedtalks"]), "ted");
  assert.equal(poolFromCollections(["tedtalks", "culturalandacademicfilms"]), "ted"); // the specific curated view wins over documentaries
  assert.equal(poolFromCollections(["classic_tv"]), "tv");
  assert.equal(poolFromCollections(["oldtimeradio"]), "otr");
  assert.equal(poolFromCollections(["GratefulDead", "etree"]), "music");
  assert.equal(poolFromCollections(["moviesandfilms"]), "films");
  assert.equal(poolFromCollections(["feature_films"]), "films");
  assert.equal(poolFromCollections("Anime"), "anime"); // case-insensitive
  assert.equal(poolFromCollections(["television", "news_and_journalism"]), "publictv");
  assert.equal(poolFromCollections(["classic_tv", "television"]), "tv"); // classic_tv wins over the broad television collection
  assert.equal(poolFromCollections(["wellcomefilm"]), "science");
  assert.equal(poolFromCollections(["FedFlix", "usgovfilms"]), "govfilms");
  assert.equal(poolFromCollections(["usgovfilms"]), "govfilms"); // the widened govfilms gate (FedFlix is 100% inside usgovfilms)
  assert.equal(poolFromCollections(["wwIIarchive"]), "wwii"); // case-insensitive: metadata carries the mixed-case collection name
  assert.equal(poolFromCollections(["universal_newsreels"]), "newsreels");
  assert.equal(poolFromCollections(["librivoxaudio"]), "audiobooks");
  assert.equal(poolFromCollections(["78rpm"]), "records");
  assert.equal(poolFromCollections(["avgeeks"]), "ephemera");
  assert.equal(poolFromCollections(["avgeeks", "ephemera"]), "ephemera"); // the broad ephemera collection alone is NOT mapped
  assert.equal(poolFromCollections(["ephemera"]), null); // modern oral histories stay unmapped
  assert.equal(poolFromCollections(["nasa"]), "space");
  assert.equal(poolFromCollections(["stock_footage"]), "footage");
  assert.equal(poolFromCollections(["home_movies"]), "footage");
  assert.equal(poolFromCollections(["prelingerhomemovies", "prelinger"]), "footage"); // footage wins over the films union
  assert.equal(poolFromCollections(["stock_footage", "moviesandfilms"]), "footage"); // specific curated view wins over films
  assert.equal(poolFromCollections(["nationalfilmpreservationfoundation"]), "nfpf");
  assert.equal(poolFromCollections(["nationalfilmpreservationfoundation", "moviesandfilms"]), "nfpf"); // nfpf wins over the films union
  assert.equal(poolFromCollections([]), null);
  assert.equal(poolFromCollections(null), null);
  assert.equal(poolFromCollections(undefined), null);
  assert.equal(poolFromCollections(["totally_unknown_collection"]), null);
});

test("normalizeMetadata derives pool from the collection field", () => {
  const record = normalizeMetadata(
    { identifier: "x", title: "X", collection: ["short_films", "moviesandfilms"] },
    [],
  );
  assert.equal(record.pool, "shorts");
});
