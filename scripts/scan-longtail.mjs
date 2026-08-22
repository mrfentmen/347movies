#!/usr/bin/env node
/**
 * 347movies — long-tail hanger scanner (dependency-free, Node 22+ — imports the TS gate
 * constant via Node's type-stripping, same as scripts/license-sweep.ts).
 *
 * Scans catalog identifiers against archive.org's metadata endpoint with gentle pacing and
 * flags the items whose metadata does not respond in time — the known hanger class
 * documented in changelog.md (~8% of the older long tail at a 12s cutoff, e.g. `chevrolet`,
 * `factory`, `RoadstoR1950_2`). Those items are served an honest fail-closed 502 page by
 * the site; this tool quantifies the set so the founder can decide whether to trim the
 * sitemap or just watch them.
 *
 * Designed for long, chunked runs: results append to a JSONL file and already-checked ids
 * are skipped on resume, so the full ~18.5k-item scan can run over several sessions.
 *
 *   node scripts/scan-longtail.mjs                 # full catalog, default pacing
 *   node scripts/scan-longtail.mjs --limit 40      # quick check
 *   node scripts/scan-longtail.mjs --offset 2000 --limit 1000 --out part2.jsonl
 *   node scripts/scan-longtail.mjs --ids ids.txt --timeout 8 --pacing 300
 *   node scripts/scan-longtail.mjs --report KNOWN-HANGERS.md   # after a run
 *
 * Exit 0 always (a partial scan is still useful); the report tells the story.
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { BASE_CLAUSE } from "../lib/archive.ts";

const DEFAULT_SRC = "https://archive.org/advancedsearch.php";
// The films gate from the single exported constant — byte-identical to what the live search
// and the catalog-index build query (lib/archive.ts BASE_CLAUSE), so this founder tool can
// never drift from the site's own gate.
const LEGAL_QUERY = BASE_CLAUSE;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? fallback : v;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const LIMIT = Number(arg("limit", 0)); // 0 = no limit
const OFFSET = Number(arg("offset", 0));
const TIMEOUT_S = Number(arg("timeout", 12));
const PACING_MS = Number(arg("pacing", 800));
const OUT_FILE = arg("out", "longtail-results.jsonl");
const REPORT = arg("report", "");
const SRC_FILE = arg("ids", "");

/** Fetch the full legal catalog identifiers (one no-page request, minimal fields). */
async function fetchCatalogIds() {
  const url = new URL(DEFAULT_SRC);
  url.searchParams.set("q", LEGAL_QUERY);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", "50000");
  url.searchParams.append("fl[]", "identifier");
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  const data = await res.json();
  const docs = data?.response?.docs;
  if (!Array.isArray(docs)) throw new Error("catalog fetch returned an unexpected shape");
  return docs.map((d) => String(d?.identifier ?? "")).filter(Boolean);
}

function loadIds() {
  return readFileSync(SRC_FILE, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ids already recorded in the output file (resume support). */
function loadChecked() {
  if (!existsSync(OUT_FILE)) return new Set();
  const seen = new Set();
  for (const line of readFileSync(OUT_FILE, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (typeof rec.id === "string") seen.add(rec.id);
    } catch {
      /* skip malformed line */
    }
  }
  return seen;
}

async function checkId(id) {
  const url = `https://archive.org/metadata/${encodeURIComponent(id)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_S * 1000) });
    return { id, status: res.status, timeMs: Date.now() - started, healthy: res.ok };
  } catch {
    return { id, status: 0, timeMs: Date.now() - started, healthy: false, timeout: true };
  }
}

async function main() {
  const checked = loadChecked();
  let ids;
  if (SRC_FILE) {
    ids = loadIds();
    console.log(`reading ${ids.length} ids from ${SRC_FILE}`);
  } else {
    console.log("fetching the legal catalog...");
    ids = await fetchCatalogIds();
    console.log(`catalog has ${ids.length} ids`);
  }
  const todo = ids.filter((id) => !checked.has(id));
  if (OFFSET > 0) todo.splice(0, OFFSET);
  const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  console.log(`checking ${batch.length} ids (${checked.size} already on file, timeout ${TIMEOUT_S}s, pacing ${PACING_MS}ms)`);

  let healthy = 0;
  let hangers = 0;
  let other = 0;
  const hangerList = [];
  for (let i = 0; i < batch.length; i++) {
    const id = batch[i];
    const rec = await checkId(id);
    const line = JSON.stringify({ ...rec, checkedAt: new Date().toISOString() });
    appendFileSync(OUT_FILE, line + "\n");
    if (rec.healthy) healthy += 1;
    else if (rec.status === 0) {
      hangers += 1;
      hangerList.push(id);
    } else other += 1;
    if ((i + 1) % 20 === 0 || i === batch.length - 1) {
      const pct = Math.round(((i + 1) / batch.length) * 100);
      console.log(`  ${i + 1}/${batch.length} (${pct}%) — healthy ${healthy}, hangers ${hangers}, other ${other}`);
    }
    if (i < batch.length - 1 && PACING_MS > 0) await new Promise((r) => setTimeout(r, PACING_MS));
  }

  console.log(`\ndone: ${batch.length} checked → healthy ${healthy}, hangers ${hangers}, other ${other}`);
  console.log(`results appended to ${OUT_FILE}${hangerList.length ? ` (resume skips checked ids)` : ""}`);

  if (REPORT) {
    const hangerRate = batch.length ? ((hangers / batch.length) * 100).toFixed(1) : "0.0";
    const md = [
      `# Known hangers (${new Date().toISOString().slice(0, 10)})`,
      "",
      `Scanned ${batch.length} items in this run (full catalog ≈ ${ids.length}). Items whose`,
      "archive.org metadata did not respond within the timeout are served an honest",
      "fail-closed 502 page with a source link — never a dead player.",
      "",
      `- Healthy: ${healthy}`,
      `- Hangers: ${hangers} (${hangerRate}% of this run)`,
      `- Other statuses: ${other}`,
      "",
      "> Note: short timeouts over-flag transients (archive.org throttling can look like a hang;",
      "> re-check flagged ids at the default 12s timeout before acting on them).",
      "",
      "## Hanger identifiers",
      ...(hangerList.length ? hangerList.map((id) => `- \`${id}\``) : ["(none in this run)"]),
      "",
    ].join("\n");
    writeFileSync(REPORT, md);
    console.log(`report written to ${REPORT}`);
  }
}

main().catch((err) => {
  console.error(`scan failed: ${err.message}`);
  process.exit(1);
});
