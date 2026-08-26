import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkRoutesProblems,
  functionRoutes,
  listStaticFiles,
  matchesExclude,
  publicPaths,
} from "../scripts/check-routes.ts";

/** Build a minimal mirror of the real tree: public/ statics + functions/ routes. */
function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), "347movies-routes-"));
  const files: Array<[string, string]> = [
    // public/ statics (mirroring the real deployment)
    ["public/index.html", "<html></html>"],
    ["public/about.html", "<html></html>"],
    ["public/404.html", "<html></html>"],
    ["public/css/style.css", "body{}"],
    ["public/js/app.js", "console.log(1)"],
    ["public/images/hero.jpg", "img"],
    ["public/fonts/plex.woff2", "font"],
    ["public/favicon.svg", "<svg/>"],
    ["public/manifest.webmanifest", "{}"],
    ["public/sw.js", "self"],
    ["public/robots.txt", "User-agent: *"],
    ["public/_headers", "/*\n  X-Test: 1"],
    ["public/_routes.json", "{}"],
    // functions/ routes (mirroring the real tree)
    ["functions/_middleware.ts", "export const onRequest = (c) => c.next();"],
    ["functions/_head.ts", "export function headHandler() {}"],
    ["functions/api/health.ts", "export const onRequestGet = () => new Response();"],
    ["functions/api/movie/[identifier].ts", "export const onRequestGet = () => new Response();"],
    ["functions/movie/[identifier].ts", "export const onRequestGet = () => new Response();"],
    ["functions/sitemap.xml.ts", "export const onRequestGet = () => new Response();"],
    ["functions/sitemap/[[slug]].ts", "export const onRequestGet = () => new Response();"],
  ];
  for (const [rel, content] of files) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

/** The exact exclude set deployed on 2026-08-26 (the _routes.json that stops the burn). */
const DEPLOYED_EXCLUDES = [
  "/css/*",
  "/js/*",
  "/images/*",
  "/fonts/*",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/sw.js",
  "/robots.txt",
  "/*.html",
  "/",
  "/404",
  "/about",
];

// ── matchesExclude (Cloudflare glob semantics) ──────────────────────────
test("matchesExclude: exact patterns match exactly", () => {
  assert.equal(matchesExclude("/about", "/about"), true);
  assert.equal(matchesExclude("/about", "/about.html"), false);
  assert.equal(matchesExclude("/about", "/privacy"), false);
});

test("matchesExclude: trailing /* matches any deeper path", () => {
  assert.equal(matchesExclude("/css/*", "/css/style.css"), true);
  assert.equal(matchesExclude("/css/*", "/css/a/b.css"), true);
  assert.equal(matchesExclude("/css/*", "/js/app.js"), false);
});

test("matchesExclude: mid-glob * matches any characters (/*.html covers every html path)", () => {
  assert.equal(matchesExclude("/*.html", "/about.html"), true);
  assert.equal(matchesExclude("/*.html", "/index.html"), true);
  assert.equal(matchesExclude("/*.html", "/about"), false);
  assert.equal(matchesExclude("/*.html", "/css/style.css"), false);
});

test("matchesExclude: regex metacharacters in patterns are treated literally", () => {
  assert.equal(matchesExclude("/movie/[id]/*", "/movie/abc"), false); // [ ] are literal, not a class
});

// ── publicPaths ─────────────────────────────────────────────────────────
test("publicPaths: html files are reachable at both forms; index at /", () => {
  assert.deepEqual(publicPaths("index.html"), ["/", "/index.html"]);
  assert.deepEqual(publicPaths("about.html"), ["/about", "/about.html"]);
  assert.deepEqual(publicPaths("css/style.css"), ["/css/style.css"]);
});

// ── listStaticFiles ─────────────────────────────────────────────────────
test("listStaticFiles: recursive, skips config/metadata files", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = listStaticFiles(join(root, "public"));
  assert.ok(files.includes("index.html"));
  assert.ok(files.includes("about.html"));
  assert.ok(files.includes("css/style.css"));
  assert.ok(files.includes("images/hero.jpg"));
  assert.ok(!files.includes("_headers"));
  assert.ok(!files.includes("_routes.json"));
});

// ── functionRoutes ──────────────────────────────────────────────────────
test("functionRoutes: skips middleware/head, maps dynamic segments to wildcards", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const routes = functionRoutes(join(root, "functions"), "");
  assert.ok(routes.includes("/api/health"));
  assert.ok(routes.includes("/api/movie/*"));
  assert.ok(routes.includes("/movie/*"));
  assert.ok(routes.includes("/sitemap.xml"));
  assert.ok(routes.includes("/sitemap/*"));
  assert.ok(!routes.includes("/_middleware"));
  assert.ok(!routes.includes("/_head"));
  assert.ok(!routes.some((r) => r.includes("[") || r.includes("]")));
});

// ── checkRoutesProblems: happy path ─────────────────────────────────────
test("checkRoutesProblems: the deployed config passes (all statics excluded, no route killed)", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cfg = { version: 1, include: ["/*"], exclude: DEPLOYED_EXCLUDES };
  assert.deepEqual(checkRoutesProblems(cfg, join(root, "public"), join(root, "functions")), []);
});

// ── checkRoutesProblems: failure modes ──────────────────────────────────
test("checkRoutesProblems: missing/unparseable _routes.json fails", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const problems = checkRoutesProblems(null, join(root, "public"), join(root, "functions"));
  assert.ok(problems.some((p) => p.includes("missing or unparseable")));
});

test("checkRoutesProblems: wrong version fails", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cfg = { version: 2, include: ["/*"], exclude: DEPLOYED_EXCLUDES };
  const problems = checkRoutesProblems(cfg, join(root, "public"), join(root, "functions"));
  assert.ok(problems.some((p) => p.includes("version must be 1")));
});

test("checkRoutesProblems: include missing /* fails (function routes lose middleware)", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cfg = { version: 1, include: ["/api/*"], exclude: DEPLOYED_EXCLUDES };
  const problems = checkRoutesProblems(cfg, join(root, "public"), join(root, "functions"));
  assert.ok(problems.some((p) => p.includes('include must contain "/*"')));
});

test("checkRoutesProblems: a static file with no exclude rule fails (silent re-billing)", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Drop /about from the excludes → about.html (both forms) is billed again.
  const cfg = { version: 1, include: ["/*"], exclude: DEPLOYED_EXCLUDES.filter((x) => x !== "/about") };
  const problems = checkRoutesProblems(cfg, join(root, "public"), join(root, "functions"));
  assert.ok(problems.some((p) => p.includes("about.html") && p.includes("NOT fully excluded")));
});

test("checkRoutesProblems: an .html form alone does not satisfy coverage (extensionless form must be excluded too)", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Only /*.html remains for about.html — the extensionless /about form is still billed.
  const cfg = { version: 1, include: ["/*"], exclude: DEPLOYED_EXCLUDES.filter((x) => x !== "/about") };
  const problems = checkRoutesProblems(cfg, join(root, "public"), join(root, "functions"));
  assert.ok(problems.some((p) => p.includes("/about")));
});

test("checkRoutesProblems: a too-broad exclude that kills a function route fails", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cfg = { version: 1, include: ["/*"], exclude: [...DEPLOYED_EXCLUDES, "/movie/*"] };
  const problems = checkRoutesProblems(cfg, join(root, "public"), join(root, "functions"));
  assert.ok(problems.some((p) => p.includes("/movie/*") && p.includes("middleware would stop running")));
});

test("checkRoutesProblems: wildcard excludes cannot accidentally match a function route unless truly broad", (t) => {
  const root = makeTree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // /*.html must NOT kill any function route (none end in .html).
  const cfg = { version: 1, include: ["/*"], exclude: DEPLOYED_EXCLUDES };
  assert.deepEqual(checkRoutesProblems(cfg, join(root, "public"), join(root, "functions")), []);
});
