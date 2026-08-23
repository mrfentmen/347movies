#!/usr/bin/env node
/**
 * Whole-tree secret scan — the single implementation of the widened token-family scan,
 * shared end-to-end by the pre-commit hook (scripts/install-git-hooks.mjs), `npm test`, and
 * the CI secrets-scan job (.github/workflows/ci.yml calls this script directly), so the
 * pattern can never drift between CI and the hook.
 *
 * Any token-shaped string in any git-tracked file fails (exit 1), with the only allowed
 * occurrences being the synthetic scanner fixtures in tests/deploy.test.ts. The pattern
 * covers the token families an agent or founder might paste into a file: Cloudflare Pages
 * (cfut_), GitHub PATs (ghp_), fine-grained (github_pat_), OpenAI (sk-), AWS (AKIA) — each
 * branch is complete so a real key matches at full length.
 *
 * Usage:
 *   node scripts/check-secrets.ts            # scan git-tracked files (hook + npm test)
 *   node scripts/check-secrets.ts <dir>      # scan a directory recursively (tests)
 *
 * Importing this module has no side effects — the scan runs only when executed directly.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Same regex as the CI secrets-scan job — keep the two in sync. */
export const TOKEN_PATTERN =
  /\b(?:cfut_[A-Za-z0-9_=.-]{8,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|CF_API_TOKEN[A-Za-z0-9_=.-]{8,}|CLOUDFLARE_API_TOKEN[A-Za-z0-9_=.-]{8,})\b/;

/** The synthetic scanner fixtures in tests/deploy.test.ts — the only allowed occurrences. */
const FIXTURE_SUBSTRINGS = [
  "cfut_syntheticFixture00000000000000000000000000",
  "cfut_ABCdef123XYZ456abcDEF789ghiJKL012mnoPQR345",
];

/** Binary/asset extensions never hold tokens; skip reading them. */
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp4", ".webm", ".mp3", ".ogg", ".wav", ".zip", ".gz",
]);

/** Directories that are never part of the committed tree. */
const SKIP_DIRS = new Set([".git", "node_modules", ".venv-test", ".freebuff", ".wrangler", "dist"]);

export function scanForSecrets(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (SKIP_EXT.has(extname(file).toLowerCase())) continue;
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable/vanishing file: skip
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!TOKEN_PATTERN.test(line)) continue;
      if (FIXTURE_SUBSTRINGS.some((fx) => line.includes(fx))) continue;
      hits.push(`${file}:${i + 1}: token-shaped string`);
    }
  }
  return hits;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full, out);
      } else {
        out.push(full);
      }
    } catch {
      // unreadable/vanishing entry: skip
    }
  }
}

export function scanDir(root: string): string[] {
  const files: string[] = [];
  walk(root, files);
  return scanForSecrets(files);
}

export function scanGitTracked(cwd: string = process.cwd()): string[] {
  const out = execFileSync("git", ["ls-files"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return scanForSecrets(out.split("\n").filter(Boolean));
}

// Run only when executed directly, never on import (the unit test imports scanDir).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hits = process.argv[2] ? scanDir(process.argv[2]) : scanGitTracked();
  if (hits.length > 0) {
    for (const hit of hits) console.error(hit);
    console.error(
      `\nSecret scan failed: ${hits.length} token-shaped string(s) found — remove them before committing.`,
    );
    process.exit(1);
  }
  console.log("ok: no token-shaped strings in the scanned files");
}
