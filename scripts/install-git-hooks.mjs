#!/usr/bin/env node
/**
 * Installs the pre-commit hook that runs the whole-tree secret scan
 * (scripts/check-secrets.ts) before every commit, so a token paste fails before it ever
 * reaches the tree. Runs on `npm install` / `npm ci` via the `postinstall` script.
 *
 * Non-destructive: if a custom pre-commit hook already exists, it is left untouched and a
 * warning is printed (wire the scan in manually). Idempotent: re-installs are no-ops when
 * the hook is already current. Silently skips outside a git checkout (CI included).
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
# Installed by scripts/install-git-hooks.mjs (npm postinstall). Runs the whole-tree secret
# scan before every commit — a token paste fails here, never reaching the tree. Delete this
# file to disable.
cd "$(git rev-parse --show-toplevel)" || exit 1
node scripts/check-secrets.ts || exit 1
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
  if (existing.includes("check-secrets.ts")) {
    console.log("pre-commit hook already installs check-secrets — up to date");
    process.exit(0);
  }
  console.warn(
    "install-git-hooks: an existing pre-commit hook was preserved — add `node scripts/check-secrets.ts || exit 1` to it manually",
  );
  process.exit(0);
}

writeFileSync(hookPath, HOOK);
chmodSync(hookPath, 0o755);
console.log("installed pre-commit hook:", hookPath);
