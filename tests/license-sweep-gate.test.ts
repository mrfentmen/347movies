/**
 * Drift guard for the two scripts that build their own archive.org gate queries — the
 * weekly license-sweep (scripts/license-sweep.ts) and the founder's long-tail scanner
 * (scripts/scan-longtail.mjs). The browse/search side is pinned to LEGAL_CLAUSE in
 * tests/archive-unit.test.ts; this file pins BOTH scripts to the SAME exported constants
 * (LEGAL_CLAUSE / BASE_CLAUSE), so a refactor that hardcodes the clause or drops one of its
 * scheme arms fails CI instead of silently querying a different gate.
 *
 * Static source assertions, deliberately: license-sweep's module body runs the sweep on
 * import, so importing it in a unit test would hit the live archive.org API. scan-longtail
 * is covered the same way for symmetry.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BASE_CLAUSE, LEGAL_CLAUSE } from "../lib/archive.ts";

const SWEEP_PATH = new URL("../scripts/license-sweep.ts", import.meta.url).pathname;
const LONGTAIL_PATH = new URL("../scripts/scan-longtail.mjs", import.meta.url).pathname;
const sweep = readFileSync(SWEEP_PATH, "utf8");
const longtail = readFileSync(LONGTAIL_PATH, "utf8");

test("license-sweep imports the exact LEGAL_CLAUSE constant (never a hardcoded clone)", () => {
  const importLine = sweep.match(/import\s*\{[^}]*LEGAL_CLAUSE[^}]*\}\s*from\s*"\.\.\/lib\/archive\.ts"/);
  assert.ok(importLine, "scripts/license-sweep.ts imports LEGAL_CLAUSE from lib/archive.ts");
});

test("LEGAL_CLAUSE still gates both declared-mark scheme arms (https and http)", () => {
  assert.ok(
    LEGAL_CLAUSE.includes("licenseurl:https://creativecommons.org*") &&
      LEGAL_CLAUSE.includes("licenseurl:http://creativecommons.org*"),
    "LEGAL_CLAUSE must keep both scheme arms — the sweep and every pool query build on it",
  );
});

test("license-sweep's probe queries are built from the constant, not a hardcoded clause", () => {
  // Both probe call sites must reference LEGAL_CLAUSE in their query construction…
  assert.match(
    sweep,
    /probe\(`\$\{LEGAL_CLAUSE\} AND \$\{pool\.gate\}`\);/,
    "pool probes interpolate LEGAL_CLAUSE",
  );
  assert.match(
    sweep,
    /probe\(`\$\{LEGAL_CLAUSE\} AND collection:\$\{cand\.name\} AND mediatype:\$\{cand\.mediatype\}`\);/,
    "candidate probes interpolate LEGAL_CLAUSE",
  );
  // …and the ONLY `licenseurl:` occurrences in the file must be the doc-prose mention of the
  // clause (line ~228). Any other literal is a hardcoded clone that bypasses the constant.
  const proseMention = sweep.match(/licenseurl:https:\/\/creativecommons\.org\*/g) ?? [];
  assert.ok(proseMention.length >= 1, "doc-prose mentions the gate for the report's audience");
  const literalCount = (sweep.match(/licenseurl:/g) ?? []).length;
  assert.equal(
    literalCount,
    proseMention.length,
    "no `licenseurl:` literal outside the doc prose — probe queries must reference LEGAL_CLAUSE",
  );
});

test("scan-longtail builds its catalog query from the exported BASE_CLAUSE, not a hardcoded clause", () => {
  // The films gate must come from the exported constant…
  assert.match(
    longtail,
    /import\s*\{[^}]*BASE_CLAUSE[^}]*\}\s*from\s*"\.\.\/lib\/archive\.ts"/,
    "scripts/scan-longtail.mjs imports BASE_CLAUSE from lib/archive.ts",
  );
  assert.match(longtail, /const LEGAL_QUERY = BASE_CLAUSE;/, "LEGAL_QUERY is the exported BASE_CLAUSE constant");
  // …and the emitted text stays byte-identical to the live search gate, so the tool scans
  // exactly the same catalog the site serves.
  assert.equal(
    BASE_CLAUSE,
    "(licenseurl:https://creativecommons.org* OR licenseurl:http://creativecommons.org*) " +
      "AND collection:(feature_films OR prelinger OR moviesandfilms) AND mediatype:movies",
    "BASE_CLAUSE text matches the films gate the tool documents",
  );
  // No hardcoded `licenseurl:` literal may appear outside comments/docstrings.
  const stripped = longtail.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!stripped.includes("licenseurl:"), "no hardcoded licenseurl: clause outside comments");
});
