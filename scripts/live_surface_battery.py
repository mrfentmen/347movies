#!/usr/bin/env python3
"""Live-surface browser battery for 347movies: structure + console/network hygiene.

    python3 scripts/live_surface_battery.py                        # targets 127.0.0.1:8787
    LIVE_BASE_URL=http://127.0.0.1:8788 python3 scripts/live_surface_battery.py

Assertions (each failure is an exit-code-1 defect): every surface renders its expected
structure and produces zero console errors, page errors, or >=500 responses from our
origin. Third-party noise (archive.org poster-node 5xx absorbed by the initials
fallback, the embed's internal '.categories' pageerror, headless-Chrome
'chrome-extension://invalid/' artifacts) is attributed and filtered by
scripts/battery_common.py — fail-closed, same convention as scripts/e2e_test.py.

Browser: system Chrome via channel="chrome" unless BATTERY_CI=1 (bundled chromium).
"""
import os
import sys

from battery_common import Battery, launch_browser
from playwright.sync_api import sync_playwright

BASE = os.environ.get("LIVE_BASE_URL", "http://127.0.0.1:8787")

SURFACES = [
    ("home", "/", lambda page: page.locator(".grid").count() >= 1),
    ("browse", "/browse?genre=film-noir", lambda page: page.locator(".grid").count() >= 1),
    ("search", "/search?q=noir", lambda page: page.locator(".grid").count() >= 1),
    ("genre", "/genre", lambda page: page.locator(".grid").count() >= 1),
    ("watchlist", "/watchlist", lambda page: page.locator("main").count() == 1),
    ("movie", "/movie/it-1927", lambda page: page.locator("iframe.player").count() == 1),
]


def main():
    battery = Battery("live", BASE)
    with sync_playwright() as p:
        browser = launch_browser(p)
        for name, path, ok_fn in SURFACES:
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            console_errs, page_errs, five_xx = battery.attach(page)
            page.goto(f"{battery.base}{path}")
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(2500)
            battery.check(f"{name}: expected content renders", ok_fn(page))
            battery.check(f"{name}: zero console errors from our origin", len(console_errs) == 0, str(console_errs[:2]))
            battery.check(f"{name}: zero page errors from our origin", len(page_errs) == 0, str(page_errs[:2]))
            battery.check(f"{name}: zero 5xx responses from our origin", len(five_xx) == 0, str(five_xx[:2]))
            page.close()
        browser.close()
    battery.finish()


if __name__ == "__main__":
    main()
