#!/usr/bin/env node
/**
 * 347movies — weekly license-gate re-probe (dependency-free, Node 22+).
 *
 * Re-measures every registered pool's live size AND re-probes the candidate collections
 * that cleared (or failed) the license gate in prior sweeps, through the SAME legal gate
 * as the live catalog (lib/archive.ts LEGAL_CLAUSE). Prints a markdown report of what
 * changed:
 *
 *   - POOL GROWTH: a registered pool whose license-marked count grew meaningfully since the
 *     last baseline (net new legal items worth an index rebuild / a look).
 *   - NEW COLLECTION: a candidate that previously had 0 license-marked movies now has >0 —
 *     a genuinely new licensed collection appeared upstream (the only way the catalog can
 *     honestly grow, per the research in docs/institutional-collections-research.md).
 *
 * Used by .github/workflows/weekly-license-sweep.yml (cron, Wednesdays 12:00 UTC, offset
 * from the Monday new-arrivals run): when either signal fires, a GitHub issue is opened.
 * Run it yourself any time:
 *
 *   node scripts/license-sweep.ts              # markdown report to stdout
 *   node scripts/license-sweep.ts --json       # JSON report to stdout (workflow)
 *   node scripts/license-sweep.ts --body-out=/tmp/sweep.md   # also write the report
 *   node scripts/license-sweep.ts --baseline-from=2026-08-22 # label the baseline in prose
 *
 * Baselines are the live counts measured 2026-08-22 (8th sweep, documented in
 * docs/institutional-collections-research.md). After a sweep that found changes, update the
 * BASELINE numbers here so the next run diffs against the new state — the issue body tells
 * you to. A candidate stays on the watch list forever (it may become licensed later); only
 * counts change.
 */
import { ARCHIVE_SEARCH_URL, LEGAL_CLAUSE } from "../lib/archive.ts";

const SITE_URL = "https://347movies.pages.dev";
const ROWS = 0; // counts only — no docs needed for a re-probe
/** A pool counts as "grown" when it exceeds its baseline by this many license-marked items. */
const GROWTH_THRESHOLD = 25;
/** Solr cursor: one page of ids is enough to detect existence; counts need rows=0 + numFound. */
const TIMEOUT_MS = 20_000;

interface ProbeResult {
  query: string;
  numFound: number;
  error?: string;
}

/** A registered pool: its exact catalog gate (from lib/archive.ts) and last measured count. */
const POOLS: { label: string; gate: string; baseline: number }[] = [
  { label: "films", gate: "collection:(feature_films OR prelinger OR moviesandfilms) AND mediatype:movies", baseline: 18_491 },
  { label: "tv", gate: "collection:classic_tv AND mediatype:movies", baseline: 2_513 },
  { label: "anime", gate: "collection:anime AND mediatype:movies AND year:[* TO 1974]", baseline: 24 },
  { label: "cartoons", gate: "collection:animationandcartoons AND mediatype:movies", baseline: 1_308 },
  { label: "otr", gate: "collection:oldtimeradio AND mediatype:audio", baseline: 2_309 },
  { label: "music", gate: "collection:(GratefulDead OR etree) AND mediatype:etree", baseline: 1_456 },
  { label: "documentaries", gate: "collection:culturalandacademicfilms AND mediatype:movies", baseline: 8_420 },
  { label: "sports", gate: "collection:sports AND mediatype:movies", baseline: 3_625 },
  { label: "shorts", gate: "collection:short_films AND mediatype:movies", baseline: 1_858 },
  { label: "silents", gate: "collection:silent_films AND mediatype:movies", baseline: 729 },
  { label: "publictv", gate: "collection:television AND mediatype:movies AND identifier:aapb*", baseline: 1_653 },
  { label: "science", gate: "collection:wellcomefilm AND mediatype:movies", baseline: 257 },
  { label: "govfilms", gate: "collection:FedFlix AND mediatype:movies", baseline: 5_948 },
  { label: "audiobooks", gate: "collection:librivoxaudio AND mediatype:audio", baseline: 18_349 },
  { label: "records", gate: "collection:78rpm AND mediatype:audio AND year:[* TO 1926]", baseline: 5_039 },
  { label: "ephemera", gate: "collection:avgeeks AND mediatype:movies", baseline: 413 },
  { label: "space", gate: "collection:nasa AND mediatype:movies", baseline: 719 },
  { label: "footage", gate: "(collection:stock_footage OR collection:(home_movies OR home_movie)) AND mediatype:movies AND year:[* TO 1969]", baseline: 445 },
];

/**
 * Candidates to keep probing for NEW licensed content: every collection that had 0
 * license-marked movies in prior sweeps but could gain them as archives mature. Kept on the
 * watch list indefinitely; a >0 count here is the one honest way the catalog can grow
 * (institutional/curated marks, never the self-declared junk drawer — see the research doc).
 */
/**
 * Candidates to keep probing for NEW licensed content. `baseline` is the last measured
 * count (0 = was empty: a >0 result is a genuinely NEW licensed collection — the one honest
 * way the catalog can grow). Candidates with a known non-zero baseline are documented as
 * rejected (self-declared-mark junk drawers, see the research doc): their growth is worth a
 * look but they must NEVER auto-register — provenance has to be institutional/curated marks.
 */
const CANDIDATES: { name: string; mediatype: string; baseline: number; note: string }[] = [
  // Institutional / curated archives that may gain licensed digitizations (all 0 as of 2026-08-22)
  { name: "nationalfilmboard", mediatype: "movies", baseline: 0, note: "National Film Board of Canada" },
  { name: "usnationalarchives", mediatype: "movies", baseline: 0, note: "NARA digitizations" },
  { name: "pathe", mediatype: "movies", baseline: 0, note: "Pathé newsreels/films" },
  { name: "newsreels", mediatype: "movies", baseline: 0, note: "newsreel collection" },
  { name: "travelfilms", mediatype: "movies", baseline: 0, note: "travelogue films" },
  { name: "documentaryfilms", mediatype: "movies", baseline: 0, note: "documentary collection" },
  // Genre/film-adjacent collections probed 0 (8th sweep 2026-08-22)
  { name: "featurefilms", mediatype: "movies", baseline: 0, note: "feature-film collection" },
  { name: "cinema", mediatype: "movies", baseline: 0, note: "cinema collection" },
  { name: "classicmovies", mediatype: "movies", baseline: 0, note: "classic movies" },
  { name: "broadcasting", mediatype: "movies", baseline: 0, note: "broadcasting" },
  { name: "publicaccess", mediatype: "movies", baseline: 0, note: "public-access TV" },
  { name: "newsfilm", mediatype: "movies", baseline: 0, note: "newsfilm" },
  { name: "ww2films", mediatype: "movies", baseline: 0, note: "WWII films" },
  { name: "animationarchive", mediatype: "movies", baseline: 0, note: "animation archive" },
  // Known-rejected junk drawers: non-zero baseline, growth flagged for review only.
  { name: "educationalfilms", mediatype: "movies", baseline: 10, note: "REJECTED 2026-08-19: self-declared marks, same rationale as the docs pool" },
  { name: "opensource_movies", mediatype: "movies", baseline: 403_478, note: "REJECTED 2026-08-21: community junk drawer, self-declared marks (measured 403,478 on 2026-08-22; +764/wk growth trend)" },
];

interface Args {
  json: boolean;
  bodyOut: string | null;
  baselineFrom: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, bodyOut: null, baselineFrom: null };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/license-sweep.ts [--json] [--body-out=FILE] [--baseline-from=YYYY-MM-DD]",
      );
      process.exit(0);
    } else if (arg.startsWith("--body-out=")) {
      args.bodyOut = arg.slice("--body-out=".length);
    } else if (arg.startsWith("--baseline-from=")) {
      args.baselineFrom = arg.slice("--baseline-from=".length);
    } else {
      console.error(`ERROR: unknown argument "${arg}". See --help.`);
      process.exit(2);
    }
  }
  return args;
}

async function probe(query: string): Promise<ProbeResult> {
  const url = new URL(ARCHIVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", String(ROWS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "347movies-license-sweep/1.0 (+https://347movies.pages.dev)" },
      signal: controller.signal,
    });
    if (!res.ok) return { query, numFound: -1, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { response?: { numFound?: number } };
    const numFound = body.response?.numFound;
    if (typeof numFound !== "number") return { query, numFound: -1, error: "bad JSON shape" };
    return { query, numFound };
  } catch (err) {
    return { query, numFound: -1, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

interface SweepReport {
  date: string;
  pools: { label: string; baseline: number; now: number; delta: number }[];
  newCollections: { name: string; mediatype: string; count: number; note: string }[];
  candGrowth: { name: string; mediatype: string; baseline: number; now: number; note: string }[];
  poolGrowth: { label: string; baseline: number; now: number; delta: number }[];
  errors: { label: string; error: string }[];
  anyChange: boolean;
}

async function runSweep(): Promise<SweepReport> {
  const date = new Date().toISOString().slice(0, 10);
  const pools = [];
  const poolGrowth = [];
  const errors = [];

  for (const pool of POOLS) {
    const res = await probe(`${LEGAL_CLAUSE} AND ${pool.gate}`);
    if (res.error || res.numFound < 0) {
      errors.push({ label: pool.label, error: res.error ?? "unknown" });
      continue;
    }
    const delta = res.numFound - pool.baseline;
    pools.push({ label: pool.label, baseline: pool.baseline, now: res.numFound, delta });
    if (delta >= GROWTH_THRESHOLD) {
      poolGrowth.push({ label: pool.label, baseline: pool.baseline, now: res.numFound, delta });
    }
  }

  const newCollections = [];
  const candGrowth = [];
  for (const cand of CANDIDATES) {
    const res = await probe(`${LEGAL_CLAUSE} AND collection:${cand.name} AND mediatype:${cand.mediatype}`);
    if (res.error || res.numFound < 0) {
      errors.push({ label: `candidate:${cand.name}`, error: res.error ?? "unknown" });
      continue;
    }
    if (cand.baseline === 0 && res.numFound > 0) {
      // Was empty, now has licensed marks: a genuinely new collection worth reviewing.
      newCollections.push({ name: cand.name, mediatype: cand.mediatype, count: res.numFound, note: cand.note });
    } else if (cand.baseline > 0 && res.numFound > cand.baseline + GROWTH_THRESHOLD) {
      // Known-rejected junk drawer growing: review only, never auto-register.
      candGrowth.push({ name: cand.name, mediatype: cand.mediatype, baseline: cand.baseline, now: res.numFound, note: cand.note });
    }
  }

  return {
    date,
    pools,
    newCollections,
    candGrowth,
    poolGrowth,
    errors,
    anyChange: newCollections.length > 0 || candGrowth.length > 0 || poolGrowth.length > 0,
  };
}

function renderMarkdown(report: SweepReport, baselineFrom: string | null): string {
  const base = baselineFrom ? `baseline ${baselineFrom}` : "the 2026-08-22 baseline";
  const lines: string[] = [
    `## License-gate re-probe — ${report.date}`,
    "",
    `Re-probed all ${POOLS.length} registered pools and ${CANDIDATES.length} candidate collections through the site's exact legal gate (${"`"}licenseurl:https://creativecommons.org*${"`"} etc.), diffing against ${base}.`,
    "",
  ];

  if (!report.anyChange) {
    lines.push("**No changes.** All pool counts are within noise of baseline and no candidate collection gained license-marked content. The catalog ceiling holds; nothing to do.", "");
  }

  if (report.newCollections.length > 0) {
    lines.push("### 🆕 New licensed collection(s) detected", "", "A collection that previously had **0** license-marked items now has some — this is the one honest way the catalog can grow. **Review before registering** (provenance must be institutional/curator-applied marks, not self-declared):", "");
    for (const c of report.newCollections) {
      const archiveUrl = `https://archive.org/search?query=collection%3A${encodeURIComponent(c.name)}`;
      lines.push(`- **${c.name}** — ${c.count} license-marked ${c.mediatype} — [search archive.org](${archiveUrl})`);
    }
    lines.push("", "If the marks are institutional/curated (like AAPB, Wellcome, avgeeks), register it per the pool wiring checklist; if it's self-declared-mark junk (the opensource_movies failure mode), keep it off and note why in docs/institutional-collections-research.md.", "");
  }

  if (report.poolGrowth.length > 0) {
    lines.push("### 📈 Pool growth beyond noise", "", "These registered pools gained license-marked items (≥ 25 net new):", "");
    for (const p of report.poolGrowth) {
      lines.push(`- **${p.label}**: ${p.baseline} → ${p.now} (+${p.delta})`);
    }
    lines.push("", "New items appear in the catalog automatically within the 24h index rebuild — no action needed, but a warmup run is worth doing.", "");
  }

  if (report.candGrowth.length > 0) {
    lines.push("### ⚠️ Known-rejected candidate growth (review only)", "", "These documented junk-drawer collections gained license-marked items — **do not register** (self-declared marks), but worth a glance in case an institutional subset appeared:", "");
    for (const c of report.candGrowth) {
      lines.push(`- **${c.name}** (${c.mediatype}): ${c.baseline} → ${c.now} (+${c.now - c.baseline}) — ${c.note}`);
    }
    lines.push("");
  }

  if (report.errors.length > 0) {
    lines.push("### ⚠️ Probe errors", "", "These probes failed (archive.org transient or rate limit) and were not counted — re-run or inspect:", "");
    for (const e of report.errors) {
      lines.push(`- ${e.label}: ${e.error}`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "_After acting on this report, update the baseline counts in scripts/license-sweep.ts so the next weekly run diffs against the new state._",
  );
  return lines.join("\n").trimEnd();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runSweep();

  if (args.json) {
    const out = {
      date: report.date,
      anyChange: report.anyChange,
      newCollections: report.newCollections,
      candGrowth: report.candGrowth,
      poolGrowth: report.poolGrowth,
      errors: report.errors,
      pools: report.pools,
    };
    if (args.bodyOut) {
      await writeFile(args.bodyOut, renderMarkdown(report, args.baselineFrom));
    }
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderMarkdown(report, args.baselineFrom)}\n`);
}

async function writeFile(path: string, content: string): Promise<void> {
  const { writeFile: wf } = await import("node:fs/promises");
  await wf(path, `${content}\n`);
}

main().catch((err) => {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
