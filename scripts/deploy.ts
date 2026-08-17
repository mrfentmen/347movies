#!/usr/bin/env node
/**
 * 347movies — production deploy with environment verification (and deploy-hygiene gates).
 *
 * Runs `wrangler pages deploy` against the PRODUCTION branch (`main`) and then verifies, via
 * the Cloudflare Pages API, that the created deployment really has
 * `environment: "production"` — not preview. The lesson (2026-08-15, changelog deploy #40):
 * `--branch=production` silently creates a *preview* deployment on this project (its
 * production branch is `main`), which never reaches https://347movies.pages.dev — and the
 * smoke suite passes against either bundle (its checks are content-presence based), so
 * nothing caught it for two deploys. This script closes that hole: it pins the right branch
 * AND checks the deployment's environment, failing loudly on a preview.
 *
 * Deploy-hygiene gates (2026-08-16, operational-hardening pass):
 *   - Git-bound: refuses to deploy when the working tree is dirty or HEAD != origin/main —
 *     deploys ship merged, committed, CI-reviewed state, not whatever is on disk. Emergency
 *     override: DEPLOY_ALLOW_DIRTY=1 (loudly warned).
 *   - Secret scan: refuses if any deploy-relevant file (public/, functions/, lib/,
 *     wrangler.jsonc) contains a token-shaped string or the live token itself.
 *   - CI status: prints the merged commit's CI check-run conclusions (informational — the
 *     merge process enforces green; this surfaces it at deploy time). gh must be
 *     authenticated; absent gh is a warning, never a block.
 *
 * Env:
 *   CLOUDFLARE_API_TOKEN  — required for the environment check (same token wrangler uses).
 *                           If missing, the deploy still runs but the check is skipped with
 *                           a loud warning (never silently). Loaded from a gitignored .env
 *                           file at the repo root when present (never committed; see
 *                           docs/git-and-release.md).
 *   CLOUDFLARE_ACCOUNT_ID — defaults to the 347movies account id.
 *   CLOUDFLARE_PROJECT    — defaults to "347movies".
 *   CLOUDFLARE_BRANCH     — defaults to "main" (this project's production branch).
 *
 * Exits 0 when the deploy succeeded AND (token present) the latest deployment is production;
 * 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "ee32aa05d0ccfff9085adf3406874497";
const PROJECT = process.env.CLOUDFLARE_PROJECT || "347movies";
const BRANCH = process.env.CLOUDFLARE_BRANCH || "main";
const DEPLOY_URL_RE = /https:\/\/([a-z0-9-]+)\.347movies\.pages\.dev/;
const ALLOW_DIRTY = process.env.DEPLOY_ALLOW_DIRTY === "1";

/** Deploy-relevant roots scanned for token-shaped strings before wrangler runs. */
const SCAN_ROOTS = ["public", "functions", "lib", "wrangler.jsonc"];
/** Binary-ish extensions skipped by the secret scan (never rendered/compiled as text). */
const SCAN_SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".ttf", ".ico", ".mp4", ".webm"]);

/** Load a gitignored .env at the repo root into process.env (existing env vars win). */
function loadDotEnv(): void {
  try {
    const text = readFileSync(".env", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || !m[1] || !m[2]) continue;
      let value: string = m[2];
      if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch {
    // No .env: rely on the environment alone (e.g. CI with repository secrets).
  }
}

/**
 * Pure git-state gate: deploys must ship the merged main commit from a clean tree.
 * Returns a list of problems (empty = deployable).
 */
export function assertDeployableGit(porcelain: string, headSha: string, upstreamSha: string | null): string[] {
  const problems: string[] = [];
  if (porcelain.trim().length > 0) {
    problems.push(`working tree is dirty (${porcelain.trim().split(/\r?\n/).length} change(s)) — deploy only merged, committed state (override: DEPLOY_ALLOW_DIRTY=1)`);
  }
  if (!upstreamSha) {
    problems.push("origin/main is not reachable — cannot verify the deploy commit is merged");
  } else if (headSha !== upstreamSha) {
    problems.push(`HEAD (${headSha.slice(0, 7)}) != origin/main (${upstreamSha.slice(0, 7)}) — deploy only the merged main commit (override: DEPLOY_ALLOW_DIRTY=1)`);
  }
  return problems;
}

/**
 * Scan deploy-relevant files for token-shaped strings (the live token, `cfut_…` Pages
 * tokens, or any 40+ char base64-ish secret). Returns file-relative findings (empty = clean).
 */
export function scanDeployFilesForSecrets(roots: string[], token?: string): string[] {
  const findings: string[] = [];
  const tokenPattern = token && token.length >= 20 ? new RegExp(escapeRegExp(token)) : null;
  const genericPattern = /\b(?:cfut_|CF_API_TOKEN|CLOUDFLARE_API_TOKEN)[A-Za-z0-9_=.-]{8,}\b|[A-Za-z0-9_-]{40,}/;

  const scanFile = (path: string): void => {
    const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
    if (SCAN_SKIP_EXT.has(ext)) return;
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      return;
    }
    let hit: string | null = null;
    if (tokenPattern && tokenPattern.test(content)) hit = "the configured deploy token";
    else if (genericPattern.test(content)) hit = "a token-shaped string";
    if (hit) findings.push(`${path}: contains ${hit}`);
  };

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      try {
        if (statSync(full).isDirectory()) walk(full);
        else scanFile(full);
      } catch {
        // unreadable/vanishing file: skip
      }
    }
  };

  for (const root of roots) {
    try {
      if (statSync(root).isDirectory()) walk(root);
      else scanFile(root);
    } catch {
      // root absent: nothing to scan
    }
  }
  return findings;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Print the merged commit's CI check conclusions (informational; never a block). */
function printCiStatus(headSha: string): void {
  try {
    const gh = spawnSync("gh", ["api", `repos/mrfentmen/347movies/commits/${headSha}/check-runs`], { encoding: "utf8", timeout: 20_000 });
    if (gh.status !== 0) {
      console.warn("WARN  could not query CI status (gh unavailable or not authenticated) — confirm CI was green before merging");
      return;
    }
    const runs = (JSON.parse(gh.stdout) as { check_runs?: Array<{ name?: string; conclusion?: string | null; status?: string }> }).check_runs ?? [];
    if (runs.length === 0) {
      console.warn(`WARN  no CI check runs found for ${headSha.slice(0, 7)} — confirm CI was green before merging`);
      return;
    }
    console.log(`CI status for ${headSha.slice(0, 7)}:`);
    for (const run of runs) console.log(`  ${run.name ?? "?"}: ${run.conclusion ?? run.status ?? "?"}`);
  } catch (err) {
    console.warn(`WARN  could not query CI status: ${(err as Error).message}`);
  }
}

/**
 * Pure check: given the latest deployment object from the Pages API and the short id of the
 * deployment we just created, return a list of problems (empty = the deployment is live on
 * production). Exported so it is unit-testable without running the deploy.
 */
export function assertProductionDeployment(
  latest: { url?: string; environment?: string; id?: string } | null | undefined,
  expectedShortId: string | null,
): string[] {
  const problems: string[] = [];
  if (!latest) {
    return ["the Pages API returned no latest deployment"];
  }
  const short = String(latest.url ?? "").replace(/^https?:\/\//, "").split(".")[0] || null;
  if (latest.environment !== "production") {
    problems.push(`deployment environment is ${latest.environment ?? "unknown"} — expected "production" (a preview never reaches the canonical domain)`);
  }
  if (expectedShortId && short !== expectedShortId) {
    problems.push(`latest deployment (${short ?? "unknown"}) is not the one just deployed (${expectedShortId})`);
  }
  return problems;
}

async function main() {
  loadDotEnv();
  const token = process.env.CLOUDFLARE_API_TOKEN;

  // --- Deploy-hygiene gates (fail closed; override only with DEPLOY_ALLOW_DIRTY=1) ---
  const porcelain = (spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout ?? "").trim();
  const headSha = (spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout ?? "").trim();
  const upstreamSha = (spawnSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).stdout ?? "").trim() || null;
  const gitProblems = assertDeployableGit(porcelain, headSha, upstreamSha);
  if (gitProblems.length > 0 && !ALLOW_DIRTY) {
    console.error("REFUSE  deploy-hygiene gate failed — fix before deploying:");
    for (const p of gitProblems) console.error(`  - ${p}`);
    console.error("(Emergency override: DEPLOY_ALLOW_DIRTY=1 — not recommended.)");
    process.exit(1);
  }
  if (gitProblems.length > 0 && ALLOW_DIRTY) {
    console.warn("WARN  deploying with a dirty/behind tree because DEPLOY_ALLOW_DIRTY=1:");
    for (const p of gitProblems) console.warn(`  - ${p}`);
  } else {
    console.log(`ok    deploy gate: clean tree, HEAD == origin/main (${headSha.slice(0, 7)})`);
  }

  const secretFindings = scanDeployFilesForSecrets(SCAN_ROOTS, token);
  if (secretFindings.length > 0) {
    console.error("REFUSE  secret scan found token-shaped strings in deploy-relevant files:");
    for (const f of secretFindings) console.error(`  - ${f}`);
    process.exit(1);
  }

  printCiStatus(headSha);

  console.log(`Deploying public/ to project "${PROJECT}" on branch "${BRANCH}"…`);
  const result = spawnSync("npx", ["wrangler", "pages", "deploy", "public", "--project-name", PROJECT, "--branch", BRANCH], {
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    console.error(output);
    console.error(`FAIL  wrangler deploy exited with status ${result.status}`);
    process.exit(1);
  }
  console.log(output);

  const match = output.match(DEPLOY_URL_RE);
  const deployedShortId = match ? (match[1] ?? null) : null;
  if (!deployedShortId) {
    console.error("WARN  could not parse the deployment URL from wrangler output — cannot verify the environment.");
  }

  if (!token) {
    console.warn("WARN  CLOUDFLARE_API_TOKEN is not set — skipped the environment check. Set it (or a gitignored .env) to verify the deployment reached production.");
    if (!deployedShortId) process.exit(1);
    process.exit(0);
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(ACCOUNT_ID)}/pages/projects/${encodeURIComponent(PROJECT)}/deployments?per_page=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      console.error(`FAIL  Pages API returned ${res.status} — cannot verify the deployment.`);
      process.exit(1);
    }
    const body = (await res.json()) as { result?: Array<{ url?: string; environment?: string; id?: string }> };
    const latest = (body.result ?? [])[0];
    const problems = assertProductionDeployment(latest, deployedShortId);
    if (problems.length > 0) {
      console.error("FAIL  deployment did NOT reach production:");
      for (const p of problems) console.error(`  - ${p}`);
      console.error("Redeploy with the project's real production branch (see LAUNCH-RUNBOOK.md).");
      process.exit(1);
    }
    console.log(`ok    deployment ${deployedShortId} verified: environment = ${latest?.environment}`);
  } catch (err) {
    console.error(`FAIL  could not verify the deployment: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
