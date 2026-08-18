#!/usr/bin/env node
/**
 * Syntax-check every standalone .mjs script (node --check). Standalone scripts are outside
 * tsc's coverage and outside the server-route tests, so a broken script — e.g. the
 * warmup.mjs array-split that made `npm run warmup` a SyntaxError without any test noticing
 * (2026-08-17) — only surfaced when the script was actually run. This gate runs on every
 * `npm test` so script breakage is caught in CI like any other defect.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const failures = [];
for (const file of readdirSync("scripts").filter((f) => f.endsWith(".mjs"))) {
  try {
    execFileSync(process.execPath, ["--check", `scripts/${file}`], { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`  ok  ${file}`);
  } catch (err) {
    failures.push(file);
    console.error(`FAIL  ${file}`);
    const detail = (err.stdout?.toString() || err.stderr?.toString() || err.message).trim();
    if (detail) console.error(detail.split("\n").slice(0, 4).join("\n"));
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} script(s) failed node --check: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nall scripts pass node --check");
