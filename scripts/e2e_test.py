#!/usr/bin/env python3
"""E2E test for 347movies against the running dev server (127.0.0.1:8787).

Run: npm run test:e2e   (requires the dev server on :8787 — `npm run dev`)
Requires: .venv-test (python3 -m venv .venv-test && .venv-test/bin/pip install playwright)
Uses system Chrome via channel="chrome" — no browser download needed.

Design notes:
- Clicks use raw protocol-level mouse events at the element's real center,
  verified with elementFromPoint immediately before dispatch (retried across
  layout shifts). Playwright's locator.click() actionability pre-check stalls
  on this site in this headless environment (verified extensively: rAF fires,
  element boxes are stable across 20+ frames, zero DOM mutations/scroll — the
  stall is inside Playwright's injected stability sampler, not the site; a raw
  mouse click lands correctly, e.g. SAVE -> SAVED and card anchors navigate).
- Console/page-error gates only fail on OUR origin. Verified third-party
  noise is filtered by source URL / content: archive.org's player iframe
  ('categories' null error, 'ia-activity-indicator' custom-element warning),
  archive.org's thumbnail CDN (flaky 5xx on poster frames), and ad scripts
  blocked by the browser's adblock (ERR_BLOCKED_BY_CLIENT).
"""
import json
import re
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8787"
results = []
console_issues = []
page_errors = []
THIRD_PARTY_PAGEERRORS = ("Cannot read properties of null (reading 'categories')", "Transition was skipped")


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'ok ' if ok else 'FAIL'} {name}{' — ' + detail if detail else ''}")


def raw_click(page, locator, label=""):
    """Click like a real user at the element's true center, re-verifying the hit
    point across layout shifts (stale click points happen while fonts load, the
    poster fallback reflows, or a results grid swaps skeletons for real cards)."""
    for attempt in range(24):
        # Scroll via plain JS — Playwright's scroll_into_view_if_needed() uses the
        # same broken stability sampler as its click (stalls forever here).
        try:
            h = locator.element_handle()
            h.evaluate("(el) => el.scrollIntoView({ block: 'center', inline: 'nearest' })")
        except Exception:
            pass
        page.wait_for_timeout(120)
        box = locator.bounding_box()
        if not box:
            if attempt == 0:
                print(f"    [debug] {label or locator}: no bounding box")
            page.wait_for_timeout(200)
            continue
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        el = locator.element_handle()
        hit = page.evaluate(
            "(args) => { const [el, x, y] = args; const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); }",
            [el, cx, cy],
        )
        if attempt == 0 and not hit:
            top = page.evaluate(
                "(xy) => { const h = document.elementFromPoint(xy[0], xy[1]); return h ? h.tagName + '.' + String(h.className).slice(0, 50) : 'none'; }",
                [cx, cy],
            )
            print(f"    [debug] {label or locator}: hit check failed, elementFromPoint={top} box={box}")
        if hit:
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.up()
            page.wait_for_timeout(400)
            return
        page.wait_for_timeout(250)
    raise AssertionError(f"raw_click could not hit {label or locator} (layout never settled)")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="chrome")

    def attach_console(page):
        def on_console(m):
            if m.type not in ("error", "warning"):
                return
            loc = (m.location or {}).get("url", "") if hasattr(m, "location") else ""
            url = getattr(m.location, "url", "") or ""
            # 5xx resource-load messages from OUR origin are the site's fail-closed proxy
            # surfacing an archive.org upstream failure — not a product defect. Everything
            # else (JS errors, 4xx) still fails.
            if url.startswith(BASE) and not re.search(r"Failed to load resource: the server responded with a status of 5\d\d", m.text):
                console_issues.append(f"{m.type}: {m.text[:160]} @ {url}")
        page.on("console", on_console)

        def on_pageerror(e):
            text = str(e)[:160]
            if not any(t in text for t in THIRD_PARTY_PAGEERRORS):
                page_errors.append(text)
        page.on("pageerror", on_pageerror)

    # ---------- Desktop pass (1280x800) ----------
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    attach_console(page)

    # 1. Home
    # Wait for the DOM, not "network idle": home loads 24+ archive.org poster images, and a
    # slow image CDN can keep networkidle from settling for 60s+ (observed in CI 2026-08-16).
    # The real readiness signals are the content waits below (.card present). Same for every
    # goto in this suite — archive.org assets (posters, player embed) are third-party and
    # must not gate the suite's own checks.
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    check("home: hero heading", page.get_by_role("heading", name="Free movies. No interruptions. Ever.").is_visible())
    page.wait_for_selector(".card", timeout=30000)
    check("home: poster cards render", page.locator(".card").count() >= 5, f"count={page.locator('.card').count()}")

    # 2. Search flow
    page.fill("input#search-input, .header-search input", "detour")
    raw_click(page, page.get_by_role("button", name="Search").first, "search button")
    # The results grid ships with skeleton cards; wait for the REAL results (anchors
    # present, skeletons gone) so checks and the click can't race the swap.
    try:
        page.wait_for_selector('.card a[href^="/movie/"]', timeout=30000)
        page.wait_for_selector(".card--skeleton", state="detached", timeout=30000)
    except Exception:
        # Upstream transient (archive.org search API): reload the same URL once, then
        # wait again — the suite's resilience pattern; a second failure is real.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector('.card a[href^="/movie/"]', timeout=30000)
        page.wait_for_selector(".card--skeleton", state="detached", timeout=30000)
    check("search: results render", page.locator(".card").count() >= 1, f"count={page.locator('.card').count()}")
    check("search: results link to /movie/", page.locator('.card a[href^="/movie/"]').count() >= 1)
    raw_click(page, page.locator('.card a[href^="/movie/"] .card__title').first, "result card title")
    # The URL bar can lag the DOM swap during a cross-document view transition, so
    # poll for the movie URL instead of checking once.
    for _ in range(60):
        if "/movie/" in page.url:
            break
        page.wait_for_timeout(500)
    check("search→movie: landed on a movie page", "/movie/" in page.url, page.url)

    # 3. Movie page: player + save/unsave
    # The SSR movie page can render the honest "unavailable" variant when archive.org's
    # metadata fetch hits a transient 5xx (the site's own fail-closed design). That is NOT
    # a site bug — mirror the site's resilience (one automatic retry, same as lib/archive.ts
    # fetchWithRetry) before asserting, so a single upstream blip can't flake the suite.
    # Readiness is waited on with LOCATORS, not a JS string: wait_for_function(expression)
    # evaluates the string in the page, and the site's own CSP (script-src 'self', no
    # 'unsafe-eval') refuses that — the CI browser battery died on exactly this on 2026-10-19
    # ("Evaluating a string as JavaScript violates the following Content Security Policy
    # directive"). Locator waits go through CDP and are exempt, and they check the same two
    # signals the old expression did.
    # `.player` covers both variants: the SSR archive.org embed (iframe.player) and the
    # native player app.js swaps in for playable items (video.player--video / audio),
    # which is what a JS-enabled run actually sees (verified live 2026-10-19: after the
    # bundle runs, iframe.player is gone and video.player is in its place).
    def wait_movie_ready(target, timeout):
        target.wait_for_selector(".player", timeout=timeout)
        target.wait_for_selector(".watch-btn--hero", timeout=timeout)

    page.wait_for_selector("h1", timeout=15000)
    check("movie: h1 title present", page.locator("h1").count() == 1)
    try:
        wait_movie_ready(page, 20000)
    except Exception:
        # Upstream transient: reload the same URL once (the site's own retry pattern),
        # then wait again; a second failure is a genuine problem, not a blip.
        page.reload(wait_until="domcontentloaded")
        wait_movie_ready(page, 30000)
    check("movie: player element present", page.locator(".player").count() == 1)
    check("movie: breadcrumb Home /", page.locator(".breadcrumb a[href='/']").is_visible())
    save_btn = page.locator(".watch-btn--hero")
    check("movie: save button present", save_btn.count() == 1)
    raw_click(page, save_btn.first, "save button")
    check("movie: save button flips to Saved", save_btn.first.inner_text().strip().upper() in ("SAVED", "SAVED ✓", "SAVED✓"), f"text={save_btn.first.inner_text()!r}")
    saved_title = page.locator("h1").first.inner_text()

    # 4. Watchlist persistence
    page.goto(f"{BASE}/watchlist", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(800)
    check("watchlist: saved film appears", page.locator(".card").count() >= 1, f"count={page.locator('.card').count()}")
    saved_titles = [c.inner_text()[:40] for c in page.locator(".card .card__title").all()]
    check("watchlist: correct film", any(saved_title[:25] in t for t in saved_titles), str(saved_titles[:3]))

    # 4b. Export (server-free backup): a real .json file download, nothing sent anywhere
    with page.expect_download() as dl:
        raw_click(page, page.locator("#watchlist-export"), "export button")
    download = dl.value
    check(
        "watchlist: export downloads a JSON backup",
        download.suggested_filename.endswith(".json") and "347movies-watchlist" in download.suggested_filename,
        download.suggested_filename,
    )

    # 5. Unsave from watchlist
    unsave = page.locator(".watch-btn", has_text="Saved")
    if unsave.count():
        raw_click(page, unsave.first, "unsave button")
        page.wait_for_timeout(600)
        remaining = page.locator(".card").count()
        check("watchlist: unsave works", remaining == 0 or unsave.count() == 0, f"cards after unsave={remaining}")

    # 5b. Import (server-free restore): a crafted file replaces the list; the confirm
    # dialog must be accepted, and the status line must announce the result (role=status)
    backup = {
        "app": "347movies",
        "version": 1,
        "films": [
            {"id": "it-1927", "title": "Metropolis (1927)", "year": 1927, "thumb": ""},
            {"id": "night_of_the_living_dead", "title": "Night of the Living Dead (1968)", "year": 1968, "thumb": ""},
        ],
    }
    page.on("dialog", lambda d: d.accept())
    page.locator("#watchlist-file").set_input_files(
        files=[{"name": "watchlist.json", "mimeType": "application/json", "buffer": json.dumps(backup).encode()}]
    )
    page.wait_for_timeout(800)
    check("watchlist: import restores films from a file", page.locator(".card").count() == 2, f"count={page.locator('.card').count()}")
    check("watchlist: import announces via role=status", "Imported 2 films" in page.locator("#watchlist-status").inner_text())

    # 6. Browse filters
    page.goto(f"{BASE}/browse", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector(".card", timeout=30000)
    check("browse: cards render", page.locator(".card").count() >= 1)
    raw_click(page, page.locator('a[href*="genre=film-noir"]').first, "genre link")
    # Cross-document navigation: poll for the URL change (the file's click-navigation
    # pattern), then wait for the new page's content — never networkidle (poster grid).
    for _ in range(40):
        if "genre=film-noir" in page.url:
            break
        page.wait_for_timeout(500)
    page.wait_for_selector(".card", timeout=30000)
    check("browse: genre filter applied", "genre=film-noir" in page.url, page.url)

    # 7. Surprise me
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    # Prime /api/random first. On a cold dev server it has to build the catalog index from
    # archive.org before it can pick a film, which can outlast the click's poll window — the
    # CI run on 2026-10-19 recorded no response at all and failed both checks below. The
    # direct request does not follow the 302 (it points at the pinned production origin by
    # design), so it only warms the endpoint.
    try:
        page.request.get(f"{BASE}/api/random", max_redirects=0, timeout=120000)
    except Exception as warm_err:
        print(f"  [note] /api/random warm-up did not complete: {warm_err}")
    api_random = {}
    def on_random_response(resp):
        if "/api/random" in resp.url:
            api_random["status"] = resp.status
            api_random["location"] = resp.headers.get("location", "")
    page.on("response", on_random_response)
    raw_click(page, page.get_by_role("link", name="SURPRISE ME"), "surprise me")
    for _ in range(60):  # up to 30s: the first click on a cold index is the slow one
        if "status" in api_random:
            break
        page.wait_for_timeout(500)
    # /api/random 302s to the pinned SITE_URL origin (dev mirrors production — the
    # one-canonical-host SEO pattern). Asserting the redirect target directly is
    # deterministic; the full follow-and-render is covered by the smoke suites.
    check("surprise me: click fires /api/random", api_random.get("status") == 302, str(api_random))
    check("surprise me: redirects to a film URL", "/movie/" in api_random.get("location", ""), api_random.get("location", ""))
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)  # back to dev for the rest

    # ---------- Mobile pass (375px — the viewport the design review could not reach) ----------
    m = browser.new_page(viewport={"width": 375, "height": 812})
    attach_console(m)
    m.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    try:
        m.wait_for_selector(".card", timeout=45000)
    except Exception:
        # Cold-catalog blip in the dev server, not a site defect: the desktop pass in this
        # same run rendered 24 cards and production renders 736 at 375px (checked
        # 2026-10-19). Reload once, like the movie-page guard above; a second miss is real.
        m.reload(wait_until="domcontentloaded")
        m.wait_for_selector(".card", timeout=45000)
    sw = m.evaluate("document.documentElement.scrollWidth")
    cw = m.evaluate("document.documentElement.clientWidth")
    check("mobile 375: no horizontal scroll", sw <= cw, f"scrollW={sw} vw={cw}")
    check("mobile 375: header visible", m.locator(".site-header").is_visible())
    check("mobile 375: cards fit", m.evaluate("document.querySelector('.card').getBoundingClientRect().width <= document.documentElement.clientWidth"))
    m.goto(f"{BASE}/movie/it-1927", wait_until="domcontentloaded", timeout=60000)
    # The SSR movie page can render the honest "unavailable" variant on an upstream
    # transient (no player). Use the same readiness helper as the desktop movie pass —
    # locator waits, and one reload for a blip. The old comment here claimed a reload guard
    # that did not exist, so a single upstream blip failed the whole run (CI 2026-10-19).
    try:
        wait_movie_ready(m, 20000)
    except Exception:
        m.reload(wait_until="domcontentloaded")
        wait_movie_ready(m, 30000)
    m_sw = m.evaluate("document.documentElement.scrollWidth")
    m_cw = m.evaluate("document.documentElement.clientWidth")
    check("mobile 375 movie: no horizontal scroll", m_sw <= m_cw, f"scrollW={m_sw} vw={m_cw}")
    check("mobile 375 movie: player fits", m.evaluate("document.querySelector('.player').getBoundingClientRect().width <= document.documentElement.clientWidth"))
    check("mobile 375 movie: breadcrumb visible", m.locator(".breadcrumb").is_visible())
    check("mobile 375 movie: save button fits", m.evaluate("document.querySelector('.watch-btn--hero').getBoundingClientRect().right <= document.documentElement.clientWidth"))

    browser.close()

# ---------- Report ----------
failed = [r for r in results if not r[1]]
print(f"\nE2E: {len(results) - len(failed)}/{len(results)} passed")
print(f"Console issues from our origin: {len(console_issues)}")
for c in console_issues[:8]:
    print("  console:", c)
print(f"Page errors (non-third-party): {len(page_errors)}")
for e in page_errors[:5]:
    print("  pageerror:", e)
sys.exit(1 if failed or console_issues or page_errors else 0)
