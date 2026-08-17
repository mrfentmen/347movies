/**
 * UNIT TESTS for the ad loader config gate (lib/ad.ts, Decision 001 / T4.3).
 *
 * The mechanism follows the T4.2 affiliate precedent: real, tested, and dormant until a
 * real network is configured. The production allowlist is EMPTY, so the gate returns null
 * for everything today — enabling requires the reviewed T4.5 change that adds a host to
 * AD_NETWORK_ALLOWLIST. Tests exercise the enabled path with a custom allowlist.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AD_NETWORK_ALLOWLIST, adConfig } from "../lib/ad.ts";

test("disabled when the env value is missing, blank, or whitespace", () => {
  assert.equal(adConfig(undefined), null);
  assert.equal(adConfig(null), null);
  assert.equal(adConfig(""), null);
  assert.equal(adConfig("   "), null);
});

test("rejects non-URLs and non-https URLs", () => {
  assert.equal(adConfig("not a url"), null);
  assert.equal(adConfig("https://"), null);
  assert.equal(adConfig("ftp://cdn.network.example/loader.js"), null);
  assert.equal(adConfig("http://cdn.network.example/loader.js"), null);
});

test("rejects hosts not on the allowlist", () => {
  const allowlist = ["cdn.network.example"];
  assert.equal(adConfig("https://evil.example/loader.js", allowlist), null);
  assert.equal(adConfig("https://cdn.network.example.evil.example/loader.js", allowlist), null);
  assert.equal(adConfig("https://sub.cdn.network.example/loader.js", allowlist), null, "exact host match only");
});

test("accepts an https URL whose host is on the allowlist", () => {
  const allowlist = ["cdn.network.example", "cdn2.network.example"];
  const cfg = adConfig("https://cdn.network.example/loader.js?network=1", allowlist);
  assert.deepEqual(cfg, { scriptUrl: "https://cdn.network.example/loader.js?network=1" });
  const cfg2 = adConfig("https://cdn2.network.example/ads.js", allowlist);
  assert.deepEqual(cfg2, { scriptUrl: "https://cdn2.network.example/ads.js" });
});

test("the production default allowlist is empty, so the loader is dormant by structure", () => {
  assert.deepEqual(AD_NETWORK_ALLOWLIST, []);
  // Even a perfectly valid https URL is rejected while no network host is allowlisted —
  // "dormant until configured" is structural, not a convention.
  assert.equal(adConfig("https://cdn.network.example/loader.js"), null);
});
