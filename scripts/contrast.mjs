#!/usr/bin/env node
/* 347movies contrast audit tool — computes WCAG 2.x contrast ratios for every color pair
 * the site actually uses, straight from the shipped public/css/style.css tokens. Rerun
 * after any token change: `node scripts/contrast.mjs`. The smoke suite locks the four
 * critical text pairs (scripts/smoke.mjs, design-system integrity section) — this tool is
 * the full picture behind that guard.
 *
 * Pass/fail thresholds (WCAG 2.2):
 *   normal text ≥ 4.5:1 (AA) / ≥ 7:1 (AAA)
 *   large text (≥18pt / ≥14pt bold) ≥ 3:1 (AA) / ≥ 4.5:1 (AAA)
 *   non-text UI boundaries ≥ 3:1 (AA, WCAG 1.4.11)
 */

import { readFileSync } from "node:fs";

const css = readFileSync("public/css/style.css", "utf8");
const root = css.match(/:root\s*\{([^}]*)\}/)[1];

const vars = {};
for (const m of root.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) vars[m[1]] = m[2];

function relLuminance(hex) {
  const v = hex.replace("#", "");
  const rgb =
    v.length === 3
      ? v.split("").map((c) => parseInt(c + c, 16))
      : [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  const lin = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const pair = (name, fg, bg) => ({ name, fg: vars[fg] || fg, bg: vars[bg] || bg, ratio: contrast(vars[fg] || fg, vars[bg] || bg) });

const textPairs = [
  pair("Body copy — Warm Screen White on Cold Black Wall", "text", "bg"),
  pair("Prose paragraphs — #cfcbd8 on page background", "#cfcbd8", "bg"),
  pair("Muted text — #a29ca9 on page background (nav, hero-sub, footer, pagination)", "muted", "bg"),
  pair("Muted text on Raised Slate (genre chips, card years, ad-slot notes)", "muted", "surface"),
  pair("Muted text on Deep Slate (watch buttons, film-slate labels)", "muted", "surface-2"),
  pair("Card titles — Warm Screen White on Raised Slate", "text", "surface"),
  pair("Watch-button hover — Warm Screen White on Deep Slate", "text", "surface-2"),
  pair("Tungsten Amber links on page background (see-all, back/source links, 404)", "accent", "bg"),
  pair("Tungsten Amber on Raised Slate (chip hover, license chip, ad-slot note links)", "accent", "surface"),
  pair("Amber Ink on Tungsten Amber (primary buttons, skip-link)", "accent-ink", "accent"),
  pair("Fade Red on page background (Clear-watchlist hover)", "#e07a7a", "bg"),
  pair("Warm Screen White on True Black (player screen reference)", "text", "#000000"),
];

const uiPairs = [
  pair("Hairline Border on page background", "border", "bg"),
  pair("Hairline Border on Raised Slate", "border", "surface"),
  pair("Hairline Border on Deep Slate", "border", "surface-2"),
  pair("Raised Slate surface on page background (card boundary by fill)", "surface", "bg"),
  pair("Focus ring — Tungsten Amber on page background", "accent", "bg"),
];

function verdict(ratio, min) {
  const pass = ratio >= min;
  return `${pass ? "PASS" : "FAIL"} (${ratio.toFixed(2)}:1, needs ≥${min})`;
}

console.log("Contrast ratios from the shipped style.css tokens\n");
console.log("TEXT PAIRS (AA normal text ≥ 4.5:1, AAA ≥ 7:1):\n");
let worstText = Infinity;
for (const p of textPairs) {
  worstText = Math.min(worstText, p.ratio);
  console.log(`  ${p.name}\n    ${p.fg} on ${p.bg}  →  ${p.ratio.toFixed(2)}:1  |  AA: ${p.ratio >= 4.5 ? "✓" : "✗"}  AAA: ${p.ratio >= 7 ? "✓" : "✗"}`);
}
console.log(`\n  Worst text pair: ${worstText.toFixed(2)}:1 — ${worstText >= 4.5 ? "passes AA normal" : "FAILS AA normal"}\n`);

console.log("NON-TEXT UI BOUNDARIES (WCAG 1.4.11, ≥ 3:1):\n");
let worstUi = Infinity;
for (const p of uiPairs) {
  worstUi = Math.min(worstUi, p.ratio);
  console.log(`  ${p.name}\n    ${p.fg} on ${p.bg}  →  ${p.ratio.toFixed(2)}:1  |  ${verdict(p.ratio, 3)}`);
}
console.log(`\n  Worst non-text boundary: ${worstUi.toFixed(2)}:1 — ${worstUi >= 3 ? "passes 1.4.11" : "FAILS 1.4.11 (known gap, see docs/contrast-audit.md)"}`);

process.exit(worstText >= 4.5 && worstUi >= 3 ? 0 : 1);
