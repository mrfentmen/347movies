#!/usr/bin/env python3
"""axe-core accessibility audit for 347movies against the running dev server (127.0.0.1:8787).

Run: .venv-test/bin/python scripts/axe-audit.py
Requires: .venv-test (see scripts/e2e_test.py) and the dev server on :8787.
Uses system Chrome via channel="chrome"; injects node_modules/axe-core/axe.min.js.

Audits every page type with the WCAG 2.0/2.1/2.2 A+AA rule set and fails on any
violation (serious/critical always; moderate/minor reported but non-fatal unless
`--strict` is passed).
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8787"
AXE_SRC = "node_modules/axe-core/axe.min.js"
STRICT = "--strict" in sys.argv

PAGES = [
    ("home", "/"),
    ("browse", "/browse?genre=film-noir&sort=oldest"),
    ("search", "/search?q=nosferatu"),
    ("movie", "/movie/it-1927"),
    ("movie no-video", "/movie/mrs.-pumpkin"),
    ("genre", "/genre"),
    ("watchlist", "/watchlist"),
    ("about", "/about"),
    ("privacy", "/privacy"),
    ("terms", "/terms"),
    ("404", "/definitely-not-a-page"),
]

violations_total = 0
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    for label, path in PAGES:
        try:
            page.goto(f"{BASE}{path}", wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(800)  # let client-rendered grids settle
        except Exception as e:
            print(f"{label}: LOAD ERROR {e}")
            violations_total += 1
            continue
        with open(AXE_SRC, encoding="utf-8") as f:
            axe_src = f.read()
        # Inject via the DevTools protocol (Runtime.evaluate) — the site's strict CSP
        # (script-src 'self') blocks <script> injection, and we must not weaken it for
        # the audit. Protocol-level evaluation is not subject to CSP.
        page.evaluate(axe_src)
        result = page.evaluate(
            """() => axe.run(document, {
                runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
                resultTypes: ['violations'],
            }).then(r => ({ violations: r.violations }))"""
        )
        violations = result["violations"]
        serious = [v for v in violations if v["impact"] in ("critical", "serious")]
        print(f"\n=== {label} ({path}) — {len(violations)} violations ({len(serious)} serious/critical) ===")
        for v in violations:
            nodes = v["nodes"]
            first = nodes[0]
            target = first["target"][0] if first.get("target") else "?"
            print(f"  [{v['impact']}] {v['id']}: {v['help']}")
            print(f"      -> {target}: {first.get('failureSummary', '')[:140]}")
            if len(nodes) > 1:
                print(f"      (+{len(nodes) - 1} more nodes)")
            if v["impact"] in ("critical", "serious") or STRICT:
                violations_total += 1
    browser.close()

print(f"\n\nAUDIT RESULT: {violations_total} failing {'violation' if violations_total == 1 else 'violations'}")
sys.exit(1 if violations_total else 0)
