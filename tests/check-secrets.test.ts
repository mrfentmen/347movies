/**
 * Drift guard for the whole-tree secret scan (scripts/check-secrets.ts) — the scan the
 * pre-commit hook and `npm test` both run. If a future refactor weakens the pattern so a
 * real token family stops matching (or a "fix" makes it flag the synthetic fixtures), these
 * fixtures fail CI instead of shipping a scan that lets tokens through.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scanDir } from "../scripts/check-secrets.ts";

/** One representative full-length key per token family the scan must catch. */
const TOKEN_FAMILIES: Record<string, string> = {
  "cloudflare pages": "cfut_" + "a".repeat(30),
  "github pat": "ghp_" + "a".repeat(36),
  "github fine-grained": "github_pat_" + "a".repeat(40),
  "openai": "sk-" + "a".repeat(40),
  "aws access key": "AKIA" + "A".repeat(16),
};

test("check-secrets: every token family is flagged in a scanned directory", () => {
  for (const [family, token] of Object.entries(TOKEN_FAMILIES)) {
    const dir = mkdtempSync(join(tmpdir(), "cksec-"));
    try {
      writeFileSync(join(dir, "leak.txt"), `api_key=${token}\n`);
      const hits = scanDir(dir);
      assert.ok(
        hits.some((h) => h.startsWith(join(dir, "leak.txt"))),
        `${family} key should be flagged (hits: ${hits.join("; ") || "none"})`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("check-secrets: synthetic fixtures and clean files pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "cksec-"));
  try {
    writeFileSync(join(dir, "fixture.txt"), "token=cfut_syntheticFixture00000000000000000000000000\n");
    writeFileSync(join(dir, "clean.txt"), "const answer = 42;\n");
    assert.deepEqual(scanDir(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
