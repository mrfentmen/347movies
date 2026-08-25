import assert from "node:assert/strict";
import { test } from "node:test";
import {
  _resetCatalogIndexCacheForTests,
  filterIndex,
  genreSubjectMatches,
  getCatalogIndex,
  indexDocsToRecords,
  keywordMatchesTitle,
  paginateIndex,
  queryCatalog,
  RANDOM_VARIANTS,
  randomCatalogIdentifier,
  sortIndex,
  type IndexedDoc,
} from "../lib/catalog-index.ts";

/** A fake archive.org search response the index builder parses (same advancedsearch shape). */
function fakeFetch(docs: Record<string, unknown>[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ response: { docs } }), {
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

const fixtureDocs: Record<string, unknown>[] = [
  { identifier: "film-a", title: "A Silent Classic", year: 1927, addeddate: "2021-01-01T00:00:00Z", subject: ["silent films"] },
  { identifier: "film-b", title: "Noir Nights", year: 1950, addeddate: "2023-06-15T00:00:00Z", subject: ["film noir"] },
  { identifier: "film-c", title: "Western Skies", year: 1955, addeddate: "2022-03-10T00:00:00Z", subject: ["western"] },
  { identifier: "film-d", title: "Episode 5 of a Series", year: 1990, addeddate: "2025-02-20T00:00:00Z", subject: [] },
  { identifier: "film-e", title: "Nightmare Alley trailer", year: 1947, addeddate: "2024-11-02T00:00:00Z", subject: ["film noir"] },
];

const docs: IndexedDoc[] = [
  { identifier: "film-a", title: "A Silent Classic", year: 1927, addeddate: "2021-01-01T00:00:00Z", subject: ["silent films", "romance"] },
  { identifier: "film-b", title: "Noir Nights", year: 1950, addeddate: "2023-06-15T00:00:00Z", subject: ["film noir"] },
  { identifier: "film-c", title: "Western Skies", year: 1955, addeddate: "2022-03-10T00:00:00Z", subject: ["western", "drama"] },
  { identifier: "film-d", title: "Sci-Fi Dreams", year: 1985, addeddate: "2024-11-02T00:00:00Z", subject: ["science fiction"] },
  { identifier: "film-e", title: "Episode 5 of a Series", year: 1990, addeddate: "2025-02-20T00:00:00Z", subject: [] },
  { identifier: "film-f", title: "No Year Film", year: null, addeddate: "2020-05-05T00:00:00Z", subject: [] },
];

test("concurrent cold reads share one upstream build (single-flight)", async () => {
  _resetCatalogIndexCacheForTests();
  let upstreamCalls = 0;
  const countingFetch = (async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({ response: { docs: fixtureDocs } }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const [a, b, c] = await Promise.all([
    getCatalogIndex(countingFetch),
    getCatalogIndex(countingFetch),
    getCatalogIndex(countingFetch),
  ]);
  assert.equal(upstreamCalls, 1, "three concurrent cold reads must share one upstream build");
  assert.equal(a.length, fixtureDocs.length);
  assert.equal(b.length, a.length);
  assert.equal(c.length, a.length);
  _resetCatalogIndexCacheForTests();
});

test("genreSubjectMatches mirrors Solr phrase semantics exactly", () => {
  // Verified live 2026-08-15: 177 = 177 against archive.org's `subject:("film noir")`.
  assert.equal(genreSubjectMatches(["Film Noir"], "film noir"), true); // string-in-array
  assert.equal(genreSubjectMatches("Film Noir classic", "film noir"), true); // bare string field
  assert.equal(genreSubjectMatches(["Film-Noir"], "film noir"), true); // hyphen is a phrase break
  assert.equal(genreSubjectMatches(["Film/Noir"], "film noir"), true); // slash too
  assert.equal(genreSubjectMatches(["film noir, crime drama"], "film noir"), true); // comma list
  assert.equal(genreSubjectMatches(["film", "noir"], "film noir"), false); // separate values do NOT join
  assert.equal(genreSubjectMatches(["Noir film"], "film noir"), false); // order matters
  assert.equal(genreSubjectMatches(null, "film noir"), false);
  assert.equal(genreSubjectMatches([], "film noir"), false);
});

test("filterIndex filters by genre subject (case-insensitive)", () => {
  const noir = filterIndex(docs, { genreSubject: "film noir" });
  assert.deepEqual(noir.map((d) => d.identifier), ["film-b"]);
  const silent = filterIndex(docs, { genreSubject: "silent films" });
  assert.deepEqual(silent.map((d) => d.identifier), ["film-a"]);
});

test("filterIndex filters by decade range and excludes unknown years", () => {
  const twenties = filterIndex(docs, { decadeFrom: 1920, decadeTo: 1929 });
  assert.deepEqual(twenties.map((d) => d.identifier), ["film-a"]);
  const fifties = filterIndex(docs, { decadeFrom: 1950, decadeTo: 1959 });
  assert.deepEqual(fifties.map((d) => d.identifier), ["film-b", "film-c"]);
});

test("filterIndex filmsOnly excludes episode AND trailer titles", () => {
  const withTrailer: IndexedDoc[] = [
    ...docs,
    { identifier: "film-g", title: "Nightmare Alley trailer", year: 1947, addeddate: "2024-01-01T00:00:00Z", subject: ["film noir"] },
    { identifier: "film-h", title: "Showdown In Little Tokyo [with movie Trailers & bonus Kung Fu Trailers]", year: 1991, addeddate: "2024-01-02T00:00:00Z", subject: ["action"] },
    { identifier: "film-i", title: "Trailer Park Boys", year: 2001, addeddate: "2024-01-03T00:00:00Z", subject: [] },
  ];
  const films = filterIndex(withTrailer, { filmsOnly: true });
  const ids = new Set(films.map((d) => d.identifier));
  assert.ok(!ids.has("film-e"), "episode title excluded");
  assert.ok(!ids.has("film-g"), "pure trailer title excluded");
  assert.ok(!ids.has("film-h"), "bonus-trailer film excluded (documented fidelity note)");
  // "Trailer Park Boys" is excluded too: the token-prefix rule matches Solr's
  // `-title:trailer*` exactly, and Solr drops any title whose first token is "trailer".
  assert.ok(!ids.has("film-i"), "token-prefix rule is Solr-faithful (drops Trailer Park Boys)");
  assert.equal(films.length, 5); // a, b, c, d, f survive
});

test("queryCatalog applies the films-only policy by DEFAULT and filters/sorts/pages in one call", async () => {
  _resetCatalogIndexCacheForTests();
  const page = await queryCatalog({ rows: 2, page: 1 }, fakeFetch(fixtureDocs));
  // filmsOnly omitted -> default true: the episode and the trailer are excluded.
  assert.deepEqual(
    page.results.map((r) => r.identifier),
    ["film-b", "film-c"],
  );
  assert.equal(page.total, 3); // a, b, c survive
  assert.equal(page.pages, 2);
  assert.equal(page.results[0]?.year, 1950); // shaped MovieRecord contract (year present)
});

test("queryCatalog filmsOnly:false includes episodes and trailers (explicit opt-out)", async () => {
  _resetCatalogIndexCacheForTests();
  const page = await queryCatalog({ filmsOnly: false, rows: 24 }, fakeFetch(fixtureDocs));
  assert.equal(page.total, 5);
  assert.ok(page.results.some((r) => r.identifier === "film-d"));
  assert.ok(page.results.some((r) => r.identifier === "film-e"));
});

test("queryCatalog honors genre, decade, and sort", async () => {
  _resetCatalogIndexCacheForTests();
  const noir = await queryCatalog(
    { genreSubject: "film noir", sort: "oldest", rows: 24 },
    fakeFetch(fixtureDocs),
  );
  // Noir only: film-b (1950) and the trailer film-e (1947); films-only default drops the trailer.
  assert.deepEqual(noir.results.map((r) => r.identifier), ["film-b"]);
  const twenties = await queryCatalog({ decadeFrom: 1920, decadeTo: 1929 }, fakeFetch(fixtureDocs));
  assert.deepEqual(twenties.results.map((r) => r.identifier), ["film-a"]);
});

test("randomCatalogIdentifier(films) only ever returns films-only identifiers", async () => {
  _resetCatalogIndexCacheForTests();
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const id = await randomCatalogIdentifier(["films"], fakeFetch(fixtureDocs));
    assert.ok(id !== null);
    seen.add(id);
  }
  // Never the episode (film-d) or the trailer (film-e); may hit a, b, or c.
  assert.ok(!seen.has("film-d"));
  assert.ok(!seen.has("film-e"));
  assert.ok(seen.size >= 1);
  assert.ok(["film-a", "film-b", "film-c"].every((id) => seen.has(id)) === (seen.size === 3));
});

test("randomCatalogIdentifier draws from a non-film pool without the films-only filter", async () => {
  _resetCatalogIndexCacheForTests();
  // A per-variant fetch: the documentaries clause returns a marker doc, everything else the
  // films fixture — proving the non-film pools are reachable and NOT films-only-filtered.
  const perVariantFetch = (async (input: unknown) => {
    const url = String(input);
    const docs = url.includes("culturalandacademicfilms")
      ? [{ identifier: "doc-1", title: "A Documentary", year: 1995, addeddate: "2020-01-01T00:00:00Z", subject: [] }]
      : fixtureDocs;
    return new Response(JSON.stringify({ response: { docs } }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const id = await randomCatalogIdentifier(["documentaries"], perVariantFetch);
    assert.ok(id !== null);
    seen.add(id);
  }
  assert.deepEqual(seen, new Set(["doc-1"]));
});

test("randomCatalogIdentifier returns null when every pool is empty", async () => {
  _resetCatalogIndexCacheForTests();
  const emptyFetch = (async () =>
    new Response(JSON.stringify({ response: { docs: [] } }), {
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  assert.equal(await randomCatalogIdentifier(["films", "silents"], emptyFetch), null);
});

test("RANDOM_VARIANTS spans all twenty-two pools so Surprise me can land on any catalog item", () => {
  assert.deepEqual(RANDOM_VARIANTS, [
    "films", "tv", "anime", "cartoons", "otr", "music",
    "documentaries", "ted", "sports", "shorts", "silents", "publictv", "science",
    "govfilms", "audiobooks", "records", "ephemera", "space", "footage", "wwii",
    "newsreels", "nfpf",
  ]);
});

test("keywordMatchesTitle: ANY token >=3 chars, case-insensitive substring", () => {
  assert.equal(keywordMatchesTitle("Drunken Master [Dubbed & Subtitled]", "dubbed"), true);
  assert.equal(keywordMatchesTitle("Shaolin Temple", "subtitled kung shaolin"), true); // OR across tokens
  assert.equal(keywordMatchesTitle("Shaolin Temple", "dubbed subtitled kung shaolin"), true);
  assert.equal(keywordMatchesTitle("Casablanca", "dubbed subtitled kung"), false);
  assert.equal(keywordMatchesTitle("A Film", "dubbed"), false);
  assert.equal(keywordMatchesTitle("DUBBED VERSION", "dubbed"), true); // case-insensitive
  assert.equal(keywordMatchesTitle("Drunken Master", "fu"), false); // <3-char tokens ignored
  assert.equal(keywordMatchesTitle("Anything", ""), false); // empty keyword matches nothing
});

test("filterIndex keyword filters by title substring (ANY token)", () => {
  const hkDocs: IndexedDoc[] = [
    { identifier: "hk-1", title: "Drunken Master [Dubbed & Subtitled]", year: 1978, addeddate: "2026-01-01T00:00:00Z", subject: [] },
    { identifier: "hk-2", title: "Shaolin & Wu-Tang [Subtitled]", year: 1983, addeddate: "2026-02-01T00:00:00Z", subject: [] },
    { identifier: "hk-3", title: "The 8 Diagram Pole Fighter [Dubbed]", year: 1984, addeddate: "2026-03-01T00:00:00Z", subject: [] },
    { identifier: "hk-4", title: "Hard Boiled", year: 1992, addeddate: "2026-04-01T00:00:00Z", subject: [] },
  ];
  const hk = filterIndex(hkDocs, { keyword: "dubbed subtitled kung shaolin wong" });
  assert.deepEqual(hk.map((d) => d.identifier), ["hk-1", "hk-2", "hk-3"]); // Hard Boiled matches none of the tokens
});

test("sortIndex newest: release year desc, unknown years last", () => {
  // docs: a 1927, b 1950, c 1955, d 1985, e 1990, f unknown
  const sorted = sortIndex(docs, "newest");
  assert.deepEqual(sorted.map((d) => d.identifier), ["film-e", "film-d", "film-c", "film-b", "film-a", "film-f"]);
});

test("queryCatalog keyword filter flows through to the index filter", async () => {
  _resetCatalogIndexCacheForTests();
  const page = await queryCatalog({ keyword: "dubbed subtitled kung" }, fakeFetch(fixtureDocs));
  assert.equal(page.total, 0); // base fixture has no matching titles; proves pass-through
});

test("queryCatalog tv variant: separate index, episodes NOT excluded, films default untouched", async () => {
  const tvDocs: Record<string, unknown>[] = [
    { identifier: "tv-a", title: "The Twilight Zone S01E01 Where Is Everybody", year: 1959, addeddate: "2026-01-01T00:00:00Z", subject: [] },
    { identifier: "tv-b", title: "Bonanza S01E01 A Rose for Lotta", year: 1959, addeddate: "2026-02-01T00:00:00Z", subject: [] },
    { identifier: "tv-c", title: "The Lone Ranger (1950) Episode 1", year: 1950, addeddate: "2026-03-01T00:00:00Z", subject: [] },
  ];
  _resetCatalogIndexCacheForTests();

  // TV variant keeps episodes (they ARE the content) and serves only the TV docs;
  // default sort is recent (addeddate desc): tv-c (2026-03), tv-b (2026-02), tv-a (2026-01).
  const tv = await queryCatalog({ variant: "tv", rows: 24 }, fakeFetch(tvDocs));
  assert.deepEqual(
    tv.results.map((r) => r.identifier),
    ["tv-c", "tv-b", "tv-a"],
  );
  assert.equal(tv.total, 3);

  // The films variant is a separate index with its own cache slot: it does NOT see TV docs,
  // and keeps its films-only default against ITS OWN fixture (film-d the episode is dropped).
  _resetCatalogIndexCacheForTests();
  const films = await queryCatalog({ rows: 24 }, fakeFetch(fixtureDocs));
  assert.ok(films.total > 0);
  assert.ok(films.results.every((r) => r.identifier !== "tv-a"));
  assert.ok(films.results.every((r) => r.identifier !== "film-d"));
});

test("queryCatalog anime + cartoons variants: separate indexes, episodes NOT excluded", async () => {
  const animeDocs: Record<string, unknown>[] = [
    { identifier: "anime-a", title: "Astro Boy Episode 1", year: 1963, addeddate: "2026-01-01T00:00:00Z", subject: [] },
    { identifier: "anime-b", title: "Gigantor Episode 5", year: 1963, addeddate: "2026-02-01T00:00:00Z", subject: [] },
  ];
  const cartoonsDocs: Record<string, unknown>[] = [
    { identifier: "cartoon-a", title: "Bugs Bunny Episode 12", year: 1943, addeddate: "2026-01-01T00:00:00Z", subject: [] },
  ];
  _resetCatalogIndexCacheForTests();

  // Anime variant keeps episodes (they ARE the content) and serves only the anime docs;
  // default sort is recent (addeddate desc): anime-b (2026-02), anime-a (2026-01).
  const anime = await queryCatalog({ variant: "anime", rows: 24 }, fakeFetch(animeDocs));
  assert.equal(anime.total, 2);
  assert.deepEqual(anime.results.map((r) => r.identifier), ["anime-b", "anime-a"]);

  // Cartoons variant is its own index with its own cache slot: it does NOT see the anime
  // docs, and keeps episodes (a serial installment is the show you came for).
  _resetCatalogIndexCacheForTests();
  const cartoons = await queryCatalog({ variant: "cartoons", rows: 24 }, fakeFetch(cartoonsDocs));
  assert.equal(cartoons.total, 1);
  assert.equal(cartoons.results[0]?.identifier, "cartoon-a");
  assert.ok(cartoons.results.every((r) => r.identifier !== "anime-a"));

  // OTR variant is its own index with its own cache slot, and keeps episodes (each item
  // is a multi-episode radio series — the installments ARE the content).
  const otrDocs: Record<string, unknown>[] = [
    { identifier: "radio-a", title: "The Shadow Episode 1", year: 1938, addeddate: "2026-01-01T00:00:00Z", subject: [] },
    { identifier: "radio-b", title: "Suspense Episode 42", year: 1943, addeddate: "2026-02-01T00:00:00Z", subject: [] },
  ];
  _resetCatalogIndexCacheForTests();
  const otr = await queryCatalog({ variant: "otr", rows: 24 }, fakeFetch(otrDocs));
  assert.equal(otr.total, 2);
  assert.deepEqual(otr.results.map((r) => r.identifier), ["radio-b", "radio-a"]);
  assert.ok(otr.results.every((r) => r.identifier !== "anime-a"));

  // Music variant is its own index with its own cache slot.
  const musicDocs: Record<string, unknown>[] = [
    { identifier: "gd-1977", title: "Grateful Dead Live at Cornell 1977", year: 1977, addeddate: "2026-01-01T00:00:00Z", subject: [] },
  ];
  _resetCatalogIndexCacheForTests();
  const music = await queryCatalog({ variant: "music", rows: 24 }, fakeFetch(musicDocs));
  assert.equal(music.total, 1);
  assert.equal(music.results[0]?.identifier, "gd-1977");
  assert.ok(music.results.every((r) => r.identifier !== "radio-a"));
});

test("sortIndex recent: addeddate desc, unknown/missing addeddate last", () => {
  const sorted = sortIndex(docs, "recent");
  assert.deepEqual(
    sorted.map((d) => d.identifier),
    ["film-e", "film-d", "film-b", "film-c", "film-a", "film-f"],
  );
});

test("sortIndex title: locale order with stable identifier tiebreak", () => {
  const sorted = sortIndex(
    [
      { identifier: "z-dup", title: "Alpha", addeddate: "2020-01-01T00:00:00Z" },
      { identifier: "a-dup", title: "Alpha", addeddate: "2020-01-01T00:00:00Z" },
      { identifier: "beta", title: "Beta", addeddate: "2020-01-01T00:00:00Z" },
    ],
    "title",
  );
  assert.deepEqual(
    sorted.map((d) => d.identifier),
    ["a-dup", "z-dup", "beta"],
  );
});

test("sortIndex oldest: year asc, unknown years last, title tiebreak", () => {
  const sorted = sortIndex(docs, "oldest");
  assert.deepEqual(
    sorted.map((d) => d.identifier),
    ["film-a", "film-b", "film-c", "film-d", "film-e", "film-f"],
  );
});

test("paginateIndex slices by page and reports total/pages", () => {
  const p1 = paginateIndex(docs, 1, 2);
  assert.deepEqual(p1.results.map((d) => d.identifier), ["film-a", "film-b"]);
  assert.equal(p1.total, 6);
  assert.equal(p1.pages, 3);
  const p3 = paginateIndex(docs, 3, 2);
  assert.deepEqual(p3.results.map((d) => d.identifier), ["film-e", "film-f"]);
  const beyond = paginateIndex(docs, 9, 2);
  assert.deepEqual(beyond.results, []);
});

test("paginateIndex handles empty input and empty rows-safe page", () => {
  const empty = paginateIndex([], 1, 24);
  assert.equal(empty.total, 0);
  assert.equal(empty.pages, 1);
  assert.deepEqual(empty.results, []);
});

test("indexDocsToRecords produces the browse API record shape", () => {
  const records = indexDocsToRecords([docs[0] as IndexedDoc]);
  const r = records[0] as { identifier: string; title: string; year: number | null; license: string | null; thumbnails: { small: string } };
  assert.equal(r.identifier, "film-a");
  assert.equal(r.title, "A Silent Classic");
  assert.equal(r.year, 1927);
  assert.equal(r.license, null); // index docs carry no licenseurl in this fixture
  assert.ok(r.thumbnails.small.includes("__ia_thumb.jpg"));
});
