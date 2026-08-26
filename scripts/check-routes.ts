#!/usr/bin/env node
/**
 * Verify the Pages Functions routing config (public/_routes.json).
 *
 * Pages' default is: once ANY function exists, EVERY request invokes the
 * Functions layer (the root _middleware.ts) — including static assets,
 * each of which is billed as a Function request toward the account-wide
 * free-tier 100k/day cap (shared across every Pages project on the
 * account). _routes.json excludes the static paths so they are served
 * straight from the asset store: free, unlimited, and WITHOUT the
 * middleware running (public/_headers still applies the security headers
 * to them — that file exists exactly for this).
 *
 * Without this gate, a future edit that removes or narrows _routes.json
 * would silently re-bill every CSS/JS/image/font fetch — the exact
 * regression that burned 83,027 requests on 2026-08-25.
 *
 * What it verifies (wired into scripts/deploy.ts, before wrangler runs):
 *   1. SHAPE: _routes.json is version 1 with include ["/*"] (so every
 *      function route keeps middleware coverage).
 *   2. COVERAGE: EVERY reachable form of every static file in public/ is
 *      excluded — the extensionless form (/about), the .html form
 *      (/about.html, which Pages 308-redirects but still bills if
 *      unrouted), and the homepage / (index.html). A new static file
 *      added later without an exclude rule FAILS the deploy — no silent
 *      re-billing.
 *   3. SAFETY: no function route (derived from the functions/ tree) is
 *      matched by an exclude rule — a too-broad exclude can't kill an
 *      API/movie/sitemap route or the middleware that rate-limits them.
 *
 * The checker is a pure module: checkRoutesProblems() takes the parsed
 * config plus the public/ and functions/ directory paths and returns a
 * list of problems (empty = deployable), so it is unit-testable without
 * touching the network or the real tree (tests/check-routes.test.ts).
 * Importing this module has no side effects — the scan runs only when
 * executed directly.
 *
 * Usage:
 *   node scripts/check-routes.ts [--check]   # runs against the real tree
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Config/metadata files that are never served as content. */
const SKIP_FILES = new Set(["_headers", "_redirects", "_routes.json", ".DS_Store"]);
/** Pages special function files that are NOT routes (they wrap/annotate, never serve). */
const FUNCTION_SPECIALS = new Set(["_middleware.ts", "_head.ts"]);

/** Escape regex metacharacters in a literal segment of a glob pattern. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does a route (e.g. /css/style.css) match an exclude pattern?
 * Implements Cloudflare's _routes.json glob semantics: `*` matches any sequence of
 * characters (including `/`), so /css/* matches /css/style.css and /*.html matches
 * /about.html. Patterns without `*` are exact matches. Mirrors how Cloudflare actually
 * routes, so a rule the checker accepts behaves identically in production.
 */
export function matchesExclude(pattern: string, route: string): boolean {
  if (!pattern.includes("*")) return route === pattern;
  const re = new RegExp("^" + pattern.split("*").map(escapeRe).join(".*") + "$");
  return re.test(route);
}

/**
 * Every URL form Pages can serve a public/ file at. HTML files are reachable at BOTH the
 * extensionless form (the live one — /about serves about.html, / serves index.html) and the
 * literal .html form (which 308-redirects but is still a request that bills if unrouted).
 * Non-HTML files have one form.
 */
export function publicPaths(rel: string): string[] {
  const url = "/" + rel.split("/").join("/");
  if (rel === "index.html") {
    return ["/", url]; // the homepage is served at /, and the literal /index.html also 308s
  }
  if (rel.endsWith(".html")) {
    return [url.replace(/\.html$/, ""), url];
  }
  return [url];
}

/** Every static file under public/ (recursive), as repo-relative paths. */
export function listStaticFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_FILES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listStaticFiles(full).map((f) => join(entry.name, f)));
    } else {
      out.push(entry.name);
    }
  }
  return out;
}

/** functions/ tree → the URL routes the middleware must keep covering. */
export function functionRoutes(dir: string, prefix: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (FUNCTION_SPECIALS.has(entry.name)) continue;
    const relUrl = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      routes.push(...functionRoutes(join(dir, entry.name), relUrl));
    } else if (entry.name.endsWith(".ts")) {
      let route = relUrl.replace(/\.ts$/, "");
      if (route.endsWith("/index")) route = route.slice(0, -"/index".length);
      // Dynamic segments become wildcards: [identifier].ts → /*, [[slug]].ts → /*
      route = route.replace(/\[\[[^\]]+\]\]/g, "*").replace(/\[[^\]]+\]/g, "*");
      if (!route) route = "/";
      if (!route.startsWith("/")) route = "/" + route;
      routes.push(route);
    }
  }
  return routes;
}

/**
 * Pure check: returns a list of problems (empty = deployable). Exported for unit tests.
 * @param cfg    the parsed _routes.json
 * @param publicDir  path to public/ (fixtures in tests)
 * @param functionsDir path to functions/ (fixtures in tests)
 */
export function checkRoutesProblems(
  cfg: { version?: number; include?: string[]; exclude?: string[] } | null,
  publicDir: string,
  functionsDir: string,
): string[] {
  const problems: string[] = [];
  if (!cfg) return ["public/_routes.json is missing or unparseable — static assets would be billed as Function requests"];
  if (cfg.version !== 1) problems.push(`_routes.json version must be 1 (got ${cfg.version})`);
  if (!Array.isArray(cfg.include) || !cfg.include.includes("/*")) {
    problems.push(`_routes.json include must contain "/*" (function routes need middleware coverage)`);
  }
  const excludes = Array.isArray(cfg.exclude) ? cfg.exclude : [];
  if (!Array.isArray(cfg.exclude)) problems.push("_routes.json exclude must be an array");

  // Coverage: every reachable form of every static file must be excluded.
  const uncovered: string[] = [];
  for (const rel of listStaticFiles(publicDir)) {
    const forms = publicPaths(rel);
    const covered = forms.filter((f) => excludes.some((x) => matchesExclude(x, f)));
    // EVERY form must be excluded — the extensionless form is the one actually served, and
    // the .html form still bills on the 308 hop if unrouted.
    if (covered.length !== forms.length) {
      uncovered.push(`${rel} (uncovered: ${forms.filter((f) => !excludes.some((x) => matchesExclude(x, f))).join(", ")})`);
    }
  }
  if (uncovered.length) {
    problems.push(
      `static file(s) NOT fully excluded from Functions (would be billed): ${uncovered.join("; ")} — add exclude rules to public/_routes.json`,
    );
  }

  // Safety: no function route may match an exclude (a too-broad exclude kills the route's middleware).
  const killed: string[] = [];
  for (const route of functionRoutes(functionsDir, "")) {
    for (const m of excludes) {
      if (matchesExclude(m, route)) killed.push(`${route} (exclude "${m}")`);
    }
  }
  if (killed.length) {
    problems.push(
      `function route(s) matched by an exclude rule — middleware would stop running: ${killed.join("; ")}`,
    );
  }

  return problems;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  // Run from the repo root (like deploy.ts, which reads .env / scans relative paths from cwd).
  const root = process.cwd();
  let cfg: { version?: number; include?: string[]; exclude?: string[] } | null = null;
  try {
    cfg = JSON.parse(readFileSync(join(root, "public", "_routes.json"), "utf8")) as typeof cfg;
  } catch {
    cfg = null;
  }
  const problems = checkRoutesProblems(cfg, join(root, "public"), join(root, "functions"));
  if (problems.length === 0) {
    console.log("✓ check-routes: every static file excluded from Functions (free, unlimited); all function routes keep middleware.");
    return;
  }
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n✘ check-routes: ${problems.length} problem(s) — static assets would be billed or a route would die.`);
  if (!check) {
    console.error("Run with --check in the deploy chain (it exits non-zero on any problem).");
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
