/**
 * Movie record lookup for the detail path (API + SSR page). Fails closed:
 *  - invalid identifier        -> 400 invalid
 *  - missing / dark item       -> 404 not_available (archive.org returns HTTP 200 {} for
 *                                missing items; a genuine archive 404, if the API ever
 *                                returns one, maps to 404 not_found)
 *  - license cannot be verified-> 404 not_legal (constitution §1: excluded, never guessed)
 *  - upstream failure          -> 502 upstream
 */
import {
  ArchiveError,
  fetchMetadata,
  fetchSearchDocByIdentifier,
} from "./archive.ts";
import {
  cacheGet,
  cachePut,
  cacheKey,
  type CacheBackend,
} from "./cache.ts";
import {
  asString,
  licenseFromRights,
  licenseFromUrl,
  normalizeMetadata,
  type MovieRecord,
} from "./normalize.ts";
import { ApiError, validateIdentifier } from "./validate.ts";

export type MovieLookupResult =
  | { ok: true; record: MovieRecord; fromCache: boolean }
  | { ok: false; status: number; reason: "invalid" | "not_found" | "not_available" | "not_legal" | "upstream" };

export async function getMovieRecord(
  identifierRaw: string,
  cache: CacheBackend | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<MovieLookupResult> {
  let identifier: string;
  try {
    identifier = validateIdentifier(identifierRaw);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, status: 400, reason: "invalid" };
    throw err;
  }

  const key = cacheKey("movie", [identifier]);
  const cached = await cacheGet(cache, key);
  if (cached !== null) {
    try {
      const record = JSON.parse(cached) as MovieRecord;
      if (record && typeof record.identifier === "string" && record.identifier === identifier) {
        return { ok: true, record, fromCache: true };
      }
    } catch {
      // Corrupt cache entry: fall through and refetch from the source of truth.
    }
  }

  let meta: Awaited<ReturnType<typeof fetchMetadata>>;
  try {
    meta = await fetchMetadata(identifier, fetchImpl);
  } catch (err) {
    if (err instanceof ArchiveError) {
      if (err.status === 404) return { ok: false, status: 404, reason: "not_found" };
      return { ok: false, status: 502, reason: "upstream" };
    }
    throw err;
  }

  if (meta.isDark || !meta.metadata) {
    return { ok: false, status: 404, reason: "not_available" };
  }

  let license = licenseFromUrl(asString(meta.metadata["licenseurl"])) ??
    licenseFromRights(asString(meta.metadata["rights"]));

  if (!license) {
    // Fallback: the search index sometimes carries the license declaration for items whose
    // metadata omits it. If this also fails, the film is excluded (fail closed).
    try {
      const doc = await fetchSearchDocByIdentifier(identifier, fetchImpl);
      if (doc) license = licenseFromUrl(asString(doc["licenseurl"]));
    } catch {
      // license stays null; excluded below
    }
  }

  if (!license) {
    return { ok: false, status: 404, reason: "not_legal" };
  }

  const record = normalizeMetadata(meta.metadata, meta.files ?? [], meta.server ?? null, meta.dir ?? null);
  record.license = license;

  await cachePut(cache, key, record);
  return { ok: true, record, fromCache: false };
}
