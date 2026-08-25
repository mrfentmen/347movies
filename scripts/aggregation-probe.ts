#!/usr/bin/env node
/**
 * 347movies — aggregation-based collection probe (dependency-free, Node 22+).
 *
 * Instead of guessing collection names (the pre-2026-08-24 method), this script samples
 * the licensed population (movies, audio, or etree — see --mediatype) by downloads and
 * aggregates their real `collection` fields — letting archive.org tell us which
 * collections actually hold licensed content.
 * The method is documented in docs/institutional-collections-research.md (§ Method).
 *
 * It cross-references against the already-registered pool collections and the
 * candidate/rejected collection names, then gate-checks any genuinely new collections
 * (never before seen by any sweep) to see whether they pass the license gate and are
 * disjoint from the already-registered pools of the same mediatype. The output is a
 * short JSON report for the workflow and an optional markdown file for the issue body.
 *
 * Used by .github/workflows/weekly-license-sweep.yml — runs alongside the per-pool
 * baseline sweep so the weekly issue also surfaces genuinely new collections.
 *
 *   node scripts/aggregation-probe.ts             # markdown report to stdout
 *   node scripts/aggregation-probe.ts --json      # JSON report to stdout (workflow)
 *   node scripts/aggregation-probe.ts --body-out=/tmp/agg.md  # also write markdown
 *   node scripts/aggregation-probe.ts --limit=500 # smaller sample (PR CI smoke)
 *   node scripts/aggregation-probe.ts --mediatype=audio # audio pools (also: etree)
 *
 * When a collection gets registered as a pool, add its name to KNOWN_COLLECTIONS below
 * (the aggregation method must know what's already handled — same maintenance model as
 * the baseline numbers in license-sweep.ts).
 */

import { ARCHIVE_SEARCH_URL, LEGAL_CLAUSE } from "../lib/archive.ts";

const SITE_URL = "https://347movies.pages.dev";
/** How many licensed items to sample, sorted by downloads (paginated). */
const SAMPLE_SIZE = 10_000;
const PAGE_SIZE = 500;
/** Collections with fewer items than this are noise — skip the gate check. */
const NOISE_THRESHOLD = 5;
const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Known collections — everything already registered, probed, or rejected.
// A genuinely NEW collection is one that appears in the aggregation output but
// NOT in this set.  Update when a new pool is registered or a candidate is added
// to license-sweep.ts.
// ---------------------------------------------------------------------------

/** Collection names extracted from the registered pool gates (lib/archive.ts + license-sweep.ts POOLS). */
const KNOWN_COLLECTIONS = new Set([
  // films union
  "feature_films", "prelinger", "moviesandfilms",
  // tv / publictv
  "classic_tv", "television",
  // anime / cartoons
  "anime", "animationandcartoons",
  // audio pools
  "oldtimeradio", "GratefulDead", "etree", "librivoxaudio", "78rpm",
  // documentary / sports / shorts / silents
  "culturalandacademicfilms", "sports", "short_films", "silent_films",
  // institutionally-registered pools
  "wellcomefilm", "FedFlix", "usgovfilms", "avgeeks", "nasa",
  // footage (curated view of films)
  "stock_footage", "home_movies", "home_movie",
  // 2026-08-24 probe registrations
  "wwIIarchive", "universal_newsreels",
]);

/**
 * Candidates and rejected collections — every collection name that has been
 * probed (and typically rejected) in prior sweeps.  These are NOT registered
 * pools but the aggregation probe should not flag them as "new" either.
 *
 * Sourced from license-sweep.ts CANDIDATES + the institutional-collections-research.md
 * rejection lists.  The baseline count is irrelevant here — the probe only needs
 * the name to skip it.
 */
const KNOWN_CANDIDATES = new Set([
  // license-sweep.ts CANDIDATES
  "nationalfilmboard", "usnationalarchives", "pathe",
  "newsreels", "travelfilms", "documentaryfilms",
  "featurefilms", "cinema", "classicmovies", "broadcasting",
  "publicaccess", "newsfilm", "ww2films", "animationarchive",
  "educationalfilms", "opensource_movies",
  // institutional-collections-research.md — probed and rejected
  "childrenstelevision", "artsandmusicvideos", "frank-moore-archives",
  "mit_ocw", "ElectricSheep", "vhsvault",
  "Comedy_Films", "SciFi_Horror", "Film_Noir", "film_scifi",
  "TheVideoCellarCollection", "cinemocracy",
  "europeanlibraries", "smithsonian", "georgeblood",
  "nasaimages", "nasafoia", "smithsonianlibraries", "metpublicart",
  "cdl", "universityofcalifornia", "harvard", "yale", "mit",
  "pbs", "PBSNewsHour", "newshour", "wnet", "publicresourceorg",
  "govdocs", "congressional", "cspan", "biodiversitylibrary",
  "biodivlibrary", "scifi", "artfilm", "comedy_films",
  "audio_music", "opensource_audio", "radio", "podcasts",
  "radioprograms", "netlabels",
  "radioshows", "radio_programs", "classicradio", "radioplays",
  "oldtime radio2", "live_music", "rockconcerts", "orchestral",
  "swing", "bigband", "bluegrass", "gospel", "openaudiobooks",
  "audio_books", "publicdomainbooks", "78rpmrecords", "shellac",
  "gramophone", "victor_records", "edison_records", "cylinders",
  "prelingerarchives", "silentcinema", "kino", "opencourseware", "toons",
  "television", // duplicate (already in KNOWN_COLLECTIONS, harmless)
  // 2026-08-24 aggregation-probe live run — surfaced as candidates, rejected as junk:
  "deemphasize",            // archive.org internal status marker (not a real collection)
  "social-media-video",     // modern TikTok/YouTube reuploads (self-declared marks)
  "additional_collections_video", // community junk drawer
  "mirrortube",             // YouTube mirror spam (self-declared marks)
  "individual-image-collections", // images, not movies
  "feature_films_unsorted", // archive.org internal staging for feature_films
  "capcut-template-collection", // CapCut template spam
  "capcutmod",              // CapCut mod spam
  "pwnage",                 // gaming/exploit spam
  "danieldteolijr",         // single-user upload (self-declared marks)
  "no-preview",             // archive.org internal marker, mixed bag
  // 2026-08-24 aggregation-probe live run round 2 — surfaced, rejected as obvious junk:
  "loggedin",               // archive.org internal login-gated content marker
  "feature_films_picfixer", // archive.org internal tool for metadata fixing
  "vlogs",                  // modern vlogs (self-declared marks)
  "bliptv",                 // defunct Blip.tv archives (self-declared marks)
  "vj_loops",               // modern VJ visual loops (self-declared marks)
  "audio_religion",         // misclassified audio in movie mediatype
  "spiritualityandreligion", // misclassified, self-declared marks
  // 2026-08-24 aggregation-probe live run round 3 — surfaced, rejected as obvious junk:
  "community_media",         // community junk drawer (same failure mode as opensource_movies)
  "adultvhs",                // NSFW content
  "movie_trailers_picfixer", // archive.org internal tool (same as feature_films_picfixer)
  "audio_sermons",           // misclassified audio in movie mediatype
  "podcasts-video",          // modern podcasts (self-declared marks)
  "opensource_religionvideo", // self-declared marks on religion content
  "vhskids",                 // modern VHS rips of kids' content (self-declared marks)
  // archive.org internal markers (not real subject collections):
  "geo_restricted",          // system collection for geo-restricted content
  "movie_trailers_unsorted", // internal staging (same pattern as feature_films_unsorted)
  // 2026-08-24 aggregation-probe follow-up run — adjudicated by provenance sampling:
  "newsandpublicaffairs",    // top-level subject mega-collection; gov subset already in usgovfilms
  "ephemera",                // top-level subject mega-collection; 412 items already in avgeeks; real signal is its sub-collections
  "classic_tv_1950s",        // self-declared marks on copyrighted TV (Bonanza, Beverly Hillbillies)
  "classic_tv_1960s",        // self-declared marks on copyrighted TV
  "television_inbox",        // archive.org TV ingest inbox (junk drawer)
  "more_animation",          // mixed: genuine Blender CC films + self-declared PD on copyrighted Popeye
  "anime_miscellaneous",     // pirated anime with fake publicdomain marks (worst class)
  "classic_cartoons",        // 46 items, mixed marks (some genuine PD Betty Boop, one by-nc-nd)
  "movie_trailers",          // 100% films-union overlap (curated view, not new content)
  "prelingerhomemovies",     // 100% films-union overlap (curated view)
  "computersandtechvideos",  // modern tech tutorials (self-declared marks)
  "macmost",                 // modern Mac tutorials, by-nc-nd, off-theme
  "cordkillersshow",         // modern podcast episodes (CC), off-theme
  "IndiaCulture",            // Indian TV serials (Ramayan), CC-NC, off-theme for the golden-age catalog
  "JaiGyan",                 // uploader account; identical content to IndiaCulture
  // 2026-08-24 audio aggregation-probe — adjudicated (see research doc, 6th confirmation):
  "audio_bookspoetry",       // subject mega-collection; 82% already in librivoxaudio (curated view + tag noise)
  "folksoundomy",            // community music/podcast junk drawer (self-declared marks)
  "folksoundomy_music",      // sub-collection of the above
  "folksoundomy_music_unsorted", // sub-collection of the above
  "radioshowarchive",        // modern podcasts (self-declared marks)
  "radioshowinbox",          // archive.org radio ingest inbox
  "hifidelity",              // modern background music / pop (self-declared marks)
  "hifidelity_potpourri",    // sub-collection of the above
  "cratediggers",            // modern podcasts / religion (self-declared marks)
  "audio_islamic",           // religious reuploads
  "theoldtimeradio",         // 100% inside oldtimeradio (curated view)
  "lumedwards",              // 100% inside oldtimeradio (curated view)
  "fibbermcgee",             // single-show OTR fan collection, inside oldtimeradio
  "suspenseradio",           // single-show OTR fan collection, inside oldtimeradio
  "jackbennyradio",          // single-show OTR fan collection, inside oldtimeradio
  "comfort_stand",           // modern CC netlabel
  "clinicalarchives",        // modern CC netlabel
  "dustedwaxkingdom",        // modern CC netlabel
  "podcasts_miscellaneous",  // modern podcasts
  "podcasts_compilations",   // modern podcast compilations
  "audio_foreign",           // non-English misc
  "livre_audio",             // non-English audiobooks (tag noise)
  "ytjdradio",               // misc radio rips
  "bad-panda",               // misc uploads
  "free-music-charts",       // netlabel charts
  "tornfleshrecords",        // netlabel
  "labelnetlabel",           // netlabel
  "freemusicarchive",        // modern free music (self-declared marks)
  // 2026-08-25 etree aggregation-probe — adjudicated (see research doc, 7th confirmation):
  "somethingbluearchives",   // netlabel; hosted taste_of_mud, the single licensed etree item outside the gate
]);

/** Junk-drawer collection markers to strip before counting. */
const JUNK_MARKERS = new Set(["community", "ourmedia"]);

/** Per-mediatype sampling + overlap configuration. */
interface MediatypeConfig {
  clause: string;       // the mediatype:X Solr clause
  poolUnion: string;    // collection:(...) of the registered pools for this mediatype
  overlapLabel: string; // human label for the overlap metric in the markdown report
  noun: string;         // "movies" / "audio items" / "live-music recordings"
  /**
   * Curated-view collections to suppress from the report. These are NOT in
   * KNOWN_CANDIDATES on purpose: they must still be gate-checked every run so
   * that if one ever goes disjoint (exclusiveCount > 0) it surfaces in
   * newCollections and fires the issue. Suppression only hides the "still 100%
   * inside the pools" confirmation from the report — the alert path is untouched.
   */
  curatedSuppress: string[];
}

const MEDIATYPES: Record<string, MediatypeConfig> = {
  movies: {
    clause: "mediatype:movies",
    // The films union is the historical overlap baseline (shorts/silents/footage are
    // curated views of it). Other registered video pools (wwii, newsreels, govfilms, …)
    // are already in KNOWN_COLLECTIONS, so they never reach the gate-check step.
    poolUnion: "collection:(feature_films OR prelinger OR moviesandfilms)",
    overlapLabel: "the films union",
    noun: "movies",
    curatedSuppress: [],
  },
  audio: {
    clause: "mediatype:audio",
    poolUnion: "collection:(oldtimeradio OR librivoxaudio OR 78rpm)",
    overlapLabel: "the registered audio pools",
    noun: "audio items",
    curatedSuppress: [],
  },
  etree: {
    clause: "mediatype:etree",
    poolUnion: "collection:(GratefulDead OR etree)",
    overlapLabel: "the registered music pool",
    noun: "live-music recordings",
    // The 2026-08-25 etree probe confirmed these band collections sit 100% inside the
    // `etree` catch-all the music pool gates on — curated views, not new content. They
    // are still gate-checked every run (see interface doc) so a disjoint drift alerts.
    curatedSuppress: [
      "HairyLarry", "DavidGans", "LaneFamily", "TheShipsCat", "DupreesDeadBand",
      "StuAllenandMarsHotel", "BrokenCompassBluegrass", "BlueFunk", "PandaJAM",
      "TheNational", "ObliviousFools", "BannedFromEden", "Pachyderm",
      "TheBicycleThiefMusic", "TheloniousMonster",
    ],
  },
};

function mediatypeConfig(mediatype: string): MediatypeConfig {
  const cfg = MEDIATYPES[mediatype];
  if (!cfg) {
    console.error(`ERROR: --mediatype must be one of ${Object.keys(MEDIATYPES).join(", ")}, got "${mediatype}".`);
    process.exit(2);
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocSample {
  identifier: string;
  collection: string[];
  title: string;
}

interface GatedCandidate {
  name: string;
  sampleCount: number;   // items in the sample
  gateCount: number;      // items passing the license gate
  poolOverlap: number;    // items also in the registered pools of this mediatype
  exclusiveCount: number; // items NOT in the registered pools of this mediatype
}

interface AggregationReport {
  date: string;
  mediatype: string;
  candidatesChecked: number;
  newCollections: GatedCandidate[];           // genuinely new: exclusiveCount > 0
  curatedViews: GatedCandidate[];             // 100% overlap, not suppressed
  suppressedCuratedViews: number;             // 100% overlap, in curatedSuppress (reported as a count, not a list)
  errors: { name: string; error: string }[];  // candidates that failed to gate-check
  anyChange: boolean;                         // newCollections.length > 0
  sampleSize: number;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface Args {
  json: boolean;
  bodyOut: string | null;
  limit: number;
  mediatype: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, bodyOut: null, limit: SAMPLE_SIZE, mediatype: "movies" };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/aggregation-probe.ts [--json] [--body-out=FILE] [--limit=N] [--mediatype=movies|audio|etree]",
      );
      process.exit(0);
    } else if (arg.startsWith("--body-out=")) {
      args.bodyOut = arg.slice("--body-out=".length);
    } else if (arg.startsWith("--limit=")) {
      const n = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`ERROR: --limit must be a positive integer, got "${arg.slice("--limit=".length)}".`);
        process.exit(2);
      }
      args.limit = n;
    } else if (arg.startsWith("--mediatype=")) {
      args.mediatype = arg.slice("--mediatype=".length);
      if (!(args.mediatype in MEDIATYPES)) {
        console.error(`ERROR: --mediatype must be one of ${Object.keys(MEDIATYPES).join(", ")}, got "${args.mediatype}".`);
        process.exit(2);
      }
    } else {
      console.error(`ERROR: unknown argument "${arg}". See --help.`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchPage(query: string, page: number): Promise<DocSample[]> {
  const url = new URL(ARCHIVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  // Only request the fields we need — keeps the response small.
  url.searchParams.set("fl", "identifier,collection,title");
  url.searchParams.set("sort", "downloads desc");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": `347movies-aggregation-probe/1.0 (+${SITE_URL})` },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`  aggregation-probe: page ${page} HTTP ${res.status}`);
      return [];
    }
    const body = (await res.json()) as {
      response?: { docs?: { identifier?: string; collection?: string | string[]; title?: string }[] };
    };
    const docs = body.response?.docs ?? [];
    return docs.map((d) => ({
      identifier: typeof d.identifier === "string" ? d.identifier : "",
      collection: normalizeCollection(d.collection),
      title: typeof d.title === "string" ? d.title : "",
    }));
  } catch (err) {
    console.error(`  aggregation-probe: page ${page} fetch error:`, err instanceof Error ? err.message : String(err));
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCollection(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((s) => s.trim())
    .filter(Boolean);
}

async function probeCount(query: string): Promise<{ numFound: number; error?: string }> {
  const url = new URL(ARCHIVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", "0"); // counts only
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": `347movies-aggregation-probe/1.0 (+${SITE_URL})` },
      signal: controller.signal,
    });
    if (!res.ok) return { numFound: -1, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { response?: { numFound?: number } };
    const numFound = body.response?.numFound;
    if (typeof numFound !== "number") return { numFound: -1, error: "bad JSON shape" };
    return { numFound };
  } catch (err) {
    return { numFound: -1, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

async function runProbe(sampleSize: number, mediatype: string): Promise<AggregationReport> {
  const date = new Date().toISOString().slice(0, 10);
  const cfg = mediatypeConfig(mediatype);

  // 1. Sample the licensed population by downloads.
  const pages = Math.ceil(sampleSize / PAGE_SIZE);
  const allDocs: DocSample[] = [];
  for (let p = 1; p <= pages; p++) {
    const docs = await fetchPage(`${LEGAL_CLAUSE} AND ${cfg.clause}`, p);
    allDocs.push(...docs);
    if (docs.length < PAGE_SIZE) break; // fewer results than page size = end of results
  }

  // 2. Aggregate collection fields.
  const counts = new Map<string, number>();
  for (const doc of allDocs) {
    for (const col of doc.collection) {
      if (col.startsWith("fav-")) continue;
      if (JUNK_MARKERS.has(col)) continue;
      counts.set(col, (counts.get(col) ?? 0) + 1);
    }
  }

  // 3. Find genuinely new collections (not known, above noise threshold).
  const unknown = [...counts.entries()]
    .filter(([name, count]) =>
      count >= NOISE_THRESHOLD &&
      !KNOWN_COLLECTIONS.has(name) &&
      !KNOWN_CANDIDATES.has(name),
    )
    .sort((a, b) => b[1] - a[1]);

  if (unknown.length === 0) {
    return { date, mediatype, candidatesChecked: 0, newCollections: [], curatedViews: [], suppressedCuratedViews: 0, errors: [], anyChange: false, sampleSize };
  }

  // 4. Gate-check each unknown candidate — license gate + overlap with the
  // already-registered pools of this mediatype. A candidate is "genuinely new"
  // only when some of its items sit OUTSIDE the registered pools; a 100%-overlap
  // candidate is a curated view of already-registered content (e.g. every etree
  // band collection is inside the `etree` catch-all the music pool gates on).
  const newCollections: GatedCandidate[] = [];
  const curatedViews: GatedCandidate[] = [];
  let suppressedCuratedViews = 0;
  const errors: { name: string; error: string }[] = [];

  // Probe up to 15 candidates (keeps CI runtime reasonable; the top ones by
  // sample count are the most interesting). NOTE: this top-15-by-sample-count
  // cutoff is a first-pass signal, not the whole answer — the junk-drawer long
  // tail regenerates faster than it can be suppressed, and small institutional
  // collections rank below the junk and are only found by step-5 provenance
  // drilling into subject mega-collections.
  for (const [name, sampleCount] of unknown.slice(0, 15)) {
    const gateRes = await probeCount(`${LEGAL_CLAUSE} AND collection:${name} AND ${cfg.clause}`);
    if (gateRes.error) {
      errors.push({ name, error: gateRes.error });
      continue;
    }
    const overlapRes = await probeCount(`${LEGAL_CLAUSE} AND collection:${name} AND ${cfg.poolUnion} AND ${cfg.clause}`);
    if (overlapRes.error) {
      errors.push({ name, error: overlapRes.error });
      continue;
    }
    const exclusiveCount = Math.max(0, gateRes.numFound - overlapRes.numFound);
    const candidate: GatedCandidate = {
      name, sampleCount,
      gateCount: gateRes.numFound,
      poolOverlap: overlapRes.numFound,
      exclusiveCount,
    };
    if (exclusiveCount > 0) {
      // Genuinely new — surfaced even when the name is in curatedSuppress: a curated
      // view that gains disjoint items is exactly the alert the suppress list must not
      // swallow (see MediatypeConfig.curatedSuppress doc).
      newCollections.push(candidate);
    } else if (cfg.curatedSuppress.includes(name)) {
      suppressedCuratedViews++;
    } else {
      curatedViews.push(candidate);
    }
  }

  return {
    date,
    mediatype,
    candidatesChecked: Math.min(unknown.length, 15),
    newCollections,
    curatedViews,
    suppressedCuratedViews,
    errors,
    anyChange: newCollections.length > 0,
    sampleSize,
  };
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

function renderMarkdown(report: AggregationReport): string {
  const cfg = mediatypeConfig(report.mediatype);
  const lines: string[] = [
    `### 🔬 Aggregation-based probe — ${report.mediatype}`,
    "",
    `Sampled the top ${report.sampleSize.toLocaleString()} licensed ${cfg.noun} (sorted by downloads), aggregated their \`collection\` fields, and cross-referenced against **${KNOWN_COLLECTIONS.size}** registered pool collections and **${KNOWN_CANDIDATES.size}** previously-probed candidates.`,
    "",
  ];

  if (!report.anyChange && report.curatedViews.length === 0 && report.suppressedCuratedViews === 0 && report.errors.length === 0) {
    lines.push("**No new collections found.** Every collection in the sample is either already registered as a pool or a previously-probed candidate. The catalog ceiling holds.", "");
    return lines.join("\n").trimEnd();
  }

  if (report.newCollections.length > 0) {
    lines.push(`**${report.newCollections.length} genuinely-new collection(s) worth reviewing:**`, "");
    for (const c of report.newCollections) {
      const archiveUrl = `https://archive.org/search?query=collection%3A${encodeURIComponent(c.name)}`;
      lines.push(`- **\`${c.name}\`** — ${c.gateCount} license-marked ${cfg.noun} (${c.exclusiveCount} exclusive of ${cfg.overlapLabel}, ${c.poolOverlap} overlap) — [browse archive.org](${archiveUrl})`);
    }
    lines.push(
      "",
      "**Next step:** sample provenance (item-level `fl=identifier,title,year,licenseurl`, downloads-desc) to confirm these are institutional/curator-applied marks, not self-declared junk. If clean, register them per the pool-wiring checklist.",
      "",
    );
  }

  if (report.curatedViews.length > 0) {
    lines.push(`**${report.curatedViews.length} curated-view collection(s)** — 100% inside the already-registered pools (${cfg.overlapLabel}), not new content:`, "");
    for (const c of report.curatedViews) {
      lines.push(`- \`${c.name}\` (${c.gateCount} license-marked ${cfg.noun}, all already in the registered pools)`);
    }
    lines.push("");
  }

  if (report.suppressedCuratedViews > 0) {
    lines.push(
      `**${report.suppressedCuratedViews} previously-confirmed curated-view collection(s)** re-checked and still 100% inside the already-registered pools (${cfg.overlapLabel}) — suppressed, will alert if any ever goes disjoint.`,
      "",
    );
  }

  if (report.errors.length > 0) {
    lines.push("**⚠️ Probe errors** (not counted — re-run or inspect):", "");
    for (const e of report.errors) {
      lines.push(`- \`${e.name}\`: ${e.error}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runProbe(args.limit, args.mediatype);

  if (args.json) {
    const out = {
      date: report.date,
      mediatype: report.mediatype,
      anyChange: report.anyChange,
      newCollections: report.newCollections,
      curatedViews: report.curatedViews,
      suppressedCuratedViews: report.suppressedCuratedViews,
      errors: report.errors,
      candidatesChecked: report.candidatesChecked,
      sampleSize: report.sampleSize,
    };
    if (args.bodyOut) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(args.bodyOut, `${renderMarkdown(report)}\n`);
    }
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderMarkdown(report)}\n`);
}

main().catch((err) => {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});