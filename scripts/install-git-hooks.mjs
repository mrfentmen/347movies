#!/usr/bin/env node
/**
 * Installs the pre-commit hook that gates every commit on the full battery: the
 * whole-tree secret scan (scripts/check-secrets.ts), the typecheck, and the unit test
 * suite — so a token paste or broken code never reaches the tree. Runs on
 * `npm install` / `npm ci` via the `postinstall` script.
 *
 * Non-destructive: if a custom pre-commit hook already exists, it is left untouched and a
 * warning is printed (wire the checks in manually). Upgrades a previously-generated hook
 * (the secret-scan-only version) in place. Idempotent: re-installs are no-ops when the
 * hook is already current. Silently skips outside a git checkout (CI included).
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function gitRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

const HOOK = `#!/bin/sh
# Installed by scripts/install-git-hooks.mjs (npm postinstall). Gates every commit on the
# full battery — secret scan, typecheck, unit tests — so a token paste or broken code never
# reaches the tree. Delete this file to disable.
cd "$(git rev-parse --show-toplevel)" || exit 1

echo "pre-commit: secret scan"
node scripts/check-secrets.ts || exit 1

echo "pre-commit: typecheck"
npm run typecheck || exit 1

echo "pre-commit: tests"
npm test || exit 1

echo "pre-commit: all checks passed"
`;

const root = gitRoot();
if (!root) {
  console.log("install-git-hooks: not a git checkout, skipping pre-commit hook");
  process.exit(0);
}

const hooksDir = join(root, ".git", "hooks");
const hookPath = join(hooksDir, "pre-commit");

mkdirSync(hooksDir, { recursive: true });

if (existsSync(hookPath)) {
  const existing = readFileSync(hookPath, "utf8");
  if (existing.includes("npm run typecheck")) {
    console.log("pre-commit hook up to date");
    process.exit(0);
  }
  if (existing.includes("check-secrets.ts")) {
    // A previously-generated hook (the secret-scan-only version): this file is ours, so
    // upgrade it in place to the full battery.
    writeFileSync(hookPath, HOOK);
    chmodSync(hookPath, 0o755);
    console.log("upgraded pre-commit hook:", hookPath);
    process.exit(0);
  }
  console.warn(
    "install-git-hooks: an existing pre-commit hook was preserved — add the checks from `node scripts/check-secrets.ts`, `npm run typecheck`, and `npm test` to it manually",
  );
  process.exit(0);
}

writeFileSync(hookPath, HOOK);
chmodSync(hookPath, 0o755);
console.log("installed pre-commit hook:", hookPath);
