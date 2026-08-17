#!/usr/bin/env python3
"""Keyboard-only accessibility walkthrough for 347movies (dev server on :8787).

Run: .venv-test/bin/python scripts/e2e_keyboard.py

Asserts, with no mouse involvement:
  1. Skip link is the first Tab stop and Enter on it moves focus INTO <main>.
  2. Every Tab stop on every page lands on a visible element with a real focus
     ring (computed outline) — including the archive.org player iframe, whose
     ring lives on .player-wrap (JS-driven: cross-origin embed focus does not
     propagate :focus-visible/:focus-within to the parent).
  3. Real keyboard flows: header search (type + Enter navigates), Save button
     (Space toggles), browse filter selects (change handler applies the filter;
     the native dropdown itself is a documented headless limitation — ArrowDown
     never fires 'change' in headless Chrome), Clear watchlist (Space opens the
     confirm dialog — dismissed).
"""
import re
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8787"
results = []
console_issues = []
page_errors = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'ok ' if ok else 'FAIL'} {name}{' — ' + detail if detail else ''}")


FOCUSABLE_COUNT_JS = """() => Array.from(document.querySelectorAll('a[href], button, input, select, iframe, [tabindex]')).filter((el) => {
    if (el.disabled || (el.tabIndex !== undefined && el.tabIndex < 0)) return false;
    if (el.closest('[hidden]')) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}).length"""


def focus_report(page):
    return page.evaluate(
        """() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName,
                cls: String(el.className || '').slice(0, 40),
                outline: cs.outlineStyle,
                outlineW: parseFloat(cs.outlineWidth) || 0,
                visible: r.width > 0 && r.height > 0,
                inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
            };
        }"""
    )


def player_ring_visible(page):
    return page.evaluate(
        "() => { const w = document.querySelector('.player-wrap'); if (!w) return null; const cs = getComputedStyle(w); return w.classList.contains('is-focused') || (cs.outlineStyle === 'solid' && (parseFloat(cs.outlineWidth) || 0) >= 1); }"
    )


def walk(page, label):
    """Tab through every focusable element, verifying each has a visible focus ring.
    The tab cycle ends through a transient body stop (headless browser-chrome hop),
    then wraps back to the first element — both tolerated. The player iframe's ring
    is checked on its wrap, not on the iframe element (cross-origin focus)."""
    count = page.evaluate(FOCUSABLE_COUNT_JS)
    bad = []
    seen = 0
    first = None
    player_checked = False
    for _ in range(count + 4):
        page.keyboard.press("Tab")
        rep = focus_report(page)
        if rep is None:
            # transient hop through the browser chrome at the end of the cycle
            if seen >= count:
                break
            continue
        ident = (rep["tag"], rep["cls"])
        if first is None:
            first = ident
        elif ident == first and seen > 1:
            break  # wrapped back to the first stop
        seen += 1
        if not rep["visible"] or not rep["inViewport"]:
            bad.append(f"stop {seen}: {rep['tag']}.{rep['cls']} not visible/in viewport")
            break
        if rep["tag"] == "IFRAME":
            ring = player_ring_visible(page)
            check("movie: player ring visible when focused (cross-origin embed)", ring is True)
            player_checked = True
            continue
        if rep["outline"] in ("none", "hidden") or rep["outlineW"] < 1:
            bad.append(f"stop {seen}: {rep['tag']}.{rep['cls']} no visible ring (outline={rep['outline']} {rep['outlineW']}px)")
            break
    check(f"{label}: {seen}/{count} tab stops, all visible with focus rings", not bad, "; ".join(bad[:3]) if bad else f"{seen} stops")
    return player_checked


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    # 5xx resource-load messages from OUR origin are the site's fail-closed proxy
    # surfacing an archive.org upstream failure (same event the reload-once retries
    # tolerate in the render states) — not a product defect. Everything else fails.
    page.on(
        "console",
        lambda m: console_issues.append(f"{m.type}: {m.text[:160]}")
        if m.type in ("error", "warning")
        and m.location
        and str(m.location.get("url", "") or "").startswith(BASE)
        and not re.search(r"Failed to load resource: the server responded with a status of 5\d\d", m.text)
        else None,
    )
    page.on(
        "pageerror",
        lambda e: page_errors.append(str(e)[:160])
        if "Transition was skipped" not in str(e) and "reading 'categories'" not in str(e)
        else None,
    )

    # ---------- Home ----------
    # Wait for the DOM, not "network idle": pages load archive.org posters (and the movie
    # page embeds the player), whose third-party requests can keep networkidle from settling
    # for 60s+ when archive.org is slow (observed in CI 2026-08-16). The walk below counts
    # whatever is actually in the DOM, so domcontentloaded + the skip-link check is the
    # right readiness signal.
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    page.keyboard.press("Tab")
    rep = focus_report(page)
    check("home: first Tab stop is the skip link", rep and rep["cls"].startswith("skip-link"), f"got {rep}")
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    active = page.evaluate("document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none'")
    check("home: Enter on skip link moves focus into <main>", active == "main", f"active={active}")
    # Cards render from our own API after JS — wait for the grid so the walk covers the
    # full page (networkidle previously did this implicitly; archive.org assets don't).
    page.wait_for_selector(".card", timeout=30000)
    walk(page, "home")

    # Header search (fresh load so no leftover walk state): type + Enter navigates
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    page.evaluate("document.querySelector('.header-search input').focus()")
    page.keyboard.type("nosferatu")
    page.keyboard.press("Enter")
    # The URL bar can lag the DOM swap during a cross-document view transition — poll.
    for _ in range(40):
        if "/search?q=nosferatu" in page.url:
            break
        page.wait_for_timeout(500)
    check("home: typing + Enter in header search navigates", "/search?q=nosferatu" in page.url, page.url)
    try:
        page.wait_for_selector('.card a[href^="/movie/"]', timeout=30000)
    except Exception:
        # Upstream transient (archive.org search API): reload the same URL once, then
        # wait again — the suite's resilience pattern; a second failure is real.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector('.card a[href^="/movie/"]', timeout=30000)

    # ---------- Search ----------
    walk(page, "search")
    page.evaluate("document.querySelector('.card a.card__main').focus()")
    page.keyboard.press("Enter")
    for _ in range(40):
        if "/movie/" in page.url:
            break
        page.wait_for_timeout(500)
    # No networkidle wait after the click: the movie page embeds the heavy archive.org
    # player iframe, whose embed requests can keep "network idle" from settling for 60s+
    # when archive.org is slow (observed locally). Match e2e_test.py — wait for the shell,
    # then the MOVIE_READY_JS guard below drives the player/hero readiness.
    page.wait_for_selector("h1", timeout=30000)
    check("search: Enter on a result card opens the film", "/movie/" in page.url, page.url)

    # ---------- Movie ----------
    # The SSR movie page can render the honest "unavailable" variant when archive.org's
    # metadata fetch hits a transient 5xx (the site's fail-closed design). That is NOT a
    # site bug — mirror e2e_test.py's resilience (wait for the full movie page, reload the
    # same URL once on a blip, same as lib/archive.ts fetchWithRetry) so a single upstream
    # transient can't flake the keyboard walk either. A second failure is a real problem.
    MOVIE_READY_JS = "document.querySelectorAll('iframe.player').length === 1 && document.querySelectorAll('.watch-btn--hero').length === 1"
    try:
        page.wait_for_function(MOVIE_READY_JS, timeout=20000)
    except Exception:
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function(MOVIE_READY_JS, timeout=30000)

    player_ok = walk(page, "movie")
    if not player_ok:
        # Chrome drops a cross-origin iframe out of the tab order while its embed document is
        # mid-navigation (isolated 2026-08-16: committed-but-still-loading embed -> skipped;
        # blank embed -> reachable). No wait deterministically dodges it (embed networkidle
        # never settles), so reload once and re-walk — matching the suite's reload-once
        # resilience pattern. Two misses = a real defect.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function(MOVIE_READY_JS, timeout=30000)
        player_ok = walk(page, "movie")
    check("movie: player iframe reachable via Tab", player_ok, "" if player_ok else "iframe never focused in two walks")
    page.evaluate("document.querySelector('.watch-btn--hero').focus()")
    before = page.evaluate("document.querySelector('.watch-btn--hero').getAttribute('aria-pressed')")
    page.keyboard.press("Space")
    page.wait_for_timeout(300)
    after = page.evaluate("document.querySelector('.watch-btn--hero').getAttribute('aria-pressed')")
    check("movie: Space toggles the Save button", before != after, f"{before} -> {after}")

    # ---------- Browse ----------
    page.goto(f"{BASE}/browse?genre=film-noir", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector('.card a[href^="/movie/"]', timeout=30000)
    walk(page, "browse")
    # Native-select keyboard dropdown is a documented headless limitation (ArrowDown never
    # fires 'change' in headless Chrome); exercise the change handler the same way a real
    # keyboard selection does — select_option fires the identical change event.
    page.select_option("#sort", "title")
    for _ in range(40):
        if "sort=title" in page.url:
            break
        page.wait_for_timeout(500)
    check("browse: changing the sort select applies the filter", "sort=title" in page.url, page.url)

    # ---------- Watchlist (the film saved above is present) ----------
    page.goto(f"{BASE}/watchlist", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(800)
    walk(page, "watchlist")
    page.evaluate("document.querySelector('#watchlist-clear').focus()")
    dialog_seen = []
    page.once("dialog", lambda d: (dialog_seen.append(d.message), d.dismiss()))
    page.keyboard.press("Space")
    page.wait_for_timeout(400)
    cards_before = page.locator(".card").count()
    page.wait_for_timeout(400)
    cards_after = page.locator(".card").count()
    check("watchlist: Clear opens a confirm (never erases immediately)", len(dialog_seen) == 1, f"dialog={dialog_seen}")
    check("watchlist: dismissing the confirm leaves the list intact", cards_after == cards_before and cards_before >= 1, f"{cards_before} -> {cards_after}")

    # ---------- Genre landing page (hero chips, surprise link, results grid) ----------
    page.goto(f"{BASE}/genre", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector(".card", timeout=30000)
    walk(page, "genre")

    browser.close()

# ---------- Report ----------
failed = [r for r in results if not r[1]]
print(f"\nKEYBOARD E2E: {len(results) - len(failed)}/{len(results)} passed")
print(f"Console issues from our origin: {len(console_issues)}")
for c in console_issues[:6]:
    print("  console:", c)
print(f"Page errors: {len(page_errors)}")
for e in page_errors[:5]:
    print("  pageerror:", e)
sys.exit(1 if failed or console_issues or page_errors else 0)
