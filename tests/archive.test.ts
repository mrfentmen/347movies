/**
 * LIVE INTEGRATION TESTS — these hit the real Internet Archive public APIs over the network.
 * They are real end-to-end checks of the catalog integration, not mocks.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchMetadata, fetchSearchDocByIdentifier, searchArchive } from "../lib/archive.ts";
import { getMovieRecord } from "../lib/catalog.ts";

test("[integration] advancedsearch returns real legal films for a query", async () => {
  const { numFound, docs } = await searchArchive({ query: "nosferatu", page: 1, rows: 3 });
  assert.ok(numFound > 0, `expected hits, got ${numFound}`);
  assert.ok(docs.length > 0, "expected docs");
  const first = docs[0];
  assert.ok(first !== undefined);
  assert.ok(String(first["identifier"] ?? "").length > 0);
  assert.ok(String(first["title"] ?? "").length > 0);
});

test("[integration] metadata returns a complete record for a known PD film (It, 1927)", async () => {
  const { metadata, isDark } = await fetchMetadata("it-1927");
  assert.equal(isDark, false);
  assert.ok(metadata, "expected metadata");
  assert.ok(String(metadata["title"] ?? "").includes("It"));
  assert.ok(String(metadata["licenseurl"] ?? "").includes("creativecommons.org"));
});

test("[integration] getMovieRecord verifies license end-to-end for a PD film", async () => {
  const result = await getMovieRecord("it-1927", null);
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.record.license, "publicdomain");
    assert.ok(result.record.thumbnails.small.startsWith("https://archive.org/"));
  }
});

test("[integration] dark/removed items fail closed", async () => {
  const result = await getMovieRecord("night_of_the_living_dead", null);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(["not_available", "not_found"].includes(result.reason));
  }
});

test("[integration] expanded catalog includes prelinger public-domain films", async () => {
  // The gate must surface legally-marked films from the expanded pool. We assert the gate's
  // semantics rather than pinning one identifier: archive.org re-indexes items (atoms_for_peace
  // dropped to 0 hits in the wild), so a hardcoded identifier is a flaky pin, not a contract.
  const { numFound, docs } = await searchArchive({ query: "atoms for peace", page: 1, rows: 5 });
  assert.ok(numFound > 0, `expected prelinger-era hits, got ${numFound}`);
  assert.ok(docs.length > 0, "gate returns docs");
  for (const doc of docs) {
    assert.ok(
      String(doc["licenseurl"] ?? "").includes("creativecommons.org"),
      "every gated doc carries a creativecommons licenseurl",
    );
  }
});

test("[integration] search-index fallback finds a license declaration", async () => {
  const doc = await fetchSearchDocByIdentifier("it-1927");
  assert.ok(doc !== null);
  assert.equal(String(doc["identifier"]), "it-1927");
  assert.ok(String(doc["licenseurl"] ?? "").includes("creativecommons.org"));
});

test("[integration] filmsOnly excludes serial-episode AND trailer titles from recent additions", async () => {
  const { numFound, docs } = await searchArchive({ sort: "recent", page: 1, rows: 30, filmsOnly: true });
  assert.ok(numFound > 0, `expected hits, got ${numFound}`);
  for (const doc of docs) {
    const title = String(doc["title"] ?? "");
    assert.ok(
      !/episode|\bseason\b|\bpilot\b|\bep\.|\btrailer/i.test(title),
      `non-film title slipped through filmsOnly: ${title}`,
    );
  }
});
