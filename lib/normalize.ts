/**
 * Normalization: archive.org search docs and metadata -> the typed movie record from specs.md §4.
 *
 * The record shape is:
 * { identifier, title, year, addeddate, description, genres[], creators[], subjects[],
 *   thumbnails{}, runtime, runtimeSeconds, license, source_url, hasVideo }
 */
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
  /** Human label for the quality selector, e.g. "HD · h.264 · 447 MB". */
  label: string;
  size: number | null;
  /** URL-encoded path segment for the direct download URL (name, exactly encoded). */
  path: string;
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
  /** archive.org download node (`server` field), only meaningful with `dir`. */
  server: string | null;
  /** archive.org storage path (`dir` field), e.g. `/0/items/it-1927`. */
  dir: string | null;
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

/**
 * Extract the playable video derivatives from an item's file list, for the movie page's
 * quality selector. Sorted h.264 first (best browser compatibility — it is archive.org's
 * recommended derivative), then largest first; capped to keep the selector short.
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
    const format = String(rec["format"] ?? "video");
    const sizeRaw = rec["size"];
    const size =
      typeof sizeRaw === "number"
        ? sizeRaw
        : typeof sizeRaw === "string" && /^\d+$/.test(sizeRaw)
          ? parseInt(sizeRaw, 10)
          : null;
    const label = size != null ? `${videoFormatLabel(format)} · ${formatBytes(size)}` : videoFormatLabel(format);
    out.push({ name, format, label, size, path: encodeURIComponent(name) });
  }
  out.sort((a, b) => {
    const ah = a.format.toLowerCase().includes("h.264") ? 0 : 1;
    const bh = b.format.toLowerCase().includes("h.264") ? 0 : 1;
    if (ah !== bh) return ah - bh;
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
    // Search results come from mediatype:movies in curated collections; the list view does
    // not render a player, so hasVideo is a permissive default (the detail page verifies files).
    hasVideo: true,
    videoFiles: [],
    server: null,
    dir: null,
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
    server,
    dir,
  };
}
