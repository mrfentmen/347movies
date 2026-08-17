#!/usr/bin/env python3
"""Playwright smoke for the 347movies shadcn/ui prototype (ui-prototype/).

Run against the prototype's BUILT dist — this is a production-build check, not a dev
server check. Serve the dist first, e.g.:

    cd ui-prototype && npm run build
    python3 -m http.server 5175 --directory ui-prototype/dist

Then:  python3 scripts/prototype_smoke.py                         # targets 127.0.0.1:5175
       PROTO_BASE_URL=http://host:port python3 scripts/prototype_smoke.py

What it asserts (each failure is an exit-code-1 defect):
- Favicon declared (<link rel="icon">); the browser never auto-requests /favicon.ico
  (the missing-favicon 404 the webapp-testing pass caught on the prototype).
- Home renders the card grid (>= 8 movie cards) with real archive.org poster <img>s.
- Hash-route to a movie page renders the player iframe, meta chips, and Save button.
- Keyboard: a movie card is tab-reachable, and Enter on a card navigates to the movie
  page.
- Mobile (375px): no horizontal overflow, <= 2 grid columns.
- Zero console/page errors from our origin (archive.org posters + embed filtered by
  scripts/battery_common.py — same fail-closed discipline as the live-surface battery).

Browser: system Chrome via channel="chrome" unless BATTERY_CI=1 (bundled chromium).
"""
import os
import sys

from battery_common import Battery, launch_browser
from playwright.sync_api import sync_playwright

BASE = os.environ.get("PROTO_BASE_URL", "http://127.0.0.1:5175")


def main():
    battery = Battery("prototype", BASE)
    with sync_playwright() as p:
        browser = launch_browser(p)

        # --- Home (listeners stay attached through the movie-page navigation below) ---
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        console_errs, page_errs, _ = battery.attach(page)
        requests = []
        page.on("request", lambda r: requests.append(r.url))

        page.goto(f"{battery.base}/")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(2500)

        battery.check("favicon declared in <head>", page.locator("link[rel='icon']").count() >= 1)
        battery.check(
            "no /favicon.ico auto-request (missing-favicon 404)",
            not any("favicon.ico" in u for u in requests),
            str([u for u in requests if "favicon" in u.lower()][:3]),
        )
        cards = page.locator("a[href^='#/movie/']")
        battery.check("home renders >= 8 movie cards", cards.count() >= 8, f"got {cards.count()}")
        posters = page.locator("img[src*='archive.org']")
        battery.check("home posters are real archive.org <img>s", posters.count() >= 8, f"got {posters.count()}")

        # --- Movie page via hash route ---
        page.goto(f"{battery.base}/#/movie/it-1927")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(2500)
        battery.check("movie page renders the player iframe", page.locator("iframe[title*='Watch']").count() == 1)
        battery.check("movie page renders meta chips", page.locator(".rounded-full").count() >= 3)
        battery.check("movie page renders a Save button", page.get_by_role("button", name="Save").count() >= 1)
        page.close()

        # --- Keyboard (home) ---
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(f"{battery.base}/")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1200)
        stops = []
        for _ in range(8):
            page.keyboard.press("Tab")
            stops.append(page.evaluate(
                """(() => { const e = document.activeElement;
                return e && (e.getAttribute('href') || e.tagName); })()"""
            ))
        battery.check("movie cards are keyboard-reachable", any(s and "#/movie/" in s for s in stops), str(stops))
        page.locator("a[href='#/movie/it-1927']").focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(1200)
        battery.check("Enter on a card navigates to the movie page", "#/movie/it-1927" in page.evaluate("location.hash"))
        page.close()

        # --- Mobile (home) ---
        page = browser.new_page(viewport={"width": 375, "height": 667})
        page.goto(f"{battery.base}/")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1800)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        cols = page.evaluate("getComputedStyle(document.querySelector('main .grid')).gridTemplateColumns.split(' ').length")
        battery.check("mobile: no horizontal overflow at 375px", overflow <= 0, f"{overflow}px")
        battery.check("mobile: grid <= 2 columns at 375px", cols <= 2, f"{cols}")
        page.close()

        # --- Console hygiene (home + movie pages above) ---
        battery.check("zero console errors from our origin", len(console_errs) == 0, str(console_errs[:3]))
        battery.check("zero page errors from our origin", len(page_errs) == 0, str(page_errs[:3]))

        browser.close()
    battery.finish()


if __name__ == "__main__":
    main()
