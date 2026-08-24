/**
 * Normalization: archive.org search docs and metadata -> the typed movie record from specs.md §4.
 *
 * The record shape is:
 * { identifier, title, year, addeddate, description, genres[], creators[], subjects[],
 *   thumbnails{}, runtime, runtimeSeconds, license, source_url, hasVideo, pool }
 */
import type { IndexVariant } from "./archive.ts";

export type License = "publicdomain" | "creativecommons";

export interface Thumbnails {
  small: string;
  medium: string;
  large: string;
}

/** A playable video derivative from an archive.org item's file list (quality selector). */
export interface VideoFile {
  name: string;
  format: string;
  /** Human label for the quality selector, e.g. "720p · HD · h.264 · 877 MB". */
  label: string;
  size: number | null;
  /** Video height in pixels (from archive.org file metadata) — drives the resolution part of the label. */
  height: number | null;
  /** Video width in pixels (from archive.org file metadata). */
  width: number | null;
  /** URL-encoded path segment for the direct download URL (name, exactly encoded). */
  path: string;
}

/** A playable audio derivative (Old Time Radio items — VBR MP3 / Ogg Vorbis). */
export interface AudioFile {
  name: string;
  format: string;
  /** Human label for the quality selector, e.g. "VBR MP3 · 12.4 MB". */
  label: string;
  size: number | null;
  /** URL-encoded path segment for the direct download URL (name, exactly encoded). */
  path: string;
}

/** One subtitle derivative (archive.org ASR .srt/.vtt) for the native player's <track>. */
export interface SubtitleFile {
  name: string;
  /** URL-encoded path segment for the direct download URL. */
  path: string;
  kind: "srt" | "vtt";
}

/** One playable file group of a multi-episode item (see `episodesFrom`). */
export interface EpisodeFile {
  /** Human label — the file stem with derivative markers and the extension removed. */
  label: string;
  /** Primary playable path (h.264 preferred, then largest). */
  path: string;
  /** This episode's own derivatives, for the quality selector (h.264 first, largest). */
  files: VideoFile[];
}

export interface MovieRecord {
  identifier: string;
  title: string;
  year: number | null;
  /** archive.org added date normalized to YYYY-MM-DD (used for schema.org uploadDate). */
  addeddate: string | null;
  description: string | null;
  genres: string[];
  subjects: string[];
  creators: string[];
  thumbnails: Thumbnails;
  runtime: string | null;
  runtimeSeconds: number | null;
  license: License | null;
  source_url: string;
  hasVideo: boolean;
  /** Playable video derivatives (empty for search-index docs; populated on the detail path). */
  videoFiles: VideoFile[];
  /** Playable file groups (empty for single-film items and search-index docs). When more
   *  than one group exists the detail page renders an episode list instead of treating
   *  every file as a quality option. Populated on the detail path. */
  episodes: EpisodeFile[];
  /** Preferred subtitle derivative (archive.org ASR .srt/.vtt) for the native player's
   *  captions track — null when the item carries none (the honest "no captions" state).
   *  Populated on the detail path; video items only. */
  subtitle: SubtitleFile | null;
  /** True when the item's files include a playable audio derivative (Old Time Radio). */
  hasAudio: boolean;
  /** Playable audio derivatives (empty for search-index docs; populated on the detail path). */
  audioFiles: AudioFile[];
  /** archive.org download node (`server` field), only meaningful with `dir`. */
  server: string | null;
  /** archive.org storage path (`dir` field), e.g. `/0/items/it-1927`. */
  dir: string | null;
  /** Playable episode/track count (audio pools only, populated by the card enrichment). */
  episodeCount: number | null;
  /** Series/artist tag (audio pools only, populated by the card enrichment). */
  seriesTag: string | null;
  /** Which curated pool the item belongs to (archive.org `collection` → pool key). */
  pool: IndexVariant | null;
}

export function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Public domain / Creative Commons detection from a license URL (archive.org `licenseurl` field). */
export function licenseFromUrl(value: string | null | undefined): License | null {
  const url = asString(value)?.toLowerCase();
  if (!url) return null;
  if (
    url.includes("creativecommons.org/publicdomain") ||
    url.includes("creativecommons.org/licenses/publicdomain")
  ) {
    return "publicdomain";
  }
  if (url.includes("creativecommons.org/licenses/")) return "creativecommons";
  if (url.includes("creativecommons.org")) return "creativecommons";
  return null;
}

/** Public domain / Creative Commons detection from a rights statement. */
export function licenseFromRights(value: string | null | undefined): License | null {
  const text = asString(value)?.toLowerCase();
  if (!text) return null;
  if (
    text.includes("public domain") ||
    text.includes("publicdomain") ||
    text.includes("no known copyright")
  ) {
    return "publicdomain";
  }
  if (text.includes("creative commons") || text.includes("creativecommons")) return "creativecommons";
  return null;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Remove HTML tags and decode common entities (archive.org descriptions often contain markup). */
export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

export function toYear(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1000 && value <= 2100 ? value : null;
  }
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{4})/);
    if (m) {
      const y = parseInt(m[1] as string, 10);
      if (y >= 1000 && y <= 2100) return y;
    }
  }
  return null;
}

/** Coerce a creator/subject/genre field (string or array) into a deduplicated string list. */
export function toList(value: unknown): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  if (Array.isArray(value)) {
    for (const v of value) {
      if (v != null) push(String(v));
    }
  } else if (typeof value === "string") {
    for (const line of value.split(/\r?\n/)) {
      if (line.includes(",") && line.split(",").length > 1) {
        for (const part of line.split(",")) push(part);
      } else {
        push(line);
      }
    }
  } else if (value != null) {
    push(String(value));
  }
  return out;
}

/**
 * Normalize archive.org addeddate ("2024-05-01T10:00:00Z", "2024-05-01 10:00:00") to
 * YYYY-MM-DD; anything unparseable becomes null (callers omit date-dependent markup).
 */
export function addedDateOf(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? (m[1] as string) : null;
}

/** Parse archive.org runtime strings ("1:36:00", "96:00", "96 min", "96") into seconds. */
export function parseRuntimeSeconds(value: string | null | undefined): number | null {
  const text = asString(value)?.toLowerCase();
  if (!text) return null;
  const hms = text.match(/^(\d{1,3}):(\d{1,2}):(\d{2})$/);
  if (hms) {
    const h = parseInt(hms[1] as string, 10);
    const m = parseInt(hms[2] as string, 10);
    const s = parseInt(hms[3] as string, 10);
    if (m > 59 || s > 59) return null;
    return h * 3600 + m * 60 + s;
  }
  const ms = text.match(/^(\d{1,3}):(\d{2})$/);
  if (ms) {
    const m = parseInt(ms[1] as string, 10);
    const s = parseInt(ms[2] as string, 10);
    if (s > 59) return null;
    return m * 60 + s;
  }
  const mins = text.match(/^(\d{1,5})\s*(?:min|mins|minutes|m)?\.?$/);
  if (mins) return parseInt(mins[1] as string, 10) * 60;
  return null;
}

/** Real archive.org thumbnail endpoints (verified live). Video bytes are never stored or proxied. */
export function thumbnailsFor(identifier: string): Thumbnails {
  const safe = encodeURIComponent(identifier);
  return {
    small: `https://archive.org/download/${safe}/__ia_thumb.jpg`,
    medium: `https://archive.org/services/img/${safe}`,
    large: `https://archive.org/services/img/${safe}?width=1200`,
  };
}

const VIDEO_FORMAT_HINTS = ["h.264", "mpeg4", "ogg video", "webm", "xvid", "matroska"];

/** True when a file entry is a playable video derivative (format hint or extension). */
function isVideoFileEntry(f: unknown): boolean {
  if (!f || typeof f !== "object") return false;
  const rec = f as Record<string, unknown>;
  const fmt = String(rec["format"] ?? "").toLowerCase();
  if (VIDEO_FORMAT_HINTS.some((hint) => fmt.includes(hint))) return true;
  return /\.(mp4|mkv|webm|ogv|avi|mov|m4v)$/i.test(String(rec["name"] ?? ""));
}

/** True when the item's file list contains a playable video derivative. */
export function hasVideoFiles(files: unknown): boolean {
  if (!Array.isArray(files)) return false;
  return files.some(isVideoFileEntry);
}

function videoFormatLabel(format: string): string {
  const f = format.toLowerCase();
  if (f.includes("h.264")) return "HD · h.264";
  if (f.includes("matroska") || f.includes("mkv")) return "Original · MKV";
  if (f.includes("webm")) return "WebM";
  if (f.includes("ogg")) return "Ogg";
  if (f.includes("xvid")) return "Xvid";
  if (f.includes("mpeg4") || f.includes("mpeg-4")) return "MPEG4";
  return "Video";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Height tiers for the standard resolution shorthand ("1080p", "720p", …). */
const RESOLUTION_TIERS: Array<[number, string]> = [
  [2160, "4K"],
  [1440, "1440p"],
  [1080, "1080p"],
  [720, "720p"],
  [576, "576p"],
  [480, "480p"],
  [360, "360p"],
  [240, "240p"],
];

/**
 * Human resolution for the quality selector: a standard shorthand when the height matches a
 * common tier ("720p"), otherwise the exact frame size ("928×720"). Null when unknown.
 */
function resolutionLabel(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  for (const [tier, name] of RESOLUTION_TIERS) {
    if (height >= tier) return name;
  }
  return `${width}×${height}`;
}

/** Parse a number or numeric string to a positive int (archive.org file metadata). */
function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return parseInt(value, 10);
  return null;
}

/** Build one VideoFile from a raw archive.org file entry (shared by the quality selector
 *  and episode grouping so both label derivatives identically). */
function videoFileFromEntry(rec: Record<string, unknown>): VideoFile | null {
  const name = String(rec["name"] ?? "");
  if (!name) return null;
  const format = String(rec["format"] ?? "video");
  const sizeRaw = rec["size"];
  const size =
    typeof sizeRaw === "number"
      ? sizeRaw
      : typeof sizeRaw === "string" && /^\d+$/.test(sizeRaw)
        ? parseInt(sizeRaw, 10)
        : null;
  const width = toPositiveInt(rec["width"]);
  const height = toPositiveInt(rec["height"]);
  const res = resolutionLabel(width, height);
  const base = videoFormatLabel(format);
  const sizePart = size != null ? ` · ${formatBytes(size)}` : "";
  const label = res ? `${res} · ${base}${sizePart}` : `${base}${sizePart}`;
  return { name, format, label, size, width, height, path: encodeURIComponent(name) };
}

/** h.264 first (best browser compatibility — archive.org's recommended derivative), then largest. */
function compareVideoFiles(a: VideoFile, b: VideoFile): number {
  const ah = a.format.toLowerCase().includes("h.264") ? 0 : 1;
  const bh = b.format.toLowerCase().includes("h.264") ? 0 : 1;
  if (ah !== bh) return ah - bh;
  return (b.size ?? 0) - (a.size ?? 0);
}

/**
 * Extract the playable video derivatives from an item's file list, for the movie page's
 * quality selector. Sorted h.264 first, then largest first; capped to keep the selector
 * short.
 */
export function videoFilesFrom(files: unknown): VideoFile[] {
  if (!Array.isArray(files)) return [];
  const out: VideoFile[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!isVideoFileEntry(f)) continue;
    const rec = f as Record<string, unknown>;
    const name = String(rec["name"] ?? "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const vf = videoFileFromEntry(rec);
    if (vf) out.push(vf);
  }
  out.sort(compareVideoFiles);
  return out.slice(0, 6);
}

/**
 * Suffixes that mark a file as a DERIVATIVE of the same content rather than its own
 * episode: archive.org's derived h.264 is `<name>.ia.<ext>`, its size variants are
 * `<name>_512kb.<ext>`, plus common quality tags. Stripped from the stem before episode
 * grouping so quality variants collapse into one episode instead of splitting a single
 * film into fake episodes (verified on live items: `electromagnetism` has mp4/mpeg/ogv
 * + `_512kb` — one film, one group).
 */
const DERIVATIVE_SUFFIXES: RegExp[] = [
  /\.ia$/i,
  /_\d+kb$/i,
  /_hq$/i,
  /_lq$/i,
  /_sd$/i,
  /_hd$/i,
  /_small$/i,
  /_large$/i,
];

/** File stem: name minus its extension, minus derivative markers ("E1.ia.mp4" → "E1"). */
function fileStem(name: string): string {
  let stem = name.replace(/\.[^.]+$/, "");
  for (const re of DERIVATIVE_SUFFIXES) stem = stem.replace(re, "");
  return stem.trim();
}

/** Natural (numeric-aware) label order: "02" before "10", "52" last. */
function compareEpisodeLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Group an item's playable video files into episodes. Single films (one content stem with
 * quality/format variants) yield exactly one group — the detail page only enters episode
 * mode when this returns more than one. Groups are ordered naturally ("01, 02, … 10, 52")
 * and capped to keep the record JSON and the UI bounded.
 */
export function episodesFrom(files: unknown, cap = 100): EpisodeFile[] {
  if (!Array.isArray(files)) return [];
  const groups = new Map<string, VideoFile[]>();
  for (const f of files) {
    if (!isVideoFileEntry(f)) continue;
    const rec = f as Record<string, unknown>;
    const name = String(rec["name"] ?? "");
    if (!name) continue;
    const stem = fileStem(name);
    if (!stem) continue;
    const vf = videoFileFromEntry(rec);
    if (!vf) continue;
    const list = groups.get(stem);
    if (list) {
      if (!list.some((x) => x.name === vf.name)) list.push(vf);
    } else {
      groups.set(stem, [vf]);
    }
  }
  const out: EpisodeFile[] = [];
  for (const [label, list] of groups) {
    list.sort(compareVideoFiles);
    const primary = list[0];
    if (!primary) continue; // a group always has at least one file — guard for strict TS
    out.push({ label, path: primary.path, files: list });
  }
  out.sort((a, b) => compareEpisodeLabels(a.label, b.label));
  return out.slice(0, cap);
}

const SUBTITLE_FORMAT_HINTS = ["subrip", "web video text", "subtitle"];

/**
 * Pick the item's preferred subtitle derivative for the native player's captions track.
 * Archive.org auto-generates ASR captions as `<name>.asr.srt` (reliably populated) and
 * sometimes an empty `<name>.asr.vtt` sibling (verified live: `iron_mask.asr.vtt` is 0
 * bytes while the .srt carries the cues), so a .srt is preferred and converted to WebVTT
 * server-side. Returns null when the item has no subtitle files — the honest "no
 * captions" state (the client only renders a track when this exists).
 */
export function pickSubtitle(files: unknown): SubtitleFile | null {
  if (!Array.isArray(files)) return null;
  let vtt: SubtitleFile | null = null;
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const rec = f as Record<string, unknown>;
    const name = String(rec["name"] ?? "");
    if (!name) continue;
    const fmt = String(rec["format"] ?? "").toLowerCase();
    if (!SUBTITLE_FORMAT_HINTS.some((h) => fmt.includes(h)) && !/\.(srt|vtt)$/i.test(name)) continue;
    const kind = /\.srt$/i.test(name) ? "srt" : "vtt";
    if (kind === "srt") return { name, path: encodeURIComponent(name), kind };
    if (!vtt) vtt = { name, path: encodeURIComponent(name), kind };
  }
  return vtt;
}

const AUDIO_FORMAT_HINTS = ["mp3", "ogg vorbis", "vorbis"];

/** True when a file entry is a playable audio derivative (mp3/ogg format hint or extension). */
function isAudioFileEntry(f: unknown): boolean {
  if (!f || typeof f !== "object") return false;
  const rec = f as Record<string, unknown>;
  const fmt = String(rec["format"] ?? "").toLowerCase();
  if (AUDIO_FORMAT_HINTS.some((hint) => fmt.includes(hint))) return true;
  return /\.(mp3|ogg)$/i.test(String(rec["name"] ?? ""));
}

/** True when an audio item's file list contains a playable derivative (detail path). */
export function hasAudioFiles(files: unknown): boolean {
  if (!Array.isArray(files)) return false;
  return files.some(isAudioFileEntry);
}

function audioFormatLabel(format: string): string {
  const f = format.toLowerCase();
  if (f.includes("ogg") || f.includes("vorbis")) return "Ogg Vorbis";
  if (f.includes("mp3")) return "MP3";
  return "Audio";
}

/**
 * Extract the playable audio derivatives (Old Time Radio). Sorted MP3 first (best browser
 * compatibility), then largest first; capped so the quality selector stays short even on
 * multi-episode series (the first episode files dominate by size anyway).
 */
export function audioFilesFrom(files: unknown): AudioFile[] {
  if (!Array.isArray(files)) return [];
  const out: AudioFile[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!isAudioFileEntry(f)) continue;
    const rec = f as Record<string, unknown>;
    const name = String(rec["name"] ?? "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const format = String(rec["format"] ?? "audio");
    const sizeRaw = rec["size"];
    const size =
      typeof sizeRaw === "number"
        ? sizeRaw
        : typeof sizeRaw === "string" && /^\d+$/.test(sizeRaw)
          ? parseInt(sizeRaw, 10)
          : null;
    const label = size != null ? `${audioFormatLabel(format)} · ${formatBytes(size)}` : audioFormatLabel(format);
    out.push({ name, format, label, size, path: encodeURIComponent(name) });
  }
  out.sort((a, b) => {
    const am = a.format.toLowerCase().includes("mp3") ? 0 : 1;
    const bm = b.format.toLowerCase().includes("mp3") ? 0 : 1;
    if (am !== bm) return am - bm;
    return (b.size ?? 0) - (a.size ?? 0);
  });
  return out.slice(0, 6);
}

function descriptionOf(value: unknown, maxLength: number): string | null {
  if (Array.isArray(value)) return descriptionOf(value.join("\n"), maxLength);
  const s = asString(value);
  if (!s) return null;
  return truncate(stripHtml(s), maxLength);
}

/** Normalize an advancedsearch result doc into the typed record. */
/**
 * Map an archive.org `collection` field (a bare string or an array — both appear) to the
 * curated pool it belongs to, or null when it matches none. The specific pools (tv, anime,
 * … silents) are checked BEFORE the films union because shorts/silents items also sit in the
 * films collections (`short_films` + `moviesandfilms`): the more specific pool landing page
 * should win. Collection identifiers are matched case-insensitively (Solr is too). The
 * collection names mirror the gate clauses in lib/archive.ts.
 */
const COLLECTION_TO_POOL: Array<[readonly string[], IndexVariant]> = [
  [["classic_tv"], "tv"],
  // `television` is checked AFTER classic_tv: a classic_tv item that also sits in the broad
  // television collection must stay a Classic TV page, while the AAPB public-broadcasting
  // items (which live only in `television`) resolve to the publictv pool.
  [["television"], "publictv"],
  [["anime"], "anime"],
  [["animationandcartoons"], "cartoons"],
  [["oldtimeradio"], "otr"],
  [["gratefuldead", "etree"], "music"],
  // `tedtalks` maps to the ted pool BEFORE `culturalandacademicfilms` (documentaries): every
  // tedtalks item also sits in the documentaries collection (measured 2026-08-21: 2,933 = 2,933),
  // so the more specific curated-view landing page must win on the detail page.
  [["tedtalks"], "ted"],
  [["culturalandacademicfilms"], "documentaries"],
  [["sports"], "sports"],
  [["short_films"], "shorts"],
  [["silent_films"], "silents"],
  [["wellcomefilm"], "science"],
  // `usgovfilms` maps to the govfilms pool alongside `fedflix` (the 2026-08-24 gate widening:
  // FedFlix is 100% inside usgovfilms). Both are US-government public-domain collections.
  [["fedflix", "usgovfilms"], "govfilms"],
  [["librivoxaudio"], "audiobooks"],
  [["78rpm"], "records"],
  // `avgeeks` maps to the ephemera pool; the broad `ephemera` collection is deliberately NOT
  // mapped (modern community oral histories — rejected for this pool 2026-08-19). The gate
  // pins `collection:avgeeks`; avgeeks items also sit in `ephemera`, so the specific mapping
  // must come BEFORE the films union (an avgeeks item in a films collection stays ephemera).
  [["avgeeks"], "ephemera"],
  [["nasa"], "space"],
  // `stock_footage` / `home_movies` / `home_movie` / `prelingerhomemovies` map to the footage
  // pool; every gated footage item also sits in `moviesandfilms` (measured 2026-08-22: 445 =
  // 445), so the specific curated-view mapping must come BEFORE the films union, exactly like
  // avgeeks → ephemera. `prelingerhomemovies` is included because those items also carry
  // `prelinger` (a films-union collection) — without it they'd resolve to films.
  [["stock_footage", "home_movies", "home_movie", "prelingerhomemovies"], "footage"],
  // wwIIarchive + universal_newsreels map to their own pools (both measured 2026-08-24 fully
  // disjoint from the films union, so order is not load-bearing — but they sit before the
  // films union for consistency with the other specific-pool mappings).
  [["wwiiarchive"], "wwii"],
  [["universal_newsreels"], "newsreels"],
  [["feature_films", "prelinger", "moviesandfilms"], "films"],
];

export function poolFromCollections(collections: unknown): IndexVariant | null {
  const values = Array.isArray(collections)
    ? collections.map(String)
    : collections === null || collections === undefined
      ? []
      : [String(collections)];
  const set = new Set(values.map((v) => v.toLowerCase()));
  for (const [names, pool] of COLLECTION_TO_POOL) {
    if (names.some((n) => set.has(n))) return pool;
  }
  return null;
}

export function normalizeSearchDoc(doc: Record<string, unknown>): MovieRecord {
  const identifier = asString(doc["identifier"]) ?? "";
  const title = asString(doc["title"]) ?? (identifier || "Untitled");
  const year = toYear(doc["year"]) ?? toYear(doc["date"]);
  const runtime = asString(doc["runtime"]);
  return {
    identifier,
    title,
    year,
    addeddate: addedDateOf(doc["addeddate"]),
    description: descriptionOf(doc["description"], 400),
    genres: toList(doc["genre"]),
    subjects: toList(doc["subject"]),
    creators: toList(doc["creator"]),
    thumbnails: thumbnailsFor(identifier),
    runtime,
    runtimeSeconds: parseRuntimeSeconds(runtime),
    license: licenseFromUrl(asString(doc["licenseurl"])) ?? licenseFromRights(asString(doc["rights"])),
    source_url: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    // Search results come from curated collections; the list view does not render a player,
    // so hasVideo is a permissive default (the detail page verifies files). Audio items
    // (Old Time Radio) are not video — hasAudio is false here; the detail page verifies.
    hasVideo: true,
    videoFiles: [],
    episodes: [],
    subtitle: null,
    hasAudio: false,
    audioFiles: [],
    server: null,
    dir: null,
    // Search-index docs carry no file data — the audio card enrichment fills these in.
    episodeCount: null,
    seriesTag: null,
    // Index/live-search docs don't fetch `collection`, so pool is null on this path; the
    // detail page (normalizeMetadata) derives it from full metadata.
    pool: poolFromCollections(doc["collection"]),
  };
}

/** Normalize full metadata (metadata/<identifier>) into the typed record. */
export function normalizeMetadata(
  meta: Record<string, unknown>,
  files: unknown[],
  server: string | null = null,
  dir: string | null = null,
): MovieRecord {
  const identifier = asString(meta["identifier"]) ?? "";
  const title = asString(meta["title"]) ?? (identifier || "Untitled");
  const year = toYear(meta["year"]) ?? toYear(meta["date"]);
  const runtime = asString(meta["runtime"]);
  return {
    identifier,
    title,
    year,
    addeddate: addedDateOf(meta["addeddate"]),
    description: descriptionOf(meta["description"], 1200),
    genres: toList(meta["genre"]),
    subjects: toList(meta["subject"]),
    creators: toList(meta["creator"]),
    thumbnails: thumbnailsFor(identifier),
    runtime,
    runtimeSeconds: parseRuntimeSeconds(runtime),
    license: licenseFromUrl(asString(meta["licenseurl"])) ?? licenseFromRights(asString(meta["rights"])),
    source_url: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    hasVideo: hasVideoFiles(files),
    videoFiles: videoFilesFrom(files),
    episodes: episodesFrom(files),
    subtitle: pickSubtitle(files),
    hasAudio: hasAudioFiles(files),
    audioFiles: audioFilesFrom(files),
    server,
    dir,
    episodeCount: null,
    seriesTag: null,
    pool: poolFromCollections(meta["collection"]),
  };
}
