import assert from "node:assert/strict";
import { test } from "node:test";
import { affiliateLink, amazonSearchUrl } from "../lib/affiliate.ts";

test("amazonSearchUrl builds a real Amazon search URL with the tag", () => {
  const url = amazonSearchUrl("Nosferatu", "testtag-20");
  assert.ok(url !== null);
  assert.ok(url.startsWith("https://www.amazon.com/s?"));
  assert.ok(url.includes("k=Nosferatu"));
  assert.ok(url.includes("tag=testtag-20"));
});

test("amazonSearchUrl rejects missing or invalid tags", () => {
  assert.equal(amazonSearchUrl("Film", ""), null);
  assert.equal(amazonSearchUrl("Film", "ab"), null);
  assert.equal(amazonSearchUrl("Film", "x".repeat(65)), null);
  assert.equal(amazonSearchUrl("Film", "bad tag!"), null);
});

test("affiliateLink returns null without a tag (no fake links)", () => {
  assert.equal(affiliateLink("Film", undefined), null);
  assert.equal(affiliateLink("Film", ""), null);
});

test("affiliateLink is disclosed with sponsored rel", () => {
  const link = affiliateLink("It (1927)", "testtag-20");
  assert.ok(link !== null);
  assert.equal(link.rel, "sponsored noopener");
  assert.ok(link.disclosure.includes("Amazon Associate"));
  assert.ok(link.disclosure.toLowerCase().includes("qualifying purchases"));
});
