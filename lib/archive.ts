/**
 * Archive.org client (lib). All outbound calls are server-side only — the browser never talks
 * to archive.org directly (the player iframe is the sole exception, per the $0 storage rule).
 *
 * Legality policy (constitution §1): every query is filtered to items that (a) sit in one of
 * archive.org's curated film collections (`feature_films`, `prelinger`, `moviesandfilms`) and
 * (b) carry a declared license via the `licenseurl` field (creativecommons.org public-domain
 * mark or CC license). Collection counts with the license gate (measured live, 2026-08-15):
 * feature_films 9,049 · prelinger 1,914 · moviesandfilms 16,761 (union ≈ 18,489).
 * `classic_films`/`SilentEra`/`publicdomainmovies` carry no licenseurl marks (0 hits) and are
 * therefore excluded. Deep per-film verification happens on the detail path
 * (lib/catalog.ts) and fails closed when a license cannot be verified.
 */
import { FILMS_ONLY_SOLR_CLAUSE } from "./film-policy.ts";

export class ArchiveError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
    this.name = "ArchiveError";
  }
}

export const ARCHIVE_SEARCH_URL = "https://archive.org/advancedsearch.php";
export const ARCHIVE_METADATA_URL = "https://archive.org/metadata";
export const ARCHIVE_DETAILS_URL = "https://archive.org/details";

export const REQUEST_TIMEOUT_MS = 15000;
/** Delay before the single retry (see fetchWithRetry). Longer than the old 250ms so the
 *  retry lands after a brief upstream blip instead of inside it. */
const RETRY_BACKOFF_MS = 1000;
const USER_AGENT = "347movies/1.0 (+https://347movies.pages.dev; catalog fetcher)";

const LEGAL_CLAUSE = "(licenseurl:https://creativecommons.org* OR licenseurl:http://creativecommons.org*)";
const LEGAL_COLLECTIONS = "collection:(feature_films OR prelinger OR moviesandfilms)";
const BASE_CLAUSE = `${LEGAL_CLAUSE} AND ${LEGAL_COLLECTIONS} AND mediatype:movies`;

/**
 * Classic TV catalog gate: the same license gate applied to archive.org's curated classic-TV
 * collection (Twilight Zone, Bonanza, The Lone Ranger, The Beverly Hillbillies, I Love Lucy
 * disks, Fleischer cartoons…). Measured live 2026-08-16: 2,514 legal-marked items (~1,000
 * carry a year in 1950–1969; ~1,180 have no year metadata — the classic PD-TV canon is old
 * but archive.org often omits the year, so a year filter would silently drop half the
 * selection). Same trust model as the film gate: the declared licenseurl mark IS the check
 * (the detail page additionally fails closed when a license cannot be verified).
 * `classic_tv` is looser than the curated film pools — a handful of modern shows carry
 * self-declared marks (e.g. Farscape, Kojak uploads) — documented in the Classic TV ledger
 * entry; the films-only clause is NOT applied here because for TV, episodes ARE the content.
 */
export const TV_BASE_CLAUSE = `${LEGAL_CLAUSE} AND collection:classic_tv AND mediatype:movies`;

/**
 * Anime catalog gate: the same license gate over archive.org's `anime` collection, plus a
 * pre-1975 year cutoff. Measured live 2026-08-17: 37,632 movies in the collection; the
 * licensed subset is 1,744 — but the vast majority are modern fan uploads of copyrighted
 * shows with self-declared marks (Keroro Korean dubs, 1080p rips). Year-band breakdown of
 * the licensed subset: 1975+ = 1,434, year missing = 286, pre-1975 = 24. The strict
 * pre-1975 cutoff keeps only the genuinely golden-age titles (New 3 Stooges, Golden Bat,
 * Princess Knight, Batfink…); the year-missing band is NOT included because in the anime
 * collection missing year ≈ modern upload (Slayers Next, Kamikaze Kaitou Jeanne, Dragon
 * Ball — sampled live), unlike classic_tv where yearless ≈ old. Every excluded title stays
 * reachable by direct URL (the detail page still verifies license per-item). Episodes ARE
 * the content, so the films-only exclusion does not apply here.
 */
export const ANIME_BASE_CLAUSE = `${LEGAL_CLAUSE} AND collection:anime AND mediatype:movies AND year:[* TO 1974]`;

/**
 * Animation/cartoons catalog gate: the same license gate over `animationandcartoons`.
 * Measured live 2026-08-17: 15,680 movies in the collection, 226 carry the license mark
 * (mostly genuine public-domain shorts — Looney Tunes, Merrie Melodies, early Disney).
 * Episodes ARE the content, so the films-only exclusion does not apply here.
 */
export const CARTOONS_BASE_CLAUSE = `${LEGAL_CLAUSE} AND collection:animationandcartoons AND mediatype:movies`;

/**
 * Music & concert catalog gate: the same license gate over the live-music collections
 * `GratefulDead` + `etree` (measured live 2026-08-17: 1,455 license-marked recordings —
 * tapers' audience/soundboard recordings, CC-licensed by the tapers). The mediatype is
 * `etree` (archive.org's dedicated live-music mediatype — NOT `audio`, verified live:
 * `mediatype:audio` matches 0 in these collections), so the gate pins that; the detail
 * page renders the audio player like Old Time Radio (the items carry mp3/ogg files).
 * Episodes/tracks ARE the content, so the films-only exclusion does not apply.
 * (The `documentary`/`educationalfilms` collections were probed and REJECTED for this
 * gate: educationalfilms has only 10 license-marked items of 4,131 — like classic_films,
 * the PD documentary canon mostly carries no licenseurl, so a gate there would be
 * dishonest or nearly empty. Prelinger newsreels (52) are already inside the films pool.)
 */
export const MUSIC_BASE_CLAUSE = `${LEGAL_CLAUSE} AND collection:(GratefulDead OR etree) AND mediatype:etree`;

/**
 * Old Time Radio catalog gate: the same license gate over `oldtimeradio`. Measured live
 * 2026-08-17: 1,653 license-marked items (Suspense, The Shadow, Burns & Allen, Fibber
 * McGee…), all mediatype:audio — the collection is pure radio drama/comedy from the
 * golden age, so the gate swaps the mediatype bound instead of the year bound. Episodes
 * ARE the content (each item is a multi-episode series), so the films-only exclusion does
 * not apply. The detail page renders an audio player for these (lib/layout.ts) and still
 * fails closed per-item on license verification.
 */
export const OTR_BASE_CLAUSE = `${LEGAL_CLAUSE} AND collection:oldtimeradio AND mediatype:audio`;

/** Which curated catalog an index/query serves: films, TV, anime, cartoons, OTR, or music. */
export type IndexVariant = "films" | "tv" | "anime" | "cartoons" | "otr" | "music";

/**
 * The legality+collection gate for a catalog variant. One home for "which gate does a
 * variant use": both the live search path and the index-build path select through this,
 * so a gate change (or a fourth variant) lands in exactly one place.
 */
function baseClauseFor(variant: IndexVariant = "films"): string {
  switch (variant) {
    case "tv":
      return TV_BASE_CLAUSE;
    case "anime":
      return ANIME_BASE_CLAUSE;
    case "cartoons":
      return CARTOONS_BASE_CLAUSE;
    case "otr":
      return OTR_BASE_CLAUSE;
    case "music":
      return MUSIC_BASE_CLAUSE;
    default:
      return BASE_CLAUSE;
  }
}

const SEARCH_FIELDS = [
  "identifier",
  "title",
  "year",
  "description",
  "creator",
  "subject",
  "genre",
  "licenseurl",
  "addeddate",
  "date",
  "runtime",
  "rights",
];

/**
 * The shared filter vocabulary for "query the catalog" — the fields that travel together
 * across both backends: the in-memory index (lib/catalog-index.ts, `CatalogQuery`) and the
 * live archive.org client (`ArchiveSearchParams`). Each backend adds its own query concept
 * and sort set on top: the index has `keyword` + `IndexSort` (newest included), the live
 * client has `query` + the Solr sort set. `decadeFrom`/`decadeTo` are a pair — both or
 * neither. `variant` selects the legality gate (films union vs classic TV).
 */
export interface CatalogFilter {
  /** Which curated catalog the query runs against (films union or classic TV). */
  variant?: IndexVariant;
  genreSubject?: string | null;
  decadeFrom?: number | null;
  decadeTo?: number | null;
  /** When true, exclude non-film uploads (episodes, trailers, teasers, music videos,
   *  serial chapters/parts — see lib/film-policy.ts) so every catalog view — search,
   *  browse, home sections, random — presents feature films. Measured live 2026-08-16:
   *  the legal union (18,488) -> 15,917 films, Solr-identical. The default differs per
   *  backend: for the index path an omitted value means the films-only catalog policy;
   *  for the live path it means the full gate superset (the index build relies on that). */
  filmsOnly?: boolean;
}

export interface ArchiveSearchParams extends CatalogFilter {
  /** Solr full-text query (already sanitized); omitted/empty means the gate alone. */
  query?: string | null;
  sort?: "recent" | "title" | "oldest";
  page: number;
  rows: number;
}

export interface ArchiveSearchResult {
  numFound: number;
  docs: Record<string, unknown>[];
}

const SORT_CLAUSES: Record<string, string> = {
  recent: "addeddate desc",
  title: "title asc",
  oldest: "year asc",
};

export function escapeSolr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function withTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * Fetch with one automatic retry on transient failures (network error or HTTP 5xx). Same
 * pattern as the sitemap builder. Proved necessary live (2026-08-15): during a movie-page
 * sweep, 3 of 24 pages hit transient archive.org 5xx under load and surfaced as hard 502s;
 * all 3 recovered on a manual retry, so the client now performs that retry itself. 4xx
 * responses are never retried (they are permanent). Worst case adds one extra request round.
 */
async function fetchWithRetry(url: string, init: RequestInit, fetchImpl: typeof fetch, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  let lastStatus = 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { signal, clear } = withTimeout(timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal });
      clear();
      if (res.ok || res.status < 500) return res;
      lastStatus = res.status;
    } catch (err) {
      clear();
      lastErr = err;
    }
    // Back off before the retry so a transient archive.org connection drop has time to
    // clear. 250ms proved too short live (2026-08-17): the legality-gated advancedsearch
    // query runs 12–16s and the second attempt still hit the same dropped connection.
    if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
  }
  if (lastStatus > 0) {
    throw new ArchiveError(lastStatus === 404 ? 404 : 502, `archive.org returned ${lastStatus}`);
  }
  throw new ArchiveError(502, "archive.org request failed", { cause: lastErr });
}

async function getJson(
  url: URL,
  fetchImpl: typeof fetch,
  extraHeaders: Record<string, string> = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithRetry(url.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...extraHeaders },
    }, fetchImpl, timeoutMs);
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError(502, "archive.org request failed", { cause: err });
  }
  try {
    return (await res.json()) as unknown;
  } catch (err) {
    throw new ArchiveError(502, "archive.org returned invalid JSON", { cause: err });
  }
}

export async function searchArchive(
  params: ArchiveSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchiveSearchResult> {
  const clauses: string[] = [baseClauseFor(params.variant)];
  if (params.filmsOnly) clauses.push(FILMS_ONLY_SOLR_CLAUSE);
  if (params.query) clauses.push(`(${params.query})`);
  if (params.genreSubject) clauses.push(`subject:("${escapeSolr(params.genreSubject)}")`);
  if (params.decadeFrom !== null && params.decadeFrom !== undefined && params.decadeTo !== null && params.decadeTo !== undefined) {
    clauses.push(`year:[${params.decadeFrom} TO ${params.decadeTo}]`);
  }

  const url = new URL(ARCHIVE_SEARCH_URL);
  url.searchParams.set("q", clauses.join(" AND "));
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", String(params.rows));
  url.searchParams.set("page", String(params.page));
  for (const field of SEARCH_FIELDS) url.searchParams.append("fl[]", field);
  if (params.sort && SORT_CLAUSES[params.sort]) {
    url.searchParams.set("sort[]", SORT_CLAUSES[params.sort] as string);
  }

  const data = (await getJson(url, fetchImpl)) as { response?: { numFound?: unknown; docs?: unknown } };
  const response = data.response;
  if (!response || !Array.isArray(response.docs)) {
    throw new ArchiveError(502, "archive search returned an unexpected shape");
  }
  return {
    numFound: typeof response.numFound === "number" ? response.numFound : 0,
    docs: response.docs as Record<string, unknown>[],
  };
}

/**
 * Full-catalog fetch for the sitemap: ONE no-page request returns the entire legal union
 * (verified live 2026-08-15: rows=50000 without `page` returns all 18,489 docs, ~1.4MB,
 * ~7.5s). archive.org's deep-paging cap is 10,000 results per query, but it explicitly
 * permits any number of results when no page is specified ("You may request any number of
 * results at one time if you do NOT specify any page"). Minimal fl fields (identifier +
 * addeddate — the only two the sitemap needs) keep the payload small. A longer timeout
 * covers the larger response; deliberately NO retry, because a retry could blow the 30s
 * wall-clock budget (the paged fallback in the sitemap builder covers that case).
 */
export async function fetchSitemapCatalog(
  fetchImpl: typeof fetch = fetch,
): Promise<Array<[string, string]>> {
  const url = new URL(ARCHIVE_SEARCH_URL);
  url.searchParams.set("q", BASE_CLAUSE);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", "50000");
  url.searchParams.append("fl[]", "identifier");
  url.searchParams.append("fl[]", "addeddate");
  const data = (await getJson(url, fetchImpl, {}, 25000)) as { response?: { docs?: unknown } };
  const docs = data.response?.docs;
  if (!Array.isArray(docs)) {
    throw new ArchiveError(502, "archive search returned an unexpected shape");
  }
  const entries: Array<[string, string]> = [];
  for (const doc of docs) {
    const record = doc as Record<string, unknown>;
    const id = String(record["identifier"] ?? "");
    if (id) entries.push([id, String(record["addeddate"] ?? "")]);
  }
  return entries;
}

/**
 * Full-catalog docs for the local catalog index (lib/catalog-index.ts). ONE no-page
 * request returns the entire legal union (measured 2026-08-15: rows=50000 without `page`
 * → 18,488 docs, 4.77MB, ~9.6s with the six card/index fields below). Fields are the
 * minimal set the browse cards + filters need: identifier, title, year, addeddate (sort),
 * subject (genre/decade filters), licenseurl (keeps records carrying their legal license).
 * Deliberately NO retry: a retry could blow the 30s wall-clock budget; the paged fallback
 * in the index builder covers that case.
 */
export async function fetchCatalogIndexDocs(
  fetchImpl: typeof fetch = fetch,
  variant: IndexVariant = "films",
): Promise<Record<string, unknown>[]> {
  const url = new URL(ARCHIVE_SEARCH_URL);
  url.searchParams.set("q", baseClauseFor(variant));
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", "50000");
  for (const field of ["identifier", "title", "year", "addeddate", "subject", "licenseurl"]) {
    url.searchParams.append("fl[]", field);
  }
  const data = (await getJson(url, fetchImpl, {}, 25000)) as { response?: { docs?: unknown } };
  const docs = data.response?.docs;
  if (!Array.isArray(docs)) {
    throw new ArchiveError(502, "archive search returned an unexpected shape");
  }
  return docs as Record<string, unknown>[];
}

export interface ArchiveMetadataResponse {
  metadata?: Record<string, unknown>;
  files?: unknown[];
  isDark: boolean;
  /** Download node (`server` field, e.g. `dn600208.us.archive.org`), for the mirror option. */
  server?: string | null;
  /** Storage path (`dir` field, e.g. `/0/items/it-1927`), paired with `server`. */
  dir?: string | null;
}

export async function fetchMetadata(
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchiveMetadataResponse> {
  const url = new URL(`${ARCHIVE_METADATA_URL}/${encodeURIComponent(identifier)}`);
  const data = (await getJson(url, fetchImpl)) as Record<string, unknown>;
  return {
    metadata: data["metadata"] as Record<string, unknown> | undefined,
    files: data["files"] as unknown[] | undefined,
    isDark: data["is_dark"] === true,
    server: typeof data["server"] === "string" ? (data["server"] as string) : null,
    dir: typeof data["dir"] === "string" ? (data["dir"] as string) : null,
  };
}

/**
 * Look up a single identifier in the search index. Used as a license-declaration fallback for
 * items whose metadata endpoint omits licenseurl/rights.
 */
export async function fetchSearchDocByIdentifier(
  identifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const url = new URL(ARCHIVE_SEARCH_URL);
  url.searchParams.set("q", `identifier:("${escapeSolr(identifier)}")`);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", "1");
  for (const field of SEARCH_FIELDS) url.searchParams.append("fl[]", field);
  const data = (await getJson(url, fetchImpl)) as { response?: { docs?: unknown } };
  const docs = data.response?.docs;
  if (Array.isArray(docs) && docs.length > 0) {
    return docs[0] as Record<string, unknown>;
  }
  return null;
}
