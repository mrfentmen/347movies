import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertDeployableGit, assertProductionDeployment, scanDeployFilesForSecrets } from "../scripts/deploy.ts";

const production = {
  id: "12568676-81d6-4492-881f-734aa461ed9d",
  url: "https://12568676.347movies.pages.dev",
  environment: "production",
};
const preview = {
  id: "da02040a-81d6-4492-881f-734aa461ed9d",
  url: "https://da02040a.347movies.pages.dev",
  environment: "preview",
};

test("assertProductionDeployment passes for the just-deployed production deployment", () => {
  assert.deepEqual(assertProductionDeployment(production, "12568676"), []);
});

test("assertProductionDeployment fails loudly when the deployment is a preview", () => {
  // The exact failure class from 2026-08-15 (deploy #40): the API says preview, never prod.
  const problems = assertProductionDeployment(preview, "da02040a");
  assert.ok(problems.length >= 1);
  assert.match(problems[0] ?? "", /environment is preview/);
});

test("assertProductionDeployment fails when the latest deployment is not the one just deployed", () => {
  const problems = assertProductionDeployment(production, "aaaa1111");
  assert.ok(problems.some((p) => p.includes("not the one just deployed")));
});

test("assertProductionDeployment fails when there is no latest deployment", () => {
  assert.ok(assertProductionDeployment(null, "12568676").length >= 1);
  assert.ok(assertProductionDeployment(undefined, "12568676").length >= 1);
});

test("assertDeployableGit passes for a clean tree on origin/main", () => {
  assert.deepEqual(assertDeployableGit("", "abc1234", "abc1234"), []);
});

test("assertDeployableGit refuses a dirty working tree", () => {
  const problems = assertDeployableGit(" M public/js/app.js\n", "abc1234", "abc1234");
  assert.ok(problems.some((p) => p.includes("working tree is dirty")));
});

test("assertDeployableGit refuses a HEAD behind origin/main", () => {
  const problems = assertDeployableGit("", "abc1234", "def5678");
  assert.ok(problems.some((p) => p.includes("HEAD (abc1234) != origin/main (def5678)")));
});

test("assertDeployableGit refuses when origin/main is unreachable", () => {
  const problems = assertDeployableGit("", "abc1234", null);
  assert.ok(problems.some((p) => p.includes("origin/main is not reachable")));
});

test("scanDeployFilesForSecrets finds the live token, cfut_ tokens, and long base64 runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "347movies-scan-"));
  try {
    writeFileSync(join(dir, "clean.ts"), "export const x = 1;");
    // Synthetic fixture — the previous real Cloudflare token here was exposed on this
    // pushed branch (2026-08-16) and required rotation; fixtures must never be live
    // credentials. Same shape so the scanner still proves it catches cfut_ tokens.
    writeFileSync(join(dir, "leak.txt"), "token=cfut_syntheticFixture00000000000000000000000000");
    writeFileSync(join(dir, "long.txt"), "seed=ABCdef123XYZ456abcDEF789ghiJKL012mnoPQR345");

    const leaks = scanDeployFilesForSecrets([dir]);
    assert.ok(leaks.some((f) => f.includes("leak.txt")));
    assert.ok(leaks.some((f) => f.includes("long.txt")));
    assert.ok(!leaks.some((f) => f.includes("clean.ts")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanDeployFilesForSecrets refuses when the configured token appears verbatim", () => {
  const dir = mkdtempSync(join(tmpdir(), "347movies-scan2-"));
  try {
    writeFileSync(join(dir, "wrangler.jsonc"), "token here: cfut_ABCdef123XYZ456abcDEF789ghiJKL012mnoPQR345");
    const findings = scanDeployFilesForSecrets([dir], "cfut_ABCdef123XYZ456abcDEF789ghiJKL012mnoPQR345");
    assert.ok(findings.some((f) => f.includes("the configured deploy token")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
