import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApiError,
  sanitizeQuery,
  validateDecade,
  validateDecadeRange,
  validateFlag,
  validateGenre,
  validateIdentifier,
  validateKeyword,
  validatePage,
  validateQuery,
  validateSort,
} from "../lib/validate.ts";

const isApiError = (code: string) => (err: unknown) =>
  err instanceof ApiError && err.code === code;

test("sanitizeQuery strips Solr/URL injection characters", () => {
  assert.equal(sanitizeQuery('title:("x")'), "title x");
  assert.equal(sanitizeQuery("a<b>c"), "a b c");
  // Path-traversal characters that matter (<, >, ;, %, backslash, slash) are neutralized
  // so traversal strings never reach archive.org (task T2.4).
  assert.equal(sanitizeQuery("../../etc/passwd"), ".. .. etc passwd");
  assert.equal(sanitizeQuery("a; rm -rf /"), "a rm -rf");
  assert.equal(sanitizeQuery("..%2f..%2f"), ".. 2f.. 2f");
  assert.equal(sanitizeQuery("a\\b"), "a b");
  assert.equal(sanitizeQuery("a\u0000b"), "a b");
  // & is not Solr syntax and is kept (it is URL-encoded before any request is made).
  assert.equal(sanitizeQuery("  spaced   out  "), "spaced out");
  assert.equal(sanitizeQuery("a*b?c"), "a b c");
});

test("validateQuery rejects queries longer than 80 chars", () => {
  assert.throws(() => validateQuery("x".repeat(81)), isApiError("query_too_long"));
  assert.equal(validateQuery("x".repeat(80)), "x".repeat(80));
});

test("validateQuery rejects empty queries, except when allowEmpty (TV search shortcut)", () => {
  assert.throws(() => validateQuery(""), isApiError("empty_query"));
  assert.equal(validateQuery("", true), ""); // tv=1: empty query = browse the TV pool
  assert.equal(validateQuery(null, true), "");
  assert.throws(() => validateQuery(null), isApiError("empty_query"));
  assert.throws(() => validateQuery("   "), isApiError("empty_query"));
  assert.throws(() => validateQuery('::::::"((((('), isApiError("empty_query"));
});

test("validateQuery sanitizes before returning", () => {
  assert.equal(validateQuery('noir:("x")'), "noir x");
});

test("validateQuery neutralizes path-traversal attempts (T2.4)", () => {
  assert.equal(validateQuery("../../etc/passwd"), ".. .. etc passwd");
  assert.equal(validateQuery("..%2f..%2fetc"), ".. 2f.. 2fetc");
  assert.equal(validateQuery("a<b>&c"), "a b &c");
});

test("validateIdentifier accepts the safe charset", () => {
  assert.equal(validateIdentifier("it-1927"), "it-1927");
  assert.equal(validateIdentifier("a.b_c-1"), "a.b_c-1");
  assert.equal(validateIdentifier("  fw-murnaus-nosferatu-1922  "), "fw-murnaus-nosferatu-1922");
});

test("validateIdentifier rejects traversal, spaces, and odd characters", () => {
  const bad = [
    "../etc/passwd",
    "a/b",
    "a b",
    "a<b>",
    "a;b",
    "",
    "%2e%2e",
    "a\u0000b",
    "x".repeat(121),
    "a\"b",
    "a&b",
  ];
  for (const input of bad) {
    assert.throws(() => validateIdentifier(input), isApiError("invalid_identifier"), `should reject: ${JSON.stringify(input)}`);
  }
});

test("validatePage bounds to 1..100", () => {
  assert.equal(validatePage(null), 1);
  assert.equal(validatePage(""), 1);
  assert.equal(validatePage("24"), 24);
  assert.equal(validatePage("1"), 1);
  assert.equal(validatePage("100"), 100);
  const bad = ["0", "-1", "101", "abc", "1.5", "1e3", "9999", "0x10", "١٢"];
  for (const input of bad) {
    assert.throws(() => validatePage(input), isApiError("invalid_page"), `should reject: ${JSON.stringify(input)}`);
  }
});

test("validateGenre accepts only the whitelist", () => {
  assert.equal(validateGenre(null), null);
  assert.equal(validateGenre(""), null);
  assert.equal(validateGenre("film-noir"), "film-noir");
  assert.equal(validateGenre("western"), "western");
  assert.equal(validateGenre("drama"), "drama");
  for (const bad of ["noir", "action", "film noir", "romance", "documentary"]) {
    assert.throws(() => validateGenre(bad), isApiError("invalid_genre"), `should reject: ${JSON.stringify(bad)}`);
  }
});

test("validateDecade accepts only allowed decades", () => {
  assert.equal(validateDecade(null), null);
  assert.equal(validateDecade("1920"), 1920);
  assert.equal(validateDecade("1890"), 1890);
  assert.equal(validateDecade("2020"), 2020);
  for (const bad of ["1921", "1899", "2021", "abc", "20", "192", "19200", "-1920"]) {
    assert.throws(() => validateDecade(bad), isApiError("invalid_decade"), `should reject: ${JSON.stringify(bad)}`);
  }
});

test("validateDecadeRange: both bounds, from the whitelist, from <= to", () => {
  assert.deepEqual(validateDecadeRange(null, null), { from: null, to: null });
  assert.deepEqual(validateDecadeRange("", ""), { from: null, to: null });
  // Bounds are decade starts (same whitelist as the decade param): 2000s through 2020s.
  assert.deepEqual(validateDecadeRange("2000", "2020"), { from: 2000, to: 2020 });
  assert.deepEqual(validateDecadeRange("2000", "2000"), { from: 2000, to: 2000 });
  assert.deepEqual(validateDecadeRange("1890", "2020"), { from: 1890, to: 2020 });
  const badRanges: Array<[string | null, string | null]> = [
    ["2000", null], // one-sided -> ambiguous
    [null, "2020"],
    ["", "2020"],
    ["2020", "2000"], // reversed (both whitelisted, from after to)
  ];
  for (const [f, t] of badRanges) {
    assert.throws(() => validateDecadeRange(f, t), isApiError("invalid_decade_range"), `should reject: ${f} / ${t}`);
  }
  // A non-whitelisted bound fails the same decade validation as a single decade param.
  const badDecades: Array<[string, string]> = [
    ["1991", "2000"],
    ["2000", "2029"], // 2029 is not a decade start
    ["2030", "2020"],
  ];
  for (const [f, t] of badDecades) {
    assert.throws(() => validateDecadeRange(f, t), isApiError("invalid_decade"), `should reject: ${f} / ${t}`);
  }
});

test("validateSort accepts only the whitelist", () => {
  assert.equal(validateSort(null), "recent");
  assert.equal(validateSort("recent"), "recent");
  assert.equal(validateSort("title"), "title");
  assert.equal(validateSort("newest"), "newest");
  assert.equal(validateSort("oldest"), "oldest");
  for (const bad of ["popular", "random", "asc", "RECENT"]) {
    assert.throws(() => validateSort(bad), isApiError("invalid_sort"), `should reject: ${JSON.stringify(bad)}`);
  }
});

test("validateKeyword: sanitizes like search, fails closed on empty", () => {
  assert.equal(validateKeyword(null), null); // absent — no filter
  assert.throws(() => validateKeyword(""), isApiError("empty_keyword")); // present but empty — fail closed
  assert.throws(() => validateKeyword("   "), isApiError("empty_keyword"));
  assert.equal(validateKeyword("dubbed subtitled kung"), "dubbed subtitled kung");
  assert.equal(validateKeyword('kung"fu():'), "kung fu"); // Solr/URL chars stripped
  assert.equal(validateKeyword("dubbed"), "dubbed");
  assert.throws(() => validateKeyword("a".repeat(81)), isApiError("query_too_long"));
  assert.throws(() => validateKeyword("()[]{}*"), isApiError("empty_keyword")); // sanitized to nothing
});

test("validateFlag parses boolean flags", () => {
  assert.equal(validateFlag(null), false);
  assert.equal(validateFlag(""), false);
  assert.equal(validateFlag("1"), true);
  assert.equal(validateFlag("true"), true);
  assert.equal(validateFlag("TRUE"), true);
  assert.equal(validateFlag("0"), false); // explicit opt-out (films=0)
  assert.equal(validateFlag("false"), false);
  for (const bad of ["2", "yes", "on", "y", "maybe"]) {
    assert.throws(() => validateFlag(bad), isApiError("invalid_flag"), `should reject: ${JSON.stringify(bad)}`);
  }
});
