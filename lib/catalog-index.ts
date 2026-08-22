/**
 * Local catalog index — ONE edge-cached copy of the full legal catalog (~18,488 films,
 * ~4.8MB as of 2026-08-15) that /api/browse, /sitemap.xml, and /api/random read instead of
 * hitting archive.org's search API per request. The upstream fetch happens at most once per
 * 24h per colocation (Cache API) with an in-isolate cache (30 min) on top, and a stale copy
 * is served if a refresh fails — browse/sitemap/random therefore stop depending on live
 * upstream queries entirely, and the browse pagination cap lifts from 2,400 to the whole
 * catalog.
 *
 * /api/search deliberately stays live on archive.org: its relevance/stemming/full-text
 * engine beats a local substring match, so quality is preserved where it matters most.
 *
 * The index is only ever built from the legal union (same license+collection gate as every
 * other query); the detail page still performs its own per-film license verification.
 */
import {
  ArchiveError,
  type CatalogFilter,
  fetchCatalogIndexDocs,
  searchArchive,
  type IndexVariant,
} from "./archive.ts";
import { edgeCacheMatch, edgeCachePut } from "./edge-cache.ts";
import { isNonFilmTitle } from "./film-policy.ts";
import { normalizeSearchDoc, type MovieRecord } from "./normalize.ts";

/** Max fresh age for the built index; an older copy triggers a rebuild. */
export const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
/** In-isolate cache TTL: how often a colocation re-reads the (edge-cached) index. */
export const ISOLATE_TTL_MS = 30 * 60 * 1000;
/** Paged-fallback cap: the size proven to build inside the 30s wall-clock budget. */
const FALLBACK_MAX_URLS = 5000;
/** Safety cap mirroring the sitemap format's 50,000-URL ceiling. */
const MAX_CATALOG_URLS = 50000;

/** Synthetic Cache API keys for the built indexes (never served to the public). */
const INDEX_CACHE_URLS: Record<IndexVariant, string> = {
  films: "https://347movies.internal/catalog-index-v1",
  tv: "https://347movies.internal/tv-index-v1",
  // v2: the 2026-08-17 gate change added year:[* TO 1974] to the anime pool — bumping the
  // cache key forces a rebuild instead of waiting out the 24h edge TTL on the old pool.
  anime: "https://347movies.internal/anime-index-v2",
  cartoons: "https://347movies.internal/cartoons-index-v1",
  otr: "https://347movies.internal/otr-index-v1",
  music: "https://347movies.internal/music-index-v1",
  documentaries: "https://347movies.internal/documentaries-index-v1",
  ted: "https://347movies.internal/ted-index-v1",
  sports: "https://347movies.internal/sports-index-v1",
  shorts: "https://347movies.internal/shorts-index-v1",
  silents: "https://347movies.internal/silents-index-v1",
  publictv: "https://347movies.internal/publictv-index-v1",
  science: "https://347movies.internal/science-index-v1",
  govfilms: "https://347movies.internal/govfilms-index-v1",
  audiobooks: "https://347movies.internal/audiobooks-index-v1",
  records: "https://347movies.internal/records-index-v1",
  ephemera: "https://347movies.internal/ephemera-index-v1",
  space: "https://347movies.internal/space-index-v1",
  footage: "https://347movies.internal/footage-index-v1",
};

/** Raw archive.org search doc subset carried by the index (fields from fetchCatalogIndexDocs). */
export interface IndexedDoc {
  identifier: string;
  title: string;
  year?: unknown;
  addeddate?: unknown;
  subject?: unknown;
  licenseurl?: unknown;
}

interface CachedIndex {
  builtAt: number;
  docs: IndexedDoc[];
}

/** In-isolate caches (one per variant): parsed once per colocation, refreshed when stale. */
const isolateCaches: Partial<Record<IndexVariant, { docs: IndexedDoc[]; fetchedAt: number }>> = {};
/** Single-flight: concurrent cold reads of a variant share one upstream build instead of racing (see getCatalogIndex). */
const inflightBuilds: Partial<Record<IndexVariant, Promise<IndexedDoc[]>>> = {};

function toIndexedDocs(raw: Record<string, unknown>[]): IndexedDoc[] {
  const docs: IndexedDoc[] = [];
  for (const doc of raw) {
    const id = String(doc["identifier"] ?? "");
    if (!id) continue;
    docs.push({
      identifier: id,
      title: String(doc["title"] ?? id),
      year: doc["year"],
      addeddate: doc["addeddate"],
      subject: doc["subject"],
      licenseurl: doc["licenseurl"],
    });
  }
  return docs;
}

/**
 * Build the index from archive.org: one no-page request for the whole legal union, with the
 * proven paged fallback (rows=1000, per-page retry, identifier dedupe) bounded so it
 * completes inside the 30s wall-clock budget.
 */
export async function buildCatalogIndex(
  fetchImpl: typeof fetch = fetch,
  variant: IndexVariant = "films",
): Promise<IndexedDoc[]> {
  try {
    const docs = await fetchCatalogIndexDocs(fetchImpl, variant);
    return toIndexedDocs(docs.slice(0, MAX_CATALOG_URLS));
  } catch (err) {
    if (err instanceof ArchiveError) {
      const paged: IndexedDoc[] = [];
      const seen = new Set<string>();
      const rows = 1000;
      const MAX_PAGES = Math.ceil(FALLBACK_MAX_URLS / rows) + 1;
      for (let page = 1; paged.length < FALLBACK_MAX_URLS && page <= MAX_PAGES; page++) {
        let docs: Record<string, unknown>[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const result = await searchArchive({ page, rows, variant });
            docs = result.docs;
            break;
          } catch (pageErr) {
            if (attempt === 1) throw pageErr;
          }
        }
        for (const doc of docs) {
          const id = String(doc["identifier"] ?? "");
          if (id && !seen.has(id)) {
            seen.add(id);
            paged.push(toIndexedDocs([doc])[0] as IndexedDoc);
          }
          if (paged.length >= FALLBACK_MAX_URLS) break;
        }
      }
      return paged;
    }
    throw err;
  }
}

/**
 * Read the index: in-isolate cache first, then the edge Cache API, then build. A stale copy
 * is served when a refresh fails (the index never goes away because of an upstream hiccup);
 * only a fully-cold build failure throws, so callers fail closed.
 */
export async function getCatalogIndex(
  fetchImpl: typeof fetch = fetch,
  variant: IndexVariant = "films",
): Promise<IndexedDoc[]> {
  const now = Date.now();
  const cacheUrl = INDEX_CACHE_URLS[variant];
  const isolate = isolateCaches[variant];

  // 1. Fresh in-isolate copy.
  if (isolate && now - isolate.fetchedAt < ISOLATE_TTL_MS) {
    return isolate.docs;
  }

  // 2. Edge Cache API copy (fresh within INDEX_TTL_MS).
  let stored: CachedIndex | null = null;
  try {
    const res = await edgeCacheMatch(cacheUrl);
    if (res) {
      const parsed = (await res.json()) as CachedIndex;
      if (parsed && Array.isArray(parsed.docs) && parsed.docs.length > 0) {
        stored = parsed;
      }
    }
  } catch {
    // ignore: fall through to build
  }
  if (stored && now - stored.builtAt < INDEX_TTL_MS) {
    isolateCaches[variant] = { docs: stored.docs, fetchedAt: now };
    return stored.docs;
  }

  // 3. Build fresh (or serve the stale edge copy if the build fails). The build is
  //    single-flighted: concurrent cold callers share one upstream fetch (a racing herd of
  //    builds on a cold colocation would each pay the ~10s upstream cost and could blow the
  //    30s wall-clock budget together). Followers await the same promise; each still writes
  //    its own (idempotent) edge cache copy and isolate cache on success, and falls back to
  //    its own stale copy on failure.
  try {
    // Single-flighted per variant: concurrent cold callers share one upstream fetch (a racing
    // herd of builds on a cold colocation would each pay the ~10s upstream cost and could blow
    // the 30s wall-clock budget together). Followers await the same promise; each still writes
    // its own (idempotent) edge cache copy and isolate cache on success, and falls back to its
    // own stale copy on failure.
    if (!inflightBuilds[variant]) {
      inflightBuilds[variant] = buildCatalogIndex(fetchImpl, variant).finally(() => {
        delete inflightBuilds[variant];
      });
    }
    const docs = await inflightBuilds[variant];
    const payload: CachedIndex = { builtAt: now, docs };
    try {
      const response = new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      });
      await edgeCachePut(cacheUrl, response, 86400);
    } catch {
      // caching is best-effort; the in-isolate copy below still serves this build
    }
    isolateCaches[variant] = { docs, fetchedAt: now };
    return docs;
  } catch (err) {
    if (stored && stored.docs.length > 0) {
      // Refresh failed: serve the last known index rather than failing the site.
      isolateCaches[variant] = { docs: stored.docs, fetchedAt: now };
      return stored.docs;
    }
    throw err;
  }
}

export interface IndexFilter {
  genreSubject?: string | null;
  decadeFrom?: number | null;
  decadeTo?: number | null;
  /** Title keyword search: the title must contain ANY token (>=3 chars) of the keyword,
   *  case-insensitive substring match. Loose by design — a discovery filter for curated
   *  rows (e.g. the "Hong Kong action" home feed: `dubbed subtitled kung shaolin wong`),
   *  not a substitute for the live Solr search's relevance engine. */
  keyword?: string | null;
  /** Exclude non-film uploads (episodes, trailers, teasers, music videos, serial
   *  chapters/parts) — mirrors the Solr `FILMS_ONLY_SOLR_CLAUSE` (lib/film-policy.ts) the
   *  live search uses, so the local index and the live Solr view agree on what counts as
   *  a film. */
  filmsOnly?: boolean;
}

export type IndexSort = "recent" | "title" | "newest" | "oldest";

/**
 * True when the title looks like a non-film upload (serial installment, trailer, teaser,
 * or music video). Mirrors the live Solr exclusion `FILMS_ONLY_SOLR_CLAUSE` token-for-token,
 * verified live 2026-08-15 and re-verified 2026-08-16 after the teaser/music-video additions
 * (local kept-set == Solr kept-set, 15,917 = 15,917, identifier-identical):
 *   - a token starting with episode/season/trailer/teaser,
 *   - the adjacent "music" "video" token pair (Solr's `"music video"` phrase across
 *     punctuation/hyphen boundaries),
 *   - an exact "pilot" token (Solr's un-wildcarded `pilot` never matches plurals like
 *     "Pilots"),
 *   - a bare "ep" token — Solr's `"ep."` phrase normalizes to the bare token, so
 *     "Spook Show ep 14" is dropped by Solr too (probed live),
 *   - the raw title containing "ep.".
 * Apostrophes stay attached (Solr's tokenizer keeps "Pilot's" whole, so it never matches the
 * exact `pilot` token — "Crop Dusting From Pilot's Perspective" stays, probed live).
 * Fidelity notes (measured live): the trailer token drops ~1,451 titles (~34 are real films
 * with bonus-trailer phrasing); chapter+part drop ~1,040 installments; the 2026-08-16
 * teaser/music-video additions drop 10 more (9 genuine non-films; `Teaserama`, a real 1954
 * feature whose title starts with "teaser", is the accepted one-film loss). Every excluded
 * title remains reachable by direct URL (its detail page still renders — the legality gate
 * is unchanged).
 */
/**
 * Genre-subject match mirroring archive.org's Solr phrase semantics EXACTLY (verified live
 * 2026-08-15: local 177 = Solr 177 for `subject:("film noir")`, zero differences). Each
 * subject value is tokenized like Solr (hyphens/slashes/commas are phrase breaks) and the
 * phrase must appear as consecutive tokens in one value — so "Film-Noir" and "Film/Noir"
 * match, while separate `film`/`noir` values do not. Subject may be a single string or an
 * array (the search API returns a bare string for one-value fields).
 */
export function genreSubjectMatches(subjects: unknown, phrase: string): boolean {
  const values = Array.isArray(subjects)
    ? subjects.map(String)
    : subjects === null || subjects === undefined
      ? []
      : [String(subjects)];
  const phraseTokens = phrase.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (phraseTokens.length === 0) return false;
  return values.some((value) => {
    const tokens = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (let i = 0; i + phraseTokens.length <= tokens.length; i++) {
      let ok = true;
      for (let j = 0; j < phraseTokens.length; j++) {
        if (tokens[i + j] !== phraseTokens[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  });
}

/**
 * Title keyword match: ANY whitespace-separated token (>=3 chars, case-insensitive) must
 * appear as a substring of the title. Exported for unit tests and the browse route.
 */
export function keywordMatchesTitle(title: string, keyword: string): boolean {
  const tokens = keyword.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  const lower = title.toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

/** Filter the index by genre subject, decade range, title keyword, and the films-only exclusion. */
export function filterIndex(docs: IndexedDoc[], f: IndexFilter): IndexedDoc[] {
  return docs.filter((doc) => {
    if (f.genreSubject && !genreSubjectMatches(doc.subject, f.genreSubject)) return false;
    if (f.decadeFrom !== null && f.decadeFrom !== undefined) {
      const year = Number(doc.year);
      if (!Number.isFinite(year) || year < (f.decadeFrom ?? 0) || year > (f.decadeTo ?? 9999)) {
        return false;
      }
    }
    if (f.keyword && !keywordMatchesTitle(doc.title, f.keyword)) return false;
    if (f.filmsOnly && isNonFilmTitle(doc.title)) return false;
    return true;
  });
}

/** Deterministic sorts (stable tiebreaks make deep paging reliable). */
export function sortIndex(docs: IndexedDoc[], sort: IndexSort): IndexedDoc[] {
  const sorted = [...docs];
  if (sort === "recent") {
    sorted.sort((a, b) => {
      const da = String(a.addeddate ?? "");
      const db = String(b.addeddate ?? "");
      if (da !== db) return da < db ? 1 : -1; // addeddate desc; missing last
      return a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0;
    });
  } else if (sort === "title") {
    sorted.sort((a, b) => {
      const c = a.title.localeCompare(b.title);
      return c !== 0 ? c : a.identifier < b.identifier ? -1 : 1;
    });
  } else {
    const yearOf = (d: IndexedDoc): number | null => {
      if (d.year === null || d.year === undefined) return null;
      const n = Number(d.year);
      return Number.isFinite(n) ? n : null;
    };
    const byYear = (a: IndexedDoc, b: IndexedDoc, desc: boolean): number => {
      const ya = yearOf(a);
      const yb = yearOf(b);
      if (ya === null && yb !== null) return 1; // unknown years last
      if (yb === null && ya !== null) return -1;
      if (ya !== null && yb !== null && ya !== yb) return desc ? yb - ya : ya - yb;
      const c = a.title.localeCompare(b.title);
      return c !== 0 ? c : a.identifier < b.identifier ? -1 : 1;
    };
    // "newest" = release year desc (modern films lead); "oldest" = release year asc.
    sorted.sort((a, b) => byYear(a, b, sort === "newest"));
  }
  return sorted;
}

export function paginateIndex(
  docs: IndexedDoc[],
  page: number,
  rows: number,
): { results: IndexedDoc[]; total: number; pages: number } {
  const total = docs.length;
  const pages = Math.max(1, Math.ceil(total / rows));
  const start = (page - 1) * rows;
  return { results: docs.slice(start, start + rows), total, pages };
}

/** Map index docs into the same MovieRecord shape the live search produced (browse API contract). */
export function indexDocsToRecords(docs: IndexedDoc[]): MovieRecord[] {
  return docs.map((doc) =>
    normalizeSearchDoc({
      identifier: doc.identifier,
      title: doc.title,
      year: doc.year,
      addeddate: doc.addeddate,
      subject: doc.subject,
      licenseurl: doc.licenseurl,
    }),
  );
}

/**
 * Deep query seam for the films catalog — one call owns the whole pipeline (read the
 * edge-cached index, apply the films-only policy + filters, sort, page, and shape into the
 * API record contract) so callers never compose the steps themselves. The policy default is
 * built in: an omitted `filmsOnly` means the films-only catalog (episodes/trailers are
 * reachable by direct URL and via `films=0`), matching search and random.
 *
 * The filter vocabulary (variant, genreSubject, decadeFrom/To, filmsOnly) is the shared
 * `CatalogFilter` from lib/archive.ts; this adds the index-only query concept (`keyword`)
 * and the index sort set (`IndexSort`, which includes `newest` — the live Solr path can't
 * honor it, so `sort` deliberately stays per-backend).
 */
export interface CatalogQuery extends CatalogFilter {
  /** Title-keyword filter: ANY token >=3 chars, case-insensitive substring. */
  keyword?: string | null;
  sort?: IndexSort;
  /** 1-based page; defaults to 1. */
  page?: number;
  /** Page size; defaults to 24. */
  rows?: number;
}

export interface CatalogPage {
  results: MovieRecord[];
  total: number;
  pages: number;
}

/**
 * Query the films catalog. `getCatalogIndex` handles freshness (in-isolate + edge Cache API
 * + build with stale-serve), so a caller only states what it wants.
 */
export async function queryCatalog(
  query: CatalogQuery = {},
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogPage> {
  const variant: IndexVariant = query.variant ?? "films";
  const docs = await getCatalogIndex(fetchImpl, variant);
  const genreSubject = query.genreSubject ?? null;
  const decadeFrom = query.decadeFrom ?? null;
  const decadeTo = query.decadeTo ?? null;
  const keyword = query.keyword ?? null;
  const sort: IndexSort = query.sort ?? "recent";
  const page = query.page ?? 1;
  const rows = query.rows ?? 24;
  // Films-only is the films catalog's policy default; for TV/anime/cartoons, episodes ARE
  // the content (a serial's installments are the shows you came for).
  const filmsOnly = query.filmsOnly ?? (variant === "films" ? true : false);
  const filtered = filterIndex(docs, { genreSubject, decadeFrom, decadeTo, keyword, filmsOnly });
  const sorted = sortIndex(filtered, sort);
  const { results, total, pages } = paginateIndex(sorted, page, rows);
  return { results: indexDocsToRecords(results), total, pages };
}/** The fifteen pools "Surprise me" draws from, uniformly over items. */
export const RANDOM_VARIANTS: IndexVariant[] = [
  "films",
  "tv",
  "anime",
  "cartoons",
  "otr",
  "music",
  "documentaries",
  "ted",
  "sports",
  "shorts",
  "silents",
  "publictv",
  "science",
  "govfilms",
  "audiobooks",
  "records",
  "ephemera",
  "space",
  "footage",
];

/**
 * A random identifier drawn uniformly across the given catalogs ("Surprise me"), or null
 * when they are all empty. Reads the same edge-cached indexes as queryCatalog; no upstream
 * call. Selection is uniform over items, so each pool is weighted by its size — a silents
 * item is no more likely than a films item, and the documented "Surprise me is uniform"
 * promise holds across the whole watchable catalog.
 *
 * The films pool keeps its films-only policy (never "Episode 18" or a trailer); every other
 * pool is drawn as-is, matching how /api/browse presents it — episodes ARE the content in
 * tv/anime/cartoons, and tracks ARE the content in otr/music. Variant loads are parallel so
 * a cold edge never pays the sum of sequential upstream builds (each is single-flighted and
 * edge-cached anyway).
 */
export async function randomCatalogIdentifier(
  variants: IndexVariant[] = RANDOM_VARIANTS,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const pools = await Promise.all(
    variants.map(async (variant) => {
      const docs = await getCatalogIndex(fetchImpl, variant);
      return variant === "films" ? filterIndex(docs, { filmsOnly: true }) : docs;
    }),
  );
  const total = pools.reduce((n, docs) => n + docs.length, 0);
  if (total === 0) return null;
  let pick = Math.floor(Math.random() * total);
  for (const docs of pools) {
    if (pick < docs.length) return docs[pick]?.identifier ?? null;
    pick -= docs.length;
  }
  return null;
}

/**
 * Test-only seam: clears the module-level in-isolate cache so a test can build a fresh
 * fixture index deterministically. Never called by production code.
 */
export function _resetCatalogIndexCacheForTests(): void {
  for (const key of Object.keys(isolateCaches) as IndexVariant[]) {
    delete isolateCaches[key];
  }
  for (const key of Object.keys(inflightBuilds) as IndexVariant[]) {
    delete inflightBuilds[key];
  }
}
