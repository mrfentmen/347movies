/**
 * UNIT tests for the static-page sitemap list (lib/sitemap.ts).
 *
 * The bug this guards: `/nfpf` shipped as a real landing page (title, meta
 * description, no noindex) with its own pool sitemap, but it was never added to
 * STATIC_PATHS — so /sitemap/static.xml never listed it and the page had to be
 * discovered by crawling alone. Nothing failed; it was just invisible.
 *
 * The rule enforced here: every `public/*.html` page that is indexable must be
 * listed in STATIC_PATHS. Pages that opt out (like /watchlist, which carries
 * `noindex, follow`) and the 404 page must NOT be.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { STATIC_PATHS, staticUrlLines } from "../lib/sitemap.ts";

const PUBLIC_DIR = new URL("../public/", import.meta.url).pathname;

/** Page path for an html file the way _routes.json exposes it: about.html → /about. */
function pagePath(file: string): string {
  return file === "index.html" ? "/" : `/${file.replace(/\.html$/, "")}`;
}

function htmlFiles(): string[] {
  return readdirSync(PUBLIC_DIR)
    .filter((f) => f.endsWith(".html"))
    .sort();
}

function isNoindex(file: string): boolean {
  const html = readFileSync(join(PUBLIC_DIR, file), "utf8");
  const meta = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i);
  const content = meta?.[1];
  return content ? /noindex/i.test(content) : false;
}

test("every indexable public page is in STATIC_PATHS", () => {
  const listed = new Set(STATIC_PATHS);
  const missing = htmlFiles()
    .filter((f) => f !== "404.html" && !isNoindex(f))
    .map(pagePath)
    .filter((p) => !listed.has(p));

  assert.deepEqual(
    missing,
    [],
    `indexable pages missing from STATIC_PATHS (they never reach /sitemap/static.xml): ${missing.join(", ")}`,
  );
});

/**
 * /browse and /search carry a deliberate `noindex, follow` (changelog 2026-08-15:
 * the 18.5k movie pages carry the SEO weight) yet both are still listed in the
 * static sitemap — a real contradiction that predates this test. It is pinned
 * exactly rather than ignored: any NEW noindex page leaking into the sitemap
 * fails here, and cleaning the pair up also fails here, so the two sides get
 * decided together instead of drifting.
 */
const LISTED_WITH_NOINDEX = ["/browse", "/search"];

test("noindex pages and 404 stay out of the sitemap", () => {
  const listed = new Set(STATIC_PATHS);
  const leaked = htmlFiles()
    .filter((f) => f === "404.html" || isNoindex(f))
    .map(pagePath)
    .filter((p) => listed.has(p))
    .sort();

  assert.deepEqual(
    leaked,
    LISTED_WITH_NOINDEX,
    "the set of sitemap-listed noindex pages changed — decide /browse and /search deliberately",
  );
});

test("nfpf is listed (regression)", () => {
  assert.ok(STATIC_PATHS.includes("/nfpf"), "/nfpf is a real indexable page");
});

test("STATIC_PATHS has no duplicates and only root-relative paths", () => {
  assert.equal(new Set(STATIC_PATHS).size, STATIC_PATHS.length);
  for (const p of STATIC_PATHS) {
    assert.ok(p.startsWith("/"), `${p} must start with /`);
    assert.ok(!p.endsWith("/") || p === "/", `${p} must not end with /`);
  }
});

test("staticUrlLines emits one absolute <url> per static page", () => {
  const lines = staticUrlLines("https://347movies.com");
  assert.equal(lines.filter((l) => l.includes("<url>")).length, STATIC_PATHS.length);
  assert.ok(lines.some((l) => l.includes("<loc>https://347movies.com/nfpf</loc>")));
});
