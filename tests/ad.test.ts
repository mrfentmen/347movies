/**
 * UNIT TESTS for the ad loader config gate (lib/ad.ts, Decision 001 / T4.3, enabled per
 * T4.5).
 *
 * The mechanism follows the T4.2 affiliate precedent: real, tested, and dormant until the
 * site owner sets AD_NETWORK_SCRIPT + AD_SLOT_IDS. The production allowlist now contains
 * the chosen network's loader host (Google AdSense, the reviewed T4.5 enablement) — but
 * ads still do not render until BOTH env bindings are present, so the site is dormant by
 * configuration, not by code. Tests exercise both the generic gate and the AdSense gate.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AD_NETWORK_ALLOWLIST, adConfig, adsenseConfig } from "../lib/ad.ts";

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

test("the production allowlist contains only the chosen network's loader host", () => {
  assert.deepEqual(AD_NETWORK_ALLOWLIST, ["pagead2.googlesyndication.com"]);
  // A valid https URL on any OTHER host is still rejected — only the chosen network.
  assert.equal(adConfig("https://cdn.network.example/loader.js"), null);
});

/* ---------- AdSense gate (adsenseConfig) ---------- */

const ADSENSE_URL =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456";
const SLOT_IDS = "sidebar=1111111111,sidebar-2=2222222222,leaderboard=3333333333,leaderboard-2=4444444444";

test("adsense: disabled without slot ids", () => {
  assert.equal(adsenseConfig(ADSENSE_URL, undefined), null);
  assert.equal(adsenseConfig(ADSENSE_URL, ""), null);
  assert.equal(adsenseConfig(ADSENSE_URL, "   "), null);
});

test("adsense: disabled when the loader URL has no client id", () => {
  assert.equal(adsenseConfig("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", SLOT_IDS), null);
});

test("adsense: disabled for a non-allowlisted host even with client + slots", () => {
  assert.equal(adsenseConfig("https://evil.example/loader.js?client=ca-pub-123", SLOT_IDS), null);
});

test("adsense: unknown slot names and non-numeric ids are dropped", () => {
  const cfg = adsenseConfig(ADSENSE_URL, "sidebar=1111111111,popup=9999999999,leaderboard=abc");
  assert.ok(cfg);
  assert.deepEqual(cfg.slots, { sidebar: "1111111111" });
});

test("adsense: accepts a valid loader URL with client id and slot ids", () => {
  const cfg = adsenseConfig(ADSENSE_URL, SLOT_IDS);
  assert.ok(cfg);
  assert.equal(cfg.scriptUrl, ADSENSE_URL);
  assert.equal(cfg.clientId, "ca-pub-1234567890123456");
  assert.deepEqual(cfg.slots, {
    sidebar: "1111111111",
    "sidebar-2": "2222222222",
    leaderboard: "3333333333",
    "leaderboard-2": "4444444444",
  });
});

test("adsense: the production default allowlist gates it to AdSense only", () => {
  assert.ok(adsenseConfig(ADSENSE_URL, SLOT_IDS));
  assert.equal(adsenseConfig("https://cdn.network.example/loader.js?client=ca-pub-123", SLOT_IDS), null);
});
