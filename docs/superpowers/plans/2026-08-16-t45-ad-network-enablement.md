# T4.5 — Ad Network Enablement Implementation Plan

> **For agentic workers:** execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This project has NO git history (the checkout lives under an unrelated repo root on the Desktop) — the project's commit gate is `npm run deploy` (verifies `environment = production`) plus the changelog ledger. Replace every "Commit" step below with: update `changelog.md`, then `npm run deploy`.

**Goal:** Enable a real ad network that has passed the Decision 001 acceptance checklist (FOUNDER-CHECKLIST item 4), as one reviewed change set: allowlist entry + env var + CSP diff + privacy naming, verified live with the smoke suite converted from dormant-proof to allowlist-aware proof.

**Architecture:** The dormant loader (T4.3) is already live: `lib/ad.ts` gates on an **empty** `AD_NETWORK_ALLOWLIST`, `/api/ad-config` serves the gate, and the client bootstrap injects only when `enabled:true` + https. Enablement is exactly the reviewed change that adds the network's host to that allowlist, sets `AD_NETWORK_SCRIPT`, relaxes `script-src` to that one host, names the network on the privacy page — and flips the smoke guards from "dormant" to "allowlist-aware." `frame-src` stays archive.org-only: that is the structural guarantee of constitution §4 (ads never interrupt the movie).

**Tech Stack:** TypeScript (Cloudflare Pages Functions), static HTML/CSS/JS, Node 22 test runner (`node --experimental-strip-types --test`), Wrangler.

## Global Constraints

- **Constitution §4 / vow 2:** ads never interrupt the movie. `frame-src` in BOTH CSPs (`functions/_middleware.ts` AND `public/_headers`) stays `https://archive.org https://*.archive.org` — never gains the network host. The sidebar slot sits outside `player-wrap` (smoke-guarded).
- **Constitution §5 / vow 5:** disclosure BEFORE any ad renders. The privacy page's standing disclosure (T4.4) must name the network and link its privacy policy in the SAME change that enables rendering — no render-before-disclosure window.
- **Constitution §3 / vow 6:** no mock code. Only render a real network's real script; nothing fake inside a slot.
- **Constitution §6 / vow 9:** `script-src` gains ONLY the network's exact script host(s) — never `unsafe-inline`, never `unsafe-eval`, never a wildcard. The smoke suite guards both.
- **Decision 001:** enablement is a reviewed code change, not a lone env var. The env var alone does nothing without the allowlist entry (dormant-by-structure remains true until both change).
- **Privacy (constitution §5):** zero viewer data collected or passed; the network's tag runs only inside the slot containers.
- **Contract values (placeholder — lock in Task 1):** `NETWORK_HOST = "cdn.exampleads.com"`, `SCRIPT_URL = "https://cdn.exampleads.com/tag.js"`. Task 1 replaces these with the real contract values; every later step's code uses the locked-in values.
- **Fail-closed:** any anomaly (missing var, non-https, host not allowlisted) → `{enabled:false}` → no script → reserved note stays. Must remain true after enablement for any OTHER host.

---

### Task 1: Lock the network contract

**Files:**
- Create: `docs/ad-network-contract.md`

**Interfaces:**
- Consumes: FOUNDER-CHECKLIST item 4 (the acceptance checklist), the real network's documentation.
- Produces: the three contract values every later task reads verbatim — `NETWORK_HOST`, `SCRIPT_URL`, `NETWORK_PRIVACY_URL`, and a signed-off checklist.

- [ ] **Step 1: Capture the contract**

Record in `docs/ad-network-contract.md`: the network name, `NETWORK_HOST` (exact script host, e.g. `cdn.exampleads.com`), `SCRIPT_URL` (exact https URL), `NETWORK_PRIVACY_URL` (their privacy policy), and a check-off of FOUNDER-CHECKLIST item 4 (legal-only compatible; sidebar/leaderboard placement only; no player-format ads; no auto-playing audio; brand-safety controls; CSP-compatible tag — no `unsafe-inline`/`document.write`; documented privacy disclosure).

- [ ] **Step 2: Verify the tag's real behavior in isolation**

Run: `curl -sS "$SCRIPT_URL"` — confirm it is a real async-compatible tag (no `document.write`), and load it on a scratch page to confirm it requests no other origins beyond `NETWORK_HOST` (if it does, record those hosts — they join the CSP diff in Task 4 and the allowlist if it loads from them).

- [ ] **Step 3: Replace the placeholder values everywhere below**

The steps below use the example `cdn.exampleads.com`; substitute the locked-in values. If the real tag needs `connect-src` for its own requests, Task 4's diff gains the host there too (recorded with rationale).

**Exit check:** `docs/ad-network-contract.md` exists with the three values and a fully checked acceptance list. **No code changed — this task gates everything else.**

---

### Task 2: Add the allowlist entry + tests (TDD)

**Files:**
- Modify: `lib/ad.ts` (the `AD_NETWORK_ALLOWLIST` constant)
- Test: `tests/ad.test.ts`

**Interfaces:**
- Consumes: Task 1's `NETWORK_HOST`.
- Produces: `AD_NETWORK_ALLOWLIST` containing exactly `NETWORK_HOST`; the enabled path now reachable with the REAL allowlist; the dormant-by-structure test updated so the suite still proves "no OTHER host can enable."

- [ ] **Step 1: Write the failing test — a non-allowlisted host still fails closed with the real allowlist**

Append to `tests/ad.test.ts`:

```ts
test("the production allowlist is exactly the chosen network host — no other host can enable", () => {
  assert.deepEqual(AD_NETWORK_ALLOWLIST, ["cdn.exampleads.com"]);
  // Dormant-by-structure is gone for THE host, but every OTHER host still fails closed:
  assert.equal(adConfig("https://evil.example.com/tag.js"), null);
  assert.equal(adConfig("https://cdn.exampleads.com/tag.js"), null); // FAILS until the allowlist is non-empty
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --test tests/ad.test.ts`
Expected: the new test fails — `AD_NETWORK_ALLOWLIST` is still `[]` and `adConfig(SCRIPT_URL)` returns `null`.

- [ ] **Step 3: Implement — one-line allowlist**

In `lib/ad.ts`:

```ts
export const AD_NETWORK_ALLOWLIST: readonly string[] = ["cdn.exampleads.com"];
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --experimental-strip-types --test tests/ad.test.ts`
Expected: all tests pass — the new test (allowlist is exactly the host; `evil.example.com` still null) and the existing 5 (the old "dormant-by-structure" test asserting `AD_NETWORK_ALLOWLIST` is empty must have been updated in this step's same edit to assert the new content — see Step 5).

- [ ] **Step 5: Update the stale dormant-by-structure test**

The existing test asserting the allowlist is empty (`tests/ad.test.ts`, "dormant-by-structure") must be edited to assert the new content (exactly `["cdn.exampleads.com"]`) — otherwise the suite fails by design. Run the full suite: `npm test` → 115+ tests pass.

- [ ] **Step 6: Record (deploy gate)**

Changelog entry + `npm run deploy` (verified `environment = production`). **Warning:** at this point `/api/ad-config` would report `enabled:true` if the env var were set — it is NOT yet, so the live gate still returns `{enabled:false}`. This is the intended intermediate state.

---

### Task 3: Wire the env var + verify the gate flips

**Files:**
- Modify: `wrangler.jsonc` (vars block)
- No code change to `functions/api/ad-config.ts` or `public/js/app.js` — the mechanism already reads the env var and the client already injects correctly.

**Interfaces:**
- Consumes: Task 1's `SCRIPT_URL`.
- Produces: production `AD_NETWORK_SCRIPT` var; `/api/ad-config` serving `{enabled:true, scriptUrl}`; client bootstrap live-injecting — BEFORE the CSP diff in Task 4, so the tag loads but is blocked by CSP (safe intermediate: the script fails closed by CSP, no ad renders, page unaffected).

- [ ] **Step 1: Set the var**

In `wrangler.jsonc` `"vars"` add: `"AD_NETWORK_SCRIPT": "https://cdn.exampleads.com/tag.js"`.

- [ ] **Step 2: Verify the gate on dev**

Run dev server with the var (or set it in `.dev.vars` for the dev run): hit `/api/ad-config` → `{"enabled":true,"scriptUrl":"https://cdn.exampleads.com/tag.js"}`. Verify the client bootstrap logs the script element in `<head>` and that CSP blocks it (expected at this stage): browser console shows the CSP violation for the tag's origin.

- [ ] **Step 3: Deploy + verify the intermediate state on canonical**

`npm run deploy`; then `curl /api/ad-config` → `enabled:true`. Confirm every page still renders (the blocked tag is harmless — no ad, no error UI).

---

### Task 4: The reviewed CSP diff + smoke-guard conversion (the trap task)

**Files:**
- Modify: `functions/_middleware.ts` (CSP `script-src` line)
- Modify: `public/_headers` (CSP `script-src` directive)
- Modify: `scripts/smoke.mjs` — the dormant section (lines ~405-421) and the CSP guard (line ~107)
- Test: `tests/ad.test.ts` unchanged (already covers the gate)

**Interfaces:**
- Consumes: Task 1's `NETWORK_HOST` (+ any extra hosts the tag needs, recorded in Task 1 Step 2).
- Produces: CSP `script-src 'self' https://cdn.exampleads.com` in BOTH CSPs (unchanged: `frame-src` archive.org-only, no `unsafe-inline`, no `unsafe-eval`); a smoke suite that PROVES the only allowed third-party script host is the network's.

- [ ] **Step 1: Relax `script-src` in the middleware (and `_headers`), with rationale**

In `functions/_middleware.ts` line 15:

```ts
"default-src 'self'; script-src 'self' https://cdn.exampleads.com; style-src 'self'; " +
```

Same edit in `public/_headers`. `connect-src` gains the host ONLY if Task 1 Step 2 proved the tag needs it. Comment the change: network + decision link + "frame-src unchanged — the ads-never-interrupt-the-movie invariant stays structural."

- [ ] **Step 2: Convert the smoke dormant section to allowlist-aware proof**

Replace the "ad loader dormant" section (asserting `enabled === false` and zero third-party scripts) with:

```js
console.log("\n— ad loader enabled (T4.5: the allowlisted network only) —");
try {
  const cfg = await (await request("GET", "/api/ad-config")).json();
  ok(cfg && cfg.enabled === true && /^https:\/\/cdn\.exampleads\.com\//.test(cfg.scriptUrl),
     `ad-config enabled with the allowlisted script (got ${JSON.stringify(cfg)})`);
  // The ONLY third-party <script src> on any slot page is the allowlisted network host —
  // no other external script can ever render (constitution §6).
  for (const path of ["/", "/search?q=noir", "/browse?genre=film-noir", "/movie/it-1927"]) {
    const html = await (await request("GET", `${path}?smoke=${Date.now()}`)).text();
    const external = [...html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    const foreign = external.filter((src) => !src.startsWith("https://cdn.exampleads.com/"));
    ok(foreign.length === 0, `${path} loads only the allowlisted network script (got ${JSON.stringify(foreign)})`);
  }
} catch (err) { failures += 1; checks += 1; console.error(`FAIL  ad loader enabled — ${err.message}`); }
```

- [ ] **Step 3: Update the CSP guard**

`scripts/smoke.mjs` line ~107 currently asserts `csp.includes("script-src 'self'")` and no `unsafe-inline`. Update to:

```js
ok(csp.includes("script-src 'self' https://cdn.exampleads.com") && !csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"),
   "CSP: script-src self + the allowlisted network host only, no unsafe-inline/eval");
```

- [ ] **Step 4: Run the full battery**

`npm run typecheck` (clean), `npm test` (all pass), then the dev smoke. **Expected:** the converted guards pass ONLY when the dev server serves the new CSP and the var. If the smoke fails, the diff is incomplete — never silence a failing guard.

- [ ] **Step 5: Deploy + canonical smoke**

`npm run deploy` (verified production); `SMOKE_BASE_URL=https://347movies.pages.dev npm run smoke` → 98/98 with the converted guards green.

---

### Task 5: Name the network on the privacy page (constitution §5 — same change, never later)

**Files:**
- Modify: `public/privacy.html` (the "Advertising — the standing disclosure" section from T4.4)

**Interfaces:**
- Consumes: Task 1's `NETWORK_HOST`, `NETWORK_PRIVACY_URL`.
- Produces: the disclosure naming the live network + linking its policy BEFORE any ad has rendered (this task deploys in the same reviewed change as Task 4).

- [ ] **Step 1: Replace the "no network configured" clause**

In the standing disclosure, the sentence "no network is configured today and no third-party code runs" becomes: "Ads are served by **{Network Name}** ({NETWORK_HOST}). Their privacy policy: {NETWORK_PRIVACY_URL}. We collect and pass no viewer data; the network's script runs only inside the marked slot containers and never on the player." Keep the rest (slots never on the player; zero data).

- [ ] **Step 2: Extend the smoke privacy guard**

The existing privacy-disclosure smoke check (asserts the disclosure text exists) gains: `ok(html.includes("cdn.exampleads.com"), "privacy page names the live network (constitution §5)")`.

- [ ] **Step 3: Battery + deploy**

Typecheck, tests, dev smoke, `npm run deploy`, canonical smoke.

---

### Task 6: Live verification + rollback doc

**Files:**
- Create: `docs/ad-network-rollback.md`
- Run: the verification battery (no code changes unless a failure appears)

**Interfaces:**
- Consumes: everything above.
- Produces: signed-off live proof + the one-commit rollback procedure.

- [ ] **Step 1: Browser verification (both slot types, player untouched)**

In the Preview (dev, var set): home/search/browse each show exactly one leaderboard ad in the `[data-ad-slot="leaderboard"]` container; the movie page shows exactly one sidebar ad in `[data-ad-slot="sidebar"]`, provably after `player-wrap`'s close tag (assert `slotAt > pwClose` on the served HTML, as the existing guard does). The archive.org player plays with no overlay. No auto-playing audio.

- [ ] **Step 2: Player-isolation proof**

`grep` the served movie HTML for the ad script's position vs the player: the tag loads via the client bootstrap into `<head>` (T4.3 design) — never inside `player-wrap`. Assert `frame-src` still archive.org-only on both CSPs (smoke now covers it).

- [ ] **Step 3: Lighthouse gates**

`npx --yes lighthouse` (cache-busted URLs) on home + a movie page: **a11y 100, CLS 0** unchanged from the pre-enablement baselines (home 99-100/100/100/100, movie 75-99/100/96/100 with the known archive.org-iframe best-practices flag). A regression here fails the gate.

- [ ] **Step 4: Write the rollback doc**

`docs/ad-network-rollback.md`: the one reviewed change in reverse — remove the host from `AD_NETWORK_ALLOWLIST` + delete the `AD_NETWORK_SCRIPT` var + revert the `script-src` diff in both CSPs + restore the privacy page sentence + revert the smoke section to the dormant guard. Result: `/api/ad-config` → `{enabled:false}` again, zero third-party scripts, reserved note returns. Test the rollback once on dev (set, verify enabled, revert, verify dormant).

- [ ] **Step 5: Final battery + ledger**

`npm run typecheck`, `npm test`, dev + canonical smoke (98/98), `npm run deploy` if any fix landed, changelog entry (enablement + verification + rollback doc), tasks.md T4.5 `[x]` with evidence.

---

## Self-review

- **Spec coverage (T4.5 text):** "reviewed CSP allowlist diff (`script-src` gains the exact network host(s); `frame-src` stays archive.org-only)" → Task 4. "plus the env var" → Task 3. "live browser verification (ads in exactly the two slot types, player untouched, Lighthouse a11y 100 + CLS 0 unchanged)" → Task 6. "Smoke guards proving zero third-party scripts while unconfigured" → already live (T4.3); Task 4 converts them. FOUNDER-CHECKLIST item 4 → Task 1. Constitution §5 disclosure-before-render → Task 5 (same change). ✅
- **Placeholder scan:** the only placeholder is the contract parameterization (Task 1 explicitly locks real values before any code) — every code block is complete and runnable against the example values. No TBD/TODO. ✅
- **Type consistency:** `AD_NETWORK_ALLOWLIST` (Task 2) matches the existing `lib/ad.ts` export; `adConfig` signature unchanged; smoke variable names (`foreign`, `external`) consistent within Task 4; `NETWORK_HOST`/`SCRIPT_URL`/`NETWORK_PRIVACY_URL` defined in Task 1 and referenced identically throughout. ✅
- **The trap the plan exists to catch:** enabling without converting the dormant smoke guards would fail the suite by design; enabling the CSP without the allowlist entry would still render nothing (dormant-by-structure holds); rendering without the privacy rename would violate §5. All three are explicit steps, not footnotes. ✅
