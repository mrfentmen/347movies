# 347movies — Git & release model

**Date:** 2026-08-16 · This file explains how deploys work today (without git) and what
moving to git-based releases requires. It is a procedures doc: it records how things run,
never secret values.

## Why this file exists

347movies historically lived *outside* version control: the directory sat inside the
Desktop-level `little-brother` monorepo, whose `.gitignore` deliberately excludes it
("only the four neural-network projects are tracked"). As of 2026-08-16 the project has
its own repository — **https://github.com/mrfentmen/347movies** (private, default branch
`main`) — with the production-ready site imported via **PR #1**. This file documents both
the git-less deploy model that still applies and the CI path.

## The git-less deploy model (how deploys work)

1. **No commit is needed to ship.** Deploys run from the working tree: `npm run deploy`
   executes `scripts/deploy.ts`, which runs
   `wrangler pages deploy public --project-name 347movies --branch main` and then verifies
   via the Cloudflare Pages API that the created deployment has
   `environment: "production"` (it fails loudly on a preview — the lesson of deploy #40,
   when `--branch=production` silently made a preview that never reached the canonical
   domain).
2. **The token.** `CLOUDFLARE_API_TOKEN` is loaded by `npm run deploy` from a **gitignored
   `.env`** at the repo root (`chmod 600`) when the environment doesn't already provide it.
   It is a secret: it must never be committed (`.gitignore` excludes `.env`, `.env.*`, and
   `.freebuff/` — the session DB also holds the token). It is also recoverable from the
   session DB under `.freebuff/`, so rotate it if that file ever leaves the machine (see
   `docs/rollback-runbook.md` §4). The deploy script skips the environment check with a
   loud warning if the token is absent, but the deploy still runs.
3. **Deploy hygiene gates (2026-08-16):** `scripts/deploy.ts` refuses to deploy when the
   working tree is dirty or `HEAD != origin/main` (deploys ship merged, CI-reviewed state;
   emergency override `DEPLOY_ALLOW_DIRTY=1`), scans `public/` + `functions/` + `lib/` +
   `wrangler.jsonc` for token-shaped strings before deploying, runs the routing-config gate
   (`scripts/check-routes.ts` — verifies `public/_routes.json` keeps every static file
   excluded from Functions so assets stay free/unlimited and no function route is
   accidentally excluded; same pure checker runs in `npm test` via `--check`, so CI fails
   on a `_routes.json` regression before it can reach deploy), and prints the merged
   commit's CI conclusions.
4. **Every deploy is followed by the canonical smoke** (`npm run smoke`, 183 checks)
   against production, plus the browser battery (`npm run test:browser`) when product code
   changes. The ledger (changelog.md) records each deploy's short id (e.g. #62 = ba186d61)
   and its verified environment.
5. **Known hazard:** immediately after a deploy, the first smoke run can hit edge
   propagation lag (stale asset responses → transient failures). Wait a few seconds and
   re-run; the re-run is the evidence.
6. **Rollback:** see `docs/rollback-runbook.md` (list deployments, identify
   last-known-good, dashboard rollback or `git revert` + redeploy; read commands already
   practiced).

## Moving to git-based CI/CD (the path, when wanted)

The repo now exists; wiring CI is the remaining step. Recommended shape:

1. **Remote-triggered deploys.** A GitHub Actions workflow on `main`:
   `npm ci && npm run typecheck && npm test && npm run deploy` with
   `CLOUDFLARE_API_TOKEN` stored as a repository secret. This replaces manual deploys.
2. **PR gating.** The same check (typecheck + tests + smoke against a preview deployment)
   on pull requests, so nothing merges that breaks the suite. Smoke against a Pages
   *preview* deployment is the natural gate; the canonical production smoke stays a
   post-deploy step.
3. **Keep the environment check.** `scripts/deploy.ts`'s `assertProductionDeployment`
   stays the gate — CI must not silently create preview deployments.
4. **Branches:** `main` is production. Feature branches run the battery; merges to `main`
   deploy. The "no-accounts" and security postures mean any future auth/revenue work is a
   constitution amendment first (see `docs/accounts-rfc.md`).

### CI gotcha: conflicting PRs silently skip the `pull_request` battery

**Documented GitHub behavior** (Events that trigger workflows): *"Workflows will not run on
`pull_request` activity if the pull request has a merge conflict. The merge conflict must be
resolved first."* The `pull_request` event runs against the computed test merge commit; when
base and head conflict, no run is created at all — no failure, no skip notice, the PR just
shows "no checks".

Observed 2026-08-16 (PR #3): a push and a force-push to the PR branch created **no** CI run
while the branch was based on old main (conflicting); the run fired 3 seconds after the
rebase onto current main made the PR mergeable. This is not a workflow bug — diagnose
"missing CI" as a merge conflict first (`gh pr view N --json mergeable`). The manual escape
hatch is `gh workflow run ci.yml --ref <branch>` (`workflow_dispatch` is wired in) — it runs
regardless of merge state.

## Repository hygiene (non-negotiable)

- `.gitignore` excludes: `.freebuff/` (session DB contains the deploy token), `.venv-test/`
  (Playwright venv), `.env*`, `.wrangler/`, `node_modules/`, `dist/`, `*.log`.
- Before any commit: `git diff --cached | grep -iE "cfut_|CLOUDFLARE|api[_-]?key|secret|token"`.
- If a secret is ever committed, rotate it — deleting the line is not enough.
