# Live-Surface Browser Battery (console/network hygiene) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ad-hoc live-surface Playwright pass (home/browse/search/genre/watchlist/movie — console/network hygiene with third-party attribution) a permanent, CI-guarded script, mirroring the prototype smoke already shipped in PR #19.

**Architecture:** A pure-Playwright battery (`scripts/live_surface_battery.py`) that targets a base URL via `LIVE_BASE_URL` and asserts structure + hygiene per surface, filtering known third-party noise (archive.org, headless-Chrome artifacts) the same way `scripts/e2e_test.py` and `scripts/prototype_smoke.py` do. A Node orchestrator (`scripts/live-surface-battery.mjs`) boots `wrangler pages dev` on :8788 (same recipe as the CI smoke job), waits for `/api/health`, runs the battery, and tears down — self-contained, no "dev server must already be running" assumption. A third CI job runs it on every PR/push with Playwright's bundled chromium.

**Tech Stack:** Python 3 + Playwright (system Chrome via `channel="chrome"` locally; bundled chromium under `LIVE_CI=1`), Node 22, Wrangler (`wrangler pages dev`), GitHub Actions (ubuntu-latest).

> **Overhaul note (post-execution):** the final shipped shape deviates from this plan by
> design — instead of a second script/orchestrator/CI-job pair mirroring the prototype
> smoke, both batteries were unified: `scripts/battery_common.py` owns the hygiene
> contract (fail-closed third-party attribution, `check()`/exit contract, browser
> selection), `scripts/live_surface_battery.py` + `scripts/prototype_smoke.py` are thin
> surfaces over it, and one orchestrator (`scripts/browser-battery.mjs`, target arg
> `live`/`prototype`) plus one matrix CI job (`browser-batteries`) replace the two of
> each. Env renames: `LIVE_CI`/`PROTOTYPE_CI` → `BATTERY_CI`. The task steps below
> remain the as-executed record; the unification also fixed the prototype battery's
> message-text console filter (the shared module filters by source URL, fail-closed).

## Global Constraints

- **Zero false positives on our origin:** any console `error`, pageerror, or `>= 500` response whose source is NOT archive.org / `chrome-extension://` is a defect and fails the run. Fail-closed on empty/unknown source URLs.
- **Third-party noise is known and attributed, not silenced:** archive.org poster-node 5xx on search results (absorbed by the initials fallback — verified), the embed's internal `.categories` pageerror (identical on the live site), and `chrome-extension://invalid/` blocked requests (headless-Chrome artifact) are filtered by the SAME tuples already used in `scripts/e2e_test.py` (`THIRD_PARTY_PAGEERRORS`) — do not invent new filter strings.
- **Self-contained:** the orchestrator boots its own dev server (no reliance on a manually started :8787); `LIVE_BASE_URL` override exists for pointing at production or an already-running server.
- **Mirror the prototype smoke:** same file naming pattern (`scripts/X_smoke.py` + `scripts/X-smoke.mjs`), same `check()`/exit-code contract, same CI-job shape as the `prototype` job in `.github/workflows/ci.yml` — reviewers should be able to diff the two jobs and see they're the same recipe.
- **No site-code change:** this is verification tooling only. The site (`public/`, `functions/`, `lib/`) must be untouched by this plan.
- **Repo commit gate:** normal git commits on a feature branch, PR against `main` (the T4.5 plan's "no git history" note predates this repo's git usage — PR #19 proved the modern flow).

---

### Task 1: The battery — `scripts/live_surface_battery.py`

**Files:**
- Create: `scripts/live_surface_battery.py`

**Interfaces:**
- Consumes: nothing (standalone script; Playwright + system Chrome/bundled chromium).
- Produces: `main()` that exits 0 when every surface passes structure + hygiene, 1 otherwise. Env: `LIVE_BASE_URL` (default `http://127.0.0.1:8787`), `LIVE_CI` (`"1"` → bundled chromium + `python3`). Prints `ok`/`FAIL` lines, ends with `N failure(s)` or `ALL CHECKS PASSED` (same contract as `scripts/prototype_smoke.py`).

- [ ] **Step 1: Write the failing battery (empty surfaces list)**

```python
#!/usr/bin/env python3
"""Live-surface browser battery for 347movies: structure + console/network hygiene.

Run against a base URL (default 127.0.0.1:8787):
    python3 scripts/live_surface_battery.py
    LIVE_BASE_URL=http://127.0.0.1:8788 python3 scripts/live_surface_battery.py

Browser: system Chrome via channel="chrome" (the repo's proven pattern). Set
LIVE_CI=1 to use Playwright's bundled chromium (CI runners without system Chrome).

Hygiene rule (fail-closed): a console error, pageerror, or >=500 response whose
source is NOT archive.org / chrome-extension:// is a defect. archive.org poster-node
5xx (absorbed by the initials fallback), the embed's internal '.categories'
pageerror, and headless-Chrome 'chrome-extension://invalid/' artifacts are KNOWN
third-party noise — filtered by the same convention as scripts/e2e_test.py.
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("LIVE_BASE_URL", "http://127.0.0.1:8787").rstrip("/")
CI = os.environ.get("LIVE_CI") == "1"

# Third-party noise, same attribution as scripts/e2e_test.py:
THIRD_PARTY_HOSTS = ("archive.org", "chrome-extension://")
THIRD_PARTY_PAGEERRORS = ("Cannot read properties of null (reading 'categories')", "Transition was skipped")

failures = []


def check(name, ok, detail=""):
    print(f"  {'ok ' if ok else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def our_origin(url):
    """True when the URL is not known third-party noise. Empty/unknown -> True (fail-closed)."""
    return not any(h in url for h in THIRD_PARTY_HOSTS)


def main():
    # TODO: fill the surfaces list (Task 1, Step 4)
    surfaces = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True) if CI else p.chromium.launch(headless=True, channel="chrome")
        for name, path, ok_fn in surfaces:
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            our_console, our_page_errs, our_5xx = [], [], []
            page.on("console", lambda m: our_console.append(m.text) if m.type == "error" and our_origin(m.location.get("url") or "") else None)
            page.on("pageerror", lambda e: our_page_errs.append(str(e)))
            page.on("response", lambda r: our_5xx.append(r.url) if r.status >= 500 and our_origin(r.url) else None)

            page.goto(f"{BASE}{path}")
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(2500)

            check(f"{name}: expected content renders", ok_fn(page))
            check(f"{name}: zero console errors from our origin", len(our_console) == 0, str(our_console[:2]))
            check(f"{name}: zero page errors from our origin", len([e for e in our_page_errs if not any(k in e for k in THIRD_PARTY_PAGEERRORS)]) == 0, str(our_page_errs[:2]))
            check(f"{name}: zero 5xx responses from our origin", len(our_5xx) == 0, str(our_5xx[:2]))
            page.close()
        browser.close()

    print(f"\n{len(failures)} failure(s)" if failures else "\nALL CHECKS PASSED")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it — verify the harness executes**

Run: `.venv-test/bin/python scripts/live_surface_battery.py`
Expected: prints `0 failure(s)` and exits 0 — the empty `surfaces` list trivially passes, which is correct for this step: it proves the harness (launch, check(), exit-code path) runs. The real assertions land in Step 3–4.

- [ ] **Step 3: Add the `surfaces` table with per-surface structure predicates**

Replace the empty list from Step 1:

```python
    surfaces = [
        ("home", "/", lambda page: page.locator(".grid").count() >= 1),
        ("browse", "/browse?genre=film-noir", lambda page: page.locator(".grid").count() >= 1),
        ("search", "/search?q=noir", lambda page: page.locator(".grid").count() >= 1),
        ("genre", "/genre", lambda page: page.locator(".grid").count() >= 1),
        ("watchlist", "/watchlist", lambda page: page.locator("main").count() == 1),
        ("movie", "/movie/it-1927", lambda page: page.locator("iframe.player").count() == 1),
    ]
```

- [ ] **Step 4: Run against the local dev server — expect all green**

Run: `.venv-test/bin/python scripts/live_surface_battery.py` (dev server on :8787 already running).
Expected: **24 `ok` lines** (6 surfaces × 4 checks: content renders, console errors, page errors, 5xx responses), `ALL CHECKS PASSED`, exit 0. If `search` reports a console error whose URL contains `archive.org`, it is correctly filtered — do NOT treat it as a failure; verify the filter is the cause before changing anything.

- [ ] **Step 5: Commit**

```bash
git add scripts/live_surface_battery.py
git commit -m "test: live-surface browser battery (console/network hygiene)"
```

---

### Task 2: The orchestrator — `scripts/live-surface-battery.mjs`

**Files:**
- Create: `scripts/live-surface-battery.mjs`
- Modify: `package.json` (add `"test:live-surfaces"` script)

**Interfaces:**
- Consumes: Task 1's `scripts/live_surface_battery.py` (env: `LIVE_BASE_URL`, `LIVE_CI`).
- Produces: `npm run test:live-surfaces` — boots `wrangler pages dev` on :8788, waits for `/api/health`, runs the battery with `LIVE_BASE_URL=http://127.0.0.1:8788`, tears the server down, exits with the battery's status. Env passthrough: `LIVE_CI` (bundled chromium) and `LIVE_BASE_URL` (override — skips booting).

- [ ] **Step 1: Write the orchestrator**

```javascript
#!/usr/bin/env node
/**
 * Live-surface battery orchestrator — boots `wrangler pages dev` on :8788, waits
 * for /api/health, runs scripts/live_surface_battery.py, tears the server down.
 * Exit code is the battery's. Used by `npm run test:live-surfaces` and the CI job.
 *
 * Env:
 *   LIVE_CI=1        — use Playwright's bundled chromium (CI has no system Chrome);
 *                      resolve the venv-less python (assumes `pip install playwright`).
 *   LIVE_BASE_URL    — override the target; when set, the dev server is NOT booted
 *                      (point at an already-running server or production).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = 8788;
const ci = process.env.LIVE_CI === "1";

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;

// Boot the dev server only when the caller did not pin a target.
if (!process.env.LIVE_BASE_URL) {
  server = spawn(
    "npx",
    ["wrangler", "pages", "dev", "public", "--port", String(port), "--binding", "RATE_LIMIT=10000"],
    { cwd: root, stdio: "ignore", detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
  );
  server.unref();

  let healthy = false;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* not up yet */
    }
  }
  if (!healthy) {
    console.error("wrangler dev did not become healthy");
    process.exit(1);
  }
}

const python = ci ? "python3" : path.join(root, ".venv-test", "bin", "python");
const env = {
  ...process.env,
  LIVE_BASE_URL: process.env.LIVE_BASE_URL ?? `http://127.0.0.1:${port}`,
};
const status = await run(python, [path.join(root, "scripts", "live_surface_battery.py")], { env });

if (server) {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}
process.exit(status);
```

- [ ] **Step 2: Run it — expect all green with a self-booted server**

Run: `npm run test:live-surfaces`
Expected: wrangler boots on :8788 (health check passes), the battery prints the same 24 `ok` lines against `http://127.0.0.1:8788`, `ALL CHECKS PASSED`, exit 0. The orchestrator tears the server down afterward (verify with `lsof -ti :8788` returning nothing).

- [ ] **Step 3: Wire the npm script**

In `package.json`, add to `scripts` (next to `"test:prototype"`):

```json
    "test:live-surfaces": "node scripts/live-surface-battery.mjs",
```

- [ ] **Step 4: Commit**

```bash
git add scripts/live-surface-battery.mjs package.json
git commit -m "test: live-surface battery orchestrator (self-booted dev server)"
```

---

### Task 3: The CI job

**Files:**
- Modify: `.github/workflows/ci.yml` (add a `live-surfaces` job after the `prototype` job)

**Interfaces:**
- Consumes: `npm run test:live-surfaces` from Task 2 (which consumes Task 1's battery).
- Produces: a CI job that fails the PR/push when any live surface regresses structure or hygiene on our origin.

- [ ] **Step 1: Add the job**

Insert after the `prototype` job block (the whole job, mirroring its shape):

```yaml
  live-surfaces:
    name: Live-surface browser battery (console/network hygiene)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Install Playwright (python) + bundled chromium for the live-surface battery
        run: |
          pip install playwright
          python -m playwright install --with-deps chromium
      - name: Boot a dev server and run the live-surface battery
        env:
          LIVE_CI: "1"
        run: npm run test:live-surfaces
```

- [ ] **Step 2: Push the branch and watch CI**

Run: `git add .github/workflows/ci.yml && git commit -m "ci: live-surface browser battery job" && git push -u origin <branch>`
Expected: three jobs — `test`, `smoke`, `prototype`, `live-surfaces` — all green. Confirm the new job's log shows the battery's `ALL CHECKS PASSED` (not just "job succeeded" — check the job steps for the `npm run test:live-surfaces` output).

- [ ] **Step 3: Open the PR and confirm mergeability**

Run: `gh pr create --title "test: live-surface browser battery + CI job" --body "<summary of the three tasks + evidence>" --base main`
Expected: PR created, MERGEABLE, all four CI jobs green.

---

### Task 4: Ledger + final review

**Files:**
- Modify: `changelog.md` (new entry at top), `tasks.md` (new T6.x entry)

**Interfaces:**
- Consumes: everything above.
- Produces: the honest ledger record, matching the repo's "no deploy" convention (the E2E-suite and prototype-smoke entries are the model).

- [ ] **Step 1: Changelog entry**

Add at the top of `changelog.md` (above the prototype-smoke entry), following the exact shape of the existing "Prototype browser smoke + CI job" entry:

```markdown
## 2026-08-16 — Live-surface browser battery + CI job (no deploy)

### Status: verification tooling added → no site-code change, nothing redeployed

- **`scripts/live_surface_battery.py` + `scripts/live-surface-battery.mjs`** (wired as
  `npm run test:live-surfaces`) — permanent Playwright battery over home/browse/search/
  genre/watchlist/movie: per-surface structure + console/page-error/5xx hygiene with
  third-party attribution (archive.org, headless-Chrome artifacts — same filter tuples
  as `e2e_test.py`). Self-boots `wrangler pages dev` on :8788; `LIVE_BASE_URL` override
  supported.
- **CI job `live-surfaces`** — runs the battery on every PR/push with bundled chromium.
- The ad-hoc pass it formalizes found no defects in site code (the earlier findings were
  known third-party noise, absorbed by the initials fallback).
  *Evidence: `npm run test:live-surfaces` green locally (24 checks), CI job green,
  root typecheck clean, 128/128 tests.*
```

- [ ] **Step 2: Tasks entry**

Add at the top of `tasks.md`'s done list (above the newest entry), the T-number is the next available (currently T6.42 exists):

```markdown
- [x] **T6.43 Live-surface browser battery + CI job (no deploy).**  Permanent Playwright
  battery (`scripts/live_surface_battery.py` + orchestrator `scripts/live-surface-battery.mjs`,
  `npm run test:live-surfaces`) over home/browse/search/genre/watchlist/movie: structure +
  console/page-error/5xx hygiene per surface, third-party attribution matching
  `e2e_test.py`. CI job `live-surfaces` runs it on every PR/push. Formalizes the ad-hoc
  pass, which found no defects in site code. *Evidence: 24 checks green locally + CI,
  root typecheck clean, 128/128.*
```

- [ ] **Step 3: Final verification pass**

Run: `npm run test:live-surfaces` (expect `ALL CHECKS PASSED`), `npm run typecheck`, `npm test`.
Expected: all green. Then re-read the plan's Global Constraints and confirm each is honored (zero false positives on our origin; third-party noise filtered by the existing tuples; self-contained; mirrors the prototype smoke; no site-code change).

---

## Self-Review

- **Spec coverage:** The spec (this thread's follow-up) asked for (a) a permanent script, (b) a CI job, (c) mirroring the prototype smoke. Task 1 = script, Task 2 = orchestrator + npm wiring, Task 3 = CI job, Task 4 = ledger. All covered.
- **Placeholder scan:** Step 1 intentionally contains a `# TODO: fill the surfaces list` comment with the empty list — it is replaced verbatim in Step 3 (no step ships with a placeholder; the skeleton run in Step 2 is a harness check, and the real assertions land immediately after). Every other step has complete code.
- **Type consistency:** `LIVE_BASE_URL`/`LIVE_CI` env names are identical across Tasks 1–3; `check()` signature (`name, ok, detail=""`) matches `scripts/prototype_smoke.py` and `scripts/e2e_test.py`; the CI job's `LIVE_CI: "1"` + `npm run test:live-surfaces` wiring matches the orchestrator's env handling; the job name/shape mirrors the `prototype` job as required.
