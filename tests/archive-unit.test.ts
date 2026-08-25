/**
 * UNIT tests for the archive.org client's query assembly and parsing (lib/archive.ts).
 * Mocked fetch — fast and deterministic, unlike tests/archive.test.ts (live integration).
 * The retry policy itself is covered in tests/retry.test.ts; this file covers everything
 * else: escapeSolr, the Solr clause assembly, response parsing, and the four fetchers.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARCHIVE_METADATA_URL,
  ArchiveError,
  escapeSolr,
  fetchCatalogIndexDocs,
  fetchMetadata,
  fetchSearchDocByIdentifier,
  fetchSitemapCatalog,
  LEGAL_CLAUSE,
  searchArchive,
} from "../lib/archive.ts";
import { FILMS_ONLY_SOLR_CLAUSE } from "../lib/film-policy.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface MockOptions {
  /** Return a response per call; receives the request URL and 1-based call number. */
  handler?: (url: string, call: number) => Response;
  calls?: { count: number };
}

function makeFetch(opts: MockOptions = {}): typeof fetch {
  let call = 0;
  return async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    call += 1;
    if (opts.calls) opts.calls.count = call;
    if (opts.handler) return opts.handler(url, call);
    return jsonResponse({});
  };
}

function qOf(url: string): string {
  return new URL(url).searchParams.get("q") ?? "";
}

test("escapeSolr escapes double quotes and backslashes", () => {
  assert.equal(escapeSolr("plain"), "plain");
  assert.equal(escapeSolr('a"b'), 'a\\"b');
  assert.equal(escapeSolr('a"b\\c'), 'a\\"b\\\\c');
  assert.equal(escapeSolr('say "hi" \\ ok'), 'say \\"hi\\" \\\\ ok');
});

test("searchArchive always pins the legal base clause (the exact LEGAL_CLAUSE constant)", async () => {
  const calls: string[] = [];
  const fetchImpl = makeFetch({
    handler: (url) => {
      calls.push(url);
      return jsonResponse({ response: { numFound: 0, docs: [] } });
    },
  });
  await searchArchive({ page: 1, rows: 24 }, fetchImpl);
  const q = qOf(calls[0] as string);
  // Pinning the constant itself (not a literal) means a refactor that renames the clause,
  // drops the http:// arm, or swaps hosts fails here — and with it every pool gate and the
  // weekly license sweep, which all build on this single source of truth.
  assert.ok(q.includes(LEGAL_CLAUSE), "query embeds the exact LEGAL_CLAUSE constant");
  assert.ok(
    LEGAL_CLAUSE.includes("licenseurl:https://creativecommons.org*") &&
      LEGAL_CLAUSE.includes("licenseurl:http://creativecommons.org*"),
    "LEGAL_CLAUSE still gates both http and https declared marks",
  );
  assert.ok(q.includes("mediatype:movies"), "mediatype:movies in the query");
  assert.ok(q.includes("collection:(feature_films OR prelinger OR moviesandfilms)"), "collections in the query");
});

test("searchArchive selects the legality gate per variant (films / tv / anime / cartoons)", async () => {
  const calls: string[] = [];
  const fetchImpl = makeFetch({
    handler: (url) => {
      calls.push(url);
      return jsonResponse({ response: { numFound: 0, docs: [] } });
    },
  });
  await searchArchive({ page: 1, rows: 24 }, fetchImpl);
  await searchArchive({ page: 1, rows: 24, variant: "tv" }, fetchImpl);
  await searchArchive({ page: 1, rows: 24, variant: "anime" }, fetchImpl);
  await searchArchive({ page: 1, rows: 24, variant: "cartoons" }, fetchImpl);
  await searchArchive({ page: 1, rows: 24, variant: "otr" }, fetchImpl);
  await searchArchive({ page: 1, rows: 24, variant: "music" }, fetchImpl);
  const filmsQ = qOf(calls[0] as string);
  const tvQ = qOf(calls[1] as string);
  const animeQ = qOf(calls[2] as string);
  const cartoonsQ = qOf(calls[3] as string);
  const otrQ = qOf(calls[4] as string);
  const musicQ = qOf(calls[5] as string);
  assert.ok(
    filmsQ.includes("collection:(feature_films OR prelinger OR moviesandfilms)"),
    "films variant selects the curated film collections",
  );
  assert.ok(tvQ.includes("collection:classic_tv"), "tv variant selects the classic_tv pool");
  assert.ok(
    tvQ.includes("licenseurl:https://creativecommons.org*") && tvQ.includes("mediatype:movies"),
    "tv gate keeps the license gate and mediatype:movies",
  );
  assert.ok(!tvQ.includes("feature_films"), "tv gate does not include the films collections");
  assert.ok(animeQ.includes("collection:anime"), "anime variant selects the anime pool");
  assert.ok(
    animeQ.includes("licenseurl:https://creativecommons.org*") && animeQ.includes("mediatype:movies"),
    "anime gate keeps the license gate and mediatype:movies",
  );
  assert.ok(animeQ.includes("year:[* TO 1974]"), "anime gate restricts to pre-1975 titles (modern fan uploads excluded)");
  assert.ok(!animeQ.includes("feature_films"), "anime gate does not include the films collections");
  assert.ok(cartoonsQ.includes("collection:animationandcartoons"), "cartoons variant selects the animation pool");
  assert.ok(
    cartoonsQ.includes("licenseurl:https://creativecommons.org*") && cartoonsQ.includes("mediatype:movies"),
    "cartoons gate keeps the license gate and mediatype:movies",
  );
  assert.ok(!cartoonsQ.includes("feature_films"), "cartoons gate does not include the films collections");
  assert.ok(otrQ.includes("collection:oldtimeradio"), "otr variant selects the oldtimeradio pool");
  assert.ok(
    otrQ.includes("licenseurl:https://creativecommons.org*") && otrQ.includes("mediatype:audio"),
    "otr gate keeps the license gate and swaps mediatype to audio (radio is audio)",
  );
  assert.ok(!otrQ.includes("mediatype:movies"), "otr gate is audio, not movies");
  assert.ok(!otrQ.includes("feature_films"), "otr gate does not include the films collections");
  assert.ok(musicQ.includes("collection:(GratefulDead OR etree)"), "music variant selects the live-music pools");
  assert.ok(
    musicQ.includes("licenseurl:https://creativecommons.org*") && musicQ.includes("mediatype:etree"),
    "music gate keeps the license gate and pins mediatype:etree (archive.org's live-music mediatype)",
  );
  assert.ok(!musicQ.includes("mediatype:movies"), "music gate is not movies");
  assert.ok(!musicQ.includes("feature_films"), "music gate does not include the films collections");
});

test("searchArchive selects the wwii, newsreels, and widened govfilms gates", async () => {
  const calls: string[] = [];
  const fetchImpl = makeFetch({
    handler: (url) => {
      calls.push(url);
      return jsonResponse({ response: { numFound: 0, docs: [] } });
    },
  });
  await searchArchive({ page: 1, rows: 24, variant: "wwii" }, fetchImpl);
  await searchArchive({ page: 1, rows: 24, variant: "newsreels" }, fetchImpl);
  await searchArchive({ page: 1, rows: 24, variant: "govfilms" }, fetchImpl);
  await searchArchive({ page: 1, rows: 24, variant: "nfpf" }, fetchImpl);
  const wwiiQ = qOf(calls[0] as string);
  const newsQ = qOf(calls[1] as string);
  const govQ = qOf(calls[2] as string);
  const nfpfQ = qOf(calls[3] as string);
  assert.ok(wwiiQ.includes("collection:wwIIarchive"), "wwii variant selects the wwIIarchive pool (case-sensitive Solr name)");
  assert.ok(wwiiQ.includes("mediatype:movies"), "wwii gate keeps mediatype:movies");
  assert.ok(!wwiiQ.includes("feature_films"), "wwii gate does not include the films collections");
  assert.ok(newsQ.includes("collection:universal_newsreels"), "newsreels variant selects the universal_newsreels pool");
  assert.ok(newsQ.includes("mediatype:movies"), "newsreels gate keeps mediatype:movies");
  assert.ok(govQ.includes("collection:(FedFlix OR usgovfilms)"), "govfilms gate widened to FedFlix OR usgovfilms");
  assert.ok(govQ.includes("mediatype:movies"), "govfilms gate keeps mediatype:movies");
  assert.ok(nfpfQ.includes("collection:nationalfilmpreservationfoundation"), "nfpf variant selects the NFPF pool");
  assert.ok(nfpfQ.includes("mediatype:movies"), "nfpf gate keeps mediatype:movies");
  assert.ok(!nfpfQ.includes("feature_films"), "nfpf gate does not include the films collections");
});

test("searchArchive adds the films-only clause only when filmsOnly is true", async () => {
  const calls: string[] = [];
  const fetchImpl = makeFetch({
    handler: (url) => {
      calls.push(url);
      return jsonResponse({ response: { numFound: 0, docs: [] } });
    },
  });
  await searchArchive({ page: 1, rows: 24, filmsOnly: true }, fetchImpl);
  await searchArchive({ page: 1, rows: 24 }, fetchImpl);
  assert.ok(qOf(calls[0] as string).includes(FILMS_ONLY_SOLR_CLAUSE), "films-only clause present when requested");
  assert.ok(!qOf(calls[1] as string).includes(FILMS_ONLY_SOLR_CLAUSE), "films-only clause absent by default");
});

test("searchArchive wraps the query and adds subject + decade ranges", async () => {
  const calls: string[] = [];
  const fetchImpl = makeFetch({
    handler: (url) => {
      calls.push(url);
      return jsonResponse({ response: { numFound: 0, docs: [] } });
    },
  });
  await searchArchive(
    { query: "caligari", genreSubject: "film noir", decadeFrom: 1920, decadeTo: 1929, sort: "recent", page: 2, rows: 24 },
    fetchImpl,
  );
  const url = new URL(calls[0] as string);
  const q = url.searchParams.get("q") ?? "";
  assert.ok(q.includes("(caligari)"), "query wrapped in parens");
  assert.ok(q.includes('subject:("film noir")'), "genre subject as an exact phrase");
  assert.ok(q.includes("year:[1920 TO 1929]"), "decade range as a Solr range");
  assert.equal(url.searchParams.get("rows"), "24");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("sort[]"), "addeddate desc", "recent sort maps to addeddate desc");
  const fields = url.searchParams.getAll("fl[]");
  assert.ok(fields.includes("identifier") && fields.includes("licenseurl"), "fl fields selected");
});

test("searchArchive parses numFound and docs", async () => {
  const fetchImpl = makeFetch({
    handler: () => jsonResponse({ response: { numFound: 7, docs: [{ identifier: "a" }, { identifier: "b" }] } }),
  });
  const result = await searchArchive({ page: 1, rows: 24 }, fetchImpl);
  assert.equal(result.numFound, 7);
  assert.equal(result.docs.length, 2);
  assert.equal(result.docs[0]?.identifier, "a");
});

test("searchArchive fails closed on an unexpected response shape", async () => {
  const fetchImpl = makeFetch({ handler: () => jsonResponse({ response: { numFound: 1 } }) });
  await assert.rejects(() => searchArchive({ page: 1, rows: 24 }, fetchImpl), (err: unknown) => {
    assert.ok(err instanceof ArchiveError);
    assert.equal((err as ArchiveError).status, 502);
    assert.match((err as ArchiveError).message, /unexpected shape/);
    return true;
  });
});

test("fetchMetadata parses metadata, files, and is_dark", async () => {
  let calledUrl = "";
  const fetchImpl = makeFetch({
    handler: (url) => {
      calledUrl = url;
      return jsonResponse({
        metadata: { identifier: "it-1927", title: "It (1927)" },
        files: [{ name: "a.mp4", format: "h.264" }],
        is_dark: false,
      });
    },
  });
  const meta = await fetchMetadata("it-1927", fetchImpl);
  assert.ok(calledUrl.startsWith(ARCHIVE_METADATA_URL), "hits the metadata endpoint");
  assert.equal(meta.isDark, false);
  assert.equal(meta.metadata?.identifier, "it-1927");
  assert.equal((meta.files as { name: string }[])?.[0]?.name, "a.mp4");
});

test("fetchMetadata maps is_dark true", async () => {
  const fetchImpl = makeFetch({ handler: () => jsonResponse({ is_dark: true }) });
  const meta = await fetchMetadata("dark-item", fetchImpl);
  assert.equal(meta.isDark, true);
  assert.equal(meta.metadata, undefined);
});

test("fetchMetadata returns metadata undefined for a 404 JSON body (no retry on 4xx)", async () => {
  const calls = { count: 0 };
  const fetchImpl = makeFetch({
    calls,
    handler: () => jsonResponse({ error: "not found" }, 404),
  });
  const meta = await fetchMetadata("missing", fetchImpl);
  assert.equal(meta.metadata, undefined, "a 404 body parses to an empty record, never a crash");
  assert.equal(calls.count, 1, "4xx is permanent — never retried");
});

test("fetchSitemapCatalog returns identifier/addeddate pairs and skips blank ids", async () => {
  const fetchImpl = makeFetch({
    handler: () => jsonResponse({ response: { docs: [
      { identifier: "a", addeddate: "2024-05-01T00:00:00Z" },
      { identifier: "", addeddate: "2024-05-02T00:00:00Z" },
      { identifier: "b" },
    ] } }),
  });
  const entries = await fetchSitemapCatalog(fetchImpl);
  assert.deepEqual(entries, [
    ["a", "2024-05-01T00:00:00Z"],
    ["b", ""],
  ]);
});

test("fetchSitemapCatalog fails closed on a bad shape", async () => {
  const fetchImpl = makeFetch({ handler: () => jsonResponse({ response: {} }) });
  await assert.rejects(() => fetchSitemapCatalog(fetchImpl), (err: unknown) => {
    assert.ok(err instanceof ArchiveError);
    assert.equal((err as ArchiveError).status, 502);
    return true;
  });
});

test("fetchCatalogIndexDocs returns the raw docs", async () => {
  const fetchImpl = makeFetch({
    handler: () => jsonResponse({ response: { docs: [{ identifier: "x", title: "X" }] } }),
  });
  const docs = await fetchCatalogIndexDocs(fetchImpl);
  assert.equal(docs.length, 1);
  assert.equal(docs[0]?.identifier, "x");
});

test("fetchSearchDocByIdentifier returns the doc when found and null when empty", async () => {
  const found = makeFetch({
    handler: () => jsonResponse({ response: { docs: [{ identifier: "it-1927", licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/" }] } }),
  });
  const doc = await fetchSearchDocByIdentifier("it-1927", found);
  assert.equal(doc?.identifier, "it-1927");
  assert.ok(String(doc?.licenseurl).includes("creativecommons.org"));

  const empty = makeFetch({ handler: () => jsonResponse({ response: { docs: [] } }) });
  assert.equal(await fetchSearchDocByIdentifier("nothing", empty), null);
});
