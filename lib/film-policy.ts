/**
 * Films-only catalog policy — what counts as a film in 347movies.
 *
 * ONE policy with TWO implementations that must stay equivalent:
 *   - `FILMS_ONLY_SOLR_CLAUSE`: the Solr negation the live archive.org search applies
 *     (used by `lib/archive.ts` when `filmsOnly` is set).
 *   - `isNonFilmTitle`: the local token matcher the catalog index applies
 *     (used by `lib/catalog-index.ts`).
 * They are kept equivalent by `tests/film-policy.test.ts` and were verified live
 * 2026-08-15 (15,927 = 15,927) and re-verified 2026-08-16 after the teaser/music-video
 * additions (15,917 = 15,917 — zero identifier differences either way), including the
 * tokenizer edge cases documented on `isNonFilmTitle` below.
 */
export const FILMS_ONLY_SOLR_CLAUSE = '-title:(episode* OR season* OR pilot OR "ep." OR trailer* OR teaser* OR "music video" OR chapter OR part)';

/**
 * True when the title looks like a non-film upload (serial installment, trailer, teaser,
 * music video, or split part). Mirrors `FILMS_ONLY_SOLR_CLAUSE` token-for-token, verified
 * live 2026-08-15 and re-verified 2026-08-16 (local kept-set == Solr kept-set, 15,917 =
 * 15,917, identifier-identical):
 *   - a token starting with episode/season/trailer/teaser (teasers are trailers by
 *     another name — "LovesSecretDomain-Teaser", "snowpiercer red band teaser" drop),
 *   - an exact "pilot" token (Solr's un-wildcarded `pilot` never matches plurals like
 *     "Pilots"),
 *   - an exact "chapter" token but NOT "chapters" — serial installments ("Chapter 10 -
 *     The Iron Death") drop, while complete-serial compilations ("The Phantom - 15
 *     Chapters", "all 12 chapters") stay as the findable films (505 installments drop),
 *   - an exact "part" token — split installments ("Why We Fight: Part I", "batch, part
 *     2") drop (535; one documented edge: "Japanese Relocation: Part Of …" drops too),
 *   - a bare "ep" token — Solr's `"ep."` phrase normalizes to the bare token, so
 *     "Spook Show ep 14" is dropped by Solr too (probed live),
 *   - the raw title containing "ep.",
 *   - the adjacent "music" "video" token pair — Solr's `"music video"` phrase matches
 *     across punctuation/hyphen boundaries ("Official Music Video, Subtitled",
 *     "...-music-video"), exactly like this token-pair check.
 * Apostrophes stay attached (Solr's tokenizer keeps "Pilot's" whole, so it never matches the
 * exact `pilot` token — "Crop Dusting From Pilot's Perspective" stays, probed live).
 * Fidelity note (measured live): 18,488 legal items -> 15,927 films -> 15,917 with the
 * teaser/music-video additions (2026-08-16). The trailer token drops ~1,451 titles (~34
 * real films with bonus-trailer phrasing); chapter+part drop ~1,040 installments; the 10
 * new drops are all genuine non-films except `Teaserama` (a real 1954 feature whose title
 * happens to start with "teaser" — same accepted loss as the trailer case; Solr's `teaser*`
 * wildcard forces the equivalence). Every excluded title remains reachable by direct URL
 * (its detail page still renders — the legality gate is unchanged).
 */
export function isNonFilmTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (t.includes("ep.")) return true;
  const tokens = t.split(/[^a-z0-9']+/).filter(Boolean);
  // "music video" phrase — Solr's `"music video"` matches adjacent tokens across
  // punctuation/hyphen boundaries (music-video, music, video), exactly like this pair.
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === "music" && tokens[i + 1] === "video") return true;
  }
  return tokens.some(
    (w) =>
      w === "ep" ||
      w.startsWith("episode") ||
      w.startsWith("season") ||
      w.startsWith("trailer") ||
      w.startsWith("teaser") ||
      w === "pilot" ||
      w === "chapter" ||
      w === "part",
  );
}
