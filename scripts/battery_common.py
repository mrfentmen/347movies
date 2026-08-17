#!/usr/bin/env python3
"""Shared harness for the 347movies browser batteries.

Both batteries (scripts/prototype_smoke.py and scripts/live_surface_battery.py) assert
the same contract — expected structure plus zero console errors, page errors, or >=500
responses from OUR origin — against different targets. This module owns that contract
so the policy lives in one place:

- Third-party attribution is fail-closed: a console error, pageerror, or >=500
  response is a defect unless its source URL is a KNOWN third-party host (or its
  message is a KNOWN embed-internal page error). Unknown or empty sources count as
  ours. Same attribution as scripts/e2e_test.py.
- Both batteries share the same check() reporting, summary/exit behavior, and browser
  selection.

Browser: system Chrome via channel="chrome" by default (the repo's proven pattern —
no browser download). Set BATTERY_CI=1 to use Playwright's bundled chromium (CI
runners without system Chrome; requires `pip install playwright` + `playwright
install chromium`).
"""
import os
import sys

from playwright.sync_api import sync_playwright

# Known third-party hosts. A URL containing any of these is not ours.
THIRD_PARTY_HOSTS = ("archive.org", "chrome-extension://")

# Known embed-internal page errors (archive.org player internals — verified
# identical on the live site's movie page; filtered by scripts/e2e_test.py too).
THIRD_PARTY_PAGEERRORS = (
    "Cannot read properties of null (reading 'categories')",
    "Transition was skipped",
)

CI = os.environ.get("BATTERY_CI") == "1"


class Battery:
    """A named battery of checks against one base URL."""

    def __init__(self, name, base):
        self.name = name
        self.base = base.rstrip("/")
        self.failures = []

    def check(self, label, ok, detail=""):
        print(f"  {'ok ' if ok else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
        if not ok:
            self.failures.append(label)

    def attach(self, page):
        """Wire console/pageerror/response listeners recording OUR-origin issues only.

        Returns (console_errs, page_errs, five_xx), each already filtered to our
        origin, so checks just assert emptiness. Fail-closed: a source that is not a
        known third-party host is ours.
        """
        console_errs, page_errs, five_xx = [], [], []

        def ours(url):
            return not any(h in url for h in THIRD_PARTY_HOSTS)

        page.on(
            "console",
            lambda m: console_errs.append(m.text)
            if m.type == "error" and ours(m.location.get("url") or "")
            else None,
        )
        page.on(
            "pageerror",
            lambda e: page_errs.append(str(e))
            if not any(k in str(e) for k in THIRD_PARTY_PAGEERRORS)
            else None,
        )
        page.on(
            "response",
            lambda r: five_xx.append(r.url) if r.status >= 500 and ours(r.url) else None,
        )
        return console_errs, page_errs, five_xx

    def finish(self):
        print(f"\n{len(self.failures)} failure(s)" if self.failures else "\nALL CHECKS PASSED")
        sys.exit(1 if self.failures else 0)


def launch_browser(p):
    """Launch the browser for a sync_playwright context p."""
    return p.chromium.launch(headless=True) if CI else p.chromium.launch(headless=True, channel="chrome")


def main():
    print(f"battery_common: shared harness only — run a battery script directly")
    return 1


if __name__ == "__main__":
    sys.exit(main())
