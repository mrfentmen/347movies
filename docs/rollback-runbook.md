# 347movies — Production Rollback Runbook

> Written 2026-08-16 (operational-hardening pass). Goal: a bad production deploy is
> recoverable in minutes by one person, without improvisation. Read this BEFORE you need it.
> The smoke suite is the canary: a canonical run that fails right after a deploy is the
> trigger to start here.

## 0. Know your current state

- Canonical deploy command: `npm run deploy` (git-bound: refuses a dirty tree or a HEAD
  that is not `origin/main`; deploys only merged, CI-reviewed state).
- Every deploy is recorded in `changelog.md` with its deployment ID and verification
  (`ok deployment <id> verified: environment = production`).
- The **last-known-good deployment** is the newest `environment = production` deployment
  whose canonical smoke passed **183/183**. Deploy #62 (ba186d61) was the most recent
  fully-verified deployment at the time of writing.

## 1. Confirm the failure (do not roll back on a hunch)

```bash
npm run smoke                       # canonical: 183/183 expected
curl -s -o /dev/null -w "%{http_code}\n" https://347movies.pages.dev/api/health
```

If smoke fails, first re-run once (edge propagation lag caused a transient 6-failure run
once; the re-run was the evidence). If it fails twice, the failure is real — proceed.

## 2. List deployments and identify the last-known-good

```bash
# Requires CLOUDFLARE_API_TOKEN (see section 4). Read-only.
curl -s \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/ee32aa05d0ccfff9085adf3406874497/pages/projects/347movies/deployments?per_page=10" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; [print(x["environment"], x["id"], x["url"], x["created_on"]) for x in d]'
```

Cross-check the newest `production` row against `changelog.md`'s latest deploy entry —
they should agree (practiced 2026-08-16: list works, current production id confirmed
against the changelog). The last-known-good ID is the one whose smoke passed.

## 3. Roll back (two paths)

**Path A — Cloudflare dashboard (fastest, no code):**
1. Cloudflare dashboard → **Workers & Pages → 347movies → Production**.
2. Find the last-known-good deployment (from step 2 / changelog).
3. ⋯ → **Rollback to this deployment**. Cloudflare re-promotes that deployment to
   production. Then run `npm run smoke` and confirm 183/183.

**Path B — git revert + redeploy (the code path, fits the git-bound deploy):**
```bash
# The bad commit is in history; ship an inverted commit through the normal gate.
git checkout main && git pull --ff-only
git log --oneline -8                        # find the bad merge/squash sha
git revert --no-edit <bad-sha>              # creates a revert commit
git push origin main                        # or open a PR and merge it
npm run deploy                              # git-bound gate passes: clean tree, HEAD == origin/main
npm run smoke
```

**Emergency (only when speed beats process):**
```bash
# Deploy an arbitrary known-good state, bypassing the git-bound gate:
git checkout <last-known-good-sha>     # detached HEAD is fine for a one-off
DEPLOY_ALLOW_DIRTY=1 npm run deploy
# Then restore order: git checkout main && git pull, and reconcile main.
```

Never roll back to a deployment older than the last-known-good without checking the
changelog (older deploys may predate features the current bundle depends on).

## 4. The deploy token

- The token lives in a **gitignored `.env`** at the repo root (`CLOUDFLARE_API_TOKEN=…`,
  chmod 600). `npm run deploy` loads it automatically; the same file is the source for
  section 2's curl.
- It is also recoverable from the session DB (`.freebuff/desktop-v2.db`) — that file must
  never leave the machine (gitignored, excluded from backups if possible).
- **Rotation** (manual, in the dashboard): Cloudflare dashboard → **My Profile → API
  Tokens → the 347movies Pages token → Roll**. Update `.env` and re-run a deploy to
  confirm. Rotate whenever: the token may have been exposed (session DB leaked, machine
  shared), or as a periodic hygiene step.
- The current token is Pages-scoped (verified: cannot manage Workers KV) — keep it that
  way when rotating; a least-privilege token is a smaller blast radius.

## 5. After the rollback

1. `npm run smoke` → 183/183.
2. `node scripts/warmup.mjs` to re-seed the edge caches for real viewers.
3. Record the incident in `changelog.md`: what shipped, how it failed, the rollback path
   used, the restored deployment ID.
4. Root-cause the bad deploy before the next one (the deploy is git-bound now — the bad
   state should have been caught at the gate; investigate how it got through).

## 6. Practice log

- 2026-08-16: read commands verified against the live account (deployments list API
  works; current production deployment identified and cross-checked with changelog).
  A full dashboard rollback was NOT performed (it would have disturbed production); the
  first real rollback should be rehearsed on a **preview** branch deployment if one is
  ever needed before production trust is established.
