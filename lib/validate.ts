/**
 * Input validation for every external parameter (constitution §6).
 * All validation failures throw ApiError -> the route returns a structured 400/429 JSON,
 * never a crash, never an upstream call with unvalidated input.
 */
import { GENRE_SUBJECTS, type GenreKey } from "./genres.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

/** Archive.org identifiers are restricted to a safe character set, max 120 chars. */
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

/** Spec: query length <= 80 chars. */
export const MAX_QUERY_LENGTH = 80;

export const MIN_PAGE = 1;
export const MAX_PAGE = 100;

export const ALLOWED_DECADES = new Set<number>([
  1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020,
]);

export type SortKey = "recent" | "title" | "newest" | "oldest";
export const SORT_KEYS: SortKey[] = ["recent", "title", "newest", "oldest"];

/**
 * Strip characters that have meaning in Solr/URL syntax or are unsafe, then collapse
 * whitespace. The result is embedded inside parentheses in the archive query, so this
 * prevents query injection (constitution §6: no injection). Slashes are stripped too:
 * path-traversal strings ("../../etc/passwd") become harmless spaced words instead of
 * being forwarded to archive.org (which rejects them) — task T2.4: traversal returns 400,
 * never an upstream call.
 */
export function sanitizeQuery(raw: string): string {
  return raw
    .replace(/["():\/\[\]{}*?\\%<>|#;`]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateQuery(raw: string | null, allowEmpty = false): string {
  const input = (raw ?? "").trim();
  if (input.length === 0) {
    if (allowEmpty) return ""; // the TV search shortcut (empty query = browse the TV pool)
    throw new ApiError(400, "empty_query", "Please enter a search term.");
  }
  if (input.length > MAX_QUERY_LENGTH) {
    throw new ApiError(400, "query_too_long", `Search queries are limited to ${MAX_QUERY_LENGTH} characters.`);
  }
  const q = sanitizeQuery(input);
  if (q.length === 0) {
    throw new ApiError(400, "empty_query", "Please enter a search term.");
  }
  return q;
}

export function validateIdentifier(raw: string | null | undefined): string {
  const id = (raw ?? "").trim();
  if (!IDENTIFIER_PATTERN.test(id)) {
    throw new ApiError(400, "invalid_identifier", "Invalid film identifier.");
  }
  return id;
}

export function validatePage(raw: string | null, maxPage: number = MAX_PAGE): number {
  // Empty/missing page param defaults to page 1; anything else must be a whole number 1..max.
  // The default max is the search API's paging cap; the catalog-index browse API passes a
  // larger bound (the full catalog is ~768 pages at 24/page).
  const value = (raw && raw.trim()) || "1";
  if (!/^\d{1,3}$/.test(value)) {
    throw new ApiError(400, "invalid_page", "Page must be a whole number.");
  }
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < MIN_PAGE || n > maxPage) {
    throw new ApiError(400, "invalid_page", `Page must be between ${MIN_PAGE} and ${maxPage}.`);
  }
  return n;
}

export function validateGenre(raw: string | null): GenreKey | null {
  if (raw === null || raw.trim() === "") return null;
  const key = raw.trim();
  if (!(key in GENRE_SUBJECTS)) {
    throw new ApiError(400, "invalid_genre", "Unknown genre.");
  }
  return key as GenreKey;
}

export function validateDecade(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = raw.trim();
  if (!/^\d{4}$/.test(value)) {
    throw new ApiError(400, "invalid_decade", "Decade must be a four-digit year ending in 0.");
  }
  const n = parseInt(value, 10);
  if (!ALLOWED_DECADES.has(n)) {
    throw new ApiError(400, "invalid_decade", "Decade is outside the supported range.");
  }
  return n;
}

/**
 * Validate a decade range (`from`/`to` browse params) — both bounds are decade starts
 * from the same whitelist as the single `decade` param (2000 = the 2000s), and from must
 * not be after to. The route maps them to year bounds (from, to + 9) — so from=2000&to=2020
 * means years 2000–2029, the "Modern picks" home feed. Both-or-neither: a one-sided range
 * is ambiguous and fails closed. Conflict with a single `decade` is the route's concern
 * (it rejects decade + range together).
 */
export function validateDecadeRange(
  fromRaw: string | null,
  toRaw: string | null,
): { from: number | null; to: number | null } {
  const hasFrom = fromRaw !== null && fromRaw.trim() !== "";
  const hasTo = toRaw !== null && toRaw.trim() !== "";
  if (!hasFrom && !hasTo) return { from: null, to: null };
  if (hasFrom !== hasTo) {
    throw new ApiError(400, "invalid_decade_range", "Provide both from and to decades.");
  }
  const from = validateDecade(fromRaw) as number;
  const to = validateDecade(toRaw) as number;
  if (from > to) {
    throw new ApiError(400, "invalid_decade_range", "The from decade must not be after the to decade.");
  }
  return { from, to };
}

export function validateSort(raw: string | null): SortKey {
  const value = (raw ?? "recent").trim();
  if (!SORT_KEYS.includes(value as SortKey)) {
    throw new ApiError(400, "invalid_sort", "Unknown sort order.");
  }
  return value as SortKey;
}

/**
 * Validate the browse keyword filter (`q=`): same sanitization + length cap as search, so
 * Solr/URL-injection characters can never reach the index matcher. Empty-after-sanitize
 * fails closed (an empty keyword filter is meaningless), matching the search route's
 * empty_query discipline.
 */
export function validateKeyword(raw: string | null): string | null {
  if (raw === null) return null; // param absent — no keyword filter
  if (raw.trim().length === 0) {
    // param present but empty — an explicit empty filter is meaningless, fail closed
    throw new ApiError(400, "empty_keyword", "Please provide a keyword.");
  }
  if (raw.trim().length > MAX_QUERY_LENGTH) {
    throw new ApiError(400, "query_too_long", `Keywords are limited to ${MAX_QUERY_LENGTH} characters.`);
  }
  const q = sanitizeQuery(raw);
  if (q.length === 0) {
    throw new ApiError(400, "empty_keyword", "Please provide a keyword.");
  }
  return q;
}

/**
 * Validate a raw subject phrase (the "More like this" row on detail pages). Null = param
 * absent (no filter). Same sanitizer as keywords; subjects are short archive.org tags like
 * "film noir" or "science fiction".
 */
export function validateSubject(raw: string | null): string | null {
  if (raw === null) return null;
  if (raw.trim().length === 0 || raw.trim().length > MAX_QUERY_LENGTH) {
    throw new ApiError(400, "invalid_subject", `Subject phrases are limited to ${MAX_QUERY_LENGTH} characters.`);
  }
  const q = sanitizeQuery(raw);
  if (q.length === 0) {
    throw new ApiError(400, "invalid_subject", "Please provide a subject.");
  }
  return q;
}

/** Parse a boolean flag param. Empty/missing -> false; "1" or "true" (case-insensitive) -> true; anything else -> 400. */
export function validateFlag(raw: string | null): boolean {
  if (raw === null || raw.trim() === "") return false;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false; // explicit opt-out (e.g. films=0)
  throw new ApiError(400, "invalid_flag", "Flag parameters accept 1, 0, true, or false.");
}
