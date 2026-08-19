/**
 * UNIT tests for the privacy-respecting page-view counter (lib/views.ts): bucket
 * validation, daily aggregation, the 7-day window, KV persistence/reconciliation, and the
 * clamped window. Pure unit tests — no network, no live server.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { Env } from "../lib/env.ts";
import { COUNTED_PATHS, getViewStats, normalizeCountedPath, recordPageView, _resetViewsForTests } from "../lib/views.ts";

/** A Map-backed fake KV with the two methods the counter uses. */
function fakeKv(store: Map<string, string> = new Map()): KVNamespace {
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

const EMPTY_ENV: Env = {};

test("normalizeCountedPath maps known pages to their buckets", () => {
  assert.equal(normalizeCountedPath("/"), "/");
  assert.equal(normalizeCountedPath("/browse"), "/browse");
  assert.equal(normalizeCountedPath("/search"), "/search");
  assert.equal(normalizeCountedPath("/genre"), "/genre");
  assert.equal(normalizeCountedPath("/watchlist"), "/watchlist");
  assert.equal(normalizeCountedPath("/tv"), "/tv");
  assert.equal(normalizeCountedPath("/anime"), "/anime");
  assert.equal(normalizeCountedPath("/cartoons"), "/cartoons");
  assert.equal(normalizeCountedPath("/otr"), "/otr");
  assert.equal(normalizeCountedPath("/music"), "/music");
  assert.equal(normalizeCountedPath("/documentaries"), "/documentaries");
  assert.equal(normalizeCountedPath("/sports"), "/sports");
  assert.equal(normalizeCountedPath("/shorts"), "/shorts");
  assert.equal(normalizeCountedPath("/silents"), "/silents");
  assert.equal(normalizeCountedPath("/publictv"), "/publictv");
  assert.equal(normalizeCountedPath("/science"), "/science");
  assert.equal(normalizeCountedPath("/govfilms"), "/govfilms");
  assert.equal(normalizeCountedPath("/audiobooks"), "/audiobooks");
  assert.equal(normalizeCountedPath("/collections"), "/collections");
  assert.equal(normalizeCountedPath("/advertise"), "/advertise");
  assert.equal(normalizeCountedPath("/movie"), "/movie");
});

test("normalizeCountedPath strips query/hash and collapses trailing slashes", () => {
  assert.equal(normalizeCountedPath("/browse?genre=film-noir&page=2"), "/browse");
  assert.equal(normalizeCountedPath("/browse#top"), "/browse");
  assert.equal(normalizeCountedPath("/browse/"), "/browse");
});

test("normalizeCountedPath collapses every movie detail path into one bucket", () => {
  assert.equal(normalizeCountedPath("/movie/it-1927"), "/movie");
  assert.equal(normalizeCountedPath("/movie/night_of_the_living_dead?x=1"), "/movie");
  assert.equal(normalizeCountedPath("/movie/"), "/movie");
});

test("normalizeCountedPath refuses everything not on the bounded list", () => {
  assert.equal(normalizeCountedPath(""), "");
  assert.equal(normalizeCountedPath("browse"), ""); // no leading slash
  assert.equal(normalizeCountedPath("/about"), ""); // privacy pages are not counted
  assert.equal(normalizeCountedPath("/privacy"), "");
  assert.equal(normalizeCountedPath("/terms"), "");
  assert.equal(normalizeCountedPath("/definitely-not-a-page"), "");
  assert.equal(normalizeCountedPath("/movie/" + "x".repeat(250)), ""); // oversized
  assert.equal(normalizeCountedPath("/..%2F..%2Fetc"), ""); // traversal-shaped junk
});

test("recordPageView counts only valid buckets and never throws", async () => {
  _resetViewsForTests();
  assert.equal(await recordPageView(EMPTY_ENV, "/browse"), true);
  assert.equal(await recordPageView(EMPTY_ENV, "/movie/it-1927"), true);
  assert.equal(await recordPageView(EMPTY_ENV, "/about"), false, "privacy pages are not counted");
  assert.equal(await recordPageView(EMPTY_ENV, "junk"), false);
  const stats = await getViewStats(EMPTY_ENV, 7);
  assert.equal(stats.total, 2);
  assert.deepEqual(stats.byPath, { "/browse": 1, "/movie": 1 });
});

test("getViewStats returns the last-N-day window with per-day totals", async () => {
  _resetViewsForTests();
  const day1 = new Date("2026-08-15T12:00:00Z");
  const day2 = new Date("2026-08-17T12:00:00Z");
  await recordPageView(EMPTY_ENV, "/", day1);
  await recordPageView(EMPTY_ENV, "/", day1);
  await recordPageView(EMPTY_ENV, "/browse", day2);

  const stats = await getViewStats(EMPTY_ENV, 7, new Date("2026-08-17T12:00:00Z"));
  assert.equal(stats.windowDays, 7);
  assert.equal(stats.days.length, 7);
  assert.equal(stats.days[0]?.date, "2026-08-11"); // oldest
  assert.equal(stats.days[6]?.date, "2026-08-17"); // today
  assert.equal(stats.days[0]?.views, 0);
  assert.equal(stats.days[4]?.views, 2); // 08-15
  assert.equal(stats.days[6]?.views, 1); // 08-17
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.byPath, { "/": 2, "/browse": 1 });

  // Outside the window: a record from 08-01 is invisible to a 7-day window ending 08-10.
  _resetViewsForTests();
  await recordPageView(EMPTY_ENV, "/", new Date("2026-08-01T00:00:00Z"));
  const later = await getViewStats(EMPTY_ENV, 7, new Date("2026-08-10T00:00:00Z"));
  assert.equal(later.days[0]?.date, "2026-08-04");
  assert.equal(later.total, 0);
});

test("the window is clamped to 1–30 days", async () => {
  _resetViewsForTests();
  assert.equal((await getViewStats(EMPTY_ENV, 999)).windowDays, 30);
  assert.equal((await getViewStats(EMPTY_ENV, 0)).windowDays, 1);
  assert.equal((await getViewStats(EMPTY_ENV, -5)).windowDays, 1);
});

test("recordPageView persists to KV when the binding exists", async () => {
  _resetViewsForTests();
  const store = new Map<string, string>();
  const env: Env = { MOVIES_KV: fakeKv(store) };
  await recordPageView(env, "/browse");
  await recordPageView(env, "/movie/x");
  const daily = store.get("views:v1:d:" + new Date().toISOString().slice(0, 10));
  assert.equal(daily, "2", "daily KV key incremented twice");
  assert.ok([...store.keys()].some((k) => k.startsWith("views:v1:p:") && k.endsWith(":/browse")), "per-path KV key written");
  assert.ok([...store.keys()].some((k) => k.startsWith("views:v1:p:") && k.endsWith(":/movie")), "movie bucket KV key written");
  assert.ok(![...store.keys()].some((k) => k.includes("/about")), "uncounted paths never reach KV");
});

test("stats reconcile memory and KV by taking the larger count (multi-isolate view)", async () => {
  _resetViewsForTests();
  const today = new Date().toISOString().slice(0, 10);

  // Memory (this isolate) says 2, recorded with no KV binding.
  await recordPageView(EMPTY_ENV, "/browse");
  await recordPageView(EMPTY_ENV, "/browse");

  // KV (a different isolate's view) says 5 — seeded directly, as if another isolate wrote it.
  const store = new Map<string, string>();
  for (let i = 0; i < 5; i++) {
    store.set(`views:v1:p:${today}:/browse`, String((Number(store.get(`views:v1:p:${today}:/browse`) ?? 0) + 1)));
  }

  const stats = await getViewStats({ MOVIES_KV: fakeKv(store) }, 7);
  assert.equal(stats.byPath["/browse"], 5, "the larger of memory/KV wins — a KV-only isolate's count is not lost");
  assert.equal(stats.total, 5);

  // Reverse: KV absent/lower — memory (exact per-isolate) wins.
  const stats2 = await getViewStats(EMPTY_ENV, 7);
  assert.equal(stats2.byPath["/browse"], 2, "without KV, memory is the count");
});

test("uncounted input still returns 204-safe success (recordPageView returns false, no throw)", async () => {
  _resetViewsForTests();
  for (const bad of ["", "/about", "https://evil.example/x", "/movie/" + "a".repeat(300)]) {
    assert.equal(await recordPageView(EMPTY_ENV, bad), false);
  }
  assert.equal(COUNTED_PATHS.length, 23, "the bounded bucket set stays small and deliberate (one per catalog destination)");
});

test("the edge Cache API persists counts across isolates and is read back after memory resets", async () => {
  _resetViewsForTests();
  // Fake caches.default with URL-keyed match/put storing the body as text and rebuilding a
  // fresh Response per match — mirroring the real Cache API (a real cached body can be read
  // repeatedly; a stale consumed stream would be a fake-cache artifact, not a product bug).
  const store = new Map<string, string>();
  const fakeCaches = {
    default: {
      match: async (request: Request) => {
        const text = store.get(request.url);
        return text === undefined ? undefined : new Response(text, { headers: { "Content-Type": "application/json" } });
      },
      put: async (request: Request, response: Response) => {
        store.set(request.url, await response.clone().text());
      },
    },
  };
  const prev = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = fakeCaches as unknown;
  try {
    const env: Env = {}; // no KV — the edge cache is the persistence layer
    await recordPageView(env, "/");
    await recordPageView(env, "/browse");
    await recordPageView(env, "/movie/it-1927");

    // A different isolate: memory is empty (simulated by reset), but the cache still knows.
    _resetViewsForTests();
    const stats = await getViewStats(env, 7);
    assert.equal(stats.total, 3, "counts survive the in-memory reset via the edge cache");
    assert.deepEqual(stats.byPath, { "/": 1, "/browse": 1, "/movie": 1 });

    // A view reported from this "new isolate" reconciles to the larger of the layers.
    await recordPageView(env, "/browse");
    _resetViewsForTests();
    const stats2 = await getViewStats(env, 7);
    assert.equal(stats2.byPath["/browse"], 2, "cache RMW carries the increment forward");
  } finally {
    if (prev === undefined) delete (globalThis as { caches?: unknown }).caches;
    else (globalThis as { caches?: unknown }).caches = prev;
    _resetViewsForTests();
  }
});
