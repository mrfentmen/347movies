/**
 * Drift guard for the weekly license-sweep script (scripts/license-sweep.ts) — the newest
 * consumer of the legal gate. The browse/search side is pinned to LEGAL_CLAUSE in
 * tests/archive-unit.test.ts; this file pins the sweep's probe queries to the SAME exported
 * constant, so a refactor that hardcodes the clause (the way scripts/scan-longtail.mjs does)
 * or drops one of its scheme arms fails CI instead of silently probing a different gate.
 *
 * Static source assertions, deliberately: the script's module body runs the sweep on import,
 * so importing it in a unit test would hit the live archive.org API.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LEGAL_CLAUSE } from "../lib/archive.ts";

const SCRIPT_PATH = new URL("../scripts/license-sweep.ts", import.meta.url).pathname;
const script = readFileSync(SCRIPT_PATH, "utf8");

test("license-sweep imports the exact LEGAL_CLAUSE constant (never a hardcoded clone)", () => {
  const importLine = script.match(/import\s*\{[^}]*LEGAL_CLAUSE[^}]*\}\s*from\s*"\.\.\/lib\/archive\.ts"/);
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
    script,
    /probe\(`\$\{LEGAL_CLAUSE\} AND \$\{pool\.gate\}`\);/,
    "pool probes interpolate LEGAL_CLAUSE",
  );
  assert.match(
    script,
    /probe\(`\$\{LEGAL_CLAUSE\} AND collection:\$\{cand\.name\} AND mediatype:\$\{cand\.mediatype\}`\);/,
    "candidate probes interpolate LEGAL_CLAUSE",
  );
  // …and the ONLY `licenseurl:` occurrences in the file must be the doc-prose mention of the
  // clause (line ~228). Any other literal is a hardcoded clone that bypasses the constant —
  // the exact drift this guard exists to catch (cf. the hardcoded clause in scan-longtail.mjs).
  const proseMention = script.match(/licenseurl:https:\/\/creativecommons\.org\*/g) ?? [];
  assert.ok(proseMention.length >= 1, "doc-prose mentions the gate for the report's audience");
  const literalCount = (script.match(/licenseurl:/g) ?? []).length;
  assert.equal(
    literalCount,
    proseMention.length,
    "no `licenseurl:` literal outside the doc prose — probe queries must reference LEGAL_CLAUSE",
  );
});
