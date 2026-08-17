#!/usr/bin/env node
/**
 * 347movies — weekly "new arrivals" report (dependency-free, Node 22+).
 *
 * Queries archive.org for films added to the catalog's legal collections in the last N days
 * (default 7) and prints a markdown report: title, release year, added date, a link to the
 * film's page on the site, and an archive.org link — grouped by added date, newest first.
 *
 * The query is the EXACT same legal gate as the live catalog (lib/archive.ts): a
 * creativecommons.org licenseurl mark AND one of the curated film collections
 * (feature_films / prelinger / moviesandfilms) AND mediatype:movies, plus the films-only
 * clause (no episodes/trailers/serial parts). Every film reported here passes the site's
 * legality policy and would appear in the catalog index within its 24h rebuild.
 *
 * Used by .github/workflows/weekly-new-arrivals.yml (cron, Mondays 12:00 UTC): when at least
 * one film landed, the report is posted as a GitHub issue so the owner is notified. Run it
 * yourself any time:
 *
 *   node scripts/new-arrivals.ts                     # last 7 days, markdown to stdout
 *   node scripts/new-arrivals.ts --days=30           # last 30 days
 *   node scripts/new-arrivals.ts --since=2026-08-01  # since a date (inclusive)
 *   node scripts/new-arrivals.ts --json              # JSON report to stdout (workflow)
 *   node scripts/new-arrivals.ts --body-out=/tmp/r.md # also write the markdown report
 */
import { searchArchive } from "../lib/archive.ts";

const SITE_URL = "https://347movies.pages.dev";
const DEFAULT_DAYS = 7;
const ROWS = 1000; // weekly trickle into curated collections is tiny; generous headroom

interface Args {
  days: number;
  since: string | null;
  json: boolean;
  bodyOut: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { days: DEFAULT_DAYS, since: null, json: false, bodyOut: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/new-arrivals.ts [--days=N] [--since=YYYY-MM-DD] [--json] [--body-out=FILE]",
      );
      process.exit(0);
    } else if (arg.startsWith("--days=")) {
      const n = parseInt(arg.slice("--days=".length), 10);
      if (!Number.isFinite(n) || n < 1 || n > 365) {
        console.error("ERROR: --days must be an integer between 1 and 365.");
        process.exit(2);
      }
      args.days = n;
    } else if (arg.startsWith("--since=")) {
      const d = arg.slice("--since=".length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        console.error("ERROR: --since must be YYYY-MM-DD.");
        process.exit(2);
      }
      args.since = d;
    } else if (arg.startsWith("--body-out=")) {
      args.bodyOut = arg.slice("--body-out=".length);
    } else {
      console.error(`ERROR: unknown argument "${arg}". See --help.`);
      process.exit(2);
    }
  }
  return args;
}

/** Trim absurdly long archive.org titles for readability (full title stays in the link). */
function displayTitle(title: string): string {
  return title.length > 110 ? `${title.slice(0, 107)}…` : title;
}

/** One-day granularity grouping; docs arrive sorted addeddate desc from the query. */
function groupByDate(docs: { identifier: string; title: string; year?: unknown; addeddate?: unknown }[]): Map<string, typeof docs> {
  const groups = new Map<string, typeof docs>();
  for (const doc of docs) {
    const added = String(doc.addeddate ?? "").slice(0, 10);
    const day = added || "unknown";
    const list = groups.get(day) ?? [];
    list.push(doc);
    groups.set(day, list);
  }
  return groups;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sinceDate = args.since
    ? new Date(`${args.since}T00:00:00Z`)
    : new Date(Date.now() - args.days * 86_400_000);
  // Quoted, milliseconds stripped: archive.org's Solr rejects raw colons/milliseconds in a
  // date range ("a key-value pair is malformed"), and the quoted no-ms ISO form is the one
  // proven live (2026-08-16: 90 days -> 107 films, 365 days -> 690).
  const sinceIso = sinceDate.toISOString().replace(/\.\d+Z$/, "Z");

  let result;
  try {
    result = await searchArchive(
      {
        query: `addeddate:["${sinceIso}" TO *]`,
        filmsOnly: true,
        sort: "recent",
        page: 1,
        rows: ROWS,
      },
      fetch,
    );
  } catch (err) {
    console.error(`ERROR: archive.org query failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const docs = result.docs.map((doc) => ({
    identifier: String(doc["identifier"] ?? ""),
    title: String(doc["title"] ?? doc["identifier"] ?? "Untitled"),
    year: doc["year"],
    addeddate: doc["addeddate"],
  })).filter((doc) => doc.identifier);

  if (args.json) {
    const out = {
      window: { since: sinceIso, days: args.days, sinceDate: args.since ?? null },
      count: docs.length,
      numFound: result.numFound,
      films: docs.map((doc) => ({
        identifier: doc.identifier,
        title: doc.title,
        year: typeof doc.year === "number" ? doc.year : null,
        addeddate: String(doc.addeddate ?? ""),
        url: `${SITE_URL}/movie/${doc.identifier}`,
        archiveUrl: `https://archive.org/details/${doc.identifier}`,
      })),
    };
    const jsonText = JSON.stringify(out, null, 2);
    if (args.bodyOut) {
      // Write the markdown report to the requested path as well (single query, both forms).
      await writeFile(args.bodyOut, renderMarkdown(docs, args, sinceDate));
    }
    process.stdout.write(`${jsonText}\n`);
    return;
  }

  process.stdout.write(`${renderMarkdown(docs, args, sinceDate)}\n`);
}

function renderMarkdown(
  docs: { identifier: string; title: string; year?: unknown; addeddate?: unknown }[],
  args: Args,
  sinceDate: Date,
): string {
  const windowLabel = args.since
    ? `since ${args.since}`
    : `last ${args.days} day${args.days === 1 ? "" : "s"}`;
  const heading = `## New arrivals — ${windowLabel} (${sinceDate.toISOString().slice(0, 10)})`;

  if (docs.length === 0) {
    return `${heading}\n\n**No new legal films** joined the curated collections in the ${windowLabel}. The catalog is unchanged — the weekly check will tell you when fresh movies land.`;
  }

  const lines: string[] = [
    heading,
    "",
    `**${docs.length} new ${docs.length === 1 ? "film" : "films"}** joined the curated collections (Creative Commons / public-domain marks, films-only). Every title below passes the site's legality gate and appears in the catalog within its 24h index rebuild.`,
    "",
  ];

  for (const [day, dayDocs] of groupByDate(docs)) {
    lines.push(`### ${day}`, "");
    for (const doc of dayDocs) {
      const year = typeof doc.year === "number" && doc.year > 0 ? ` (${doc.year})` : "";
      lines.push(
        `- [**${displayTitle(doc.title)}${year}**](${SITE_URL}/movie/${doc.identifier}) — [archive.org](https://archive.org/details/${doc.identifier})`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function writeFile(path: string, content: string): Promise<void> {
  const { writeFile: wf } = await import("node:fs/promises");
  await wf(path, `${content}\n`);
}

main().catch((err) => {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
